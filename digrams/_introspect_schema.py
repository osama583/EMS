"""Read-only schema introspection for the ERD figure. Prints JSON to stdout.

Temporary tooling for docs/diagrams — no application code depends on it.
Emits table names, columns (with PK/FK/nullable), and foreign-key edges.
Never prints connection strings or row data.
"""
from __future__ import annotations

import json
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "backend"))

from app.db import init_pool, query  # noqa: E402

TABLES = """
SELECT c.relname AS table_name,
       (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS n_cols
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname
"""

COLUMNS = """
SELECT c.table_name, c.column_name, c.ordinal_position, c.data_type,
       c.is_nullable, c.character_maximum_length
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position
"""

PKS = """
SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY tc.table_name, kcu.ordinal_position
"""

FKS = """
SELECT tc.table_name AS src_table, kcu.column_name AS src_column,
       ccu.table_name AS ref_table, ccu.column_name AS ref_column,
       tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, kcu.column_name
"""

UNIQUES = """
SELECT tc.table_name, kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
WHERE tc.table_schema = 'public' AND tc.constraint_type = 'UNIQUE'
ORDER BY tc.table_name, kcu.column_name
"""


def main() -> None:
    init_pool()
    out = {
        "tables": query(TABLES),
        "columns": query(COLUMNS),
        "primary_keys": query(PKS),
        "foreign_keys": query(FKS),
        "uniques": query(UNIQUES),
    }
    print(json.dumps(out, default=str))


if __name__ == "__main__":
    main()
