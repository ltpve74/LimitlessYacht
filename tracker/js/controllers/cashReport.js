/**
 * LY_CONTROLLERS.cashReport — month cash / expense PDF DTO.
 *
 * Assembles pure LY_MODELS into one report DTO. No DOM. No € formulas —
 * only inputs → model calls → DTO out.
 *
 * PDF builder paints this DTO only (tracker/js/pdf/expenses-cash.js).
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports
      ? require("../models.js")
      : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.cashReport = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m =
      (input && input.models) ||
      defaultModels ||
      (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.cashReport: LY_MODELS missing");
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

  function pettyRowFor(expPetty, month) {
    month = String(month || "").slice(0, 7);
    var rows = Array.isArray(expPetty) ? expPetty : [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && String(rows[i].month || "").slice(0, 7) === month) return rows[i];
    }
    return null;
  }

  /**
   * Full month cash report DTO for PDF / exports.
   *
   * @param {object} input
   * @param {object} input.models
   * @param {string} input.month YYYY-MM
   * @param {string} [input.monthLabel]
   * @param {Array} input.expenses
   * @param {Array} input.expPetty
   * @param {function} [input.isTipExpense]
   * @param {function} [input.cashInIsTip]
   * @param {function} [input.personName]
   * @param {object} [input.bizMonth] { n, gross, base, comm } optional precomputed
   * @param {object} [input.bizThrough] same shape through end of month
   */
  function monthReport(input) {
    input = input || {};
    var models = M(input);
    var month = String(input.month || input.focusMonth || "").slice(0, 7);
    var allRaw = input.expenses || input.allExpenses || [];
    var through = models.filterLedgerThroughMonth
      ? models.filterLedgerThroughMonth(allRaw, month)
      : allRaw;

    var open = models.resolvePettyMonthOpen
      ? models.resolvePettyMonthOpen(month, input.expPetty || [], allRaw, {
          isTipExpense: input.isTipExpense,
          cashInIsTip: input.cashInIsTip,
        })
      : {
          pettyStart: 0,
          broughtForwardShort: 0,
          cashIns: [],
          source: "empty",
        };

    var monthLines = linesForMonth(allRaw, month, models);
    if (typeof input.isTipExpense === "function") {
      monthLines = monthLines.filter(function (e) {
        return e && !input.isTipExpense(e);
      });
    }

    var cashIns = open.cashIns || [];
    if (typeof input.cashInIsTip === "function") {
      cashIns = cashIns.filter(function (r) {
        return r && !input.cashInIsTip(r);
      });
    }
    /* Drop cash-in rows dated after report month */
    cashIns = cashIns.filter(function (r) {
      if (!r) return false;
      var dm = String(r.date || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(dm) && dm > month) return false;
      return true;
    });

    var pettySum = models.summarizePettyCash({
      pettyStart: open.pettyStart,
      broughtForwardShort: open.broughtForwardShort,
      cashIns: cashIns,
      expenses: monthLines,
    });

    var crew = models.summarizeCrewPayMonth
      ? models.summarizeCrewPayMonth(allRaw, month, { leads: input.leads || [] })
      : {
          paidTotal: 0,
          fromBoatPot: 0,
          fromCaptain: 0,
          fromOwner: 0,
          booksOnly: 0,
          potLines: [],
          captainLines: [],
          booksLines: [],
        };

    var outBuckets = models.summarizePettyCashOutBuckets
      ? models.summarizePettyCashOutBuckets(monthLines)
      : {
          commission: 0,
          crewDayPay: crew.fromBoatPot || 0,
          reimburseCaptain: 0,
          reimburseCrew: 0,
          tipPayout: 0,
          otherPetty: 0,
          commissionLines: [],
        };

    /* Prefer model pot crew from crew DTO (same rule as buckets) */
    outBuckets.crewDayPay = crew.fromBoatPot;

    var pocketStory = models.summarizeCaptainPocketMonthBridge
      ? models.summarizeCaptainPocketMonthBridge(allRaw, month)
      : null;
    if (pocketStory && input.monthLabel) pocketStory.monthLabel = input.monthLabel;

    var bizMonth = input.bizMonth || { n: 0, gross: 0, base: 0, comm: 0 };
    var bizThrough = input.bizThrough || { n: 0, gross: 0, base: 0, comm: 0 };

    var commBal = models.summarizeCaptainCommissionBalance
      ? models.summarizeCaptainCommissionBalance({
          earned: bizThrough.comm || 0,
          expenses: through,
        })
      : { earned: bizThrough.comm || 0, paid: 0, outstanding: bizThrough.comm || 0 };

    var cashInRows = cashIns.map(function (r) {
      return {
        date: String((r && r.date) || "").slice(0, 10),
        label: String((r && (r.source || r.notes || r.note || r.label)) || "Cash in").trim() || "Cash in",
        amount: models.round2 ? models.round2(models.num ? models.num(r.amount) : Number(r.amount) || 0) : Math.round((Number(r.amount) || 0) * 100) / 100,
      };
    }).filter(function (r) {
      return r.amount > 0.009;
    });

    var cashInTotal = 0;
    cashInRows.forEach(function (r) {
      cashInTotal += r.amount;
    });
    cashInTotal = Math.round(cashInTotal * 100) / 100;
    if (!(cashInTotal > 0.009) && pettySum.cashInTotal != null) {
      cashInTotal = pettySum.cashInTotal;
    }

    /* Pot cash-out detail lines from petty model */
    var potDetailLines = (pettySum.cashOutLines || []).filter(function (r) {
      return r && !r.virtual;
    });

    /* Who / which pot lines the short sits on (model shortLines) */
    var shortLines = Array.isArray(pettySum.shortLines)
      ? pettySum.shortLines.map(function (s) {
          return {
            kind: s.kind || "",
            label: s.label || "Cash out",
            amount: s.amount || 0,
            fullAmount: s.fullAmount != null ? s.fullAmount : s.amount || 0,
            covered: s.covered != null ? s.covered : 0,
            date: s.date || "",
            id: s.id || "",
          };
        })
      : [];

    return {
      month: month,
      monthLabel: input.monthLabel || month,
      generatedAt: new Date().toISOString(),
      asOfMonth: month,
      cardExcluded: true,

      /* Boat pot — model summarizePettyCash */
      pettyStart: Math.max(0, pettySum.physicalStart != null ? pettySum.physicalStart : pettySum.pettyStart || 0),
      broughtForwardShort: Math.max(0, pettySum.broughtForwardShort || 0),
      priorSettled: Math.max(0, pettySum.priorSettled || 0),
      cashInTotal: cashInTotal,
      cashIns: cashInRows,
      cashOut: pettySum.cashOut || 0,
      pettyOnboard: Math.max(0, pettySum.pettyOnboard != null ? pettySum.pettyOnboard : pettySum.pettyCash || 0),
      cashShort: Math.max(0, pettySum.cashShort || 0),
      shortLines: shortLines,
      cashOutLines: potDetailLines,

      /* Cash-out buckets — model (crew = fromBoatPot only) */
      outBuckets: {
        commission: outBuckets.commission || 0,
        crewDayPay: outBuckets.crewDayPay || 0,
        reimburseCaptain: outBuckets.reimburseCaptain || 0,
        reimburseCrew: outBuckets.reimburseCrew || 0,
        tipPayout: outBuckets.tipPayout || 0,
        otherPetty: outBuckets.otherPetty || 0,
      },
      commissionLines: outBuckets.commissionLines || [],

      /* Crew — model summarizeCrewPayMonth (no frontend sums) */
      crew: crew,
      crewFromPot: crew.fromBoatPot,
      crewFromCaptain: crew.fromCaptain,
      crewFromOwner: crew.fromOwner,
      crewFromBooks: crew.booksOnly,
      crewPaidTotal: crew.paidTotal,
      crewLinesPot: crew.potLines,
      crewLinesCaptain: crew.captainLines,
      crewLinesBooks: crew.booksLines,
      crewLines: crew.potLines,

      /* Captain pocket — model bridge as-of month end */
      pocketStory: pocketStory,

      /* Commission — earned from biz DTO; paid/outstanding from model on through ledger */
      commissionEarned: commBal.earned != null ? commBal.earned : bizThrough.comm || 0,
      commissionPaidAll: commBal.paid != null ? commBal.paid : 0,
      commissionOpen: commBal.outstanding != null ? commBal.outstanding : 0,
      commissionPaidThisMonth: outBuckets.commission || 0,
      bizMonthGross: bizMonth.gross || 0,
      bizMonthBase: bizMonth.base || 0,
      bizMonthComm: bizMonth.comm || 0,
      bizMonthN: bizMonth.n || 0,
      bizThroughGross: bizThrough.gross || 0,
      bizThroughBase: bizThrough.base || 0,
      bizThroughComm: bizThrough.comm || 0,
      bizThroughN: bizThrough.n || 0,
      bizAllGross: bizThrough.gross || 0,
      bizAllBase: bizThrough.base || 0,
      bizAllComm: bizThrough.comm || 0,
      bizAllN: bizThrough.n || 0,
    };
  }

  return {
    monthReport: monthReport,
  };
});
