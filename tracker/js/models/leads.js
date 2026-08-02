/**
 * LY_MODELS · leads (sources, free cash, commission, projected net)
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
    root.LY_MODELS_PARTS.leads = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;
  var moneyFromBase = util.moneyFromBase;

var CAPTAIN_COMMISSION_PCT = 15;
/** Click&Boat (Paul): 21% of charter fee before VAT. */
var CLICKBOAT_COMMISSION_PCT = 21;
var BILL_TYPES = { cash: 1, invoice: 1, mix: 1 };
/**
 * Charter book source (commission assignment):
 *  - captain = website or direct contact (15% commission)
 *  - clickboat = Paul / Click&Boat (21% before VAT)
 *  - owner = owner’s days / private guests (no income, no commission; owner benefits)
 *  - ownersourced = owner-sourced commercial charter (income; commission 0 for now, may add later)
 *  - other = legacy / unknown (no commission)
 */
var LEAD_SOURCES = { pending: 1, captain: 1, clickboat: 1, owner: 1, ownersourced: 1, other: 1 };
/** Owner-sourced charters: income, no commission yet (raise when agreed). */
var OWNER_SOURCED_COMMISSION_PCT = 0;
/**
 * Public charter fee table (VAT included “from” rates on the site).
 * High season = Jul–Aug (month index 6–7). Multi-day uses full-day rate × nights/days.
 */
var CHARTER_RATES = {
  low: { "4h": 1700, "6h": 2400, "8h": 3000, day: 3000 },
  high: { "4h": 2200, "6h": 3100, "8h": 4000, day: 4000 },
};

function leadHasSplit(r) {
  return !!(
    r &&
    (r.split || r.splitCash) &&
    (num(r.invoiceNet) > 0 ||
      num(r.invoiceTotal) > 0 ||
      num(r.cashAmt) > 0 ||
      num(r.dealNet) > 0 ||
      r.split ||
      r.splitCash)
  );
}

function leadSource(r) {
  if (!r) return "other";
  if (r.captainLead === true) return "captain";
  /* Empty / missing source = captain (legacy book before ICS import) */
  if (r.leadSource == null || r.leadSource === "") return "captain";
  return constrainLeadSource(r.leadSource);
}

function isCaptainLead(r) {
  return leadSource(r) === "captain";
}

/** Captain’s own 15% deals (website / direct). */
function leadEarnsCaptainCommission(r) {
  return isCaptainLead(r);
}

/** Commission rate % for this lead’s source (0 = none). */
function leadCommissionRatePct(r) {
  var src = leadSource(r);
  if (src === "pending") return 0;
  if (src === "captain") return CAPTAIN_COMMISSION_PCT;
  if (src === "clickboat") return CLICKBOAT_COMMISSION_PCT;
  if (src === "ownersourced") return OWNER_SOURCED_COMMISSION_PCT;
  return 0;
}

/** Captain or Click&Boat — any payable commission line. */
function leadEarnsCommission(r) {
  return leadCommissionRatePct(r) > 0;
}

function isClickboatLead(r) {
  return leadSource(r) === "clickboat";
}

/** True owner’s days / private guests — not business income. */
function isOwnerLead(r) {
  return leadSource(r) === "owner";
}

/** Owner-sourced commercial charter — counts as income; commission may be 0 for now. */
function isOwnerSourcedLead(r) {
  return leadSource(r) === "ownersourced";
}

/**
 * Deal confirmed/closed.
 * Explicit false = tentative (source may be set; not firm).
 * Explicit true = confirmed.
 * Undefined on a saved lead (has id) = legacy closed — do not reopen past book.
 * New drafts (no id) default open.
 * Assigning source does NOT imply closed; deposit Paid or manual tick does.
 */
function leadIsDealClosed(r) {
  if (!r) return false;
  if (r.dealClosed === true || r.dealClosed === "true" || r.dealClosed === 1) return true;
  if (r.dealClosed === false || r.dealClosed === "false" || r.dealClosed === 0) return false;
  if (!r.id) return false;
  return true;
}

/**
 * Owner’s days only (not owner-sourced income): no commission, not cash sales.
 * Count toward “owner benefits” only when confirmed (deal closed).
 * Unconfirmed owner assignment stays out of the benefits total until confirm.
 * Legacy leads without dealClosed are treated as confirmed (see leadIsDealClosed).
 * ownerBenefitExclude === true → out of the benefits total (user toggled off).
 */
function ownerBenefitIncluded(r) {
  if (!isOwnerLead(r)) return false;
  if (!leadIsDealClosed(r)) return false;
  if (r.ownerBenefitExclude === true || r.ownerBenefitExclude === "true" || r.ownerBenefitExclude === 1)
    return false;
  if (r.ownerBenefit === false || r.ownerBenefit === "false" || r.ownerBenefit === 0) return false;
  return true;
}

