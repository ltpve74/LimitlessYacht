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
/** Owner paid crew from personal funds — not boat petty, not captain pocket. */
var EXP_POCKET_OWNER = "owner";

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
  /* Owner money is its own class — not captain/crew pocket liability */
  if (expensePaidFromLooksOwner(p)) return false;
  if (p === "Own money" || /^own money\b/i.test(p) || /\bown money\b/i.test(p)) return true;
  if (/^(my|captain'?s?|capt\.?)\s+(money|pocket|personal)/i.test(p)) return true;
  if (/^captain\b/i.test(p) || /^capt\.?\b/i.test(p)) return true;
  if (/^personal\b/i.test(p) || /^from me\b/i.test(p) || /^captain pocket\b/i.test(p)) return true;
  if (/\bpocket\b/i.test(p) && !/\bpetty\b/i.test(p) && !/\bowner\b/i.test(p)) return true;
  return false;
}

/** Owner paid from personal funds (not boat, not captain pocket). */
function expensePaidFromLooksOwner(label) {
  var p = String(label || "").trim();
  if (!p) return false;
  if (p === "Owner money" || p === "Owner’s money" || p === "Owner's money") return true;
  if (/^owner\s*(money|pocket|paid|pay)\b/i.test(p)) return true;
  if (/^owner'?s?\s*(money|pocket)\b/i.test(p)) return true;
  return false;
}

/**
 * Guest paid crew directly (owner-sourced deal: guest settles stew).
 * Not boat cash, not captain pocket, not owner pocket claim.
 */
function expensePaidFromLooksGuest(label) {
  var p = String(label || "").trim();
  if (!p) return false;
  if (p === "Guest" || p === "Guest money" || p === "Guest paid" || p === "Guest paid crew") return true;
  if (/^guest\b/i.test(p)) return true;
  return false;
}

/**
 * Paid-from envelope: petty | own | owner | guest | card.
 * Own (capt pocket / crew pocket / paidById) NEVER counts as petty out.
 * Guest = cash guest→crew (outside boat envelope).
 *
 * Crew day-pay is special:
 *  - floatPay true → petty (cash left the boat) — or guest top-up from petty
 *  - Own money label OR paidById with Paid + not floatPay → own (captain pocket)
 *  - Guest → guest paid (optional top-up own/petty separate)
 *  - Paid without float and without own → books-only “Prior” (still classed petty,
 *    but crewDayPayHitsPetty is false so it never leaves the envelope)
 */
function expensePaidFrom(e) {
  if (!e) return "petty";
  if (String(e.payMethod || "") === "Credit Card") return "card";
  if (isCrewDayPayExpense(e)) {
    if (String(e.crewPayStatus || "") !== "Paid") return "petty";
    var pc = String(e.paidFrom || "").trim();
    if (expensePaidFromLooksGuest(pc)) return "guest";
    if (expensePaidFromLooksOwner(pc)) return "owner";
    if (String(e.paidById || "") === EXP_POCKET_OWNER || String(e.paidById || "") === "owner")
      return "owner";
    /* Own money label always wins (even if floatPay was left true by a bad write) */
    if (expensePaidFromLooksOwn(pc)) return "own";
    if (e.floatPay === true) return "petty";
    /* paidById is written for Own money marks — pocket even if label stuck as Petty */
    if (e.paidById != null && String(e.paidById) !== "") return "own";
    return "petty";
  }
  var p = String(e.paidFrom || "").trim();
  if (expensePaidFromLooksGuest(p)) return "guest";
  if (expensePaidFromLooksOwner(p)) return "owner";
  if (String(e.paidById || "") === EXP_POCKET_OWNER || String(e.paidById || "") === "owner")
    return "owner";
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
 * Crew day-pay → only floatPay === true (never bare Paid + Petty label).
 */
function expenseHitsPettyCash(e, opts) {
  opts = opts || {};
  if (!e) return false;
  /* Crew day-pay: sole switch is floatPay via crewDayPayHitsPetty */
  if (opts.isCrewDayPay || isCrewDayPayExpense(e)) {
    return crewDayPayHitsPetty(e);
  }
  var pf = expensePaidFrom(e);
  if (pf === "card" || pf === "own" || pf === "owner" || pf === "guest") return false;
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
  var ownSpend = !reimb && isOwnMoneySpend(e);
  var ownAmt = ownSpend ? ownMoneySpendAmount(e) : 0;
  return {
    amount: a,
    isReimbursement: reimb,
    paidFrom: pf, /* petty | own | owner | guest | card */
    hitsPettyCash: hitsPetty,
    hitsOwnMoneyPocket: ownSpend,
    ownMoneyAmount: ownAmt,
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
        : ownSpend
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
  /* Tip payouts are source=stew but must NOT be treated as day-pay (would skip
   * the tip cash-out branch because floatPay is unset → never hit petty). */
  if (e.stewPayKind === "tipPayout" || e.kind === "tipPayout") return false;
  if (e.linkId != null && String(e.linkId).indexOf("stew-tip:") === 0) return false;
  if (/^crew tip payout$/i.test(String(e.category || ""))) return false;
  if (e.stewPayKind === "dayPay") return true;
  if (e.source === "stew" && (e.stewEventKey || e.stewId)) return true;
  if (e.linkId != null && String(e.linkId).indexOf("stew-day:") === 0) return true;
  /* Category Crew Salaries = crew day-pay (Stews lines often only set category) */
  if (/^crew salaries$/i.test(String(e.category || ""))) return true;
  return false;
}

/**
 * Stable key for crew day-pay collapse.
 * Prefer stewId|eventKey so two charters on the same calendar day (or same
 * pay-date stamp) both hit petty — sid|date wrongly collapsed Laura’s Diego
 * pay-on-3-Aug with Dominik 3-Aug into one line.
 * Renames of the *same* charter keep the same eventKey (or same stew-day link
 * prefix) so they still collapse.
 */
function crewDayPayFinger(e) {
  if (!e) return "";
  var sid = e.stewId != null && String(e.stewId) !== "" ? String(e.stewId) : "";
  var ek = e.stewEventKey != null && String(e.stewEventKey) !== "" ? String(e.stewEventKey) : "";
  if (sid && ek) return sid + "|" + ek;
  var lid = e.linkId != null && String(e.linkId) !== "" ? String(e.linkId) : "";
  if (lid.indexOf("stew-day:") === 0) {
    /* stew-day:<eventKey>:<stewId> — eventKey may contain colons (uid:…) */
    var rest = lid.slice("stew-day:".length);
    var last = rest.lastIndexOf(":");
    if (last > 0) {
      var ek2 = rest.slice(0, last);
      var sid2 = rest.slice(last + 1);
      if (sid2 && ek2) return sid2 + "|" + ek2;
    }
    return "link:" + lid;
  }
  var d = String(e.date || "").slice(0, 10);
  if (sid && /^\d{4}-\d{2}-\d{2}$/.test(d)) return sid + "|" + d;
  if (lid) return "link:" + lid;
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
 * Split day-pay: primary source (guest/boss) paid X, optional top-up for shortfall.
 * Uses guestPaidAmt as the primary amount (historical field name).
 * Works for paidFrom Guest or Owner money.
 * @returns {{ primary: string, primaryPaid: number, topUp: number, topUpFrom: string } | empty}
 */
function crewDayPayPrimarySplit(e) {
  var empty = { primary: "", primaryPaid: 0, topUp: 0, topUpFrom: "", guestPaid: 0 };
  if (!e) return empty;
  var pf = expensePaidFrom(e);
  if (pf !== "guest" && pf !== "owner") return empty;
  /* Owner without explicit primary amount and no top-up = full owner (legacy) */
  var hasSplit =
    (e.guestPaidAmt != null && e.guestPaidAmt !== "") ||
    (e.topUpAmt != null && num(e.topUpAmt) > 0.009) ||
    (e.topUpFrom != null && String(e.topUpFrom).trim() !== "");
  if (pf === "owner" && !hasSplit) return empty;
  var total = round2(num(e.amount));
  var primaryPaid =
    e.guestPaidAmt != null && e.guestPaidAmt !== "" ? round2(num(e.guestPaidAmt)) : total;
  if (primaryPaid < 0) primaryPaid = 0;
  if (primaryPaid > total) primaryPaid = total;
  var topUp =
    e.topUpAmt != null && e.topUpAmt !== "" ? round2(num(e.topUpAmt)) : round2(total - primaryPaid);
  if (topUp < 0) topUp = 0;
  if (topUp > total) topUp = total;
  var tf = String(e.topUpFrom || "").trim();
  if (tf === "Own money" || expensePaidFromLooksOwn(tf)) tf = "Own money";
  else if (tf === "Petty cash" || /^petty\b/i.test(tf)) tf = "Petty cash";
  else if (!(topUp > 0.009)) tf = "";
  else tf = tf || "Own money";
  return {
    primary: pf,
    primaryPaid: primaryPaid,
    topUp: topUp,
    topUpFrom: tf,
    guestPaid: primaryPaid /* alias for older callers */,
  };
}
/** @deprecated name — use crewDayPayPrimarySplit */
function crewDayPayGuestSplit(e) {
  var s = crewDayPayPrimarySplit(e);
  if (!s.primary) return { guestPaid: 0, topUp: 0, topUpFrom: "" };
  return { guestPaid: s.primaryPaid, topUp: s.topUp, topUpFrom: s.topUpFrom };
}

/**
 * Cash left the boat for this crew day-pay only when floatPay === true.
 * Paid status alone never moves petty (prior books / auto status).
 * Guest/owner primary: only a Petty top-up (shortfall you cover) hits pot.
 */
function crewDayPayHitsPetty(e) {
  if (!isCrewDayPayExpense(e)) return false;
  if (String(e.crewPayStatus || "") !== "Paid") return false;
  var pf = expensePaidFrom(e);
  if (pf === "own" || pf === "card") return false;
  if (pf === "guest" || pf === "owner") {
    var g = crewDayPayPrimarySplit(e);
    if (!g.primary && pf === "owner") return false; /* full owner, no pot */
    return g.topUpFrom === "Petty cash" && g.topUp > 0.009 && e.floatPay === true;
  }
  return e.floatPay === true;
}

/**
 * € that actually left the boat envelope for this crew day-pay line.
 * Primary guest/owner + petty top-up → top-up only; normal pot pay → full amount.
 */
function crewDayPayPettyOutAmount(e) {
  if (!crewDayPayHitsPetty(e)) return 0;
  var pf = expensePaidFrom(e);
  if (pf === "guest" || pf === "owner") {
    var g = crewDayPayPrimarySplit(e);
    return g.topUp > 0.009 ? g.topUp : 0;
  }
  return round2(num(e.amount));
}

/**
 * Who funded a crew day-pay line (pure).
 *  pot      = floatPay — cash left boat envelope (counts in petty cashOut)
 *  captain  = Own money — captain pocket
 *  owner    = Owner money
 *  guest    = guest paid crew (outside boat) — optional top-up separate
 *  books    = Paid + Petty label but no floatPay (not this pot cash-out)
 *  unpaid   = not Paid
 *  card     = credit card
 *  ""       = not a crew day-pay line
 */
function crewDayPayFundSource(e) {
  if (!isCrewDayPayExpense(e)) return "";
  if (String(e.crewPayStatus || "") !== "Paid") return "unpaid";
  if (String(e.payMethod || "") === "Credit Card") return "card";
  var pf = expensePaidFrom(e);
  if (pf === "guest") return "guest";
  /* Owner with split top-up still classifies as owner primary (top-up counted separately) */
  if (pf === "owner") return "owner";
  if (crewDayPayHitsPetty(e)) return "pot";
  if (pf === "own") return "captain";
  return "books";
}

/**
 * Guest name from crew day-pay description (pure).
 * e.g. "Stewardess / day work — Joel Freeland" → "Joel Freeland"
 */
function crewPayGuestFromDescription(desc) {
  var s = String(desc || "").trim();
  if (!s) return "";
  var m = s.match(/[—–-]\s*(.+)$/);
  if (!m) return "";
  var g = m[1]
    .replace(/\s*-\s*stew\s+\w+\s*$/i, "")
    .replace(/\s*stew\s+\w+\s*$/i, "")
    .replace(/\s*-\s*stew\s*$/i, "")
    .trim();
  return g;
}

/**
 * Owner-facing justification for a crew day-pay line (pure).
 * Overnight / multi-day vs extended/long day vs day charter — so the owner
 * sees why Toni €750 or €250 is not a plain day rate.
 *
 * @param {object} e expense
 * @param {Array} [leads] optional leads for start/end/days
 * @returns {object}
 */
function crewPayOwnerJustification(e, leads) {
  var a = round2(num(e && e.amount));
  var vendor = String((e && e.vendor) || "Crew").trim() || "Crew";
  var desc = String((e && e.description) || "").trim();
  var guest = crewPayGuestFromDescription(desc);
  var list = Array.isArray(leads) ? leads : [];
  var lead = null;
  var ek = String((e && e.stewEventKey) || "");
  if (ek.indexOf("lead:") === 0) {
    var lid = ek.slice(5);
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === lid) {
        lead = list[i];
        break;
      }
    }
  }
  var expDay = String((e && e.charterDate) || (e && e.date) || "").slice(0, 10);
  if (!lead && guest) {
    var gLow = guest.toLowerCase().replace(/\s+/g, " ").trim();
    var expMon = expenseMonthKey(expDay || (e && e.date) || "");
    var best = null;
    var bestScore = 0;
    for (var j = 0; j < list.length; j++) {
      if (!list[j]) continue;
      var ln = String(list[j].name || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!ln) continue;
      var lStartDay = String(list[j].start || list[j].cdate || "").slice(0, 10);
      var lEndDay = String(list[j].end || lStartDay || "").slice(0, 10);
      var lStart = lStartDay.slice(0, 7);
      if (expMon && lStart && lStart !== expMon) continue;
      /* Guest name match must cover the crew charter day when we know it */
      if (
        expDay &&
        /^\d{4}-\d{2}-\d{2}$/.test(expDay) &&
        lStartDay &&
        /^\d{4}-\d{2}-\d{2}$/.test(lStartDay)
      ) {
        if (expDay < lStartDay) continue;
        if (lEndDay && /^\d{4}-\d{2}-\d{2}$/.test(lEndDay) && expDay > lEndDay) continue;
      }
      var score = 0;
      if (ln === gLow) score = 100;
      else if (ln.indexOf(gLow) === 0 || gLow.indexOf(ln) === 0) score = 80;
      else if (gLow.length >= 4 && ln.indexOf(gLow) >= 0) score = 60;
      else if (gLow.length >= 4 && ln.indexOf(gLow.slice(0, Math.min(8, gLow.length))) >= 0)
        score = 40;
      else continue;
      if (score > bestScore) {
        bestScore = score;
        best = list[j];
      }
    }
    lead = best;
  }
  /*
   * Dates: expense charter day is source of truth for day charters.
   * Lead start/end used when multi-day overnight (expand the range).
   */
  var start = expDay;
  var end = "";
  var days = 0;
  var dur = String((lead && lead.dur) || "").toLowerCase();
  var leadDays = Number(lead && lead.days) || 0;
  var leadStart = String((lead && (lead.start || lead.cdate)) || "").slice(0, 10);
  var leadEnd = String((lead && lead.end) || "").slice(0, 10);
  var leadMulti =
    leadDays >= 2 ||
    (leadStart && leadEnd && leadEnd > leadStart) ||
    dur === "multi" ||
    /multi|overnight|night/.test(dur);
  if (lead && leadMulti) {
    start = leadStart || start;
    end = leadEnd && leadEnd !== start ? leadEnd : "";
    days = leadDays;
  }
  if (end && end < start) end = "";
  if (!days && start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    var t0 = Date.parse(start + "T12:00:00Z");
    var t1 = Date.parse(end + "T12:00:00Z");
    if (isFinite(t0) && isFinite(t1) && t1 >= t0) {
      days = Math.round((t1 - t0) / 86400000) + 1;
    }
  }
  var multi =
    days >= 2 ||
    (end && start && end > start) ||
    leadMulti ||
    a >= 450;
  var longDay = !multi && a >= 249.99;
  var tier = "day";
  var tierLabel = "Day charter";
  if (multi) {
    tier = "overnight";
    var nDays = days >= 2 ? days : end && start && end > start ? 2 : 2;
    tierLabel =
      nDays >= 3
        ? "Overnight charter · " + nDays + " days"
        : "Overnight charter · 2 days";
  } else if (longDay) {
    tier = "long-day";
    tierLabel = "Extended charter / long day";
  }
  if (lead && lead.name && !guest) guest = String(lead.name).trim();
  var dateSpan = start;
  if (end && end !== start) dateSpan = start + " to " + end;
  var ownerTitle = vendor + " · " + tierLabel;
  var ownerDetail = [guest, dateSpan].filter(Boolean).join(" · ");
  return {
    guest: guest,
    charterStart: start,
    charterEnd: end,
    days: days || (multi ? 2 : 1),
    tier: tier,
    tierLabel: tierLabel,
    isOvernight: tier === "overnight",
    isLongDay: tier === "long-day",
    ownerTitle: ownerTitle,
    ownerDetail: ownerDetail,
  };
}

/**
 * Month crew day-pay DTO — all fund math lives here (not the view).
 *
 * paidTotal     = sum of Paid crew day rates in month (what stews received)
 * fromBoatPot   = paid from pot (floatPay) — equals petty crew cash-out
 * fromCaptain   = paid from captain pocket
 * fromOwner     = paid from owner
 * fromGuest     = guest paid crew directly (not boat cash — quiet on owner PDF)
 * booksOnly     = Paid on books, not pot/captain/owner cash path
 * unpaidTotal   = Unpaid day rates in month
 *
 * Do NOT treat paidTotal as boat cash-out. Cash-out crew = fromBoatPot only.
 *
 * @param {Array} expenses full or month-scoped
 * @param {string} month YYYY-MM
 * @param {{ leads?: Array }} [opts] leads for overnight date ranges / guest
 * @returns {object}
 */
function summarizeCrewPayMonth(expenses, month, opts) {
  opts = opts || {};
  month = String(month || "").slice(0, 7);
  var leads = Array.isArray(opts.leads) ? opts.leads : [];
  var empty = {
    month: month,
    paidTotal: 0,
    unpaidTotal: 0,
    fromBoatPot: 0,
    fromCaptain: 0,
    fromOwner: 0,
    fromGuest: 0,
    booksOnly: 0,
    cardTotal: 0,
    nPaid: 0,
    nUnpaid: 0,
    lines: [],
    potLines: [],
    captainLines: [],
    ownerLines: [],
    guestLines: [],
    booksLines: [],
  };
  if (!/^\d{4}-\d{2}$/.test(month)) return empty;

  var paidTotal = 0;
  var unpaidTotal = 0;
  var fromBoatPot = 0;
  var fromCaptain = 0;
  var fromOwner = 0;
  var fromGuest = 0;
  var booksOnly = 0;
  var cardTotal = 0;
  var nPaid = 0;
  var nUnpaid = 0;
  var lines = [];
  var potLines = [];
  var captainLines = [];
  var ownerLines = [];
  var guestLines = [];
  var booksLines = [];

  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e || !isCrewDayPayExpense(e)) return;
    if (expenseMonthKey(e.date) !== month) return;
    var a = round2(num(e.amount));
    if (!(a > 0.009)) return;
    var fund = crewDayPayFundSource(e);
    var just = crewPayOwnerJustification(e, leads);
    var split = crewDayPayPrimarySplit(e);
    var hasSplit = !!(split && split.primary && (split.topUp > 0.009 || fund === "guest"));
    var row = {
      id: String(e.id || ""),
      date: String(e.date || "").slice(0, 10),
      charterDate: String(e.charterDate || e.date || "").slice(0, 10),
      vendor: String(e.vendor || "Crew").trim() || "Crew",
      description: String(e.description || "").trim(),
      amount: a,
      fund: fund,
      stewId: e.stewId != null ? String(e.stewId) : "",
      stewEventKey: e.stewEventKey != null ? String(e.stewEventKey) : "",
      floatPay: e.floatPay === true,
      paidFrom: String(e.paidFrom || ""),
      crewPayStatus: String(e.crewPayStatus || ""),
      guestPaid: split ? split.primaryPaid : 0,
      topUp: split ? split.topUp : 0,
      topUpFrom: split ? split.topUpFrom : "",
      guest: just.guest,
      charterStart: just.charterStart,
      charterEnd: just.charterEnd,
      days: just.days,
      tier: just.tier,
      tierLabel: just.tierLabel,
      isOvernight: just.isOvernight,
      isLongDay: just.isLongDay,
      ownerTitle: just.ownerTitle,
      ownerDetail: just.ownerDetail,
    };
    lines.push(row);
    if (fund === "unpaid") {
      unpaidTotal = round2(unpaidTotal + a);
      nUnpaid++;
      return;
    }
    if (fund === "card") {
      cardTotal = round2(cardTotal + a);
      nPaid++;
      paidTotal = round2(paidTotal + a);
      return;
    }
    nPaid++;
    paidTotal = round2(paidTotal + a);
    if (fund === "guest" || (fund === "owner" && hasSplit)) {
      /* Primary outside boat; top-up may hit pot or captain pocket */
      var pPay = split && split.primaryPaid > 0.009 ? split.primaryPaid : a;
      if (fund === "guest") {
        fromGuest = round2(fromGuest + pPay);
        guestLines.push(row);
      } else {
        fromOwner = round2(fromOwner + pPay);
        ownerLines.push(row);
      }
      if (split && split.topUp > 0.009) {
        if (split.topUpFrom === "Petty cash" && e.floatPay === true) {
          fromBoatPot = round2(fromBoatPot + split.topUp);
          potLines.push(
            Object.assign({}, row, {
              amount: split.topUp,
              fund: "pot",
              ownerDetail: (row.ownerDetail ? row.ownerDetail + " · " : "") + "balance",
            })
          );
        } else if (split.topUpFrom === "Own money") {
          fromCaptain = round2(fromCaptain + split.topUp);
          captainLines.push(
            Object.assign({}, row, {
              amount: split.topUp,
              fund: "captain",
              ownerDetail: (row.ownerDetail ? row.ownerDetail + " · " : "") + "balance",
            })
          );
        }
      }
    } else if (fund === "pot") {
      fromBoatPot = round2(fromBoatPot + (crewDayPayPettyOutAmount(e) || a));
      potLines.push(row);
    } else if (fund === "captain") {
      fromCaptain = round2(fromCaptain + a);
      captainLines.push(row);
    } else if (fund === "owner") {
      fromOwner = round2(fromOwner + a);
      ownerLines.push(row);
    } else {
      booksOnly = round2(booksOnly + a);
      booksLines.push(row);
    }
  });

  function byDate(a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  }
  lines.sort(byDate);
  potLines.sort(byDate);
  captainLines.sort(byDate);
  ownerLines.sort(byDate);
  guestLines.sort(byDate);
  booksLines.sort(byDate);

  return {
    month: month,
    paidTotal: paidTotal,
    unpaidTotal: unpaidTotal,
    fromBoatPot: fromBoatPot,
    fromCaptain: fromCaptain,
    fromOwner: fromOwner,
    fromGuest: fromGuest,
    booksOnly: booksOnly,
    cardTotal: cardTotal,
    nPaid: nPaid,
    nUnpaid: nUnpaid,
    lines: lines,
    potLines: potLines,
    captainLines: captainLines,
    ownerLines: ownerLines,
    guestLines: guestLines,
    booksLines: booksLines,
  };
}

