# Tracker: always publish to production (owner rule)

**Standing order (reconfirmed 2026-07-30):** for any **Limitless Tracker** work
(`tracker/**`, `netlify/functions/tracker*.mjs`, `netlify/functions/lib/*` used by the
tracker, `scripts/test-tracker*.mjs`, related API), **always finish by publishing to
`main`** so the owner can check live. Do **not** leave tracker fixes only on
`develop` / local / “say if you want publish”.

## Required end-of-task flow

1. Work + commit on **`develop`**
2. `git push origin develop`
3. **Publish without asking:**
   - `git checkout main && git pull origin main`
   - `git merge develop` (dev wins on conflicts)
   - `git commit -m "Publish: …"` (or allow-empty if merge already committed) — pre-commit minifies + publish gate
   - `git push origin main`
4. Return to `develop`
5. Tell the owner it’s live (~60s Netlify) and to hard-refresh the tracker

## Why

The tracker is the owner’s day-to-day ops app. They verify on production, not
GitHub Pages. Waiting for an extra “publish?” step blocks them.

## Scope exception vs marketing site

- **Tracker changes** → auto-publish to `main` (this file).
- **Marketing site only** (index.html, css/, i18n, images for the public site) →
  still push `develop` for preview; **do not** push `main` unless they ask to go live
  (see `no-auto-push.md` / `auto-push-preview.md`).
- Mixed PR that includes **any tracker path** → treat as tracker: publish to `main`.

## Do not

- End a tracker turn with “on develop only — say if you want main”
- Skip the publish gate (let the main pre-commit run; it’s slow on purpose)
