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
 * Captain commission draw from the boat envelope (expense ledger).
 * Category "Captain commission" / kind captainComm — cash + petty only counts as paid.
 */
function isCaptainCommissionExpense(e) {
  if (!e) return false;
  if (e.kind === "captainComm" || e.commPayout === true) return true;
  return /^captain commission$/i.test(String(e.category || ""));
}

/**
 * Sum of commission cash actually taken from petty (not card / own money).
 * @param {Array} expenses
 */
function summarizeCaptainCommissionPaid(expenses) {
  var paid = 0;
  var payouts = [];
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!isCaptainCommissionExpense(e)) return;
    if (String(e.payMethod || "") === "Credit Card") return;
    var pf = expensePaidFrom(e);
    if (pf === "own" || pf === "card") return;
    var a = round2(num(e.amount));
    if (!(a > 0)) return;
    paid = round2(paid + a);
    payouts.push(e);
  });
  payouts.sort(function (a, b) {
    var da = String((b && b.date) || "");
    var db = String((a && a.date) || "");
    if (da !== db) return da < db ? -1 : 1;
    return String((b && b.updatedAt) || "").localeCompare(String((a && a.updatedAt) || ""));
  });
  return { paid: paid, payouts: payouts, n: payouts.length };
}

/**
 * Captain commission balance for Leads / Commissions UI.
 *   earned = deals + upsells (caller computes from leads/charges)
 *   paid   = sum of petty commission draws
 *   outstanding = max(0, earned − paid)
 *
 * @param {{ earned?: number, expenses?: Array }} opts
 */
function summarizeCaptainCommissionBalance(opts) {
  opts = opts || {};
  var earned = round2(Math.max(0, num(opts.earned)));
  var paidSum = summarizeCaptainCommissionPaid(opts.expenses);
  var paid = paidSum.paid;
  var outstanding = round2(Math.max(0, earned - paid));
  var overpaid = paid > earned + 0.009 ? round2(paid - earned) : 0;
  var status =
    earned < 0.01 && paid < 0.01
      ? "none"
      : outstanding < 0.01
        ? "paid"
        : paid > 0.009
          ? "partial"
          : "outstanding";
  return {
    earned: earned,
    paid: paid,
    outstanding: outstanding,
    overpaid: overpaid,
    status: status,
    payouts: paidSum.payouts,
    nPayouts: paidSum.n,
  };
}

/**
 * Cash cannot leave an empty envelope.
 * When start + cash-in ≈ 0 (or negative), any crew floatPay is impossible books
 * invent (re-save used to set floatPay from Paid alone → petty 0 → −€250).
 * Clear floatPay; keep Paid status (prior / not this pot).
 *
 * @param {Array} expenses
 * @param {number} pettyStart
 * @param {Array} cashIns
 * @returns {{ changed: boolean, cleared: Array, envelope: number, expenses: Array }}
 */
function clearCrewFloatPayOnEmptyEnvelope(expenses, pettyStart, cashIns) {
  /* Physical envelope only — poison negative start is not cash available */
  var physicalStart = Math.max(0, round2(num(pettyStart)));
  var cashInTotal = 0;
  (Array.isArray(cashIns) ? cashIns : []).forEach(function (r) {
    if (r) cashInTotal += num(r.amount);
  });
  cashInTotal = round2(cashInTotal);
  var envelope = round2(physicalStart + cashInTotal);
  var list = Array.isArray(expenses) ? expenses : [];
  if (envelope > 0.009) {
    return { changed: false, cleared: [], envelope: envelope, expenses: list };
  }
  var cleared = [];
  list.forEach(function (e) {
    if (!isCrewDayPayExpense(e)) return;
    if (String(e.crewPayStatus || "") !== "Paid") return;
    if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return;
    if (e.floatPay !== true) return;
    e.floatPay = false;
    cleared.push(e);
  });
  return {
    changed: cleared.length > 0,
    cleared: cleared,
    envelope: envelope,
    expenses: list,
  };
}

/**
 * Pure petty cash ledger.
 *
 * Physical notes cannot go negative (you cannot spend cash you do not have):
 *   physicalStart = max(0, storedStart)   // negative start is poison books, not notes
 *   cashInHand    = physicalStart + cashIns
 *   booksBalance  = physicalStart + cashIns − cashOut   (diagnostic; may be negative)
 *   pettyOnboard  = max(0, booksBalance)  // physical notes in the envelope
 *   cashShort     = max(0, −booksBalance) // over-marked cash-outs / bad start residue
 *
 * Cash out:
 *   - non-crew: expenseHitsPettyCash
 *   - crew day-pay: only floatPay (after collapse to one line per stew|date)
 * Never subtracts unpaid people (that is float books / still-owed, not petty).
 *
 * Carry next month’s start from pettyOnboard (never from a negative booksBalance).
 *
 * @param {{ pettyStart?: number, cashIns?: Array, expenses?: Array }} opts
 */
/**
 * Flatten + sum petty cash-in rows (envelope top-ups).
 * Controller supplies skip() for tips / own-money if needed.
 *
 * @param {Array} cashIns
 * @param {{ skip?: function }} [opts]
 * @returns {{ total, n, items }}
 */
