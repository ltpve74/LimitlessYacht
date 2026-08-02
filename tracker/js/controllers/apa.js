/**
 * LY_CONTROLLERS.apa — APA pot application service.
 * Diesel cost lines supplied by view adapter (or precomputed).
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports ? require("../models.js") : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.apa = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.apa: LY_MODELS missing");
    return m;
  }

  /**
   * @param {{
   *   models?,
   *   trip: object,
   *   paidCovered?: number,
   *   cashSettled?: boolean,
   *   dieselLines?: Array<{lit, cost}>,
   *   dieselCalc?: function(trip, row): {lit, cost}
   * }} input
   */
  function tripTotals(input) {
    input = input || {};
    var models = M(input);
    var t = input.trip || {};
    var dieselLines = input.dieselLines;
    if (!dieselLines && typeof input.dieselCalc === "function") {
      dieselLines = (t.diesel || []).map(function (r) {
        return input.dieselCalc(t, r) || { lit: 0, cost: 0 };
      });
    }
    dieselLines = dieselLines || [];
    return models.summarizeApaTripTotals({
      apaSent: t.apaSent,
      topUps: t.topUps,
      expenses: t.expenses || [],
      provisions: t.provisions || [],
      dieselLines: dieselLines,
      paidCovered: input.paidCovered != null ? input.paidCovered : 0,
      cashSettled: input.cashSettled != null ? input.cashSettled : false,
    });
  }

  function overageAmount(input) {
    var tot = tripTotals(input);
    return tot.overage != null ? tot.overage : tot.bal < 0 ? Math.round(-tot.bal * 100) / 100 : 0;
  }

  return {
    tripTotals: tripTotals,
    overageAmount: overageAmount,
  };
});
