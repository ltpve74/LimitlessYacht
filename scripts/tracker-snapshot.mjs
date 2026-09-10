#!/usr/bin/env node
/**
 * Server-side tracker archive snapshot (captain only, read-only on live data).
 *
 *   TRACKER_PASSCODE=… node scripts/tracker-snapshot.mjs
 *
 * Asks the live function to copy the whole blob to archive/data-<stamp>
 * inside the same Netlify store — a backup that survives laptop loss.
 * Pairs with tracker-db-backup.mjs (local disk snapshot); run both before
 * any migration or direct DB work.
 */
import { trackerApi } from "./lib/tracker-db-io.mjs";

const PASS = process.env.TRACKER_PASSCODE || "";
if (!PASS) {
  console.error("Set TRACKER_PASSCODE (captain).");
  process.exit(2);
}

trackerApi({ action: "snapshot" })
  .then(function (r) {
    if (!r || !r.ok) {
      console.error("Snapshot failed:", JSON.stringify(r));
      process.exit(1);
    }
    console.log("OK archived live blob →", r.key);
    console.log("snapshottedAt:", r.snapshottedAt);
    console.log("counts:", JSON.stringify(r.counts));
    if (r.counts && r.counts.expenses === 0) {
      console.error(
        "WARNING: archived blob has EMPTY expenses[] — investigate before relying on this snapshot."
      );
      process.exit(1);
    }
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
