#!/usr/bin/env node
/**
 * Tracker SERVER tests — real handler from netlify/functions/tracker.mjs
 * driven against an in-memory blob store (injected via the
 * globalThis.__TRACKER_TEST_STORE__ hook). No network, no Netlify.
 *
 * Covers:
 *   - auth (401 on bad passcode)
 *   - save/load roundtrip + merge-preserve within a collection
 *   - snapshot action (captain-only, live blob untouched)
 *   - push ordering: save persists BEFORE any push is sent (Phase 1 fix)
 *   - dead-sub cleanup is persisted (conditional second save)
 *   - KNOWN-FAIL: cross-collection write race (P1) — reproduces the
 *     whole-blob clobber; expected to fail until the Phase 2 split-blob
 *     lands, at which point it must be promoted to a hard assert.
 *
 * Run: node scripts/test-tracker-server.mjs
 */
import webpush from "web-push";

/* ── env must exist before the handler runs (it reads env per request) ── */
process.env.TRACKER_PASSCODE = "test-captain-pass";
process.env.TRACKER_MANAGER_PASSCODE = "test-manager-pass";
process.env.TRACKER_TEAM_PASSCODE = "test-team-pass";
const vapid = webpush.generateVAPIDKeys();
process.env.TRACKER_VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.TRACKER_VAPID_PRIVATE_KEY = vapid.privateKey;

const PASS = {
  captain: "test-captain-pass",
  manager: "test-manager-pass",
  team: "test-team-pass",
};

/* ── observable event log: every blob write + every push delivery ── */
const events = [];

/* ── in-memory Netlify Blobs stand-in ── */
function makeStore() {
  const m = new Map();
  return {
    _map: m,
    async get(key) {
      const v = m.get(key);
      return v === undefined ? null : structuredClone(v);
    },
    async setJSON(key, val) {
      m.set(key, structuredClone(val));
      events.push({ type: "save", key });
    },
    async delete(key) {
      m.delete(key);
    },
  };
}

const store = makeStore();
globalThis.__TRACKER_TEST_STORE__ = store;

/* ── stub push delivery: record, and 410 any endpoint containing "dead" ── */
webpush.sendNotification = async (sub) => {
  events.push({ type: "push", endpoint: sub && sub.endpoint });
  if (String(sub && sub.endpoint).includes("dead")) {
    const e = new Error("Gone");
    e.statusCode = 410;
    throw e;
  }
};

const handler = (await import("../netlify/functions/tracker.mjs")).default;

async function api(body, opts = {}) {
  const role = opts.role || "captain";
  const who = opts.who || (role === "captain" ? "Captain" : role === "manager" ? "Manager" : "Luara");
  const req = new Request("https://test.local/api/tracker", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tracker-pass": opts.pass != null ? opts.pass : PASS[role] || PASS.captain,
      "user-agent": "tracker-server-test/1.0",
    },
    body: JSON.stringify(Object.assign({ who, role, deviceId: opts.deviceId || "dev-" + role }, body)),
  });
  const res = await handler(req, { ip: "127.0.0.1", geo: { country: { code: "ES" } } });
  return { status: res.status, data: await res.json() };
}

/* ── tiny test framework ── */
let passed = 0;
let failed = 0;
const knownFails = [];
const xpasses = [];

function check(cond, label) {
  if (!cond) throw new Error("check failed: " + label);
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ok   " + name);
  } catch (e) {
    failed++;
    console.log("  FAIL " + name + " — " + (e && e.message));
  }
}
/** Expected to fail until Phase 2 (split-blob). Suite stays green either way. */
async function xfail(name, fn) {
  try {
    await fn();
    xpasses.push(name);
    console.log("  XPASS " + name + " — bug appears FIXED; promote to hard assert");
  } catch (e) {
    knownFails.push(name);
    console.log("  xfail " + name + " (known, pre-split): " + (e && e.message));
  }
}
function seedData(patch) {
  const base = {
    charters: [], leads: [], apa: [], diesel: [], stews: [], stewAssign: [],
    stewCalendar: [], siteCalendar: null, expenses: [], expPetty: [],
    devices: [], log: [], pushSubs: [], meta: {},
  };
  store._map.set("data", Object.assign(base, patch || {}));
}
function liveData() {
  return store._map.get("data");
}

console.log("\ntracker server tests (in-memory store)\n");

/* ── 1. auth ── */
await test("bad passcode → 401", async () => {
  const r = await api({ action: "load" }, { pass: "wrong" });
  check(r.status === 401, "status " + r.status);
});

/* ── 2. save/load roundtrip ── */
await test("captain saves expenses, load returns them", async () => {
  seedData();
  const row = { id: "e1", date: "2026-09-01", amount: 42, vendor: "Test", category: "Food" };
  const s = await api({ action: "save", collection: "expenses", rows: [row] });
  check(s.status === 200 && s.data.ok, "save ok");
  const l = await api({ action: "load" });
  check(
    (l.data.expenses || []).some((e) => e && e.id === "e1" && e.amount === 42),
    "load has e1"
  );
});

