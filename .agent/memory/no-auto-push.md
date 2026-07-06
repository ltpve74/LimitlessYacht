---
name: no-auto-push
description: Git push workflow preference — do not push without explicit agreement
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b62144d-44dd-4710-a58e-6732204ec60f
---

Do not `git push` after every change. Committing locally is fine, but pushing to the remote happens only when the user explicitly agrees / asks.

**Why:** the user wants to review and batch changes before they go to the remote (and trigger Netlify deploys), rather than every edit auto-deploying.

**How to apply:** make commits as work progresses, but pause before pushing and wait for the user's go-ahead. When work is at a natural stopping point, offer to push rather than doing it automatically.
