---
name: no-auto-push
description: Git push workflow preference — production vs preview
metadata:
  node_type: memory
  type: feedback
---

**Preview (`develop`):** always push — see [auto-push-preview.md](auto-push-preview.md). The user wants GitHub Pages preview updated without having to ask.

**Production (`main`) — marketing site:** do not push unless the user explicitly asks to go live / publish. Merging to `main` triggers the Netlify deploy and publish gate (~1 min+).

**Production (`main`) — Tracker exception:** always publish. See **[tracker-always-push-live.md](tracker-always-push-live.md)**. Any work under `tracker/` (or tracker Netlify functions) must end with merge + Publish commit + `git push origin main` so the owner can check live. Do not wait for them to ask.

**How to apply:** commit as work progresses; when a change set is done and tests pass, `git push origin develop` automatically. For marketing-only work, only offer the `develop` → `main` publish flow when the user requests production. For tracker work, publish to `main` every time.
