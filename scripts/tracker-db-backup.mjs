#!/usr/bin/env node
/**
 * One-shot live tracker backup (no writes to the blob).
 *
 *   TRACKER_PASSCODE=… node scripts/tracker-db-backup.mjs [label]
 *
 * Writes under .tracker-backups/<stamp>-<label>/ (or TRACKER_BACKUP_DIR).
 * Always run this (or backupLive) before any direct DB mutation.
 */
import { backupLive } from "./lib/tracker-db-io.mjs";

const PASS = process.env.TRACKER_PASSCODE || "";
if (!PASS) {
  console.error("Set TRACKER_PASSCODE (captain).");
  process.exit(2);
}

const label = process.argv[2] || "manual";

backupLive(label)
  .then(function (out) {
    console.log("OK", JSON.stringify(out.backup.manifest, null, 2));
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
