-- ============================================================================
-- Migration 021 - Forgot-password reset tokens.
--
-- A reset link carries an opaque token (never the user_id) whose HASH is
-- stored here - the same principle as registration_challenge.otp_hash: a
-- leaked row must not hand out a usable token. 10-minute expiry, single use
-- (deleted on successful reset). One live token per user at a time; a new
-- request replaces the old one rather than stacking, so an old, forgotten
-- link can never be used after a newer one was issued.
-- ============================================================================

CREATE TABLE password_reset_token (
    password_reset_token_id  BIGSERIAL PRIMARY KEY,
    user_id                   BIGINT NOT NULL REFERENCES users(user_id),
    token_hash                VARCHAR(255) NOT NULL,
    created_at                TIMESTAMP NOT NULL DEFAULT now(),
    expires_at                TIMESTAMP NOT NULL
);

-- One live reset request per user at a time.
CREATE UNIQUE INDEX uq_password_reset_token_user ON password_reset_token (user_id);

CREATE INDEX ix_password_reset_token_expires ON password_reset_token (expires_at);
