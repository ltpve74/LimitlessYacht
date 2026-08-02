/**
 * LY_MODELS · stews (roster assign / cancelled / unassigned)
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
    root.LY_MODELS_PARTS.stews = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
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

/**
 * Guest tip on card / final bill — boat liability when unpaid.
 * Cash tips (guest → crew direct) are never boat liability.
 */
function stewTipIsOnBill(asg) {
  if (!asg) return false;
  var s = String(asg.tipSource || asg.tipVia || "").toLowerCase();
  return (
    s === "card" ||
    s === "bill" ||
    s === "invoice" ||
    s === "onbill" ||
    s === "on-bill" ||
    s === "final"
  );
}

function stewTipTotal(asg) {
  if (!asg) return 0;
  var t = Number(asg.tipTotal);
  if (isFinite(t) && t >= 0) return Math.round(t * 100) / 100;
  return 0;
}

/**
 * VAT % for on-card / bill tips (guest total is VAT-inclusive).
 * Default 21 (ES). tipVatPct: 0 = no VAT strip. Cash tips ignore this.
 */
function stewTipVatPct(asg) {
  if (!asg) return 21;
  if (asg.tipVatPct === 0 || asg.tipVatPct === "0") return 0;
  if (asg.tipVatPct != null && asg.tipVatPct !== "") {
    var p = Number(asg.tipVatPct);
    if (isFinite(p) && p >= 0) return p;
  }
  return 21;
}

/**
 * Amount crew may share.
 *  - Cash tip: full guest tip (no VAT).
 *  - On card/bill: guest total is VAT-inclusive → pool = gross ÷ (1+vat%).
 *
 * @returns {{ gross, net, vat, vatPct, pool, onBill }}
 */
function stewTipDistributable(asg) {
  var gross = stewTipTotal(asg);
  if (!(gross > 0)) {
    return { gross: 0, net: 0, vat: 0, vatPct: 0, pool: 0, onBill: false };
  }
  var onBill = stewTipIsOnBill(asg);
  if (!onBill) {
    return { gross: gross, net: gross, vat: 0, vatPct: 0, pool: gross, onBill: false };
  }
  var pct = stewTipVatPct(asg);
  if (!(pct > 0)) {
    return { gross: gross, net: gross, vat: 0, vatPct: 0, pool: gross, onBill: true };
  }
  var net = Math.round((gross / (1 + pct / 100)) * 100) / 100;
  var vat = Math.round((gross - net) * 100) / 100;
  return { gross: gross, net: net, vat: vat, vatPct: pct, pool: net, onBill: true };
}

/**
 * tipPaidBy map: { captain: true, "<stewId>": true }.
 * Empty / missing with tipPayStatus Paid = legacy “everyone paid”.
 */
function stewTipPaidByMap(asg) {
  if (!asg || !asg.tipPaidBy || typeof asg.tipPaidBy !== "object") return {};
  return asg.tipPaidBy;
}

function stewTipFlagTrue(v) {
  return v === true || v === "true" || v === 1 || v === "1" || v === "Paid";
}

/** Legacy single switch: whole tip marked Paid with no per-person map. */
function stewTipLegacyAllPaid(asg) {
  if (!asg) return false;
  if (!(asg.tipPayStatus === "Paid" || asg.tipPaid === true)) return false;
  var map = stewTipPaidByMap(asg);
  return !Object.keys(map).length;
}

/** Captain’s tip share paid. */
function stewTipCaptainPaid(asg) {
  if (!asg) return false;
  if (stewTipLegacyAllPaid(asg)) return true;
  if (asg.tipPayStatus === "Paid" || asg.tipPaid === true) {
    var m = stewTipPaidByMap(asg);
    if (!Object.keys(m).length) return true;
  }
  return stewTipFlagTrue(stewTipPaidByMap(asg).captain);
}