function summarizePettyCashInRows(cashIns, opts) {
  opts = opts || {};
  var skip = typeof opts.skip === "function" ? opts.skip : function () {
    return false;
  };
  var total = 0;
  var items = [];
  (Array.isArray(cashIns) ? cashIns : []).forEach(function (r) {
    if (!r || skip(r)) return;
    var a = round2(num(r.amount));
    if (!(a > 0.009)) return;
    total = round2(total + a);
    items.push({
      id: r.id != null ? String(r.id) : "",
      amount: a,
      date: String(r.date || "").slice(0, 10),
      label: String(r.note || r.notes || r.source || r.label || "Cash in").trim() || "Cash in",
      kind: "cash-in",
      month: r.month ? String(r.month).slice(0, 7) : String(r.date || "").slice(0, 7),
    });
  });
  items.sort(function (a, b) {
    var da = String(a.date || ""),
      db = String(b.date || "");
    if (da && db && da !== db) return db < da ? -1 : 1;
    return (b.amount || 0) - (a.amount || 0);
  });
  return { total: total, n: items.length, items: items };
}

/**
 * Collect cashIn rows from expPetty month records (nested cashIns arrays).
 * Pure — no DOM.
 *
 * @param {Array} expPetty  [{ month, cashIns: [...] }, ...]
 * @returns {Array}
 */
function collectPettyCashInsFromMonths(expPetty) {
  var out = [];
  (Array.isArray(expPetty) ? expPetty : []).forEach(function (p) {
    if (!p) return;
    var mon = String(p.month || "").slice(0, 7);
    (Array.isArray(p.cashIns) ? p.cashIns : []).forEach(function (r) {
      if (!r) return;
      var row = Object.assign({}, r);
      if (!row.month && mon) row.month = mon;
      if (!row.date && mon) row.date = mon + "-01";
      out.push(row);
    });
    /* Legacy single pettyIn on month row */
    if ((!p.cashIns || !p.cashIns.length) && num(p.pettyIn) > 0.009) {
      out.push({
        id: "pettyIn:" + mon,
        amount: num(p.pettyIn),
        date: mon ? mon + "-01" : "",
        month: mon,
        note: "Cash in (month total)",
        source: "pettyIn",
      });
    }
  });
  return out;
}

