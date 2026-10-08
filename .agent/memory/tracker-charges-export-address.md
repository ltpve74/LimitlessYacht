# Charges spreadsheet: name and address

Excel and CSV exports (Charges → Export Excel) add an Address column after Name.

A charge linked to a lead uses that lead’s bill-to name and address (street lines joined with a comma). Click & Boat leads are labelled `Click & Boat`. Owner-sourced leads are labelled `Owner sourced`. Those two have no billing details, so the address stays blank. A charge with no lead keeps its own client name and any address stored on the charge.

Link order: `leadId` / `fromLeadId`, then the APA pot’s `clientKey` `lead:…`, then the same guest name inside the charter dates.

The same sheet is the bank reconciliation list. Cash-only charges are left out. A mix shows only the invoice/card part in Amount. Paid and unpaid are two blocks on the one sheet, each with its own total.

Build `2026-10-08.5`. Service worker comment v17.
