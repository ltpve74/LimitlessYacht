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

/**
 * Captain commission (website / direct).
 * Agreed book default = 10%. Target / preview = 15% (negotiation ask).
 * Per-lead `captainCommPct` stamps a trip so early book can stay at 10
 * while later trips move to 15 without a global flip.
 */
var CAPTAIN_COMMISSION_PCT = 10;
var CAPTAIN_COMMISSION_TARGET_PCT = 15;
/** Click&Boat (Paul): 24% of charter fee before VAT (platform rate). */
var CLICKBOAT_COMMISSION_PCT = 24;
var BILL_TYPES = { cash: 1, invoice: 1, mix: 1 };
/**
 * Charter book source (commission assignment):
 *  - captain = website or direct contact (default CAPTAIN_COMMISSION_PCT; per-lead stamp optional)
 *  - clickboat = Paul / Click&Boat (24% before VAT)
 *  - ownersourced = owner-sourced commercial charter (boat is commercial; former “owner days”
 *    alias here). Income when invoiced; list−20% notional; provider commission 10% (preview 15%)
 *    is the owner’s hypothetical take if they played fair — NOT captain petty pay.
 *  - owner = deprecated alias → ownersourced (kept in LEAD_SOURCES for raw reads only)
 *  - dayoff = vessel closed / day off (blocks calendar; no income, no cost)
 *  - other = legacy / unknown (no commission)
 */
var LEAD_SOURCES = { pending: 1, captain: 1, clickboat: 1, owner: 1, ownersourced: 1, dayoff: 1, other: 1 };
/**
 * Owner-sourced provider commission (fairness / what-if for the owner as a business provider).
 * Book default 10%; target / preview 15% — same toggle pattern as captain, but this is NOT
 * captain pay-from-petty.
 */
var OWNER_SOURCED_COMMISSION_PCT = 10;
var OWNER_SOURCED_COMMISSION_TARGET_PCT = 15;
/** Owner-sourced notional commercial price = public list × (1 − discount). */
var OWNER_SOURCED_LIST_DISCOUNT = 0.2;
/**
 * Public charter fee table (VAT included “from” rates on the site).
 * High season = Jul–Aug (month index 6–7). Multi-day uses full-day rate × nights/days.
 */
var CHARTER_RATES = {
  low: { "4h": 1700, "6h": 2400, "8h": 3000, day: 3000 },
  high: { "4h": 2200, "6h": 3100, "8h": 4000, day: 4000 },
};

