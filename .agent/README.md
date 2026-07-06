# `.agent/` — shared agent workspace (NEVER ships to `main`/production)

Everything in this folder is for the AI agents working this repo — memory, briefs, scratch/working
files. It lives on `develop` and feature branches so **all** agents share it, and it is **stripped
from `main` on publish** (the `main` pre-commit hook + `.netlifyignore`) so none of it reaches
production. The GitHub Pages preview already skips it (dot-prefixed dir + `.md` files).

## What goes here

- **`memory/`** — the **shared cross-agent memory**: markdown facts (one per file) + a `MEMORY.md`
  index. This is the source of truth any agent should read and update. *(Claude Code also keeps a
  machine-local mirror under `~/.claude/projects/<proj>/memory/`; treat this committed copy as the
  authoritative shared one.)*
- **`briefs/`** — working briefs, handovers, media manifests, campaign notes.
- **`_sync-dupes/`** — Dropbox/iCloud sync-conflict copies (`… 2.md`, `… 3.md`) swept out of the
  repo root. Safe to delete.
- **Scratch / working files** — anything an agent needs mid-task that must not ship.

## Rules for every agent

- **Nothing here reaches `main`/production.** Don't rely on it being live or served.
- Put NEW agent working files, notes, and memory **HERE**, not at the repo root.
- The auto-loaded instruction files — `CLAUDE.md`, `AGENTS.md`, `DECISIONS.md`, `HANDOVER.md` — must
  stay at the repo **root** (agents load them from there), but they are **also stripped from `main`**.
- See [`../AGENTS.md`](../AGENTS.md) for the cross-agent rules and [`../CLAUDE.md`](../CLAUDE.md) for
  the full workflow.
