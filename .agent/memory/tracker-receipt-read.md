# Tracker receipt photo read

**2026-10-01.** Expense and APA receipt photos can suggest the shop, the date, and the euro total.

- The phone sends a sharper JPEG to `/.netlify/functions/tracker-receipt` (captain or manager passcode). The stored receipt stays the smaller compressed copy.
- The function calls xAI (`grok-4.7`, `store: false`) with `XAI_API_KEY`. The key is server-only.
- `tracker/js/models/receipt.js` normalises the JSON (European dates and amounts, drop zero / wild totals, do not fill non-euro amounts).
- The function must **static-import** that model. A `createRequire` left it out of the Netlify bundle (`/var/task` has no `tracker/`), and the live function returned 502 `Cannot find module` before any photo was read (seen 2026-10-07).
- The form fills empty fields only. A new expense may replace today’s default date until the captain edits it. Nothing is saved until Save.
- Crew-salary, reimbursement, and commission sheets do not read the photo.
- If `XAI_API_KEY` is missing, the photo still attaches and the line says reading is not configured.
