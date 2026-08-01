/**
 * LY_CONTROLLERS composition — application services over LY_MODELS.
 *
 * Browser load order (after models):
 *   controllers/expenses.js → controllers/index.js
 * Node: require("tracker/js/controllers") or require("./index.js")
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
  if (!expenses) {
    throw new Error("LY_CONTROLLERS.expenses missing — load controllers/expenses.js before index.js");
  }
  return {
    expenses: expenses,
  };
});
