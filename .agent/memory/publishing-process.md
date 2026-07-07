---
name: publishing-process
description: "How publishing works: develop→main, why it's slow, develop is meant to be 'behind' main"
metadata: 
  node_type: memory
  type: project
  originSessionId: 120b5db5-3741-4c63-b7fd-96b9c4998024
---

**The publish process (owner-confirmed, 7 Jul 2026 — I got confused about this once; don't again).**

- **`main` is the process branch / production.** Work lands on `develop` (readable), then publishes to
  `main` (minified). `main` has its own **process**: the pre-commit hook on `main` runs
  minify → `publish-gate.py` (site tests + analytics only). UX/Lighthouse are opt-in via
  `--with-ux` / `--with-lighthouse` for manual runs. Netlify deploys `main`.
- **`develop` will always be "behind" `main`** in commit count — that's NORMAL and expected, not a
  problem to fix. Each publish is a `main`-only commit (the minified snapshot). **Never back-merge
  `main` → `develop`** (pulls minified files into the readable branch). See DECISIONS.md "Build/git".
- **Publishing is faster now** — the `main` hook runs site tests + verify-analytics only (~seconds).
  Optional UX/Lighthouse: `scripts/setup-qa.sh` then `publish-gate.py --with-ux --with-lighthouse`.
- **Do NOT over-analyze branch divergence before publishing.** Trust the documented flow: publish =
  merge `develop` → `main`, resolve any conflicts with **dev wins** (`git checkout --theirs`), commit
  `"Publish: …"` → the hook minifies + gates → push `origin main`. (CLAUDE.md "Publishing workflow".)
- **Disregard other agents' feature branches** (e.g. `feature/hero-framing`). Another agent works this
  repo in parallel; my work flows through `develop`, and I should not get tangled in their branches.
  Related: [[no-auto-push]], [[screenshots-off-main]].
