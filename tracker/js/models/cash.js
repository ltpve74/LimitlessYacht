/**
 * LY_MODELS · cash (boat cash ledger composition)
 * Pure domain — no DOM, no state, no sideways domain imports.
 *
 * Other domains produce plain numbers/item lists (leads free cash, charge
 * cash-to-boat, expense petty outs, petty cash-ins). This module composes
 * them into one boat cash picture for the Leads money panel.
 *
 * @see tracker/js/models/README.md
 * @see .agent/memory/tracker-domain-models.md (cross-model route = controller)
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
   * Compose boat cash in/out for Leads money details.
   *
   * @param {{
   *   freeCashBoat?: number,
   *   freeCashOwner?: number,
   *   freeCashItems?: Array,
   *   freeCashN?: number,
   *   freeCashBoatN?: number,
   *   freeCashOwnerN?: number,
   *   chargesCashBoat?: number,
   *   chargesCashItems?: Array,
   *   chargesCashN?: number,
   *   pettyCashIn?: number,
   *   pettyCashInItems?: Array,
   *   expensePettyOut?: number,
   *   expenseOutItems?: Array
   * }} input  Plain aggregates from other domains (via controller)
   */
  function summarizeBoatCashLedger(input) {
    input = input || {};
    var freeBoat = round2(Math.max(0, num(input.freeCashBoat)));
    var freeOwner = round2(Math.max(0, num(input.freeCashOwner)));
    var chargesBoat = round2(Math.max(0, num(input.chargesCashBoat)));
    var pettyIn = round2(Math.max(0, num(input.pettyCashIn)));
    var expOut = round2(Math.max(0, num(input.expensePettyOut)));

    var boatIn = round2(freeBoat + chargesBoat + pettyIn);
    var boatOut = expOut;
    var boatNet = round2(boatIn - boatOut);

    return {
      /* Free cash (leads split) */
      freeCashBoat: freeBoat,
      freeCashOwner: freeOwner,
      freeCashTotal: round2(freeBoat + freeOwner),
      freeCashItems: Array.isArray(input.freeCashItems) ? input.freeCashItems : [],
      freeCashN: num(input.freeCashN),
      freeCashBoatN: num(input.freeCashBoatN),
      freeCashOwnerN: num(input.freeCashOwnerN),
      /* Charges paid cash/mix → boat */
      chargesCashBoat: chargesBoat,
      chargesCashItems: Array.isArray(input.chargesCashItems) ? input.chargesCashItems : [],
      chargesCashN: num(input.chargesCashN),
      /* Petty envelope cash-ins (not tips) */
      pettyCashIn: pettyIn,
      pettyCashInItems: Array.isArray(input.pettyCashInItems) ? input.pettyCashInItems : [],
      /* Expenses that left petty */
      expensePettyOut: expOut,
      expenseOutItems: Array.isArray(input.expenseOutItems) ? input.expenseOutItems : [],
      /* Boat totals */
      boatIn: boatIn,
      boatOut: boatOut,
      boatNet: boatNet,
    };
  }

  return {
    summarizeBoatCashLedger: summarizeBoatCashLedger,
  };
});
