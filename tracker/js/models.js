/**
 * LY_MODELS — Limitless Tracker domain models (pure, no DOM).
 *
 * Single source of truth for money rules we have already locked:
 *   - free cash black (never auto “ex VAT” suggested)
 *   - captain commission (VAT strip; split = white ex VAT + cash)
 *   - charge bill type (cash / invoice / mix)
 *   - charge captain commission (explicit flag only)
 *   - expense envelope: reimbursement / petty vs own-money (structured fields only)
 *   - diesel: bunker buy + sticky active guest sell (set after bunker / manual)
 *   - stew roster: assign lookup, cancelled / assigned / unassigned counts
 *
 * Browser: loaded before the main tracker script → window.LY_MODELS
 * Tests:   node scripts/test-tracker-models.mjs
 *
 * When changing a locked rule: update HERE, update tests, then thin wrappers
 * in tracker/index.html — do not re-implement the same math in the UI.
 *
 * NEVER classify money from free-text regex on descriptions. Past data fixes
 * belong in explicit migrations that set category/flags once, not in hot path.
 */
(function (root) {
  "use strict";

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

  function num(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v).trim().replace(/[€\s\u00a0]/g, "");
    if (!s) return 0;
    var lastC = s.lastIndexOf(","),
      lastD = s.lastIndexOf(".");
    if (lastC > -1 && lastD > -1) {
      if (lastC > lastD) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lastC > -1) {
      var after = s.length - lastC - 1;
      if (after <= 2) s = s.replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, "");
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /** VAT math: include | add | none */
  function moneyFromBase(base, vatMode, vatPctRaw) {
    var mode = vatMode || "include";
    var pct =
      mode === "none"
        ? 0
        : vatPctRaw === "" || vatPctRaw == null
          ? 21
          : Number(vatPctRaw) || 0;
    base = Number(base) || 0;
    var net, vat, total;
    if (mode === "none" || pct <= 0) {
      net = base;
      vat = 0;
      total = base;
      pct = 0;
    } else if (mode === "add") {
      net = base;
      vat = (base * pct) / 100;
      total = net + vat;
    } else {
      total = base;
      net = base / (1 + pct / 100);
      vat = total - net;
      mode = "include";
    }
    return { base: base, net: net, vat: vat, total: total, vatPct: pct, vatMode: mode };
  }

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

  /** Cancelled commercial lead (display filters). Pure — no DOM. */
  function leadIsCancelled(r) {
    if (!r) return true;
    if (r.bookingStatus === "cancelled" || r.cancelled === true) return true;
    if (r.status === "Cancelled" || r.status === "cancelled") return true;
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

  /* ---------- charges ---------- */

  function chargePayMethod(r) {
    var m = r && r.payMethod ? String(r.payMethod) : "";
    if (m === "Cash" || m === "Card" || m === "Split") return m;
    if (r && num(r.cashPaid) > 0 && num(r.cashPaid) < num(r.amount) - 0.009) return "Split";
    if (r && /cash/i.test(String(r.notes || "")) && !/card/i.test(String(r.notes || ""))) return "Cash";
    return "Card";
  }

  function chargeBillType(r) {
    if (!r) return "invoice";
    var bt = constrainBillType(r.billType);
    if (r.billType && BILL_TYPES[String(r.billType).toLowerCase()]) return bt;
    var tot = num(r.amount),
      cashP = num(r.cashPaid),
      free = num(r.cashAmt);
    if (r.cashDeal || r.vatMode === "none") {
      if (free > 0 && tot > free + 0.02) return "mix";
      if (cashP > 0 && cashP < tot - 0.009) return "mix";
      if (chargePayMethod(r) === "Cash" || r.vatMode === "none") return "cash";
    }
    if (chargePayMethod(r) === "Cash") return "cash";
    if (chargePayMethod(r) === "Split" || (cashP > 0 && cashP < tot - 0.009)) return "mix";
    return "invoice";
  }

  function chargeCashPart(r) {
    var total = num(r.amount);
    var t = chargeBillType(r);
    if (!(total > 0) || t === "invoice") return 0;
    if (t === "cash") return total;
    var cash = num(r.cashPaid);
    if (!(cash > 0) && num(r.cashAmt) > 0) cash = Math.min(total, num(r.cashAmt));
    if (!(cash > 0)) cash = 0;
    return Math.min(total, round2(cash));
  }

  function chargeInvoicePart(r) {
    return Math.max(0, round2(num(r.amount) - chargeCashPart(r)));
  }

  function chargeNeedsInvoice(r) {
    return chargeInvoicePart(r) > 0.009;
  }

  /** Explicit checkbox only — never guess from notes. */
  function isChargeCaptainComm(c) {
    if (!c || !(num(c.amount) > 0)) return false;
    if (c.captainComm === false || c.captainComm === "false" || c.captainComm === 0) return false;
    return c.captainComm === true || c.captainComm === "true" || c.captainComm === 1;
  }

  function chargeExtHours(c) {
    if (!c) return 0;
    if (num(c.extHours) > 0) return num(c.extHours);
    var n = String(c.notes || "");
    var m =
      n.match(/(?:extra|extension|extended|overtime|\+)\s*(\d+(?:[.,]\d+)?)\s*h/i) ||
      n.match(/(\d+(?:[.,]\d+)?)\s*(?:extra\s*)?h(?:ou)?rs?/i);
    if (m) return num(m[1]);
    return 0;
  }

  /** Extra-hour € amount on a charge (same bill as APA spend when set). */
  function chargeExtAmt(c) {
    return num(c && c.extAmt) > 0 ? round2(num(c.extAmt)) : 0;
  }

  /** How the extension is settled: "invoice" (card / same bill) or "cash". */
  function chargeExtSettle(c) {
    var s = c && c.extSettle != null ? String(c.extSettle).toLowerCase() : "";
    return s === "cash" ? "cash" : "invoice";
  }

  /**
   * Build total / bill type from APA ledger base + optional extension on the same charge.
   * extSettle "invoice" → full amount on formal invoice (bank statement matches one bill).
   * extSettle "cash" → extension is cash (mix if APA base > 0).
   */
  /**
   * Slice of a paid APA charge that restores the pot (shortfall only).
   * Extra charter hours (extAmt) are never pot money — counting them
   * made settled APAs show a fake positive “remaining”.
   */
  function chargeApaBaseTowardPot(c) {
    if (!c) return 0;
    var ext = chargeExtAmt(c);
    if (c.apaBaseAmt != null && c.apaBaseAmt !== "") {
      var b = round2(num(c.apaBaseAmt));
      if (b >= 0) return b;
    }
    return Math.max(0, round2(num(c.amount) - ext));
  }

  function chargeTotalsFromApaAndExt(apaBase, extAmt, extSettle) {
    apaBase = Math.max(0, round2(num(apaBase)));
    extAmt = Math.max(0, round2(num(extAmt)));
    var settle = String(extSettle || "invoice").toLowerCase() === "cash" ? "cash" : "invoice";
    var amount = round2(apaBase + extAmt);
    var billType = "invoice";
    var cashPaid = 0;
    if (extAmt > 0 && settle === "cash") {
      if (apaBase > 0.009) {
        billType = "mix";
        cashPaid = extAmt;
      } else {
        billType = "cash";
        cashPaid = extAmt;
      }
    }
    var invPart = billType === "cash" ? 0 : round2(amount - cashPaid);
    var vatPct = billType === "cash" ? 0 : 21;
    var vatMode = billType === "cash" ? "none" : "include";
    var net = 0,
      vat = 0;
    if (billType === "cash") {
      net = amount;
      vat = 0;
    } else if (billType === "mix") {
      var invNet = invPart > 0 ? invPart / 1.21 : 0;
      var invVat = invPart - invNet;
      net = round2(cashPaid + invNet);
      vat = round2(invVat);
    } else {
      net = amount > 0 ? round2(amount / 1.21) : 0;
      vat = round2(amount - net);
    }
    return {
      apaBase: apaBase,
      extAmt: extAmt,
      extSettle: settle,
      amount: amount,
      billType: billType,
      cashPaid: cashPaid,
      net: net,
      vat: vat,
      vatPct: vatPct,
      vatMode: vatMode,
    };
  }

  /**
   * Extra charter hours:
   *   Prefer same charge as APA (extAmt + extSettle) so one invoice matches the card payment.
   *   Commission only on the extension slice when extAmt is set (not on APA spend).
   *   Cash ext → 15% of full ext €; invoice ext → 15% before VAT.
   */
  function chargeCommissionParts(c) {
    var empty = { base: 0, total: 0, gross: 0, hours: 0, billType: "invoice", mode: "" };
    if (!c || !isChargeCaptainComm(c)) return empty;
    var pctRate = CAPTAIN_COMMISSION_PCT / 100;
    var hours = chargeExtHours(c);
    var extA = chargeExtAmt(c);
    var base = 0;
    var mode = "";
    var gross = 0;
    var bt = chargeBillType(c);

    /* Same-bill extension: commission only on extAmt (APA pot spend is not commissionable). */
    if (extA > 0) {
      gross = extA;
      if (chargeExtSettle(c) === "cash") {
        base = gross;
        mode = "cash";
      } else {
        base = round2(gross / (1 + commissionVatPct(c) / 100));
        mode = "invoice";
      }
      return {
        base: base,
        total: round2(base * pctRate),
        gross: gross,
        hours: hours,
        billType: bt,
        mode: mode,
      };
    }

    gross = num(c.amount);
    if (!(gross > 0)) return empty;
    if (bt === "cash" || c.vatMode === "none") {
      base = gross;
      mode = "cash";
    } else if (bt === "mix") {
      var cashP = chargeCashPart(c);
      var invP = chargeInvoicePart(c);
      var invBase = invP > 0 ? invP / (1 + commissionVatPct(c) / 100) : 0;
      base = round2(invBase + cashP);
      mode = "mix";
    } else {
      var vp = commissionVatPct(c);
      if (c.vatMode === "add" && num(c.net) > 0 && num(c.net) < gross * 0.99) {
        base = round2(num(c.net));
      } else {
        base = round2(gross / (1 + vp / 100));
      }
      mode = "invoice";
    }
    return {
      base: base,
      total: round2(base * pctRate),
      gross: gross,
      hours: hours,
      billType: bt,
      mode: mode,
    };
  }

  function chargeCommissionAmt(c) {
    return chargeCommissionParts(c).total;
  }

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

  /** Paid-from envelope: petty | own | card (card is payMethod). */
  function expensePaidFrom(e) {
    if (!e) return "petty";
    if (String(e.payMethod || "") === "Credit Card") return "card";
    var p = String(e.paidFrom || "").trim();
    if (p === "Own money" || /^own money\b/i.test(p)) return "own";
    if (p === "Petty cash" || /^petty\b/i.test(p)) return "petty";
    /* Blank / unknown on a reimbursement defaults to petty (boat cash left envelope) */
    if (isExpenseReimbursement(e)) return "petty";
    /* Blank on normal cash expense = petty (legacy) */
    if (!p) return "petty";
    if (/\bown money\b/i.test(p) || /^(my|captain)/i.test(p)) return "own";
    return "petty";
  }

  /**
   * Does this row remove physical cash from the boat envelope?
   *  - Credit card: never
   *  - Own money: never
   *  - Reimbursement from petty: yes
   *  - Reimbursement from own money: no (captain paid person; boat owes captain)
   *  - Normal cash + petty: yes
   *  - Crew day-pay: only when floatPay === true (caller may pass crew flag)
   */
  function expenseHitsPettyCash(e, opts) {
    opts = opts || {};
    if (!e) return false;
    if (opts.isCrewDayPay) {
      if (e.crewPayStatus !== "Paid") return false;
      if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return false;
      return e.floatPay === true;
    }
    if (expensePaidFrom(e) === "card") return false;
    if (isExpenseReimbursement(e)) return expensePaidFrom(e) === "petty";
    if (expensePaidFrom(e) === "own") return false;
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

  /* ---------- Diesel (bunker buy + sticky active guest sell) ---------- */
  /**
   * Model rules (locked):
   *  1. After each bunker, set buyPrice and an explicit guest sellPrice
   *     (default = bunker + markup; captain may type a different sell).
   *  2. sellPrice is ACTIVE for all subsequent sell / new APA rates until
   *     the next bunker or a manual sell change.
   *  3. Manual sell edits stick (sellSource = manual) until the next bunker.
   *  4. Never treat legacy 1.75 as “today’s rate” when buy or sell is known.
   *  5. Historical lines store their own €/L — never re-price them.
   */
  var DIESEL_MARKUP = 0.1;
  var DIESEL_DEFAULT_BUY = 1.74;
  /* Reconstruct-only when a pre-model trip has fuel but no bunker/rate. Not “current”. */
  var DIESEL_LEGACY_FALLBACK_SELL = 1.75;
  /* Obsolete fixed default from an early build — scrub if still stored */
  var DIESEL_PREV_DEFAULT_HIGH = 2.2;

  function dieselSuggestedSell(buyPrice, markup) {
    var m = markup == null ? DIESEL_MARKUP : Number(markup);
    if (!isFinite(m)) m = DIESEL_MARKUP;
    var b = round2(num(buyPrice));
    if (!(b > 0)) return 0;
    return round2(b + m);
  }

  /**
   * Normalize settings row. Fills missing buy/sell; scrubs obsolete 2.20.
   * Does NOT overwrite a valid sell with buy+markup (manual/bunker sell sticks).
   */
  function dieselNormalizeSettings(settings, opts) {
    opts = opts || {};
    var out = settings && typeof settings === "object" ? settings : {};
    var dirty = false;
    function set(k, v) {
      if (out[k] !== v) {
        out[k] = v;
        dirty = true;
      }
    }
    var buy = round2(num(out.buyPrice));
    if (!(buy > 0)) {
      var lb = round2(num(opts.lastBunkerBuy));
      buy = lb > 0 ? lb : DIESEL_DEFAULT_BUY;
      set("buyPrice", buy);
    }
    var sell = round2(num(out.sellPrice));
    if (Math.abs(sell - DIESEL_PREV_DEFAULT_HIGH) < 0.001) sell = 0;
    if (!(sell > 0)) {
      sell = dieselSuggestedSell(buy);
      set("sellPrice", sell);
      if (!out.sellSource) set("sellSource", "suggested");
    }
    if (!out.sellSource) {
      set("sellSource", out.sellPinned ? "manual" : "suggested");
    }
    return {
      settings: out,
      changed: dirty,
      buyPrice: round2(num(out.buyPrice)),
      sellPrice: round2(num(out.sellPrice)),
      sellSource: String(out.sellSource || "suggested"),
      suggestedSell: dieselSuggestedSell(round2(num(out.buyPrice))),
    };
  }

  /**
   * After bunkering: set buy + sale price for subsequent transactions.
   * explicitSell > 0 wins; else suggested = buy + markup.
   * Always refreshes sell (new bunker = new sale period).
   */
  function dieselApplyBunker(settings, bunkerBuy, explicitSell) {
    var buy = round2(num(bunkerBuy));
    if (!(buy > 0)) {
      return {
        settings: settings || {},
        changed: false,
        buyPrice: 0,
        sellPrice: 0,
        suggestedSell: 0,
        sellSource: "",
      };
    }
    var suggested = dieselSuggestedSell(buy);
    var sell = round2(num(explicitSell));
    if (!(sell > 0)) sell = suggested;
    var src = Math.abs(sell - suggested) < 0.001 ? "bunker" : "manual";
    var out = settings && typeof settings === "object" ? settings : {};
    var dirty = false;
    if (round2(num(out.buyPrice)) !== buy) {
      out.buyPrice = buy;
      dirty = true;
    }
    if (round2(num(out.sellPrice)) !== sell) {
      out.sellPrice = sell;
      dirty = true;
    }
    if (out.sellSource !== src) {
      out.sellSource = src;
      dirty = true;
    }
    if (out.sellPinned) {
      out.sellPinned = false;
      dirty = true;
    }
    return {
      settings: out,
      changed: dirty,
      buyPrice: buy,
      sellPrice: sell,
      suggestedSell: suggested,
      sellSource: src,
    };
  }

  /** Captain sets active sale price between bunkers (spread / market). */
  function dieselSetActiveSell(settings, sellPrice) {
    var sell = round2(num(sellPrice));
    var out = settings && typeof settings === "object" ? settings : {};
    if (!(sell > 0)) {
      return { settings: out, changed: false, sellPrice: 0, sellSource: "" };
    }
    var dirty = false;
    if (round2(num(out.sellPrice)) !== sell) {
      out.sellPrice = sell;
      dirty = true;
    }
    if (out.sellSource !== "manual") {
      out.sellSource = "manual";
      dirty = true;
    }
    if (!out.sellPinned) {
      out.sellPinned = true;
      dirty = true;
    }
    return {
      settings: out,
      changed: dirty,
      sellPrice: sell,
      sellSource: "manual",
    };
  }

  /** Active guest sell for NEW sells / new APA — settings only, no 1.75 invent. */
  function dieselActiveSell(settings) {
    return dieselNormalizeSettings(settings || {}).sellPrice;
  }

  /**
   * Guest sell for a calendar day (historical resolve for unpinned trips).
   * Last bunker on/before date → buy + markup.
   * No bunker: opts.activeSell if set, else legacy reconstruct fallback only.
   */
  function dieselGuestSellForDate(bunkers, dateStr, opts) {
    opts = opts || {};
    var markup = opts.markup == null ? DIESEL_MARKUP : opts.markup;
    var cut = dateStr ? String(dateStr).slice(0, 10) : "";
    var best = null;
    (bunkers || []).forEach(function (e) {
      if (!e || (e.kind && e.kind !== "buy")) return;
      var px = round2(num(e.price));
      if (!(px > 0)) return;
      var d = String(e.date || "").slice(0, 10);
      if (cut && d && d > cut) return;
      if (!best) {
        best = { date: d, price: px };
        return;
      }
      if (!d) return;
      if (d > String(best.date || "")) {
        best = { date: d, price: px };
        return;
      }
      if (d === String(best.date || "")) best = { date: d, price: px };
    });
    if (best && best.price > 0) return dieselSuggestedSell(best.price, markup);
    var active = round2(num(opts.activeSell));
    if (active > 0) return active;
    return DIESEL_LEGACY_FALLBACK_SELL;
  }

  /* ---------- Stew roster (calendar + assign status) ---------- */
  /**
   * Locked rules:
   *  1. Cancelled = assign.cancelled / assign.status cancelled OR event status cancelled
   *  2. Assigned  = at least one stewId that resolves to a name on the roster
   *                 (raw stewIds length alone is NOT enough — deleted roster people
   *                 must count as unassigned in the UI and in totals)
   *  3. Unassigned = not cancelled and not assigned
   *  4. Always: trips = assigned + unassigned + cancelled
   *  5. Event↔assign match: exact eventKey, uid: / bare uid, then unique start+summary
   */

  /** Stable event id for matching (prefer uid: form). */
  function stewEventId(ev) {
    if (!ev) return "";
    if (ev.uid) return "uid:" + String(ev.uid);
    if (ev.key != null && String(ev.key) !== "") return String(ev.key);
    return "";
  }

  function stewKeyBare(k) {
    return String(k || "").replace(/^uid:/i, "");
  }

  function stewKeysMatch(a, b) {
    if (a == null || b == null || a === "" || b === "") return false;
    var sa = String(a);
    var sb = String(b);
    if (sa === sb) return true;
    var ba = stewKeyBare(sa);
    var bb = stewKeyBare(sb);
    return ba === bb || sa === "uid:" + bb || sb === "uid:" + ba;
  }

  /** Calendar "off" days — not charters. */
  function stewIsOffEvent(ev) {
    var s = String((ev && ev.summary) || "").trim();
    if (!s) return false;
    if (/^\s*off\s*$/i.test(s)) return true;
    if (/^\s*off\s*[-–—:].+/i.test(s)) return true;
    return false;
  }

  function stewById(stews, id) {
    if (id == null || id === "") return null;
    var list = stews || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  /** Resolve stewIds → display names (only people still on the roster). */
  function stewNames(stews, ids) {
    return (ids || [])
      .map(function (id) {
        var s = stewById(stews, id);
        return s && s.name ? s.name : "";
      })
      .filter(Boolean);
  }

  /**
   * True when someone on the roster is on this charter.
   * Matches list UI — not raw stewIds.length.
   */
  function stewAssignHasCrew(asg, stews) {
    if (!asg || !asg.stewIds || !asg.stewIds.length) return false;
    return stewNames(stews, asg.stewIds).length > 0;
  }

  function stewEventIsCancelled(ev, asg) {
    if (asg && (asg.cancelled || asg.status === "cancelled")) return true;
    if (ev && (ev.cancelled || String(ev.status || "").toLowerCase() === "cancelled"))
      return true;
    return false;
  }

  /** Find assign for a key among assigns (uid/bare tolerant). */
  function findAssignByEventKey(assigns, eventKey) {
    if (eventKey == null || eventKey === "") return null;
    var list = assigns || [];
    var i, a;
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a && a.eventKey != null && String(a.eventKey) === String(eventKey)) return a;
    }
    for (i = 0; i < list.length; i++) {
      a = list[i];
      if (a && a.eventKey != null && stewKeysMatch(a.eventKey, eventKey)) return a;
    }
    return null;
  }

  /**
   * Assign for a calendar event.
   * Order: eventKey / uid → leadId (leads SOT) → unique start+summary →
   * unique start when only one crew assign that day (recovery after key renames).
   * No substring/fuzzy title match (stole same-day charters).
   */
  function findAssignForEvent(assigns, ev) {
    if (!ev) return null;
    var a =
      findAssignByEventKey(assigns, ev.key) ||
      findAssignByEventKey(assigns, stewEventId(ev));
    if (a) return a;
    if (ev.uid) {
      a =
        findAssignByEventKey(assigns, "uid:" + String(ev.uid)) ||
        findAssignByEventKey(assigns, String(ev.uid));
      if (a) return a;
    }
    /* Commercial link — survives ICS uid → lead:id key renames */
    if (ev.leadId != null && String(ev.leadId) !== "") {
      var byLead = (assigns || []).filter(function (x) {
        return (
          x &&
          (String(x.leadId || "") === String(ev.leadId) ||
            String(x.cancelLeadId || "") === String(ev.leadId))
        );
      });
      if (byLead.length === 1) return byLead[0];
      /* Prefer row with crew if several */
      var withCrew = byLead.filter(function (x) {
        return x.stewIds && x.stewIds.length;
      });
      if (withCrew.length === 1) return withCrew[0];
      if (byLead.length) return byLead[0];
    }
    var start = String(ev.start || "").slice(0, 10);
    var sum = String(ev.summary || "")
      .trim()
      .toLowerCase();
    if (start && sum) {
      var hits = (assigns || []).filter(function (x) {
        if (!x || x.eventKey == null) return false;
        if (String(x.start || "").slice(0, 10) !== start) return false;
        var xs = String(x.summary || "")
          .trim()
          .toLowerCase();
        return xs === sum;
      });
      if (hits.length === 1) return hits[0];
    }
    /*
     * Do NOT match by start day alone here — same-day dual charters would steal
     * crew. Day-only recovery lives in healStewAssignsToLeads (one lead that day).
     */
    return null;
  }

  /**
   * One charter status for roster totals / list cards (identical rules).
   * @returns {"cancelled"|"assigned"|"unassigned"}
   */
  function stewRosterStatus(ev, asg, stews) {
    if (stewEventIsCancelled(ev, asg)) return "cancelled";
    if (stewAssignHasCrew(asg, stews)) return "assigned";
    return "unassigned";
  }

  /**
   * Per-event row used for both summary counts and list paint.
   * status is the single source of truth for assigned/unassigned/cancelled.
   */
  function stewRosterRow(ev, assigns, stews) {
    var asg = findAssignForEvent(assigns, ev);
    var names = stewNames(stews, asg && asg.stewIds);
    var status = stewRosterStatus(ev, asg, stews);
    /* Force status from names so counts never disagree with what the card shows */
    if (status !== "cancelled") {
      status = names.length > 0 ? "assigned" : "unassigned";
    }
    return {
      event: ev,
      assign: asg,
      names: names,
      status: status,
    };
  }

  /**
   * Aggregate roster summary for a list of charter events.
   * Off days are skipped. Always: trips === assigned + unassigned + cancelled.
   */
  function stewRosterSummary(events, assigns, stews) {
    var trips = 0;
    var assigned = 0;
    var unassigned = 0;
    var cancelled = 0;
    var rows = [];
    (events || []).forEach(function (ev) {
      if (!ev || !ev.start || stewIsOffEvent(ev)) return;
      trips++;
      var row = stewRosterRow(ev, assigns, stews);
      rows.push(row);
      if (row.status === "cancelled") cancelled++;
      else if (row.status === "assigned") assigned++;
      else unassigned++;
    });
    return {
      trips: trips,
      assigned: assigned,
      unassigned: unassigned,
      cancelled: cancelled,
      rows: rows,
    };
  }

  var api = {
    CAPTAIN_COMMISSION_PCT: CAPTAIN_COMMISSION_PCT,
    CLICKBOAT_COMMISSION_PCT: CLICKBOAT_COMMISSION_PCT,
    OWNER_SOURCED_COMMISSION_PCT: OWNER_SOURCED_COMMISSION_PCT,
    BILL_TYPES: Object.keys(BILL_TYPES),
    LEAD_SOURCES: Object.keys(LEAD_SOURCES),
    CHARTER_RATES: CHARTER_RATES,
    EXP_REIMBURSE_CATS: Object.keys(EXP_REIMBURSE_CATS),
    EXP_POCKET_CAPTAIN: EXP_POCKET_CAPTAIN,
    DIESEL_MARKUP: DIESEL_MARKUP,
    DIESEL_DEFAULT_BUY: DIESEL_DEFAULT_BUY,
    DIESEL_LEGACY_FALLBACK_SELL: DIESEL_LEGACY_FALLBACK_SELL,
    num: num,
    round2: round2,
    moneyFromBase: moneyFromBase,
    leadHasSplit: leadHasSplit,
    leadSource: leadSource,
    isCaptainLead: isCaptainLead,
    isClickboatLead: isClickboatLead,
    isOwnerLead: isOwnerLead,
    isOwnerSourcedLead: isOwnerSourcedLead,
    leadIsDealClosed: leadIsDealClosed,
    leadEarnsCaptainCommission: leadEarnsCaptainCommission,
    leadEarnsCommission: leadEarnsCommission,
    leadCommissionRatePct: leadCommissionRatePct,
    ownerBenefitIncluded: ownerBenefitIncluded,
    leadOwnerBenefitValue: leadOwnerBenefitValue,
    constrainLeadSource: constrainLeadSource,
    leadSourceLabel: leadSourceLabel,
    charterSeason: charterSeason,
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
    sanitizeLeadCash: sanitizeLeadCash,
    leadClientTotal: leadClientTotal,
    commissionVatPct: commissionVatPct,
    leadCommissionWhiteBeforeVat: leadCommissionWhiteBeforeVat,
    leadCommissionParts: leadCommissionParts,
    leadCommissionBase: leadCommissionBase,
    leadCommissionAmt: leadCommissionAmt,
    chargePayMethod: chargePayMethod,
    chargeBillType: chargeBillType,
    chargeCashPart: chargeCashPart,
    chargeInvoicePart: chargeInvoicePart,
    chargeNeedsInvoice: chargeNeedsInvoice,
    isChargeCaptainComm: isChargeCaptainComm,
    chargeExtHours: chargeExtHours,
    chargeExtAmt: chargeExtAmt,
    chargeExtSettle: chargeExtSettle,
    chargeApaBaseTowardPot: chargeApaBaseTowardPot,
    chargeTotalsFromApaAndExt: chargeTotalsFromApaAndExt,
    chargeCommissionParts: chargeCommissionParts,
    chargeCommissionAmt: chargeCommissionAmt,
    isExpenseReimbursement: isExpenseReimbursement,
    expensePaidFrom: expensePaidFrom,
    expenseHitsPettyCash: expenseHitsPettyCash,
    normalizeExpenseReimbursement: normalizeExpenseReimbursement,
    classifyExpenseCash: classifyExpenseCash,
    dieselSuggestedSell: dieselSuggestedSell,
    dieselNormalizeSettings: dieselNormalizeSettings,
    dieselApplyBunker: dieselApplyBunker,
    dieselSetActiveSell: dieselSetActiveSell,
    dieselActiveSell: dieselActiveSell,
    dieselGuestSellForDate: dieselGuestSellForDate,
    stewEventId: stewEventId,
    stewKeysMatch: stewKeysMatch,
    stewIsOffEvent: stewIsOffEvent,
    stewById: stewById,
    stewNames: stewNames,
    stewAssignHasCrew: stewAssignHasCrew,
    stewEventIsCancelled: stewEventIsCancelled,
    findAssignByEventKey: findAssignByEventKey,
    findAssignForEvent: findAssignForEvent,
    stewRosterStatus: stewRosterStatus,
    stewRosterRow: stewRosterRow,
    stewRosterSummary: stewRosterSummary,
  };

  root.LY_MODELS = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
