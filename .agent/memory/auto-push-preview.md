---
name: auto-push-preview
description: Always push develop to GitHub Pages preview after completing work
metadata:
  node_type: memory
  type: preference
---

After finishing a chunk of work on `develop`, **always push to preview** — do not wait to be asked.

```sh
git push origin develop
```

**Preview URL:** https://ltpve74.github.io/LimitlessYacht/

**Production (`main`) is different:** still do not push `main` or publish to Netlify unless the user explicitly asks to go live. Preview pushes are safe (analytics suppressed on `*.github.io`).

**When to push:** at the end of any meaningful change set — once commits are clean and tests pass. Mention the preview URL in the handoff so the user can check at 992×900 (or whatever viewport they screenshot).