/** One stew’s tip share paid. */
function stewTipStewPaid(asg, stewId) {
  if (!asg || !stewId) return false;
  if (stewTipLegacyAllPaid(asg)) return true;
  if (asg.tipPayStatus === "Paid" || asg.tipPaid === true) {
    var m0 = stewTipPaidByMap(asg);
    if (!Object.keys(m0).length) return true;
  }
  return stewTipFlagTrue(stewTipPaidByMap(asg)[String(stewId)]);
}

/**
 * True when every tip share is paid (captain + each assigned stew).
 * Partial per-person pay → false until all ticked.
 */
function stewTipPaid(asg) {
  if (!asg) return false;
  var tot = stewTipTotal(asg);
  if (!(tot > 0)) return asg.tipPayStatus === "Paid" || asg.tipPaid === true;
  if (stewTipLegacyAllPaid(asg)) return true;
  if (!stewTipCaptainPaid(asg)) return false;
  var ids = (asg.stewIds || []).filter(Boolean);
  for (var i = 0; i < ids.length; i++) {
    if (!stewTipStewPaid(asg, ids[i])) return false;
  }
  /* No stews: captain-only share */
  return true;
}

/** Any share still open. */
function stewTipAnyUnpaid(asg) {
  var tot = stewTipTotal(asg);
  if (!(tot > 0)) return false;
  return !stewTipPaid(asg);
}

/**
 * Build tipPaidBy + tipPayStatus from per-person flags (pure).
 * @param {{ captain?: boolean, byStew?: object, stewIds?: Array }} input
 */
function planTipPaidByFields(input) {
  input = input || {};
  var ids = (input.stewIds || []).filter(Boolean).map(String);
  var byStew = input.byStew && typeof input.byStew === "object" ? input.byStew : {};
  var map = {};
  var cap = !!input.captain;
  if (cap) map.captain = true;
  var nPaid = cap ? 1 : 0;
  var nTot = 1 + ids.length;
  ids.forEach(function (sid) {
    if (stewTipFlagTrue(byStew[sid]) || stewTipFlagTrue(byStew[String(sid)])) {
      map[sid] = true;
      nPaid++;
    }
  });
  var tipPayStatus = nPaid <= 0 ? "Unpaid" : nPaid >= nTot ? "Paid" : "Partial";
  /* When fully paid keep map for clarity; legacy readers still see tipPayStatus Paid */
  return { tipPaidBy: map, tipPayStatus: tipPayStatus, nPaid: nPaid, nTot: nTot };
}

/**
 * Day pay for one stew on an assignment.
 * Prefers dayPayByStew[id]; else payEach / dayRate.
 */
