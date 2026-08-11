# July/August petty + pocket reconstruction (2026-08)

## Architecture (locked)

| Concern | Where |
|---------|--------|
| Month-to-month **petty** carry (start + BF short) | `LY_MODELS.resolvePettyMonthOpen` / `Close` |
| Captain **pocket** bridge (prior short → repay) | `LY_MODELS.summarizeCaptainPocketMonthBridge` |
| DTO for view | `LY_CONTROLLERS.expenses.pettyMonthOpen` / `captainPocketMonthBridge` |
| Paint | `tracker/index.html` — display only |
| DB reconstruction | **Separate explicit write** — never load heal |

## Explicit DB write only (no load heal)

Tool: `scripts/tracker-db-dryrun.mjs`

```sh
TRACKER_PASSCODE=… node scripts/tracker-db-dryrun.mjs              # dry-run
TRACKER_PASSCODE=… node scripts/tracker-db-dryrun.mjs --apply-july-aug-2026
```

Reconstruction targets (captain records):

1. **expenses** — `floatPay: true` on five July crew lines paid from pot after Hollman €1800:
   - Toni €750 / €500 / €250, Laura €200 / €150
2. **expPetty 2026-08** — `broughtForwardShort: 110` (July residual boat short)

Verified target after write: July onboard **0** / short **110**; August onboard **~18.56** after priorSettled **110**.

## July short €110 attribution (model shortLines)

Cash in Michael **€1800**; pot crew floatPay **€1850** + Toni reimburse **€60** = out **€1910**.  
Short is **boat pot books short** (not captain pocket fronted):

| Line | Covered by pot | Short |
|------|----------------|-------|
| Toni day pay €250 (Oliver, 24 Jul) | €200 | **€50** |
| Toni pocket repay €60 (26 Jul) | €0 | **€60** |
| **Total** | | **€110** |

August `broughtForwardShort: 110` so first cash-in settles the hole (not a load heal).

## Captain pocket (data)

July own-money **€758.88** (stew €450 incl. Vicky long day €250 + shop €308.88).  
August captain repay **€958.88** = July **758.88** + Airiana **200**.

## Forbidden

- No auto-heal / floatPay wipe / carry refresh **save** on Expenses open or boot.
- No money formulas invented in `index.html` paint.
- `expEnsurePetty` may create a **local** row for editing; it must **not** `saveExpPetty` by itself.
- Use `expPlanMoneyRepairs()` (plan only) or the dry-run script for ops.

## Related

- [tracker-no-load-heals-db-dryrun.md](tracker-no-load-heals-db-dryrun.md)
- [tracker-floatpay-wipe-bug.md](tracker-floatpay-wipe-bug.md)
- Blueprint: `.agent/briefs/tracker-v1-mvc-blueprint.md`
