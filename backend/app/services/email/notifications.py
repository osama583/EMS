"""One function per notification trigger — see docs/email-notifications-plan.md
and docs/email-templates.md for the full design (recipient, purpose, copy).

Every function here takes plain values (never a raw DB row or a Flask
request), builds the email via `render.py`, and sends it via `client.send()`.
Callers just import the function for what happened and call it — they never
touch HTML or SMTP directly. All calls are safe to fire after a commit
succeeds; failures are logged, never raised (see client.send docstring).

Every function here is called from a real trigger except two, which are
marked "NOT WIRED UP" in their own docstring: they build a complete, correct
email but the backend flow that would fire them does not exist yet (guest
email-verification, and admin-driven email changes).

Workflow/registration/club triggers do not call these directly - they go
through `dispatch.py`, which resolves the audience and formats the details.
Auth and account-creation callers call these directly, because the plaintext
password only exists inside that one request.
"""
from __future__ import annotations

from ...config import config
from . import render
from .client import send

_APP_URL_PLACEHOLDER = config.frontend_url


# --------------------------------------------------------------------------
# 1. Proposal / event-approval workflow
# --------------------------------------------------------------------------

def proposal_awaiting_review(
    *,
    reviewer_email: str,
    reviewer_name: str,
    proposal_id: str,
    event_title: str,
    applicant: str,
    applicant_email: str,
    applicant_department: str,
    schedule: str,
    is_resubmission: bool = False,
) -> bool:
    """1.1 submitted -> first reviewer, 1.2 approved -> next reviewer,
    1.8 resubmitted -> reviewer at resume stage. Same shape in all three
    cases: a new decision has landed on this reviewer's desk."""
    verb = "resubmitted the proposal, previously sent back," if is_resubmission else "submitted a new event proposal"
    subject = f'{"Resubmission for review" if is_resubmission else "Action required"}: review "{event_title}" ({proposal_id})'
    body = [
        render.paragraph(f"Dear {render.escape_name(reviewer_name)},"),
        render.paragraph(
            f"{render.escape_name(applicant)} of {render.escape_name(applicant_department)} has {verb} "
            f'"{render.escape_name(event_title)}" (reference {render.escape_name(proposal_id)}).'
        ),
        render.detail_block([
            ("Applicant", f"{applicant} ({applicant_email})"),
            ("Scheduled", schedule),
        ]),
        render.paragraph("Please review the proposal and approve it, reject it, or return it for changes."),
    ]
    return send(
        to=reviewer_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" needs your review',
            body_paragraphs=body,
            cta_label="Review proposal",
            cta_link=f"{_APP_URL_PLACEHOLDER}/proposals/{proposal_id}",
        ),
    )


def proposal_rejected(
    *,
    applicant_email: str,
    applicant_name: str,
    proposal_id: str,
    event_title: str,
    reviewer_comment: str,
) -> bool:
    """1.3 reviewer rejects -> applicant. Terminal; no CTA."""
    subject = f'Your proposal "{event_title}" was not approved'
    body = [
        render.paragraph(f"Dear {render.escape_name(applicant_name)},"),
        render.paragraph(
            f'We are writing to let you know that your event proposal "{render.escape_name(event_title)}" '
            f"(reference {render.escape_name(proposal_id)}) was not approved."
        ),
        render.paragraph("Reviewer's comments:"),
        render.quote(reviewer_comment),
        render.paragraph(
            "This decision is final and no further action can be taken on this proposal. If you would "
            "like to run this event, please submit a new proposal that addresses the feedback above."
        ),
    ]
    return send(
        to=applicant_email,
        subject=subject,
        html=render.render(subject=subject, preheader=f'"{event_title}" was not approved', body_paragraphs=body),
    )


