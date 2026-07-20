// Limitless Tracker — Netlify Function (v2) + Netlify Blobs storage
// Endpoint: /.netlify/functions/tracker
// Requires environment variable TRACKER_PASSCODE (set in Netlify → Site settings → Environment variables)

import { getStore } from "@netlify/blobs";

const BLOB_KEY = "data";
const LOG_CAP = 500;
const DEVICE_CAP = 200;

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

async function loadData(store) {
  const d = await store.get(BLOB_KEY, { type: "json", consistency: "strong" });
  return d || { charters: [], leads: [], devices: [], log: [] };
}
async function saveData(store, data) {
  await store.setJSON(BLOB_KEY, data);
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
  try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400); }

  const action = body.action;
  const who = (body.who || "Unknown").toString().slice(0, 60);
  const deviceId = (body.deviceId || "").toString().slice(0, 80);

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "";
  const country = (context.geo && context.geo.country && context.geo.country.code) || req.headers.get("x-country") || "";
  const browser = parseBrowser(req.headers.get("user-agent"));
  const now = new Date().toISOString();

  const store = getStore("limitless-tracker");
  const data = await loadData(store);
  if (!Array.isArray(data.devices)) data.devices = [];
  if (!Array.isArray(data.log)) data.log = [];

  function touchDevice() {
    if (!deviceId) return;
    let dev = data.devices.find((d) => d.id === deviceId);
    if (!dev) {
      dev = { id: deviceId, who, browser, ip, country, firstSeen: now, lastSeen: now, trusted: false };
      data.devices.push(dev);
      if (data.devices.length > DEVICE_CAP) data.devices = data.devices.slice(-DEVICE_CAP);
    } else {
      dev.who = who; dev.browser = browser; dev.ip = ip; dev.country = country; dev.lastSeen = now;
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
    return json({ charters: data.charters, leads: data.leads, devices: data.devices, log: data.log });
  }

  if (action === "save") {
    const coll = body.collection;
    if (coll !== "charters" && coll !== "leads") return json({ error: "bad collection" }, 400);
    data[coll] = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    touchDevice();
    addLog("save " + coll);
    await saveData(store, data);
    return json({ ok: true });
  }

  if (action === "trust") {
    const dev = data.devices.find((d) => d.id === (body.deviceId || ""));
    if (dev) dev.trusted = !!body.trusted;
    await saveData(store, data);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
};
