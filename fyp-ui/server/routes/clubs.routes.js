const express = require('express');
const { db, nextId } = require('../db');
const workflow = require('../services/workflow.service');
const { WorkflowError } = workflow;
const { isClubAdmin, presidentOfClubIds, isPresidentOf, isEligibleForClub } = require('../services/club-identity.service');
const softDeleteService = require('../services/soft-delete.service');

const router = express.Router();

// `role` on the wire is the user's student/lecturer role_code (isEligibleForClub()'s only two
// possible matches — see club-identity.service.js), not their full role list; ClubUserSummary is
// a narrow display-only shape independent of AuthUser's roles[].
function projectUserSummary(userId) {
  const user = db.users.find((u) => u.user_id === userId);
  if (!user) return null;
  const clubRole = db.user_unit_roles.find((uur) => uur.user_id === userId && (uur.role_code === 'student' || uur.role_code === 'lecturer'));
  return { id: String(user.user_id), displayName: user.full_name, email: user.email, role: clubRole ? clubRole.role_code : 'staff' };
}

function projectCategory(category) {
  return { id: String(category.club_category_id), name: category.name, active: category.active, createdAt: category.created_at };
}

const MIN_CLUB_CATEGORIES = 1;
const MAX_CLUB_CATEGORIES = 3;

function clubCategoriesFor(clubId) {
  const categoryIds = db.club_category_links.filter((l) => l.club_id === clubId).map((l) => l.club_category_id);
  return db.club_categories.filter((c) => categoryIds.includes(c.club_category_id));
}

// Resolves and validates a categoryIds array from a request body against club_categories,
// enforcing the 1-3 count. Returns the resolved category rows (order preserved, de-duplicated).
function resolveCategoryIds(categoryIds) {
  if (!Array.isArray(categoryIds)) throw new WorkflowError('categoryIds must be an array.', 400);
  const uniqueIds = [...new Set(categoryIds.map((id) => Number(id)))];
  if (uniqueIds.length < MIN_CLUB_CATEGORIES) throw new WorkflowError(`Select at least ${MIN_CLUB_CATEGORIES} category.`, 400);
  if (uniqueIds.length > MAX_CLUB_CATEGORIES) throw new WorkflowError(`A club may have at most ${MAX_CLUB_CATEGORIES} categories.`, 400);
  const categories = uniqueIds.map((id) => {
    const category = db.club_categories.find((c) => c.club_category_id === id);
    if (!category) throw new WorkflowError('Selected category not found.', 400);
    return category;
  });
  return categories;
}

function setClubCategoryLinks(clubId, categories) {
  for (let i = db.club_category_links.length - 1; i >= 0; i -= 1) {
    if (db.club_category_links[i].club_id === clubId) db.club_category_links.splice(i, 1);
  }
  for (const category of categories) db.club_category_links.push({ club_id: clubId, club_category_id: category.club_category_id });
}

function projectClub(club) {
  const president = projectUserSummary(club.user_id);
  const memberCount = db.club_members.filter((m) => m.club_id === club.club_id).length;
  const pendingRequestCount = db.club_join_requests.filter((r) => r.club_id === club.club_id && r.status === 'pending').length;
  return {
    id: String(club.club_id),
    name: club.club_name,
    description: club.description || '',
    imageUrl: club.image_url || null,
    categories: clubCategoriesFor(club.club_id).map(projectCategory),
    active: club.active,
    createdAt: club.created_at,
    president,
    createdBy: projectUserSummary(club.created_by_user_id),
    memberCount,
    pendingRequestCount,
  };
}

function projectJoinRequest(request) {
  const club = db.clubs.find((c) => c.club_id === request.club_id);
  return {
    id: String(request.club_join_request_id),
    clubId: String(request.club_id),
    clubName: club ? club.club_name : '',
    requester: projectUserSummary(request.requester_user_id),
    reason: request.reason || '',
    status: request.status,
    comment: request.comment || '',
    createdAt: request.created_at,
    resolvedAt: request.resolved_at || null,
  };
}

const REJECTION_COMMENT_MIN_LENGTH = 20;