/**
 * Petty cash-out buckets for a month (pure) — only money that left the boat pot.
 * Crew day-pay bucket = floatPay only (fromBoatPot), never captain/books.
 *
 * @param {Array} monthExpenses lines for the report month
 * @returns {{ commission, crewDayPay, reimburseCaptain, reimburseCrew, tipPayout, otherPetty, commissionLines }}
 */
function summarizePettyCashOutBuckets(monthExpenses) {
  var b = {
    commission: 0,
    crewDayPay: 0,
    reimburseCaptain: 0,
    reimburseCrew: 0,
    tipPayout: 0,
    otherPetty: 0,
  };
  var commissionLines = [];
  (Array.isArray(monthExpenses) ? monthExpenses : []).forEach(function (e) {
    if (!e) return;
    var a = round2(num(e.amount));
    if (!(a > 0.009)) return;
    if (isCrewDayPayExpense(e)) {
      if (crewDayPayHitsPetty(e)) {
        var out = crewDayPayPettyOutAmount(e);
        if (out > 0.009) b.crewDayPay = round2(b.crewDayPay + out);
      }
      return;
    }
    if (isCaptainCommissionExpense(e)) {
      if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return;
      if (String(e.payMethod || "") === "Credit Card") return;
      b.commission = round2(b.commission + a);
      commissionLines.push({
        id: String(e.id || ""),
        date: String(e.date || "").slice(0, 10),
        vendor: String(e.vendor || "Commission").trim() || "Commission",
        description: String(e.description || "").trim(),
        amount: a,
      });
      return;
    }
    if (isExpenseReimbursement(e)) {
      if (!expenseHitsPettyCash(e)) return;
      var who = expenseReimburseWhoId(e);
      if (who === EXP_POCKET_CAPTAIN || who === "captain") {
        b.reimburseCaptain = round2(b.reimburseCaptain + a);
      } else {
        b.reimburseCrew = round2(b.reimburseCrew + a);
      }
      return;
    }
    if (e.kind === "tipPayout" || e.stewPayKind === "tipPayout" || /^crew tip payout$/i.test(String(e.category || ""))) {
      if (expenseHitsPettyCash(e) || expensePaidFrom(e) === "petty") {
        b.tipPayout = round2(b.tipPayout + a);
      }
      return;
    }
    if (expenseHitsPettyCash(e)) {
      b.otherPetty = round2(b.otherPetty + a);
    }
  });
  return {
    commission: b.commission,
    crewDayPay: b.crewDayPay,
    reimburseCaptain: b.reimburseCaptain,
    reimburseCrew: b.reimburseCrew,
    tipPayout: b.tipPayout,
    otherPetty: b.otherPetty,
    commissionLines: commissionLines,
  };
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
function clearCrewFloatPayOnEmptyEnvelope(expenses, pettyStart, cashIns, opts) {
  opts = opts || {};
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
    /* Never wipe captain-marked pays (payStatusManual) — empty start often means
     * cash-ins not loaded yet; clearing floatPay put cash back on board wrongly. */
    if (opts.keepManual !== false && e.payStatusManual === true) return;
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
 *   physicalStart = max(0, storedStart)   // negative start is not notes
 *   priorShort    = max(0, −storedStart) + broughtForwardShort
 *                   // boat hole from prior month (books short / boat owed)
 *   available     = physicalStart + cashIns
 *   priorSettled  = min(available, priorShort)  // first cash pays the hole
 *   cashInHand    = available − priorSettled    // notes left after settling prior debt
 *   booksBalance  = cashInHand − cashOut        // diagnostic; may be negative
 *   pettyOnboard  = max(0, booksBalance)        // physical notes in the envelope
 *   cashShort     = max(0, −booksBalance) + prior remain
 *
 * When last month finished empty but boat was short €110, that €110 is brought
 * forward. New cash-in pays it first and leaves less on board (500 in → 390 free
 * if 110 was brought forward). Open people debts (pocket / day-pay) stay separate
 * until paid — freeFloat = onboard − peopleOwed.
 *
 * Cash out:
 *   - non-crew: expenseHitsPettyCash
 *   - crew day-pay: only floatPay (after collapse to one line per stew|date)
 * Never subtracts unpaid people (that is float books / still-owed, not petty).
 *
 * Carry next month: physical = pettyOnboard; short = residual cashShort.
 *
 * @param {{ pettyStart?: number, broughtForwardShort?: number, cashIns?: Array, expenses?: Array }} opts
 */
/**
 * Cash-in already counted on the boat ledger as free cash → boat or charges paid cash.
 * These rows are mirrored into expPetty for the Expenses envelope only — summing them
 * again with freeCashBoat + chargesCashBoat double-counts (e.g. “cash in €9300”).
 *
 * True for: fromLeadId / lead-cash:*, fromChargeId / charge-cash:*,
 * kind charter-fee | charter-fee-cash | end-charter.
 * Manual top-ups (ATM, bank, captain float) return false.
 */
function isAutoSyncedEnvelopeCashIn(r) {
  if (!r) return false;
  if (r.fromLeadId != null && String(r.fromLeadId) !== "") return true;
  if (r.fromChargeId != null && String(r.fromChargeId) !== "") return true;
  var kind = String(r.kind || "").toLowerCase();
  if (kind === "charter-fee" || kind === "charter-fee-cash" || kind === "end-charter")
    return true;
  var id = String(r.id || "");
  if (id.indexOf("lead-cash:") === 0 || id.indexOf("charge-cash:") === 0) return true;
  return false;
}

/**
 * Flatten + sum petty cash-in rows (envelope top-ups).
 * Controller supplies skip() for tips / auto-synced lead-charge rows if needed.
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
    var lines = Array.isArray(p.cashIns) ? p.cashIns.filter(Boolean) : [];
    if (lines.length) {
      /* Prefer explicit cashIns — do not also add pettyIn (would double-count) */
      lines.forEach(function (r) {
        if (!r) return;
        var row = Object.assign({}, r);
        if (!row.month && mon) row.month = mon;
        if (!row.date && mon) row.date = mon + "-01";
        out.push(row);
      });
      return;
    }
    /* Legacy single pettyIn only when there are no cashIns lines */
    if (num(p.pettyIn) > 0.009) {
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
  /* Physical start: notes only — never treat a negative “start” as cash */
  var physicalStart = storedStart > 0 ? storedStart : 0;
  var priorFromStart = storedStart < 0 ? round2(-storedStart) : 0;
  var broughtForwardShort = round2(Math.max(0, num(opts.broughtForwardShort)));
  /* Boat hole from prior month: negative stored start and/or explicit carry */
  var priorStartShort = round2(priorFromStart + broughtForwardShort);
  var cashIns = Array.isArray(opts.cashIns) ? opts.cashIns : [];
  var cashInTotal = 0;
  cashIns.forEach(function (r) {
    if (!r) return;
    cashInTotal += num(r.amount);
  });
  cashInTotal = round2(cashInTotal);
  /*
   * Envelope before outs = physical start + cash-in.
   * First claim on that envelope is brought-forward boat short (prior hole).
   * Example: short €110 + cash-in €500 → €110 paid as prior settle, €390 left
   * for this month’s expense outs / on board.
   */
  var cashInHand = round2(physicalStart + cashInTotal);
  var priorSettled = round2(Math.min(cashInHand, priorStartShort));
  var priorRemain = round2(priorStartShort - priorSettled);

  var col = collapseCrewDayPayExpenses(opts.expenses || []);
  var expenses = col.expenses;
  var cashOut = 0;
  var cashOutLines = [];
  var crewPaidPetty = 0;
  var nCrewPetty = 0;

  /* Virtual cash-out: prior boat short settled from this month’s cash first */
  if (priorSettled > 0.009) {
    cashOut += priorSettled;
    cashOutLines.push({
      kind: "prior-short",
      purpose: "prior-short",
      purposeLabel: "Brought forward · boat short",
      label: "Brought forward · boat owed / books short",
      detail:
        "Prior month left the boat short " +
        priorStartShort.toFixed(2).replace(/\.00$/, "") +
        " — paid from this month’s cash first",
      amount: priorSettled,
      id: "",
      date: "",
      virtual: true,
    });
  }

  expenses.forEach(function (e) {
    if (!e) return;
    var a = round2(num(e.amount));
    if (!(a > 0)) return;
    if (isCrewDayPayExpense(e)) {
      if (!crewDayPayHitsPetty(e)) return;
      var outAmt = crewDayPayPettyOutAmount(e);
      if (!(outAmt > 0.009)) return;
      a = outAmt;
      cashOut += a;
      crewPaidPetty += a;
      /* charterDate = roster day; date may be later pay day (when cash left pot) */
      var chDate =
        e.charterDate != null && String(e.charterDate).slice(0, 10)
          ? String(e.charterDate).slice(0, 10)
          : "";
      if (!chDate && e.description) {
        var mCh = String(e.description).match(/charter\s+(\d{4}-\d{2}-\d{2})/i);
        if (mCh) chDate = mCh[1];
      }
      cashOutLines.push({
        kind: "crew",
        purpose: "daypay",
        purposeLabel: "Crew day pay",
        label: (e.vendor || "Crew") + " · day pay",
        detail: e.description || "",
        amount: a,
        id: e.id,
        date: String(e.date || "").slice(0, 10),
        charterDate: chDate,
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
  /* start + cash-in − (prior settle + expense outs) */
  var booksBalance = round2(cashInHand - cashOut);
  var pettyOnboard = booksBalance > 0 ? booksBalance : 0;
  var monthShort = booksBalance < 0 ? round2(-booksBalance) : 0;
  /* Residual prior short not yet covered by cash + this month over-mark */
  var cashShort = round2(monthShort + priorRemain);

  /*
   * Where is the short from? (audit trail — pure, for UI)
   * 1) priorRemain: brought-forward boat short not yet covered by cash-in
   * 2) cash-out lines in date order: prior settle claims first, then expenses
   */
  var shortLines = [];
  if (priorRemain > 0.009) {
    shortLines.push({
      kind: "prior-start",
      label:
        "Brought forward boat short −" +
        priorRemain.toFixed(2).replace(/\.00$/, "") +
        " (not yet covered by cash-in)",
      amount: priorRemain,
      fullAmount: priorStartShort,
      covered: priorSettled,
      date: "",
      id: "",
    });
  }
  if (monthShort > 0.009 && cashOutLines.length) {
    var chrono = cashOutLines.slice().sort(function (a, b) {
      /* Prior-short claims the envelope first */
      if (a && a.virtual && !(b && b.virtual)) return -1;
      if (b && b.virtual && !(a && a.virtual)) return 1;
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
      /* Prior-short residual is already in priorRemain shortLines — skip dupe */
      if (row.virtual) return;
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

  /* Newest first for captain cash-out audit list; virtual prior-short stays on top */
  cashOutLines.sort(function (a, b) {
    if (a && a.virtual && !(b && b.virtual)) return -1;
    if (b && b.virtual && !(a && a.virtual)) return 1;
    var da = String((a && a.date) || "");
    var db = String((b && b.date) || "");
    if (da !== db) return db < da ? -1 : 1;
    return (Number(b && b.amount) || 0) - (Number(a && a.amount) || 0);
  });
  return {
    pettyStart: storedStart,
    physicalStart: physicalStart,
    broughtForwardShort: broughtForwardShort,
    priorStartShort: priorStartShort,
    priorSettled: priorSettled,
    priorRemain: priorRemain,
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

/**
 * True when a date (or YYYY-MM) is on or before the end of throughMonth.
 * Missing/invalid date → false when throughMonth is set (do not invent future).
 * Month reports must never include later-month money.
 */
function isOnOrBeforeMonth(dateOrMonth, throughMonth) {
  var through = String(throughMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(through)) return true;
  var m = expenseMonthKey(dateOrMonth);
  if (!m) {
    var s = String(dateOrMonth || "").slice(0, 7);
    m = /^\d{4}-\d{2}$/.test(s) ? s : "";
  }
  if (!m) return false;
  return m <= through;
}

/**
 * Ledger rows with date month ≤ throughMonth (pure).
 * Used for month PDFs / as-of reports so August money never appears on July.
 */
function filterLedgerThroughMonth(rows, throughMonth) {
  var through = String(throughMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(through)) {
    return Array.isArray(rows) ? rows.slice() : [];
  }
  return (Array.isArray(rows) ? rows : []).filter(function (r) {
    if (!r) return false;
    return isOnOrBeforeMonth(r.date != null ? r.date : r.month, through);
  });
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
    var pf0 = expensePaidFrom(e);
    if (pf0 === "own") return true;
    /* Guest/boss shortfall top-up from own pocket only (not full primary amount) */
    if (pf0 === "guest" || pf0 === "owner") {
      var g = crewDayPayPrimarySplit(e);
      return g.topUpFrom === "Own money" && g.topUp > 0.009;
    }
    return false;
  }
  /* Owner money is not captain/crew pocket liability (non-crew) */
  if (expensePaidFrom(e) === "owner") return false;
  return expensePaidFrom(e) === "own";
}

/** € of own-money spend (guest/boss top-up uses top-up only). */
function ownMoneySpendAmount(e) {
  if (!isOwnMoneySpend(e)) return 0;
  if (isCrewDayPayExpense(e)) {
    var pf1 = expensePaidFrom(e);
    if (pf1 === "guest" || pf1 === "owner") {
      return crewDayPayPrimarySplit(e).topUp;
    }
  }
  return round2(num(e.amount));
}

/** Who is owed for an own-money spend (captain or stew). */
function ownMoneySpendWhoId(e) {
  if (!e) return EXP_POCKET_CAPTAIN;
  if (e.paidById != null && String(e.paidById) !== "") return String(e.paidById);
  return EXP_POCKET_CAPTAIN;
}

/**
 * How much of an own-money expense is covered by reimbursements.
 *
 * 1) Linked by reimbursesExpenseId (always counts).
 * 2) Unlinked FIFO for that person — but a reimbursement may only cover
 *    spends dated on or before the reimbursement date.
 *    (July bulk repay can close July Vicky; it cannot pre-pay August Arianna.)
 *
 * @param {object} e own-money expense
 * @param {Array} expenses full ledger (all months)
 * @param {{ throughMonth?: string }} [opts] if throughMonth (YYYY-MM), ignore later reimbursements/spends
 */
function ownMoneyRepaidAmt(e, expenses, opts) {
  if (!isOwnMoneySpend(e)) return 0;
  var need = ownMoneySpendAmount(e);
  if (!(need > 0)) return 0;
  opts = opts || {};
  var through = opts.throughMonth ? String(opts.throughMonth).slice(0, 7) : "";
  var list = Array.isArray(expenses) ? expenses : [];
  if (/^\d{4}-\d{2}$/.test(through)) {
    list = filterLedgerThroughMonth(list, through);
  }
  var linked = 0;
  list.forEach(function (r) {
    if (!r || !isExpenseReimbursement(r)) return;
    if (String(r.reimbursesExpenseId || "") !== String(e.id)) return;
    linked += num(r.amount);
  });
  linked = round2(linked);
  if (linked >= need - 0.009) return need;

  var who = ownMoneySpendWhoId(e);
  var spendDate = String(e.date || "").slice(0, 10);

  /*
   * Build unlinked reimbursement pool as dated buckets (oldest first).
   * Missing date → treat as far-future so legacy undated lines can still cover.
   */
  var reimbs = [];
  list.forEach(function (r) {
    if (!r || !isExpenseReimbursement(r)) return;
    if (String(expenseReimburseWhoId(r) || "") !== String(who)) return;
    if (r.reimbursesExpenseId) return; /* linked already handled per expense */
    var a = round2(num(r.amount));
    if (!(a > 0)) return;
    var rd = String(r.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rd)) rd = "9999-12-31";
    reimbs.push({ date: rd, left: a });
  });
  reimbs.sort(function (a, b) {
    return String(a.date).localeCompare(String(b.date));
  });

  /* All own-money spends for this person, oldest first (shop + crew day-pay) */
  var own = list
    .filter(function (x) {
      return isOwnMoneySpend(x) && String(ownMoneySpendWhoId(x)) === String(who);
    })
    .sort(function (a, b) {
      var c = String(a.date || "").localeCompare(String(b.date || ""));
      if (c) return c;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

  var forThis = 0;
  for (var i = 0; i < own.length; i++) {
    var x = own[i];
    var a = ownMoneySpendAmount(x);
    var direct = 0;
    list.forEach(function (r) {
      if (r && isExpenseReimbursement(r) && String(r.reimbursesExpenseId || "") === String(x.id))
        direct += num(r.amount);
    });
    direct = round2(direct);
    var remain = Math.max(0, a - direct);
    var sd = String(x.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) sd = "0000-01-01";

    /* Draw from unlinked reimbursements dated on or after this spend */
    var got = 0;
    for (var j = 0; j < reimbs.length && remain - got > 0.009; j++) {
      if (reimbs[j].date < sd) continue; /* repay before spend cannot cover it */
      var take = Math.min(reimbs[j].left, remain - got);
      if (take > 0.009) {
        reimbs[j].left = round2(reimbs[j].left - take);
        got = round2(got + take);
      }
    }

    if (String(x.id) === String(e.id)) {
      forThis = round2(got + direct);
      break;
    }
  }
  return round2(Math.min(need, Math.max(linked, forThis)));
}

function ownMoneyIsRepaid(e, expenses, opts) {
  if (!isOwnMoneySpend(e)) return false;
  var need = ownMoneySpendAmount(e);
  if (!(need > 0)) return false;
  return ownMoneyRepaidAmt(e, expenses, opts) >= need - 0.009;
}

/**
 * Best reimbursing row for display (linked preferred, else newest unlinked to who).
 * Returns { date, amount, id } or null — UI formats the date string.
 * @param {{ throughMonth?: string }} [opts]
 */
function ownMoneyRepayHint(e, expenses, opts) {
  if (!isOwnMoneySpend(e) || !ownMoneyIsRepaid(e, expenses, opts)) return null;
  opts = opts || {};
  var through = opts.throughMonth ? String(opts.throughMonth).slice(0, 7) : "";
  var list = Array.isArray(expenses) ? expenses : [];
  if (/^\d{4}-\d{2}$/.test(through)) {
    list = filterLedgerThroughMonth(list, through);
  }
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
    var a = ownMoneySpendAmount(e);
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
    if (cls.hitsOwnMoneyPocket || isOwnMoneySpend(e)) {
      ensure(cls.ownMoneyPayerId || ownMoneySpendWhoId(e) || EXP_POCKET_CAPTAIN).paidOut +=
        cls.ownMoneyAmount > 0 ? cls.ownMoneyAmount : ownMoneySpendAmount(e) || num(e.amount);
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

/* ---------- Petty month open / close (pure carry — no writes) ---------- */

/**
 * Previous calendar month key (YYYY-MM).
 * @param {string} month
 * @returns {string}
 */
function prevCalendarMonthKey(month) {
  var m = String(month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(m)) return "";
  var y = Number(m.slice(0, 4));
  var mo = Number(m.slice(5, 7));
  mo -= 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return y + "-" + String(mo).padStart(2, "0");
}

function findPettyRow(expPettyList, month) {
  month = String(month || "").slice(0, 7);
  var rows = Array.isArray(expPettyList) ? expPettyList : [];
  for (var i = 0; i < rows.length; i++) {
    var p = rows[i];
    if (p && String(p.month || "").slice(0, 7) === month) return p;
  }
  return null;
}

/**
 * Pure close for one month once open inputs are known.
 * @returns {{ onboard: number, short: number, sum: object }}
 */
function summarizePettyMonthClose(opts) {
  var sum = summarizePettyCash(opts || {});
  return {
    onboard: round2(Math.max(0, num(sum.pettyOnboard != null ? sum.pettyOnboard : sum.pettyCash))),
    short: round2(Math.max(0, num(sum.cashShort))),
    sum: sum,
  };
}

/**
 * Resolve petty *open* fields for a month (pure).
 *
 * Carry rules (commercial foundation — computed, not healed on load):
 *  - prior close physical onboard → this month pettyStart
 *  - prior residual cashShort → this month broughtForwardShort
 *  - startMode=manual / startManual locks stored physical start
 *  - BF short may still inherit from prior when stored BF is empty
 *  - negative stored start is poison → physical 0 + short
 *
 * Never mutates rows. Never persists. Controllers/view may display; only an
 * explicit captain save or one-shot DB op may write.
 *
 * @param {string} month YYYY-MM
 * @param {Array} expPettyList
 * @param {Array} expenses all expenses
 * @param {{ depth?: number, isTipExpense?: function, cashInIsTip?: function }} opts
 */
function resolvePettyMonthOpen(month, expPettyList, expenses, opts) {
  opts = opts || {};
  month = String(month || "").slice(0, 7);
  var depth = opts.depth || 0;
  var empty = {
    month: month,
    pettyStart: 0,
    broughtForwardShort: 0,
    startMode: "none",
    carriedFrom: "",
    cashIns: [],
    row: null,
    source: "empty",
  };
  if (!/^\d{4}-\d{2}$/.test(month) || depth > 36) return empty;

  var row = findPettyRow(expPettyList, month);
  var cashInsRaw = row && Array.isArray(row.cashIns) ? row.cashIns.slice() : [];
  var cashIns = cashInsRaw;
  if (typeof opts.cashInIsTip === "function") {
    cashIns = cashInsRaw.filter(function (r) {
      return r && !opts.cashInIsTip(r);
    });
  }

  var prev = prevCalendarMonthKey(month);
  var priorClose = null;
  if (prev) {
    priorClose = resolvePettyMonthClose(prev, expPettyList, expenses, {
      depth: depth + 1,
      isTipExpense: opts.isTipExpense,
      cashInIsTip: opts.cashInIsTip,
    });
    if (priorClose && priorClose.empty) priorClose = null;
  }

  var isManual = !!(row && (row.startMode === "manual" || row.startManual === true));
  var isCarry = !!(row && row.startMode === "carry");
  var storedStart = row ? num(row.pettyStart) : 0;
  var storedBf = row ? Math.max(0, round2(num(row.broughtForwardShort))) : 0;
  var hasLines = false;
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e) return;
    if (expenseMonthKey(e.date) !== month) return;
    if (typeof opts.isTipExpense === "function" && opts.isTipExpense(e)) return;
    hasLines = true;
  });
  var hasIns = cashInsRaw.length > 0;

  var pettyStart = 0;
  var brought = 0;
  var startMode = "none";
  var carriedFrom = "";
  var source = "empty";

  if (isManual) {
    if (storedStart < -0.009) {
      pettyStart = 0;
      brought = round2(Math.abs(storedStart) + storedBf);
      if (!(brought > 0.009) && priorClose) brought = priorClose.short;
      source = "manual-poison";
    } else {
      pettyStart = round2(Math.max(0, storedStart));
      brought = storedBf;
      if (!(brought > 0.009) && priorClose && priorClose.short > 0.009) {
        brought = priorClose.short;
        source = "manual+priorShort";
      } else {
        source = "manual";
      }
    }
    startMode = "manual";
  } else if (isCarry) {
    if (priorClose) {
      pettyStart = priorClose.onboard;
      brought = priorClose.short;
      startMode = "carry";
      carriedFrom = prev;
      source = "carry";
    } else {
      pettyStart = round2(Math.max(0, storedStart));
      brought = storedBf;
      startMode = "carry";
      carriedFrom = row.carriedFrom || "";
      source = "carry-stored";
    }
  } else if (storedStart < -0.009) {
    var poison = Math.abs(storedStart);
    if (priorClose) {
      pettyStart = priorClose.onboard;
      brought = round2(poison + Math.max(0, priorClose.short));
      startMode = "carry";
      carriedFrom = prev;
    } else {
      pettyStart = 0;
      brought = round2(poison + storedBf);
      startMode = "none";
    }
    source = "poison-normalized";
  } else if (Math.abs(storedStart) > 0.009 || hasLines || hasIns) {
    /* Legacy row with real activity — treat start as locked for display */
    pettyStart = round2(Math.max(0, storedStart));
    brought = storedBf;
    if (!(brought > 0.009) && priorClose && priorClose.short > 0.009) {
      brought = priorClose.short;
      source = "legacy+priorShort";
    } else {
      source = "legacy";
    }
    startMode = row && row.startMode ? String(row.startMode) : "manual";
  } else if (priorClose) {
    pettyStart = priorClose.onboard;
    brought = priorClose.short;
    startMode = "carry";
    carriedFrom = prev;
    source = "carry-new";
  } else {
    source = "empty";
  }

  return {
    month: month,
    pettyStart: round2(Math.max(0, pettyStart)),
    broughtForwardShort: round2(Math.max(0, brought)),
    startMode: startMode,
    carriedFrom: carriedFrom,
    cashIns: cashIns,
    cashInsAll: cashInsRaw,
    row: row,
    source: source,
    priorMonth: prev,
    priorOnboard: priorClose ? priorClose.onboard : null,
    priorShort: priorClose ? priorClose.short : null,
  };
}

/**
 * Resolve petty month close (pure walk). empty=true when month and priors have no activity.
 */
function resolvePettyMonthClose(month, expPettyList, expenses, opts) {
  opts = opts || {};
  month = String(month || "").slice(0, 7);
  var depth = opts.depth || 0;
  if (!/^\d{4}-\d{2}$/.test(month) || depth > 36) {
    return { month: month, onboard: 0, short: 0, empty: true, open: null, sum: null };
  }
  var row = findPettyRow(expPettyList, month);
  var lines = [];
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e) return;
    if (expenseMonthKey(e.date) !== month) return;
    if (typeof opts.isTipExpense === "function" && opts.isTipExpense(e)) return;
    lines.push(e);
  });
  var hasActivity = !!(row || lines.length);
  if (!hasActivity) {
    var prev0 = prevCalendarMonthKey(month);
    if (!prev0) {
      return { month: month, onboard: 0, short: 0, empty: true, open: null, sum: null };
    }
    var priorOnly = resolvePettyMonthClose(prev0, expPettyList, expenses, {
      depth: depth + 1,
      isTipExpense: opts.isTipExpense,
      cashInIsTip: opts.cashInIsTip,
    });
    if (priorOnly && !priorOnly.empty) {
      /* No local activity: close equals prior close (nothing changed) */
      return {
        month: month,
        onboard: priorOnly.onboard,
        short: priorOnly.short,
        empty: false,
        open: null,
        sum: null,
        passthrough: true,
      };
    }
    return { month: month, onboard: 0, short: 0, empty: true, open: null, sum: null };
  }

  var open = resolvePettyMonthOpen(month, expPettyList, expenses, opts);
  var closed = summarizePettyMonthClose({
    pettyStart: open.pettyStart,
    broughtForwardShort: open.broughtForwardShort,
    cashIns: open.cashIns,
    expenses: lines,
  });
  return {
    month: month,
    onboard: closed.onboard,
    short: closed.short,
    empty: false,
    open: open,
    sum: closed.sum,
  };
}

/**
 * Plan store patches to materialize pure carry into expPetty rows.
 * For explicit DB/ops only — never from load or paint.
 *
 * @returns {{ patches: Array<{month, fields}>, n: number }}
 */
function planPettyCarryMaterialize(expPettyList, expenses, months, opts) {
  opts = opts || {};
  var list = Array.isArray(months) ? months.slice() : [];
  if (!list.length) {
    var seen = {};
    (Array.isArray(expPettyList) ? expPettyList : []).forEach(function (p) {
      if (p && p.month) seen[String(p.month).slice(0, 7)] = 1;
    });
    (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
      var m = expenseMonthKey(e && e.date);
      if (m) seen[m] = 1;
    });
    list = Object.keys(seen).sort();
  }
  var patches = [];
  list.forEach(function (month) {
    var open = resolvePettyMonthOpen(month, expPettyList, expenses, opts);
    if (!open || open.source === "empty") return;
    if (open.startMode === "manual" && open.source === "manual") {
      /* Manual lock: only patch BF if inheriting prior short and stored empty */
      var rowM = open.row;
      if (
        rowM &&
        !(Math.max(0, num(rowM.broughtForwardShort)) > 0.009) &&
        open.broughtForwardShort > 0.009
      ) {
        patches.push({
          month: month,
          fields: { broughtForwardShort: open.broughtForwardShort },
          reason: "manual-inherit-prior-short",
        });
      }
      return;
    }
    var row = open.row;
    var need =
      !row ||
      round2(Math.max(0, num(row.pettyStart))) !== open.pettyStart ||
      round2(Math.max(0, num(row.broughtForwardShort))) !== open.broughtForwardShort ||
      String(row.startMode || "") !== open.startMode ||
      String(row.carriedFrom || "") !== String(open.carriedFrom || "");
    if (!need) return;
    patches.push({
      month: month,
      fields: {
        pettyStart: open.pettyStart,
        broughtForwardShort: open.broughtForwardShort,
        startMode: open.startMode,
        carriedFrom: open.carriedFrom || "",
      },
      reason: open.source,
      create: !row,
    });
  });
  return { patches: patches, n: patches.length };
}

/**
 * Non-mutating plan: which crew floatPay lines would clear on empty envelope.
 * Prefer this for ops/dry-run. clearCrewFloatPayOnEmptyEnvelope mutates (legacy).
 */
function planClearCrewFloatPayOnEmptyEnvelope(expenses, pettyStart, cashIns, opts) {
  opts = opts || {};
  var physicalStart = Math.max(0, round2(num(pettyStart)));
  var cashInTotal = 0;
  (Array.isArray(cashIns) ? cashIns : []).forEach(function (r) {
    if (r) cashInTotal += num(r.amount);
  });
  cashInTotal = round2(cashInTotal);
  var envelope = round2(physicalStart + cashInTotal);
  var list = Array.isArray(expenses) ? expenses : [];
  if (envelope > 0.009) {
    return { changed: false, clearIds: [], envelope: envelope };
  }
  var clearIds = [];
  list.forEach(function (e) {
    if (!isCrewDayPayExpense(e)) return;
    if (String(e.crewPayStatus || "") !== "Paid") return;
    if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return;
    if (e.floatPay !== true) return;
    if (opts.keepManual !== false && e.payStatusManual === true) return;
    if (e.id != null) clearIds.push(String(e.id));
  });
  return {
    changed: clearIds.length > 0,
    clearIds: clearIds,
    envelope: envelope,
  };
}

/**
 * Captain pocket month bridge (pure) — month-to-month carry for reports/UI.
 *
 * Rules (no DOM, no writes):
 *  - Spend = isOwnMoneySpend by captain (not card).
 *  - Repay = reimbursement that clears captain pocket.
 *  - monthSpend / monthRepay = lines with date month === focus month (cash movement).
 *  - broughtForward / closingOpen use date-aware ownMoneyRepaidAmt (same as open pocket):
 *      a repay dated before a spend cannot cover that spend (no pre-pay of future pocket).
 *  - repayToPrior / repayToThis = how much prior vs this-month open was closed by month end.
 *  - Stew day rate = crew day-pay expense or category Crew Salaries; long day if amount ≥ 249.99.
 *
 * @param {Array} expenses all expenses (not month-scoped only)
 * @param {string} month YYYY-MM
 * @returns {object} DTO for paint / PDF
 */
function summarizeCaptainPocketMonthBridge(expenses, month) {
  month = String(month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return {
      month: month,
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
      openLines: [],
    };
  }
  function monOf(e) {
    return expenseMonthKey(e && e.date) || String((e && e.date) || "").slice(0, 7);
  }
  function isCapOwn(e) {
    if (!isOwnMoneySpend(e)) return false;
    if (String(e.payMethod || "") === "Credit Card") return false;
    var w = String(ownMoneySpendWhoId(e) || EXP_POCKET_CAPTAIN);
    return w === EXP_POCKET_CAPTAIN || w === "captain";
  }
  function isCapRepay(e) {
    if (!isExpenseReimbursement(e)) return false;
    return expenseReimburseWhoId(e) === EXP_POCKET_CAPTAIN;
  }
  function isStewDay(e) {
    return isCrewDayPayExpense(e) || /^crew salaries$/i.test(String((e && e.category) || ""));
  }
  var spends = [];
  var repays = [];
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!e) return;
    if (isCapOwn(e)) spends.push(e);
    if (isCapRepay(e)) repays.push(e);
  });
  spends.sort(function (a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  });
  repays.sort(function (a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  });

  var priorSpend = 0;
  var monthSpend = 0;
  var priorRepay = 0;
  var monthRepay = 0;
  var priorLines = [];
  var monthLines = [];
  var monthRepayLines = [];
  var stewMonth = 0;
  var shopMonth = 0;
  var stewPrior = 0;
  var shopPrior = 0;

  spends.forEach(function (e) {
    var em = monOf(e);
    var a = round2(num(e.amount));
    if (!(a > 0.009)) return;
    var stew = isStewDay(e);
    var row = {
      id: String(e.id || ""),
      date: String(e.date || "").slice(0, 10),
      month: em,
      amount: a,
      vendor: String(e.vendor || e.description || "Spend").trim() || "Spend",
      description: String(e.description || "").trim(),
      isStew: stew,
      isLongDay: !!(stew && a >= 249.99),
      charterDate: String(e.charterDate || "").slice(0, 10),
    };
    if (em && em < month) {
      priorSpend = round2(priorSpend + a);
      priorLines.push(row);
      if (stew) stewPrior = round2(stewPrior + a);
      else shopPrior = round2(shopPrior + a);
    } else if (em === month) {
      monthSpend = round2(monthSpend + a);
      monthLines.push(row);
      if (stew) stewMonth = round2(stewMonth + a);
      else shopMonth = round2(shopMonth + a);
    }
  });

  repays.forEach(function (e) {
    var em = monOf(e);
    var a = round2(num(e.amount));
    if (!(a > 0.009)) return;
    if (em && em < month) priorRepay = round2(priorRepay + a);
    else if (em === month) {
      monthRepay = round2(monthRepay + a);
      monthRepayLines.push({
        id: String(e.id || ""),
        date: String(e.date || "").slice(0, 10),
        amount: a,
        vendor: String(e.vendor || "Captain").trim() || "Captain",
        description: String(e.description || "").trim(),
      });
    }
  });

  /* Prior calendar month key (for BF as-of end of that month) */
  function prevMonthKey(ym) {
    var p = String(ym || "").slice(0, 7).split("-");
    if (p.length !== 2) return "";
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10);
    if (!y || !m) return "";
    if (m === 1) return y - 1 + "-12";
    return y + "-" + String(m - 1).padStart(2, "0");
  }
  var prevM = prevMonthKey(month);

  /**
   * Open remain on one spend as-of end of throughMonth (date-aware FIFO).
   * Attach remainOpen on line rows for PDF / UI.
   */
  function remainOn(e, throughMonth) {
    var need = round2(num(e.amount));
    if (!(need > 0.009)) return 0;
    var paid = ownMoneyRepaidAmt(e, expenses, throughMonth ? { throughMonth: throughMonth } : {});
    return round2(Math.max(0, need - paid));
  }

  var broughtForward = 0;
  priorLines.forEach(function (row) {
    var e = spends.find(function (s) {
      return String(s.id || "") === String(row.id || "");
    });
    var rem = e ? remainOn(e, prevM) : row.amount;
    row.remainOpenAtMonthStart = rem;
    row.repaidAmt = round2(Math.max(0, (row.amount || 0) - rem));
    broughtForward = round2(broughtForward + rem);
  });

  var openPriorAtEnd = 0;
  priorLines.forEach(function (row) {
    var e = spends.find(function (s) {
      return String(s.id || "") === String(row.id || "");
    });
    var rem = e ? remainOn(e, month) : 0;
    row.remainOpen = rem;
    openPriorAtEnd = round2(openPriorAtEnd + rem);
  });

  var openThisAtEnd = 0;
  monthLines.forEach(function (row) {
    var e = spends.find(function (s) {
      return String(s.id || "") === String(row.id || "");
    });
    var rem = e ? remainOn(e, month) : row.amount;
    row.remainOpen = rem;
    row.repaidAmt = round2(Math.max(0, (row.amount || 0) - rem));
    openThisAtEnd = round2(openThisAtEnd + rem);
  });

  var closingOpen = round2(openPriorAtEnd + openThisAtEnd);
  var monthNet = round2(monthSpend - monthRepay);
  /* How much prior vs this-month open was closed by end of focus month */
  var repayToPrior = round2(Math.max(0, broughtForward - openPriorAtEnd));
  var repayToThis = round2(Math.max(0, monthSpend - openThisAtEnd));

  /* Lines still open at month end — for owner PDF */
  var openLines = [];
  priorLines.forEach(function (row) {
    if ((row.remainOpen || 0) > 0.009) openLines.push(row);
  });
  monthLines.forEach(function (row) {
    if ((row.remainOpen || 0) > 0.009) openLines.push(row);
  });

  return {
    month: month,
    broughtForward: broughtForward,
    monthSpend: monthSpend,
    monthRepay: monthRepay,
    monthNet: monthNet,
    closingOpen: closingOpen,
    stewMonth: stewMonth,
    shopMonth: shopMonth,
    stewPrior: stewPrior,
    shopPrior: shopPrior,
    repayToPrior: repayToPrior,
    repayToThis: repayToThis,
    priorLines: priorLines,
    monthLines: monthLines,
    monthRepayLines: monthRepayLines,
    openLines: openLines,
  };
}

/**
 * Captain actually settled this day-pay line (not a ghost Paid row).
 * True when Paid AND (floatPay from petty OR payStatusManual / Prior).
 * Bare Paid without either is noise from heal/sync and must not park the charter.
 */
function crewDayPayIsExplicitlyPaid(e) {
  if (!e || !isCrewDayPayExpense(e)) return false;
  if (String(e.crewPayStatus || "") !== "Paid") return false;
  if (e.floatPay === true) return true;
  if (e.payStatusManual === true) return true;
  return false;
}

/**
 * Settled day-pay fingerprints from **explicit** Paid expense lines only.
 * Used so open-owed never re-lists charters already paid on the books.
 */
function buildCrewDayPaySettledSets(expenses) {
  var byEventStew = {};
  var byFinger = {};
  var byLink = {};
  (Array.isArray(expenses) ? expenses : []).forEach(function (e) {
    if (!crewDayPayIsExplicitlyPaid(e)) return;
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
  /* Assign Paid only when captain-manual (Prior or Stews mark) — not bare ghost Paid */
  if (String(asg.payStatus || "") === "Paid" && asg.payStatusManual === true) return true;
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
 * Pure plan: unpark day-pay marked Paid without cash leaving the float
 * for charters from today onward only (Toni “parked Paid” before the trip).
 *
 * NEVER bulk-unpark past Paid history — that falsely reopens all stews.
 *
 * Keeps lines that actually hit petty (floatPay). Drops ghost expense rows and
 * sets assign → Unpaid so open-owed / Stews show unpaid until captain pays.
 *
 * @param {{ assigns?: Array, expenses?: Array, today?: string }} input
 * @returns {{ changed: boolean, assignPatches: Array, dropExpenseIds: Array }}
 */
function planUnparkDayPayNotFromFloat(input) {
  input = input || {};
  var today = String(input.today || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return { changed: false, assignPatches: [], dropExpenseIds: [] };
  }
  var assigns = Array.isArray(input.assigns) ? input.assigns : [];
  var expenses = Array.isArray(input.expenses) ? input.expenses : [];
  var assignPatches = [];
  var dropExpenseIds = [];
  var dropSet = {};

  assigns.forEach(function (asg) {
    if (!asg || !asg.eventKey) return;
    var start = String(asg.start || "").slice(0, 10);
    if (!start || start < today) return;
    if (String(asg.payStatus || "") !== "Paid") return;

    var ek = String(asg.eventKey);
    var lines = [];
    expenses.forEach(function (e) {
      if (!e || !isCrewDayPayExpense(e)) return;
      if (String(e.stewEventKey || "") !== ek) return;
      lines.push(e);
    });
    var hasFloatPay = lines.some(function (e) {
      return String(e.crewPayStatus || "") === "Paid" && e.floatPay === true;
    });
    if (hasFloatPay) return;

    assignPatches.push({
      eventKey: ek,
      payStatus: "Unpaid",
      payStatusManual: true,
    });
    lines.forEach(function (e) {
      if (e && e.id != null && !dropSet[String(e.id)]) {
        dropSet[String(e.id)] = 1;
        dropExpenseIds.push(String(e.id));
      }
    });
  });

  /* Bare Paid day-pay ghosts (no manual, no float) from today+ only */
  expenses.forEach(function (e) {
    if (!e || !isCrewDayPayExpense(e)) return;
    if (String(e.crewPayStatus || "") !== "Paid") return;
    if (e.floatPay === true || e.payStatusManual === true) return;
    var d = String(e.date || "").slice(0, 10);
    if (!d || d < today) return;
    if (e.id != null && !dropSet[String(e.id)]) {
      dropSet[String(e.id)] = 1;
      dropExpenseIds.push(String(e.id));
    }
  });

  return {
    changed: assignPatches.length > 0 || dropExpenseIds.length > 0,
    assignPatches: assignPatches,
    dropExpenseIds: dropExpenseIds,
  };
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
    var end = String(asg.end || asg.start || "").slice(0, 10);
    if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) end = start;
    /* Only after charter finished (last day before today) — not today or future */
    if (!end || end >= today) return;
    if (!start) start = end;
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
 * @param {Array} tipRows pre-normalized [{eventKey, tipSource, tipPaid, tipTotal, start, summary, tipEach, tipCaptain, tipStewSide, nStews, stewNames?, cancelled?}]
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
    var names = Array.isArray(row.stewNames)
      ? row.stewNames.map(function (n) {
          return String(n || "").trim();
        }).filter(Boolean)
      : [];
    var ids = Array.isArray(row.stewIds) ? row.stewIds.map(String) : [];
    var tipEach = num(row.tipEach);
    var tipCaptain = num(row.tipCaptain);
    var tipStewSide = num(row.tipStewSide);
    var capPaid = row.captainPaid === true || row.captainPaid === "true" || row.captainPaid === 1;
    var stewPaidBy =
      row.stewPaidBy && typeof row.stewPaidBy === "object" ? row.stewPaidBy : {};
    /* Only unpaid shares (captain / Laura paid separately) */
    var shares = [];
    if (tipCaptain > 0.009 && !capPaid) {
      shares.push({ who: "Captain", whoKey: "captain", amount: round2(tipCaptain), role: "captain" });
    }
    if (ids.length) {
      ids.forEach(function (sid, idx) {
        var paid =
          stewPaidBy[sid] === true ||
          stewPaidBy[sid] === "true" ||
          stewPaidBy[sid] === 1;
        if (paid) return;
        if (!(tipEach > 0.009)) return;
        var nm = names[idx] || "Stew";
        shares.push({
          who: nm,
          whoKey: "stew:" + String(sid),
          amount: round2(tipEach),
          role: "stew",
          stewId: String(sid),
        });
      });
    } else {
      names.forEach(function (nm, idx) {
        if (!(tipEach > 0.009)) return;
        shares.push({
          who: nm,
          whoKey: "stew:" + nm.toLowerCase(),
          amount: round2(tipEach),
          role: "stew",
        });
      });
    }
    /* Fallback when names missing but stew side known */
    if (!shares.length && !capPaid && tipCaptain > 0.009) {
      shares.push({ who: "Captain", whoKey: "captain", amount: round2(tipCaptain), role: "captain" });
    }
    if (!names.length && !ids.length && tipStewSide > 0.009 && tipEach > 0.009 && !row.paid) {
      var nEst = Math.max(1, Math.round(tipStewSide / tipEach) || num(row.nStews) || 1);
      for (var i = 0; i < nEst; i++) {
        shares.push({
          who: nEst === 1 ? "Stew" : "Stew " + (i + 1),
          whoKey: "stew:#" + i,
          amount: round2(tipEach),
          role: "stew",
        });
      }
    }
    var openAmt = 0;
    shares.forEach(function (sh) {
      openAmt = round2(openAmt + num(sh.amount));
    });
    if (!(openAmt > 0.009)) return; /* all person shares already paid */
    out.push({
      kind: "tip",
      eventKey: String(row.eventKey),
      label: "Tips on bill · " + (row.summary || "Charter"),
      amount: openAmt,
      guestTotal: tot,
      date: start,
      month: m || "",
      tipEach: tipEach,
      tipCaptain: tipCaptain,
      tipStewSide: tipStewSide,
      nStews: num(row.nStews) || names.length || ids.length,
      stewNames: names,
      stewIds: ids,
      shares: shares,
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
 * Group open tip payouts by who is still owed (Captain, Laura, …).
 * Total of person rows may exceed charter guest total if rounded shares —
 * person amounts use each share; charter items list the share for that person.
 *
 * @param {Array} openTips from collectOpenTipPayouts
 * @returns {{ total, people: Array<{name, whoKey, amount, role, items}> }}
 */
function summarizeOpenTipOwedByPerson(openTips) {
  var by = {};
  (Array.isArray(openTips) ? openTips : []).forEach(function (t) {
    if (!t) return;
    var shares = Array.isArray(t.shares) ? t.shares : [];
    if (!shares.length) {
      /* Legacy open tip without shares — keep one anonymous line */
      var key = "tip:all";
      if (!by[key]) by[key] = { name: "Tips on bill", whoKey: key, amount: 0, role: "mixed", items: [] };
      by[key].amount = round2(by[key].amount + num(t.amount));
      by[key].items.push({
        date: t.date,
        month: t.month,
        label: t.label || t.summary || "Charter",
        amount: num(t.amount),
        eventKey: t.eventKey,
        summary: t.summary,
      });
      return;
    }
    shares.forEach(function (sh) {
      if (!sh || !(num(sh.amount) > 0.009)) return;
      var k = String(sh.whoKey || sh.who || "unknown");
      if (!by[k]) {
        by[k] = {
          name: String(sh.who || "Crew"),
          whoKey: k,
          amount: 0,
          role: sh.role || (k === "captain" ? "captain" : "stew"),
          items: [],
        };
      }
      by[k].amount = round2(by[k].amount + num(sh.amount));
      by[k].items.push({
        date: t.date,
        month: t.month,
        label: (t.summary || "Charter") + " · tip share",
        amount: round2(num(sh.amount)),
        eventKey: t.eventKey,
        summary: t.summary,
      });
    });
  });
  var people = Object.keys(by).map(function (k) {
    return by[k];
  });
  people.sort(function (a, b) {
    if (a.role === "captain" && b.role !== "captain") return -1;
    if (b.role === "captain" && a.role !== "captain") return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  var total = 0;
  people.forEach(function (p) {
    total = round2(total + num(p.amount));
  });
  return { total: total, people: people, n: people.length };
}

/**
 * Month settlement DTO for Expenses UI.
 * Petty numbers come from summarizePettyCash; liabilities from pocket + open lists.
 *
 * @param {{
 *   expenses: Array,           // month lines
 *   allExpenses?: Array,       // full ledger for repay matching
 *   pettyStart: number,
 *   broughtForwardShort?: number, // prior month boat short carried into this month
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
    broughtForwardShort: opts.broughtForwardShort,
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
    broughtForwardShort: Number(pettySum.broughtForwardShort) || 0,
    priorSettled: Number(pettySum.priorSettled) || 0,
    priorRemain: Number(pettySum.priorRemain) || 0,
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
    EXP_POCKET_OWNER: EXP_POCKET_OWNER,
    expensePaidFromLooksOwner: expensePaidFromLooksOwner,
    expensePaidFromLooksGuest: expensePaidFromLooksGuest,
    isExpenseReimbursement: isExpenseReimbursement,
    expensePaidFromLooksOwn: expensePaidFromLooksOwn,
    expensePaidFrom: expensePaidFrom,
    expenseHitsPettyCash: expenseHitsPettyCash,
    normalizeExpenseReimbursement: normalizeExpenseReimbursement,
    classifyExpenseCash: classifyExpenseCash,
    isCrewDayPayExpense: isCrewDayPayExpense,
    crewDayPayFinger: crewDayPayFinger,
    crewDayPayLinkId: crewDayPayLinkId,
    crewDayPayGuestSplit: crewDayPayGuestSplit,
    crewDayPayPrimarySplit: crewDayPayPrimarySplit,
    crewDayPayHitsPetty: crewDayPayHitsPetty,
    crewDayPayPettyOutAmount: crewDayPayPettyOutAmount,
    crewDayPayFundSource: crewDayPayFundSource,
    crewPayGuestFromDescription: crewPayGuestFromDescription,
    crewPayOwnerJustification: crewPayOwnerJustification,
    summarizeCrewPayMonth: summarizeCrewPayMonth,
    summarizePettyCashOutBuckets: summarizePettyCashOutBuckets,
    crewDayPayLineScore: crewDayPayLineScore,
    collapseCrewDayPayExpenses: collapseCrewDayPayExpenses,
    clearCrewFloatPayOnEmptyEnvelope: clearCrewFloatPayOnEmptyEnvelope,
    planClearCrewFloatPayOnEmptyEnvelope: planClearCrewFloatPayOnEmptyEnvelope,
    summarizePettyCash: summarizePettyCash,
    summarizePettyMonthClose: summarizePettyMonthClose,
    prevCalendarMonthKey: prevCalendarMonthKey,
    resolvePettyMonthOpen: resolvePettyMonthOpen,
    resolvePettyMonthClose: resolvePettyMonthClose,
    planPettyCarryMaterialize: planPettyCarryMaterialize,
    isAutoSyncedEnvelopeCashIn: isAutoSyncedEnvelopeCashIn,
    summarizePettyCashInRows: summarizePettyCashInRows,
    collectPettyCashInsFromMonths: collectPettyCashInsFromMonths,
    isCaptainCommissionExpense: isCaptainCommissionExpense,
    summarizeCaptainCommissionPaid: summarizeCaptainCommissionPaid,
    summarizeCaptainCommissionBalance: summarizeCaptainCommissionBalance,
    /* Pocket / liabilities (Keepafloat foundation) */
    expenseMonthKey: expenseMonthKey,
    isOnOrBeforeMonth: isOnOrBeforeMonth,
    filterLedgerThroughMonth: filterLedgerThroughMonth,
    expenseReimburseWhoId: expenseReimburseWhoId,
    isOwnMoneySpend: isOwnMoneySpend,
    ownMoneySpendAmount: ownMoneySpendAmount,
    ownMoneySpendWhoId: ownMoneySpendWhoId,
    ownMoneyRepaidAmt: ownMoneyRepaidAmt,
    ownMoneyIsRepaid: ownMoneyIsRepaid,
    ownMoneyRepayHint: ownMoneyRepayHint,
    collectOpenPocketOuts: collectOpenPocketOuts,
    summarizePocketBalances: summarizePocketBalances,
    summarizeCaptainPocketMonthBridge: summarizeCaptainPocketMonthBridge,
    crewDayPayIsExplicitlyPaid: crewDayPayIsExplicitlyPaid,
    buildCrewDayPaySettledSets: buildCrewDayPaySettledSets,
    isCrewDayPaySettled: isCrewDayPaySettled,
    planUnparkDayPayNotFromFloat: planUnparkDayPayNotFromFloat,
    collectOpenCrewDayPay: collectOpenCrewDayPay,
    collectOpenTipPayouts: collectOpenTipPayouts,
    summarizeOpenTipOwedByPerson: summarizeOpenTipOwedByPerson,
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
