/**
 * LY_MODELS · expenses (petty cash, reimbursement, crew day-pay)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory(typeof module === "object" && module.exports ? require("./util.js") : (root.LY_MODELS_PARTS || {}).util);
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.expenses = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;

/* ---------- Expenses / petty envelope (structured fields only) ---------- */

var EXP_REIMBURSE_CATS = {
  "Captain reimbursement": 1,
  "Crew reimbursement": 1,
  Reimbursement: 1,
};
var EXP_POCKET_CAPTAIN = "captain";

/**
 * Reimbursement = boat (or captain) repays someone for a pocket spend.
 * Source of truth (any one is enough):
 *   - category in EXP_REIMBURSE_CATS
 *   - reimburseCaptain / reimburseCrew flags
 *   - reimbursesExpenseId link to the original own-money spend
 * Description text is NEVER used.
 */
function isExpenseReimbursement(e) {
  if (!e) return false;
  if (e.reimburseCaptain === true || e.reimburseCrew === true) return true;
  if (e.reimbursesExpenseId != null && String(e.reimbursesExpenseId) !== "") return true;
  var c = String(e.category || "");
  return !!EXP_REIMBURSE_CATS[c];
}

/**
 * Label looks like captain/crew pocket (not boat petty).
 * Explicit "Petty cash" is never own.
 */
