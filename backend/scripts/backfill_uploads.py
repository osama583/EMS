"""Fold on-disk uploads into the upload_file table.

The bytes behind /api/v1/uploads/{key} used to live only in backend/var/uploads,
which is gitignored and local to one machine while the database is shared. Run
this wherever those files still exist and their images stop being machine-bound.

    .venv/Scripts/python -m scripts.backfill_uploads            # apply
    .venv/Scripts/python -m scripts.backfill_uploads --dry-run

Idempotent: the key is the file's content hash, so re-running inserts nothing.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import psycopg2

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.api.uploads import _KEY, _MIME_BY_EXTENSION, UPLOAD_DIR  # noqa: E402
from app.db import fetch_one, transaction  # noqa: E402


def run(*, dry_run: bool) -> int:
    files = sorted(p for p in UPLOAD_DIR.glob("*") if p.is_file() and _KEY.match(p.name))
    inserted = skipped = 0
    with transaction() as cur:
        for path in files:
            if fetch_one(cur, "SELECT 1 AS found FROM upload_file WHERE storage_key = %s", (path.name,)):
                skipped += 1
                continue
            print(f"  + {path.name}  {path.stat().st_size:,} bytes")
            inserted += 1
            if dry_run:
                continue
            cur.execute(
                "INSERT INTO upload_file (storage_key, content_type, content) VALUES (%s, %s, %s)",
                (
                    path.name,
                    _MIME_BY_EXTENSION.get(path.suffix, "application/octet-stream"),
                    psycopg2.Binary(path.read_bytes()),
                ),
            )
    verb = "would insert" if dry_run else "inserted"
    print()
    print(f"{len(files)} file(s) in {UPLOAD_DIR}: {verb} {inserted}, already stored {skipped}.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report what would be inserted, write nothing")
    args = parser.parse_args()
    with create_app().app_context():
        raise SystemExit(run(dry_run=args.dry_run))
