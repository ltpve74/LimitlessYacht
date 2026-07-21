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
  if (!data.apa.some((t) => t && t.id === SHEET_TRIP_ID)) {
    data.apa.unshift(sheetJoelApaTrip());
    dirty = true;
  } else {
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
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const name = norm(t.guest);
  return (data.charters || []).filter((c) => {
    if (!c) return false;
    if (c.apaTripId && c.apaTripId === t.id) return true;
    if (t.chargeId && c.id === t.chargeId) return true;
    if (c.kind === "apa" && name && norm(c.client) === name) return true;
    return false;
  });
}

/** Paid shortfall charges count toward pot (mirrors client). */
function tripApaPaidCovered(data, t) {
  let s = 0;
  for (const c of tripLinkedCharges(data, t)) {
    if (chargeIsPaid(c)) s += Number(c.amount) || 0;
  }
  return Math.round(s * 100) / 100;
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
    if (Number(r.amount) > 0 && !(Number(r.engineL) || Number(r.genHrs))) {
      dCost += Number(r.amount);
      continue;
    }
    const eng = Number(r.engineL) || 0;
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
  if (!Array.isArray(data.apa) || !data.apa.length) return false;
  if (!Array.isArray(data.charters)) data.charters = [];
  let dirty = false;

  for (const t of data.apa) {
    if (!t || !String(t.guest || "").trim()) continue;
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
    const pct = 21;
    const gross = over;
    const net = pct > 0 ? gross / (1 + pct / 100) : gross;
    const vat = gross - net;
    const note =
      (t.dates ? "APA · " + t.dates + ". " : "") +
      "APA shortfall (balance negative) — synced from APA ledger";

    if (ch) {
      if (t.chargeId !== ch.id) {
        t.chargeId = ch.id;
        dirty = true;
      }
      if (
        Math.abs((Number(ch.amount) || 0) - gross) > 0.005 ||
        ch.kind !== "apa" ||
        ch.apaTripId !== t.id
      ) {
        ch.client = t.guest;
        ch.amount = gross;
        ch.net = net;
        ch.vat = vat;
        ch.vatPct = pct;
        ch.vatMode = "include";
        ch.kind = "apa";
        ch.apaTripId = t.id;
        if (ch.payStatus !== "Paid") ch.payStatus = "Pending";
        if (ch.invStatus !== "Issued") {
          ch.invStatus = "Not issued";
          ch.status = ch.payStatus || "Pending";
        }
        if (!ch.notes || /^APA/i.test(ch.notes) || /synced from APA|shortfall|pot \(sent/i.test(ch.notes)) {
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
      date: t.id === SHEET_TRIP_ID ? "2026-07-17" : new Date().toISOString().slice(0, 10),
      client: t.guest,
      amount: gross,
      net,
      vat,
      vatPct: pct,
      vatMode: "include",
      payStatus: "Pending",
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
  return d || { charters: [], leads: [], apa: [], diesel: [], devices: [], log: [], pushSubs: [], meta: {} };
}
async function saveData(store, data) {
  await store.setJSON(BLOB_KEY, data);
}

function chargeInv(r) {
  if (r.invStatus) return r.invStatus;
  if (r.status === "Invoiced") return "Issued";
  if (r.status === "Paid" && r.inv) return "Issued";
  if (r.status === "Pending") return "Not issued";
  return r.inv ? "Issued" : "Not issued";
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
        if (lead[field] === "Requested" && old[field] !== "Requested") {
          notices.push({
            title: "Invoice requested",
            body: `${label} · ${name} (by ${who})`,
            tag: `lead-req-${lead.id}-${field}`,
            url: "/tracker/",
          });
        }
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
          title: isApa ? "APA invoice request" : "New card charge",
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
    touchDevice();
    addLog("login");
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
    /* APA + vessel diesel are captain-only — never sent to manager / other roles */
    if (isCaptain(who)) {
      out.apa = Array.isArray(data.apa) ? data.apa : [];
      out.diesel = Array.isArray(data.diesel) ? data.diesel : [];
    } else {
      out.apa = null;
      out.diesel = null;
    }
    return json(out);
  }

  if (action === "save") {
    const coll = body.collection;
    if (coll !== "charters" && coll !== "leads" && coll !== "apa" && coll !== "diesel") {
      return json({ error: "bad collection" }, 400);
    }
    if ((coll === "apa" || coll === "diesel") && !isCaptain(who)) {
      return json({ error: coll === "diesel" ? "Diesel is captain-only" : "APA is captain-only" }, 403);
    }
    const prev = Array.isArray(data[coll]) ? data[coll] : [];
    const next = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const notices = coll === "apa" || coll === "diesel" ? [] : buildNotices(coll, prev, next, who);
    data[coll] = next;
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
