/**
 * LY_CONTROLLERS.expenses — Expenses application service (controller).
 *
 * Orchestrates pure LY_MODELS for the Expenses tab. No DOM.
 * No money formulas — only assemble inputs, call models, return DTOs.
 *
 * @see .agent/briefs/tracker-v1-mvc-blueprint.md
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports
      ? require("../models.js")
      : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.expenses = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.expenses: LY_MODELS missing");
    return m;
  }

  function monthKey(d, models) {
    if (models.expenseMonthKey) return models.expenseMonthKey(d);
    var s = String(d || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s : "";
  }

  function linesForMonth(expenses, month, models) {
    return (Array.isArray(expenses) ? expenses : []).filter(function (e) {
      return e && monthKey(e.date, models) === month;
    });
  }

  function defaultPersonName(id) {
    var CAP = (defaultModels && defaultModels.EXP_POCKET_CAPTAIN) || "captain";
    if (!id || String(id) === CAP) return "Captain";
    return "Crew";
  }

  /**
   * Open crew day-pay liabilities through focus month.
   * @param {object} input
   */
  function openCrewDayPay(input) {
    input = input || {};
    var models = M(input);
    if (!models.collectOpenCrewDayPay) return [];
    var dayPayAmt =
      typeof input.dayPayAmt === "function"
        ? input.dayPayAmt
        : function (asg) {
            return Number(asg && (asg.payEach != null ? asg.payEach : asg.dayRate)) || 0;
          };
    var isSkipped =
      typeof input.isSkipped === "function"
        ? input.isSkipped
        : function () {
            return false;
          };
    var personName = typeof input.personName === "function" ? input.personName : defaultPersonName;
    return models.collectOpenCrewDayPay(input.stewAssign || [], input.expenses || input.allExpenses || [], {
      focusMonth: input.month || input.focusMonth || "",
      today: input.today || "9999-12-31",
      dayPayAmt: dayPayAmt,
      isSkipped: isSkipped,
      personName: personName,
    });
  }

  /**
   * Open on-bill tip liabilities. Prefer input.tipRows (normalized); else empty.
   */
  function openTipPayouts(input) {
    input = input || {};
    var models = M(input);
    if (!models.collectOpenTipPayouts) return [];
    var rows = Array.isArray(input.tipRows) ? input.tipRows : [];
    return models.collectOpenTipPayouts(rows, {
      focusMonth: input.month || input.focusMonth || "",
      today: input.today || "9999-12-31",
    });
  }

  function dayPayOwedSummary(items) {
    var owe = 0;
    var keys = {};
    (items || []).forEach(function (r) {
      if (!r) return;
      owe += Number(r.amount) || 0;
      if (r.eventKey) keys[r.eventKey] = 1;
    });
    return {
      owe: Math.round(owe * 100) / 100,
      trips: Object.keys(keys).length,
      lines: (items || []).length,
      items: items || [],
    };
  }

  /**
   * Full month settlement DTO for Expenses paint.
   * View: format only — do not re-sum petty / pocket / open lists.
   */
  function monthSettlement(input) {
    input = input || {};
    var models = M(input);
    if (typeof models.summarizeMonthSettlement !== "function") {
      throw new Error("LY_MODELS.summarizeMonthSettlement missing");
    }
    var month = input.month || "";
    var allExpenses = input.allExpenses || input.expenses || [];
    var expenses = input.monthExpenses != null ? input.monthExpenses : linesForMonth(allExpenses, month, models);
    var petty = input.petty || {};
    var cashInsAll = Array.isArray(petty.cashIns) ? petty.cashIns : input.cashInsAll || [];
    var cashInIsTip =
      typeof input.cashInIsTip === "function"
        ? input.cashInIsTip
        : function () {
            return false;
          };
    var cashIns =
      input.cashIns != null
        ? input.cashIns
        : cashInsAll.filter(function (r) {
            return r && !cashInIsTip(r);
          });

    var openDayPay =
      input.openDayPay != null
        ? input.openDayPay
        : openCrewDayPay({
            models: models,
            month: month,
            focusMonth: month,
            expenses: allExpenses,
            allExpenses: allExpenses,
            stewAssign: input.stewAssign,
            today: input.today,
            dayPayAmt: input.dayPayAmt,
            isSkipped: input.isSkipped,
            personName: input.personName,
          });
    var owed = dayPayOwedSummary(openDayPay);

    var openTips =
      input.openTips != null
        ? input.openTips
        : openTipPayouts({
            models: models,
            month: month,
            focusMonth: month,
            today: input.today,
            tipRows: input.tipRows,
          });

    var fig = models.summarizeMonthSettlement({
      expenses: expenses,
      allExpenses: allExpenses,
      pettyStart: petty.pettyStart != null ? petty.pettyStart : input.pettyStart,
      broughtForwardShort:
        petty.broughtForwardShort != null
          ? petty.broughtForwardShort
          : input.broughtForwardShort,
      cashIns: cashIns,
      cashInsAll: cashInsAll,
      cashInIsTip: cashInIsTip,
      cashInIsOwnMoney: input.cashInIsOwnMoney,
      isTipExpense: input.isTipExpense,
      openDayPay: owed.items,
      openTips: openTips,
      personName: input.personName || defaultPersonName,
      pettyStartMode: petty.startMode,
      pettyStartManual: petty.startManual === true,
    });
    fig.petty = petty;
    fig.openDayPaySummary = owed;
    return fig;
  }

  function openPocketOuts(input) {
    input = input || {};
    var models = M(input);
    if (!models.collectOpenPocketOuts) return [];
    return models.collectOpenPocketOuts(input.expenses || input.allExpenses || [], input.month || input.focusMonth || "", {
      personName: input.personName || defaultPersonName,
    });
  }

  function ownMoneyRepaid(input) {
    input = input || {};
    var models = M(input);
    if (!models.ownMoneyRepaidAmt) return 0;
    return models.ownMoneyRepaidAmt(input.expense, input.expenses || input.allExpenses || []);
  }

  function ownMoneyIsRepaid(input) {
    input = input || {};
    var models = M(input);
    if (!models.ownMoneyIsRepaid) return false;
    return !!models.ownMoneyIsRepaid(input.expense, input.expenses || input.allExpenses || []);
  }

  function ownMoneyRepayHint(input) {
    input = input || {};
    var models = M(input);
    if (!models.ownMoneyRepayHint) return null;
    return models.ownMoneyRepayHint(input.expense, input.expenses || input.allExpenses || []);
  }

  function pocketBalances(input) {
    input = input || {};
    var models = M(input);
    if (!models.summarizePocketBalances) {
      return { list: [], total: 0, byId: {}, captain: { putIn: 0, paidOut: 0, reimbursed: 0, owed: 0, overpaid: 0 } };
    }
    var month = input.month || "";
    var all = input.expenses || input.allExpenses || [];
    var monthLines = input.monthExpenses != null ? input.monthExpenses : linesForMonth(all, month, models);
    var petty = input.petty || {};
    var cashIns = Array.isArray(petty.cashIns) ? petty.cashIns : input.cashIns || [];
    return models.summarizePocketBalances(monthLines, cashIns, {
      personName: input.personName || defaultPersonName,
      cashInIsOwnMoney: input.cashInIsOwnMoney,
    });
  }

  /**
   * Captain pocket month bridge DTO (carry prior short → this month → repay).
   * Pure model; no writes. View paints only.
   */
  function captainPocketMonthBridge(input) {
    input = input || {};
    var models = M(input);
    if (!models.summarizeCaptainPocketMonthBridge) {
      return {
        month: input.month || "",
        broughtForward: 0,
        monthSpend: 0,
        monthRepay: 0,
        monthNet: 0,
        closingOpen: 0,
        stewMonth: 0,
        shopMonth: 0,
        stewPrior: 0,
        shopPrior: 0,
        repayToPrior: 0,
        repayToThis: 0,
        priorLines: [],
        monthLines: [],
        monthRepayLines: [],
      };
    }
    var month = input.month || input.focusMonth || "";
    var all = input.expenses || input.allExpenses || [];
    var dto = models.summarizeCaptainPocketMonthBridge(all, month);
    /* Optional display labels only (not money rules) */
    if (models.expenseMonthKey || month) {
      dto.monthLabel = input.monthLabel || month;
    }
    return dto;
  }

  return {
    monthSettlement: monthSettlement,
    openPocketOuts: openPocketOuts,
    openCrewDayPay: openCrewDayPay,
    openTipPayouts: openTipPayouts,
    dayPayOwedSummary: dayPayOwedSummary,
    ownMoneyRepaid: ownMoneyRepaid,
    ownMoneyIsRepaid: ownMoneyIsRepaid,
    ownMoneyRepayHint: ownMoneyRepayHint,
    pocketBalances: pocketBalances,
    captainPocketMonthBridge: captainPocketMonthBridge,
  };
});
