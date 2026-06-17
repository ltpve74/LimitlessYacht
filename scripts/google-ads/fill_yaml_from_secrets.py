#!/usr/bin/env python3
"""Copy client_id and client_secret from client_secrets.json into google-ads.yaml."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SECRETS = ROOT / "client_secrets.json"
YAML = ROOT / "google-ads.yaml"
EXAMPLE = ROOT / "google-ads.yaml.example"

PLACEHOLDERS = {
    "INSERT_DEVELOPER_TOKEN",
    "INSERT_OAUTH_CLIENT_ID.apps.googleusercontent.com",
    "INSERT_OAUTH_CLIENT_SECRET",
    "INSERT_REFRESH_TOKEN",
}


def load_installed() -> tuple[str, str, str]:
    data = json.loads(SECRETS.read_text(encoding="utf-8"))
    block = data.get("installed") or data.get("web")
    if not block:
        raise SystemExit(f"{SECRETS} must contain an 'installed' (Desktop) OAuth block.")
    return block["client_id"], block["client_secret"], block.get("project_id", "?")


def upsert_key(lines: list[str], key: str, value: str) -> list[str]:
    prefix = f"{key}:"
    for i, line in enumerate(lines):
        if line.startswith(prefix):
            lines[i] = f"{key}: {value}"
            return lines
    lines.append(f"{key}: {value}")
    return lines


def main() -> None:
    if not SECRETS.is_file():
        raise SystemExit(f"Missing {SECRETS}")

    if not YAML.is_file():
        YAML.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Created {YAML.name} from example.")

    client_id, client_secret, project_id = load_installed()
    lines = YAML.read_text(encoding="utf-8").splitlines()
    lines = upsert_key(lines, "client_id", client_id)
    lines = upsert_key(lines, "client_secret", client_secret)
    YAML.write_text("\n".join(lines) + "\n", encoding="utf-8")

    text = YAML.read_text(encoding="utf-8")
    still = [p for p in PLACEHOLDERS if p in text]
    print(f"Updated client_id and client_secret (Cloud project: {project_id}).")
    if still:
        print("Still required in google-ads.yaml:")
        if "INSERT_DEVELOPER_TOKEN" in text:
            print("  - developer_token  → Google Ads MCC → Tools → API Center")
        if "INSERT_REFRESH_TOKEN" in text:
            print("  - refresh_token    → run: python3 generate_refresh_token.py")
    else:
        print("All placeholders filled. Run: python3 test_connection.py")


if __name__ == "__main__":
    main()