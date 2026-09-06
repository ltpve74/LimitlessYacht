# Finance net · boat envelope cash must balance

**2026-09-06:** Net so far must not subtract petty outs without showing where the cash came from.

## Formula

`doneNet = whiteNet + envelopeCashIns − cashCommission − pettyOuts`

- **envelopeCashIns** = all Expenses `expPetty` cash-in lines to date (`summarizePettyCashInToDate`): owner top-ups / wages funding, ATM, bank draw, **and** auto-synced lead/charge free cash.
- **Do not** also add `freeCashBoat` on top — auto-sync would double-count. `cashBoat` stays a label (“of which lead free cash”).
- **cashCommission** = commission on lead free cash → boat only (not on owner top-ups).
- **Owner money** expenses (paid outside the envelope) do **not** hit petty outs — and do not need a matching cash-in on this side.

## Why

If owner puts €2k into the boat for wages and wages leave petty, both the €2k in and the €2k out must appear. Showing only lead free cash as “cash in” while subtracting all petty outs unbalances the books.

## Code

- `summarizePettyCashInToDate` / `summarizePettyCashOutToDate` (expenses model)
- `summarizeRealisedNetGlimpse({ cashIns })` (leads model)
- `LY_CONTROLLERS.leads.moneyDashboard` / `realisedGlimpse` pass `cashIns`
- Finance UI: “Boat cash-ins (envelope)” not “Free cash → boat” alone
