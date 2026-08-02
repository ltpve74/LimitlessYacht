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

function stewTipPaid(asg) {
  if (!asg) return false;
  return asg.tipPayStatus === "Paid" || asg.tipPaid === true;
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
 */
function stewTipShare(asg) {
  var tot = stewTipTotal(asg);
  if (!(tot > 0)) return { total: 0, stewSide: 0, each: 0, nStews: 0, crew: 0, captainShare: 0 };
  var n = asg && asg.stewIds ? asg.stewIds.filter(Boolean).length : 0;
  var crew = 1 + n;
  var each = n > 0 ? Math.round((tot / crew) * 100) / 100 : 0;
  var stewSide = Math.round(each * n * 100) / 100;
  var captainShare = Math.round((tot - stewSide) * 100) / 100;
  return {
    total: tot,
    stewSide: stewSide,
    each: each,
    nStews: n,
    crew: crew,
    captainShare: captainShare,
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
    stewTipPaid: stewTipPaid,
    stewTipShare: stewTipShare,
    stewDayPayForStew: stewDayPayForStew,
    stewDayPayTotalAll: stewDayPayTotalAll
  };
});