def proposal_sent_back(
    *,
    applicant_email: str,
    applicant_name: str,
    proposal_id: str,
    event_title: str,
    reviewer_comment: str,
) -> bool:
    """1.4 reviewer sends back -> applicant."""
    subject = f'Changes requested for "{event_title}"'
    body = [
        render.paragraph(f"Dear {render.escape_name(applicant_name)},"),
        render.paragraph(
            f'Your event proposal "{render.escape_name(event_title)}" (reference {render.escape_name(proposal_id)}) '
            "requires changes before it can proceed."
        ),
        render.paragraph("Reviewer's comments:"),
        render.quote(reviewer_comment),
        render.paragraph("Please update your proposal and resubmit it for review."),
    ]
    return send(
        to=applicant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'Changes requested on "{event_title}"',
            body_paragraphs=body,
            cta_label="Edit and resubmit",
            cta_link=f"{_APP_URL_PLACEHOLDER}/proposals/{proposal_id}/resubmit",
        ),
    )


def department_task_awaiting_review(
    *,
    department_head_email: str,
    department_head_name: str,
    proposal_code: str,
    event_title: str,
    applicant: str,
    applicant_email: str,
    unit_description: str,
    requirement_name: str,
    schedule: str,
    is_resubmission: bool = False,
) -> bool:
    """1.5 department task created -> department head, 1.9 applicant
    resubmits a single task -> that department head only."""
    verb = f"has resubmitted the {requirement_name} requirement" if is_resubmission else "requires"
    subject = f'{"Resubmission for review" if is_resubmission else "Action required"}: {requirement_name} for "{event_title}"'
    intro = (
        f'{render.escape_name(applicant)} {verb}, previously sent back by {render.escape_name(unit_description)}.'
        if is_resubmission
        else (
            f'The event "{render.escape_name(event_title)}" (reference {render.escape_name(proposal_code)}), submitted '
            f'by {render.escape_name(applicant)}, requires {render.escape_name(unit_description)}\'s approval for '
            f"the following requirement:"
        )
    )
    body = [
        render.paragraph(f"Dear {render.escape_name(department_head_name)},"),
        render.paragraph(intro),
        render.detail_block([
            ("Requirement", requirement_name),
            ("Applicant", f"{applicant} ({applicant_email})"),
            ("Scheduled", schedule),
        ]),
        render.paragraph("Please review this requirement and approve it, reject it, or return it for changes."),
    ]
    return send(
        to=department_head_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'{requirement_name} for "{event_title}" needs your review',
            body_paragraphs=body,
            cta_label="Review requirement",
            cta_link=f"{_APP_URL_PLACEHOLDER}/proposals/{proposal_code}/tasks",
        ),
    )


def department_task_sent_back(
    *,
    applicant_email: str,
    applicant_name: str,
    proposal_id: str,
    event_title: str,
    unit_description: str,
    comment: str,
) -> bool:
    """1.6 department head sends a task back -> applicant. Affects only this
    requirement; other departments are unaffected."""
    subject = f'Changes requested by {unit_description} for "{event_title}"'
    body = [
        render.paragraph(f"Dear {render.escape_name(applicant_name)},"),
        render.paragraph(
            f'{render.escape_name(unit_description)} has reviewed a requirement for your event '
            f'"{render.escape_name(event_title)}" and has requested changes before it can be approved.'
        ),
        render.paragraph("Their comments:"),
        render.quote(comment),
        render.paragraph(
            "This affects only this requirement — no other departments are involved, and their "
            "reviews are unaffected. Please update this requirement and resubmit it."
        ),
    ]
    return send(
        to=applicant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'{unit_description} requested changes on "{event_title}"',
            body_paragraphs=body,
            cta_label="Edit and resubmit",
            cta_link=f"{_APP_URL_PLACEHOLDER}/proposals/{proposal_id}/tasks",
        ),
    )


def proposal_fully_approved(
    *,
    recipient_email: str,
    recipient_name: str,
    proposal_id: str,
    event_title: str,
    schedule: str,
) -> bool:
    """1.7 final department task approved -> applicant + each co-owner.
    Call once per recipient (applicant, then each entry in coOwners)."""
    subject = f'Your event "{event_title}" is confirmed'
    body = [
        render.paragraph(f"Dear {render.escape_name(recipient_name)},"),
        render.paragraph(
            f'We are pleased to confirm that "{render.escape_name(event_title)}" '
            f"(reference {render.escape_name(proposal_id)}) has been approved by every department "
            "involved and is now fully confirmed."
        ),
        render.detail_block([("Scheduled", schedule)]),
        render.paragraph("No further action is required on your part. We wish you a successful event."),
    ]
    return send(
        to=recipient_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" is fully confirmed',
            body_paragraphs=body,
            cta_label="View event",
            cta_link=f"{_APP_URL_PLACEHOLDER}/proposals/{proposal_id}",
        ),
    )



