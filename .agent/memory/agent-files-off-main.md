---
name: agent-files-off-main
description: ALL agent files stay off main; agent working files/memory live in .agent/ (stripped on publish)
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 120b5db5-3741-4c63-b7fd-96b9c4998024
---

**No agent files may reach `main`/production (owner directive, 7 Jul 2026).** Agent working files,
memory, briefs, and scratch live in **`.agent/`** at the repo root — shared across agents on
`develop`/feature branches, and **stripped from `main`** by the pre-commit hook + `.netlifyignore`.

- **Shared cross-agent memory:** `.agent/memory/` — the committed, repo-portable copy of this
  machine-local memory (so other agents/clones get it). Put new working files, notes, and memory in
  `.agent/`, **not** the repo root.
- The four instruction files stay at the repo **root** (agents auto-load them from there) but are
  **also stripped from `main`**: `CLAUDE.md`, `AGENTS.md`, `DECISIONS.md`, `HANDOVER.md`.
- Strip points to keep in sync if adding agent paths: `.githooks/pre-commit` (main-only strip loop),
  `.netlifyignore`; `scripts/prepare-github-pages.py` already skips `.md` + dot-prefixed dirs.

**Why:** production/`main` must carry only what the live site needs; agent docs are internal.
**How to apply:** never place agent-facing files at the repo root except the four named instruction
files — everything else goes under `.agent/`. Related: [[screenshots-off-main]], [[publishing-process]].
