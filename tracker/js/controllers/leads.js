/**
 * LY_CONTROLLERS.leads — Leads dashboard application service.
 *
 * Assembles multi-domain snapshots (leads, charges, expenses/petty) into
 * pure model inputs. Returns DTOs only — no DOM.
 *
 * Boat cash: reuses Expenses petty envelope (summarizePettyCash) — same
 * cash in / cash out / on board. Does NOT re-add free cash + charges.
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

  function monthKey(d) {
    var s = String(d || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s : "";
  }

  /**
   * Boat cash ledger for Leads = Expenses petty envelope for the focus month.
   * Single source of truth: models.summarizePettyCash (same as Expenses).
   *
   * @param {{
   *   models?,
   *   leads, expenses, expPetty,
   *   month?: string,          // YYYY-MM — same month Expenses shows
   *   pettyStart?: number,     // resolved start (carry/manual) for that month
   *   today?: string,
   *   cashInIsTip?: function,
   *   isTipExpense?: function
   * }} input
   */
  function boatCashLedger(input) {
    input = input || {};
    var models = M(input);
    var today = input.today || "";
    var month = String(input.month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      month = String(today || "").slice(0, 7);
    }

    var cashInIsTip =
      typeof input.cashInIsTip === "function"
        ? input.cashInIsTip
        : function () {
            return false;
          };
    var isTipExpense =
      typeof input.isTipExpense === "function"
        ? input.isTipExpense
        : function () {
            return false;
          };

    /* Month petty row (same bag Expenses uses) */
    var pettyRow = null;
    (Array.isArray(input.expPetty) ? input.expPetty : []).forEach(function (p) {
      if (p && String(p.month || "").slice(0, 7) === month) pettyRow = p;
    });

    var rawIns = pettyRow && Array.isArray(pettyRow.cashIns) ? pettyRow.cashIns.filter(Boolean) : [];
    /* Legacy single pettyIn when no cashIns lines */
    if (!rawIns.length && pettyRow && Number(pettyRow.pettyIn) > 0.009) {
      rawIns = [
        {
          id: "pettyIn:" + month,
          amount: Number(pettyRow.pettyIn),
          date: month + "-01",
          month: month,
          note: "Cash in (month total)",
        },
      ];
    }
    var cashIns = rawIns.filter(function (r) {
      return r && !cashInIsTip(r);
    });

    var monthExpenses = (Array.isArray(input.expenses) ? input.expenses : []).filter(function (e) {
      if (!e || isTipExpense(e)) return false;
      if (!month) return true;
      var em = models.expenseMonthKey ? models.expenseMonthKey(e.date) : monthKey(e.date);
      return em === month;
    });

    /*
     * Start: prefer caller-resolved (expEnsurePetty / carry). Else stored row.
     * Same physical-floor as summarizePettyCash (negative start → 0 notes).
     */
    var pettyStart =
      input.pettyStart != null
        ? input.pettyStart
        : pettyRow && pettyRow.pettyStart != null
          ? pettyRow.pettyStart
          : 0;

    var pettySum = models.summarizePettyCash
      ? models.summarizePettyCash({
          pettyStart: pettyStart,
          cashIns: cashIns,
          expenses: monthExpenses,
        })
      : {
          cashInTotal: 0,
          cashOut: 0,
          cashOutLines: [],
          cashInHand: 0,
          pettyOnboard: 0,
          physicalStart: 0,
          pettyStart: 0,
          cashShort: 0,
        };

    var inItems = models.summarizePettyCashInRows
      ? models.summarizePettyCashInRows(cashIns)
      : { total: pettySum.cashInTotal || 0, n: 0, items: [] };

    /* Free cash income (sailed) — label only; not mixed into boat envelope */
    var freeCash = models.summarizeLeadCashIncomeRealised
      ? models.summarizeLeadCashIncomeRealised(input.leads || [], today)
      : { boat: 0, owner: 0, items: [], n: 0, boatN: 0, ownerN: 0 };

    return models.summarizeBoatCashLedger({
      month: month,
      petty: pettySum,
      cashInTotal: pettySum.cashInTotal,
      cashOut: pettySum.cashOut,
      cashOutLines: pettySum.cashOutLines,
      cashInHand: pettySum.cashInHand,
      pettyOnboard: pettySum.pettyOnboard,
      physicalStart: pettySum.physicalStart,
      pettyStart: pettySum.pettyStart,
      cashShort: pettySum.cashShort,
      pettyCashInItems: inItems.items,
      freeCashBoat: freeCash.boat,
      freeCashOwner: freeCash.owner,
      freeCashItems: freeCash.items,
      freeCashN: freeCash.n,
      freeCashBoatN: freeCash.boatN,
      freeCashOwnerN: freeCash.ownerN,
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