function summarizePettyCash(opts) {
  opts = opts || {};
  var storedStart = round2(num(opts.pettyStart));
  /* Physical start: notes only — never carry a negative “start” as cash */
  var physicalStart = storedStart > 0 ? storedStart : 0;
  var priorStartShort = storedStart < 0 ? round2(-storedStart) : 0;
  var cashIns = Array.isArray(opts.cashIns) ? opts.cashIns : [];
  var cashInTotal = 0;
  cashIns.forEach(function (r) {
    if (!r) return;
    cashInTotal += num(r.amount);
  });
  cashInTotal = round2(cashInTotal);
  var cashInHand = round2(physicalStart + cashInTotal);

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
      cashOutLines.push({
        kind: "crew",
        purpose: "daypay",
        purposeLabel: "Crew day pay",
        label: (e.vendor || "Crew") + " · day pay",
        detail: e.description || "",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
        finger: crewDayPayFinger(e),
      });
      nCrewPetty++;
      return;
    }
    /* On-bill tip payout from petty */
    if (
      e.kind === "tipPayout" ||
      e.stewPayKind === "tipPayout" ||
      /^crew tip payout$/i.test(String(e.category || ""))
    ) {
      if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return;
      cashOut += a;
      cashOutLines.push({
        kind: "tip",
        purpose: "tip-payout",
        purposeLabel: "Crew tip payout",
        label: e.vendor || "Crew tips (on bill)",
        detail: e.description || "Tips from guest bill → paid to crew from petty",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
      });
      return;
    }
    /* Captain commission draw to self */
    if (isCaptainCommissionExpense(e)) {
      if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return;
      cashOut += a;
      cashOutLines.push({
        kind: "commission",
        purpose: "commission",
        purposeLabel: "Your commission",
        label: "Commission to you",
        detail: e.description || e.vendor || "Captain commission draw from boat float",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
      });
      return;
    }
    var cls = classifyExpenseCash(e);
    if (!cls.hitsPettyCash) return;
    cashOut += a;
    if (cls.isReimbursement) {
      var who =
        e.reimburseToId != null && String(e.reimburseToId) !== ""
          ? String(e.reimburseToId)
          : e.reimburseCaptain
            ? EXP_POCKET_CAPTAIN
            : "";
      var whoLab =
        who === EXP_POCKET_CAPTAIN || who === "captain" || !who
          ? "you (pocket repay)"
          : "crew pocket";
      cashOutLines.push({
        kind: "reimburse",
        purpose: "reimburse",
        purposeLabel:
          who === EXP_POCKET_CAPTAIN || who === "captain" || !who
            ? "Reimbursement to you"
            : "Reimbursement to crew",
        label:
          who === EXP_POCKET_CAPTAIN || who === "captain" || !who
            ? "Repay you · pocket spend"
            : "Repay crew · pocket spend",
        detail: e.vendor || e.description || e.category || "",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
        reimburseTo: who || EXP_POCKET_CAPTAIN,
        whoLab: whoLab,
      });
      return;
    }
    cashOutLines.push({
      kind: "expense",
      purpose: "shop",
      purposeLabel: e.category || "Boat expense",
      label: e.vendor || e.category || "Expense",
      detail: e.description || e.category || "",
      amount: a,
      id: e.id,
      date: String(e.date || "").slice(0, 10),
    });
  });
  cashOut = round2(cashOut);
  crewPaidPetty = round2(crewPaidPetty);
  /* Month books from physical start (never use negative start as cash) */
  var booksBalance = round2(cashInHand - cashOut);
  var pettyOnboard = booksBalance > 0 ? booksBalance : 0;
  var monthShort = booksBalance < 0 ? round2(-booksBalance) : 0;
  /* Total short = this month over-mark + any poison negative start residue */
  var cashShort = round2(monthShort + priorStartShort);

  /*
   * Where is the short from? (audit trail — pure, for UI)
   * 1) priorStartShort: stored start was negative (poison carry, not notes)
   * 2) cash-out lines in date order: first outs take real envelope; remainder is short
   */
  var shortLines = [];
  if (priorStartShort > 0.009) {
    shortLines.push({
      kind: "prior-start",
      label: "Stored start was −" + priorStartShort.toFixed(2).replace(/\.00$/, "") + " (not physical notes)",
      amount: priorStartShort,
      date: "",
      id: "",
    });
  }
  if (monthShort > 0.009 && cashOutLines.length) {
    var chrono = cashOutLines.slice().sort(function (a, b) {
      var da = String((a && a.date) || "");
      var db = String((b && b.date) || "");
      if (da !== db) return da < db ? -1 : 1;
      return (Number(a && a.amount) || 0) - (Number(b && b.amount) || 0);
    });
    var remaining = cashInHand;
    chrono.forEach(function (row) {
      if (!row) return;
      var a = round2(num(row.amount));
      if (!(a > 0)) return;
      var covered = remaining > 0 ? Math.min(a, remaining) : 0;
      remaining = round2(remaining - covered);
      var over = round2(a - covered);
      if (over > 0.009) {
        shortLines.push({
          kind: row.kind || "expense",
          label: row.label || "Cash out",
          amount: over,
          fullAmount: a,
          covered: covered,
          date: row.date || "",
          id: row.id || "",
          finger: row.finger || "",
        });
      }
    });
  }

  /* Newest first for captain cash-out audit list */
  cashOutLines.sort(function (a, b) {
    var da = String((a && a.date) || "");
    var db = String((b && b.date) || "");
    if (da !== db) return db < da ? -1 : 1;
    return (Number(b && b.amount) || 0) - (Number(a && a.amount) || 0);
  });
  return {
    pettyStart: storedStart,
    physicalStart: physicalStart,
    priorStartShort: priorStartShort,
    cashInTotal: cashInTotal,
    cashInHand: cashInHand,
    cashOut: cashOut,
    cashOutLines: cashOutLines,
    /* booksBalance: diagnostic (can be negative from over-marked outs this month) */
    booksBalance: booksBalance,
    /* Physical notes — never negative */
    pettyCash: pettyOnboard,
    pettyOnboard: pettyOnboard,
    cashShort: cashShort,
    monthShort: monthShort,
    shortLines: shortLines,
    crewPaidPetty: crewPaidPetty,
    nCrewPetty: nCrewPetty,
    nCrewCollapsed: col.collapsed,
    collapsedExpenses: expenses,
    removedIds: col.removedIds,
  };
}

/* ==========================================================================
 * Pocket liabilities (Keepafloat foundation)
 * Pure: expenses + assigns in, DTOs out. UI must not re-implement repay/FIFO.
 * ========================================================================== */

