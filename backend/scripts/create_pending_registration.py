"""Creates the pending_registration table used by the guest signup OTP flow.

Idempotent - safe to run more than once. The project applies schema changes as
numbered migrations against the Supabase database; the .sql files are not kept
in the repo, so this script carries the DDL for the one table POST
/auth/register/start needs and records itself in schema_migrations the same way.

    python -m scripts.create_pending_registration

A row here is a signup that has been submitted but NOT yet verified: no users
row exists until the emailed code is confirmed, so an abandoned signup leaves
nothing behind but an expired row, and an address is only really taken once it
has been proven to belong to someone.
"""
from __future__ import annotations

import hashlib

from dotenv import load_dotenv

load_dotenv()

from app.db import init_pool, transaction  # noqa: E402

MIGRATION_NAME = "047_pending_registration.sql"

DDL = """
CREATE TABLE IF NOT EXISTS pending_registration (
    pending_registration_id BIGSERIAL PRIMARY KEY,
    challenge_id     VARCHAR(64)  NOT NULL UNIQUE,
    email            VARCHAR(255) NOT NULL,
    full_name        VARCHAR(255) NOT NULL,
    password_hash    VARCHAR(255) NOT NULL,
    age              INTEGER,
    gender           VARCHAR(64),
    otp_hash         VARCHAR(255) NOT NULL,
    attempts         INTEGER      NOT NULL DEFAULT 0,
    last_sent_at     TIMESTAMP    NOT NULL DEFAULT now(),
    created_at       TIMESTAMP    NOT NULL DEFAULT now(),
    expires_at       TIMESTAMP    NOT NULL
);

-- One live signup per address: starting again replaces the previous attempt
-- rather than leaving several codes valid at once.
CREATE UNIQUE INDEX IF NOT EXISTS pending_registration_email_key
    ON pending_registration (lower(email));

-- The expiry sweep in register_start() runs on every call.
CREATE INDEX IF NOT EXISTS pending_registration_expires_at_idx
    ON pending_registration (expires_at);
"""


def main() -> None:
    init_pool()
    with transaction() as cur:
        cur.execute(DDL)
        cur.execute(
            "INSERT INTO schema_migrations (filename, checksum) VALUES (%s, %s) "
            "ON CONFLICT (filename) DO NOTHING",
            (MIGRATION_NAME, hashlib.sha256(DDL.encode("utf-8")).hexdigest()),
        )
    print(f"pending_registration is present; {MIGRATION_NAME} recorded.")


if __name__ == "__main__":
    main()
