#!/usr/bin/env python3
"""Verify Google Ads API credentials and list accessible customer accounts."""

from __future__ import annotations

from pathlib import Path

from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

CONFIG = Path(__file__).resolve().parent / "google-ads.yaml"
LIMITLESS_CUSTOMER_ID = "9865980331"


def main() -> None:
    if not CONFIG.is_file():
        raise SystemExit(
            f"Missing {CONFIG}\nCopy google-ads.yaml.example → google-ads.yaml and fill in values."
        )

    client = GoogleAdsClient.load_from_storage(str(CONFIG))
    ga_service = client.get_service("GoogleAdsService")

    query = """
        SELECT
          customer_client.id,
          customer_client.descriptive_name,
          customer_client.manager,
          customer_client.status
        FROM customer_client
        WHERE customer_client.level <= 1
    """

    login_id = client.login_customer_id
    print(f"Login customer (MCC): {login_id}\nAccessible accounts:\n")

    try:
        response = ga_service.search(customer_id=str(login_id), query=query)
        for row in response:
            cc = row.customer_client
            marker = " ← Limitless" if str(cc.id) == LIMITLESS_CUSTOMER_ID else ""
            print(f"  {cc.id}  {cc.descriptive_name}  manager={cc.manager}  {cc.status}{marker}")
        print("\nAPI connection OK.")
    except GoogleAdsException as ex:
        print(f"Request failed: {ex.failure.errors[0].message}")
        raise SystemExit(1) from ex


if __name__ == "__main__":
    main()