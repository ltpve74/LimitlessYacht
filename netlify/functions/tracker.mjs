// Limitless Tracker — Netlify Function (v2) + Netlify Blobs storage
// Endpoint: /.netlify/functions/tracker
// Env: TRACKER_PASSCODE (required — captain)
//      TRACKER_MANAGER_PASSCODE (optional — manager; falls back to TRACKER_PASSCODE)
//      TRACKER_TEAM_PASSCODE (optional — stews/team; falls back to TRACKER_PASSCODE)
//      TRACKER_VAPID_PUBLIC_KEY + TRACKER_VAPID_PRIVATE_KEY (for push notifications)
//      TRACKER_VAPID_SUBJECT optional, e.g. mailto:you@example.com

import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { parseIcs, siteCalendarPublicPayload, expandRange } from "./lib/ics.mjs";
import * as LY from "./lib/leads-import.mjs";
import {
  buildSiteCalendarFromLeads,
  leadBlockedDays as leadBlockedDaysShared,
  leadIsOnHold,
} from "./lib/site-calendar.mjs";

const BLOB_KEY = "data";
const LOG_CAP = 500;
const DEVICE_CAP = 200;
const SUB_CAP = 40;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function parseBrowser(ua) {
  ua = ua || "";
  let br = "Unknown";
  if (/Edg\//.test(ua)) br = "Edge";
  else if (/OPR\/|Opera/.test(ua)) br = "Opera";
  else if (/Chrome\//.test(ua)) br = "Chrome";
  else if (/Firefox\//.test(ua)) br = "Firefox";
  else if (/Safari\//.test(ua)) br = "Safari";
  let os = "";
  if (/iPhone|iPad/.test(ua)) os = "iPhone";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "Mac";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";
  return os ? br + " · " + os : br;
}

function vapidConfigured() {
  return !!(process.env.TRACKER_VAPID_PUBLIC_KEY && process.env.TRACKER_VAPID_PRIVATE_KEY);
}

function setupVapid() {
  if (!vapidConfigured()) return false;
  webpush.setVapidDetails(
    process.env.TRACKER_VAPID_SUBJECT || "mailto:ops@limitlessyachtcharter.com",
    process.env.TRACKER_VAPID_PUBLIC_KEY,
    process.env.TRACKER_VAPID_PRIVATE_KEY
  );
  return true;
}

function isCaptain(who) {
  return /^captain\b/i.test(String(who || "").trim());
}
function isManager(who) {
  return /^manager\b/i.test(String(who || "").trim());
}
/**
 * Roles: captain | manager | team
 * Who-label for Captain/Manager wins over a stale body.role (avoids empty
 * financial payloads if role was wrong on a poll).
 * Team uses personal names + body.role === "team".
 */
function roleOf(who, bodyRole) {
  if (isCaptain(who)) return "captain";
  if (isManager(who)) return "manager";
  var r = String(bodyRole || "")
    .toLowerCase()
    .trim();
  if (r === "team") return "team";
  if (r === "captain" || r === "manager") return r;
  if (/^team\b/i.test(String(who || "").trim())) return "team";
  return "other";
}
/** Ops (APA + vessel diesel): captain only. Manager = charges/leads. Team = roster. */
function canOps(who, role) {
  return (role || roleOf(who)) === "captain" || isCaptain(who);
}
function canRoster(who, role) {
  var r = role || roleOf(who);
  return r === "captain" || r === "team" || isCaptain(who);
}
function canCommercial(who, role) {
  var r = role || roleOf(who);
  return r === "captain" || r === "manager" || isCaptain(who) || isManager(who);
}
/** Passcode per role (manager/team optional env, else same as captain). */
function passOk(pass, role) {
  var captain = process.env.TRACKER_PASSCODE || "";
  if (!captain) return false;
  var manager = process.env.TRACKER_MANAGER_PASSCODE || captain;
  var team = process.env.TRACKER_TEAM_PASSCODE || captain;
  if (role === "captain") return pass === captain;
  if (role === "manager") return pass === manager;
  if (role === "team") return pass === team;
  /* Legacy "Other" names: captain pass only */
  return pass === captain;
}

/** Stable IDs — real first APA entry from tracker/Limitless_APA_Tracker.xlsx */
const SHEET_LEAD_ID = "lead-joel-freeland-2026-07";
const SHEET_TRIP_ID = "apa-joel-freeland-2026-07";
const SHEET_CHARGE_ID = "charge-apa-joel-freeland-2026-07";

function sheetJoelLead() {
  return {
    id: SHEET_LEAD_ID,
    closed: "2026-07-16",
    name: "Joel Freeland",
    dur: "multi",
    start: "2026-07-17",
    end: "2026-07-19",
    rate: 4000,
    price: "",
    days: 3,
    base: 12000,
    net: 9917.36,
    vat: 2082.64,
    total: 12000,
    vatMode: "include",
    vatPct: 21,
    depPct: 50,
    dep: 6000,
    deps: "Paid",
    depInv: "DEP-JF-01",
    fin: 6000,
    fins: "Paid",
    finInv: "FIN-JF-01",
    apaPct: 20,
    apa: 2400,
    apas: "Issued",
    apaInv: "APA-JF-2400",
    reqAt: { apas: "2026-07-16T09:00:00Z" },
    notes: "APA ledger trip 17–19/07 — from Limitless APA Tracker spreadsheet",
    by: "Captain",
  };
}

function sheetJoelApaTrip() {
  const clientKey = "lead:" + SHEET_LEAD_ID;
  return {
    id: SHEET_TRIP_ID,
    vessel: "M/Y Limitless",
    guest: "Joel Freeland",
    captain: "Luigi",
    dates: "17-19/07",
    clientKey,
    chargeId: "",
    linkKey: clientKey + ":apas",
    linkSource: "lead",
    linkSourceId: SHEET_LEAD_ID,
    linkInvKind: "apas",
    linkInvNo: "APA-JF-2400",
    linkInvLabel: "APA",
    linkInvAmount: 2400,
    apaSent: 2400,
    topUps: 0,
    dieselPrice: 1.75,
    genBurn: 6,
    expenses: [
      {
        id: "exp-jf-marina-soller",
        date: "2026-07-17",
        category: "Dockage / Marina",
        amount: 579.07,
        vendor: "Marina Tramontana - Soller",
        paidBy: "Ship card",
        receipt: "",
        notes: "",
      },
      {
        id: "exp-jf-marina-andratx",
        date: "2026-07-18",
        category: "Dockage / Marina",
        amount: 450.64,
        vendor: "Marina Port Andratx - Andratx",
        paidBy: "Ship card",
        receipt: "",
        notes: "",
      },
    ],
    provisions: [
      { id: "prov-jf-makro", date: "2026-07-16", supplier: "Makro", items: "provisions", amount: 210.35, receipt: "", notes: "" },
      { id: "prov-jf-carrefour-1", date: "2026-07-17", supplier: "carrefour", items: "provisions", amount: 225.28, receipt: "", notes: "" },
      { id: "prov-jf-carrefour-2", date: "2026-07-17", supplier: "carrefour", items: "provisions", amount: 13.11, receipt: "", notes: "" },
      { id: "prov-jf-frau", date: "2026-07-18", supplier: "supermercado frau", items: "provisions", amount: 27.33, receipt: "", notes: "" },
      { id: "prov-jf-botiga", date: "2026-07-18", supplier: "sa botiga", items: "provisions", amount: 20.55, receipt: "", notes: "" },
      { id: "prov-jf-eroski", date: "2026-07-19", supplier: "eroski", items: "provisions", amount: 83.1, receipt: "", notes: "" },
    ],
    diesel: [
      {
        id: "dsl-jf-example",
        date: "2026-07-20",
        engineL: 1986,
        genHrs: 24,
        notes: "EXAMPLE ROW — overwrite or delete",
      },
    ],
    dieselLoads: [],
    notes: "Imported from Limitless_APA_Tracker.xlsx — first live APA ledger",
    by: "Captain",
    updatedAt: "2026-07-20T10:00:00Z",
  };
}

/**
 * One-time install of the real spreadsheet APA trip (+ matching lead)
 * as the first live records. Does not overwrite if the trip already exists.
 * Charges for APA only appear when balance is negative (see ensureApaChargesLinked).
 */
function ensureSheetApaSeed(data) {
  if (!data.meta || typeof data.meta !== "object") data.meta = {};
  if (!Array.isArray(data.apa)) data.apa = [];
  if (!Array.isArray(data.leads)) data.leads = [];
  if (!Array.isArray(data.charters)) data.charters = [];
  if (data.meta.sheetApaInstalled) return false;

  let dirty = false;
  if (!data.leads.some((l) => l && (l.id === SHEET_LEAD_ID || /^joel freeland$/i.test(String(l.name || "").trim())))) {
    data.leads.unshift(sheetJoelLead());
    dirty = true;
  }
  const hasSheetTrip = data.apa.some((t) => t && t.id === SHEET_TRIP_ID);
  const hasJoelGuest = data.apa.some(
    (t) => t && /^joel freeland$/i.test(String(t.guest || "").trim())
  );
  /* Do not seed a second Joel pot if one already exists under another id */
  if (!hasSheetTrip && !hasJoelGuest) {
    data.apa.unshift(sheetJoelApaTrip());
    dirty = true;
  } else if (hasSheetTrip) {
    const trip = data.apa.find((t) => t && t.id === SHEET_TRIP_ID);
    data.apa = [trip].concat(data.apa.filter((t) => t && t.id !== SHEET_TRIP_ID));
    dirty = true;
  }
  data.meta.sheetApaInstalled = true;
  return true;
}

function chargeIsPaid(c) {
  if (!c) return false;
  if (c.payStatus === "Paid") return true;
  if (c.payStatus === "Pending") return false;
  if (c.status === "Paid") return true;
  return false;
}

function tripLinkedCharges(data, t) {
  /* Only trip id / chargeId — never guest name (that shared one Alvaro charge across pots). */
  return (data.charters || []).filter((c) => {
    if (!c) return false;
    if (c.apaTripId && String(c.apaTripId) === String(t.id)) return true;
    if (t.chargeId && String(c.id) === String(t.chargeId)) return true;
    return false;
  });
}

function chargeIsLockedMoney(c) {
  if (!c) return false;
  if (c.invStatus === "Issued") return true;
  if (c.payStatus === "Paid" || c.status === "Paid") return true;
  return false;
}

/** APA base only restores pot — never extAmt (mirrors client chargeApaBaseTowardPot). */
function chargeApaBaseTowardPot(c) {
  if (!c) return 0;
  const ext = Math.max(0, Math.round((Number(c.extAmt) || 0) * 100) / 100);
  if (c.apaBaseAmt != null && c.apaBaseAmt !== "") {
    const b = Math.round((Number(c.apaBaseAmt) || 0) * 100) / 100;
    if (b >= 0) return b;
  }
  return Math.max(0, Math.round(((Number(c.amount) || 0) - ext) * 100) / 100);
}

/** Paid shortfall charges count toward pot (mirrors client). Free cash is lead-only. */
function tripApaPaidCovered(data, t) {
  let s = 0;
  for (const c of tripLinkedCharges(data, t)) {
    if (chargeIsPaid(c)) s += chargeApaBaseTowardPot(c);
  }
  return Math.round(s * 100) / 100;
}

/** Free cash lives on the lead — never as APA received = −cash. */
function stripLeadCashFromApaTrip(t) {
  if (!t) return false;
  let dirty = false;
  if (t.cashFromLead) {
    t.cashFromLead = false;
    dirty = true;
  }
  if (Number(t.cashAmt) > 0) {
    t.cashAmt = 0;
    dirty = true;
  }
  if (t.cashSettled) {
    t.cashSettled = false;
    dirty = true;
  }
  if (Number(t.cashReceived) > 0) {
    t.cashReceived = 0;
    dirty = true;
  }
  if (Number(t.apaSent) < 0) {
    t.apaSent = 0;
    dirty = true;
  }
  if (t.notes && /^Cash \(black\)/i.test(String(t.notes))) {
    t.notes = "";
    dirty = true;
  }
  return dirty;
}

function apaTripLooksLikeLeadCashShell(t) {
  if (!t) return false;
  if (t.cashFromLead || t.cashSettled || Number(t.cashReceived) > 0) return true;
  if (Number(t.apaSent) < 0) return true;
  if (Number(t.cashAmt) > 0 && !(Number(t.apaSent) > 0)) return true;
  return false;
}

function apaTripIsEmptyShell(t) {
  if (!t) return true;
  const exp = (t.expenses || []).length;
  const prov = (t.provisions || []).length;
  const dsl = (t.diesel || []).length;
  const spent =
    (t.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0) +
    (t.provisions || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return (
    spent <= 0.009 &&
    !(Number(t.apaSent) > 0) &&
    !(Number(t.topUps) > 0) &&
    !exp &&
    !prov &&
    !dsl
  );
}

/** Strip residual −cash pots; never re-create them. */
function syncCashReceivedFromCharges(data, t) {
  if (!t || !apaTripLooksLikeLeadCashShell(t)) return false;
  return stripLeadCashFromApaTrip(t);
}

/** Unpaid shortfall after pot + paid charges. Mirrors client apaOverageAmount. */
function tripApaOverage(data, t) {
  if (!t) return 0;
  const expSum = (t.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const prov = (t.provisions || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const price = Number(t.dieselPrice) > 0 ? Number(t.dieselPrice) : 1.75;
  const genBurn = Number(t.genBurn) > 0 ? Number(t.genBurn) : 6;
  let dCost = 0;
  for (const r of t.diesel || []) {
    const manual = Number(r.cost) || 0;
    if (manual > 0) {
      dCost += manual;
      continue;
    }
    /* Prefer stored amount (freeze ledger) over re-pricing litres */
    const stored = Number(r.amount) || 0;
    if (stored > 0) {
      dCost += stored;
      continue;
    }
    const port = Number(r.enginePortL) || 0;
    const stbd = Number(r.engineStbdL) || 0;
    const eng = port > 0 || stbd > 0 ? port + stbd : Number(r.engineL) || 0;
    const genL = (Number(r.genHrs) || 0) * genBurn;
    dCost += (eng + genL) * price;
  }
  const spent = expSum + prov + dCost;
  const basePot = (Number(t.apaSent) || 0) + (Number(t.topUps) || 0);
  const available = basePot + tripApaPaidCovered(data, t);
  const bal = available - spent;
  return bal < 0 ? Math.round(-bal * 100) / 100 : 0;
}

function normNameSrv(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

/** Charges that are really split free cash misfiled as APA shortfall. */
function purgeLeadFreeCashCharges(data) {
  if (!Array.isArray(data.charters) || !data.charters.length) return false;
  const freeByGuest = {};
  for (const l of data.leads || []) {
    if (!l || !(l.split || l.splitCash)) continue;
    const free = Math.round((Number(l.cashAmt) || 0) * 100) / 100;
    if (!(free > 0.5)) continue;
    const g = normNameSrv(l.name);
    if (g) freeByGuest[g] = free;
  }
  const drop = new Set();
  for (const c of data.charters) {
    if (!c) continue;
    if (Number(c.extAmt) > 0) continue;
    const notes = String(c.notes || "");
    if (/Cash \(black\)|^Cash black|free cash|cashFromLead|Cash pot|lead free cash/i.test(notes)) {
      drop.add(c.id);
      continue;
    }
    const g = normNameSrv(c.client);
    const free = freeByGuest[g];
    if (!(free > 0.5)) continue;
    const amt = Math.round((Number(c.amount) || 0) * 100) / 100;
    if (Math.abs(amt - free) > 1.01) continue;
    const isApa = c.kind === "apa" || c.apaTripId || c.cashDeal;
    if (!isApa) continue;
    let spent = 0;
    if (c.apaTripId) {
      const trip = (data.apa || []).find((t) => t && String(t.id) === String(c.apaTripId));
      if (trip) {
        if (apaTripLooksLikeLeadCashShell(trip)) {
          drop.add(c.id);
          continue;
        }
        spent =
          (trip.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0) +
          (trip.provisions || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        if (spent > 0.5) continue; /* real pot shortfall */
        if (!(Number(trip.apaSent) > 0) && !(Number(trip.topUps) > 0)) {
          drop.add(c.id);
          continue;
        }
      }
    }
    if (spent <= 0.009) drop.add(c.id);
  }
  if (!drop.size) return false;
  data.charters = data.charters.filter((c) => c && !drop.has(c.id));
  for (const t of data.apa || []) {
    if (t && drop.has(t.chargeId)) t.chargeId = "";
  }
  return true;
}

/**
 * Pending shortfall charge when still overspent after paid charges.
 * Never deletes Paid charges (they restore APA balance).
 */
function ensureApaChargesLinked(data) {
  if (!Array.isArray(data.apa)) return false;
  if (!Array.isArray(data.charters)) data.charters = [];
  let dirty = false;

  /* Free cash is lead-only: strip −cash shells (e.g. Michael −€1800 with €0 APA) */
  const keepApa = [];
  for (const t of data.apa) {
    if (!t) continue;
    if (apaTripLooksLikeLeadCashShell(t)) {
      if (stripLeadCashFromApaTrip(t)) dirty = true;
      if (apaTripIsEmptyShell(t)) {
        const drop = new Set(
          tripLinkedCharges(data, t)
            .filter((c) => !chargeIsPaid(c))
            .map((c) => c.id)
        );
        if (drop.size) {
          data.charters = data.charters.filter((c) => c && !drop.has(c.id));
          dirty = true;
        }
        dirty = true;
        continue; /* drop empty cash shell */
      }
    }
    keepApa.push(t);
  }
  if (keepApa.length !== data.apa.length) {
    data.apa = keepApa;
    dirty = true;
  }
  if (purgeLeadFreeCashCharges(data)) dirty = true;

  for (const t of data.apa) {
    if (!t || !String(t.guest || "").trim()) continue;
    if (syncCashReceivedFromCharges(data, t)) dirty = true;
    const over = tripApaOverage(data, t);
    const linked = tripLinkedCharges(data, t);
    const pending = linked.filter((c) => !chargeIsPaid(c));
    const paid = linked.filter((c) => chargeIsPaid(c));

    if (over <= 0) {
      if (pending.length) {
        const drop = new Set(pending.map((c) => c.id));
        data.charters = data.charters.filter((c) => c && !drop.has(c.id));
        t.chargeId = paid[0] ? paid[0].id : "";
        dirty = true;
      }
      continue;
    }

    let ch = pending[0] || null;
    if (t.chargeId) {
      const byId = pending.find((c) => c.id === t.chargeId);
      if (byId) ch = byId;
    }
    /* Preserve same-bill extension (extAmt) so invoice can match card + APA spend */
    const extAmt = Math.max(0, Math.round((Number(ch && ch.extAmt) || 0) * 100) / 100);
    const extSettle =
      ch && String(ch.extSettle || "").toLowerCase() === "cash" ? "cash" : "invoice";
    const apaBase = over;
    const total = Math.round((apaBase + extAmt) * 100) / 100;
    let billType = "invoice";
    let cashPaid = 0;
    if (extAmt > 0 && extSettle === "cash") {
      billType = apaBase > 0.009 ? "mix" : "cash";
      cashPaid = extAmt;
    }
    const invPart = billType === "cash" ? 0 : Math.round((total - cashPaid) * 100) / 100;
    const pct = billType === "cash" ? 0 : 21;
    let net = 0;
    let vat = 0;
    let vatMode = billType === "cash" ? "none" : "include";
    if (billType === "cash") {
      net = total;
      vat = 0;
    } else if (billType === "mix") {
      const invNet = invPart > 0 ? invPart / 1.21 : 0;
      net = Math.round((cashPaid + invNet) * 100) / 100;
      vat = Math.round((invPart - invNet) * 100) / 100;
    } else {
      net = total > 0 ? Math.round((total / 1.21) * 100) / 100 : 0;
      vat = Math.round((total - net) * 100) / 100;
    }
    let note =
      (t.dates ? "APA · " + t.dates + ". " : "") +
      "APA shortfall (balance negative) — synced from APA ledger";
    if (extAmt > 0) {
      note +=
        " · +" +
        extAmt.toFixed(2) +
        " ext (" +
        (extSettle === "cash" ? "cash" : "on invoice") +
        ")";
    }

    if (ch) {
      if (t.chargeId !== ch.id) {
        t.chargeId = ch.id;
        dirty = true;
      }
      if (String(ch.apaTripId || "") !== String(t.id)) {
        ch.apaTripId = t.id;
        dirty = true;
      }
      /* Never rewrite Issued / Paid amounts (stops €3k → €33 clobber) */
      if (chargeIsLockedMoney(ch)) {
        if (!ch.notes || /^APA/i.test(ch.notes) || /synced from APA|shortfall/i.test(ch.notes)) {
          ch.notes = note;
          dirty = true;
        }
        continue;
      }
      const wantAmt = total;
      if (
        Math.abs((Number(ch.amount) || 0) - wantAmt) > 0.005 ||
        ch.kind !== "apa" ||
        Math.abs((Number(ch.apaBaseAmt) || 0) - apaBase) > 0.005
      ) {
        ch.client = t.guest;
        ch.amount = wantAmt;
        ch.apaBaseAmt = apaBase;
        ch.extAmt = extAmt;
        ch.extSettle = extAmt > 0 ? extSettle : "invoice";
        ch.net = net;
        ch.vat = vat;
        ch.vatPct = pct;
        ch.vatMode = vatMode;
        ch.billType = billType;
        ch.cashPaid = cashPaid;
        ch.cashAmt = cashPaid > 0 ? cashPaid : 0;
        ch.cashDeal = billType === "cash" || billType === "mix";
        ch.kind = "apa";
        ch.apaTripId = t.id;
        if (billType === "cash") ch.payMethod = "Cash";
        else if (billType === "mix") ch.payMethod = "Split";
        else if (!ch.payMethod || ch.payMethod === "Cash" || ch.payMethod === "Split")
          ch.payMethod = "Card";
        if (ch.payStatus !== "Paid") ch.payStatus = "Pending";
        if (ch.invStatus !== "Issued") {
          ch.invStatus = billType === "cash" ? "Not needed" : "Not issued";
          ch.status = ch.payStatus || "Pending";
        }
        if (!ch.notes || /^APA/i.test(ch.notes) || /synced from APA|shortfall|pot \(sent|Cash \(black\)|\+\s*[\d.]+ ext|not the full charter/i.test(ch.notes)) {
          ch.notes = note;
        }
        dirty = true;
      }
      continue;
    }

    const id = t.id === SHEET_TRIP_ID ? SHEET_CHARGE_ID : "charge-apa-" + t.id;
    /* Avoid clobbering an existing paid row with same id */
    const idFree = !data.charters.some((c) => c && c.id === id);
    ch = {
      id: idFree ? id : "charge-apa-" + t.id + "-" + Date.now().toString(36),
      kind: "apa",
      apaTripId: t.id,
      apaBaseAmt: apaBase,
      extAmt: 0,
      extSettle: "invoice",
      cashDeal: false,
      cashAmt: 0,
      cashPaid: 0,
      billType: "invoice",
      date: t.id === SHEET_TRIP_ID ? "2026-07-17" : new Date().toISOString().slice(0, 10),
      client: t.guest,
      amount: total,
      net,
      vat,
      vatPct: pct,
      vatMode,
      payStatus: "Pending",
      payMethod: "Card",
      invStatus: "Not issued",
      status: "Pending",
      inv: "",
      notes: note,
      by: t.by || "Captain",
    };
    data.charters.unshift(ch);
    t.chargeId = ch.id;
    dirty = true;
  }
  return dirty;
}

async function loadData(store) {
  const d = await store.get(BLOB_KEY, { type: "json", consistency: "strong" });
  return (
    d || {
      charters: [],
      leads: [],
      apa: [],
      diesel: [],
      stews: [],
      stewAssign: [],
      stewCalendar: [], /* captain-refreshed ICS snapshot for team roster */
      siteCalendar: null, /* app-owned public website calendar (seeded from ICS) */
      expenses: [],
      expPetty: [],
      devices: [],
      log: [],
      pushSubs: [],
      meta: {},
    }
  );
}

/** Public site calendar summary for captain UI (no full events list required). */
function siteCalendarSummary(cal) {
  if (!cal || typeof cal !== "object") {
    return {
      exists: false,
      active: false,
      eventCount: 0,
      bookedCount: 0,
      tentativeCount: 0,
      seededAt: "",
      updatedAt: "",
      updatedBy: "",
      sample: [],
    };
  }
  const booked = Array.isArray(cal.booked) ? cal.booked : [];
  const tentative = Array.isArray(cal.tentative) ? cal.tentative : [];
  const today = new Date().toISOString().slice(0, 10);
  const sample = booked
    .concat(tentative)
    .filter((d) => d >= today)
    .sort()
    .slice(0, 12);
  return {
    exists: true,
    active: !!cal.active,
    eventCount: Array.isArray(cal.events) ? cal.events.length : 0,
    bookedCount: booked.length,
    tentativeCount: tentative.length,
    seededAt: cal.seededAt || "",
    seededFrom: cal.seededFrom || "",
    updatedAt: cal.updatedAt || cal.generatedAt || "",
    updatedBy: cal.updatedBy || "",
    sample,
  };
}

function addUtcDayYmd(ymd, n) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + (n || 0)));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return yy + "-" + mm + "-" + dd;
}

const leadBlockedDays = leadBlockedDaysShared;

/** Stew roster snapshot rows for team (from leads). */
function stewCalendarRowsFromLeads(leads) {
  const rows = [];
  (Array.isArray(leads) ? leads : []).forEach((l) => {
    if (!l || !l.id) return;
    if (
      l.bookingStatus === "cancelled" ||
      l.cancelled === true ||
      l.status === "Cancelled" ||
      l.status === "cancelled" ||
      String(l.deps || "") === "Refunded"
    )
      return;
    const days = leadBlockedDays(l);
    if (!days.length) return;
    const start = days[0];
    const end = days[days.length - 1] || start;
    const src = LY.constrainLeadSource(l.leadSource);
    const pending = leadIsOnHold(l);
    const ek = String(l.calendarEventKey || l.calEventKey || "").trim() || "lead:" + l.id;
    rows.push({
      key: ek,
      uid: l.calendarUid || l.id,
      summary: l.name || "Charter",
      start: start,
      end: end,
      startTime: "",
      endTime: "",
      allDay: true,
      status: pending ? "tentative" : "booked",
      source: "lead",
      leadId: l.id,
      leadSource: src,
      days: days,
    });
  });
  rows.sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
  return rows;
}

function rebuildSiteCalendarFromLeads(data, who, now) {
  if (!data) return null;
  data.siteCalendar = buildSiteCalendarFromLeads(
    data.leads,
    who || "system",
    now || new Date().toISOString()
  );
  return data.siteCalendar;
}

async function fetchManagerIcsText() {
  const icsUrl = process.env.AVAILABILITY_ICS_URL || "";
  if (!icsUrl) {
    const err = new Error("AVAILABILITY_ICS_URL not configured");
    err.code = "no_ics";
    throw err;
  }
  const url = icsUrl.replace(/^webcal:\/\//i, "https://");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "LimitlessYacht-Tracker/1.0 (+https://limitlessyachtcharter.com)",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error("ICS fetch failed: " + res.status);
  return res.text();
}

function leadKeyFromEvent(ev) {
  if (!ev) return "";
  if (ev.key) return String(ev.key);
  if (ev.uid) return "uid:" + String(ev.uid);
  return "";
}

/** Dates + pricing for a lead from a live ICS event (linked by uid). */
function leadDatesFromIcsEvent(ev) {
  const priced = LY.charterPriceFromEvent(ev);
  const start = String((ev && ev.start) || "").slice(0, 10);
  let end = "";
  if (priced.dur === "multi" && priced.days > 1) {
    end = addUtcDayYmd(start, priced.days - 1); /* inclusive last day in the app */
  }
  return {
    start: start,
    end: end,
    priced: priced,
    name: LY.guestNameFromIcsSummary(ev && ev.summary),
  };
}

function applyIcsDatesToLead(L, d, now, opts) {
  opts = opts || {};
  if (!L || !d || !d.start) return false;
  L.start = d.start;
  L.end = d.end || "";
  L.closed = d.start;
  if (d.priced) {
    L.dur = d.priced.dur;
    L.days = d.priced.days;
    L.rate = d.priced.rate;
    L.price = d.priced.price;
    L.base = d.priced.total;
    L.total = d.priced.total;
    L.net = d.priced.total / 1.21;
    L.vat = d.priced.total - L.net;
    L.dep = Math.round(d.priced.total * 0.5 * 100) / 100;
    L.fin = Math.round(d.priced.total * 0.5 * 100) / 100;
  }
  if (opts.updateName && d.name && d.name !== "Charter guest") L.name = d.name;
  L.icsDateConflict = false;
  L.icsProposedStart = "";
  L.icsProposedEnd = "";
  L.icsProposedDur = "";
  L.icsProposedDays = "";
  L.icsProposedPrice = "";
  L.icsProposedRate = "";
  L.icsProposedTotal = "";
  L.updatedAt = now;
  return true;
}

/**
 * Fresh-only ICS → leads + date sync for linked events.
 * - New ICS uid → pending lead
 * - Linked + pending/on-hold → auto-update dates from ICS
 * - Linked + confirmed source → stage date move for app confirmation
 */
function syncNewIcsLeads(data, events, who, now) {
  if (!data.meta || typeof data.meta !== "object") data.meta = {};
  if (!Array.isArray(data.leads)) data.leads = [];
  const leads = data.leads;

  const known = new Set();
  const prev = Array.isArray(data.meta.icsLeadKnownKeys)
    ? data.meta.icsLeadKnownKeys
    : [];
  prev.forEach((k) => {
    if (k) known.add(String(k));
  });

  const byCal = new Map();
  leads.forEach((l) => {
    if (!l) return;
    const k = String(l.calendarEventKey || l.calEventKey || "").trim();
    if (k) {
      known.add(k);
      byCal.set(k, l);
    }
    const u = String(l.calendarUid || "").trim();
    if (u) {
      const uk = u.indexOf("uid:") === 0 ? u : "uid:" + u;
      known.add(uk);
      byCal.set(uk, l);
    }
  });

  const feedKeys = [];
  (events || []).forEach((ev) => {
    if (!ev || !ev.start) return;
    if (LY.isIcsOffSummary(ev.summary)) return;
    const ek = leadKeyFromEvent(ev);
    if (!ek) return;
    feedKeys.push(ek);
  });

  /* First baseline: remember the whole live feed, create nothing */
  if (!data.meta.icsLeadBaselineAt) {
    feedKeys.forEach((k) => known.add(k));
    data.meta.icsLeadKnownKeys = Array.from(known);
    data.meta.icsLeadBaselineAt = now;
    data.meta.icsLeadBaselineBy = who || "system";
    data.meta.icsLeadLastSyncAt = now;
    return {
      baselined: true,
      created: 0,
      skippedOff: 0,
      alreadyKnown: feedKeys.length,
      autoMoved: 0,
      dateMoves: [],
      totalLeads: leads.length,
      knownCount: known.size,
    };
  }

  let created = 0;
  let skippedOff = 0;
  let alreadyKnown = 0;
  let autoMoved = 0;
  const dateMoves = [];

  (events || []).forEach((ev) => {
    if (!ev || !ev.start) return;
    if (LY.isIcsOffSummary(ev.summary)) {
      skippedOff++;
      return;
    }
    const ek = leadKeyFromEvent(ev);
    if (!ek) return;

    const L = byCal.get(ek);
    if (L) {
      known.add(ek);
      alreadyKnown++;
      const d = leadDatesFromIcsEvent(ev);
      if (!d.start) return;
      const curS = String(L.start || "").slice(0, 10);
      const curE = String(L.end || "").slice(0, 10);
      const nextE = String(d.end || "").slice(0, 10);
      const dateChanged = d.start !== curS || nextE !== curE;
      if (!dateChanged && L.start) return;

      const src = LY.constrainLeadSource(L.leadSource);
      const onHold =
        src === "pending" ||
        L.sourcePending === true ||
        L.bookingStatus === "hold" ||
        String(L.status || "").toLowerCase() === "tentative";

      if (onHold || !L.start) {
        applyIcsDatesToLead(L, d, now, { updateName: src === "pending" });
        autoMoved++;
      } else if (dateChanged) {
        /* Confirmed lead — do not move silently; stage proposal for captain confirm */
        L.icsDateConflict = true;
        L.icsProposedStart = d.start;
        L.icsProposedEnd = d.end || "";
        L.icsProposedDur = d.priced.dur;
        L.icsProposedDays = d.priced.days;
        L.icsProposedPrice = d.priced.price;
        L.icsProposedRate = d.priced.rate;
        L.icsProposedTotal = d.priced.total;
        L.updatedAt = now;
        dateMoves.push({
          leadId: L.id,
          name: L.name || d.name || "Charter",
          from: curS,
          to: d.start,
          fromEnd: curE,
          toEnd: nextE,
          eventKey: ek,
          label: d.priced.label || "",
        });
      }
      return;
    }

    if (known.has(ek)) {
      /* Baselined calendar id with no lead — leave history alone */
      known.add(ek);
      alreadyKnown++;
      return;
    }

    /* Brand-new calendar event only */
    const d = leadDatesFromIcsEvent(ev);
    const priced = d.priced;
    const name = d.name;
    const id =
      "lead-ics-" +
      String(ek)
        .replace(/^uid:/, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .slice(0, 48) +
      "-" +
      String(d.start || "").slice(0, 10);
    if (leads.some((x) => x && x.id === id)) {
      known.add(ek);
      return;
    }

    const lead = {
      id: id,
      closed: d.start,
      name: name,
      dur: priced.dur,
      start: d.start,
      end: d.end || "",
      rate: priced.rate,
      price: priced.price,
      days: priced.days,
      base: priced.total,
      net: priced.total / 1.21,
      vat: priced.total - priced.total / 1.21,
      total: priced.total,
      vatMode: "include",
      vatPct: 21,
      split: false,
      leadSource: "pending",
      sourcePending: true,
      bookingStatus: "active",
      cancelled: false,
      calendarEventKey: ek,
      calendarUid: ek.indexOf("uid:") === 0 ? ek.slice(4) : ek,
      depPct: 50,
      dep: Math.round(priced.total * 0.5 * 100) / 100,
      deps: "Not issued",
      fin: Math.round(priced.total * 0.5 * 100) / 100,
      fins: "Not issued",
      apaPct: "",
      apa: 0,
      apas: "Not issued",
      notes:
        "New from calendar · assign source (Captain / Click&Boat / Owner). " +
        priced.label +
        (ev.summary ? " · cal: " + String(ev.summary).slice(0, 60) : ""),
      by: who || "Calendar sync",
      createdAt: now,
      updatedAt: now,
      icsFresh: true,
    };
    leads.unshift(lead);
    byCal.set(ek, lead);
    known.add(ek);
    created++;
  });

  data.leads = leads;
  data.meta.icsLeadKnownKeys = Array.from(known);
  data.meta.icsLeadLastSyncAt = now;
  data.meta.icsLeadLastSyncBy = who || "";
  return {
    baselined: false,
    created,
    skippedOff,
    alreadyKnown,
    autoMoved,
    dateMoves,
    totalLeads: leads.length,
    knownCount: known.size,
  };
}

/** Apply or dismiss staged ICS date moves on confirmed leads. */
function applyIcsDateMoveDecisions(data, acceptedIds, rejectedIds, who, now) {
  const accept = new Set((acceptedIds || []).map(String));
  const reject = new Set((rejectedIds || []).map(String));
  let applied = 0;
  let dismissed = 0;
  (data.leads || []).forEach((L) => {
    if (!L || !L.id || !L.icsDateConflict) return;
    const id = String(L.id);
    if (accept.has(id) && L.icsProposedStart) {
      applyIcsDatesToLead(
        L,
        {
          start: String(L.icsProposedStart).slice(0, 10),
          end: String(L.icsProposedEnd || "").slice(0, 10),
          priced: {
            dur: L.icsProposedDur || L.dur,
            days: L.icsProposedDays || L.days || 1,
            rate: L.icsProposedRate || L.rate,
            price: L.icsProposedPrice || L.price,
            total: L.icsProposedTotal || L.total || L.price,
          },
        },
        now,
        {}
      );
      applied++;
    } else if (reject.has(id)) {
      L.icsDateConflict = false;
      L.icsProposedStart = "";
      L.icsProposedEnd = "";
      L.icsProposedDur = "";
      L.icsProposedDays = "";
      L.icsProposedPrice = "";
      L.icsProposedRate = "";
      L.icsProposedTotal = "";
      L.updatedAt = now;
      dismissed++;
    }
  });
  return { applied, dismissed };
}
async function saveData(store, data) {
  await store.setJSON(BLOB_KEY, data);
}

/**
 * One-shot wipe of security log + device list (charters/leads/APA/push untouched).
 * Bump SECURITY_RESET_ID to force another wipe after deploy.
 */
const SECURITY_RESET_ID = "2026-07-21-scratch";
function ensureSecurityScratch(data) {
  if (!data.meta || typeof data.meta !== "object") data.meta = {};
  if (data.meta.securityResetId === SECURITY_RESET_ID) return false;
  data.log = [];
  data.devices = [];
  data.meta.securityResetId = SECURITY_RESET_ID;
  data.meta.securityResetAt = new Date().toISOString();
  return true;
}

function chargeInv(r) {
  if (r.invStatus) return r.invStatus;
  if (r.status === "Invoiced") return "Issued";
  if (r.status === "Paid" && r.inv) return "Issued";
  if (r.status === "Pending") return "Not issued";
  return r.inv ? "Issued" : "Not issued";
}

/** True if cash black equals white net / suggested ex-VAT (corrupt free cash). */
function leadCashLooksSuggested(l) {
  if (!l) return false;
  const cash = Number(l.cashAmt) || 0;
  if (!(cash > 0)) return false;
  const wNet = Number(l.invoiceNet) || 0;
  if (wNet > 0 && Math.abs(cash - wNet) < 1.01) return true;
  const white = Number(l.invoiceTotal) || 0;
  const pct = Number(l.vatPct) > 0 ? Number(l.vatPct) : 21;
  if (white > 0 && (l.whiteVatMode || "include") !== "none" && (l.whiteVatMode || "include") !== "add") {
    const wn = white / (1 + pct / 100);
    if (Math.abs(cash - wn) < 1.01) return true;
  }
  const base = Number(l.base) || Number(l.price) || 0;
  if (base > 0 && wNet > 0) {
    const dealNet = base / (1 + pct / 100);
    const sug = Math.max(0, dealNet - wNet);
    if (sug > 0 && Math.abs(cash - sug) < 1.01) return true;
  }
  return false;
}

/**
 * On leads save: keep previous free cash if incoming cash is the white-net bug (€1.652,89).
 * Prevents any client from re-poisoning the blob and firing APA notifications at that amount.
 */
function protectLeadFreeCash(prevRows, nextRows) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const next = Array.isArray(nextRows) ? nextRows : [];
  const byId = new Map(prev.map((r) => [r && r.id, r]));
  return next.map((lead) => {
    if (!lead || !lead.id) return lead;
    const old = byId.get(lead.id);
    const split = !!(lead.split || lead.splitCash);
    if (!split) return lead;
    const incomingBad = leadCashLooksSuggested(lead);
    const oldCash = old ? Number(old.cashAmt) || 0 : 0;
    const oldGood = old && oldCash > 0 && !leadCashLooksSuggested(old);
    if (incomingBad && oldGood) {
      const fixed = Object.assign({}, lead);
      fixed.cashAmt = oldCash;
      fixed.cashAmtUser = true;
      const white = Number(fixed.invoiceTotal) || 0;
      fixed.total = Math.round((white + oldCash) * 100) / 100;
      return fixed;
    }
    if (incomingBad && !lead.cashAmtUser) {
      const fixed = Object.assign({}, lead);
      fixed.cashAmt = 0;
      const white = Number(fixed.invoiceTotal) || 0;
      fixed.total = Math.round(white * 100) / 100;
      return fixed;
    }
    return lead;
  });
}

/** Role of a push subscriber from who label / stored role. */
function pushSubRole(sub) {
  const r = String((sub && sub.role) || "")
    .toLowerCase()
    .trim();
  if (r === "captain" || r === "manager" || r === "team") return r;
  const who = String((sub && sub.who) || "").trim();
  if (isCaptain(who)) return "captain";
  if (isManager(who)) return "manager";
  return "team";
}
/** notice.to: all | team | captain | team_and_captain | commercial (captain+manager) */
function noticeMatchesSub(notice, sub) {
  const to = (notice && notice.to) || "all";
  if (!to || to === "all") return true;
  const role = pushSubRole(sub);
  if (to === "team") return role === "team";
  if (to === "captain") return role === "captain";
  if (to === "team_and_captain") return role === "team" || role === "captain";
  if (to === "commercial") return role === "captain" || role === "manager";
  return true;
}
function leadIsCancelledRow(lead) {
  if (!lead) return false;
  if (lead.bookingStatus === "cancelled" || lead.cancelled === true) return true;
  if (lead.status === "Cancelled" || lead.status === "cancelled") return true;
  return false;
}
function stewIdsKey(asg) {
  return (asg && Array.isArray(asg.stewIds) ? asg.stewIds : [])
    .map(String)
    .sort()
    .join(",");
}
function stewIsCancelledRow(asg) {
  return !!(asg && (asg.cancelled || asg.status === "cancelled"));
}
function fmtLeadWhen(lead) {
  if (!lead) return "";
  const s = String(lead.start || "").slice(0, 10);
  const e = String(lead.end || "").slice(0, 10);
  if (s && e && e !== s) return s + "–" + e;
  return s || String(lead.closed || "").slice(0, 10) || "";
}
function fmtAsgWhen(asg) {
  if (!asg) return "";
  const s = String(asg.start || "").slice(0, 10);
  const e = String(asg.end || "").slice(0, 10);
  if (s && e && e !== s) return s + "–" + e;
  return s || "";
}

/** Resolve stewIds → names from roster (server-side, for push body). */
function stewNamesFromRoster(stews, ids) {
  const list = Array.isArray(stews) ? stews : [];
  const byId = new Map(list.filter((s) => s && s.id != null).map((s) => [String(s.id), s]));
  return (Array.isArray(ids) ? ids : [])
    .map((id) => {
      const s = byId.get(String(id));
      return s && s.name ? String(s.name) : "";
    })
    .filter(Boolean);
}

/**
 * Build human notifications from a collection save.
 * notice.to targets push audience (team / captain / all / …).
 * data: full store (optional) — used to resolve stew names on assign.
 */
function buildNotices(coll, prevRows, nextRows, who, data) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const next = Array.isArray(nextRows) ? nextRows : [];
  const byId = new Map(prev.map((r) => [r && r.id, r]));
  const notices = [];
  const stews = data && Array.isArray(data.stews) ? data.stews : [];

  if (coll === "leads") {
    for (const lead of next) {
      if (!lead || !lead.id) continue;
      const old = byId.get(lead.id);
      const name = lead.name || "Lead";
      const when = fmtLeadWhen(lead);
      const wasCanc = old ? leadIsCancelledRow(old) : false;
      const nowCanc = leadIsCancelledRow(lead);

      /* New commercial charter → notify stews (team) */
      if (!old && !nowCanc) {
        notices.push({
          title: "New charter",
          body: `${name}${when ? " · " + when : ""}`,
          tag: `lead-new-${lead.id}`,
          url: "/tracker/",
          to: "team",
        });
      }
      /* Lead cancelled → team + captain */
      if (old && nowCanc && !wasCanc) {
        notices.push({
          title: "Charter cancelled",
          body: `${name}${when ? " · " + when : ""} (by ${who})`,
          tag: `lead-cancel-${lead.id}`,
          url: "/tracker/",
          to: "team_and_captain",
        });
      }

      if (!old) continue;
      for (const [field, label] of [
        ["deps", "Deposit"],
        ["fins", "Final balance"],
        ["apas", "APA"],
      ]) {
        if (lead[field] === "Issued" && old[field] !== "Issued") {
          const invNo =
            field === "deps" ? lead.depInv : field === "fins" ? lead.finInv : lead.apaInv;
          notices.push({
            title: "Invoice issued",
            body: `${label} · ${name}${invNo ? " #" + invNo : ""}`,
            tag: `lead-iss-${lead.id}-${field}`,
            url: "/tracker/",
            to: "commercial",
          });
        }
        if (lead[field] === "Paid" && old[field] !== "Paid") {
          notices.push({
            title: "Invoice paid",
            body: `${label} · ${name}`,
            tag: `lead-paid-${lead.id}-${field}`,
            url: "/tracker/",
            to: "commercial",
          });
        }
      }
    }
  }

  if (coll === "charters") {
    for (const ch of next) {
      const old = byId.get(ch.id);
      const client = ch.client || "Charge";
      const inv = chargeInv(ch);
      const isApa = ch.kind === "apa" || !!ch.apaTripId;
      if (!old) {
        notices.push({
          title: isApa ? "APA shortfall charge" : "New card charge",
          body: `${client} · €${Number(ch.amount) || 0} (by ${who})`,
          tag: `ch-new-${ch.id}`,
          url: "/tracker/",
          to: "commercial",
        });
        continue;
      }
      const oldInv = chargeInv(old);
      if (inv === "Issued" && oldInv !== "Issued") {
        notices.push({
          title: isApa ? "APA invoice issued" : "Charge invoice issued",
          body: `${client}${ch.inv ? " #" + ch.inv : ""}`,
          tag: `ch-iss-${ch.id}`,
          url: "/tracker/",
          to: "commercial",
        });
      }
      if (
        isApa &&
        Number(ch.amount) > 0 &&
        Math.abs((Number(old.amount) || 0) - (Number(ch.amount) || 0)) > 0.005
      ) {
        notices.push({
          title: "APA amount updated",
          body: `${client} · €${Number(ch.amount) || 0}`,
          tag: `ch-apa-amt-${ch.id}`,
          url: "/tracker/",
          to: "commercial",
        });
      }
    }
  }

  /* Roster: assignment changes + charter cancel on stew assign */
  if (coll === "stewAssign") {
    const prevByKey = new Map(
      prev.filter((a) => a && a.eventKey).map((a) => [String(a.eventKey), a])
    );
    for (const asg of next) {
      if (!asg || !asg.eventKey) continue;
      const key = String(asg.eventKey);
      const old = prevByKey.get(key);
      const summary = asg.summary || "Charter";
      const when = fmtAsgWhen(asg);
      const label = `${summary}${when ? " · " + when : ""}`;
      const nowCanc = stewIsCancelledRow(asg);
      const wasCanc = old ? stewIsCancelledRow(old) : false;

      if (old && nowCanc && !wasCanc) {
        notices.push({
          title: "Charter cancelled",
          body: `${label} (by ${who})`,
          tag: `stew-cancel-${key}`,
          url: "/tracker/",
          to: "team_and_captain",
        });
        continue; /* skip assign spam on the same save */
      }
      if (nowCanc) continue;

      const oldIds = old ? stewIdsKey(old) : "";
      const newIds = stewIdsKey(asg);
      if (oldIds === newIds) continue;

      const names = stewNamesFromRoster(stews, asg.stewIds);
      const n = names.length || (Array.isArray(asg.stewIds) ? asg.stewIds.filter(Boolean).length : 0);
      const whoList =
        names.length > 0
          ? names.join(", ")
          : n > 0
            ? n + " stew" + (n === 1 ? "" : "s")
            : "";
      /* Who was added vs previous set (for clearer copy) */
      const oldSet = new Set(
        (old && Array.isArray(old.stewIds) ? old.stewIds : []).map(String).filter(Boolean)
      );
      const addedIds = (Array.isArray(asg.stewIds) ? asg.stewIds : [])
        .map(String)
        .filter((id) => id && !oldSet.has(id));
      const addedNames = stewNamesFromRoster(stews, addedIds);
      let title;
      let body;
      if (!n) {
        title = "Stews cleared";
        body = `${label} · no stew (by ${who})`;
      } else if (addedNames.length && oldIds) {
        title = addedNames.length === 1 ? "Stew assigned" : "Stews assigned";
        body = `${label} · ${addedNames.join(", ")} on board (by ${who})`;
        if (names.length > addedNames.length) {
          body = `${label} · now ${whoList} (added ${addedNames.join(", ")}) (by ${who})`;
        }
      } else {
        title = n === 1 ? "Stew assigned" : "Stews assigned";
        body = `${label} · ${whoList} (by ${who})`;
      }
      notices.push({
        title,
        body,
        tag: `stew-asg-${key}-${newIds || "none"}`,
        url: "/tracker/",
        to: "team_and_captain",
      });
    }
  }

  return notices.slice(0, 12);
}

/**
 * Deliver notices to push subscribers. Returns { sent, failed, skipped }.
 * excludeEndpoint: skip this device (usually the editor of a save).
 * onlyDeviceId / onlyWho: restrict targets (push-test to this device).
 */
async function sendPushes(data, notices, opts) {
  opts = opts || {};
  const excludeEndpoint = opts.excludeEndpoint || "";
  const onlyDeviceId = opts.onlyDeviceId || "";
  const onlyWho = opts.onlyWho || "";
  if (!notices.length || !setupVapid()) return { sent: 0, failed: 0, skipped: 0 };
  if (!Array.isArray(data.pushSubs) || !data.pushSubs.length) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const keep = [];

  async function deliverOne(sub, n) {
    const payload = {
      title: n.title,
      body: n.body,
      tag: n.tag,
      url: n.url || "/tracker/",
    };
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      JSON.stringify(payload)
    );
  }

  /* Build work list, then run deliveries in parallel (caps hang on dead endpoints) */
  const jobs = [];
  for (const sub of data.pushSubs) {
    if (!sub || !sub.endpoint) continue;
    if (excludeEndpoint && sub.endpoint === excludeEndpoint) {
      keep.push(sub);
      skipped++;
      continue;
    }
    if (onlyDeviceId && String(sub.deviceId || "") !== String(onlyDeviceId)) {
      keep.push(sub);
      skipped++;
      continue;
    }
    if (onlyWho && String(sub.who || "") !== String(onlyWho) && !onlyDeviceId) {
      keep.push(sub);
      skipped++;
      continue;
    }
    const matching = notices.filter((n) => noticeMatchesSub(n, sub));
    if (!matching.length) {
      keep.push(sub);
      skipped++;
      continue;
    }
    jobs.push({ sub, matching });
  }

  const results = await Promise.all(
    jobs.map(async ({ sub, matching }) => {
      let dead = false;
      let localSent = 0;
      let localFailed = 0;
      for (const n of matching) {
        try {
          await deliverOne(sub, n);
          localSent++;
        } catch (err) {
          const code = err && (err.statusCode || err.status);
          if (code === 404 || code === 410) {
            dead = true;
            localFailed++;
            break;
          }
          localFailed++;
        }
      }
      return { sub, dead, localSent, localFailed };
    })
  );

  for (const r of results) {
    sent += r.localSent;
    failed += r.localFailed;
    if (!r.dead) keep.push(r.sub);
  }
  data.pushSubs = keep.slice(-SUB_CAP);
  return { sent, failed, skipped };
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  if (!process.env.TRACKER_PASSCODE) {
    return json({ error: "Server not configured: set the TRACKER_PASSCODE environment variable in Netlify." }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "bad json" }, 400);
  }

  const action = body.action;
  const who = (body.who || "Unknown").toString().slice(0, 60);
  const role = roleOf(who, body.role);
  const pass = req.headers.get("x-tracker-pass") || "";
  if (!passOk(pass, role)) return json({ error: "unauthorized" }, 401);
  const deviceId = (body.deviceId || "").toString().slice(0, 80);

  const ip =
    context.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "";
  const country =
    (context.geo && context.geo.country && context.geo.country.code) ||
    req.headers.get("x-country") ||
    "";
  const browser = parseBrowser(req.headers.get("user-agent"));
  const now = new Date().toISOString();

  const store = getStore("limitless-tracker");
  const data = await loadData(store);
  if (!Array.isArray(data.devices)) data.devices = [];
  if (!Array.isArray(data.log)) data.log = [];
  if (!Array.isArray(data.pushSubs)) data.pushSubs = [];
  if (!data.meta || typeof data.meta !== "object") data.meta = {};

  /* Wipe security log + devices once (after publish) so monitoring starts clean */
  const securityWiped = ensureSecurityScratch(data);

  function touchDevice() {
    if (!deviceId) return;
    let dev = data.devices.find((d) => d.id === deviceId);
    if (!dev) {
      dev = { id: deviceId, who, browser, ip, country, firstSeen: now, lastSeen: now, trusted: false };
      data.devices.push(dev);
      if (data.devices.length > DEVICE_CAP) data.devices = data.devices.slice(-DEVICE_CAP);
    } else {
      dev.who = who;
      dev.browser = browser;
      dev.ip = ip;
      dev.country = country;
      dev.lastSeen = now;
    }
  }
  function addLog(act) {
    data.log.push({ ts: now, who, action: act, deviceId, ip, country });
    if (data.log.length > LOG_CAP) data.log = data.log.slice(-LOG_CAP);
  }

  if (action === "load") {
    /*
     * Silent polls must stay cheap: do not rewrite the whole blob every 20s.
     * Only persist when seed/link/security/login actually changed data.
     */
    let dirty = false;
    if (securityWiped) {
      addLog("security log reset (start from scratch)");
      dirty = true;
    }
    if (!body.silent) {
      touchDevice();
      addLog("login");
      dirty = true;
    }
    /* Install real spreadsheet APA as first live records (once); link missing APA charges */
    if (ensureSheetApaSeed(data)) {
      addLog("seed sheet APA (Joel Freeland)");
      dirty = true;
    }
    if (ensureApaChargesLinked(data)) {
      addLog("link APA charges");
      dirty = true;
    }
    if (dirty) await saveData(store, data);

    const out = {
      role,
      devices: data.devices,
      log: data.log,
      pushEnabled: vapidConfigured(),
      vapidPublicKey: process.env.TRACKER_VAPID_PUBLIC_KEY || "",
    };
    /*
     * Payload by role. Captain always gets the full store (who-label is trusted).
     * Manager: commercial only. Team: roster snapshot only.
     * Never send empty [] for captain commercial — that wiped the UI after role bugs.
     */
    const captain = role === "captain" || isCaptain(who);
    const commercial = captain || role === "manager" || isManager(who);
    const roster = captain || role === "team";

    if (commercial) {
      out.charters = Array.isArray(data.charters) ? data.charters : [];
      out.leads = Array.isArray(data.leads) ? data.leads : [];
    } else {
      out.charters = [];
      out.leads = [];
    }
    if (captain) {
      out.apa = Array.isArray(data.apa) ? data.apa : [];
      out.diesel = Array.isArray(data.diesel) ? data.diesel : [];
      out.expenses = Array.isArray(data.expenses) ? data.expenses : [];
      out.expPetty = Array.isArray(data.expPetty) ? data.expPetty : [];
    } else {
      out.apa = null;
      out.diesel = null;
      out.expenses = null;
      out.expPetty = null;
    }
    if (roster) {
      out.stews = Array.isArray(data.stews) ? data.stews : [];
      out.stewAssign = Array.isArray(data.stewAssign) ? data.stewAssign : [];
      out.stewCalendar = Array.isArray(data.stewCalendar) ? data.stewCalendar : [];
      out.stewCalendarAt = (data.meta && data.meta.stewCalendarAt) || "";
      out.stewCalendarBy = (data.meta && data.meta.stewCalendarBy) || "";
    } else {
      out.stews = null;
      out.stewAssign = null;
      out.stewCalendar = null;
      out.stewCalendarAt = "";
      out.stewCalendarBy = "";
    }
    /* App-owned website calendar status (captain only — seed/activate in Ops) */
    if (captain) {
      out.siteCalendar = siteCalendarSummary(data.siteCalendar);
    } else {
      out.siteCalendar = null;
    }
    return json(out);
  }

  if (action === "save") {
    const coll = body.collection;
    if (
      coll !== "charters" &&
      coll !== "leads" &&
      coll !== "apa" &&
      coll !== "diesel" &&
      coll !== "stews" &&
      coll !== "stewAssign" &&
      coll !== "stewCalendar" &&
      coll !== "expenses" &&
      coll !== "expPetty"
    ) {
      return json({ error: "bad collection" }, 400);
    }
    if ((coll === "charters" || coll === "leads") && !canCommercial(who, role)) {
      return json({ error: "Charges and leads are captain/manager only" }, 403);
    }
    if ((coll === "apa" || coll === "diesel") && !canOps(who, role)) {
      return json({ error: coll === "diesel" ? "Diesel is captain only" : "APA is captain only" }, 403);
    }
    /* Live ICS snapshot: captain only. Team assigns stews but cannot refresh the feed. */
    if (coll === "stewCalendar" && !(role === "captain" || isCaptain(who))) {
      return json({ error: "Calendar refresh is captain-only" }, 403);
    }
    if ((coll === "stews" || coll === "stewAssign") && !canRoster(who, role)) {
      return json({ error: "Roster is captain/team only" }, 403);
    }
    if ((coll === "expenses" || coll === "expPetty") && !(role === "captain" || isCaptain(who))) {
      return json({ error: "Expenses are captain-only" }, 403);
    }
    const prev = Array.isArray(data[coll]) ? data[coll] : [];
    let next = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    /* Protect free cash black: never let a save overwrite good cash with white net (€1.652,89) */
    if (coll === "leads") {
      next = protectLeadFreeCash(prev, next);
    }
    const notices =
      coll === "apa" || coll === "diesel" || coll === "stewCalendar"
        ? []
        : buildNotices(coll, prev, next, who, data);
    data[coll] = next;
    if (coll === "leads") {
      /* Public website calendar + team stew roster from leads */
      rebuildSiteCalendarFromLeads(data, who, now);
      data.stewCalendar = stewCalendarRowsFromLeads(data.leads);
      if (!data.meta || typeof data.meta !== "object") data.meta = {};
      data.meta.stewCalendarAt = now;
      data.meta.stewCalendarBy = who || "Lead save";
    }
    if (coll === "stewCalendar") {
      if (!data.meta || typeof data.meta !== "object") data.meta = {};
      data.meta.stewCalendarAt = now;
      data.meta.stewCalendarBy = who;
    }
    /* Charters Paid/Pending → re-link APA shortfall + book cash (black) as received */
    if (coll === "charters" || coll === "apa") {
      if (ensureApaChargesLinked(data)) addLog("sync APA after " + coll);
    }
    touchDevice();
    addLog("save " + coll + (notices.length ? " (+notify " + notices.length + ")" : ""));
    const pushResult = await sendPushes(data, notices, {
      excludeEndpoint: body.pushEndpoint || "",
    });
    await saveData(store, data);
    return json({
      ok: true,
      notified: notices.length,
      pushSent: pushResult.sent || 0,
    });
  }

  if (action === "trust") {
    const dev = data.devices.find((d) => d.id === (body.deviceId || ""));
    if (dev) dev.trusted = !!body.trusted;
    await saveData(store, data);
    return json({ ok: true });
  }

  if (action === "push-subscribe") {
    if (!vapidConfigured()) return json({ error: "Push not configured on server" }, 503);
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: "bad subscription" }, 400);
    }
    touchDevice();
    data.pushSubs = data.pushSubs.filter((s) => s.endpoint !== sub.endpoint);
    data.pushSubs.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      who,
      role,
      deviceId,
      browser,
      subscribedAt: now,
    });
    if (data.pushSubs.length > SUB_CAP) data.pushSubs = data.pushSubs.slice(-SUB_CAP);
    addLog("push subscribe");
    await saveData(store, data);
    return json({ ok: true, count: data.pushSubs.length });
  }

  if (action === "push-unsubscribe") {
    const endpoint = (body.endpoint || (body.subscription && body.subscription.endpoint) || "").toString();
    if (endpoint) data.pushSubs = data.pushSubs.filter((s) => s.endpoint !== endpoint);
    addLog("push unsubscribe");
    await saveData(store, data);
    return json({ ok: true });
  }

  if (action === "push-test") {
    if (!vapidConfigured()) return json({ error: "Push not configured on server" }, 503);
    touchDevice();
    const notice = {
      title: "Limitless Tracker",
      body: "Test notification — push is working (" + who + ")",
      tag: "tracker-test-" + Date.now(),
      url: "/tracker/",
      to: "all",
    };
    /* Prefer this device's subscription; fall back to same who, then everyone */
    let result = { sent: 0, failed: 0, skipped: 0 };
    if (deviceId) {
      result = await sendPushes(data, [notice], { onlyDeviceId: deviceId });
    }
    if (!(result.sent > 0) && who) {
      result = await sendPushes(data, [notice], { onlyWho: who });
    }
    if (!(result.sent > 0)) {
      result = await sendPushes(data, [notice], {});
    }
    addLog(
      "push test sent=" +
        (result.sent || 0) +
        " failed=" +
        (result.failed || 0) +
        " subs=" +
        (data.pushSubs || []).length
    );
    await saveData(store, data);
    if (!(result.sent > 0)) {
      return json(
        {
          ok: false,
          error: "No active push subscription for this device. Tap Enable alerts first.",
          sent: 0,
          subscribed: (data.pushSubs || []).length,
        },
        400
      );
    }
    return json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      subscribed: (data.pushSubs || []).length,
    });
  }

  /*
   * App-owned public website calendar (Netlify Blobs).
   * Seed from manager ICS without activating — production stays on live ICS
   * until captain sets active=true (or AVAILABILITY_SOURCE=blob).
   */
  /*
   * Fresh calendar → leads only (no historical bulk import).
   * First call baselines current ICS uids; later calls create pending-source leads.
   */
  if (action === "syncNewIcsLeads" || action === "importIcsLeads") {
    if (!canCommercial(who, role)) {
      return json({ error: "Calendar → leads sync is captain/manager only" }, 403);
    }
    touchDevice();
    let text;
    try {
      text = await fetchManagerIcsText();
    } catch (e) {
      return json(
        { ok: false, error: e && e.message ? e.message : String(e), code: e && e.code },
        400
      );
    }
    const parsed = parseIcs(text);
    const stats = syncNewIcsLeads(data, parsed.events, who, now);
    rebuildSiteCalendarFromLeads(data, who, now);
    /* Publish stew roster snapshot from leads so team list stays in sync */
    data.stewCalendar = stewCalendarRowsFromLeads(data.leads);
    if (!data.meta || typeof data.meta !== "object") data.meta = {};
    data.meta.stewCalendarAt = now;
    data.meta.stewCalendarBy = who || "Calendar sync";
    addLog(
      (stats.baselined ? "ICS lead baseline keys=" : "ICS fresh leads created=") +
        (stats.baselined ? stats.knownCount : stats.created) +
        " · site cal from leads"
    );
    let pushResult = { sent: 0 };
    if (stats.created > 0 && !stats.baselined) {
      const notices = [
        {
          title: "New calendar charter",
          body:
            stats.created === 1
              ? "1 new trip needs source assignment (Captain / Click&Boat / Owner)"
              : stats.created + " new trips need source assignment",
          tag: "ics-pending-" + Date.now(),
          url: "/tracker/?tab=leads&pending=1",
          to: "commercial",
        },
      ];
      pushResult = await sendPushes(data, notices, {});
      addLog("push new ICS leads sent=" + (pushResult.sent || 0));
    }
    await saveData(store, data);
    return json({
      ok: true,
      stats: stats,
      dateMoves: stats.dateMoves || [],
      leads: data.leads,
      siteCalendar: siteCalendarSummary(data.siteCalendar),
      pushSent: pushResult.sent || 0,
      icsLeadBaselineAt: (data.meta && data.meta.icsLeadBaselineAt) || "",
      icsLeadLastSyncAt: (data.meta && data.meta.icsLeadLastSyncAt) || "",
    });
  }

  if (action === "applyIcsDateMoves") {
    if (!canCommercial(who, role)) {
      return json({ error: "Date moves are captain/manager only" }, 403);
    }
    touchDevice();
    const dec = applyIcsDateMoveDecisions(
      data,
      body.accepted || body.accept || [],
      body.rejected || body.reject || [],
      who,
      now
    );
    rebuildSiteCalendarFromLeads(data, who, now);
    data.stewCalendar = stewCalendarRowsFromLeads(data.leads);
    if (!data.meta || typeof data.meta !== "object") data.meta = {};
    data.meta.stewCalendarAt = now;
    data.meta.stewCalendarBy = who || "Date move";
    addLog(
      "ICS date moves applied=" + dec.applied + " dismissed=" + dec.dismissed
    );
    await saveData(store, data);
    return json({
      ok: true,
      stats: dec,
      leads: data.leads,
      siteCalendar: siteCalendarSummary(data.siteCalendar),
    });
  }

  if (
    action === "getSiteCalendar" ||
    action === "seedSiteCalendar" ||
    action === "rebuildSiteCalendar" ||
    action === "setSiteCalendarActive"
  ) {
    if (!(role === "captain" || isCaptain(who))) {
      return json({ error: "Site calendar is captain-only" }, 403);
    }
    touchDevice();

    if (action === "getSiteCalendar") {
      return json({
        ok: true,
        siteCalendar: siteCalendarSummary(data.siteCalendar),
        preview: data.siteCalendar
          ? siteCalendarPublicPayload(data.siteCalendar)
          : null,
      });
    }

    /* Rebuild from leads (SOT). seedSiteCalendar alias kept for old UI. */
    if (action === "seedSiteCalendar" || action === "rebuildSiteCalendar") {
      rebuildSiteCalendarFromLeads(data, who, now);
      addLog(
        "rebuild site calendar from leads booked=" +
          (data.siteCalendar.booked || []).length +
          " hold=" +
          (data.siteCalendar.tentative || []).length
      );
      await saveData(store, data);
      return json({
        ok: true,
        siteCalendar: siteCalendarSummary(data.siteCalendar),
        preview: siteCalendarPublicPayload(data.siteCalendar),
      });
    }

    if (action === "setSiteCalendarActive") {
      /* Ensure calendar exists from leads before toggle */
      if (!data.siteCalendar || typeof data.siteCalendar !== "object") {
        rebuildSiteCalendarFromLeads(data, who, now);
      }
      const want = !!body.active;
      data.siteCalendar.active = want;
      data.siteCalendar.updatedAt = now;
      data.siteCalendar.updatedBy = who;
      data.siteCalendar.generatedAt = now;
      if (want) rebuildSiteCalendarFromLeads(data, who, now);
      addLog(
        want
          ? "activate site calendar (website uses leads)"
          : "deactivate site calendar (website falls back to ICS)"
      );
      await saveData(store, data);
      return json({
        ok: true,
        siteCalendar: siteCalendarSummary(data.siteCalendar),
      });
    }
  }

  return json({ error: "unknown action" }, 400);
};
