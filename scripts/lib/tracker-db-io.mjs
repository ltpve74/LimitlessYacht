/**
 * Tracker live DB I/O helpers — backup-before-write is mandatory.
 *
 * Policy: .agent/memory/tracker-no-load-heals-db-dryrun.md
 *
 * Save shape (server): { action: "save", collection, rows } — NOT coll/data.
 * Wrong shape full-replaces the collection with [] (wipe).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

export const DEFAULT_API =
  process.env.TRACKER_API || "https://limitlessyachtcharter.com/api/tracker";

/** Money collections we always snapshot. */
export const MONEY_COLLS = ["expenses", "expPetty"];

/** All captain-writable collections (full restore set). */
export const ALL_COLLS = [
  "charters",
  "leads",
  "apa",
  "diesel",
  "stews",
  "stewAssign",
  "stewCalendar",
  "expenses",
  "expPetty",
];

function defaultBackupRoot() {
  if (process.env.TRACKER_BACKUP_DIR) {
    return resolve(process.env.TRACKER_BACKUP_DIR);
  }
  return join(REPO_ROOT, ".tracker-backups");
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * POST tracker API. Passcode from env TRACKER_PASSCODE unless opts.pass set.
 */
export async function trackerApi(body, opts = {}) {
  const api = opts.api || DEFAULT_API;
  const pass = opts.pass || process.env.TRACKER_PASSCODE || "";
  const who = opts.who || process.env.TRACKER_WHO || "Captain";
  if (!pass) {
    throw new Error("TRACKER_PASSCODE required (no silent DB access)");
  }
  const res = await fetch(api, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tracker-pass": pass,
    },
    body: JSON.stringify(Object.assign({ who: who, role: "captain" }, body)),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("Bad JSON " + res.status + ": " + text.slice(0, 200));
  }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

export async function loadLive(opts = {}) {
  return trackerApi({ action: "load" }, opts);
}

/**
 * Write a timestamped backup directory. Refuses empty money snapshot unless allowEmpty.
 * @returns {{ dir: string, manifest: object }}
 */
export function writeBackup(liveData, label, opts = {}) {
  const allowEmpty = opts.allowEmpty === true;
  const root = opts.root || defaultBackupRoot();
  const expenses = Array.isArray(liveData && liveData.expenses)
    ? liveData.expenses
    : [];
  const expPetty = Array.isArray(liveData && liveData.expPetty)
    ? liveData.expPetty
    : [];

  if (!allowEmpty && expenses.length === 0) {
    throw new Error(
      "Refusing backup of empty expenses[] — load looks wiped or incomplete. " +
        "Fix load / restore from an older backup first."
    );
  }

  const safeLabel = String(label || "manual")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 60);
  const dir = join(root, stamp() + "-" + safeLabel);
  mkdirSync(dir, { recursive: true });

  const collSnapshot = {};
  ALL_COLLS.forEach(function (c) {
    if (liveData && Array.isArray(liveData[c])) {
      collSnapshot[c] = liveData[c];
    }
  });

  const fullPath = join(dir, "full-money.json");
  const expPath = join(dir, "expenses.json");
  const pettyPath = join(dir, "expPetty.json");
  const manifestPath = join(dir, "manifest.json");

  writeFileSync(
    fullPath,
    JSON.stringify(
      {
        backedUpAt: new Date().toISOString(),
        label: safeLabel,
        api: opts.api || DEFAULT_API,
        collections: collSnapshot,
      },
      null,
      2
    )
  );
  writeFileSync(expPath, JSON.stringify(expenses, null, 2));
  writeFileSync(pettyPath, JSON.stringify(expPetty, null, 2));

  const manifest = {
    backedUpAt: new Date().toISOString(),
    label: safeLabel,
    dir: dir,
    expensesN: expenses.length,
    expPettyN: expPetty.length,
    floatPayTrue: expenses.filter(function (e) {
      return e && e.floatPay === true;
    }).length,
    files: {
      full: fullPath,
      expenses: expPath,
      expPetty: pettyPath,
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir: dir, manifest: manifest };
}

/**
 * Load live blob and write backup. Call before any save.
 */
export async function backupLive(label, opts = {}) {
  const data = opts.data || (await loadLive(opts));
  const out = writeBackup(data, label, opts);
  console.log(
    "[tracker-backup] wrote",
    out.dir,
    "expenses=" + out.manifest.expensesN,
    "expPetty=" + out.manifest.expPettyN,
    "floatPay=" + out.manifest.floatPayTrue
  );
  return { data: data, backup: out };
}

/**
 * Save one collection. Requires prior backup path (or opts.backupDir).
 * Refuses empty expenses unless opts.allowEmptyRows.
 * Always uses { collection, rows } — never data/coll.
 */
export async function saveCollection(collection, rows, opts = {}) {
  if (!opts.backupDir && !opts.skipBackupCheck) {
    throw new Error(
      "saveCollection refused: no backupDir. Call backupLive() first and pass backup.dir."
    );
  }
  if (!existsSync(String(opts.backupDir || "")) && !opts.skipBackupCheck) {
    throw new Error(
      "saveCollection refused: backupDir missing on disk: " + opts.backupDir
    );
  }
  if (!Array.isArray(rows)) {
    throw new Error("saveCollection: rows must be an array (got " + typeof rows + ")");
  }
  if (
    collection === "expenses" &&
    rows.length === 0 &&
    opts.allowEmptyRows !== true
  ) {
    throw new Error(
      "Refusing to save expenses=[] (would wipe live books). " +
        "Restore from .tracker-backups/ first. Pass allowEmptyRows only if intentional."
    );
  }
  if (!ALL_COLLS.includes(collection)) {
    throw new Error("Unknown collection: " + collection);
  }
  console.log(
    "[tracker-save] collection=" +
      collection +
      " rows=" +
      rows.length +
      " backup=" +
      (opts.backupDir || "skipped")
  );
  return trackerApi(
    { action: "save", collection: collection, rows: rows },
    opts
  );
}

/** Restore expenses (+ optional expPetty) from a backup directory. */
export async function restoreFromBackupDir(dir, opts = {}) {
  const expPath = join(dir, "expenses.json");
  const pettyPath = join(dir, "expPetty.json");
  if (!existsSync(expPath)) {
    throw new Error("No expenses.json in " + dir);
  }
  const expenses = JSON.parse(readFileSync(expPath, "utf8"));
  if (!Array.isArray(expenses) || expenses.length === 0) {
    throw new Error("Backup expenses empty — abort restore");
  }
  /* Safety: backup live state before restore overwrite */
  const pre = await backupLive("pre-restore", opts);
  await saveCollection("expenses", expenses, {
    backupDir: pre.backup.dir,
    pass: opts.pass,
    api: opts.api,
    who: opts.who,
  });
  if (opts.includePetty && existsSync(pettyPath)) {
    const expPetty = JSON.parse(readFileSync(pettyPath, "utf8"));
    if (Array.isArray(expPetty) && expPetty.length) {
      await saveCollection("expPetty", expPetty, {
        backupDir: pre.backup.dir,
        pass: opts.pass,
        api: opts.api,
        who: opts.who,
      });
    }
  }
  return { restoredExpenses: expenses.length, preBackup: pre.backup.dir };
}