/* ── 3. same-collection merge preserves server-only rows ── */
await test("merge preserves rows the client did not send", async () => {
  seedData({ expenses: [{ id: "keep", amount: 1 }, { id: "gone", amount: 2 }] });
  const s = await api({
    action: "save",
    collection: "expenses",
    rows: [{ id: "keep", amount: 99 }],
  });
  check(s.data.ok, "save ok");
  const ids = (liveData().expenses || []).map((e) => e.id).sort();
  check(ids.join(",") === "gone,keep", "both rows present, got " + ids.join(","));
  check(
    liveData().expenses.find((e) => e.id === "keep").amount === 99,
    "client edit applied"
  );
});

/* ── 4. snapshot action ── */
await test("snapshot: captain gets archive copy, live blob untouched", async () => {
  seedData({ expenses: [{ id: "e1", amount: 5 }], leads: [{ id: "l1" }] });
  const before = structuredClone(liveData());
  const r = await api({ action: "snapshot" });
  check(r.status === 200 && r.data.ok, "snapshot ok");
  check(/^archive\/data-/.test(r.data.key || ""), "archive key, got " + r.data.key);
  check(r.data.counts && r.data.counts.expenses === 1 && r.data.counts.leads === 1, "counts");
  const snap = store._map.get(r.data.key);
  check(snap && snap.expenses.length === 1 && snap.leads.length === 1, "archive content");
  check(
    JSON.stringify(liveData()) === JSON.stringify(before),
    "live blob byte-identical"
  );
});
await test("snapshot: team role → 403", async () => {
  seedData();
  const r = await api({ action: "snapshot" }, { role: "team" });
  check(r.status === 403, "status " + r.status);
});

/* ── 5. push ordering: persist BEFORE notify ── */
await test("save persists to blob before any push is sent", async () => {
  seedData();
  events.length = 0;
  const sub = {
    endpoint: "https://push.example/sub/live1",
    keys: { p256dh: "k", auth: "a" },
  };
  const subRes = await api({ action: "push-subscribe", subscription: sub });
  check(subRes.data.ok, "subscribe ok");
  events.length = 0; /* only observe the save that follows */
  const s = await api({
    action: "save",
    collection: "expenses",
    rows: [{ id: "e1", amount: 10 }],
  });
  check(s.data.ok, "save ok");
  const firstSave = events.findIndex((e) => e.type === "save" && e.key === "data");
  const firstPush = events.findIndex((e) => e.type === "push");
  check(firstSave >= 0, "blob write happened");
  check(firstPush >= 0, "push happened (silent sync notice)");
  check(firstSave < firstPush, "save (idx " + firstSave + ") before push (idx " + firstPush + ")");
});

/* ── 6. dead-sub cleanup is persisted ── */
await test("dead push sub is pruned AND the prune is saved", async () => {
  seedData();
  await api({
    action: "push-subscribe",
    subscription: { endpoint: "https://push.example/dead/1", keys: { p256dh: "k", auth: "a" } },
  });
  const s = await api({
    action: "save",
    collection: "expenses",
    rows: [{ id: "e1", amount: 10 }],
  });
  check(s.data.ok, "save ok");
  const subs = (liveData().pushSubs || []).map((x) => x.endpoint);
  check(!subs.some((e) => e.includes("dead")), "dead sub gone from PERSISTED blob");
});

/* ── 7. KNOWN-FAIL until Phase 2: cross-collection write race ── */
await xfail("concurrent saves of different collections both survive", async () => {
  seedData({
    expenses: [{ id: "e1", amount: 1 }],
    stewAssign: [{ id: "a1", eventKey: "ev1" }],
  });
  /* Force the classic interleave: both requests load, THEN both write. */
  const origGet = store.get.bind(store);
  const origSet = store.setJSON.bind(store);
  let gets = 0;
  let saves = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  store.get = async (key, opts) => {
    const v = await origGet(key, opts);
    if (key === "data") {
      gets++;
      if (gets === 2) release();
    }
    return v;
  };
  store.setJSON = async (key, val) => {
    if (key === "data") {
      saves++;
      if (saves === 1) await gate; /* first writer waits for the second load */
    }
    return origSet(key, val);
  };
  try {
    const [rA, rB] = await Promise.all([
      api({
        action: "save",
        collection: "expenses",
        rows: [{ id: "e1", amount: 1 }, { id: "e2", amount: 2 }],
      }),
      api(
        {
          action: "save",
          collection: "stewAssign",
          rows: [
            { id: "a1", eventKey: "ev1" },
            { id: "a2", eventKey: "ev2" },
          ],
        },
        { role: "team" }
      ),
    ]);
    check(rA.data.ok && rB.data.ok, "both saves ok");
  } finally {
    store.get = origGet;
    store.setJSON = origSet;
  }
  const d = liveData();
  check(
    (d.expenses || []).some((e) => e.id === "e2"),
    "captain's expenses row e2 survived"
  );
  check(
    (d.stewAssign || []).some((a) => a.id === "a2"),
    "team's stewAssign row a2 survived (clobbered by whole-blob write today)"
  );
});

/* ── summary ── */
console.log(
  "\n" +
    passed +
    " passed, " +
    failed +
    " failed, " +
    knownFails.length +
    " known-fail (pre-split), " +
    xpasses.length +
    " xpass"
);
if (xpasses.length) {
  console.log("NOTE: promote xpass test(s) to hard asserts — the race is fixed.");
}
if (failed) {
  process.exit(1);
}
console.log("PASSED  tracker server checks (known-fail P1 race expected until split-blob)\n");
