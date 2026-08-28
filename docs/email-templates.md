# Email Templates

Actual subject and body copy for every email in the notification map, written as real correspondence. Placeholders are written as `{{field.name}}` — the exact backend field names from [email-notifications-plan.md](email-notifications-plan.md). Plain text here; convert to HTML later without changing the wording.

---

## 1. Proposal / Event-Approval Workflow

### 1.1 Proposal submitted → first-stage reviewer

**Subject:** Action required: review "{{eventTitle}}" ({{proposalId}})

```
Dear {{reviewer.full_name}},

A new event proposal has been submitted and is awaiting your review.

{{applicant}} of {{applicantDepartment}} has submitted "{{eventTitle}}" (reference {{proposalId}}), scheduled for {{schedule}}.

Please review the proposal at your earliest convenience and approve it, reject it, or return it for changes.

Review the proposal: {{proposal.link}}

Regards,
{{platform.name}}
```

### 1.2 Reviewer approves → next reviewer

**Subject:** Action required: review "{{eventTitle}}" ({{proposalId}})

```
Dear {{reviewer.full_name}},

The proposal "{{eventTitle}}" (reference {{proposalId}}), submitted by {{applicant}} of {{applicantDepartment}}, has cleared the previous stage of review and now requires your approval.

Scheduled for: {{schedule}}

Please review the proposal and approve it, reject it, or return it for changes.

Review the proposal: {{proposal.link}}

Regards,
{{platform.name}}
```

### 1.3 Reviewer rejects → applicant

**Subject:** Your proposal "{{eventTitle}}" was not approved

```
Dear {{applicant}},

We are writing to let you know that your event proposal "{{eventTitle}}" (reference {{proposalId}}) was not approved.

Reviewer's comments:
{{workflow.reviewerComment}}

This decision is final and no further action can be taken on this proposal. If you would like to run this event, please submit a new proposal that addresses the feedback above.

View the proposal: {{proposal.link}}

Regards,
{{platform.name}}
```

### 1.4 Reviewer sends back → applicant

**Subject:** Changes requested for "{{eventTitle}}"

```
Dear {{applicant}},

Your event proposal "{{eventTitle}}" (reference {{proposalId}}) has been reviewed and requires changes before it can proceed.

Reviewer's comments:
{{workflow.reviewerComment}}

Please update your proposal and resubmit it for review.

Edit and resubmit: {{proposal.resubmit_link}}

Regards,
{{platform.name}}
```

### 1.5 Department task created → department head

**Subject:** Action required: {{requirement_name}} for "{{eventTitle}}"

```
Dear {{departmentHead.full_name}},

The event "{{eventTitle}}" (reference {{proposalCode}}), submitted by {{applicant}}, requires {{assigned_unit_description}}'s approval for the following requirement:

{{requirement_name}}

The event is scheduled for {{schedule}}. Please review this requirement and approve it, reject it, or return it for changes.

Review the requirement: {{task.link}}

Regards,
{{platform.name}}
```

### 1.6 Department task sent back → applicant

**Subject:** Changes requested by {{assigned_unit_description}} for "{{eventTitle}}"

```
Dear {{applicant}},

{{assigned_unit_description}} has reviewed the {{requirement_name}} requirement for your event "{{eventTitle}}" and has requested changes before it can be approved.

Their comments:
{{comment}}

This affects only the {{requirement_name}} requirement — no other departments are involved, and their reviews are unaffected. Please update this requirement and resubmit it.

Edit and resubmit: {{task.resubmit_link}}

Regards,
{{platform.name}}
```

### 1.7 Final department task approved → applicant + co-owners (event confirmed)

**Subject:** Your event "{{eventTitle}}" is confirmed

```
Dear {{applicant}},

We are pleased to confirm that "{{eventTitle}}" (reference {{proposalId}}) has been approved by every department involved and is now fully confirmed.

Scheduled for: {{schedule}}

No further action is required on your part. We wish you a successful event.

View the event: {{proposal.link}}

Regards,
{{platform.name}}
```

*(The same message is sent to each co-owner listed in `{{coOwners}}`, addressed to `{{coOwners[].name}}`.)*

### 1.8 Applicant resubmits (whole proposal) → reviewer at resume stage

**Subject:** Resubmission for review: "{{eventTitle}}" ({{proposalId}})