function constrainLeadSource(v) {
  var s = String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  if (!s) return "other";
  if (s === "pending" || s === "unassigned" || s === "assign") return "pending";
  if (s === "captain" || s === "cpt" || s === "website" || s === "web" || s === "direct")
    return "captain";
  if (
    s === "clickboat" ||
    s === "click_boat" ||
    s === "click-and-boat" ||
    s === "click&boat" ||
    s === "c&b" ||
    s === "cb" ||
    s === "paul"
  )
    return "clickboat";
  /* Owner-sourced commercial first — do not collapse into owner days */
  if (
    s === "ownersourced" ||
    s === "owner-sourced" ||
    s === "owner_sourced" ||
    s === "owner-source" ||
    s === "ownersource" ||
    s === "owner-charter" ||
    s === "owner_charter" ||
    s === "ownercharter" ||
    s === "owner-income" ||
    s === "owner_income"
  )
    return "ownersourced";
  if (
    s === "owner" ||
    s === "owners" ||
    s === "owner-day" ||
    s === "owner-days" ||
    s === "ownerdays" ||
    s === "owner_days" ||
    s === "owner-use" ||
    s === "owner_use" ||
    s === "private"
  )
    return "owner";
  if (s === "other" || s === "agency" || s === "manager") return "other";
  return LEAD_SOURCES[s] ? s : "other";
}

function leadSourceLabel(src) {
  var s = constrainLeadSource(src);
  if (s === "pending") return "Pending source";
  if (s === "captain") return "Captain";
  if (s === "clickboat") return "Click&Boat (Paul)";
  if (s === "owner") return "Owner’s days";
  if (s === "ownersourced") return "Owner-sourced";
  return "Other";
}

/** high = Jul–Aug; low = rest of year (site season rules). */
function charterSeason(ymd) {
  var m = parseInt(String(ymd || "").slice(5, 7), 10);
  if (!(m >= 1 && m <= 12)) {
    m = new Date().getMonth() + 1;
  }
  return m >= 7 && m <= 8 ? "high" : "low";
}

function hoursBetweenTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  var sh = String(startTime).split(":");
  var eh = String(endTime).split(":");
  var sm = parseInt(sh[0], 10) * 60 + (parseInt(sh[1], 10) || 0);
  var em = parseInt(eh[0], 10) * 60 + (parseInt(eh[1], 10) || 0);
  if (!isFinite(sm) || !isFinite(em)) return null;
  var hours = (em - sm) / 60;
  if (hours < 0) hours += 24;
  return hours;
}

/**
 * Inclusive calendar days for multi-day all-day exclusive DTEND spans:
 * start 17 end 20 (exclusive) → 3 nights/days of charter → we use expand-style days.
 * Pass precomputed days when available.
 */
function charterCalendarDays(start, end, allDay, daysList) {
  if (daysList && daysList.length) return daysList.length;
  var s = String(start || "").slice(0, 10);
  var e = String(end || start || "").slice(0, 10);
  if (!s) return 1;
  if (!e || e === s) return 1;
  var a = new Date(s + "T12:00:00Z");
  var b = new Date(e + "T12:00:00Z");
  var diff = Math.round((b - a) / 86400000);
  if (allDay && diff > 0) return diff; /* exclusive end */
  if (diff < 0) return 1;
  return diff + 1; /* timed multi inclusive */
}

/**
 * Infer charter duration band + list price from calendar event (or lead fields).
 * @returns {{ season, dur, days, rate, price, total, label }}
 */
function charterPriceFromEvent(ev) {
  ev = ev || {};
  var start = String(ev.start || "").slice(0, 10);
  var end = String(ev.end || ev.start || "").slice(0, 10);
  var season = charterSeason(start);
  var table = CHARTER_RATES[season] || CHARTER_RATES.low;
  var days = charterCalendarDays(start, end, !!ev.allDay, ev.days);
  var sum = String(ev.summary || "");
  var hours = hoursBetweenTimes(ev.startTime, ev.endTime);
  if (/\b4\s*h(our)?s?\b/i.test(sum) || /\bhalf[-\s]?day\b/i.test(sum)) hours = 4;
  else if (/\b6\s*h(our)?s?\b/i.test(sum)) hours = 6;
  else if (/\b8\s*h(our)?s?\b/i.test(sum) || /\bfull[-\s]?day\b/i.test(sum)) hours = 8;

  var multi =
    days > 1 ||
    /\b(overnight|overnights?|multi[-\s]?day|nights?)\b/i.test(sum);

  if (multi) {
    var dayRate = table.day;
    var totalM = round2(dayRate * days);
    return {
      season: season,
      dur: "multi",
      days: days,
      rate: dayRate,
      price: totalM,
      total: totalM,
      label: days + "-day · " + season + " season · €" + dayRate + "/day",
    };
  }
  var dur = "8h";
  if (hours != null && hours <= 4.5) dur = "4h";
  else if (hours != null && hours <= 7) dur = "6h";
  else if (hours != null) dur = "8h";
  else if (ev.allDay) dur = "8h";
  var price = table[dur] != null ? table[dur] : table["8h"];
  return {
    season: season,
    dur: dur,
    days: 1,
    rate: price,
    price: price,
    total: price,
    label: dur + " · " + season + " season · €" + price,
  };
}

