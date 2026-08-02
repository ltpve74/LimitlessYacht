/**
 * LY_CONTROLLERS.leads — Leads dashboard application service.
 *
 * Assembles multi-domain snapshots (leads, charges, expenses/petty) into
 * pure model inputs. Returns DTOs only — no DOM.
 *
 * Cross-domain cash: leads free cash + charges cash-to-boat + expense petty
 * outs + petty cash-ins → models.summarizeBoatCashLedger (cash.js).
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
   * Boat cash ledger for Leads money details.
   * Controller pulls each domain; cash model only composes plain numbers.
   *
   * @param {{
   *   models?,
   *   leads, charters, expenses, expPetty,
   *   today?: string,
   *   cashInIsTip?: function
   * }} input
   */
  function boatCashLedger(input) {
    input = input || {};
    var models = M(input);
    var today = input.today || "";
    var freeCash = models.summarizeLeadCashIncomeRealised(input.leads || [], today);
    var chargesCash = models.summarizeChargeCashToBoat
      ? models.summarizeChargeCashToBoat(input.charters || [])
      : { total: 0, n: 0, items: [] };

    var cashInIsTip =
      typeof input.cashInIsTip === "function"
        ? input.cashInIsTip
        : function () {
            return false;
          };
    var flatIns = models.collectPettyCashInsFromMonths
      ? models.collectPettyCashInsFromMonths(input.expPetty || [])
      : [];
    var pettyIn = models.summarizePettyCashInRows
      ? models.summarizePettyCashInRows(flatIns, {
          skip: function (r) {
            return cashInIsTip(r);
          },
        })
      : { total: 0, n: 0, items: [] };

    /* All expense cash outs that hit petty (all months) */
    var pettySum = models.summarizePettyCash({
      pettyStart: 0,
      cashIns: [],
      expenses: input.expenses || [],
    });

    return models.summarizeBoatCashLedger({
      freeCashBoat: freeCash.boat,
      freeCashOwner: freeCash.owner,
      freeCashItems: freeCash.items,
      freeCashN: freeCash.n,
      freeCashBoatN: freeCash.boatN,
      freeCashOwnerN: freeCash.ownerN,
      chargesCashBoat: chargesCash.total,
      chargesCashItems: chargesCash.items,
      chargesCashN: chargesCash.n,
      pettyCashIn: pettyIn.total,
      pettyCashInItems: pettyIn.items,
      expensePettyOut: pettySum.cashOut,
      expenseOutItems: pettySum.cashOutLines || [],
    });
  }

  /**
   * Full Leads money dashboard DTO + realised glimpse + boat cash ledger.
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
    var freeCash = models.summarizeLeadCashIncomeRealised(input.leads || [], input.today || "");
    var glimpse = models.summarizeRealisedNetGlimpse({
      whiteEx: dash.done.ex,
      whiteComm: dash.done.comm,
      cashRealised: freeCash,
    });
    dash.glimpse = glimpse;
    dash.cashLedger = boatCashLedger(input);
    return dash;
  }

  return {
    realisedGlimpse: realisedGlimpse,
    listMoney: listMoney,
    charterTiming: charterTiming,
    boatCashLedger: boatCashLedger,
    moneyDashboard: moneyDashboard,
  };
});