// ---------------------------------------------------------------------------
// Club Admin capability is the 'club-admin' flat role (see role-eligibility.service.js) — granted
// and revoked exclusively via the normal Users -> Assignments endpoints in admin.routes.js
// (POST/DELETE /users/:id/assignments), same mechanism as every other role. No dedicated
// grant/revoke routes here any more.
// ---------------------------------------------------------------------------
// Club categories — a Club Admin-managed lookup list (like event_category). A club's President
// may pick a category for their own club from this list but cannot create new ones.
// ---------------------------------------------------------------------------

router.get('/club-categories', async (req, res, next) => {
  try {
    let categories = db.club_categories.filter((c) => !c.archived_at);
    if (req.query.activeOnly === 'true') categories = categories.filter((c) => c.active);
    res.json(categories.map(projectCategory));
  } catch (err) { next(err); }
});

router.post('/club-categories', async (req, res, next) => {
  try {
    const name = req.body.name ? String(req.body.name).trim() : '';
    if (!name) throw new WorkflowError('Category name is required.', 400);
    const createdByUserId = req.body.createdByUserId ? Number(req.body.createdByUserId) : null;
    if (!createdByUserId || !isClubAdmin(createdByUserId)) throw new WorkflowError('Only a Club Admin can create club categories.', 403);
    if (db.club_categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new WorkflowError('A category with this name already exists.', 409);
    const category = { club_category_id: nextId('club_categories'), name, active: true, created_at: new Date().toISOString(), archived_at: null };
    db.club_categories.push(category);
    res.status(201).json(projectCategory(category));
  } catch (err) { next(err); }
});

router.put('/club-categories/:id', async (req, res, next) => {
  try {
    const category = db.club_categories.find((c) => c.club_category_id === Number(req.params.id));
    if (!category) throw new WorkflowError('Category not found.', 404);
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) throw new WorkflowError('Category name is required.', 400);
      category.name = name;
    }
    res.json(projectCategory(category));
  } catch (err) { next(err); }
});

router.patch('/club-categories/:id/status', async (req, res, next) => {
  try {
    const category = db.club_categories.find((c) => c.club_category_id === Number(req.params.id));
    if (!category) throw new WorkflowError('Category not found.', 404);
    category.active = req.body.active;
    res.json(projectCategory(category));
  } catch (err) { next(err); }
});

// Soft-delete (7-day retention, restore, permanent purge, pre-confirm dependency preview) via the
// shared registry — blocked while any club still references this category.
softDeleteService.mountRoutes(router, '/club-categories', 'clubCategory', projectCategory);

// ---------------------------------------------------------------------------
// Clubs (Club Admin manages; anyone can browse the active list for the discovery page)
// ---------------------------------------------------------------------------

router.get('/clubs', async (req, res, next) => {
  try {
    const viewerUserId = req.query.viewerUserId ? Number(req.query.viewerUserId) : null;
    let clubs = db.clubs;
    if (req.query.activeOnly === 'true') clubs = clubs.filter((c) => c.active);
    const projected = clubs.map(projectClub);
    if (viewerUserId) {
      const membershipByClub = new Map(db.club_members.filter((m) => m.user_id === viewerUserId).map((m) => [m.club_id, m]));
      const pendingByClub = new Set(db.club_join_requests.filter((r) => r.requester_user_id === viewerUserId && r.status === 'pending').map((r) => r.club_id));
      return res.json(projected.map((club, index) => ({
        ...club,
        viewerIsMember: membershipByClub.has(clubs[index].club_id),
        viewerHasPendingRequest: pendingByClub.has(clubs[index].club_id),
        viewerIsPresident: clubs[index].user_id === viewerUserId,
      })));
    }
    res.json(projected);
  } catch (err) { next(err); }
});

// Users eligible to be assigned as a club's President (students and lecturers only). Must be
// registered BEFORE /clubs/:id below — Express matches routes in registration order, so
// 'eligible-presidents' would otherwise be swallowed by :id and 404 as "Club not found."
router.get('/clubs/eligible-presidents', async (_req, res, next) => {
  try {
    const eligible = db.users.filter((u) => isEligibleForClub(u));
    res.json(eligible.map((u) => projectUserSummary(u.user_id)));
  } catch (err) { next(err); }
});

router.get('/clubs/:id', async (req, res, next) => {
  try {
    const club = db.clubs.find((c) => c.club_id === Number(req.params.id));
    if (!club) throw new WorkflowError('Club not found.', 404);
    res.json(projectClub(club));
  } catch (err) { next(err); }
});

