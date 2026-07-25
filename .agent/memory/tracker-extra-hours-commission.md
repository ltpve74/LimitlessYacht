# Tracker: extra charter hours + commission

**Where:** **Charges** only — not the lead, not APA.

**How:** New charge → amount (e.g. €500) → Settlement Cash or Invoice → tick **I get commission (extra hours / extension)** → optional “extra hours” label.

**Commission (15%):**
| Settlement | Base | Example €500 |
|------------|------|----------------|
| **Cash** | Full amount (no VAT) | €75 |
| **Invoice** (VAT incl.) | Amount before VAT (÷1.21) | ≈€61.98 |
| **Mix** | Cash full + invoice part ÷1.21 | depends on split |

Locked in `tracker/js/models.js` → `chargeCommissionParts` + tests in `scripts/test-tracker-models.mjs`.
