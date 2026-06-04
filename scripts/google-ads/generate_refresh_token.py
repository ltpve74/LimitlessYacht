#!/usr/bin/env python3
"""One-time OAuth flow: opens browser, prints refresh token for google-ads.yaml."""

from __future__ import annotations

import argparse
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPE = ["https://www.googleapis.com/auth/adwords"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Google Ads API refresh token")
    parser.add_argument(
        "--client-secrets",
        default=str(Path(__file__).resolve().parent / "client_secrets.json"),
        help="Path to OAuth client JSON from Google Cloud Console",
    )
    args = parser.parse_args()

    flow = InstalledAppFlow.from_client_secrets_file(args.client_secrets, scopes=SCOPE)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
    print("\n--- Add this to google-ads.yaml ---\n")
    print(f"refresh_token: {creds.refresh_token}\n")
    print("Store it locally only. Do not commit google-ads.yaml or client_secrets.json.\n")


if __name__ == "__main__":
    main()