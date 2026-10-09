# Expense paid by bank transfer

- A normal expense can be marked **Bank transfer**. New receipt: third button next to Company card and Petty cash. Existing row: Type menu on the edit sheet.
- Stored as `payMethod: "Bank transfer"` and empty `paidFrom`. It does not hit petty cash and it is not a card payment, so it stays out of the cash PDF and the card CSV and receipt PDF.
- An APA line whose paid-by is Bank transfer still stays off those reports. New APA sync stores that copy as Bank transfer. Older copies stored as Credit Card stay off the card report because the APA paid-by label is read.
- Crew salary, reimbursement, and commission sheets still force their own pay rules. Do not treat a bank row as cash just because `paidFrom` was left as Petty cash.