/** YYYY-MM from a date string. */
function expenseMonthKey(d) {
  var s = String(d || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

/** Who a reimbursement pays back. */
function expenseReimburseWhoId(e) {
  if (!e) return EXP_POCKET_CAPTAIN;
  if (e.reimburseToId != null && String(e.reimburseToId) !== "") return String(e.reimburseToId);
  if (e.reimburseCaptain || String(e.category || "") === "Captain reimbursement") return EXP_POCKET_CAPTAIN;
  if (e.reimburseCrew && e.reimburseToId) return String(e.reimburseToId);
  return EXP_POCKET_CAPTAIN;
}

/**
 * Own-money pocket spend (shop or Paid crew day-pay from own money).
 * Reimbursements are NOT spends.
 */
function isOwnMoneySpend(e) {
  if (!e || isExpenseReimbursement(e)) return false;
  if (isCrewDayPayExpense(e)) {
    if (String(e.crewPayStatus || "") !== "Paid") return false;
    return expensePaidFrom(e) === "own";
  }
  return expensePaidFrom(e) === "own";
}

/** Who is owed for an own-money spend (captain or stew). */
function ownMoneySpendWhoId(e) {
  if (!e) return EXP_POCKET_CAPTAIN;
  if (e.paidById != null && String(e.paidById) !== "") return String(e.paidById);
  return EXP_POCKET_CAPTAIN;
}

/**
 * How much of an own-money expense is covered by reimbursements.
 * Linked by reimbursesExpenseId OR FIFO unlinked pool for that person.
 * Reimbursements in ANY month count (July spend can be repaid in August).
 *
 * @param {object} e own-money expense
 * @param {Array} expenses full ledger (all months)
 */
function ownMoneyRepaidAmt(e, expenses) {
  if (!isOwnMoneySpend(e)) return 0;
  var need = round2(num(e.amount));
  if (!(need > 0)) return 0;
  var list = Array.isArray(expenses) ? expenses : [];
  var linked = 0;
  list.forEach(function (r) {
    if (!r || !isExpenseReimbursement(r)) return;
    if (String(r.reimbursesExpenseId || "") !== String(e.id)) return;
    linked += num(r.amount);
  });
  linked = round2(linked);
  if (linked >= need - 0.009) return need;

  var who = ownMoneySpendWhoId(e);
  var pool = 0;
  list.forEach(function (r) {
    if (!r || !isExpenseReimbursement(r)) return;
    if (String(expenseReimburseWhoId(r) || "") !== String(who)) return;
    if (r.reimbursesExpenseId) return;
    pool += num(r.amount);
  });
  pool = round2(pool);

  var own = list
    .filter(function (x) {
      return isOwnMoneySpend(x) && String(ownMoneySpendWhoId(x)) === String(who);
    })
    .sort(function (a, b) {
      var c = String(a.date || "").localeCompare(String(b.date || ""));
      if (c) return c;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

  var left = pool;
  var forThis = 0;
  for (var i = 0; i < own.length; i++) {
    var x = own[i];
    var a = round2(num(x.amount));
    var direct = 0;
    list.forEach(function (r) {
      if (r && String(r.reimbursesExpenseId || "") === String(x.id)) direct += num(r.amount);
    });
    direct = round2(direct);
    var remain = Math.max(0, a - direct);
    if (String(x.id) === String(e.id)) {
      forThis = Math.min(remain, left) + direct;
      break;
    }
    left = Math.max(0, left - remain);
  }
  return round2(Math.min(need, Math.max(linked, forThis)));
}

function ownMoneyIsRepaid(e, expenses) {
  if (!isOwnMoneySpend(e)) return false;
  var need = round2(num(e.amount));
  if (!(need > 0)) return false;
  return ownMoneyRepaidAmt(e, expenses) >= need - 0.009;
}

/**
 * Best reimbursing row for display (linked preferred, else newest unlinked to who).
 * Returns { date, amount, id } or null — UI formats the date string.
 */
function ownMoneyRepayHint(e, expenses) {
  if (!isOwnMoneySpend(e) || !ownMoneyIsRepaid(e, expenses)) return null;
  var list = Array.isArray(expenses) ? expenses : [];
  var linked = [];
  list.forEach(function (r) {
    if (r && isExpenseReimbursement(r) && String(r.reimbursesExpenseId || "") === String(e.id)) linked.push(r);
  });
  if (linked.length) {
    linked.sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    return { date: String(linked[0].date || "").slice(0, 10), amount: num(linked[0].amount), id: linked[0].id };
  }
  var who = ownMoneySpendWhoId(e);
  var unlinked = [];
  list.forEach(function (r) {
    if (!r || !isExpenseReimbursement(r)) return;
    if (String(expenseReimburseWhoId(r) || "") !== String(who)) return;
    if (r.reimbursesExpenseId) return;
    unlinked.push(r);
  });
  if (!unlinked.length) return null;
  unlinked.sort(function (a, b) {
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
  return { date: String(unlinked[0].date || "").slice(0, 10), amount: num(unlinked[0].amount), id: unlinked[0].id };
}

/**
 * Open own-money spends (any month ≤ focusMonth) not fully repaid.
 *
 * @param {Array} expenses
 * @param {string} focusMonth YYYY-MM
 * @param {{ personName?: function }} opts
 */
function collectOpenPocketOuts(expenses, focusMonth, opts) {
  opts = opts || {};
  var nameOf =
    typeof opts.personName === "function"
      ? opts.personName
      : function () {
          return "Captain";
        };
  var out = [];
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e || isExpenseReimbursement(e)) return;
    var em = expenseMonthKey(e.date);
    if (em && focusMonth && em > focusMonth) return;
    if (!isOwnMoneySpend(e)) return;
    var a = round2(num(e.amount));
    if (!(a > 0)) return;
    var repaidAmt = ownMoneyRepaidAmt(e, expenses);
    var remain = round2(a - repaidAmt);
    if (remain < 0.01) return;
    var whoId = ownMoneySpendWhoId(e);
    var isCrew = isCrewDayPayExpense(e) || String(e.category || "") === "Crew Salaries";
    var kind = isCrew ? "crew" : "shop";
    var label = isCrew
      ? (e.vendor || "Crew") + " day pay" + (e.description ? " · " + String(e.description).slice(0, 40) : "")
      : (e.vendor || e.category || "Expense") + (e.description ? " · " + String(e.description).slice(0, 40) : "");
    out.push({
      kind: kind,
      whoId: whoId,
      who: nameOf(whoId),
      crewName: kind === "crew" ? e.vendor || "Crew" : "",
      label: label,
      amount: remain,
      fullAmount: a,
      repaidAmt: repaidAmt,
      repaid: false,
      id: e.id,
      date: String(e.date || "").slice(0, 10),
      month: em || "",
    });
  });
  out.sort(function (a, b) {
    var da = String(a.date || "");
    var db = String(b.date || "");
    if (da !== db) return db.localeCompare(da);
    return (b.amount || 0) - (a.amount || 0);
  });
  return out;
}

/**
 * Pocket balances: putIn (own-money cash-ins) + paidOut − reimbursed → owed.
 *
 * @param {Array} expenses month or all (caller scopes)
 * @param {Array} cashIns month cash-ins
 * @param {{ personName?: function, cashInIsOwnMoney?: function }} opts
 */
function summarizePocketBalances(expenses, cashIns, opts) {
  opts = opts || {};
  var nameOf =
    typeof opts.personName === "function"
      ? opts.personName
      : function (id) {
          return !id || String(id) === EXP_POCKET_CAPTAIN ? "Captain" : "Crew";
        };
  var cashInOwn =
    typeof opts.cashInIsOwnMoney === "function"
      ? opts.cashInIsOwnMoney
      : function (r) {
          return !!(r && (r.fromCaptain === true || r.ownMoney === true || expensePaidFromLooksOwn(r.source)));
        };
  var by = {};
  function ensure(id) {
    id = String(id || EXP_POCKET_CAPTAIN);
    if (!by[id])
      by[id] = { id: id, name: nameOf(id), putIn: 0, paidOut: 0, reimbursed: 0, owed: 0, overpaid: 0 };
    return by[id];
  }
  ensure(EXP_POCKET_CAPTAIN);
  (Array.isArray(cashIns) ? cashIns : []).forEach(function (r) {
    if (r && cashInOwn(r)) ensure(EXP_POCKET_CAPTAIN).putIn += num(r.amount);
  });
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e) return;
    var cls = classifyExpenseCash(e);
    if (cls.isReimbursement) {
      ensure(cls.clearsPocketFor || EXP_POCKET_CAPTAIN).reimbursed += num(e.amount);
      if (cls.paidFrom === "own" && cls.ownMoneyPayerId) {
        ensure(cls.ownMoneyPayerId).paidOut += num(e.amount);
      }
      return;
    }
    if (cls.hitsOwnMoneyPocket || (isCrewDayPayExpense(e) && expensePaidFrom(e) === "own" && String(e.crewPayStatus || "") === "Paid")) {
      ensure(cls.ownMoneyPayerId || ownMoneySpendWhoId(e) || EXP_POCKET_CAPTAIN).paidOut += num(e.amount);
    }
  });
  var list = [];
  var total = 0;
  Object.keys(by).forEach(function (k) {
    var row = by[k];
    var o = round2(row.putIn + row.paidOut - row.reimbursed);
    row.owed = o > 0 ? o : 0;
    row.overpaid = o < 0 ? -o : 0;
    row.putIn = round2(row.putIn);
    row.paidOut = round2(row.paidOut);
    row.reimbursed = round2(row.reimbursed);
    if (row.putIn > 0 || row.paidOut > 0 || row.reimbursed > 0 || row.owed > 0) list.push(row);
    total += row.owed;
  });
  list.sort(function (a, b) {
    if (a.id === EXP_POCKET_CAPTAIN) return -1;
    if (b.id === EXP_POCKET_CAPTAIN) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return {
    list: list,
    total: round2(total),
    byId: by,
    captain: by[EXP_POCKET_CAPTAIN] || ensure(EXP_POCKET_CAPTAIN),
  };
}

/**
 * Settled day-pay fingerprints from Paid expense lines.
 * Used so open-owed never re-lists charters already paid on the books.
 */
function buildCrewDayPaySettledSets(expenses) {
  var byEventStew = {};
  var byFinger = {};
  var byLink = {};
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e || !isCrewDayPayExpense(e)) return;
    if (String(e.crewPayStatus || "") !== "Paid") return;
    var sid = String(e.stewId || "");
    var d = String(e.date || "").slice(0, 10);
    var ek = String(e.stewEventKey || "");
    if (ek && sid) byEventStew[ek + "|" + sid] = 1;
    if (sid && d) byFinger[sid + "|" + d] = 1;
    var lid = e.linkId ? String(e.linkId) : "";
    if (lid) byLink[lid] = 1;
    if (ek && sid) byLink["stew-day:" + ek + ":" + sid] = 1;
  });
  return { byEventStew: byEventStew, byFinger: byFinger, byLink: byLink };
}

