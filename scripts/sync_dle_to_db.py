#!/usr/bin/env python3
"""Synchronize curated DLE Markdown files into the knowledge database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg2


DEFAULT_DLE_ROOT = Path(
    "/opt/digital_life_engine/03_knowledge/topics/AI认证知识库"
)
DEFAULT_ENV_FILE = Path("/opt/ai-consulting-center/.env")
DEFAULT_COMPANY_ID = "00000000-0000-0000-0000-000000000001"

UPSERT_SQL = """
    INSERT INTO knowledge_document (
      company_id,
      doc_code,
      title,
      category,
      file_path,
      file_type,
      file_size,
      content_text,
      source,
      business_value,
      status,
      created_at,
      updated_at
    )
    VALUES (
      %s, %s, %s, %s, %s, 'markdown', %s, %s,
      'DLE 知识库', 'high', 'active', NOW(), NOW()
    )
    ON CONFLICT (company_id, doc_code) DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      file_path = EXCLUDED.file_path,
      file_size = EXCLUDED.file_size,
      content_text = EXCLUDED.content_text,
      updated_at = NOW()
"""


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


def document_values(root: Path, file_path: Path, company_id: str):
    text = file_path.read_text(encoding="utf-8").replace("\x00", "")
    if len(text.strip()) < 50:
        return None

    relative_path = file_path.relative_to(root).as_posix()
    relative_without_suffix = relative_path.removesuffix(".md")
    doc_code = f"DLE-{relative_without_suffix.replace('/', '_')}"
    category = relative_path.split("/", 1)[0]
    return (
        company_id,
        doc_code,
        file_path.stem,
        category,
        str(file_path),
        file_path.stat().st_size,
        text[:50_000],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(os.environ.get("DLE_ROOT", str(DEFAULT_DLE_ROOT))),
    )
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument(
        "--company-id",
        default=os.environ.get("COMPANY_ID", DEFAULT_COMPANY_ID),
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.root.is_dir():
        raise RuntimeError(f"DLE root does not exist: {args.root}")
    if args.limit is not None and args.limit < 1:
        raise RuntimeError("--limit must be at least 1")

    files = sorted(args.root.rglob("*.md"))
    if args.limit is not None:
        files = files[: args.limit]

    database_url = load_database_url(args.env_file)
    imported = 0
    skipped = 0
    failed = 0

    with psycopg2.connect(database_url) as connection:
        with connection.cursor() as cursor:
            for index, file_path in enumerate(files):
                savepoint = f"sync_document_{index}"
                cursor.execute(f"SAVEPOINT {savepoint}")
                try:
                    values = document_values(args.root, file_path, args.company_id)
                    if values is None:
                        skipped += 1
                    else:
                        cursor.execute(UPSERT_SQL, values)
                        imported += 1
                    cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
                except Exception as error:
                    cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                    cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
                    failed += 1
                    print(f"sync_error file={file_path.name} error={error}")

            cursor.execute("SELECT COUNT(*) FROM knowledge_document")
            total_documents = cursor.fetchone()[0]

        if args.dry_run:
            connection.rollback()

    mode = "dry-run" if args.dry_run else "committed"
    print(
        f"dle_sync={mode} scanned={len(files)} imported={imported} "
        f"skipped={skipped} failed={failed} "
        f"knowledge_documents={total_documents}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