def cafeteria_order_awaiting_review(
    *,
    manager_email: str,
    manager_name: str,
    proposal_id: str,
    event_title: str,
    order_summary: str,
) -> bool:
    """1.10 F&B places a cafeteria order -> that cafeteria's manager(s)."""
    subject = f'Action required: new order for "{event_title}"'
    body = [
        render.paragraph(f"Dear {render.escape_name(manager_name)},"),
        render.paragraph(
            f'A new food and beverage order has been placed for the upcoming event '
            f'"{render.escape_name(event_title)}" (reference {render.escape_name(proposal_id)}).'
        ),
        render.paragraph("Order details:"),
        render.quote(order_summary),
        render.paragraph("Please review this order and approve it or return it for changes."),
    ]
    return send(
        to=manager_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'New order for "{event_title}"',
            body_paragraphs=body,
            cta_label="Review order",
            cta_link=f"{_APP_URL_PLACEHOLDER}/cafeteria/orders",
        ),
    )


def proposal_cancelled(
    *,
    recipient_email: str,
    recipient_name: str,
    proposal_id: str,
    event_title: str,
    applicant: str,
    open_item: str,
) -> bool:
    """1.11 applicant cancels -> everyone currently holding an open task.
    Call once per recipient still holding open work on the proposal."""
    subject = f'"{event_title}" has been cancelled'
    body = [
        render.paragraph(f"Dear {render.escape_name(recipient_name)},"),
        render.paragraph(
            f'{render.escape_name(applicant)} has cancelled the event "{render.escape_name(event_title)}" '
            f"(reference {render.escape_name(proposal_id)}). Your pending item on this event, "
            f"{render.escape_name(open_item)}, is no longer required."
        ),
        render.paragraph("No further action is needed on your part."),
    ]
    return send(
        to=recipient_email,
        subject=subject,
        html=render.render(subject=subject, preheader=f'"{event_title}" was cancelled', body_paragraphs=body),
    )


# --------------------------------------------------------------------------
# 2. Auth & accounts
# --------------------------------------------------------------------------

def account_created_with_password(
    *,
    email: str,
    full_name: str,
    password: str,
    role_label: str,
) -> bool:
    """2.2 admin creates an account with a set password -> the new user.
    `password` must be the plaintext value, read before it's hashed — see
    api/admin.py create_user() and api/cafeterias.py _create_staff_account()."""
    subject = "Your APU Event Management System account has been created"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            f"An account has been created for you on the Event Management System "
            f"with the role of {render.escape_name(role_label)}."
        ),
        render.paragraph("Your login details are below:"),
        render.detail_block([("Email", email), ("Password", password)]),
        render.paragraph("For your security, please sign in and change this password as soon as possible."),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader="Your account is ready — sign in to get started",
            body_paragraphs=body,
            cta_label="Sign in",
            cta_link=f"{_APP_URL_PLACEHOLDER}/login",
        ),
    )


def cafeteria_staff_account_created(
    *,
    email: str,
    full_name: str,
    password: str,
    cafeteria_name: str,
    role_code: str,
) -> bool:
    """2.3 cafeteria manager/admin creates a staff account inline -> new
    staff member. Same plaintext-password window as account_created_with_password,
    in cafeterias.py _create_staff_account()."""
    subject = f"Your {cafeteria_name} staff account has been created"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            f"An account has been created for you at {render.escape_name(cafeteria_name)} "
            f"with the role of {render.escape_name(role_code)}."
        ),
        render.paragraph("Your login details are below:"),
        render.detail_block([("Email", email), ("Password", password)]),
        render.paragraph("For your security, please sign in and change this password as soon as possible."),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader="Your account is ready — sign in to get started",
            body_paragraphs=body,
            cta_label="Sign in",
            cta_link=f"{_APP_URL_PLACEHOLDER}/login",
        ),
    )