```
Dear {{reviewer.full_name}},

{{applicant}} has resubmitted the proposal "{{eventTitle}}" (reference {{proposalId}}) after addressing the changes previously requested.

Scheduled for: {{schedule}}

Please review the updated proposal and approve it, reject it, or return it for further changes.

Review the proposal: {{proposal.link}}

Regards,
{{platform.name}}
```

### 1.9 Applicant resubmits single department task → that department head only

**Subject:** Resubmission for review: {{requirement_name}} for "{{eventTitle}}"

```
Dear {{departmentHead.full_name}},

{{applicant}} has resubmitted the {{requirement_name}} requirement for "{{eventTitle}}" after addressing the changes previously requested by {{assigned_unit_description}}.

Please review the update and approve it, reject it, or return it for further changes.

Review the requirement: {{task.link}}

Regards,
{{platform.name}}
```

### 1.10 F&B places cafeteria order → cafeteria manager(s)

**Subject:** Action required: new order for "{{eventTitle}}"

```
Dear {{cafeteriaManager.full_name}},

A new food and beverage order has been placed for the upcoming event "{{eventTitle}}" (reference {{proposalId}}).

Order details:
{{order.items}}

Please review this order and approve it or return it for changes.

Review the order: {{order.link}}

Regards,
{{platform.name}}
```

### 1.11 Applicant cancels proposal → everyone holding an open task

**Subject:** "{{eventTitle}}" has been cancelled

```
Dear {{recipient.full_name}},

{{applicant}} has cancelled the event "{{eventTitle}}" (reference {{proposalId}}). Your pending item on this event, {{requirement_name_or_order}}, is no longer required.

No further action is needed on your part.

Regards,
{{platform.name}}
```

---

## 2. Auth & Accounts

### 2.1a Guest self-registers → welcome

**Subject:** Welcome to {{platform.name}}

```
Dear {{full_name}},

Thank you for creating an account with {{platform.name}}.

Before you can sign in, we need to verify your email address. We've sent a separate email containing your verification code — please enter it in the app to activate your account.

Regards,
{{platform.name}}
```

### 2.1b Guest self-registers → OTP verification

**Subject:** Your verification code

```
Dear {{full_name}},

Please use the following code to verify your email address and activate your account:

{{otp_code}}

This code will expire in {{otp_expiry_minutes}} minutes.

If you did not create this account, please disregard this email.

Regards,
{{platform.name}}
```

### 2.2 Admin creates account with a set password → new user

**Subject:** Your {{platform.name}} account has been created

```
Dear {{full_name}},

An account has been created for you on {{platform.name}} with the role of {{roleLabel}}.

Your login details are below:

Email: {{email}}
Temporary password: {{password}}

For your security, please sign in and change this password as soon as possible.

Sign in: {{login.link}}

Regards,
{{platform.name}}
```

### 2.3 Cafeteria staff account created inline → new staff member

**Subject:** Your {{cafeteriaName}} staff account has been created

```
Dear {{full_name}},

An account has been created for you at {{cafeteriaName}} with the role of {{roleCode}}.

Your login details are below:

Email: {{email}}
Temporary password: {{password}}

For your security, please sign in and change this password as soon as possible.

Sign in: {{login.link}}

Regards,
{{platform.name}}
```

### 2.4a Password reset requested

**Subject:** Reset your password

```
Dear {{full_name}},

We received a request to reset the password for your {{platform.name}} account. Click the link below to choose a new password. This link will expire in {{reset.expiry_minutes}} minutes.

Reset your password: {{reset.link}}

If you did not request a password reset, you can safely disregard this email — your password will remain unchanged.

Regards,
{{platform.name}}
```

### 2.4b Password reset completed

**Subject:** Your password has been changed

```
Dear {{full_name}},

This is a confirmation that the password for your {{platform.name}} account was successfully changed.

If you did not make this change, please contact {{support.contact}} immediately.

Regards,
{{platform.name}}
```

### 2.5 Admin changes a user's email → old address

**Subject:** Your account email address is being changed

```
Dear {{full_name}},

We are writing to let you know that the login email address for your {{platform.name}} account is being changed from this address to {{new_email_masked}}.

If you did not request this change, please contact {{support.contact}} immediately.

Regards,
{{platform.name}}
```

*(`{{new_email_masked}}` keeps the first two characters of the new address before masking the remainder — for example, `jo***@apu.edu.my`.)*