function expensePaidFromLooksOwn(label) {
  var p = String(label || "").trim();
  if (!p) return false;
  if (/^petty\b/i.test(p) || p === "Petty cash") return false;
  if (p === "Own money" || /^own money\b/i.test(p) || /\bown money\b/i.test(p)) return true;
  if (/^(my|captain'?s?|capt\.?)\s+(money|pocket|personal)/i.test(p)) return true;
  if (/^captain\b/i.test(p) || /^capt\.?\b/i.test(p)) return true;
  if (/^personal\b/i.test(p) || /^from me\b/i.test(p) || /^captain pocket\b/i.test(p)) return true;
  if (/\bpocket\b/i.test(p) && !/\bpetty\b/i.test(p)) return true;
  return false;
}

/**
 * Paid-from envelope: petty | own | card.
 * Own (capt pocket / crew pocket / paidById) NEVER counts as petty out.
 */
function expensePaidFrom(e) {
  if (!e) return "petty";
  if (String(e.payMethod || "") === "Credit Card") return "card";
  var p = String(e.paidFrom || "").trim();
  if (expensePaidFromLooksOwn(p)) return "own";
  if (p === "Petty cash" || /^petty\b/i.test(p)) return "petty";
  if (e.paidById != null && String(e.paidById) !== "") return "own";
  if (isExpenseReimbursement(e)) return "petty";
  if (!p) return "petty";
  return "petty";
}

/**
 * Physical cash left the boat envelope?
 * Own money / captain pocket / paidById → never.
 * Crew day-pay → only floatPay === true and not own.
 */
function expenseHitsPettyCash(e, opts) {
  opts = opts || {};
  if (!e) return false;
  if (opts.isCrewDayPay) {
    if (e.crewPayStatus !== "Paid") return false;
    if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return false;
    return e.floatPay === true;
  }
  var pf = expensePaidFrom(e);
  if (pf === "card" || pf === "own") return false;
  if (isExpenseReimbursement(e)) return pf === "petty";
  return true;
}

/** Normalize reimbursement row to explicit structured fields (idempotent). */
function normalizeExpenseReimbursement(e) {
  if (!e || !isExpenseReimbursement(e)) return { changed: false, expense: e };
  var dirty = false;
  var out = e;
  function set(k, v) {
    if (out[k] !== v) {
      out[k] = v;
      dirty = true;
    }
  }
  if (String(out.payMethod || "") === "Credit Card") set("payMethod", "Cash");
  var pf = expensePaidFrom(out);
  if (pf === "own") {
    set("paidFrom", "Own money");
    if (!out.paidById) set("paidById", EXP_POCKET_CAPTAIN);
  } else {
    set("paidFrom", "Petty cash");
    set("paidById", "");
  }
  var to =
    out.reimburseToId != null && String(out.reimburseToId) !== ""
      ? String(out.reimburseToId)
      : out.reimburseCaptain
        ? EXP_POCKET_CAPTAIN
        : EXP_POCKET_CAPTAIN;
  set("reimburseToId", to);
  if (to === EXP_POCKET_CAPTAIN) {
    set("category", "Captain reimbursement");
    set("reimburseCaptain", true);
    set("reimburseCrew", false);
  } else {
    if (!EXP_REIMBURSE_CATS[String(out.category || "")]) set("category", "Crew reimbursement");
    set("reimburseCaptain", false);
    set("reimburseCrew", true);
  }
  set("chargeTo", "boat");
  return { changed: dirty, expense: out };
}

/**
 * Classify one expense for envelope + pocket books.
 * Returns a plain DTO — UI must not invent parallel rules.
 */
function classifyExpenseCash(e, opts) {
  opts = opts || {};
  var a = round2(num(e && e.amount));
  var reimb = isExpenseReimbursement(e);
  var pf = expensePaidFrom(e);
  var hitsPetty = expenseHitsPettyCash(e, opts);
  return {
    amount: a,
    isReimbursement: reimb,
    paidFrom: pf, /* petty | own | card */
    hitsPettyCash: hitsPetty,
    hitsOwnMoneyPocket: !reimb && pf === "own",
    /* Reimburse recipient always gets pocket credit when row is a reimbursement */
    clearsPocketFor:
      reimb && e
        ? e.reimburseToId != null && String(e.reimburseToId) !== ""
          ? String(e.reimburseToId)
          : EXP_POCKET_CAPTAIN
        : "",
    /* Who funded an own-money reimbursement (boat now owes them) */
    ownMoneyPayerId:
      reimb && pf === "own"
        ? e.paidById != null && String(e.paidById) !== ""
          ? String(e.paidById)
          : EXP_POCKET_CAPTAIN
        : !reimb && pf === "own"
          ? e.paidById != null && String(e.paidById) !== ""
            ? String(e.paidById)
            : EXP_POCKET_CAPTAIN
          : "",
  };
}

/**
 * Crew day-pay line from Stews (or equivalent Crew Salaries day-pay).
 * Pure — no DOM.
 */
function isCrewDayPayExpense(e) {
  if (!e) return false;
  if (e.stewPayKind === "dayPay") return true;
  if (e.source === "stew" && (e.stewEventKey || e.stewId)) return true;
  if (e.linkId != null && String(e.linkId).indexOf("stew-day:") === 0) return true;
  return false;
}

/** Stable person+day key for crew day-pay (linkId alone is not enough — renames create dupes). */
function crewDayPayFinger(e) {
  if (!e) return "";
  var sid = e.stewId != null && String(e.stewId) !== "" ? String(e.stewId) : "";
  var d = String(e.date || "").slice(0, 10);
  if (sid && /^\d{4}-\d{2}-\d{2}$/.test(d)) return sid + "|" + d;
  if (e.linkId != null && String(e.linkId) !== "") return "link:" + String(e.linkId);
  if (e.id != null) return "id:" + String(e.id);
  return "";
}

function crewDayPayLinkId(e) {
  if (!e) return "";
  if (e.linkId != null && String(e.linkId) !== "") return String(e.linkId);
  if (e.stewEventKey && e.stewId) return "stew-day:" + e.stewEventKey + ":" + e.stewId;
  return "";
}

/**
 * Cash left the boat for this crew day-pay only when floatPay === true.
 * Paid status alone never moves petty (prior books / auto status).
 */
function crewDayPayHitsPetty(e) {
  if (!isCrewDayPayExpense(e)) return false;
  if (String(e.crewPayStatus || "") !== "Paid") return false;
  if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return false;
  return e.floatPay === true;
}

/**
 * Score for picking the single surviving crew day-pay line per finger.
 * Prefer: Paid + floatPay (real petty) → Paid → Unpaid; then newest updatedAt;
 * then payStatusManual; then amount (stable, not always higher — use updatedAt first).
 */
function crewDayPayLineScore(e) {
  if (!e) return -1;
  var s = 0;
  var paid = String(e.crewPayStatus || "") === "Paid";
  if (paid) s += 100000;
  if (crewDayPayHitsPetty(e)) s += 50000;
  if (e.payStatusManual === true) s += 10000;
  if (e.floatPay === false && paid) s += 1000; /* explicit prior preferred over ambiguous */
  var u = String(e.updatedAt || "");
  /* Lexicographic ISO timestamps as points (coarse but stable) */
  if (u.length >= 10) {
    var t = Date.parse(u);
    if (!isNaN(t)) s += Math.min(9999, Math.floor(t / 1000000) % 10000);
  }
  s += Math.min(999, Math.round(num(e.amount)));
  return s;
}

/**
 * Collapse crew day-pay expenses to one line per stew|date (pure).
 * Returns { expenses, removed, removedIds, collapsed }.
 * Does not mutate input array elements except via reference choice of winners.
 */
function collapseCrewDayPayExpenses(expenses) {
  var list = Array.isArray(expenses) ? expenses.filter(Boolean) : [];
  var best = {};
  var bestScore = {};
  var nonCrew = [];
  var seen = {};
  list.forEach(function (e) {
    if (!isCrewDayPayExpense(e)) {
      nonCrew.push(e);
      return;
    }
    var f = crewDayPayFinger(e);
    if (!f) {
      nonCrew.push(e);
      return;
    }
    var sc = crewDayPayLineScore(e);
    if (bestScore[f] == null || sc > bestScore[f]) {
      bestScore[f] = sc;
      best[f] = e;
    }
  });
  var winners = [];
  Object.keys(best).forEach(function (f) {
    winners.push(best[f]);
    seen[String(best[f].id)] = 1;
  });
  var removed = [];
  list.forEach(function (e) {
    if (!isCrewDayPayExpense(e)) return;
    var f = crewDayPayFinger(e);
    if (!f) return;
    if (best[f] && best[f] !== e) removed.push(e);
  });
  return {
    expenses: winners.concat(nonCrew),
    removed: removed,
    removedIds: removed.map(function (e) {
      return e && e.id != null ? String(e.id) : "";
    }),
    collapsed: removed.length,
    winnerByFinger: best,
  };
}

/**
 * Pure petty cash on board.
 *   pettyCash = pettyStart + sum(cashIns) − sum(cashOut)
 * Cash out:
 *   - non-crew: expenseHitsPettyCash
 *   - crew day-pay: only floatPay (after collapse to one line per stew|date)
 * Never subtracts unpaid people (that is float books, not petty).
 *
 * @param {{ pettyStart?: number, cashIns?: Array, expenses?: Array }} opts
 */
function summarizePettyCash(opts) {
  opts = opts || {};
  var start = round2(num(opts.pettyStart));
  var cashIns = Array.isArray(opts.cashIns) ? opts.cashIns : [];
  var cashInTotal = 0;
  cashIns.forEach(function (r) {
    if (!r) return;
    cashInTotal += num(r.amount);
  });
  cashInTotal = round2(cashInTotal);
  var cashInHand = round2(start + cashInTotal);

  var col = collapseCrewDayPayExpenses(opts.expenses || []);
  var expenses = col.expenses;
  var cashOut = 0;
  var cashOutLines = [];
  var crewPaidPetty = 0;
  var nCrewPetty = 0;

  expenses.forEach(function (e) {
    if (!e) return;
    var a = round2(num(e.amount));
    if (!(a > 0)) return;
    if (isCrewDayPayExpense(e)) {
      if (!crewDayPayHitsPetty(e)) return;
      cashOut += a;
      crewPaidPetty += a;
      nCrewPetty++;
      cashOutLines.push({
        kind: "crew",
        label: (e.vendor || "Crew") + " day pay",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
        finger: crewDayPayFinger(e),
      });
      return;
    }
    var cls = classifyExpenseCash(e);
    if (!cls.hitsPettyCash) return;
    cashOut += a;
    cashOutLines.push({
      kind: cls.isReimbursement ? "reimburse" : "expense",
      label: e.vendor || e.category || "Expense",
      amount: a,
      id: e.id,
      date: String(e.date || "").slice(0, 10),
    });
  });
  cashOut = round2(cashOut);
  crewPaidPetty = round2(crewPaidPetty);
  var pettyCash = round2(cashInHand - cashOut);
  /* Newest first for captain audit */
  cashOutLines.sort(function (a, b) {
    var da = String((a && a.date) || "");
    var db = String((b && b.date) || "");
    if (da !== db) return db < da ? -1 : 1;
    return (Number(b && b.amount) || 0) - (Number(a && a.amount) || 0);
  });
  return {
    pettyStart: start,
    cashInTotal: cashInTotal,
    cashInHand: cashInHand,
    cashOut: cashOut,
    cashOutLines: cashOutLines,
    pettyCash: pettyCash,
    pettyOnboard: pettyCash,
    crewPaidPetty: crewPaidPetty,
    nCrewPetty: nCrewPetty,
    nCrewCollapsed: col.collapsed,
    collapsedExpenses: expenses,
    removedIds: col.removedIds,
  };
}


  return {
    EXP_REIMBURSE_CATS: EXP_REIMBURSE_CATS,
    EXP_POCKET_CAPTAIN: EXP_POCKET_CAPTAIN,
    isExpenseReimbursement: isExpenseReimbursement,
    expensePaidFromLooksOwn: expensePaidFromLooksOwn,
    expensePaidFrom: expensePaidFrom,
    expenseHitsPettyCash: expenseHitsPettyCash,
    normalizeExpenseReimbursement: normalizeExpenseReimbursement,
    classifyExpenseCash: classifyExpenseCash,
    isCrewDayPayExpense: isCrewDayPayExpense,
    crewDayPayFinger: crewDayPayFinger,
    crewDayPayLinkId: crewDayPayLinkId,
    crewDayPayHitsPetty: crewDayPayHitsPetty,
    crewDayPayLineScore: crewDayPayLineScore,
    collapseCrewDayPayExpenses: collapseCrewDayPayExpenses,
    summarizePettyCash: summarizePettyCash
  };
});