def password_reset_requested(
    *,
    email: str,
    full_name: str,
    reset_link: str,
    expiry_minutes: int,
) -> bool:
    """2.4a — the reset-request email. `reset_link` must already be the full,
    real reset URL (frontend origin + token) built by the caller."""
    subject = "Reset your password"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            "We received a request to reset the password for your Event Management System account. "
            f"Click the link below to choose a new password. This link will expire in {expiry_minutes} minutes."
        ),
        render.paragraph(
            "If you did not request a password reset, you can safely disregard this email — "
            "your password will remain unchanged."
        ),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader="Reset your password",
            body_paragraphs=body,
            cta_label="Reset password",
            cta_link=reset_link,
        ),
    )


def password_reset_completed(*, email: str, full_name: str, support_contact: str) -> bool:
    """2.4b — confirms a change, whether via the forgot-password link or the
    profile page's old/new password form. Same email either way."""
    subject = "Your password has been changed"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            "This is a confirmation that the password for your Event Management System account "
            "was successfully changed."
        ),
        render.paragraph(f"If you did not make this change, please contact {render.escape_name(support_contact)} immediately."),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(subject=subject, preheader="Your password was changed", body_paragraphs=body),
    )


def guest_registration_otp(*, email: str, full_name: str, otp_code: str, expiry_minutes: int) -> bool:
    """2.1b — NOT WIRED UP. No OTP column/verification endpoint exists yet;
    call this once guest self-registration gains email verification."""
    subject = "Your verification code"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph("Please use the following code to verify your email address and activate your account:"),
        render.detail_block([("Code", otp_code)]),
        render.paragraph(f"This code will expire in {expiry_minutes} minutes."),
        render.paragraph("If you did not create this account, please disregard this email."),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(subject=subject, preheader="Verify your email address", body_paragraphs=body),
    )


def email_changed_notice(*, old_email: str, full_name: str, new_email_masked: str, support_contact: str) -> bool:
    """2.5 — NOT WIRED UP. No admin-driven email-change endpoint exists yet;
    call this once that flow is built. `new_email_masked` must already be
    masked by the caller (see render.mask_email)."""
    subject = "Your account email address is being changed"
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            "We are writing to let you know that the login email address for your Event Management "
            f"System account is being changed from this address to {render.escape_name(new_email_masked)}."
        ),
        render.paragraph(f"If you did not request this change, please contact {render.escape_name(support_contact)} immediately."),
    ]
    return send(
        to=old_email,
        subject=subject,
        html=render.render(subject=subject, preheader="Your login email is changing", body_paragraphs=body),
    )


# --------------------------------------------------------------------------
# 3. Event registration (attendee side)
#
# The workflow section above is about getting an event APPROVED. This section
# is about people attending it once it is published - a separate audience
# (often guests with no account at all) who otherwise received nothing.
# --------------------------------------------------------------------------

def registration_confirmed(
    *,
    registrant_email: str,
    registrant_name: str,
    event_title: str,
    schedule: str,
    venue: str,
    organiser: str,
) -> bool:
    """3.1 automatic-approval registration -> the registrant, immediately.

    Sent to guests too: a guest registering with only a name and an email has
    no account to check, so this email IS their record of attending.
    """
    subject = f'You are registered for "{event_title}"'
    body = [
        render.paragraph(f"Dear {render.escape_name(registrant_name)},"),
        render.paragraph(
            f'Your place at "{render.escape_name(event_title)}" is confirmed. '
            "We look forward to seeing you there."
        ),
        render.detail_block([
            ("Event", event_title),
            ("When", schedule),
            ("Where", venue),
            ("Organiser", organiser),
        ]),
        render.paragraph(
            "Please keep this email as your confirmation. If you can no longer attend, "
            "cancel your registration so your place can be offered to someone else."
        ),
    ]
    return send(
        to=registrant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'Your place at "{event_title}" is confirmed',
            body_paragraphs=body,
            cta_label="View event",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/events/explore-events",
        ),
    )


