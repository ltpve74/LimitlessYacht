/**
 * LY_CONTROLLERS composition — application services over LY_MODELS.
 *
 * Browser load order (after models):
 *   expenses → cashReport → charges → leads → apa → stews → index
 *
 * @see .agent/briefs/tracker-v1-mvc-blueprint.md
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  root.LY_CONTROLLERS = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var isNode = typeof module === "object" && module.exports;
  var parts = (typeof globalThis !== "undefined" ? globalThis : {}).LY_CONTROLLERS_PARTS || {};
  var expenses = isNode ? require("./expenses.js") : parts.expenses;
  var cashReport = isNode ? require("./cashReport.js") : parts.cashReport;
  var charges = isNode ? require("./charges.js") : parts.charges;
  var leads = isNode ? require("./leads.js") : parts.leads;
  var apa = isNode ? require("./apa.js") : parts.apa;
  var stews = isNode ? require("./stews.js") : parts.stews;
  if (!expenses || !cashReport || !charges || !leads || !apa || !stews) {
    throw new Error(
      "LY_CONTROLLERS parts missing — load controllers/{expenses,cashReport,charges,leads,apa,stews}.js before index.js"
    );
  }
  return {
    expenses: expenses,
    cashReport: cashReport,
    charges: charges,
    leads: leads,
    apa: apa,
    stews: stews,
  };
});
