-- ============================================================================
-- Migration 014 - drop users.username and cafeteria_staff_requests.payload_username.
--
-- The column never earned its keep: nothing signs in with it (POST /auth/login
-- has always taken an email), every uniqueness rule that matters is already on
-- users.email, and every create path was quietly inventing one from the local
-- part of the address anyway - so it held a derived value that no user chose
-- and no feature read. That left it as a second identifier the admin forms had
-- to collect and the staff-request flow had to diff, for nothing.
--
-- Email is now the single identifier for an account, exactly as
-- 001_initial_schema.sql's own header originally intended ("Dropped the 'add a
-- username column' idea - user_id + email is the login/identity story") before
-- the column was added back.
--
-- Dropping the column takes its UNIQUE constraint with it; users.email keeps
-- its own, so the identity guarantee is unchanged.
-- ============================================================================

ALTER TABLE cafeteria_staff_requests DROP COLUMN IF EXISTS payload_username;

ALTER TABLE users DROP COLUMN IF EXISTS username;
