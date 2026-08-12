#!/usr/bin/env python3
"""
Generate a new API key. Prints the raw key ONCE (copy it now -- it's not
recoverable after this) and the SQL to register its hash in the database.

Usage:
    python scripts/make_key.py admin "GitHub Action pipeline"
    python scripts/make_key.py editor "Game editor browser key"
"""
import hashlib
import secrets
import sys


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("admin", "editor"):
        sys.exit('Usage: python make_key.py <admin|editor> ["label"]')
    scope = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else ""

    raw_key = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

    print("=" * 60)
    print(f"RAW KEY (copy this now, it will not be shown again):")
    print(f"  {raw_key}")
    print("=" * 60)
    print()
    print("Run this against your Fly Postgres to register it:")
    print()
    print(
        f"  INSERT INTO api_keys (key_hash, scope, label) "
        f"VALUES ('{key_hash}', '{scope}', '{label}');"
    )
    print()
    print("Then store the RAW KEY as:")
    if scope == "admin":
        print("  - a GitHub Actions secret (e.g. SCHEDULE_API_ADMIN_KEY)")
    else:
        print("  - whatever the editor's Connection Settings panel asks for")


if __name__ == "__main__":
    main()