function leadHasSplit(r) {
  /* White PDF + free cash black — not full cash-only deals */
  if (leadIsCashOnlyDeal(r)) return false;
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

/**
 * Entire charter fee is cash (no formal white invoice).
 * Uses the same cashDest / cashSettled plumbing as split free cash.
 */
function leadIsCashOnlyDeal(r) {
  if (!r) return false;
  if (r.dealPayType === "cash" || r.cashOnly === true || r.cashOnly === "true" || r.cashOnly === 1)
    return true;
  return false;
}

/** Split free cash OR full-cash charter fee (any cash component on the lead). */
function leadHasCashFee(r) {
  return !!(r && (leadIsCashOnlyDeal(r) || leadHasSplit(r)));
}

/**
 * How the lead is settled commercially:
 *  - invoice = formal invoice only
 *  - split   = white PDF + free cash black
 *  - cash    = entire fee cash (boat petty or owner pocket)
 */
function leadDealPayType(r) {
  if (leadIsCashOnlyDeal(r)) return "cash";
  if (leadHasSplit(r)) return "split";
  return "invoice";
}

function constrainDealPayType(v) {
  var s = String(v || "")
    .toLowerCase()
    .trim();
  if (s === "cash" || s === "cash-only" || s === "cash_only" || s === "allcash" || s === "all-cash")
    return "cash";
  if (s === "split" || s === "split-cash" || s === "white+black") return "split";
  return "invoice";
}

/**
 * Vessel closed / day off — no charter fee, no commission, blocks public calendar.
 * Flag dayOff / leadKind, or leadSource "dayoff".
 */
function leadIsDayOff(r) {
  if (!r) return false;
  if (r.dayOff === true || r.dayOff === "true" || r.dayOff === 1) return true;
  if (String(r.leadKind || r.kind || "").toLowerCase() === "dayoff") return true;
  var src = String(r.leadSource || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  if (src === "dayoff" || src === "day-off" || src === "off" || src === "closed") return true;
  return false;
}

function leadSource(r) {
  if (!r) return "other";
  if (leadIsDayOff(r)) return "dayoff";
  if (r.captainLead === true) return "captain";
  /* Empty / missing source = captain (legacy book before ICS import) */
  if (r.leadSource == null || r.leadSource === "") return "captain";
  return constrainLeadSource(r.leadSource);
}

function isCaptainLead(r) {
  return leadSource(r) === "captain";
}

/** Captain’s own deals (website / direct) — rate from stamp or book default. */
function leadEarnsCaptainCommission(r) {
  return isCaptainLead(r);
}

/**
 * Parse a captain commission % (10 or 15 bookends, or any 0–100 for tests).
 * Returns null when unset / invalid.
 */
function parseCaptainCommPct(v) {
  if (v == null || v === "") return null;
  var n = num(v);
  if (!(n > 0) || n > 100) return null;
  return round2(n);
}

/**
 * Book rate for a captain lead: stamped `captainCommPct` wins, else default 10%.
 * `forcePct` (preview) overrides stamp + default when provided.
 */
function leadCaptainBookRatePct(r, forcePct) {
  var forced = parseCaptainCommPct(forcePct);
  if (forced != null) return forced;
  var stamped = r ? parseCaptainCommPct(r.captainCommPct) : null;
  if (stamped != null) return stamped;
  return CAPTAIN_COMMISSION_PCT;
}

/**
 * Owner-sourced provider rate: book 10%, or forcePct (15% preview).
 * Not captain petty — fairness display for the owner as a provider.
 */
function leadOwnerSourcedBookRatePct(forcePct) {
  var forced = parseCaptainCommPct(forcePct);
  if (forced != null) return forced;
  return OWNER_SOURCED_COMMISSION_PCT;
}

/**
 * Commission rate % for this lead’s source (0 = none).
 * Owner-sourced returns the provider rate (10%/force) for breakdown math —
 * UI must NOT add it to captain pay-from-petty (use leadEarnsCaptainCommission).
 * @param {object} r lead
 * @param {number|object} [forceOrOpts] force % (captain or OS preview) or
 *   { forceCaptainPct, forceOwnerSourcedPct }
 */
function leadCommissionRatePct(r, forceOrOpts) {
  var forceCapt = null;
  var forceOs = null;
  if (forceOrOpts != null && typeof forceOrOpts === "object") {
    forceCapt = forceOrOpts.forceCaptainPct;
    forceOs = forceOrOpts.forceOwnerSourcedPct;
    /* Single forcePct applies to the active source when set */
    if (forceOrOpts.forcePct != null) {
      forceCapt = forceOrOpts.forcePct;
      forceOs = forceOrOpts.forcePct;
    }
  } else if (forceOrOpts != null) {
    forceCapt = forceOrOpts;
    forceOs = forceOrOpts;
  }
  var src = leadSource(r);
  if (src === "pending" || src === "dayoff") return 0;
  if (src === "captain") return leadCaptainBookRatePct(r, forceCapt);
  if (src === "clickboat") return CLICKBOAT_COMMISSION_PCT;
  /*
   * Owner-sourced provider fairness lives in ownerSourcedCommissionParts only.
   * Returning 0 here keeps Finance white-net commissions = captain/CB only
   * (do not subtract hypothetical owner-provider % from business net).
   */
  if (src === "ownersourced") return 0;
  return 0;
}

/** Captain or Click&Boat — payable commission lines (excludes owner-sourced provider). */
function leadEarnsCommission(r) {
  var src = leadSource(r);
  if (src === "captain" || src === "clickboat") return leadCommissionRatePct(r) > 0;
  return false;
}

function isClickboatLead(r) {
  return leadSource(r) === "clickboat";
}

/**
 * Legacy owner’s days — always false once constrain aliases owner → ownersourced.
 * Kept for APA/diesel call sites during migration; prefer isOwnerSourcedLead.
 */
function isOwnerLead(r) {
  return leadSource(r) === "owner";
}

/** Owner-sourced commercial charter — income when invoiced; provider commission what-if. */
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

/** Charter start month YYYY-MM — never use booking/closed date. */
function leadCharterStartMonth(r) {
  var st = String((r && (r.start || r.cdate)) || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(st) ? st : "";
}

/** Charter start day YYYY-MM-DD — never booking/closed date. */
function leadCharterStartDay(r) {
  var d = String((r && (r.start || r.cdate)) || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

/**
 * Cap for “has this charter already happened?” on a month report.
 * min(today, last day of report month) — never includes later months,
 * and never includes later days still inside the report month.
 *
 * @param {string} month YYYY-MM
 * @param {string} [todayYmd] optional fixed “today” (tests)
 * @returns {string} YYYY-MM-DD
 */
function commissionBizAsOfDay(month, todayYmd) {
  month = String(month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  var y = parseInt(month.slice(0, 4), 10);
  var m = parseInt(month.slice(5, 7), 10);
  var last = new Date(y, m, 0).getDate();
  var monthEnd = month + "-" + (last < 10 ? "0" : "") + last;
  var today = String(todayYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    try {
      var d = new Date();
      var ty = d.getFullYear();
      var tm = d.getMonth() + 1;
      var td = d.getDate();
      today =
        ty +
        "-" +
        (tm < 10 ? "0" : "") +
        tm +
        "-" +
        (td < 10 ? "0" : "") +
        td;
    } catch (eT) {
      today = monthEnd;
    }
  }
  return today < monthEnd ? today : monthEnd;
}

/**
 * Whether a lead’s commission belongs in a month cash report (pure).
 *
 * scope "month"   = charter activity in that month (start/end/span)
 * scope "through" = charter start on or before end of that month
 *
 * Future charters are NEVER included:
 *  - start month > report month, or
 *  - start day > asOfYmd (optional day cap — unstarted charters this month stay out)
 *
 * Booking/closed date is not used.
 *
 * @param {object} r lead
 * @param {string} month YYYY-MM
 * @param {"month"|"through"} scope
 * @param {string} [asOfYmd] YYYY-MM-DD — only charters started on/before this day
 */
function leadInCommissionBizScope(r, month, scope, asOfYmd) {
  month = String(month || "").slice(0, 7);
  if (!r || !/^\d{4}-\d{2}$/.test(month)) return false;
  var st = leadCharterStartMonth(r);
  if (!st) return false;
  /* Future charter month — out of this report */
  if (st > month) return false;
  var startDay = leadCharterStartDay(r);
  var asOf = String(asOfYmd || "").slice(0, 10);
  /* Unstarted charter (even if confirmed) — out until the day has begun */
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf) && startDay && startDay > asOf) return false;
  if (scope === "through") return st <= month;
  /* month: start in month, end in month, or multi spanning month */
  var en = String(r.end || "").slice(0, 7);
  if (st === month) return true;
  if (en === month) return true;
  if (en && /^\d{4}-\d{2}$/.test(en) && st < month && en >= month) return true;
  return false;
}

/**
 * Captain-earning business for cash PDF (leads only — charges composed in controller).
 * @param {Array} leads
 * @param {string} month YYYY-MM
 * @param {"month"|"through"} scope
 * @param {string} [asOfYmd] YYYY-MM-DD day cap
 * @returns {{ n, gross, base, comm, items: Array, asOfYmd: string }}
 */
function summarizeCaptainLeadBizAsOf(leads, month, scope, asOfYmd) {
  scope = scope === "through" ? "through" : "month";
  month = String(month || "").slice(0, 7);
  var asOf = String(asOfYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) asOf = commissionBizAsOfDay(month);
  var gross = 0;
  var base = 0;
  var comm = 0;
  var n = 0;
  var items = [];
  (Array.isArray(leads) ? leads : []).forEach(function (r) {
    if (!r || leadIsCancelled(r) || leadIsDayOff(r)) return;
    if (!leadEarnsCaptainCommission(r)) return;
    if (!leadIsDealClosed(r)) return;
    if (!leadInCommissionBizScope(r, month, scope, asOf)) return;
    var p = leadCommissionParts(r);
    if (!p || !(num(p.total) > 0.009 || num(p.gross) > 0.009 || num(p.base) > 0.009)) return;
    n++;
    gross = round2(gross + num(p.gross));
    base = round2(base + num(p.base));
    comm = round2(comm + num(p.total));
    items.push({
      kind: "lead",
      id: String(r.id || ""),
      name: String(r.name || "Guest").trim() || "Guest",
      start: String(r.start || r.cdate || "").slice(0, 10),
      end: String(r.end || "").slice(0, 10),
      gross: round2(num(p.gross)),
      base: round2(num(p.base)),
      comm: round2(num(p.total)),
    });
  });
  return { n: n, gross: gross, base: base, comm: comm, items: items, asOfYmd: asOf };
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
  if (
    s === "dayoff" ||
    s === "day-off" ||
    s === "day_off" ||
    s === "off" ||
    s === "off-day" ||
    s === "off_day" ||
    s === "closed" ||
    s === "vessel-off" ||
    s === "vessel_off"
  )
    return "dayoff";
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
  /* Boat is commercial — former owner’s days / private aliases → owner-sourced */
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
    return "ownersourced";
  if (s === "other" || s === "agency" || s === "manager") return "other";
  return LEAD_SOURCES[s] ? s : "other";
}

function leadSourceLabel(src) {
  var s = constrainLeadSource(src);
  if (s === "pending") return "Pending source";
  if (s === "captain") return "Captain";
  if (s === "clickboat") return "Click&Boat (Paul)";
  if (s === "owner") return "Owner-sourced"; /* legacy label if raw slips through */
  if (s === "ownersourced") return "Owner-sourced";
  if (s === "dayoff") return "Day off (closed)";
  return "Other";
}

/** Label for ICS “Off” / “Off — reason” titles. */
function dayOffLabelFromSummary(summary) {
  var s = String(summary || "").trim();
  if (!s || /^\s*off\s*$/i.test(s)) return "Day off";
  var m = s.match(/^\s*off\s*[-–—:]\s*(.+)$/i);
  if (m && m[1]) return ("Day off — " + String(m[1]).trim()).slice(0, 80);
  if (isIcsOffSummary(s)) return ("Day off — " + s.replace(/^\s*off\s*/i, "").trim()).slice(0, 80);
  return "Day off";
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
  /* Real clock span wins when present — stale "6h" in the title must not
   * keep pricing/duration at 6 after the manager moved the event to 12–20. */
  var hours = hoursBetweenTimes(ev.startTime, ev.endTime);
  if (hours == null) {
    if (/\b4\s*h(our)?s?\b/i.test(sum) || /\bhalf[-\s]?day\b/i.test(sum)) hours = 4;
    else if (/\b6\s*h(our)?s?\b/i.test(sum)) hours = 6;
    else if (/\b8\s*h(our)?s?\b/i.test(sum) || /\bfull[-\s]?day\b/i.test(sum)) hours = 8;
  }

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
  if (/^\s*day\s*off\b/i.test(s)) return true;
  if (/^\s*closed\b/i.test(s) && !/\bcharter\b/i.test(s)) return true;
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
  /* Cash-only fee is the whole charter price — never the split “suggested free cash” trap */
  if (leadIsCashOnlyDeal(l)) return false;
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
 * Cash-only: whole fee is cash (cashAmt, else total/base/price) — never zeroed as “suggested”.
 */
function leadFreeCashAmt(l, pin) {
  pin = round2(num(pin));
  /* Full cash charter: amount is the fee, not free-cash-vs-white suggestion math */
  if (leadIsCashOnlyDeal(l)) {
    var cashOnly = round2(num(l && l.cashAmt));
    if (pin > 0 && (!(cashOnly > 0) || Math.abs(cashOnly - pin) > 0.02)) return pin;
    if (cashOnly > 0) return cashOnly;
    var totOnly = round2(num(l.total) || num(l.base) || num(l.price) || 0);
    return totOnly > 0 ? totOnly : 0;
  }
  var cash = round2(num(l && l.cashAmt));
  if (pin > 0 && !cashAmtLooksSuggested(Object.assign({}, l || {}, { cashAmt: pin }))) {
    if (!(cash > 0) || cashAmtLooksSuggested(l) || Math.abs(cash - pin) > 0.02) return pin;
  }
  if (cashAmtLooksSuggested(l)) return 0;
  if (cash > 0) return cash;
  return 0;
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
 * Free cash / cash-only fee received (settled).
 *
 * Cash-only: no separate white final — tick “Cash received” OR Final = Paid.
 * Explicit cashSettled:false must NOT block Final=Paid (form always writes the
 * boolean; otherwise Paid final never posts € to boat petty).
 *
 * Split free cash: explicit cashSettled:false still wins (white can be Paid
 * while free cash is not yet in hand). Else cashSettled true or Final Paid.
 */
function leadFreeCashIsReceived(r) {
  if (!r || !leadHasCashFee(r)) return false;
  var cash = leadFreeCashAmt(r);
  if (!(cash > 0.009)) return false;
  var settledTrue =
    r.cashSettled === true || r.cashSettled === "true" || r.cashSettled === 1;
  var settledFalse =
    r.cashSettled === false || r.cashSettled === "false" || r.cashSettled === 0;
  var finalPaid = String(r.fins || "") === "Paid";
  if (leadIsCashOnlyDeal(r)) {
    return settledTrue || finalPaid;
  }
  if (settledFalse) return false;
  if (settledTrue) return true;
  return finalPaid;
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
 * Display-only summary of free cash income already on leads
 * (split free cash + full cash-only charters).
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
    if (!leadHasCashFee(r)) return;
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
  if (leadIsDayOff(r)) return false;
  var src = leadSource(r);
  if (src === "pending" || src === "owner" || src === "dayoff") return false;
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
 * Client € on list / totals (0 for pending).
 * Owner-sourced: Paid invoice money only — never notional / unpaid list price
 * (Finance business-to-date must not invent OS income).
 */
function leadListMoney(r) {
  if (!r || leadIsCancelled(r)) return 0;
  var src = leadSource(r);
  if (src === "owner" || src === "pending") return 0;
  if (src === "ownersourced") return ownerSourcedPaidIncome(r);
  if (leadHasCashFee(r)) return leadClientTotal(r);
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
 * Free cash / cash-only still to collect (not yet received).
 *
 *  - pending   = charter already sailed / today (e.g. Toni still holding cash)
 *  - projected = confirmed upcoming (e.g. Friday split €5k)
 *
 * Confirmed commercial only (deal closed). Skips cancelled, day off, owner days,
 * pending-source holds. Destination boat vs owner pocket is labelled on each row.
 *
 * @param {Array} leads
 * @param {string} [todayYmd] YYYY-MM-DD
 * @returns {{
 *   pending: { total, boat, owner, boatN, ownerN, n, items },
 *   projected: { total, boat, owner, boatN, ownerN, n, items },
 *   todayYmd: string
 * }}
 */
function summarizeLeadCashOutstanding(leads, todayYmd) {
  var today = String(todayYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    try {
      var now = new Date();
      today =
        now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0");
    } catch (eT) {
      today = "";
    }
  }
  function emptyBucket() {
    return { total: 0, boat: 0, owner: 0, boatN: 0, ownerN: 0, n: 0, items: [] };
  }
  var pending = emptyBucket();
  var projected = emptyBucket();

  (Array.isArray(leads) ? leads : []).forEach(function (r) {
    if (!r || leadIsCancelled(r)) return;
    if (leadIsDayOff(r)) return;
    var src = leadSource(r);
    if (src === "pending" || src === "owner" || src === "dayoff") return;
    if (!leadIsDealClosed(r)) return;
    if (!leadHasCashFee(r)) return;
    var cash = leadFreeCashAmt(r);
    if (!(cash > 0.009)) return;
    if (leadFreeCashIsReceived(r)) return;

    var dest = leadCashDest(r);
    var timing = leadCharterTiming(r, today);
    var kind = leadIsCashOnlyDeal(r) ? "cash" : "split";
    var row = {
      id: r.id != null ? String(r.id) : "",
      name: String(r.name || "—").trim() || "—",
      start: String(r.start || r.cdate || "").slice(0, 10),
      end: String(r.end || r.start || r.cdate || "").slice(0, 10),
      cash: cash,
      dest: dest,
      source: src,
      kind: kind,
      timing: timing,
      label:
        (kind === "cash" ? "Cash deal" : "Split free cash") +
        (dest === "owner" ? " → owner pocket" : " → boat"),
    };
    var bucket = timing === "upcoming" ? projected : pending;
    bucket.items.push(row);
    if (dest === "owner") {
      bucket.owner = round2(bucket.owner + cash);
      bucket.ownerN++;
    } else {
      bucket.boat = round2(bucket.boat + cash);
      bucket.boatN++;
    }
    bucket.n++;
    bucket.total = round2(bucket.boat + bucket.owner);
  });

  function byStart(a, b) {
    var da = String(a.start || ""),
      db = String(b.start || "");
    if (da && db && da !== db) return da < db ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }
  pending.items.sort(byStart);
  projected.items.sort(byStart);

  return { pending: pending, projected: projected, todayYmd: today };
}

/**
 * Realised “so far” net for Finance:
 *   white net (before VAT − commissions)
 *   + boat free cash received
 *   − petty cash expenses (cash left the boat) to date
 * Owner pocket cash is reported but never in doneNet.
 *
 * @param {{
 *   whiteEx?: number,
 *   whiteComm?: number,
 *   cashRealised?: { boat?: number, owner?: number, total?: number, n?: number, boatN?: number, ownerN?: number, items?: Array },
 *   cashExpenses?: number
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
  var cashExpenses = round2(Math.max(0, num(opts.cashExpenses)));
  var cashNet = round2(cashBoat - cashExpenses);
  var doneNet = round2(whiteNet + cashNet);
  return {
    whiteEx: ex,
    whiteComm: comm,
    whiteNet: whiteNet,
    cashBoat: cashBoat,
    cashOwner: cashOwner,
    cashExpenses: cashExpenses,
    cashNet: cashNet,
    cashTotal: round2(num(cash.total) || cashBoat + cashOwner),
    cashN: num(cash.n),
    cashBoatN: num(cash.boatN),
    cashOwnerN: num(cash.ownerN),
    cashItems: cash.items || [],
    doneNet: doneNet,
  };
}

/** Charter length bucket for stats: multi | 4h | 6h | 8h */
function leadCharterTypeKey(r) {
  if (!r) return "day";
  var d = String(r.dur || "").toLowerCase().trim();
  var days = Math.max(1, Math.round(Number(r.days) || 0) || 1);
  var multi =
    d === "multi" ||
    (r.end && r.start && String(r.end).slice(0, 10) > String(r.start).slice(0, 10)) ||
    days > 1;
  if (multi) return "multi";
  if (d === "4h") return "4h";
  if (d === "6h") return "6h";
  if (d === "8h") return "8h";
  if (d === "day") return "8h";
  return d || "8h";
}

function emptyMoneyBucket() {
  return { tot: 0, charters: 0, upsell: 0, ex: 0, comm: 0, upsellComm: 0, n: 0, nUpsell: 0 };
}

function emptySourceCard() {
  return {
    tot: 0,
    exVat: 0,
    n: 0,
    comm: 0,
    types: {},
    /* Confirmed future (start > today) — projection only, not in tot/n/comm */
    proj: { tot: 0, exVat: 0, n: 0, comm: 0, types: {} },
  };
}

/** Bump a source card’s to-date fields or its proj sub-bucket. */
function bumpSourceCard(card, val, exVatFull, commFull, typeKey, isProj) {
  if (!card) return;
  var t = isProj ? card.proj : card;
  if (!t) return;
  if (!t.types) t.types = {};
  t.tot = round2(t.tot + (Number(val) || 0));
  t.exVat = round2(t.exVat + (Number(exVatFull) || 0));
  t.n++;
  t.comm = round2(t.comm + (Number(commFull) || 0));
  if (typeKey) {
    if (!t.types[typeKey]) t.types[typeKey] = { n: 0, val: 0, exVat: 0 };
    t.types[typeKey].n++;
    t.types[typeKey].val = round2(t.types[typeKey].val + (Number(val) || 0));
    t.types[typeKey].exVat = round2(
      t.types[typeKey].exVat + (Number(exVatFull) || 0)
    );
  }
}

/**
 * Attach booked = to-date + projected future (white net = before VAT − commissions).
 * Mutates card; pure relative to inputs already on the card.
 */
function finalizeSourceBooked(card) {
  if (!card) return card;
  if (!card.proj) card.proj = { tot: 0, exVat: 0, n: 0, comm: 0, types: {} };
  var p = card.proj;
  card.booked = {
    tot: round2((card.tot || 0) + (p.tot || 0)),
    exVat: round2((card.exVat || 0) + (p.exVat || 0)),
    n: (card.n || 0) + (p.n || 0),
    comm: round2((card.comm || 0) + (p.comm || 0)),
    whiteNet: round2(
      Math.max(0, (card.exVat || 0) - (card.comm || 0)) +
        Math.max(0, (p.exVat || 0) - (p.comm || 0))
    ),
  };
  return card;
}

/**
 * Leads dashboard money rollup (done vs projected + source cards + owner benefits).
 * Pure — no DOM. Upsell charges use charge helpers injected via opts when available.
 *
 * @param {{
 *   leads: Array,
 *   charters?: Array,
 *   today: string,
 *   chargeUpsellGross?: function,
 *   chargeCommissionParts?: function,
 *   isChargeCaptainComm?: function,
 *   chargeExtHours?: function,
 *   chargeExtAmt?: function
 * }} opts
 */
function summarizeLeadsMoneyDashboard(opts) {
  opts = opts || {};
  var today = String(opts.today || "").slice(0, 10);
  var leads = Array.isArray(opts.leads) ? opts.leads : [];
  var charters = Array.isArray(opts.charters) ? opts.charters : [];
  var done = emptyMoneyBucket();
  var proj = emptyMoneyBucket();
  var ownVal = 0;
  var ownN = 0;
  var nPendSrc = 0;
  var nOpenDeal = 0;
  var cap = emptySourceCard();
  var cb = emptySourceCard();
  var os = emptySourceCard();
  var osWhite = 0;
  var osPocket = 0;
  var osBoat = 0;
  var osCashPend = 0;
  var capUpsell = { n: 0, gross: 0, base: 0, comm: 0 };

  function bumpType(map, k, val, exVat) {
    if (!map[k]) map[k] = { n: 0, val: 0, exVat: 0 };
    map[k].n++;
    map[k].val = round2(map[k].val + (Number(val) || 0));
    map[k].exVat = round2(map[k].exVat + (Number(exVat) || 0));
  }
  function addCharter(b, val, exVat, comm) {
    b.charters = round2(b.charters + val);
    b.tot = round2(b.tot + val);
    b.ex = round2(b.ex + exVat);
    b.comm = round2(b.comm + comm);
    b.n++;
  }
  function addUpsell(b, gross, exVat, comm) {
    if (!(gross > 0) && !(comm > 0)) return;
    b.upsell = round2(b.upsell + gross);
    b.tot = round2(b.tot + gross);
    b.ex = round2(b.ex + exVat);
    b.comm = round2(b.comm + comm);
    b.upsellComm = round2(b.upsellComm + comm);
    b.nUpsell++;
  }
  function isClosedCommercial(r) {
    if (!r || leadIsCancelled(r)) return false;
    var src = leadSource(r);
    if (src === "pending" || src === "owner") return false;
    if (!leadIsDealClosed(r)) return false;
    return src === "captain" || src === "clickboat" || src === "ownersourced" || src === "other";
  }
  function whiteInvoiceAmt(r) {
    if (!r) return 0;
    if (leadHasSplit(r)) {
      if (num(r.invoiceTotal) > 0) return round2(num(r.invoiceTotal));
      return round2(leadWhiteClientPay(r));
    }
    return round2(num(r.total) || num(r.base) || num(r.price));
  }
  function chargeTiming(c) {
    var d = String((c && c.date) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "done";
    return d > today ? "upcoming" : "done";
  }
  var upsellGrossFn =
    typeof opts.chargeUpsellGross === "function"
      ? opts.chargeUpsellGross
      : function (c) {
          return num(c && c.extAmt) || 0;
        };
  var commPartsFn =
    typeof opts.chargeCommissionParts === "function" ? opts.chargeCommissionParts : null;
  var isCapCommFn =
    typeof opts.isChargeCaptainComm === "function"
      ? opts.isChargeCaptainComm
      : function () {
          return false;
        };
  var extHrsFn =
    typeof opts.chargeExtHours === "function"
      ? opts.chargeExtHours
      : function () {
          return 0;
        };
  var extAmtFn =
    typeof opts.chargeExtAmt === "function"
      ? opts.chargeExtAmt
      : function (c) {
          return num(c && c.extAmt);
        };

  leads.forEach(function (r) {
    if (!r) return;
    var cancelled = leadIsCancelled(r);
    var src = leadSource(r);
    var isOwner = src === "owner";
    var isPending = src === "pending";
    if (isPending && !cancelled) nPendSrc++;
    if (!isPending && !cancelled && !leadIsDealClosed(r)) nOpenDeal++;
    if (isOwner && !cancelled && ownerBenefitIncluded(r)) {
      var ov = leadOwnerBenefitValue(r);
      if (ov > 0) {
        ownVal = round2(ownVal + ov);
        ownN++;
      }
    }
    var closed = isClosedCommercial(r);
    if (!closed) return;
    var timing = leadCharterTiming(r, today);
    var isUpcoming = timing === "upcoming";
    var val = leadListMoney(r);
    var parts = leadProjectedNetParts(r);
    var exVat = parts.ex;
    var comm = parts.comm;
    var exVatFull = leadCommissionBase(r);
    var commFull = leadCommissionAmt(r);
    /*
     * Owner-sourced Finance numbers = Paid invoices only (leadListMoney).
     * Before-VAT from that paid gross; commission 0 in business net
     * (provider fairness is Commissions-only).
     * Skip OS rows with €0 paid from done/proj so notional never inflates.
     */
    if (src === "ownersourced") {
      if (!(val > 0.009)) return;
      var vatPctOs = commissionVatPct(r);
      exVat = round2(val / (1 + vatPctOs / 100));
      comm = 0;
      exVatFull = exVat;
      commFull = 0;
    }
    if (isUpcoming) addCharter(proj, val, exVat, comm);
    else addCharter(done, val, exVat, comm);
    var tk = leadCharterTypeKey(r);
    if (src === "captain") {
      bumpSourceCard(cap, val, exVatFull, commFull, tk, isUpcoming);
    } else if (src === "clickboat") {
      bumpSourceCard(cb, val, exVatFull, commFull, tk, isUpcoming);
    } else if (src === "ownersourced") {
      bumpSourceCard(os, val, exVatFull, commFull, tk, isUpcoming);
      /* To-date white = Paid invoice money only (same as val) */
      if (isUpcoming) return;
      osWhite = round2(osWhite + val);
      /* Do not accumulate OS pocket/boat cash guesses into Finance */
    }
  });

  charters.forEach(function (c) {
    if (!c) return;
    var chargeWhen = chargeTiming(c);
    if (chargeWhen !== "upcoming" && isCapCommFn(c) && commPartsFn) {
      var cpAll = commPartsFn(c) || { base: 0, total: 0, gross: 0 };
      var cmAll = num(cpAll.total);
      var baseAll = num(cpAll.base);
      var grossAll = num(cpAll.gross);
      if (cmAll > 0.009 || baseAll > 0.009) {
        capUpsell.n++;
        capUpsell.comm = round2(capUpsell.comm + cmAll);
        capUpsell.base = round2(capUpsell.base + baseAll);
        capUpsell.gross = round2(capUpsell.gross + (grossAll > 0 ? grossAll : num(c.amount)));
      }
    }
    var gross = upsellGrossFn(c);
    var hrs = extHrsFn(c);
    var kind = String(c.kind || c.chargeKind || "").toLowerCase();
    var isUpsell =
      gross > 0 || hrs > 0 || kind === "extension" || kind === "extra" || kind === "upsell";
    if (!isUpsell) return;
    if (
      !(gross > 0) &&
      num(c.amount) > 0 &&
      (kind === "extension" || kind === "extra" || kind === "upsell" || hrs > 0) &&
      !(num(c.apaBaseAmt) > 0)
    ) {
      gross = Math.max(0, num(c.amount));
    }
    if (!(gross > 0)) return;
    var cp = { base: 0, total: 0 };
    if (isCapCommFn(c) && commPartsFn) cp = commPartsFn(c) || cp;
    var exB = num(cp.base) > 0 ? num(cp.base) : gross;
    var cm = num(cp.total);
    if (chargeWhen === "upcoming") addUpsell(proj, gross, exB, cm);
    else addUpsell(done, gross, exB, cm);
  });

  /* Full confirmed book = to-date (sailed) + projected (future confirmed) */
  var booked = {
    tot: round2((done.tot || 0) + (proj.tot || 0)),
    charters: round2((done.charters || 0) + (proj.charters || 0)),
    upsell: round2((done.upsell || 0) + (proj.upsell || 0)),
    ex: round2((done.ex || 0) + (proj.ex || 0)),
    comm: round2((done.comm || 0) + (proj.comm || 0)),
    upsellComm: round2((done.upsellComm || 0) + (proj.upsellComm || 0)),
    n: (done.n || 0) + (proj.n || 0),
    nUpsell: (done.nUpsell || 0) + (proj.nUpsell || 0),
    /* White net only (before VAT − commissions); free cash is never in this total */
    whiteNet: round2(
      Math.max(0, (done.ex || 0) - (done.comm || 0)) +
        Math.max(0, (proj.ex || 0) - (proj.comm || 0))
    ),
  };

  finalizeSourceBooked(cap);
  finalizeSourceBooked(cb);
  finalizeSourceBooked(os);

  return {
    done: done,
    proj: proj,
    booked: booked,
    ownVal: ownVal,
    ownN: ownN,
    nPendSrc: nPendSrc,
    nOpenDeal: nOpenDeal,
    captain: cap,
    clickboat: cb,
    ownersourced: os,
    osWhite: osWhite,
    osPocket: osPocket,
    osBoat: osBoat,
    osCashPend: osCashPend,
    capUpsell: capUpsell,
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
 * Client total:
 *  - cash-only = cash fee (whole charter)
 *  - split = formal white (PDF) + free cash when cash is set
 *  - else quote total
 */
function leadClientTotal(l) {
  if (!l) return 0;
  if (leadIsCashOnlyDeal(l)) {
    var cOnly = leadFreeCashAmt(l);
    if (cOnly > 0) return cOnly;
    return round2(num(l.total) || num(l.base) || num(l.price));
  }
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
  if (cash > 0 && !(whitePay > 0)) return cash;
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
 * Rate from source: captain default 10% (or per-lead stamp / force preview),
 * clickboat 24%, ownersourced provider 10% (force 15% preview) — not captain petty.
 * Split: rate × white before VAT + rate × cash black.
 * Normal VAT-include: rate × (total÷1.21).
 * @param {object} r lead
 * @param {number|object} [forceOrOpts] force % for what-if preview
 */
function leadCommissionParts(r, forceOrOpts) {
  var ratePct = leadCommissionRatePct(r, forceOrOpts);
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
  /* Full cash-only charter: commission on cash fee (no white) */
  if (leadIsCashOnlyDeal(r)) {
    var cashOnly = leadFreeCashAmt(r);
    if (!(cashOnly > 0)) cashOnly = leadCommissionGrossAmount(r);
    var cashOnlyComm = round2(cashOnly * pctRate);
    return {
      split: true,
      cashOnly: true,
      whiteBeforeVat: 0,
      cashBlack: cashOnly,
      base: cashOnly,
      whiteComm: 0,
      cashComm: cashOnlyComm,
      total: cashOnlyComm,
      gross: cashOnly,
      ratePct: ratePct,
      source: src,
    };
  }

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

function leadInvLineIssuedOrPaid(status) {
  var s = String(status || "").trim();
  return s === "Issued" || s === "Paid";
}

/**
 * Public list price for a lead’s duration/season (VAT-in), before owner-sourced discount.
 */
function ownerSourcedListPrice(r) {
  if (!r) return 0;
  var start = String(r.start || r.cdate || "").slice(0, 10);
  var end = String(r.end || r.start || r.cdate || "").slice(0, 10);
  var season = charterSeason(start);
  var table = CHARTER_RATES[season] || CHARTER_RATES.low;
  var dur = String(r.dur || r.duration || "").toLowerCase().trim();
  var days = num(r.days);
  if (!(days > 0)) days = charterCalendarDays(start, end, !!r.allDay, r.daysList);
  if (dur === "multi" || (days > 1 && dur !== "4h" && dur !== "6h" && dur !== "8h")) {
    return round2((table.day || 0) * Math.max(1, days));
  }
  if (dur === "4h" || dur === "6h" || dur === "8h") {
    return round2(table[dur] != null ? table[dur] : table["8h"]);
  }
  var fromEv = charterPriceFromEvent({
    start: start,
    end: end,
    startTime: r.startTime,
    endTime: r.endTime,
    allDay: r.allDay,
    days: r.daysList,
    summary: String(r.notes || r.name || "") + (dur ? " " + dur : ""),
  });
  return round2(fromEv && fromEv.total > 0 ? fromEv.total : table["8h"]);
}

/** Notional commercial price = list × (1 − 20%). Prefer stamped ownerSourcedNotional. */
function ownerSourcedNotionalPrice(r) {
  if (!r) return 0;
  var stamped = num(r.ownerSourcedNotional);
  if (stamped > 0) return round2(stamped);
  var list = ownerSourcedListPrice(r);
  if (!(list > 0)) return 0;
  return round2(list * (1 - OWNER_SOURCED_LIST_DISCOUNT));
}

function leadInvLinePaid(status) {
  return String(status || "").trim() === "Paid";
}

/**
 * Money that entered the commercial books for an owner-sourced charter:
 * Issued/Paid deposit + final + APA only (fairness / Commissions “in books”).
 * Do NOT count free cash / owner-pocket guesses.
 */
function ownerSourcedRecognizedIncome(r) {
  if (!r) return 0;
  var sum = 0;
  if (leadInvLineIssuedOrPaid(r.deps)) sum += num(r.dep);
  if (leadInvLineIssuedOrPaid(r.fins)) sum += num(r.fin);
  if (leadInvLineIssuedOrPaid(r.apas)) sum += num(r.apa);
  return round2(sum);
}

/**
 * Finance “business to date” for owner-sourced: Paid invoices only.
 * Hypothetical list−20% notional must never inflate Gross/Net so far.
 */
function ownerSourcedPaidIncome(r) {
  if (!r) return 0;
  var sum = 0;
  if (leadInvLinePaid(r.deps)) sum += num(r.dep);
  if (leadInvLinePaid(r.fins)) sum += num(r.fin);
  if (leadInvLinePaid(r.apas)) sum += num(r.apa);
  return round2(sum);
}

/** Possible lost income = notional − recognized (floored at 0). */
function ownerSourcedPossibleLoss(r) {
  return round2(Math.max(0, ownerSourcedNotionalPrice(r) - ownerSourcedRecognizedIncome(r)));
}

/**
 * Owner-sourced fairness breakdown (provider commission — not captain petty).
 * @param {object} r lead
 * @param {number|object} [forceOrOpts] force provider % (10 book / 15 preview)
 */
function ownerSourcedCommissionParts(r, forceOrOpts) {
  var ratePct = leadOwnerSourcedBookRatePct(
    forceOrOpts != null && typeof forceOrOpts === "object"
      ? forceOrOpts.forceOwnerSourcedPct != null
        ? forceOrOpts.forceOwnerSourcedPct
        : forceOrOpts.forcePct
      : forceOrOpts
  );
  var pctRate = ratePct / 100;
  var notional = ownerSourcedNotionalPrice(r);
  var recognized = ownerSourcedRecognizedIncome(r);
  var loss = round2(Math.max(0, notional - recognized));
  var vatPct = commissionVatPct(r);
  function beforeVat(gross) {
    if (!(gross > 0)) return 0;
    return round2(gross / (1 + vatPct / 100));
  }
  var incomeBase = beforeVat(recognized);
  var lossBase = beforeVat(loss);
  var incomeComm = round2(incomeBase * pctRate);
  var forgoneComm = round2(lossBase * pctRate);
  return {
    notional: notional,
    list: ownerSourcedListPrice(r),
    recognized: recognized,
    loss: loss,
    incomeBase: incomeBase,
    lossBase: lossBase,
    incomeComm: incomeComm,
    forgoneComm: forgoneComm,
    ratePct: ratePct,
    discount: OWNER_SOURCED_LIST_DISCOUNT,
  };
}

  return {
    CAPTAIN_COMMISSION_PCT: CAPTAIN_COMMISSION_PCT,
    CAPTAIN_COMMISSION_TARGET_PCT: CAPTAIN_COMMISSION_TARGET_PCT,
    CLICKBOAT_COMMISSION_PCT: CLICKBOAT_COMMISSION_PCT,
    BILL_TYPES: BILL_TYPES,
    LEAD_SOURCES: LEAD_SOURCES,
    OWNER_SOURCED_COMMISSION_PCT: OWNER_SOURCED_COMMISSION_PCT,
    OWNER_SOURCED_COMMISSION_TARGET_PCT: OWNER_SOURCED_COMMISSION_TARGET_PCT,
    OWNER_SOURCED_LIST_DISCOUNT: OWNER_SOURCED_LIST_DISCOUNT,
    CHARTER_RATES: CHARTER_RATES,
    leadHasSplit: leadHasSplit,
    leadIsCashOnlyDeal: leadIsCashOnlyDeal,
    leadHasCashFee: leadHasCashFee,
    leadDealPayType: leadDealPayType,
    constrainDealPayType: constrainDealPayType,
    leadSource: leadSource,
    isCaptainLead: isCaptainLead,
    leadEarnsCaptainCommission: leadEarnsCaptainCommission,
    parseCaptainCommPct: parseCaptainCommPct,
    leadCaptainBookRatePct: leadCaptainBookRatePct,
    leadOwnerSourcedBookRatePct: leadOwnerSourcedBookRatePct,
    leadCommissionRatePct: leadCommissionRatePct,
    leadEarnsCommission: leadEarnsCommission,
    isClickboatLead: isClickboatLead,
    isOwnerLead: isOwnerLead,
    isOwnerSourcedLead: isOwnerSourcedLead,
    ownerSourcedListPrice: ownerSourcedListPrice,
    ownerSourcedNotionalPrice: ownerSourcedNotionalPrice,
    ownerSourcedRecognizedIncome: ownerSourcedRecognizedIncome,
    ownerSourcedPaidIncome: ownerSourcedPaidIncome,
    ownerSourcedPossibleLoss: ownerSourcedPossibleLoss,
    ownerSourcedCommissionParts: ownerSourcedCommissionParts,
    leadIsDealClosed: leadIsDealClosed,
    leadCharterStartMonth: leadCharterStartMonth,
    leadCharterStartDay: leadCharterStartDay,
    commissionBizAsOfDay: commissionBizAsOfDay,
    leadInCommissionBizScope: leadInCommissionBizScope,
    summarizeCaptainLeadBizAsOf: summarizeCaptainLeadBizAsOf,
    ownerBenefitIncluded: ownerBenefitIncluded,
    constrainLeadSource: constrainLeadSource,
    leadSourceLabel: leadSourceLabel,
    charterSeason: charterSeason,
    hoursBetweenTimes: hoursBetweenTimes,
    charterCalendarDays: charterCalendarDays,
    charterPriceFromEvent: charterPriceFromEvent,
    guestNameFromIcsSummary: guestNameFromIcsSummary,
    isIcsOffSummary: isIcsOffSummary,
    dayOffLabelFromSummary: dayOffLabelFromSummary,
    leadIsDayOff: leadIsDayOff,
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
    summarizeLeadCashOutstanding: summarizeLeadCashOutstanding,
    leadListMoney: leadListMoney,
    leadCharterTiming: leadCharterTiming,
    leadCharterTypeKey: leadCharterTypeKey,
    summarizeRealisedNetGlimpse: summarizeRealisedNetGlimpse,
    summarizeLeadsMoneyDashboard: summarizeLeadsMoneyDashboard,
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
