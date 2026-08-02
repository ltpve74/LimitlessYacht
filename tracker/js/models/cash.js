/**
 * LY_MODELS · cash (boat envelope DTO for Leads)
 * Pure domain — no DOM, no state, no sideways domain imports.
 *
 * Boat cash numbers MUST match Expenses. They come from
 * models.summarizePettyCash (via controller), not a second formula
 * that re-adds free cash / charges / top-ups (that drifted €100+).
 *
 * This module only shapes a plain DTO for paint. It does not invent €.
 *
 * @see tracker/js/models/expenses.js summarizePettyCash
 * @see .agent/memory/tracker-domain-models.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory(
    typeof module === "object" && module.exports ? require("./util.js") : (root.LY_MODELS_PARTS || {}).util
  );
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.cash = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;

  /**
   * Boat envelope for Leads money details — Expenses numbers only.
   *
   * Prefer input.petty (or cashInTotal / cashOut / pettyOnboard from
   * summarizePettyCash). Owner pocket free cash is reported for the
   * income panel only — never added to boatIn / boatNet.
   *
   * @param {{
   *   petty?: {
   *     cashInTotal?: number,
   *     cashOut?: number,
   *     cashOutLines?: Array,
   *     cashInHand?: number,
   *     pettyOnboard?: number,
   *     pettyCash?: number,
   *     pettyStart?: number,
   *     physicalStart?: number,
   *     cashShort?: number
   *   },
   *   cashInTotal?: number,
   *   cashOut?: number,
   *   cashOutLines?: Array,
   *   cashInHand?: number,
   *   pettyOnboard?: number,
   *   pettyStart?: number,
   *   physicalStart?: number,
   *   cashShort?: number,
   *   pettyCashInItems?: Array,
   *   freeCashBoat?: number,
   *   freeCashOwner?: number,
   *   freeCashItems?: Array,
   *   freeCashN?: number,
   *   freeCashBoatN?: number,
   *   freeCashOwnerN?: number,
   *   month?: string
   * }} input
   */
  function summarizeBoatCashLedger(input) {
    input = input || {};
    var p = input.petty || {};

    var cashIn = round2(Math.max(0, num(p.cashInTotal != null ? p.cashInTotal : input.cashInTotal)));
    var cashOut = round2(Math.max(0, num(p.cashOut != null ? p.cashOut : input.cashOut)));
    var physicalStart = round2(
      Math.max(
        0,
        num(
          p.physicalStart != null
            ? p.physicalStart
            : input.physicalStart != null
              ? input.physicalStart
              : p.pettyStart != null
                ? p.pettyStart
                : input.pettyStart
        )
      )
    );
    var cashInHand = round2(
      num(
        p.cashInHand != null
          ? p.cashInHand
          : input.cashInHand != null
            ? input.cashInHand
            : physicalStart + cashIn
      )
    );
    var onboardRaw =
      p.pettyOnboard != null
        ? p.pettyOnboard
        : p.pettyCash != null
          ? p.pettyCash
          : input.pettyOnboard != null
            ? input.pettyOnboard
            : cashInHand - cashOut;
    var onboard = round2(Math.max(0, num(onboardRaw)));
    var cashShort = round2(Math.max(0, num(p.cashShort != null ? p.cashShort : input.cashShort)));

    var outLines = Array.isArray(p.cashOutLines)
      ? p.cashOutLines
      : Array.isArray(input.cashOutLines)
        ? input.cashOutLines
        : Array.isArray(input.expenseOutItems)
          ? input.expenseOutItems
          : [];
    var inItems = Array.isArray(input.pettyCashInItems) ? input.pettyCashInItems : [];

    /* Free cash income (leads) — display only; not used in boat math */
    var freeBoat = round2(Math.max(0, num(input.freeCashBoat)));
    var freeOwner = round2(Math.max(0, num(input.freeCashOwner)));
    var freeItemsAll = Array.isArray(input.freeCashItems) ? input.freeCashItems : [];
    var freeBoatItems = freeItemsAll.filter(function (it) {
      return it && it.dest !== "owner";
    });

    return {
      /* Same field names Expenses settlement uses */
      month: input.month ? String(input.month).slice(0, 7) : "",
      cashInTotal: cashIn,
      cashOut: cashOut,
      cashInHand: cashInHand,
      pettyStart: round2(num(p.pettyStart != null ? p.pettyStart : input.pettyStart)),
      physicalStart: physicalStart,
      pettyOnboard: onboard,
      pettyCash: onboard,
      cashShort: cashShort,
      /* Leads paint aliases (= Expenses cards) */
      boatIn: cashIn,
      boatOut: cashOut,
      boatNet: onboard,
      expensePettyOut: cashOut,
      expenseOutItems: outLines,
      pettyCashIn: cashIn,
      pettyCashInItems: inItems,
      /* Free cash income note (owner never in boat) */
      freeCashBoat: freeBoat,
      freeCashOwner: freeOwner,
      freeCashTotal: round2(freeBoat + freeOwner),
      freeCashItems: freeBoatItems,
      freeCashN: freeBoatItems.length,
      freeCashBoatN: num(input.freeCashBoatN),
      freeCashOwnerN: num(input.freeCashOwnerN),
      /* Legacy empty — do not re-derive from charges/leads */
      chargesCashBoat: 0,
      chargesCashItems: [],
      chargesCashN: 0,
      source: "expenses-petty",
    };
  }

  return {
    summarizeBoatCashLedger: summarizeBoatCashLedger,
  };
});
