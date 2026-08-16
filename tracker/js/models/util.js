/**
 * LY_MODELS · util (num / money helpers)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.util = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
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


/**
 * Split a VAT-inclusive gross into net + VAT.
 * @param {number} gross
 * @param {number} [pct] default 21
 * @returns {{ net, vat, gross, pct }}
 */
function invoiceSplitGross(gross, pct) {
  pct = pct == null || pct === "" ? 21 : Number(pct) || 0;
  gross = Number(gross) || 0;
  if (pct <= 0) return { net: gross, vat: 0, gross: gross, pct: 0 };
  var net = gross / (1 + pct / 100);
  var vat = gross - net;
  return { net: net, vat: vat, gross: gross, pct: pct };
}

/**
 * True when today falls on start..end (inclusive). Empty end → start-only day.
 * @param {string} todayYmd YYYY-MM-DD
 * @param {string} start
 * @param {string} [end]
 */
function ymdTouchesDay(todayYmd, start, end) {
  var today = String(todayYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  var s = String(start || "").trim().slice(0, 10);
  var e = String(end || start || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) e = s;
  if (e < s) e = s;
  return s <= today && today <= e;
}

/**
 * Parse "HH:MM" or "H:MM" (optional seconds) → minutes from midnight, or null.
 * @param {string} hm
 * @returns {number|null}
 */
function parseClockMinutes(hm) {
  var m = String(hm || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var min = parseInt(m[2], 10);
  if (!isFinite(h) || !isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Local wall-clock ms for charter end on ymd.
 * With endTime → that clock; without → end of that calendar day (23:59:59.999).
 * @param {string} ymd YYYY-MM-DD
 * @param {string} [endTime] HH:MM
 * @returns {number|null}
 */
function charterEndLocalMs(ymd, endTime) {
  var d = String(ymd || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  var p = d.split("-");
  var y = parseInt(p[0], 10);
  var mo = parseInt(p[1], 10) - 1;
  var day = parseInt(p[2], 10);
  if (!isFinite(y) || !isFinite(mo) || !isFinite(day)) return null;
  var mins = parseClockMinutes(endTime);
  if (mins == null) return new Date(y, mo, day, 23, 59, 59, 999).getTime();
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  return new Date(y, mo, day, h, m, 0, 0).getTime();
}

/**
 * True when now is strictly after the charter end (local).
 * Multi-day: pass end date as `end` (or same as `date`).
 * No endTime → end-of-day on that date counts as the deadline.
 *
 * @param {{
 *   date?: string,
 *   end?: string,
 *   endTime?: string,
 *   nowMs?: number
 * }} opts
 * @returns {boolean}
 */
function isPastCharterEnd(opts) {
  opts = opts || {};
  var endYmd = String(opts.end || opts.date || "")
    .trim()
    .slice(0, 10);
  var endMs = charterEndLocalMs(endYmd, opts.endTime);
  if (endMs == null) return false;
  var now = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  if (!isFinite(now)) now = Date.now();
  return now > endMs;
}

/**
 * Soft name key for matching charge.client ↔ lead.name (accent-fold + lower).
 * @param {string} s
 * @returns {string}
 */
function softNameKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Resolve charter end date + clock for an unpaid-due check on a charge.
 * Prefers linked lead (id / name+date), else charge.date (+ charge.endTime).
 *
 * @param {object} c charge
 * @param {{ leads?: Array }} [opts]
 * @returns {{ date: string, end: string, endTime: string, leadId: string }}
 */
function chargeCharterEndContext(c, opts) {
  opts = opts || {};
  var date = String((c && c.date) || "").slice(0, 10);
  var end = date;
  var endTime = String((c && (c.endTime || c.charterEndTime)) || "").trim();
  var leadId = String((c && (c.leadId || c.fromLeadId)) || "").trim();
  var leads = Array.isArray(opts.leads) ? opts.leads : [];
  var lead = null;
  if (leadId) {
    for (var i = 0; i < leads.length; i++) {
      if (leads[i] && String(leads[i].id) === leadId) {
        lead = leads[i];
        break;
      }
    }
  }
  if (!lead && date) {
    var ck = softNameKey(c && (c.client || c.guest || ""));
    if (ck) {
      for (var j = 0; j < leads.length; j++) {
        var L = leads[j];
        if (!L) continue;
        var ls = String(L.start || L.cdate || "").slice(0, 10);
        var le = String(L.end || L.start || L.cdate || "").slice(0, 10);
        if (!ls) continue;
        if (!le) le = ls;
        if (date < ls || date > le) continue;
        if (softNameKey(L.name || L.icsGuestName || "") === ck) {
          lead = L;
          break;
        }
      }
    }
  }
  if (lead) {
    leadId = String(lead.id || leadId || "");
    var lEnd = String(lead.end || lead.start || lead.cdate || "").slice(0, 10);
    if (lEnd) end = lEnd;
    if (!date) date = String(lead.start || lead.cdate || end).slice(0, 10);
    var letm = String(lead.endTime || "").trim();
    if (letm) endTime = letm;
  }
  if (!end) end = date;
  return { date: date, end: end, endTime: endTime, leadId: leadId };
}

/**
 * Unpaid charge and now is after linked charter end (collect cash / settle).
 * Paid → always false. No date → false.
 *
 * @param {object} c charge
 * @param {{
 *   leads?: Array,
 *   nowMs?: number,
 *   isPaid?: function
 * }} [opts]
 * @returns {boolean}
 */
function chargeIsUnpaidDue(c, opts) {
  opts = opts || {};
  if (!c) return false;
  var paid = false;
  if (typeof opts.isPaid === "function") {
    paid = !!opts.isPaid(c);
  } else {
    paid =
      String(c.payStatus || c.status || "").toLowerCase() === "paid" ||
      c.paid === true;
  }
  if (paid) return false;
  var ctx = chargeCharterEndContext(c, { leads: opts.leads });
  if (!ctx.end && !ctx.date) return false;
  return isPastCharterEnd({
    date: ctx.date,
    end: ctx.end,
    endTime: ctx.endTime,
    nowMs: opts.nowMs,
  });
}

/**
 * Ops “today” board — pure grouping for the captain day view.
 * Caller supplies plain rows (already denormalised APA start/end if needed).
 *
 * @param {{
 *   today: string,
 *   leads?: Array,
 *   charges?: Array,
 *   apa?: Array,
 *   stews?: Array,
 *   leadIsCancelled?: function,
 *   stewIsOff?: function
 * }} opts
 * @returns {{ today, n, leads, charges, apa, stews, groups }}
 */
function collectTodayOpsBoard(opts) {
  opts = opts || {};
  var today = String(opts.today || "").slice(0, 10);
  var isCancLead =
    typeof opts.leadIsCancelled === "function"
      ? opts.leadIsCancelled
      : function (r) {
          return !!(r && (r.cancelled === true || r.status === "cancelled" || r.cancelReason));
        };
  var isOffStew =
    typeof opts.stewIsOff === "function"
      ? opts.stewIsOff
      : function (r) {
          return !!(r && (r.off === true || r.status === "off" || /off\s*day/i.test(String(r.summary || ""))));
        };

  var leads = [];
  (Array.isArray(opts.leads) ? opts.leads : []).forEach(function (r) {
    if (!r || !r.id) return;
    var start = String(r.start || r.cdate || "").slice(0, 10);
    var end = String(r.end || r.start || r.cdate || "").slice(0, 10);
    if (!ymdTouchesDay(today, start, end)) return;
    var cancelled = isCancLead(r);
    var dealClosed = true;
    if (typeof opts.leadIsDealClosed === "function") {
      dealClosed = !!opts.leadIsDealClosed(r);
    } else if (r.dealClosed === false || r.dealClosed === "false" || r.dealClosed === 0) {
      dealClosed = false;
    } else if (r.dealClosed === true || r.dealClosed === "true" || r.dealClosed === 1) {
      dealClosed = true;
    } else if (!r.id) {
      dealClosed = false;
    }
    var pendingSrc = String(r.leadSource || r.source || "").toLowerCase() === "pending";
    var tentative = !cancelled && (!dealClosed || pendingSrc || r.status === "tentative");
    leads.push({
      kind: "lead",
      id: String(r.id),
      title: String(r.name || r.icsGuestName || "Lead").trim() || "Lead",
      start: start,
      end: end,
      startTime: String(r.startTime || "").trim(),
      endTime: String(r.endTime || "").trim(),
      allDay: !!(r.allDay === true || r.allDay === "true" || r.allDay === 1),
      status: cancelled ? "cancelled" : tentative ? "tentative" : "confirmed",
      subtitle: String(r.dur || r.type || r.leadSource || r.source || "").trim(),
      amount: Number(r.amount) || Number(r.price) || Number(r.total) || 0,
    });
  });

  var charges = [];
  var nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  (Array.isArray(opts.charges) ? opts.charges : []).forEach(function (c) {
    if (!c || !c.id) return;
    var d = String(c.date || "").slice(0, 10);
    if (!ymdTouchesDay(today, d, d)) return;
    var paid =
      String(c.payStatus || c.status || "").toLowerCase() === "paid" ||
      c.paid === true;
    var ctx = chargeCharterEndContext(c, { leads: opts.leads });
    var unpaidDue =
      !paid &&
      chargeIsUnpaidDue(c, {
        leads: opts.leads,
        nowMs: nowMs,
      });
    charges.push({
      kind: "charge",
      id: String(c.id),
      title: String(c.client || c.guest || "Charge").trim() || "Charge",
      start: d,
      end: ctx.end || d,
      startTime: String(c.startTime || "").trim(),
      endTime: ctx.endTime || "",
      status: paid ? "paid" : unpaidDue ? "unpaid-due" : "pending",
      unpaidDue: !!unpaidDue,
      subtitle:
        c.kind === "apa" || c.apaTripId
          ? "APA shortfall"
          : String(c.billType || c.payMethod || "").trim(),
      amount: Number(c.amount) || 0,
    });
  });

  var apa = [];
  (Array.isArray(opts.apa) ? opts.apa : []).forEach(function (t) {
    if (!t || !t.id) return;
    var start = String(t.start || t.charterStart || t.date || "").slice(0, 10);
    var end = String(t.end || t.charterEnd || t.start || t.charterStart || "").slice(0, 10);
    if (!ymdTouchesDay(today, start, end)) return;
    apa.push({
      kind: "apa",
      id: String(t.id),
      title: String(t.guest || t.name || t.client || "APA trip").trim() || "APA trip",
      start: start,
      end: end,
      status: "apa",
      subtitle: String(t.dates || "").trim(),
      amount: Number(t.apaSent) || 0,
    });
  });

  var stews = [];
  (Array.isArray(opts.stews) ? opts.stews : []).forEach(function (a) {
    if (!a) return;
    if (isOffStew(a)) return;
    var start = String(a.start || "").slice(0, 10);
    var end = String(a.end || a.start || "").slice(0, 10);
    if (!ymdTouchesDay(today, start, end)) return;
    var cancelled =
      a.cancelled === true ||
      a.status === "cancelled" ||
      String(a.status || "").toLowerCase() === "cancelled";
    var nCrew = Array.isArray(a.stewIds) ? a.stewIds.filter(Boolean).length : 0;
    /* Same as Stews roster: friends / private day is not “unassigned” */
    var noStewNeeded =
      a.noStewNeeded === true ||
      a.noStewNeeded === "true" ||
      a.noStewNeeded === 1 ||
      String(a.status || "").toLowerCase() === "none";
    var eventKey = a.eventKey != null ? String(a.eventKey) : "";
    var status;
    var subtitle;
    if (cancelled) {
      status = "cancelled";
      /* Status pill already says Cancelled — no duplicate subtitle */
      subtitle = "";
    } else if (nCrew > 0) {
      status = String(a.payStatus || "") === "Paid" ? "paid" : "assigned";
      subtitle = nCrew + " stew" + (nCrew === 1 ? "" : "s");
    } else if (noStewNeeded) {
      status = "none";
      /* Status pill already says “No stew needed” — do not repeat in subtitle */
      subtitle = "";
    } else {
      status = "unassigned";
      subtitle = "";
    }
    stews.push({
      kind: "stew",
      id: eventKey || String(a.id || start),
      eventKey: eventKey,
      title: String(a.summary || a.guest || "Charter").trim() || "Charter",
      start: start,
      end: end,
      startTime: String(a.startTime || "").trim(),
      endTime: String(a.endTime || "").trim(),
      allDay: !!(a.allDay === true || a.allDay === "true" || a.allDay === 1),
      status: status,
      subtitle: subtitle,
      amount: 0,
      nCrew: nCrew,
      noStewNeeded: !!noStewNeeded,
    });
  });

  function byStart(a, b) {
    var sa = String(a.start || ""),
      sb = String(b.start || "");
    if (sa !== sb) return sa < sb ? -1 : 1;
    /* Same day: earlier clock first (blank times last) */
    var ta = String(a.startTime || "99:99");
    var tb = String(b.startTime || "99:99");
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.title || "").localeCompare(String(b.title || ""));
  }
  leads.sort(byStart);
  charges.sort(byStart);
  apa.sort(byStart);
  stews.sort(byStart);

  var n = leads.length + charges.length + apa.length + stews.length;
  return {
    today: today,
    n: n,
    leads: leads,
    charges: charges,
    apa: apa,
    stews: stews,
    groups: [
      { key: "lead", label: "Leads", ic: "🌐", items: leads },
      { key: "apa", label: "APA", ic: "📒", items: apa },
      { key: "charge", label: "Charges", ic: "🧾", items: charges },
      { key: "stew", label: "Stews", ic: "👩‍✈️", items: stews },
    ],
  };
}

  return {
    num: num,
    round2: round2,
    moneyFromBase: moneyFromBase,
    invoiceSplitGross: invoiceSplitGross,
    ymdTouchesDay: ymdTouchesDay,
    parseClockMinutes: parseClockMinutes,
    charterEndLocalMs: charterEndLocalMs,
    isPastCharterEnd: isPastCharterEnd,
    softNameKey: softNameKey,
    chargeCharterEndContext: chargeCharterEndContext,
    chargeIsUnpaidDue: chargeIsUnpaidDue,
    collectTodayOpsBoard: collectTodayOpsBoard,
  };
});