def registration_pending_approval(
    *,
    registrant_email: str,
    registrant_name: str,
    event_title: str,
    schedule: str,
    venue: str,
) -> bool:
    """3.2 manual-approval registration -> the registrant, immediately.

    Distinct from 3.1 on purpose: the registrant is NOT yet attending, and
    telling them "confirmed" here would be wrong. This sets the expectation
    that a decision is still coming (3.4 / 3.5).
    """
    subject = f'Your registration for "{event_title}" is awaiting approval'
    body = [
        render.paragraph(f"Dear {render.escape_name(registrant_name)},"),
        render.paragraph(
            f'We have received your registration for "{render.escape_name(event_title)}". '
            "This event is approval-based, so the organiser will review your request and decide shortly."
        ),
        render.detail_block([("Event", event_title), ("When", schedule), ("Where", venue)]),
        render.paragraph(
            "You are not yet registered for this event. We will email you as soon as the "
            "organiser has made a decision."
        ),
    ]
    return send(
        to=registrant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'Awaiting the organiser\'s decision on "{event_title}"',
            body_paragraphs=body,
        ),
    )


def registration_awaiting_decision(
    *,
    organiser_email: str,
    organiser_name: str,
    event_title: str,
    registrant_name: str,
    registrant_email: str,
    reason: str,
) -> bool:
    """3.3 manual-approval registration -> the ORGANISER.

    Without this the request sits in a queue nobody is told about, which is
    exactly how a registrant ends up waiting on a decision that never comes.
    """
    subject = f'Action required: registration request for "{event_title}"'
    body = [
        render.paragraph(f"Dear {render.escape_name(organiser_name)},"),
        render.paragraph(
            f'{render.escape_name(registrant_name)} has asked to attend your event '
            f'"{render.escape_name(event_title)}" and is waiting on your decision.'
        ),
        render.detail_block([
            ("Registrant", f"{registrant_name} ({registrant_email})"),
            ("Event", event_title),
        ]),
        *([render.paragraph("Their reason for attending:"), render.quote(reason)] if reason else []),
        render.paragraph("Please approve or reject this request."),
    ]
    return send(
        to=organiser_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"{registrant_name} wants to attend \"{event_title}\"",
            body_paragraphs=body,
            cta_label="Review registration",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/inbox/registrations",
        ),
    )


def registration_approved(
    *,
    registrant_email: str,
    registrant_name: str,
    event_title: str,
    schedule: str,
    venue: str,
    organiser: str,
) -> bool:
    """3.4 organiser approves a pending registration -> the registrant."""
    subject = f'Your registration for "{event_title}" was approved'
    body = [
        render.paragraph(f"Dear {render.escape_name(registrant_name)},"),
        render.paragraph(
            f'Good news - the organiser has approved your registration for '
            f'"{render.escape_name(event_title)}". Your place is now confirmed.'
        ),
        render.detail_block([
            ("Event", event_title),
            ("When", schedule),
            ("Where", venue),
            ("Organiser", organiser),
        ]),
        render.paragraph(
            "Please keep this email as your confirmation. If you can no longer attend, "
            "cancel your registration so your place can be offered to someone else."
        ),
    ]
    return send(
        to=registrant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'Your place at "{event_title}" is confirmed',
            body_paragraphs=body,
            cta_label="View event",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/events/explore-events",
        ),
    )


def registration_rejected(
    *,
    registrant_email: str,
    registrant_name: str,
    event_title: str,
) -> bool:
    """3.5 organiser rejects a pending registration -> the registrant.

    Terminal, so no CTA. The organiser's queue carries no rejection-reason
    field, so none is quoted here rather than inventing one.
    """
    subject = f'Your registration for "{event_title}" was not approved'
    body = [
        render.paragraph(f"Dear {render.escape_name(registrant_name)},"),
        render.paragraph(
            f'We are writing to let you know that the organiser was unable to approve your '
            f'registration for "{render.escape_name(event_title)}".'
        ),
        render.paragraph(
            "Places at approval-based events are limited and the organiser decides who attends. "
            "You are welcome to browse other upcoming events."
        ),
    ]
    return send(
        to=registrant_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'Your registration for "{event_title}" was not approved',
            body_paragraphs=body,
        ),
    )