---

## 3. Clubs

### 3.1 Club created, president nominated → new president

**Subject:** You have been appointed President of {{name}}

```
Dear {{president.displayName}},

{{createdBy.displayName}} has appointed you President of {{name}}.

As President, you are responsible for reviewing membership requests and managing the club. You can access these tools from your dashboard.

Manage your club: {{club.link}}

Regards,
{{platform.name}}
```

### 3.2a President reassigned → outgoing president

**Subject:** Your role as President of {{clubName}} has ended

```
Dear {{currentPresident.displayName}},

We are writing to let you know that {{resolvedBy.displayName}} has reassigned the role of President of {{clubName}} to {{requestedPresident.displayName}}.

Thank you for your service in this role.

Regards,
{{platform.name}}
```

### 3.2b President reassigned → incoming president

**Subject:** You have been appointed President of {{clubName}}

```
Dear {{requestedPresident.displayName}},

{{resolvedBy.displayName}} has appointed you President of {{clubName}}.

As President, you are responsible for reviewing membership requests and managing the club. You can access these tools from your dashboard.

Manage your club: {{club.link}}

Regards,
{{platform.name}}
```

### 3.3 Join request submitted → club president

**Subject:** New membership request for {{clubName}}

```
Dear {{president.displayName}},

{{requester.displayName}} ({{requester.email}}) has requested to join {{clubName}}.

Their stated reason for joining:
{{reason}}

Please review this request and approve or reject it.

Review the request: {{joinRequest.link}}

Regards,
{{platform.name}}
```

### 3.4 President-change request submitted → club admins

**Subject:** President-change request for {{clubName}}

```
Dear Club Admin,

{{currentPresident.displayName}}, President of {{clubName}}, has proposed {{requestedPresident.displayName}} as their successor.

Please review this request and approve or reject it.

Review the request: {{presidentChangeRequest.link}}

Regards,
{{platform.name}}
```

### 3.5a President-change approved → outgoing president

Same as 3.2a.

### 3.5b President-change approved → incoming president

Same as 3.2b.

---

## 4. Published Events

### 4.1 Registration submitted, pending approval → organiser + co-owners

**Subject:** New registration pending your approval — {{eventTitle}}

```
Dear {{organiser.name}},

{{name}} ({{email}}) has registered for "{{eventTitle}}" and is awaiting your approval.

Their stated reason:
{{reason}}

Please review this registration and approve or reject it.

Review the registration: {{registration.link}}

Regards,
{{platform.name}}
```

### 4.2 Registration confirmed → registrant

**Subject:** Your registration for "{{eventTitle}}" is confirmed

```
Dear {{name}},

We are pleased to confirm your registration for "{{eventTitle}}".

Scheduled for: {{schedule}}

We look forward to seeing you there.

Regards,
{{platform.name}}
```

*(Sent as a reply within the same thread as 4.1 for events requiring manual approval.)*

### 4.3 Registration rejected → registrant

**Subject:** Update on your registration for "{{eventTitle}}"

```
Dear {{name}},

We regret to inform you that your registration for "{{eventTitle}}" was not approved.

Reason: {{decision.reason}}

Regards,
{{platform.name}}
```

*(Sent as a reply within the same thread as 4.1.)*

### 4.4 Event starting soon → registered attendees

**Subject:** Reminder: "{{eventTitle}}" is in 3 days

```
Dear {{name}},

This is a reminder that "{{eventTitle}}", which you are registered for, will take place in three days.

Scheduled for: {{schedule}}

We look forward to seeing you there.

Regards,
{{platform.name}}
```

---

## 5. Cafeterias

### 5.1 Staff assignment created (new account, inline) → new staff member

Same as 2.3.

---

## Notes

- Tokens map to the exact backend field names verified in [email-notifications-plan.md](email-notifications-plan.md). Anything not in that document — `{{platform.name}}`, `{{support.contact}}`, and every `*.link` URL — is application configuration rather than a database field, and needs a defined value wherever templates are rendered.
- The greeting field differs by object type on purpose, not by oversight: `{{full_name}}` for user/account records, `{{displayName}}` for club-role records, `{{name}}` for event registrants — each reflects a different underlying schema.
- Sign-off is a fixed `{{platform.name}}` throughout — swap in your actual product/organisation name once decided.
