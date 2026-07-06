---
name: project-google-ads
description: Google Ads API integration plan for Limitless Yacht Charter — campaign creation, performance reporting, and iterative optimization
metadata:
  type: project
---

User is building a Google Ads API integration for limitlessyachtcharter.com, not just a one-time setup. The goal is ongoing programmatic campaign management — read performance data, then iterate (adjust bids, budgets, keywords, ad copy) based on results.

**Why:** They want faster iteration than the UI allows, and want Claude to help analyze results and apply changes over time.

**How to apply:** When helping with Google Ads work, always build for iteration — scripts should read before they write, and optimization logic should be data-driven. Treat this as an ongoing system, not a one-off setup.

Campaign brief is in `google-ads-campaign-brief.md`. API setup steps were given (MCC → developer token → GCP OAuth → refresh token → google-ads.yaml).

API setup scaffold: `scripts/google-ads/` (README, generate_refresh_token.py, test_connection.py, google-ads.yaml.example). User started guided setup June 2026.

## Live account facts (manual UI build, June 2026)
- Google Ads account: 986-598-0331 (under "Limitless Manager" MCC 813-599-5268)
- Login: info@limitlessyachtcharter.com
- Campaign "limitless search campaign 1" — Search, 17 markets, Presence targeting, EN+DE, Max Clicks. Daily budget **€10/day** (user updated from €5 smoke test; brief still targets €50 when scaling). One ad group ("Ad group 1" = Day Charter EN, exact+phrase keywords). 18-24 age excluded. 5 audience segments in Observation.
- Old leftover "Campaign #1" (Performance Max, paused) — candidate for deletion.
- Site has GTM-NN8V25BR + Google tag (Enhanced Conversions on); Consent Mode v2 default-denied until consent.

## Conversion tracking
- Conversion ID: AW-18209943491
- "Lead form submission" label: Pd-9CKDt7rgcEMPflutD (Primary, value €300, count One)
- "whatsapp click" label: CkJfCKPt7rgcEMPflutD (Primary, value €150, count One)
- Chosen install method: Google Tag Manager (GTM container already on site).

## Conversion tracking STATUS: LIVE (verified via Tag Assistant, events fire)
- Built/installed by user's web developer (user lacked direct edit access to GTM-NN8V25BR container; cookie banner copy updated to mention "measure conversions (including Google Ads)").
- Both "Contact" and "Submit lead form" goals are now Account-default.
- OUTSTANDING QA: confirm form conversion fires ONLY on submit (not page load) and WhatsApp only on click — flagged to user.
- Note: could not verify from Claude side (WebFetch strips scripts; Chrome connector locked to ads.google.com only — blocked tagmanager + the live site).

## STATUS: CAMPAIGN LIVE — daily budget €10/day (updated from €5 smoke test, June 2026)
Still on Maximize Clicks (too low for reliable conversion bidding). Assess after ~1–2 weeks: impressions, CTR, CPL, real form/WhatsApp conversions. Conversion tracking verified firing correctly (only cosmetic double-fire remains for dev cleanup).

## Outstanding to-dos
- Scale toward €50/day per brief once CPL/lead quality look acceptable at €10/day
- Dev: fix conversion double-fire (each fires 2x; Count=One dedupes so non-urgent)
- Make "Contact" goal account-default (so WhatsApp feeds bidding once on conversion bidding) — non-urgent
- Add 3 more ad groups (Day-DE, Week-EN, Week-DE)
- Rename "Ad group 1" -> "Day Charter – English"
- Delete leftover "Campaign #1"
- Conversion tracking GTM build (above)
- Note: Google Ads conversion pages hang in the Claude-in-Chrome automated session (ad-blocker false positive); GTM domain may be fine.

## Manual-entry reference docs in project root
- google-ads-manual-entry.md (per-screen paste-ready), google-ads-campaign-brief.md