# --------------------------------------------------------------------------
# 4. Clubs
# --------------------------------------------------------------------------

def club_join_request_received(
    *,
    president_email: str,
    president_name: str,
    club_name: str,
    requester_name: str,
    requester_email: str,
    reason: str,
) -> bool:
    """4.1 student asks to join a club -> that club's President.

    The President is the only person who can decide, so without this the
    request waits in an inbox they have no reason to open.
    """
    subject = f'Action required: join request for {club_name}'
    body = [
        render.paragraph(f"Dear {render.escape_name(president_name)},"),
        render.paragraph(
            f'{render.escape_name(requester_name)} has asked to join '
            f"{render.escape_name(club_name)} and is waiting on your decision."
        ),
        render.detail_block([
            ("Applicant", f"{requester_name} ({requester_email})"),
            ("Club", club_name),
        ]),
        *([render.paragraph("Their reason for joining:"), render.quote(reason)] if reason else []),
        render.paragraph("Please approve or reject this request."),
    ]
    return send(
        to=president_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"{requester_name} wants to join {club_name}",
            body_paragraphs=body,
            cta_label="Review request",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/inbox/club-requests",
        ),
    )


def club_join_request_approved(
    *,
    requester_email: str,
    requester_name: str,
    club_name: str,
) -> bool:
    """4.2 President approves -> the applicant. They are now a member, which
    also grants them visibility of that club's Club Only events."""
    subject = f"You are now a member of {club_name}"
    body = [
        render.paragraph(f"Dear {render.escape_name(requester_name)},"),
        render.paragraph(
            f"Your request to join {render.escape_name(club_name)} has been approved - "
            "welcome to the club."
        ),
        render.paragraph(
            "You can now see the club's members-only events on the event calendar and take part "
            "in its activities."
        ),
    ]
    return send(
        to=requester_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"Welcome to {club_name}",
            body_paragraphs=body,
            cta_label="View my clubs",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/clubs/my-clubs",
        ),
    )


def club_join_request_rejected(
    *,
    requester_email: str,
    requester_name: str,
    club_name: str,
    comment: str,
) -> bool:
    """4.3 President rejects -> the applicant. A rejection always carries a
    comment (the API enforces a minimum length), so it is always quoted."""
    subject = f"Your request to join {club_name}"
    body = [
        render.paragraph(f"Dear {render.escape_name(requester_name)},"),
        render.paragraph(
            f"We are writing to let you know that your request to join "
            f"{render.escape_name(club_name)} was not approved on this occasion."
        ),
        *([render.paragraph("The President's comments:"), render.quote(comment)] if comment else []),
        render.paragraph("You are welcome to explore other clubs open for membership."),
    ]
    return send(
        to=requester_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"Your request to join {club_name}",
            body_paragraphs=body,
            cta_label="Browse clubs",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/clubs",
        ),
    )


def club_membership_removed(
    *,
    member_email: str,
    member_name: str,
    club_name: str,
    removed_by: str,
) -> bool:
    """4.4 President/Club Admin removes a member -> the member.

    The one club transition the member does not initiate and would otherwise
    never be told about: their club simply stops appearing in My Clubs, and the
    members-only events they could see yesterday quietly vanish from the
    calendar. Being removed is also the one case where "you can ask to join
    again" is genuinely useful and not a brush-off - nothing here bars them
    from reapplying, so the mail says so.

    Deliberately carries NO reason: unlike a rejected join request, removal has
    no comment field to quote, and inventing an explanation on the club's behalf
    would be worse than leaving it to them to give in person. `removed_by` names
    the authority, not the individual - "the club's President" rather than a
    name, so the mail does not read as pointing a finger.
    """
    subject = f"Your membership of {club_name} has ended"
    body = [
        render.paragraph(f"Dear {render.escape_name(member_name)},"),
        render.paragraph(
            f"You have been removed from {render.escape_name(club_name)} by {removed_by}. "
            "Your membership has ended, so the club will no longer appear in My Clubs and you "
            "will stop seeing its members-only events."
        ),
        render.paragraph(
            "If you think this was a mistake, speak to the club directly - nothing stops you "
            "asking to join again from Discover Clubs."
        ),
    ]
    return send(
        to=member_email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"Your membership of {club_name} has ended",
            body_paragraphs=body,
            cta_label="Browse clubs",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/clubs",
        ),
    )