/** Best-effort guest name from ICS title (strip tags / stew notes). */
function guestNameFromIcsSummary(summary) {
  var s = String(summary || "").trim();
  if (!s) return "Charter guest";
  s = s.replace(/\[(CB|C&B|CLICK\s*&?\s*BOAT|WEB|WEBSITE|SITE|OWNER)\]/gi, " ");
  s = s.replace(/\b(click\s*&?\s*boat|clickboat)\b/gi, " ");
  /* Take left of common separators used for stew / notes */
  s = s.split(/\s*[-–—|]\s*/)[0];
  s = s.replace(/\s+/g, " ").trim();
  if (!s || /^(off|charter|hold|tentative)$/i.test(s)) return "Charter guest";
  return s.slice(0, 80);
}

function isIcsOffSummary(summary) {
  var s = String(summary || "").trim();
  if (/^\s*off\s*$/i.test(s)) return true;
  if (/^\s*off\s*[-–—:].+/i.test(s)) return true;
  return false;
}

function constrainBillType(v) {
  var s = String(v || "").toLowerCase();
  return BILL_TYPES[s] ? s : "invoice";
}

/* ---------- free cash black (locked: never suggested ex-VAT) ---------- */

function leadSplitVatSwallowed(l) {
  return (
    l &&
    (l.splitVatOnTop === false ||
      l.splitVatOnTop === 0 ||
      l.splitVatOnTop === "0" ||
      l.splitVatOnTop === "false" ||
      l.splitVatOnTop === "swallow")
  );
}

/**
 * Formal white on PDF / card (always net + VAT when invoice has VAT).
 * Guest settles this amount on the invoice; cash is separate.
 */
function leadWhiteClientPay(l) {
  if (!l) return 0;
  var total = num(l.invoiceTotal);
  var net = num(l.invoiceNet);
  if (!(total > 0) && net > 0) {
    total = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
  }
  if (!(total > 0) && net > 0) total = net;
  return round2(total > 0 ? total : net);
}

/** Deal base for split cash: quote without full VAT (e.g. 4000÷1.21 = 3305.79). */
function leadDealBase(l) {
  if (!l) return 0;
  if (num(l.dealNet) > 0) return round2(num(l.dealNet));
  var base = num(l.base) || num(l.price) || 0;
  if (!(base > 0) && l.rate && l.days) base = num(l.rate) * num(l.days);
  if (!(base > 0)) return 0;
  return round2(moneyFromBase(base, l.vatMode || "include", l.vatPct).net);
}

/**
 * Suggested free cash after white invoice is paid in full (PDF total).
 *
 * Deal base B = quote ex full VAT (4000÷1.21).
 * White net W, white VAT V, formal invoice T = W+V.
 *   Swallow V: final = B;           cash = B − T
 *   Charge V:  final = B + V;       cash = B − W
 * (e.g. B=3305.79, W=1000, V=210 → charge cash 2305.79, final 3515.79)
 */
function leadSuggestedCashAmt(l) {
  if (!l) return null;
  var B = leadDealBase(l);
  if (!(B > 0)) return null;
  var total = num(l.invoiceTotal);
  var net = num(l.invoiceNet);
  if (!(total > 0) && net > 0) {
    total = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
  }
  if (!(net > 0) && total > 0) {
    net = moneyFromBase(total, l.whiteVatMode || "include", l.vatPct).net;
  }
  if (leadSplitVatSwallowed(l)) {
    if (!(total > 0)) return null;
    return round2(Math.max(0, B - total));
  }
  if (!(net > 0)) return null;
  return round2(Math.max(0, B - net));
}

