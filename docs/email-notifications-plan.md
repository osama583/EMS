# Email Notification Map

The bar for inclusion: **would the process break, stall, or lock someone out without this email?** Not "nice to know" — "no other way to find out in time to act." Everything that's merely confirming something the actor can already see on their own screen is left for in-app notifications instead, listed at the end of each section.

Every placeholder below (`{{like_this}}`) is an exact field name from the backend, confirmed by reading the actual schema/response code — not a guess. Where a field doesn't exist yet (masking, OTP), that's called out explicitly as new logic to add.

---

## 1. Proposal / Event-Approval Workflow

Source object: proposal (`svc.project()`, `backend/app/services/proposals.py`) and department task (`request_task`, `backend/app/services/workflow/tasks.py`).

### 1.1 Proposal submitted → first-stage reviewer
**Recipient:** the HOS/HOD (or next-stage reviewer if HOS/HOD is skipped)
**Content:**
- Reference: `{{proposalId}}` (e.g. `EVT-00042`)
- Event: `{{eventTitle}}`
- Submitted by: `{{applicant}}` (`{{applicantEmail}}`), `{{applicantDepartment}}`
- Schedule: `{{schedule}}` (pre-joined date/time/location string)
- Action needed: review and decide (approve / reject / send back)
- Link to the proposal record

### 1.2 Reviewer approves → next reviewer
**Recipient:** F&B head, CFO, or routed department heads, whichever is next in the chain
**Content:** same shape as 1.1 — this reviewer stage doesn't know or care who approved it before them, only that it's now theirs.

### 1.3 Reviewer rejects → applicant
**Recipient:** `{{applicant}}` (`{{applicantEmail}}`)
**Content:**
- Reference: `{{proposalId}}`, event: `{{eventTitle}}`
- Outcome: rejected, terminal — no further action possible on this proposal
- Reason: `{{workflow.reviewerComment}}`
- No link to "continue" — make clear this is final; if they want to run the event, they submit a new proposal

### 1.4 Reviewer sends back → applicant
**Recipient:** `{{applicant}}` (`{{applicantEmail}}`)
**Content:**
- Reference: `{{proposalId}}`, event: `{{eventTitle}}`
- Outcome: changes requested, resubmission needed
- Reason: `{{workflow.reviewerComment}}`
- Action needed: edit and resubmit
- Link to the resubmission form

### 1.5 Department task created → department head
**Recipient:** head of `{{assigned_unit_description}}`
**Content:**
- Event: `{{eventTitle}}` (reference `{{proposalCode}}`)
- Applicant: `{{applicant}}` (`{{applicantEmail}}`)
- Requirement: `{{requirement_name}}`
- Schedule: `{{schedule}}`
- Action needed: approve, reject, or send back this requirement

### 1.6 Department task sent back → applicant
**Recipient:** `{{applicant}}` (`{{applicantEmail}}`)
**Content:**
- Event: `{{eventTitle}}`, department: `{{assigned_unit_description}}`
- Reason: `{{comment}}` (the task-level comment, distinct from the reviewer-stage comment)
- Action needed: fix and resubmit this specific requirement only — other departments are unaffected
- Link to the department-task resubmission form

### 1.7 Final department task approved → applicant (event confirmed)
**Recipient:** `{{applicant}}` (`{{applicantEmail}}`), and each entry in `{{coOwners}}` (`name`, `email`)
**Content:**
- Event: `{{eventTitle}}` (reference `{{proposalId}}`)
- Outcome: fully approved — every department has cleared, the event is confirmed
- Schedule: `{{schedule}}`
- No action needed — informational, but this is the only place this fact exists

### 1.8 Applicant resubmits (whole proposal) → reviewer at resume stage
**Recipient:** whichever reviewer role owns `resume_stage`
**Content:** same shape as 1.1, noting it's a resubmission — "previously sent back, here's the corrected version."

### 1.9 Applicant resubmits single department task → that department head only
**Recipient:** head of `{{assigned_unit_description}}` (only that one, not the full chain)
**Content:** same shape as 1.5, noting resubmission.

