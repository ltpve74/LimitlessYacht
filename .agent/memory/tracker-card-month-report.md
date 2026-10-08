# Monthly card expenses report

On the Expenses month bar, next to CSV / Full PDF / Export for owner:

- **Card Excel** — SpreadsheetML `.xls` (same workbook shape as the charges bank list). Columns Date, Vendor, Amount, oldest first, total row. Amounts are real euro numbers.
- **Card receipts** — one PDF page per row, in that same order. Date, vendor, and amount sit above the receipt photo. A row with no JPEG/PNG still has the label and an empty box.

The month is the picker already on that screen.

## What counts as card

- A monthly expense whose `payMethod` contains "card" (`Credit Card` is the company card).
- An APA line paid by **Ship card** or **Guest card**. If that line was already copied onto a monthly expense, the expense is the one row. An unsynced APA card line is included once.

Left out: Cash, **APA cash**, and **Bank transfer**. A bank transfer that was copied onto monthly Expenses is stored as `payMethod: "Credit Card"` (`apaPaidByToMonthly`). The report still drops it by reading the APA line `paidBy` through `fromApaLineId`.

Pure functions: `buildCardExpenseReport`, `cardExpensesExportExcelXml`, `cardExpensesExportCsv` in `tracker/js/models/expenses.js`. Controller: `LY_CONTROLLERS.expenses.cardMonthReport` / `cardMonthExcel`. PDF paint: `tracker/js/pdf/card-receipts.js`.

Build stamp on this develop commit: `TRACKER_BUILD` `2026-10-08.7`. Not published. Live stays on the previous build until Luigi asks to go live.