# --------------------------------------------------------------------------
# 5. Event reminders (time- and capacity-driven)
#
# Unlike every notification above, these are not triggered by someone clicking
# something - they are sent by scripts/send_event_reminders.py when a date gets
# close or a counter crosses a threshold. Each one is opt-out per reader, per
# list, via notification_preference (see the My Events > Saved / Registered
# tabs), so each template says which list it came from and how to stop it.
# --------------------------------------------------------------------------

def saved_event_filling_up(
    *,
    email: str,
    full_name: str,
    event_title: str,
    schedule: str,
    venue: str,
    percent_full: int,
    places_left: int,
) -> bool:
    """5.1 a SAVED event passes SAVED_CAPACITY_PERCENT of its capacity.

    Sent only to people who saved it and have NOT registered - telling someone
    who already holds a place that the event is filling up is noise.
    """
    subject = f'"{event_title}" is {percent_full}% full'
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            f'You saved "{render.escape_name(event_title)}" but have not registered yet, and it '
            f"is now {percent_full}% full."
        ),
        render.detail_block([
            ("When", schedule),
            ("Where", venue),
            ("Places left", str(places_left)),
        ]),
        render.paragraph(
            "Register now if you would like to attend - once it is full, no further places can "
            "be given out."
        ),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f"Only {places_left} place(s) left",
            body_paragraphs=body,
            cta_label="Register now",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/events/explore-events",
        ),
    )


def saved_event_starting_soon(
    *,
    email: str,
    full_name: str,
    event_title: str,
    schedule: str,
    venue: str,
    days_away: int,
) -> bool:
    """5.2 a SAVED event is near and the reader still has not registered.

    The distinction from 5.3 is the whole point: this person is NOT attending
    yet, so the message is "act or miss it", not "see you there".
    """
    when = "tomorrow" if days_away == 1 else f"in {days_away} days"
    subject = f'"{event_title}" is {when} - you have not registered'
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            f'"{render.escape_name(event_title)}" is happening {when}, and you saved it but have '
            "not registered."
        ),
        render.detail_block([("When", schedule), ("Where", venue)]),
        render.paragraph(
            "If you still want to attend, register now. If you no longer plan to, you can remove "
            "it from your saved events."
        ),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" is {when} and you have not registered',
            body_paragraphs=body,
            cta_label="Register now",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/events/my-events/saved",
        ),
    )


def registered_event_starting_soon(
    *,
    email: str,
    full_name: str,
    event_title: str,
    schedule: str,
    venue: str,
    organiser: str,
    days_away: int,
) -> bool:
    """5.3 an event the reader IS registered for is near.

    A confirmation, not a call to action: they already hold a place, so this
    exists so the date does not pass them by.
    """
    when = "tomorrow" if days_away == 1 else f"in {days_away} days"
    subject = f'Reminder: "{event_title}" is {when}'
    body = [
        render.paragraph(f"Dear {render.escape_name(full_name)},"),
        render.paragraph(
            f'This is a reminder that "{render.escape_name(event_title)}", which you are '
            f"registered for, takes place {when}."
        ),
        render.detail_block([
            ("When", schedule),
            ("Where", venue),
            ("Organiser", organiser),
        ]),
        render.paragraph(
            "If you can no longer attend, please cancel your registration so your place can be "
            "offered to someone else."
        ),
    ]
    return send(
        to=email,
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" is {when}',
            body_paragraphs=body,
            cta_label="View my events",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/events/my-events/registered",
        ),
    )


