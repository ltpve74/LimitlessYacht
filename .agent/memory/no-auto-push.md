---
name: no-auto-push
description: Git push workflow preference — do not push without explicit agreement
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b62144d-44dd-4710-a58e-6732204ec60f
---

**Preview (`develop`):** always push — see [auto-push-preview.md](auto-push-preview.md). The user wants GitHub Pages preview updated without having to ask.

**Production (`main`):** do not push unless the user explicitly asks to go live / publish. Merging to `main` triggers the Netlify deploy and publish gate (~1 min+).

**How to apply:** commit as work progresses; when a change set is done and tests pass, `git push origin develop` automatically. Only offer or run the `develop` → `main` publish flow when the user requests production.
