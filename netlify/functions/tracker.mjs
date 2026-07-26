// Limitless Tracker — Netlify Function (v2) + Netlify Blobs storage
// Endpoint: /.netlify/functions/tracker
// Env: TRACKER_PASSCODE (required)
//      TRACKER_VAPID_PUBLIC_KEY + TRACKER_VAPID_PRIVATE_KEY (for push notifications)
//      TRACKER_VAPID_SUBJECT optional, e.g. mailto:you@example.com

import { getStore } from "@netlify/blobs";
import webpush from "web-push";

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
/** Ops (APA + vessel diesel): captain only. Manager uses charges/leads. */
function canOps(who) {
  return isCaptain(who);
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
      expenses: [],
      expPetty: [],
      devices: [],
      log: [],
      pushSubs: [],
      meta: {},
    }
  );
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

/** Build human notifications from a collection save. */
function buildNotices(coll, prevRows, nextRows, who) {
  const prev = Array.isArray(prevRows) ? prevRows : [];
  const next = Array.isArray(nextRows) ? nextRows : [];
  const byId = new Map(prev.map((r) => [r.id, r]));
  const notices = [];

  if (coll === "leads") {
    for (const lead of next) {
      const old = byId.get(lead.id) || {};
      const name = lead.name || "Lead";
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
          });
        }
        if (lead[field] === "Paid" && old[field] !== "Paid") {
          notices.push({
            title: "Invoice paid",
            body: `${label} · ${name}`,
            tag: `lead-paid-${lead.id}-${field}`,
            url: "/tracker/",
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
        });
      }
    }
  }

  return notices.slice(0, 8);
}

async function sendPushes(data, notices, excludeEndpoint) {
  if (!notices.length || !setupVapid()) return;
  if (!Array.isArray(data.pushSubs) || !data.pushSubs.length) return;

  const keep = [];
  for (const sub of data.pushSubs) {
    if (!sub || !sub.endpoint) continue;
    if (excludeEndpoint && sub.endpoint === excludeEndpoint) {
      keep.push(sub);
      continue;
    }
    let dead = false;
    for (const n of notices) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(n)
        );
      } catch (err) {
        const code = err && (err.statusCode || err.status);
        if (code === 404 || code === 410) {
          dead = true;
          break;
        }
      }
    }
    if (!dead) keep.push(sub);
  }
  data.pushSubs = keep.slice(-SUB_CAP);
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const expected = process.env.TRACKER_PASSCODE;
  if (!expected) {
    return json({ error: "Server not configured: set the TRACKER_PASSCODE environment variable in Netlify." }, 500);
  }
  const pass = req.headers.get("x-tracker-pass") || "";
  if (pass !== expected) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "bad json" }, 400);
  }

  const action = body.action;
  const who = (body.who || "Unknown").toString().slice(0, 60);
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
    if (securityWiped) addLog("security log reset (start from scratch)");
    touchDevice();
    /* Polling / auto-open uses silent — don't spam the security log as "login" */
    if (!body.silent) addLog("login");
    /* Install real spreadsheet APA as first live records (once); link missing APA charges */
    if (ensureSheetApaSeed(data)) addLog("seed sheet APA (Joel Freeland)");
    if (ensureApaChargesLinked(data)) addLog("link APA charges");
    await saveData(store, data);
    const out = {
      charters: data.charters,
      leads: data.leads,
      devices: data.devices,
      log: data.log,
      pushEnabled: vapidConfigured(),
      vapidPublicKey: process.env.TRACKER_VAPID_PUBLIC_KEY || "",
    };
    /* APA + vessel diesel: captain and manager; not for Other / guests */
    if (canOps(who)) {
      out.apa = Array.isArray(data.apa) ? data.apa : [];
      out.diesel = Array.isArray(data.diesel) ? data.diesel : [];
    } else {
      out.apa = null;
      out.diesel = null;
    }
    /* Stew roster + assignments + vessel expenses: captain only (not manager) */
    if (isCaptain(who)) {
      out.stews = Array.isArray(data.stews) ? data.stews : [];
      out.stewAssign = Array.isArray(data.stewAssign) ? data.stewAssign : [];
      out.expenses = Array.isArray(data.expenses) ? data.expenses : [];
      out.expPetty = Array.isArray(data.expPetty) ? data.expPetty : [];
    } else {
      out.stews = null;
      out.stewAssign = null;
      out.expenses = null;
      out.expPetty = null;
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
      coll !== "expenses" &&
      coll !== "expPetty"
    ) {
      return json({ error: "bad collection" }, 400);
    }
    if ((coll === "apa" || coll === "diesel") && !canOps(who)) {
      return json({ error: coll === "diesel" ? "Diesel is captain/manager only" : "APA is captain/manager only" }, 403);
    }
    if ((coll === "stews" || coll === "stewAssign" || coll === "expenses" || coll === "expPetty") && !isCaptain(who)) {
      return json({ error: "Stews / expenses are captain-only" }, 403);
    }
    const prev = Array.isArray(data[coll]) ? data[coll] : [];
    let next = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    /* Protect free cash black: never let a save overwrite good cash with white net (€1.652,89) */
    if (coll === "leads") {
      next = protectLeadFreeCash(prev, next);
    }
    const notices = coll === "apa" || coll === "diesel" ? [] : buildNotices(coll, prev, next, who);
    data[coll] = next;
    /* Charters Paid/Pending → re-link APA shortfall + book cash (black) as received */
    if (coll === "charters" || coll === "apa") {
      if (ensureApaChargesLinked(data)) addLog("sync APA after " + coll);
    }
    touchDevice();
    addLog("save " + coll + (notices.length ? " (+notify " + notices.length + ")" : ""));
    await sendPushes(data, notices, body.pushEndpoint || "");
    await saveData(store, data);
    return json({ ok: true, notified: notices.length });
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
    addLog("push test");
    await sendPushes(
      data,
      [
        {
          title: "Limitless Tracker",
          body: "Test notification — push is working (" + who + ")",
          tag: "tracker-test",
          url: "/tracker/",
        },
      ],
      ""
    );
    await saveData(store, data);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
};
