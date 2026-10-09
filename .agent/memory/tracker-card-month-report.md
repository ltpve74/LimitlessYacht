# Monthly card expenses report

On the Expenses month bar, next to CSV / Full PDF / Export for owner:

- **Card CSV** — `Limitless-card-expenses-<month>.csv`. Columns Date, Vendor, Amount, oldest first, total row. Amounts are plain euro numbers.
- **Card receipts** — one PDF page per receipt photo, in the same order as the CSV. Date, vendor, and amount sit above the photo. A charge with no JPEG/PNG is left out. If none of the card rows have a photo, the file is one note, not a blank page per charge.

The month is the picker already on that screen.

## What counts as card

- A monthly expense whose `payMethod` contains "card" (`Credit Card` is the company card).
- An APA line paid by **Ship card** or **Guest card**. If that line was already copied onto a monthly expense, the expense is the one row. An unsynced APA card line is included once.

Left out: Cash, **APA cash**, and **Bank transfer**. A new APA sync stores a bank line as Bank transfer. An older copy may still be stored as Credit Card; the report drops that by reading the APA line `paidBy` through `fromApaLineId`.

Pure functions: `buildCardExpenseReport`, `cardExpensesExportCsv` in `tracker/js/models/expenses.js`. Controller: `LY_CONTROLLERS.expenses.cardMonthReport` / `cardMonthCsv`. The Expenses screen downloads the CSV. PDF paint: `tracker/js/pdf/card-receipts.js`.

The month button downloads the CSV. Cash, APA cash, and bank transfers stay out of that file.