function isCrewDayPaySettled(asg, sid, settled) {
  if (!asg || !sid) return false;
  if (String(asg.payStatus || "") === "Paid") return true;
  settled = settled || { byEventStew: {}, byFinger: {}, byLink: {} };
  var ek = String(asg.eventKey || "");
  var d = String(asg.start || "").slice(0, 10);
  sid = String(sid);
  if (ek && settled.byEventStew[ek + "|" + sid]) return true;
  if (d && settled.byFinger[sid + "|" + d]) return true;
  if (ek && settled.byLink["stew-day:" + ek + ":" + sid]) return true;
  return false;
}

/**
 * Open unpaid day-pay through focus month.
 *
 * @param {Array} assigns stewAssign rows
 * @param {Array} expenses
 * @param {{
 *   focusMonth: string,
 *   today: string,
 *   dayPayAmt: function(asg, sid): number,
 *   isSkipped?: function(eventKey, sid): boolean,
 *   personName?: function(sid): string
 * }} opts
 */
function collectOpenCrewDayPay(assigns, expenses, opts) {
  opts = opts || {};
  var focusMonth = opts.focusMonth || "";
  var today = opts.today || "9999-12-31";
  var dayPayAmt =
    typeof opts.dayPayAmt === "function"
      ? opts.dayPayAmt
      : function (asg) {
          return num(asg && (asg.payEach != null ? asg.payEach : asg.dayRate));
        };
  var isSkipped =
    typeof opts.isSkipped === "function"
      ? opts.isSkipped
      : function () {
          return false;
        };
  var nameOf =
    typeof opts.personName === "function"
      ? opts.personName
      : function () {
          return "Stew";
        };
  var settled = buildCrewDayPaySettledSets(expenses);
  var best = {};
  function scoreAsg(a) {
    var s = 0;
    if (String(a.eventKey || "").indexOf("lead:") === 0) s += 40;
    if (a.leadId) s += 20;
    s += Math.min(50, num(a.payEach) || num(a.dayRate) || 0);
    return s;
  }
  (Array.isArray(assigns) ? assigns : []).forEach(function (asg) {
    if (!asg || !asg.eventKey) return;
    if (asg.cancelled || asg.status === "cancelled" || asg.cancelGhost) return;
    if (String(asg.payStatus || "") === "Paid") return;
    var start = String(asg.start || "").slice(0, 10);
    if (!start || start > today) return;
    var m = expenseMonthKey(start);
    if (m && focusMonth && m > focusMonth) return;
    var ids = (asg.stewIds || []).filter(Boolean);
    if (!ids.length) return;
    ids.forEach(function (sid) {
      if (isSkipped(asg.eventKey, sid)) return;
      if (isCrewDayPaySettled(asg, sid, settled)) return;
      var amt = round2(dayPayAmt(asg, sid));
      if (!(amt > 0)) return;
      var finger = String(sid) + "|" + start;
      var nm = nameOf(sid);
      var row = {
        kind: "daypay",
        eventKey: String(asg.eventKey),
        stewId: String(sid),
        name: nm,
        label: nm + " day pay",
        amount: amt,
        date: start,
        month: m || "",
        summary: asg.summary || "Charter",
        _score: scoreAsg(asg),
      };
      var prev = best[finger];
      if (!prev || row._score > prev._score || (row._score === prev._score && row.amount > prev.amount)) {
        best[finger] = row;
      }
    });
  });
  var out = Object.keys(best).map(function (k) {
    var r = best[k];
    delete r._score;
    return r;
  });
  out.sort(function (a, b) {
    var da = String(a.date || "");
    var db = String(b.date || "");
    if (da !== db) return db.localeCompare(da);
    return (b.amount || 0) - (a.amount || 0);
  });
  return out;
}

