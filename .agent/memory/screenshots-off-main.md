---
name: screenshots-off-main
description: "screenshots/ is managed to stay off main — don't restore/commit its deletions"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 120b5db5-3741-4c63-b7fd-96b9c4998024
---

The `screenshots/` folder must **never end up on main/production**. It lives on `develop` and
feature branches for cloud-agent visual feedback, but is stripped on publish and excluded from
Netlify/GitHub Pages. Another agent actively manages this (owner-confirmed 6 Jul 2026), which is
why screenshots sometimes show up **deleted** in the working tree.

**Why:** keeping feedback images out of production.

**How to apply:** do NOT "helpfully" restore or re-commit deleted screenshots (I did this once and
was corrected). Leave `screenshots/` out of my commits entirely — unstage it and let the existing
mechanism/other agent manage it. Only ever *read* screenshots as feedback input; never delete,
restore, or commit them. Related: [[project-folders-purpose]].