### 1.10 F&B places cafeteria order → cafeteria manager(s)
**Recipient:** manager(s) of the targeted cafeteria(s)
**Content:**
- Event: `{{eventTitle}}`, reference `{{proposalId}}`
- Order details (items/quantities — from the F&B selection, not modeled above)
- Action needed: approve or send back

### 1.11 Applicant cancels proposal → everyone holding an open task
**Recipient:** every department head / reviewer / cafeteria manager with a non-terminal task on this proposal
**Content:**
- Event: `{{eventTitle}}` cancelled by `{{applicant}}`
- Their specific open item (`{{requirement_name}}` or order) is void — no further action needed

**Dropped from this section per your note:** *"Head assigns staff to a task"* — internal to the department, staff already see their own task list, not important enough to email.

---

## 2. Auth & Accounts

### 2.1 Guest self-registers → new user (⚠️ requires new OTP flow)
**Recipient:** the new user
**Two-part flow, per your note:**
1. **Welcome email** — `{{full_name}}`, confirms account created
2. **OTP verification email** — a generated one-time code (new field, not yet modeled — e.g. `otp_code`, 6 digits, short expiry), with instruction to enter it in-app to verify. Account should be gated as unverified until this completes.

### 2.2 Admin creates account with a set password → new user
**Recipient:** the new user (`{{email}}`)
**Content — revised per your note (admin sets the real password, not a placeholder):**
- `{{full_name}}`, welcome to the platform
- Login email: `{{email}}`
- Password: `{{password}}` — the plaintext value, available in `admin.py create_user()` at line 179 before it's hashed at line 189; an email send must happen in that window, using the local variable directly (it is never stored or returned in plaintext anywhere else)
- Role: `{{roleLabel}}` (e.g. "head-of-department — Logistics & Facilities")
- Instruction: log in and change this password to one only you know
- Link to login / change-password page

### 2.3 Cafeteria manager/admin creates staff account inline → new staff member
**Recipient:** the new staff member
**Content:** identical shape to 2.2 — same plaintext-password-in-scope pattern exists in `cafeterias.py _create_staff_account()` (lines 620–651) — plus:
- Cafeteria: `{{cafeteriaName}}`
- Role: `{{roleCode}}` (`cafeteria-manager` / `cafeteria-staff`)

### 2.4 Password reset requested / completed (⚠️ requires new reset flow — you're building the page + email together)
Leaving as a placeholder pair since you said you'll design this alongside the page:
- **Requested:** reset link/token, expiry note
- **Completed:** confirmation, "if this wasn't you" warning with a support/contact path

**Removed per your note:** *"Admin changes a user's password"* — you're not building admin-driven password changes, so this trigger doesn't exist. Only the self-service reset flow (2.4) remains.

