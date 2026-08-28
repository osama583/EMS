-- ============================================================================
-- Migration 020 - Guest self-registration email verification.
--
-- Registration is two steps: POST /auth/register/start stages the submitted
-- form and emails a 6-digit code; POST /auth/register/verify checks it and
-- only THEN creates the users row. Nothing is written to `users` until the
-- code is confirmed, so an abandoned or never-verified attempt never becomes
-- an account. otp_hash is bcrypt, same as a real password - a leaked row
-- must not hand out working codes. One challenge per email at a time; a
-- second attempt replaces the first rather than stacking (see
-- uq_registration_challenge_email below).
-- ============================================================================

CREATE TABLE registration_challenge (
    registration_challenge_id  BIGSERIAL PRIMARY KEY,
    email                       VARCHAR(255) NOT NULL,
    otp_hash                    VARCHAR(255) NOT NULL,
    attempts                    INT NOT NULL DEFAULT 0,
    payload                     JSONB NOT NULL,  -- firstName/lastName/age/gender/password (password hashed already)
    created_at                  TIMESTAMP NOT NULL DEFAULT now(),
    expires_at                  TIMESTAMP NOT NULL
);

-- One live challenge per email; starting again replaces it rather than piling up.
CREATE UNIQUE INDEX uq_registration_challenge_email ON registration_challenge (lower(email));

-- Sweeping expired rows (a scheduled cleanup, or just filtered out at read
-- time) scans this.
CREATE INDEX ix_registration_challenge_expires ON registration_challenge (expires_at);