router.post('/clubs', async (req, res, next) => {
  try {
    const { name, description, imageUrl, presidentUserId, createdByUserId, active, categoryIds } = req.body;
    if (!name || !String(name).trim()) throw new WorkflowError('Club Name is required.', 400);
    if (!createdByUserId || !isClubAdmin(Number(createdByUserId))) throw new WorkflowError('Only a Club Admin can create a club.', 403);
    const president = presidentUserId ? db.users.find((u) => u.user_id === Number(presidentUserId)) : null;
    if (presidentUserId && !isEligibleForClub(president)) throw new WorkflowError('The President must be a student or lecturer.', 400);
    const categories = resolveCategoryIds(categoryIds);
    const club = {
      club_id: nextId('clubs'),
      user_id: president ? president.user_id : Number(createdByUserId),
      club_name: String(name).trim(),
      description: description || null,
      image_url: imageUrl || null,
      created_by_user_id: Number(createdByUserId),
      active: active !== undefined ? active : true,
      created_at: new Date().toISOString(),
    };
    db.clubs.push(club);
    setClubCategoryLinks(club.club_id, categories);
    res.status(201).json(projectClub(club));
  } catch (err) { next(err); }
});

router.put('/clubs/:id', async (req, res, next) => {
  try {
    const club = db.clubs.find((c) => c.club_id === Number(req.params.id));
    if (!club) throw new WorkflowError('Club not found.', 404);
    const { name, description, imageUrl, presidentUserId, active, categoryIds } = req.body;
    if (name !== undefined) {
      if (!String(name).trim()) throw new WorkflowError('Club Name is required.', 400);
      club.club_name = String(name).trim();
    }
    if (description !== undefined) club.description = description || null;
    if (imageUrl !== undefined) club.image_url = imageUrl || null;
    if (active !== undefined) club.active = active;
    if (categoryIds !== undefined) {
      const categories = resolveCategoryIds(categoryIds);
      setClubCategoryLinks(club.club_id, categories);
    }
    if (presidentUserId !== undefined) {
      const president = db.users.find((u) => u.user_id === Number(presidentUserId));
      if (!isEligibleForClub(president)) throw new WorkflowError('The President must be a student or lecturer.', 400);
      club.user_id = president.user_id;
    }
    res.json(projectClub(club));
  } catch (err) { next(err); }
});

// President-only: change just the categories of a club they preside over (they cannot rename the
// club, replace the President, or touch anything else — that stays Club Admin-only via PUT above).
router.patch('/clubs/:id/categories', async (req, res, next) => {
  try {
    const club = db.clubs.find((c) => c.club_id === Number(req.params.id));
    if (!club) throw new WorkflowError('Club not found.', 404);
    const actingUserId = Number(req.body.actingUserId);
    if (!isPresidentOf(actingUserId, club.club_id)) throw new WorkflowError('Only the club President can change its categories.', 403);
    const categories = resolveCategoryIds(req.body.categoryIds);
    setClubCategoryLinks(club.club_id, categories);
    res.json(projectClub(club));
  } catch (err) { next(err); }
});

router.patch('/clubs/:id/status', async (req, res, next) => {
  try {
    const club = db.clubs.find((c) => c.club_id === Number(req.params.id));
    if (!club) throw new WorkflowError('Club not found.', 404);
    club.active = req.body.active;
    res.json(projectClub(club));
  } catch (err) { next(err); }
});

router.get('/clubs/:id/members', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id);
    const members = db.club_members.filter((m) => m.club_id === clubId);
    res.json(members.map((m) => ({ user: projectUserSummary(m.user_id), dateJoined: m.date_joined })));
  } catch (err) { next(err); }
});

