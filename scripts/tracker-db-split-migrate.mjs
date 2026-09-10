#!/usr/bin/env node
/**
 * Split-blob migration driver (Phase 2) — backup-first, verify-after.
 *
 *   TRACKER_PASSCODE=… node scripts/tracker-db-split-migrate.mjs
 *   TRACKER_PASSCODE=… node scripts/tracker-db-split-migrate.mjs --rollback
 *
 * Default run:
 *   1. Local backup (tracker-db-backup) + server archive snapshot.
 *   2. Pre-migration load (collections remembered for post-verify).
 *   3. action:"migrateSplit" — server copies monolith → coll/* + sys/*,
 *      verifies byte-for-byte, writes the sys/migration marker.
 *   4. Post-migration load — every collection deep-compared against step 2.
 *
 * The monolith is never modified. --rollback deletes the marker (monolith
 * mode resumes; saves made in split mode are NOT carried back).
 *
 * The same migration is available passcode-free to the captain in the
 * tracker UI: Ops → Utilities → Storage engine → Run split migration.
 */
import { loadLive, backupLive, trackerApi } from "./lib/tracker-db-io.mjs";

const PASS = process.env.TRACKER_PASSCODE || "";
const ROLLBACK = process.argv.includes("--rollback");

if (!PASS) {
  console.error("Set TRACKER_PASSCODE (captain). No passcode → refuse.");
  process.exit(2);
}

const COLLS = [
  "charters", "leads", "apa", "diesel", "stews", "stewAssign",
  "stewCalendar", "expenses", "expPetty",
];

function collCounts(d) {
  const c = {};
  COLLS.forEach((n) => {
    c[n] = Array.isArray(d && d[n]) ? d[n].length : 0;
  });
  return c;
}

function diffCollections(before, after) {
  const bad = [];
  COLLS.forEach((n) => {
    const a = JSON.stringify(Array.isArray(before[n]) ? before[n] : []);
    const b = JSON.stringify(Array.isArray(after[n]) ? after[n] : []);
    if (a !== b) bad.push(n);
  });
  return bad;
}

async function main() {
  if (ROLLBACK) {
    console.log("Rolling back split mode (deleting sys/migration marker)…");
    const r = await trackerApi({ action: "splitRollback" });
    console.log("OK", JSON.stringify(r));
    console.log(
      "NOTE: saves made while in split mode live only in coll/* keys and were NOT carried back."
    );
    return;
  }

  console.log("=== 1/4 backups ===");
  const { backup } = await backupLive("pre-split-migration");
  console.log("local backup:", backup.dir);
  const snap = await trackerApi({ action: "snapshot" });
  console.log("server archive:", snap.key, JSON.stringify(snap.counts));
  if (!snap.counts || snap.counts.expenses === 0) {
    console.error("ABORT: server archive shows empty expenses — investigate first.");
    process.exit(1);
  }

  console.log("\n=== 2/4 pre-migration load ===");
  const before = await loadLive();
  console.log("collections:", JSON.stringify(collCounts(before)));
  if (!Array.isArray(before.expenses) || before.expenses.length === 0) {
    console.error("ABORT: live expenses empty — refusing to migrate a suspicious blob.");
    process.exit(1);
  }

  console.log("\n=== 3/4 migrateSplit ===");
  const m = await trackerApi({ action: "migrateSplit" });
  if (m.already) {
    console.log("Already in split mode since", (m.migration || {}).migratedAt, "— nothing to do.");
  } else if (!m || !m.ok) {
    console.error("Migration FAILED:", JSON.stringify(m));
    console.error("Marker not written — still in monolith mode, nothing lost.");
    process.exit(1);
  } else {
    console.log("Migrated at", m.migration.migratedAt, "by", m.migration.by);
    console.log("counts:", JSON.stringify(m.migration.counts));
  }

  console.log("\n=== 4/4 post-migration verify ===");
  const after = await loadLive();
  const bad = diffCollections(before, after);
  if (bad.length) {
    console.error("VERIFY FAILED — collections differ after migration:", bad.join(", "));
    console.error("Run with --rollback and investigate. Local backup:", backup.dir);
    process.exit(1);
  }
  console.log("All", COLLS.length, "collections identical after migration ✓");
  console.log("\nSplit mode is ACTIVE. The monolith remains untouched as an archive.");
  console.log("Rollback (loses split-mode saves): --rollback");
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
