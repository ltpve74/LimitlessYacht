/**
 * LY_CONTROLLERS.charges — Charges application service.
 * No DOM. No money formulas beyond calling LY_MODELS.
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports ? require("../models.js") : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.charges = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.charges: LY_MODELS missing");
    return m;
  }

  function cashToBoat(input) {
    input = input || {};
    return M(input).chargeCashToBoat(input.charge || input.row || input);
  }

  function vatParts(input) {
    input = input || {};
    return M(input).chargeVatParts(input.charge || input.row || input);
  }

  function summarizeCashToBoat(input) {
    input = input || {};
    return M(input).summarizeChargeCashToBoat(input.charters || input.charges || []);
  }

  function captainUpsellCommissions(input) {
    input = input || {};
    return M(input).summarizeCaptainChargeCommissions(input.charters || input.charges || []);
  }

  return {
    cashToBoat: cashToBoat,
    vatParts: vatParts,
    summarizeCashToBoat: summarizeCashToBoat,
    captainUpsellCommissions: captainUpsellCommissions,
  };
});