router.delete('/clubs/:id/members/:userId', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const index = db.club_members.findIndex((m) => m.club_id === clubId && m.user_id === userId);
    if (index === -1) throw new WorkflowError('This user is not a member of the club.', 404);
    db.club_members.splice(index, 1);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Join requests — students/lecturers request to join; the club's President reviews from
// their inbox. Approve inserts a club_members row; reject just records a comment.
// ---------------------------------------------------------------------------

router.post('/clubs/:id/join-requests', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id);
    const requesterUserId = Number(req.body.requesterUserId);
    const reason = String(req.body.reason || '').trim();
    if (!reason) throw new WorkflowError('Tell the President why you want to join this club.', 400);
    const club = db.clubs.find((c) => c.club_id === clubId);
    if (!club) throw new WorkflowError('Club not found.', 404);
    const requester = db.users.find((u) => u.user_id === requesterUserId);
    if (!isEligibleForClub(requester)) throw new WorkflowError('Only students and lecturers can join clubs.', 403);
    if (db.club_members.some((m) => m.club_id === clubId && m.user_id === requesterUserId)) {
      throw new WorkflowError('You are already a member of this club.', 409);
    }
    if (db.club_join_requests.some((r) => r.club_id === clubId && r.requester_user_id === requesterUserId && r.status === 'pending')) {
      throw new WorkflowError('You already have a pending request for this club.', 409);
    }
    const request = {
      club_join_request_id: nextId('club_join_requests'),
      club_id: clubId,
      requester_user_id: requesterUserId,
      reason,
      status: 'pending',
      comment: null,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by_user_id: null,
    };
    db.club_join_requests.push(request);
    res.status(201).json(projectJoinRequest(request));
  } catch (err) { next(err); }
});

// The President's inbox: pending join requests for clubs they preside over.
router.get('/clubs/join-requests/inbox', async (req, res, next) => {
  try {
    const presidentUserId = Number(req.query.presidentUserId);
    const clubIds = new Set(presidentOfClubIds(presidentUserId));
    const requests = db.club_join_requests.filter((r) => clubIds.has(r.club_id) && r.status === 'pending');
    res.json(requests.map(projectJoinRequest));
  } catch (err) { next(err); }
});

// A requester's own history of requests they've sent (any status).
router.get('/clubs/join-requests/mine', async (req, res, next) => {
  try {
    const requesterUserId = Number(req.query.requesterUserId);
    const requests = db.club_join_requests.filter((r) => r.requester_user_id === requesterUserId);
    res.json(requests.map(projectJoinRequest));
  } catch (err) { next(err); }
});

router.post('/clubs/join-requests/:id/approve', async (req, res, next) => {
  try {
    const request = db.club_join_requests.find((r) => r.club_join_request_id === Number(req.params.id));
    if (!request) throw new WorkflowError('Join request not found.', 404);
    if (request.status !== 'pending') throw new WorkflowError('This request has already been resolved.', 409);
    const resolvedByUserId = Number(req.body.resolvedByUserId);
    if (!isPresidentOf(resolvedByUserId, request.club_id)) throw new WorkflowError('Only the club President can review this request.', 403);
    request.status = 'approved';
    request.resolved_at = new Date().toISOString();
    request.resolved_by_user_id = resolvedByUserId;
    if (!db.club_members.some((m) => m.club_id === request.club_id && m.user_id === request.requester_user_id)) {
      db.club_members.push({ club_id: request.club_id, user_id: request.requester_user_id, date_joined: new Date().toISOString().slice(0, 10) });
    }
    res.json(projectJoinRequest(request));
  } catch (err) { next(err); }
});

router.post('/clubs/join-requests/:id/reject', async (req, res, next) => {
  try {
    const request = db.club_join_requests.find((r) => r.club_join_request_id === Number(req.params.id));
    if (!request) throw new WorkflowError('Join request not found.', 404);
    if (request.status !== 'pending') throw new WorkflowError('This request has already been resolved.', 409);
    const resolvedByUserId = Number(req.body.resolvedByUserId);
    if (!isPresidentOf(resolvedByUserId, request.club_id)) throw new WorkflowError('Only the club President can review this request.', 403);
    const comment = String(req.body.comment || '').trim();
    if (comment.length < REJECTION_COMMENT_MIN_LENGTH) {
      throw new WorkflowError(`A rejection reason of at least ${REJECTION_COMMENT_MIN_LENGTH} characters is required.`, 400);
    }
    request.status = 'rejected';
    request.comment = comment;
    request.resolved_at = new Date().toISOString();
    request.resolved_by_user_id = resolvedByUserId;
    res.json(projectJoinRequest(request));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// "Who am I" club summary — consumed by the client right after login (and on refresh) to know
// whether the current user is a Club Admin and/or the President of any club, purely from data.
// ---------------------------------------------------------------------------

router.get('/clubs/my-status/:userId', async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    res.json({
      isClubAdmin: isClubAdmin(userId),
      presidentOfClubIds: presidentOfClubIds(userId).map(String),
    });
  } catch (err) { next(err); }
});

module.exports = router;