function stewDayPayForStew(asg, stewId) {
  if (!asg || !stewId) return 0;
  var map = asg.dayPayByStew && typeof asg.dayPayByStew === "object" ? asg.dayPayByStew : null;
  if (map && map[String(stewId)] != null && map[String(stewId)] !== "") {
    var n = Number(map[String(stewId)]);
    if (isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
  }
  var each = Number(asg.payEach);
  if (!(isFinite(each) && each >= 0)) each = Number(asg.dayRate) || 0;
  return Math.round((each || 0) * 100) / 100;
}

function stewDayPayTotalAll(asg) {
  if (!asg) return 0;
  var ids = (asg.stewIds || []).filter(Boolean);
  if (!ids.length) return 0;
  var s = 0;
  ids.forEach(function (sid) {
    s += stewDayPayForStew(asg, sid);
  });
  return Math.round(s * 100) / 100;
}

/**
 * Guest tip split equally among all crew on the trip: captain + every assigned stew.
 * 1 stew → 2 shares (50% each). 2 stews → 3 shares (~33% each).
 *
 * Pool for shares:
 *  - Cash tip → full guest tip (no VAT)
 *  - On card/bill → after VAT (gross ÷ 1.21 by default)
 *
 * `total` = guest tip entered (gross). `pool` / `net` = amount actually split to crew.
 * Includes per-person paid / open amounts when asg has tipPaidBy / tipPayStatus.
 */
function stewTipShare(asg) {
  var dist = stewTipDistributable(asg);
  var tot = dist.gross;
  var pool = dist.pool;
  if (!(tot > 0) || !(pool > 0)) {
    return {
      total: tot || 0,
      gross: tot || 0,
      pool: 0,
      net: 0,
      vat: dist.vat || 0,
      vatPct: dist.vatPct || 0,
      onBill: !!dist.onBill,
      stewSide: 0,
      each: 0,
      nStews: 0,
      crew: 0,
      captainShare: 0,
      captainPaid: false,
      captainOpen: 0,
      stewOpen: 0,
      openTotal: 0,
      paidTotal: 0,
      allPaid: false,
      anyUnpaid: false,
      anyPaid: false,
      stewPaidBy: {},
    };
  }
  var ids = asg && asg.stewIds ? asg.stewIds.filter(Boolean) : [];
  var n = ids.length;
  var crew = 1 + n;
  /* Split after-VAT pool (card) or full cash tip */
  var each = n > 0 ? Math.round((pool / crew) * 100) / 100 : 0;
  /* No stews: whole pool is captain’s */
  if (n === 0) {
    each = 0;
  }
  var stewSide = Math.round(each * n * 100) / 100;
  var captainShare = n > 0 ? Math.round((pool - stewSide) * 100) / 100 : pool;
  var capPaid = stewTipCaptainPaid(asg);
  var stewPaidBy = {};
  var stewOpen = 0;
  var stewPaidAmt = 0;
  ids.forEach(function (sid) {
    var p = stewTipStewPaid(asg, sid);
    stewPaidBy[String(sid)] = p;
    if (p) stewPaidAmt = Math.round((stewPaidAmt + each) * 100) / 100;
    else stewOpen = Math.round((stewOpen + each) * 100) / 100;
  });
  var captainOpen = capPaid ? 0 : captainShare;
  var openTotal = Math.round((captainOpen + stewOpen) * 100) / 100;
  var paidTotal = Math.round((pool - openTotal) * 100) / 100;
  var allPaid = openTotal < 0.009;
  return {
    total: tot,
    gross: tot,
    pool: pool,
    net: dist.net,
    vat: dist.vat,
    vatPct: dist.vatPct,
    onBill: !!dist.onBill,
    stewSide: stewSide,
    each: each,
    nStews: n,
    crew: n > 0 ? crew : 1,
    captainShare: captainShare,
    captainPaid: capPaid,
    captainOpen: captainOpen,
    stewOpen: stewOpen,
    openTotal: openTotal,
    paidTotal: paidTotal,
    allPaid: allPaid,
    anyUnpaid: openTotal > 0.009,
    anyPaid: paidTotal > 0.009,
    stewPaidBy: stewPaidBy,
  };
}

/**
 * Pure plan: expense lines for a Paid charter day-pay sync.
 * View removes old event lines and inserts returned rows. Never invents floatPay
 * from Paid alone — only markFloat or previous floatPay.
 *
 * @param {{
 *   asg: object,
 *   previousLines?: Array,
 *   stewName?: function(sid): string,
 *   defaultEach?: number,
 *   dayPayAmt?: function(asg, sid): number,
 *   isSkipped?: function(eventKey, sid): boolean,
 *   nowIso?: string,
 *   who?: string,
 *   newId?: function(): string
 * }} input
 * @returns {{ eventKey: string, lines: Array, clearOnly: boolean }}
 */
function planStewDayPayExpenseLines(input) {
  input = input || {};
  var asg = input.asg;
  if (!asg || !asg.eventKey) return { eventKey: "", lines: [], clearOnly: true };
  var eventKey = String(asg.eventKey);
  if (String(asg.payStatus || "") !== "Paid") {
    return { eventKey: eventKey, lines: [], clearOnly: true };
  }
  var date = String(asg.start || "").slice(0, 10) || "";
  var isSkipped =
    typeof input.isSkipped === "function"
      ? input.isSkipped
      : function () {
          return false;
        };
  var dayPayAmt =
    typeof input.dayPayAmt === "function"
      ? input.dayPayAmt
      : function (a, sid) {
          return stewDayPayForStew(a, sid);
        };
  var stewName =
    typeof input.stewName === "function"
      ? input.stewName
      : function () {
          return "Stew";
        };
  var defaultEach = Number(input.defaultEach) || 0;
  var ids = (asg.stewIds || []).filter(Boolean).filter(function (sid) {
    return !isSkipped(asg.eventKey, sid);
  });
  var anyAmt = ids.some(function (sid) {
    return dayPayAmt(asg, sid) > 0;
  });
  if (!anyAmt || !ids.length || !date) {
    return { eventKey: eventKey, lines: [], clearOnly: true };
  }
  var prevBySid = {};
  (Array.isArray(input.previousLines) ? input.previousLines : []).forEach(function (e) {
    if (!e) return;
    prevBySid[String(e.stewId || e.linkId || "")] = e;
  });
  var markFloat = !!asg._floatPayMark;
  var paidFromDefault =
    asg._floatPayFrom === "Own money"
      ? "Own money"
      : asg._floatPayFrom === "Petty cash"
        ? "Petty cash"
        : "";
  var summary = asg.summary || "Charter";
  var nowIso = input.nowIso || new Date().toISOString();
  var who = input.who || "Captain";
  var newId =
    typeof input.newId === "function"
      ? input.newId
      : function () {
          return "id-" + Date.now() + "-" + Math.round(Math.random() * 1e6);
        };
  var lines = [];
  ids.forEach(function (sid) {
    var amt = dayPayAmt(asg, sid);
    if (!(amt > 0) && !(defaultEach > 0)) return;
    if (!(amt > 0)) amt = defaultEach;
    var linkId = "stew-day:" + eventKey + ":" + sid;
    var old = prevBySid[String(sid)] || prevBySid[linkId];
    var mapPf = asg.dayPayFromByStew && asg.dayPayFromByStew[String(sid)];
    var paidFrom = "Petty cash";
    if (mapPf === "Own money" || mapPf === "Petty cash") paidFrom = mapPf;
    else if (paidFromDefault) paidFrom = paidFromDefault;
    else if (old && old.paidFrom === "Own money") paidFrom = "Own money";
    else if (old && old.paidFrom === "Petty cash") paidFrom = "Petty cash";
    if (markFloat && asg._floatPayFrom === "Own money") paidFrom = "Own money";
    else if (markFloat && asg._floatPayFrom === "Petty cash") paidFrom = "Petty cash";
    var floatPay = false;
    if (paidFrom !== "Own money") {
      if (markFloat) floatPay = true;
      else if (old && old.floatPay === true) floatPay = true;
    }
    lines.push({
      id: (old && old.id) || newId(),
      linkId: linkId,
      source: "stew",
      stewEventKey: eventKey,
      stewId: String(sid),
      stewPayKind: "dayPay",
      crewPayStatus: "Paid",
      floatPay: floatPay,
      payStatusManual: !!asg.payStatusManual,
      date: date,
      vendor: stewName(sid),
      description: "Stewardess / day work — " + summary,
      category: "Crew Salaries",
      payMethod: "Cash",
      paidFrom: paidFrom,
      amount: amt,
      receipt: (old && old.receipt) || "",
      by: who,
      updatedAt: nowIso,
    });
  });
  return { eventKey: eventKey, lines: lines, clearOnly: false };
}

/**
 * Pure plan: on-bill tip payout expense lines for shares already paid.
 * One line per person (captain / each stew) so Laura and you can be paid separately.
 * Removes legacy single stew-tip:ek line and per-person lines for this event.
 *
 * @returns {{
 *   eventKey: string,
 *   linkPrefix: string,
 *   lines: Array,
 *   remove: boolean,
 *   linkId: string,
 *   line: object|null
 * }}
 * linkId/line kept for older callers (first line or null).
 */
function planStewTipPayoutExpense(input) {
  input = input || {};
  var asg = input.asg;
  if (!asg || !asg.eventKey) {
    return { linkId: "", eventKey: "", line: null, lines: [], remove: false, linkPrefix: "" };
  }
  var ek = String(asg.eventKey);
  var linkPrefix = "stew-tip:" + ek;
  var linkId = linkPrefix;
  var tot = stewTipTotal(asg);
  var onBill = stewTipIsOnBill(asg);
  var tip = stewTipShare(asg);
  var date = String(asg.start || "").slice(0, 10) || input.today || "";
  var nowIso = input.nowIso || new Date().toISOString();
  var who = input.who || "Captain";
  var newId =
    typeof input.newId === "function"
      ? input.newId
      : function () {
          return "id-" + Date.now() + "-" + Math.round(Math.random() * 1e6);
        };
  var moneyLabel =
    typeof input.formatMoney === "function"
      ? input.formatMoney
      : function (n) {
          return "€" + Math.round(Number(n) || 0);
        };
  var stewName =
    typeof input.stewName === "function"
      ? input.stewName
      : function () {
          return "Stew";
        };
  if (!(onBill && tot > 0)) {
    return {
      linkId: linkId,
      eventKey: ek,
      line: null,
      lines: [],
      remove: true,
      linkPrefix: linkPrefix,
    };
  }
  var lines = [];
  function pushLine(whoKey, label, amount) {
    if (!(amount > 0.009)) return;
    lines.push({
      id: newId(),
      linkId: linkPrefix + ":" + whoKey,
      source: "stew",
      kind: "tipPayout",
      stewEventKey: ek,
      stewPayKind: "tipPayout",
      tipWhoKey: whoKey,
      date: date,
      vendor: label,
      description:
        "Tip payout from petty · " +
        (asg.summary || "Charter") +
        " · " +
        label +
        " · " +
        moneyLabel(amount) +
        " (guest tip " +
        moneyLabel(tot) +
        (tip.onBill && tip.vat > 0.009
          ? " · after VAT " + moneyLabel(tip.pool)
          : "") +
        ")",
      category: "Crew tip payout",
      payMethod: "Cash",
      paidFrom: "Petty cash",
      amount: Math.round(amount * 100) / 100,
      receipt: "",
      by: who,
      updatedAt: nowIso,
    });
  }
  if (tip.captainPaid && tip.captainShare > 0.009) {
    pushLine("captain", "Captain tip", tip.captainShare);
  }
  (asg.stewIds || []).filter(Boolean).forEach(function (sid) {
    if (!stewTipStewPaid(asg, sid)) return;
    if (!(tip.each > 0.009)) return;
    var nm = stewName(sid) || "Stew";
    pushLine(String(sid), nm + " tip", tip.each);
  });
  return {
    linkId: linkId,
    eventKey: ek,
    line: lines.length ? lines[0] : null,
    lines: lines,
    remove: true,
    linkPrefix: linkPrefix,
  };
}


  return {
    stewEventId: stewEventId,
    stewKeyBare: stewKeyBare,
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
    stewTipIsOnBill: stewTipIsOnBill,
    stewTipTotal: stewTipTotal,
    stewTipVatPct: stewTipVatPct,
    stewTipDistributable: stewTipDistributable,
    stewTipPaid: stewTipPaid,
    stewTipPaidByMap: stewTipPaidByMap,
    stewTipCaptainPaid: stewTipCaptainPaid,
    stewTipStewPaid: stewTipStewPaid,
    stewTipAnyUnpaid: stewTipAnyUnpaid,
    stewTipLegacyAllPaid: stewTipLegacyAllPaid,
    planTipPaidByFields: planTipPaidByFields,
    stewTipShare: stewTipShare,
    stewDayPayForStew: stewDayPayForStew,
    stewDayPayTotalAll: stewDayPayTotalAll,
    planStewDayPayExpenseLines: planStewDayPayExpenseLines,
    planStewTipPayoutExpense: planStewTipPayoutExpense
  };
});