# --------------------------------------------------------------------------
# 9. Approval escalation (migration 037)
#
# These three are TIME-triggered, not action-triggered: nobody clicks anything
# to cause them. They are sent by scripts/process_escalations.py, which is also
# what keeps them from repeating - see proposal_escalation_sent.
# --------------------------------------------------------------------------

def proposal_decision_due(
    *,
    approver_email: str,
    approver_name: str,
    proposal_id: str,
    event_title: str,
    stage_label: str,
    days_until_event: int,
    schedule_line: str,
    urgent: bool,
    also_notify: list[str] | None = None,
) -> bool:
    """9.1 a proposal is still undecided and its event is close -> the approver.

    One function for both tiers: the copy differs only in urgency, and two
    near-identical templates would drift apart the first time either is edited.
    """
    when = (
        "today" if days_until_event == 0
        else "tomorrow" if days_until_event == 1
        else f"in {days_until_event} days"
    )
    prefix = "Action needed today" if urgent else "Reminder"
    subject = f'{prefix}: "{event_title}" is waiting for your decision'

    body = [
        render.paragraph(f"Dear {render.escape_name(approver_name)},"),
        render.paragraph(
            f'The event proposal "{render.escape_name(event_title)}" '
            f"(reference {render.escape_name(proposal_id)}) is still awaiting your decision at "
            f"{render.escape_name(stage_label)}, and the event starts {when}."
        ),
        render.detail_block([("Event", event_title), ("When", schedule_line), ("Reference", proposal_id)]),
    ]
    if urgent:
        body.append(
            render.paragraph(
                "If no decision is recorded before the event date, the proposal will be marked "
                "overdue against this stage and the applicant will be told it could not proceed."
            )
        )
    else:
        body.append(render.paragraph("Please review it so the applicant can plan with confidence."))

    # client.send() takes no cc argument - it accepts a list of recipients and
    # applies config.email_cc itself, so extra people go in `to`.
    return send(
        to=[approver_email, *(also_notify or [])],
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" starts {when} and is awaiting your decision',
            body_paragraphs=body,
            cta_label="Review proposal",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/inbox/proposals",
        ),
    )


def proposal_overdue_applicant(
    *,
    applicant_email: str,
    applicant_name: str,
    proposal_id: str,
    event_title: str,
    stage_label: str,
    event_date_label: str,
    contact_line: str,
    also_notify: list[str] | None = None,
) -> bool:
    """9.2 the event date passed with no decision -> the applicant, F&B copied.

    THE TONE IS AN APOLOGY, deliberately. The applicant did nothing wrong: they
    submitted in time and the system failed to give them an answer. Copy that
    read like a rejection, or that asked them to "resubmit", would put the cost
    of someone else's delay back on them. It says what happened, names the
    stage, and points them at a person who can help.
    """
    subject = f'We are sorry - "{event_title}" did not receive a decision in time'
    body = [
        render.paragraph(f"Dear {render.escape_name(applicant_name)},"),
        render.paragraph(
            f'We are sorry. Your event proposal "{render.escape_name(event_title)}" '
            f"(reference {render.escape_name(proposal_id)}) was still awaiting a decision at "
            f"{render.escape_name(stage_label)} when its event date "
            f"({render.escape_name(event_date_label)}) passed."
        ),
        render.paragraph(
            "Your proposal was <strong>not rejected</strong>, and nothing was wrong with it. "
            "No decision was recorded in time, and we apologise for that."
        ),
        render.detail_block([("Event", event_title), ("Event date", event_date_label), ("Reference", proposal_id)]),
        render.paragraph(contact_line),
    ]
    return send(
        to=[applicant_email, *(also_notify or [])],
        subject=subject,
        html=render.render(
            subject=subject,
            preheader=f'"{event_title}" did not receive a decision before its event date',
            body_paragraphs=body,
            cta_label="View proposal",
            cta_link=f"{_APP_URL_PLACEHOLDER}/app/history/proposals",
        ),
    )