### 2.5 Admin changes a user's email → old address (⚠️ requires new masking helper)
**Recipient:** the **old** `{{email}}` (not the new one — this is a security notice, sent where the account owner would actually see it if it's really them)
**Content:**
- `{{full_name}}`, your login email is being changed
- New address, partially masked — e.g. `jo***@domain.com`: no masking utility exists in the codebase today (confirmed — only log-redaction of secrets exists, unrelated), so this is new formatting logic: keep first 2 characters of the local part, mask the rest before `@`, keep the domain in full
- "If you didn't request this, contact [support/admin] immediately"
- No link to undo — this is a notice, not an action

---

## 3. Clubs

### 3.1 Club created, president nominated → new president
**Recipient:** `{{president.email}}`
**Content:**
- `{{president.displayName}}`, you've been made president of `{{name}}`
- Nominated by: `{{createdBy.displayName}}`
- What this role means (brief), link to the club's management page

### 3.2 Club Admin reassigns president → old + new president
**Recipient:** both `{{currentPresident.email}}` and `{{requestedPresident.email}}` (or the direct-reassignment equivalent)
**Content:** two variants —
- To outgoing: "you are no longer president of `{{clubName}}`, reassigned by `{{resolvedBy.displayName}}`"
- To incoming: same shape as 3.1

### 3.3 Join request submitted → club president
**Recipient:** `{{president.email}}` on that club
**Content:**
- `{{requester.displayName}}` (`{{requester.email}}`) wants to join `{{clubName}}`
- Their stated reason: `{{reason}}`
- Action needed: approve or reject

### 3.4 President-change request submitted → club admins
**Recipient:** all club-admin accounts
**Content:**
- `{{clubName}}`: `{{currentPresident.displayName}}` proposes `{{requestedPresident.displayName}}` as successor
- Action needed: approve or reject

### 3.5 President-change approved → outgoing + incoming president
Same shape as 3.2.

---

## 4. Published Events

Revised per your note: **every registrant gets a confirmation/decision email, not just guests** — because it's the definitive record of the outcome regardless of whether they also see it in-app, and rejections/approvals need a reply-able trail.

### 4.1 Registration submitted, pending approval → organiser + co-owners
**Recipient:** the proposal's applicant and each `{{coOwners[].email}}`
**Content:**
- `{{name}}` (`{{email}}`) registered for `{{eventTitle}}`, pending approval
- Their stated reason: `{{reason}}` (manual-approval events)
- Action needed: approve or reject

### 4.2 Registration confirmed → registrant (any registrant, not just guests)
**Recipient:** `{{email}}` on the registration row
**Content:**
- `{{name}}`, you're registered for `{{eventTitle}}`
- Schedule: event's `{{schedule}}`
- If this was a manual approval, thread this as a reply to the original registration email (per your note — match by the registration's email/thread reference) rather than a disconnected new message

### 4.3 Registration rejected → registrant
**Recipient:** `{{email}}` on the registration row
**Content:**
- `{{name}}`, your registration for `{{eventTitle}}` was not approved
- Reason, if the organiser provided one
- Same threading note as 4.2 — reply to the original registration email

### 4.4 Event starting soon → registered attendees (⚠️ requires new scheduler)
**Recipient:** every confirmed registrant on the event
**Timing — per your note: 3 days before the event start**, read from the event's schedule row
**Content:**
- `{{eventTitle}}`, `{{schedule}}` (date/time/location)
- Nothing to action — pure reminder

---

## 5. Cafeterias

Revised per your note: **only send when tied to something that actually exists** — a real cafeteria, a real assignment — never a speculative/placeholder send. In practice this is a scoping rule on trigger conditions, not a new field.

### 5.1 Staff assignment created (new account, inline) → new staff member
**Recipient:** `{{email}}` on the new assignment
**Content:** identical to 2.3 — same account-activation/password email, cafeteria-scoped.
**Guard condition:** only fire if `{{cafeteriaName}}`/`{{cafeteriaCode}}` resolves to an active, existing cafeteria row at send time (skip if the outlet was deleted/deactivated between the request and the send — shouldn't happen synchronously, but worth guarding if sends are ever queued/retried).

**Dropped per your original note:** credential-change security email for cafeteria staff — same reasoning as 2.5 would apply if it's ever built, but you didn't ask for it this round, so leaving it out unless you want it added back.

---

## Open items before implementation

1. **OTP delivery** (2.1) — needs a `otp_code` + expiry column and a verify-code endpoint; not yet modeled anywhere in the backend.
2. **Password-reset flow** (2.4) — you're building this alongside the page; the email content above is a placeholder until that design lands.
3. **Email masking** (2.5) — no existing utility; the `jo***@domain.com` convention above is a proposal, not a confirmed format — flag if you want a different masking rule (e.g. mask domain instead, or show only first/last character).
4. **Reply-threading for registration decisions** (4.2/4.3) — "send the follow-up to it" implies the confirm/reject email should reply into the same thread as the original registration email. That needs a stable `Message-ID`/`References` header saved at send time (4.1) so 4.2/4.3 can reference it — worth confirming your email provider/library supports explicit threading headers before committing to this.
5. **Cafeteria order content** (1.10) — order items/quantities live in the F&B selection data, which wasn't part of this field-verification pass; needs a follow-up read of `request_fmb_selection` before finalizing that email's placeholders.