/** Final client price for split: B (swallow) or B + white VAT (charge). */
function leadSplitFinalPrice(l) {
  if (!l) return 0;
  if (!leadHasSplit(l)) return round2(num(l.total) || num(l.base) || num(l.price));
  var B = leadDealBase(l);
  if (!(B > 0)) return round2(num(l.total) || 0);
  if (leadSplitVatSwallowed(l)) return B;
  var total = num(l.invoiceTotal);
  var net = num(l.invoiceNet);
  var vat = num(l.invoiceVat);
  if (!(vat > 0) && total > 0 && net > 0) vat = round2(total - net);
  if (!(vat > 0) && net > 0) {
    var built = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct);
    vat = round2(built.vat);
  }
  if (!(vat > 0) && total > 0 && !(net > 0)) {
    var fromIncl = moneyFromBase(total, l.whiteVatMode || "include", l.vatPct);
    vat = round2(fromIncl.vat);
  }
  return round2(B + Math.max(0, vat));
}

function cashAmtLooksSuggested(l) {
  var cash = num(l && l.cashAmt);
  if (!(cash > 0)) return false;
  var sug = leadSuggestedCashAmt(l);
  if (sug != null && sug > 0 && Math.abs(cash - sug) < 1.01) return true;
  /* €1.652,89 = white net (2000÷1.21) — classic corrupt free-cash value */
  var wNet = num(l.invoiceNet);
  if (wNet > 0 && Math.abs(cash - wNet) < 1.01) return true;
  if (num(l.invoiceTotal) > 0) {
    var wn = moneyFromBase(num(l.invoiceTotal), l.whiteVatMode || "include", l.vatPct || 21).net;
    if (wn > 0 && Math.abs(cash - wn) < 1.01) return true;
  }
  return false;
}

/**
 * Free cash black for ops/APA — never returns the auto ex-VAT figure (€1.652,89).
 * pin (optional device pin) wins when stored cash is missing or looks suggested.
 */
function leadFreeCashAmt(l, pin) {
  pin = round2(num(pin));
  var cash = round2(num(l && l.cashAmt));
  if (pin > 0 && !cashAmtLooksSuggested(Object.assign({}, l || {}, { cashAmt: pin }))) {
    if (!(cash > 0) || cashAmtLooksSuggested(l) || Math.abs(cash - pin) > 0.02) return pin;
  }
  if (cashAmtLooksSuggested(l)) return 0;
  return cash > 0 ? cash : 0;
}

/**
 * Where split free cash lands when received:
 *  - boat  = boat petty cash envelope (default / legacy)
 *  - owner = owner’s pocket (still business money — show in owner stats)
 */
function constrainCashDest(v) {
  var s = String(v || "")
    .toLowerCase()
    .trim();
  if (s === "owner" || s === "pocket" || s === "owner-pocket" || s === "owner_pocket")
    return "owner";
  return "boat";
}

function leadCashDest(r) {
  if (!r) return "boat";
  if (r.cashDest != null && r.cashDest !== "") return constrainCashDest(r.cashDest);
  /* Legacy aliases */
  if (r.cashToOwner === true || r.cashToOwner === "true" || r.cashToOwner === 1) return "owner";
  return "boat";
}

/**
 * Free cash received (settled). Same gate for boat envelope and owner pocket:
 * explicit cashSettled, or final Paid (unless cashSettled explicitly false).
 */
function leadFreeCashIsReceived(r) {
  if (!r || !leadHasSplit(r)) return false;
  var cash = leadFreeCashAmt(r);
  if (!(cash > 0.009)) return false;
  if (r.cashSettled === false || r.cashSettled === "false" || r.cashSettled === 0)
    return false;
  if (r.cashSettled === true || r.cashSettled === "true" || r.cashSettled === 1) return true;
  return String(r.fins || "") === "Paid";
}

function leadFreeCashIsOnBoat(r) {
  return leadFreeCashIsReceived(r) && leadCashDest(r) === "boat";
}

/** Received free cash that went to the owner’s pocket (not boat float). */
function leadOwnerPocketCashAmt(r) {
  if (!leadFreeCashIsReceived(r) || leadCashDest(r) !== "owner") return 0;
  return leadFreeCashAmt(r);
}

/**
 * Cancelled commercial lead (display filters). Pure — no DOM.
 * Explicit reinstate (cancelled === false / bookingStatus active) wins over a
 * sticky Refunded deposit left from a prior cancel — same rule as the site calendar.
 */
function leadIsCancelled(r) {
  if (!r) return true;
  if (
    r.bookingStatus === "cancelled" ||
    r.cancelled === true ||
    r.cancelled === "true" ||
    r.cancelled === 1
  )
    return true;
  if (r.status === "Cancelled" || r.status === "cancelled") return true;
  if (r.cancelled === false || r.cancelled === "false" || r.cancelled === 0)
    return false;
  if (r.bookingStatus === "active") return false;
  if (String(r.deps || "") === "Refunded") return true;
  return false;
}

