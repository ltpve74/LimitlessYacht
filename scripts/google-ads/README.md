# Google Ads API setup (Limitless)

Account reference:

| Role | ID |
|------|-----|
| MCC (login) | `813-599-5268` → `8135995268` in config |
| Limitless Ads account | `986-598-0331` → `9865980331` in API calls |
| Login email | `info@limitlessyachtcharter.com` |

## Phase 1 — Developer token (MCC)

1. Sign in at [Google Ads](https://ads.google.com) with the **MCC** (`813-599-5268`), not only the client account.
2. **Tools & settings** (wrench) → **Setup** → **API Center**.
3. Apply for **API access** if prompted. Use case: *manage own advertising accounts*.
4. Copy the **developer token** (starts as **Test** access — enough for accounts under your MCC).

## Phase 2 — Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create project e.g. `limitless-google-ads`.
3. **APIs & Services** → **Library** → enable **Google Ads API**.
4. **OAuth consent screen**:
   - User type: **External** (or Internal if Workspace).
   - Add your email as test user.
   - Scope: `https://www.googleapis.com/auth/adwords` (Google Ads API).
5. **Credentials** → **Create credentials** → **OAuth client ID**:
   - Type: **Desktop app** (simplest for refresh token).
   - Download JSON → save as `scripts/google-ads/client_secrets.json` (gitignored).

## Phase 3 — Refresh token (one time)

```bash
cd "scripts/google-ads"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 generate_refresh_token.py
```

- Browser opens → sign in as `info@limitlessyachtcharter.com`.
- Approve access → terminal prints `refresh_token`.

## Phase 4 — Config file

```bash
cp google-ads.yaml.example google-ads.yaml
```

Edit `google-ads.yaml`: paste developer token, client_id, client_secret, refresh_token. Keep `login_customer_id: 8135995268`.

## Phase 5 — Test

```bash
python3 test_connection.py
```

You should see customer `9865980331` listed. Tell your agent when this works; we can add campaign scripts next.

## Security

Never commit: `google-ads.yaml`, `client_secrets.json`, `.venv/`

## Test vs Production token

- **Test** token: works for accounts under your MCC immediately.
- **Basic/Standard** access: apply in API Center after you have API usage; needed for high volume, not for managing your own account day to day.