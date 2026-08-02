/**
 * LY_CONTROLLERS.stews — roster money helpers (day pay / tips).
 * Side-effect sync (write expenses) stays in the view; amounts from models.
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports ? require("../models.js") : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.stews = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.stews: LY_MODELS missing");
    return m;
  }

  function dayPayForStew(input) {
    input = input || {};
    return M(input).stewDayPayForStew(input.assign || input.asg, input.stewId);
  }

  function dayPayTotal(input) {
    input = input || {};
    return M(input).stewDayPayTotalAll(input.assign || input.asg);
  }

  function tipIsOnBill(input) {
    input = input || {};
    return M(input).stewTipIsOnBill(input.assign || input.asg);
  }

  function tipTotal(input) {
    input = input || {};
    return M(input).stewTipTotal(input.assign || input.asg);
  }

  function tipPaid(input) {
    input = input || {};
    return M(input).stewTipPaid(input.assign || input.asg);
  }

  /**
   * Normalize assigns into open-tip tipRows for expenses.collectOpenTipPayouts.
   */
  function tipLiabilityRows(input) {
    input = input || {};
    var models = M(input);
    var rows = [];
    (input.assigns || input.stewAssign || []).forEach(function (asg) {
      if (!asg || !asg.eventKey) return;
      if (asg.cancelled || asg.status === "cancelled" || asg.cancelGhost) return;
      rows.push({
        eventKey: String(asg.eventKey),
        onBill: models.stewTipIsOnBill(asg),
        paid: models.stewTipPaid(asg),
        amount: models.stewTipTotal(asg),
        date: String(asg.start || "").slice(0, 10),
        summary: asg.summary || "Charter",
        cancelled: false,
      });
    });
    return rows;
  }

  return {
    dayPayForStew: dayPayForStew,
    dayPayTotal: dayPayTotal,
    tipIsOnBill: tipIsOnBill,
    tipTotal: tipTotal,
    tipPaid: tipPaid,
    tipLiabilityRows: tipLiabilityRows,
  };
});
