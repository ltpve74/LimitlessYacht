/**
 * LY_MODELS composition — merges domain modules.
 *
 * Browser (tracker/index.html) load order:
 *   util → leads → charges → expenses → cash → diesel → stews → apa → index
 * Node: require("tracker/js/models.js")
 *
 * Boundaries: no sideways domain imports (only util; charges may read leads.CAPTAIN_COMMISSION_PCT).
 * Cross-domain composition → controllers (e.g. leads.moneyDashboard + cash ledger).
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  root.LY_MODELS = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var isNode = typeof module === "object" && module.exports;
  var parts = (typeof globalThis !== "undefined" ? globalThis : {}).LY_MODELS_PARTS || {};
  var util = isNode ? require("./util.js") : parts.util;
  var leads = isNode ? require("./leads.js") : parts.leads;
  var charges = isNode ? require("./charges.js") : parts.charges;
  var expenses = isNode ? require("./expenses.js") : parts.expenses;
  var cash = isNode ? require("./cash.js") : parts.cash;
  var diesel = isNode ? require("./diesel.js") : parts.diesel;
  var stews = isNode ? require("./stews.js") : parts.stews;
  var apa = isNode ? require("./apa.js") : parts.apa;
  if (!util || !leads || !charges || !expenses || !cash || !diesel || !stews || !apa) {
    throw new Error(
      "LY_MODELS parts missing — load models/{util,leads,charges,expenses,cash,diesel,stews,apa}.js before index.js"
    );
  }
  function assign(target, src) {
    Object.keys(src).forEach(function (k) {
      target[k] = src[k];
    });
    return target;
  }
  var api = {};
  assign(api, util);
  assign(api, leads);
  assign(api, charges);
  assign(api, expenses);
  assign(api, cash);
  assign(api, diesel);
  assign(api, stews);
  assign(api, apa);
  if (api.BILL_TYPES && !Array.isArray(api.BILL_TYPES)) api.BILL_TYPES = Object.keys(api.BILL_TYPES);
  if (api.LEAD_SOURCES && !Array.isArray(api.LEAD_SOURCES)) api.LEAD_SOURCES = Object.keys(api.LEAD_SOURCES);
  if (api.EXP_REIMBURSE_CATS && !Array.isArray(api.EXP_REIMBURSE_CATS))
    api.EXP_REIMBURSE_CATS = Object.keys(api.EXP_REIMBURSE_CATS);
  return api;
});
