"""One function per notification trigger — see docs/email-notifications-plan.md
and docs/email-templates.md for the full design (recipient, purpose, copy).

Every function here takes plain values (never a raw DB row or a Flask
request), builds the email via `render.py`, and sends it via `client.send()`.
Callers just import the function for what happened and call it — they never
touch HTML or SMTP directly. All calls are safe to fire after a commit
succeeds; failures are logged, never raised (see client.send docstring).

Functions marked "not wired up" build a complete, correct email but have no
caller yet because the backend flow that would trigger them doesn't exist —
see the docstring on each for what's missing.
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


def proposal_fully_approved_all(*, proposal: dict) -> None:
    """1.7, fanned out to the applicant plus every co-owner in one call.
    `proposal` is a services.proposals.project()-shaped dict (needs
    applicant/applicantEmail/proposalId/eventTitle/schedule/coOwners)."""
    recipients = [{"name": proposal["applicant"], "email": proposal["applicantEmail"]}]
    recipients.extend({"name": co["name"], "email": co["email"]} for co in proposal.get("coOwners", []))
    for recipient in recipients:
        proposal_fully_approved(
            recipient_email=recipient["email"],
            recipient_name=recipient["name"],
            proposal_id=proposal["proposalId"],
            event_title=proposal["eventTitle"],
            schedule=proposal["schedule"],
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
