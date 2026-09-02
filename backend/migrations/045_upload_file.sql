-- ============================================================================
-- Migration 045 - upload_file: store an uploaded file's BYTES, not just a URL.
--
-- request.event_image (and event_registration.payment_proof_url) hold a
-- /api/v1/uploads/{key} pointer, but the bytes lived only in backend/var/uploads,
-- which is gitignored and local to one machine. The database is shared and
-- remote, so the pointer travelled and the file did not: every checkout that had
-- not itself performed the upload resolved every stored image to a 404, and a
-- reopened proposal - draft, resubmission, ongoing or history - showed a broken
-- image with no way to recover it.
--
-- Bytes belong with the row that references them. Keyed by the same
-- content-addressed storage_key the URL already carries, so the URL contract
-- does not change - only where serve() reads from.
--
-- content_type is stored rather than re-derived from the key's extension: it is
-- what the upload actually verified the file's magic bytes against.
-- ============================================================================

CREATE TABLE IF NOT EXISTS upload_file (
    storage_key  VARCHAR(64)  PRIMARY KEY,
    content_type VARCHAR(64)  NOT NULL,
    content      BYTEA        NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