/**
 * Display-only summary of free cash income already on leads (split deals only).
 * - Only cash marked received (cashSettled or final Paid)
 * - boat = petty envelope · owner = owner’s pocket (still income)
 * - Does not include Charges / final-charge cash — leads only
 * - Does not mutate rows
 *
 * @param {Array} leads
 * @returns {{ total, boat, owner, boatN, ownerN, n, items: Array }}
 */
function summarizeLeadCashIncome(leads) {
  var boat = 0;
  var owner = 0;
  var boatN = 0;
  var ownerN = 0;
  var items = [];
  (Array.isArray(leads) ? leads : []).forEach(function (r) {
    if (!r || leadIsCancelled(r)) return;
    if (!leadHasSplit(r)) return;
    var cash = leadFreeCashAmt(r);
    if (!(cash > 0.009)) return;
    if (!leadFreeCashIsReceived(r)) return;
    var dest = leadCashDest(r);
    var row = {
      id: r.id,
      name: String(r.name || "—").trim() || "—",
      start: String(r.start || r.cdate || "").slice(0, 10),
      cash: cash,
      dest: dest,
      source: leadSource(r),
    };
    if (dest === "owner") {
      owner = round2(owner + cash);
      ownerN++;
    } else {
      boat = round2(boat + cash);
      boatN++;
    }
    items.push(row);
  });
  items.sort(function (a, b) {
    var da = String(a.start || ""),
      db = String(b.start || "");
    if (da && db && da !== db) return db < da ? -1 : 1;
    return String(b.name || "").localeCompare(String(a.name || ""));
  });
  return {
    total: round2(boat + owner),
    boat: boat,
    owner: owner,
    boatN: boatN,
    ownerN: ownerN,
    n: boatN + ownerN,
    items: items,
  };
}

/**
 * Closed commercial lead (money totals gate) — pure, no DOM.
 */
function leadIsClosedCommercialIncome(r) {
  if (!r || leadIsCancelled(r)) return false;
  var src = leadSource(r);
  if (src === "pending" || src === "owner") return false;
  if (!leadIsDealClosed(r)) return false;
  return (
    src === "captain" ||
    src === "clickboat" ||
    src === "ownersourced" ||
    src === "other"
  );
}

/**
 * Projected-net parts: before VAT and commissions with free cash black REMOVED.
 * Split: white before VAT only + white commission only.
 * Non-split: full commission base + full commission.
 * Free cash is reported separately (summarizeLeadCashIncome) then added in total net.
 */
function leadProjectedNetParts(r) {
  var p = leadCommissionParts(r);
  if (p.split) {
    var wEx = round2(p.whiteBeforeVat || 0);
    var wComm = round2(p.whiteComm || 0);
    return {
      split: true,
      ex: wEx,
      comm: wComm,
      net: round2(Math.max(0, wEx - wComm)),
      cashBlack: round2(p.cashBlack || 0),
    };
  }
  var ex = round2(p.base || 0);
  var comm = round2(p.total || 0);
  return {
    split: false,
    ex: ex,
    comm: comm,
    net: round2(Math.max(0, ex - comm)),
    cashBlack: 0,
  };
}

/**
 * Projected net income across closed commercial leads — excludes free cash black.
 * @param {Array} leads
 * @param {{ isClosed?: function }} [opts] optional closed-commercial predicate
 */
function summarizeProjectedNetExCash(leads, opts) {
  opts = opts || {};
  var isClosed =
    typeof opts.isClosed === "function"
      ? opts.isClosed
      : leadIsClosedCommercialIncome;
  var ex = 0;
  var comm = 0;
  var n = 0;
  (Array.isArray(leads) ? leads : []).forEach(function (r) {
    if (!r || !isClosed(r)) return;
    var parts = leadProjectedNetParts(r);
    ex = round2(ex + parts.ex);
    comm = round2(comm + parts.comm);
    n++;
  });
  return {
    ex: ex,
    comm: comm,
    net: round2(Math.max(0, ex - comm)),
    n: n,
  };
}

/**
 * Display-only total net income:
 *   projectedNet (ex VAT − commissions, free cash excluded)
 *   + cash income (received free cash: boat + owner pocket)
 * = totalNet
 *
 * Call with projectedNet from summarizeProjectedNetExCash(...).net (or UI allNet
 * once that uses cash-free bases). Cash is never inside projectedNet.
 *
 * @param {number} projectedNet
 * @param {Array} leads
 */
/**
 * Client € on list / totals (0 for owner days + pending).
 */
function leadListMoney(r) {
  if (!r || leadIsCancelled(r)) return 0;
  var src = leadSource(r);
  if (src === "owner" || src === "pending") return 0;
  if (leadHasSplit(r)) return leadClientTotal(r);
  return num(r.total) || num(r.base) || num(r.price) || 0;
}