/**
 * Tips on card/bill still unpaid — boat liability.
 *
 * @param {Array} tipRows pre-normalized [{eventKey, tipSource, tipPaid, tipTotal, start, summary, tipEach, tipCaptain, tipStewSide, nStews, cancelled?}]
 * @param {{ focusMonth: string, today: string }} opts
 */
function collectOpenTipPayouts(tipRows, opts) {
  opts = opts || {};
  var focusMonth = opts.focusMonth || "";
  var today = opts.today || "9999-12-31";
  var out = [];
  (Array.isArray(tipRows) ? tipRows : []).forEach(function (row) {
    if (!row || !row.eventKey) return;
    if (row.cancelled) return;
    if (!row.onBill) return;
    if (row.paid) return;
    var tot = round2(num(row.amount != null ? row.amount : row.tipTotal));
    if (!(tot > 0)) return;
    var start = String(row.date || row.start || "").slice(0, 10);
    if (!start || start > today) return;
    var m = expenseMonthKey(start);
    if (m && focusMonth && m > focusMonth) return;
    out.push({
      kind: "tip",
      eventKey: String(row.eventKey),
      label: "Tips on bill · " + (row.summary || "Charter"),
      amount: tot,
      date: start,
      month: m || "",
      tipEach: num(row.tipEach),
      tipCaptain: num(row.tipCaptain),
      tipStewSide: num(row.tipStewSide),
      nStews: num(row.nStews),
      summary: row.summary || "Charter",
    });
  });
  out.sort(function (a, b) {
    var da = String(a.date || "");
    var db = String(b.date || "");
    if (da !== db) return db.localeCompare(da);
    return (b.amount || 0) - (a.amount || 0);
  });
  return out;
}

/**
 * Month settlement DTO for Expenses UI.
 * Petty numbers come from summarizePettyCash; liabilities from pocket + open lists.
 *
 * @param {{
 *   expenses: Array,           // month lines
 *   allExpenses?: Array,       // full ledger for repay matching
 *   pettyStart: number,
 *   cashIns: Array,            // envelope cash-ins (tips excluded)
 *   cashInsAll?: Array,        // including tips
 *   cashInIsTip?: function,
 *   openDayPay?: Array,
 *   openTips?: Array,
 *   personName?: function,
 *   isTipExpense?: function
 * }} opts
 */
