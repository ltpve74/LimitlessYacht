/**
 * LY_CONTROLLERS.leads — Leads dashboard application service.
 * Assembles realised glimpse (white net + boat free cash). No DOM.
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports ? require("../models.js") : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.leads = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.leads: LY_MODELS missing");
    return m;
  }

  /**
   * Realised free cash (sailed/today only) + white net glimpse.
   *
   * @param {{
   *   models?,
   *   leads: Array,
   *   today: string,
   *   whiteEx: number,   // before VAT (cash-free bases), realised
   *   whiteComm: number  // commissions, realised
   * }} input
   */
  function realisedGlimpse(input) {
    input = input || {};
    var models = M(input);
    var cash = models.summarizeLeadCashIncomeRealised(input.leads || [], input.today || "");
    return models.summarizeRealisedNetGlimpse({
      whiteEx: input.whiteEx,
      whiteComm: input.whiteComm,
      cashRealised: cash,
    });
  }

  function listMoney(input) {
    input = input || {};
    return M(input).leadListMoney(input.lead || input.row || input);
  }

  function charterTiming(input) {
    input = input || {};
    return M(input).leadCharterTiming(input.lead || input.row || input, input.today);
  }

  /**
   * Full Leads money dashboard DTO (done/proj/source cards) + realised glimpse.
   */
  function moneyDashboard(input) {
    input = input || {};
    var models = M(input);
    var dash = models.summarizeLeadsMoneyDashboard({
      leads: input.leads || [],
      charters: input.charters || [],
      today: input.today || "",
      chargeUpsellGross: models.chargeUpsellGross,
      chargeCommissionParts: models.chargeCommissionParts,
      isChargeCaptainComm: models.isChargeCaptainComm,
      chargeExtHours: models.chargeExtHours,
      chargeExtAmt: models.chargeExtAmt,
    });
    var glimpse = models.summarizeRealisedNetGlimpse({
      whiteEx: dash.done.ex,
      whiteComm: dash.done.comm,
      cashRealised: models.summarizeLeadCashIncomeRealised(input.leads || [], input.today || ""),
    });
    dash.glimpse = glimpse;
    return dash;
  }

  return {
    realisedGlimpse: realisedGlimpse,
    listMoney: listMoney,
    charterTiming: charterTiming,
    moneyDashboard: moneyDashboard,
  };
});