/**
 * Charter timing relative to today: "upcoming" | "done".
 * @param {object} r lead
 * @param {string} [todayYmd] YYYY-MM-DD
 */
function leadCharterTiming(r, todayYmd) {
  var start = String((r && (r.start || r.cdate)) || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "done";
  var today = String(todayYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return "done";
  return start > today ? "upcoming" : "done";
}

/**
 * Free cash income limited to sailed/today deals (not scheduled).
 * Same shape as summarizeLeadCashIncome.
 *
 * @param {Array} leads
 * @param {string} todayYmd
 */
function summarizeLeadCashIncomeRealised(leads, todayYmd) {
  var all = summarizeLeadCashIncome(leads);
  var boat = 0;
  var owner = 0;
  var boatN = 0;
  var ownerN = 0;
  var items = [];
  (all.items || []).forEach(function (it) {
    if (!it) return;
    var L = null;
    (Array.isArray(leads) ? leads : []).forEach(function (x) {
      if (x && String(x.id) === String(it.id)) L = x;
    });
    if (L && leadCharterTiming(L, todayYmd) === "upcoming") return;
    var c = num(it.cash);
    if (!(c > 0.009)) return;
    items.push(it);
    if (it.dest === "owner") {
      owner = round2(owner + c);
      ownerN++;
    } else {
      boat = round2(boat + c);
      boatN++;
    }
  });
  return {
    total: round2(boat + owner),
    boat: boat,
    owner: owner,
    boatN: boatN,
    ownerN: ownerN,
    n: boatN + ownerN,
    items: items,
  };
}

/**
 * Realised “so far” white net + boat free cash (big net on Leads).
 * Owner pocket cash is reported but not included in doneNet.
 *
 * @param {{
 *   whiteEx?: number,
 *   whiteComm?: number,
 *   cashRealised?: { boat?: number, owner?: number, total?: number, n?: number, boatN?: number, ownerN?: number, items?: Array }
 * }} opts
 */
function summarizeRealisedNetGlimpse(opts) {
  opts = opts || {};
  var ex = round2(Math.max(0, num(opts.whiteEx)));
  var comm = round2(Math.max(0, num(opts.whiteComm)));
  var whiteNet = round2(Math.max(0, ex - comm));
  var cash = opts.cashRealised || {};
  var cashBoat = round2(num(cash.boat));
  var cashOwner = round2(num(cash.owner));
  var doneNet = round2(whiteNet + cashBoat);
  return {
    whiteEx: ex,
    whiteComm: comm,
    whiteNet: whiteNet,
    cashBoat: cashBoat,
    cashOwner: cashOwner,
    cashTotal: round2(num(cash.total) || cashBoat + cashOwner),
    cashN: num(cash.n),
    cashBoatN: num(cash.boatN),
    cashOwnerN: num(cash.ownerN),
    cashItems: cash.items || [],
    doneNet: doneNet,
  };
}

function summarizeTotalNetIncome(projectedNet, leads) {
  var cash = summarizeLeadCashIncome(leads);
  var proj = round2(Number(projectedNet) || 0);
  return {
    projectedNet: proj,
    cashTotal: cash.total,
    cashBoat: cash.boat,
    cashOwner: cash.owner,
    cashAlreadyInProjected: 0,
    cashAdditive: cash.total,
    totalNet: round2(proj + cash.total),
    naiveSum: round2(proj + cash.total),
    cash: cash,
  };
}

/** Mutate lead: replace suggested cash with pin or clear corrupt value. */
function sanitizeLeadCash(l, pin) {
  if (!l || !leadHasSplit(l)) return false;
  var free = leadFreeCashAmt(l, pin);
  var cur = round2(num(l.cashAmt));
  if (Math.abs(cur - free) < 0.02 && !(cashAmtLooksSuggested(l) && free <= 0)) {
    if (free > 0) l.cashAmtUser = true;
    return false;
  }
  if (free > 0) {
    l.cashAmt = free;
    l.cashAmtUser = true;
  } else if (cashAmtLooksSuggested(l)) {
    /* Drop corrupt €1.652,89 so APA/notices do not use it */
    l.cashAmt = 0;
    l.cashAmtUser = false;
  } else {
    return false;
  }
  l.total = leadSplitFinalPrice(l);
  return true;
}

/**
 * Client total for split = formal white (PDF) + free cash when cash is set;
 * else theoretical final (B or B+V). Prefer stored cash + invoice total when present.
 */
function leadClientTotal(l) {
  if (!l) return 0;
  if (!leadHasSplit(l)) return round2(num(l.total) || num(l.base) || num(l.price));
  var cash = round2(num(l.cashAmt));
  if (cash > 0 && !l.cashAmtUser) {
    var wNet = num(l.invoiceNet);
    if (wNet > 0 && Math.abs(cash - wNet) < 1.01) cash = 0;
    else if (num(l.invoiceTotal) > 0) {
      var wn = moneyFromBase(num(l.invoiceTotal), l.whiteVatMode || "include", l.vatPct || 21).net;
      if (wn > 0 && Math.abs(cash - wn) < 1.01) cash = 0;
    }
  }
  var whitePay = leadWhiteClientPay(l);
  if (cash > 0 && whitePay > 0) return round2(whitePay + cash);
  return leadSplitFinalPrice(l);
}

/* ---------- commission (locked) ---------- */

function commissionVatPct(r) {
  var raw = r && r.vatPct;
  if (raw === "" || raw == null) return 21;
  var n = Number(raw);
  if (!isFinite(n) || n <= 0) return 21;
  return n;
}

function leadCommissionGrossAmount(r) {
  if (!r) return 0;
  var g = num(r.total);
  if (!(g > 0)) g = num(r.base);
  if (!(g > 0)) g = num(r.price);
  if (!(g > 0) && r.rate && r.days) g = num(r.rate) * num(r.days);
  return round2(g);
}

function leadCommissionWhiteBeforeVat(r) {
  if (!r) return 0;
  var pct = commissionVatPct(r);
  var whiteGross = num(r.invoiceTotal);
  var whiteNet = num(r.invoiceNet);
  var wMode = String(r.whiteVatMode || "include").toLowerCase();
  if (!(whiteGross > 0) && !(whiteNet > 0)) return 0;
  if (wMode === "none") return round2(whiteGross > 0 ? whiteGross : whiteNet);
  if (wMode === "add") {
    if (whiteNet > 0 && whiteNet < whiteGross * 0.99) return round2(whiteNet);
    if (whiteGross > 0) return round2(whiteGross);
    return round2(whiteNet);
  }
  if (whiteGross > 0) {
    if (whiteNet > 0 && whiteNet < whiteGross * 0.95) return round2(whiteNet);
    return round2(whiteGross / (1 + pct / 100));
  }
  return round2(whiteNet);
}

/**
 * Lead commission breakdown (numbers only — UI formats strings).
 * Rate from source: captain 15%, clickboat 21%, ownersourced 0% (for now), owner/other 0%.
 * Split: rate × white before VAT + rate × cash black.
 * Normal VAT-include: rate × (total÷1.21).
 * Owner’s days: total commission 0; base still = charter before VAT (owner benefit value).
 * Owner-sourced: income line; commission 0 until OWNER_SOURCED_COMMISSION_PCT is raised.
 */
function leadCommissionParts(r) {
  var ratePct = leadCommissionRatePct(r);
  var pctRate = ratePct / 100;
  var src = leadSource(r);
  var empty = {
    split: false,
    whiteBeforeVat: 0,
    cashBlack: 0,
    base: 0,
    whiteComm: 0,
    cashComm: 0,
    total: 0,
    gross: 0,
    ratePct: ratePct,
    source: src,
  };
  if (!r) return empty;
  var pct = commissionVatPct(r);
  var mode = String(r.vatMode || "include").toLowerCase();
  var isSplit = !!(
    r.split === true ||
    r.splitCash === true ||
    r.split === "true" ||
    r.splitCash === "true" ||
    leadHasSplit(r)
  );

  if (
    isSplit &&
    (num(r.invoiceTotal) > 0 || num(r.invoiceNet) > 0 || num(r.cashAmt) > 0 || r.split || r.splitCash)
  ) {
    var whiteB = leadCommissionWhiteBeforeVat(r);
    var cashB = round2(num(r.cashAmt));
    var whiteC = round2(whiteB * pctRate);
    var cashC = round2(cashB * pctRate);
    var base = round2(whiteB + cashB);
    var total = round2(whiteC + cashC);
    var whiteG = num(r.invoiceTotal);
    if (!(whiteG > 0) && num(r.invoiceNet) > 0) whiteG = num(r.invoiceNet);
    var gross = round2(whiteG + cashB);
    return {
      split: true,
      whiteBeforeVat: whiteB,
      cashBlack: cashB,
      base: base,
      whiteComm: whiteC,
      cashComm: cashC,
      total: total,
      gross: gross,
      ratePct: ratePct,
      source: src,
    };
  }

  var grossN = leadCommissionGrossAmount(r);
  if (!(grossN > 0)) return empty;
  var baseN;
  if (mode === "none") {
    baseN = grossN;
  } else if (mode === "add") {
    var ex = num(r.base) || num(r.price);
    if (!(ex > 0) && r.rate && r.days) ex = num(r.rate) * num(r.days);
    if (!(ex > 0) && num(r.net) > 0 && num(r.net) < grossN * 0.99) ex = num(r.net);
    if (ex > 0 && Math.abs(ex - grossN) < 0.05) baseN = round2(grossN / (1 + pct / 100));
    else if (ex > 0) baseN = round2(ex);
    else baseN = round2(grossN / (1 + pct / 100));
  } else {
    baseN = round2(grossN / (1 + pct / 100));
  }
  var totalN = round2(baseN * pctRate);
  return {
    split: false,
    whiteBeforeVat: baseN,
    cashBlack: 0,
    base: baseN,
    whiteComm: totalN,
    cashComm: 0,
    total: totalN,
    gross: grossN,
    ratePct: ratePct,
    source: src,
  };
}

/** Charter value before VAT for owner-use benefits (same base as commission math). */
function leadOwnerBenefitValue(r) {
  if (!isOwnerLead(r)) return 0;
  return leadCommissionParts(r).base;
}

function leadCommissionBase(r) {
  return leadCommissionParts(r).base;
}
function leadCommissionAmt(r) {
  return leadCommissionParts(r).total;
}


  return {
    CAPTAIN_COMMISSION_PCT: CAPTAIN_COMMISSION_PCT,
    CLICKBOAT_COMMISSION_PCT: CLICKBOAT_COMMISSION_PCT,
    BILL_TYPES: BILL_TYPES,
    LEAD_SOURCES: LEAD_SOURCES,
    OWNER_SOURCED_COMMISSION_PCT: OWNER_SOURCED_COMMISSION_PCT,
    CHARTER_RATES: CHARTER_RATES,
    leadHasSplit: leadHasSplit,
    leadSource: leadSource,
    isCaptainLead: isCaptainLead,
    leadEarnsCaptainCommission: leadEarnsCaptainCommission,
    leadCommissionRatePct: leadCommissionRatePct,
    leadEarnsCommission: leadEarnsCommission,
    isClickboatLead: isClickboatLead,
    isOwnerLead: isOwnerLead,
    isOwnerSourcedLead: isOwnerSourcedLead,
    leadIsDealClosed: leadIsDealClosed,
    ownerBenefitIncluded: ownerBenefitIncluded,
    constrainLeadSource: constrainLeadSource,
    leadSourceLabel: leadSourceLabel,
    charterSeason: charterSeason,
    hoursBetweenTimes: hoursBetweenTimes,
    charterCalendarDays: charterCalendarDays,
    charterPriceFromEvent: charterPriceFromEvent,
    guestNameFromIcsSummary: guestNameFromIcsSummary,
    isIcsOffSummary: isIcsOffSummary,
    constrainBillType: constrainBillType,
    leadSplitVatSwallowed: leadSplitVatSwallowed,
    leadWhiteClientPay: leadWhiteClientPay,
    leadDealBase: leadDealBase,
    leadSuggestedCashAmt: leadSuggestedCashAmt,
    leadSplitFinalPrice: leadSplitFinalPrice,
    cashAmtLooksSuggested: cashAmtLooksSuggested,
    leadFreeCashAmt: leadFreeCashAmt,
    constrainCashDest: constrainCashDest,
    leadCashDest: leadCashDest,
    leadFreeCashIsReceived: leadFreeCashIsReceived,
    leadFreeCashIsOnBoat: leadFreeCashIsOnBoat,
    leadOwnerPocketCashAmt: leadOwnerPocketCashAmt,
    leadIsCancelled: leadIsCancelled,
    summarizeLeadCashIncome: summarizeLeadCashIncome,
    summarizeLeadCashIncomeRealised: summarizeLeadCashIncomeRealised,
    leadListMoney: leadListMoney,
    leadCharterTiming: leadCharterTiming,
    summarizeRealisedNetGlimpse: summarizeRealisedNetGlimpse,
    leadIsClosedCommercialIncome: leadIsClosedCommercialIncome,
    leadProjectedNetParts: leadProjectedNetParts,
    summarizeProjectedNetExCash: summarizeProjectedNetExCash,
    summarizeTotalNetIncome: summarizeTotalNetIncome,
    sanitizeLeadCash: sanitizeLeadCash,
    leadClientTotal: leadClientTotal,
    commissionVatPct: commissionVatPct,
    leadCommissionGrossAmount: leadCommissionGrossAmount,
    leadCommissionWhiteBeforeVat: leadCommissionWhiteBeforeVat,
    leadCommissionParts: leadCommissionParts,
    leadOwnerBenefitValue: leadOwnerBenefitValue,
    leadCommissionBase: leadCommissionBase,
    leadCommissionAmt: leadCommissionAmt
  };
});
