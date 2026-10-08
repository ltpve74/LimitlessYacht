# Tracker receipt photo read

**2026-10-01.** Expense and APA receipt photos can suggest the shop, the date, and the euro total.

- The phone sends a sharper JPEG to `/.netlify/functions/tracker-receipt` (captain or manager passcode). The stored receipt stays the smaller compressed copy.
- The function calls xAI (`grok-4.7`, `store: false`) with `XAI_API_KEY`. The key is server-only.
- `tracker/js/models/receipt.js` normalises the JSON (European dates and amounts, drop zero / wild totals, do not fill non-euro amounts).
- The function must **static-import** that model. A `createRequire` left it out of the Netlify bundle (`/var/task` has no `tracker/`), and the live function returned 502 `Cannot find module` before any photo was read (seen 2026-10-07).
- The form fills empty fields only. A new expense may replace today’s default date until the captain edits it. Nothing is saved until Save.
- Crew-salary, reimbursement, and commission sheets do not read the photo.
- If `XAI_API_KEY` is missing, the photo still attaches and the line says reading is not configured. Netlify’s “Contains secret values” flag left that key empty inside the function (2026-10-08); the variable is stored without that flag.
- A shop + day + euro total that matches a row already in Expenses or an APA line is called out under the photo, and Save asks before writing it again. The open row and its linked APA/expense pair are not treated as a copy. Crew salary, reimbursement, and commission sheets are not compared.
- A new ordinary expense opens photo-first (`2026-10-08.3`): rear camera is the large control, a second control picks a saved photo or PDF, then Total, a Company card / Petty cash choice, Shop, and Date. Company card sets Type to Credit Card (does not leave petty). Petty cash sets Cash + Petty cash. Category and the older paid-from options stay in a closed details block with the same field ids. Save and next keeps the sheet open on a blank receipt. Edit, crew salary, reimbursement, and commission sheets keep the old field order.
