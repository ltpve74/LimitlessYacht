# Tracker is MVC-only (owner rule)

**Do not invent money math in `tracker/index.html` paint.** Models pure, controllers assemble DTOs, view paints.

| Layer | Where | Rule |
|-------|--------|------|
| Model | `tracker/js/models/*.js` | Pure: petty, pocket, floatPay, reimbursements, settlement |
| Controller | `tracker/js/controllers/*.js` | DTOs for UI/PDF only |
| View | `tracker/index.html`, `tracker/js/pdf/*` | Display / wire events — no ledger formulas |
| Data writes | API + `scripts/lib/tracker-db-io.mjs` | Explicit dry-run → **backup** → save; never load heals |

Blueprint: `.agent/briefs/tracker-v1-mvc-blueprint.md`  
No-heal + backup: `tracker-no-load-heals-db-dryrun.md`

If a fix needs a number, put it in a model (+ test) first.
