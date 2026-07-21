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

async function loadData(store) {
  const d = await store.get(BLOB_KEY, { type: "json", consistency: "strong" });
  return d || { charters: [], leads: [], devices: [], log: [], pushSubs: [] };
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
      if (!old) {
        notices.push({
          title: "New card charge",
          body: `${client} · €${Number(ch.amount) || 0} (by ${who})`,
          tag: `ch-new-${ch.id}`,
          url: "/tracker/",
        });
        continue;
      }
      const oldInv = chargeInv(old);
      if (inv === "Issued" && oldInv !== "Issued") {
        notices.push({
          title: "Charge invoice issued",
          body: `${client}${ch.inv ? " #" + ch.inv : ""}`,
          tag: `ch-iss-${ch.id}`,
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
    await saveData(store, data);
    return json({
      charters: data.charters,
      leads: data.leads,
      devices: data.devices,
      log: data.log,
      pushEnabled: vapidConfigured(),
      vapidPublicKey: process.env.TRACKER_VAPID_PUBLIC_KEY || "",
    });
  }

  if (action === "save") {
    const coll = body.collection;
    if (coll !== "charters" && coll !== "leads") return json({ error: "bad collection" }, 400);
    const prev = Array.isArray(data[coll]) ? data[coll] : [];
    const next = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    const notices = buildNotices(coll, prev, next, who);
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