function summarizeMonthSettlement(opts) {
  opts = opts || {};
  var lines = Array.isArray(opts.expenses) ? opts.expenses : [];
  var allExp = Array.isArray(opts.allExpenses) ? opts.allExpenses : lines;
  var isTip =
    typeof opts.isTipExpense === "function"
      ? opts.isTipExpense
      : function () {
          return false;
        };
  var cashInIsTip =
    typeof opts.cashInIsTip === "function"
      ? opts.cashInIsTip
      : function (r) {
          return !!(r && (r.kind === "tip" || /tip/i.test(String(r.source || ""))));
        };
  var nameOf =
    typeof opts.personName === "function"
      ? opts.personName
      : function (id) {
          return !id || String(id) === EXP_POCKET_CAPTAIN ? "Captain" : "Crew";
        };
  var cashInsAll = Array.isArray(opts.cashInsAll) ? opts.cashInsAll : opts.cashIns || [];
  var cashIns = Array.isArray(opts.cashIns)
    ? opts.cashIns
    : cashInsAll.filter(function (r) {
        return !cashInIsTip(r);
      });
  var tipCashIns = cashInsAll.filter(cashInIsTip);
  var linesForPetty = lines.filter(function (e) {
    return e && !isTip(e);
  });
  var pettySum = summarizePettyCash({
    pettyStart: opts.pettyStart,
    cashIns: cashIns,
    expenses: linesForPetty,
  });
  var collapsed = pettySum.collapsedExpenses || lines;
  var cardOut = 0;
  var crewUnpaid = 0;
  var crewPrior = 0;
  var otherCash = 0;
  var ownMoneyExp = 0;
  var reimburseCap = 0;
  var nDayPayLines = 0;
  var pocketOutLines = [];

  collapsed.forEach(function (e) {
    if (!e) return;
    var a = round2(num(e.amount));
    if (isCrewDayPayExpense(e)) {
      nDayPayLines++;
      if (String(e.crewPayStatus || "") !== "Paid") {
        crewUnpaid += a;
        return;
      }
      if (String(e.payMethod || "") === "Credit Card") {
        cardOut += a;
        return;
      }
      if (expensePaidFrom(e) === "own") {
        ownMoneyExp += a;
        var crewPayerId = ownMoneySpendWhoId(e);
        var crewRepaidAmt = ownMoneyRepaidAmt(e, allExp);
        pocketOutLines.push({
          kind: "crew",
          whoId: crewPayerId,
          who: nameOf(crewPayerId),
          crewName: e.vendor || "Crew",
          label: (e.vendor || "Crew") + " day pay",
          amount: a,
          id: e.id,
          date: String(e.date || "").slice(0, 10),
          repaid: crewRepaidAmt >= a - 0.009,
          repaidAmt: crewRepaidAmt,
        });
        return;
      }
      if (!crewDayPayHitsPetty(e)) crewPrior += a;
      return;
    }
    var cls = classifyExpenseCash(e);
    if (cls.isReimbursement) {
      if (cls.paidFrom === "card") {
        cardOut += a;
        return;
      }
      if (cls.hitsPettyCash) reimburseCap += a;
      else if (cls.paidFrom === "own") {
        ownMoneyExp += a;
        var roWhoId = String(cls.ownMoneyPayerId || EXP_POCKET_CAPTAIN);
        var roRepaidAmt = ownMoneyRepaidAmt(
          Object.assign({}, e, { paidFrom: "Own money", paidById: roWhoId }),
          allExp
        );
        pocketOutLines.push({
          kind: "reimburse-own",
          whoId: roWhoId,
          who: nameOf(roWhoId),
          label: "Repaid " + nameOf(cls.clearsPocketFor || expenseReimburseWhoId(e)) + (e.vendor ? " · " + e.vendor : ""),
          amount: a,
          id: e.id,
          date: String(e.date || "").slice(0, 10),
          repaid: roRepaidAmt >= a - 0.009,
          repaidAmt: roRepaidAmt,
        });
      }
      return;
    }
    if (cls.paidFrom === "card") {
      cardOut += a;
      return;
    }
    if (cls.hitsOwnMoneyPocket) {
      ownMoneyExp += a;
      var whoId = String(cls.ownMoneyPayerId || EXP_POCKET_CAPTAIN);
      var isCrewSal = String(e.category || "") === "Crew Salaries";
      pocketOutLines.push({
        kind: isCrewSal ? "crew" : "shop",
        whoId: whoId,
        who: nameOf(whoId),
        crewName: isCrewSal ? e.vendor || "Crew" : "",
        label: isCrewSal
          ? (e.vendor || "Crew") + " day pay" + (e.description ? " · " + String(e.description).slice(0, 40) : "")
          : (e.vendor || e.category || "Expense") + (e.description ? " · " + String(e.description).slice(0, 40) : ""),
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
        repaid: ownMoneyIsRepaid(e, allExp),
        repaidAmt: ownMoneyRepaidAmt(e, allExp),
      });
      return;
    }
    if (cls.hitsPettyCash) otherCash += a;
  });

  var openDayPay = Array.isArray(opts.openDayPay) ? opts.openDayPay : [];
  var openTips = Array.isArray(opts.openTips) ? opts.openTips : [];
  var oweCrew = 0;
  openDayPay.forEach(function (r) {
    oweCrew += num(r && r.amount);
  });
  oweCrew = round2(oweCrew);
  var oweTips = 0;
  openTips.forEach(function (t) {
    oweTips += num(t && t.amount);
  });
  oweTips = round2(oweTips);

  var pockets = summarizePocketBalances(lines, cashInsAll, {
    personName: nameOf,
    cashInIsOwnMoney: opts.cashInIsOwnMoney,
  });
  var cap = pockets.captain || { putIn: 0, paidOut: 0, reimbursed: 0, owed: 0 };
  var pocketOwed = pockets.total || 0;
  var peopleOwed = round2(pocketOwed + oweCrew + oweTips);
  var pettyOnboard = Number(pettySum.pettyOnboard) || 0;
  var cashOut = Number(pettySum.cashOut) || 0;
  var cashInTotal = Number(pettySum.cashInTotal) || 0;
  var pettyStart = round2(num(opts.pettyStart));
  var pettyEntered =
    (opts.pettyStartMode && opts.pettyStartMode !== "none") ||
    opts.pettyStartManual === true ||
    Math.abs(pettyStart) > 0.009 ||
    cashInTotal > 0.009 ||
    cashOut > 0.009;
  var freeFloat = pettyEntered && pettyOnboard > 0 ? pettyOnboard : 0;
  var floatAfterPays = round2(pettyOnboard - peopleOwed);
  var floatBehind = floatAfterPays < 0 ? round2(-floatAfterPays) : 0;
  var ownerCashIn = round2(Math.max(0, peopleOwed - freeFloat));
  var tipCashInTotal = 0;
  tipCashIns.forEach(function (r) {
    tipCashInTotal += num(r && r.amount);
  });

  return {
    cashOut: cashOut,
    cashOutLines: pettySum.cashOutLines || [],
    pocketOutLines: pocketOutLines,
    cardOut: round2(cardOut),
    crewPaid: round2(Number(pettySum.crewPaidPetty) || 0),
    crewPrior: round2(crewPrior),
    crewUnpaid: round2(crewUnpaid),
    otherCash: round2(otherCash),
    reimburseCap: round2(reimburseCap),
    ownMoneyExp: round2(ownMoneyExp),
    pettyStart: pettyStart,
    physicalStart: Number(pettySum.physicalStart) || 0,
    cashInTotal: cashInTotal,
    cashInHand: Number(pettySum.cashInHand) || 0,
    pettyEntered: pettyEntered,
    booksBalance: Number(pettySum.booksBalance) || 0,
    pettyCash: pettyOnboard,
    pettyOnboard: pettyOnboard,
    freeFloat: freeFloat,
    cashShort: Number(pettySum.cashShort) || 0,
    monthShort: Number(pettySum.monthShort) || 0,
    priorStartShort: Number(pettySum.priorStartShort) || 0,
    shortLines: Array.isArray(pettySum.shortLines) ? pettySum.shortLines : [],
    floatAfterPays: floatAfterPays,
    floatBehind: floatBehind,
    oweCrew: oweCrew,
    openDayPay: openDayPay,
    openTips: openTips,
    oweTips: oweTips,
    cap: cap,
    pockets: pockets,
    pocketOwed: pocketOwed,
    boatOwes: cap.owed || 0,
    peopleOwed: peopleOwed,
    ownerCashIn: ownerCashIn,
    totalSettle: ownerCashIn,
    nCrewPaidLines: Number(pettySum.nCrewPetty) || 0,
    nSkippedDup: Number(pettySum.nCrewCollapsed) || 0,
    nDayPayLines: nDayPayLines,
    tipCashIns: tipCashIns,
    tipCashInTotal: round2(tipCashInTotal),
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
    clearCrewFloatPayOnEmptyEnvelope: clearCrewFloatPayOnEmptyEnvelope,
    summarizePettyCash: summarizePettyCash,
    summarizePettyCashInRows: summarizePettyCashInRows,
    collectPettyCashInsFromMonths: collectPettyCashInsFromMonths,
    isCaptainCommissionExpense: isCaptainCommissionExpense,
    summarizeCaptainCommissionPaid: summarizeCaptainCommissionPaid,
    summarizeCaptainCommissionBalance: summarizeCaptainCommissionBalance,
    /* Pocket / liabilities (Keepafloat foundation) */
    expenseMonthKey: expenseMonthKey,
    expenseReimburseWhoId: expenseReimburseWhoId,
    isOwnMoneySpend: isOwnMoneySpend,
    ownMoneySpendWhoId: ownMoneySpendWhoId,
    ownMoneyRepaidAmt: ownMoneyRepaidAmt,
    ownMoneyIsRepaid: ownMoneyIsRepaid,
    ownMoneyRepayHint: ownMoneyRepayHint,
    collectOpenPocketOuts: collectOpenPocketOuts,
    summarizePocketBalances: summarizePocketBalances,
    buildCrewDayPaySettledSets: buildCrewDayPaySettledSets,
    isCrewDayPaySettled: isCrewDayPaySettled,
    collectOpenCrewDayPay: collectOpenCrewDayPay,
    collectOpenTipPayouts: collectOpenTipPayouts,
    summarizeMonthSettlement: summarizeMonthSettlement,
    /** Sum cash-in lines that count toward petty (caller already filtered tips). */
    sumCashInAmounts: function (rows) {
      var s = 0;
      (Array.isArray(rows) ? rows : []).forEach(function (r) {
        if (r) s += num(r.amount);
      });
      return round2(s);
    }
  };
});
