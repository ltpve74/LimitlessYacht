---
name: project-folders-purpose
description: Purpose of the screenshots/ and scripts/google-ads/ folders in the Limitless project
metadata: 
  node_type: memory
  type: project
  originSessionId: 1b62144d-44dd-4710-a58e-6732204ec60f
---

Two folders in the Limitless Promocion Project that are intentionally untracked and NOT part of the website — do not bundle them into website commits:

- `screenshots/` — the user's drop-folder for sharing screenshots with Claude to get help. Expect new images here over time; not deploy assets.
- `scripts/google-ads/` — work in progress to automate Claude's access to Google Ads (API credentials/setup). Secrets here are git-ignored (see [[interior-photo-enhancement]] for the gallery/media work that IS the live site).
