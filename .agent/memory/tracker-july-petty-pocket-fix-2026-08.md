# July/August petty + pocket reconstruction (2026-08)

## Explicit DB write only (no load heal)

Applied once via authenticated tracker API `save` (not on open/render):

1. **expenses** — `floatPay: true` on five July crew lines paid from pot after Hollman €1800:
   - Toni €750 Joel, Toni €500 Danilo, Toni €250 Oliver, Laura €200 Sebastien, Laura €150 Leon
2. **expPetty 2026-08** — `broughtForwardShort: 110` (restores wiped July short)

Verified after write: July onboard **0** / short **110**; August onboard **18.56** / priorSettled **110**.

## Captain pocket (already correct in data)

July own-money **€758.88** (stew €450 incl. Vicky long day €250 + shop €308.88).  
No captain reimburse in July. August captain repay **€958.88** = July **758.88** + Airiana **200**.

## Code architecture (not paint hacks)

- **Model:** `LY_MODELS.summarizeCaptainPocketMonthBridge(expenses, month)` — pure carry rules.
- **Controller:** `LY_CONTROLLERS.expenses.captainPocketMonthBridge(input)`.
- **View:** thin wrapper `expCaptainPocketMonthStory` → paint DTO only.
- **Tests:** locked in `scripts/test-tracker-models.mjs`.

Do **not** re-clear floatPay on open. Do **not** invent load-time money heals.
