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
  function dieselLine(input) {
    input = input || {};
    var models = M(input);
    var t = input.trip || {};
    var genBurn = t.genBurn != null ? t.genBurn : 6;
    var price =
      input.linePrice != null
        ? input.linePrice
        : input.dieselPrice != null
          ? input.dieselPrice
          : t.dieselPrice;
    return models.apaDieselLineCalc(
      { genBurn: genBurn, dieselPrice: price },
      input.row || input.line || {}
    );
  }

  function tripTotals(input) {
    input = input || {};
    var models = M(input);
    var t = input.trip || {};
    var dieselLines = input.dieselLines;
    if (!dieselLines) {
      dieselLines = (t.diesel || []).map(function (r) {
        if (typeof input.dieselCalc === "function") return input.dieselCalc(t, r) || { lit: 0, cost: 0 };
        return dieselLine({ models: models, trip: t, row: r });
      });
    }
    var paidCovered = input.paidCovered;
    if (paidCovered == null && input.linkedCharges) {
      paidCovered = models.summarizeApaPaidCovered(input.linkedCharges, {
        chargeIsPaid: models.chargeIsPaid,
        chargeApaBaseTowardPot: models.chargeApaBaseTowardPot,
      });
    }
    if (paidCovered == null) paidCovered = 0;
    var cashSettled = input.cashSettled;
    if (cashSettled == null && input.linkedCharges) {
      cashSettled =
        t.apaCashSettled === true ||
        t.apaCashSettled === "true" ||
        t.apaCashSettled === 1 ||
        (input.linkedCharges || []).some(function (c) {
          return models.isApaCashSettlementCharge(c, {
            chargeIsPaid: models.chargeIsPaid,
            chargeBillType: models.chargeBillType,
          });
        });
    }
    return models.summarizeApaTripTotals({
      apaSent: t.apaSent,
      topUps: t.topUps,
      expenses: t.expenses || [],
      provisions: t.provisions || [],
      dieselLines: dieselLines,
      paidCovered: paidCovered,
      cashSettled: !!cashSettled,
    });
  }

  function overageAmount(input) {
    var tot = tripTotals(input);
    return tot.overage != null ? tot.overage : tot.bal < 0 ? Math.round(-tot.bal * 100) / 100 : 0;
  }

  function paidCovered(input) {
    input = input || {};
    var models = M(input);
    return models.summarizeApaPaidCovered(input.linkedCharges || [], {
      chargeIsPaid: models.chargeIsPaid,
      chargeApaBaseTowardPot: models.chargeApaBaseTowardPot,
    });
  }

  return {
    dieselLine: dieselLine,
    tripTotals: tripTotals,
    overageAmount: overageAmount,
    paidCovered: paidCovered,
  };
});
