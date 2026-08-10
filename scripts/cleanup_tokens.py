#!/usr/bin/env python3
"""Remove expired and long-revoked authentication tokens."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg2


DEFAULT_ENV_FILE = Path("/opt/ai-consulting-center/.env")


def load_database_url(env_file: Path) -> str:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if database_url:
        return database_url

    try:
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line.startswith("DATABASE_URL="):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if value:
                    return value
    except FileNotFoundError:
        pass

    raise RuntimeError(
        "DATABASE_URL is required in the environment or the configured env file"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    database_url = load_database_url(args.env_file)
    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM active_token
                WHERE expires_at < NOW() - INTERVAL '7 days'
                   OR (
                     revoked_at IS NOT NULL
                     AND revoked_at < NOW() - INTERVAL '30 days'
                   )
                """
            )
            deleted = cursor.rowcount
            cursor.execute(
                """
                SELECT
                  COUNT(*) FILTER (
                    WHERE revoked_at IS NULL AND expires_at > NOW()
                  ) AS active,
                  COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked,
                  COUNT(*) AS total
                FROM active_token
                """
            )
            active, revoked, total = cursor.fetchone()

        if args.dry_run:
            connection.rollback()

    mode = "dry-run" if args.dry_run else "committed"
    print(
        f"token_cleanup={mode} deleted={deleted} "
        f"active={active} revoked={revoked} total={total}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
