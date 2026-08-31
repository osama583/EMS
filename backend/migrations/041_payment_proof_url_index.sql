-- ============================================================================
-- Migration 041 - index the column that decides whether a file is private.
--
-- GET /uploads/{key} now asks "is this key cited by any registration as its
-- payment proof?" before serving, because that is what separates somebody's
-- bank receipt from an event image the landing page shows to guests.
--
-- That question is asked on the PUBLIC path too: an event image is only known
-- to be public once the lookup comes back empty. So it runs once per image on
-- a page full of event cards, and without an index each of those is a
-- sequential scan of every registration ever made.
--
-- Partial, because only a row that HAS a proof can ever match. Most
-- registrations are for free events and carry NULL here, so the index covers a
-- fraction of the table and stays small as registrations accumulate.
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_event_registration_payment_proof_url
    ON event_registration (payment_proof_url)
 WHERE payment_proof_url IS NOT NULL;
