#!/usr/bin/env node
/**
 * Explicit tracker DB dry-run / apply — NEVER run from app load.
 *
 * Policy: .agent/memory/tracker-no-load-heals-db-dryrun.md
 *
 * Usage:
 *   TRACKER_PASSCODE=… node scripts/tracker-db-dryrun.mjs
 *   TRACKER_PASSCODE=… node scripts/tracker-db-dryrun.mjs --apply-july-aug-2026
 *   TRACKER_PASSCODE=… node scripts/tracker-db-backup.mjs   # backup only
 *
 * Default: load live blob, print July/Aug petty + pocket bridge + plan patches.
 * --apply-july-aug-2026: backup → one-shot reconstruction (floatPay pot + Aug BF 110).
 *
 * Save shape: collection + rows only (never coll/data — empty wipe).
 * Every apply path runs backupLive() first and refuses empty expenses saves.
 */
import { createRequire } from "module";
import {
  loadLive,
  backupLive,
  saveCollection,
} from "./lib/tracker-db-io.mjs";

const require = createRequire(import.meta.url);
const M = require("../tracker/js/models.js");

const PASS = process.env.TRACKER_PASSCODE || "";
const APPLY = process.argv.includes("--apply-july-aug-2026");

if (!PASS) {
  console.error("Set TRACKER_PASSCODE (captain). No passcode → refuse (no silent heals).");
  process.exit(2);
}

function near(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) < (eps || 0.02);
}

function monthLines(expenses, mon) {
  return (expenses || []).filter(function (e) {
    return e && String(e.date || "").slice(0, 7) === mon;
  });
}

function pettyFor(rows, mon) {
  return (
    (rows || []).find(function (p) {
      return p && String(p.month || "").slice(0, 7) === mon;
    }) || null
  );
}

/** Known reconstruction targets from captain records (2026-07 / 2026-08). */
const JULY_FLOAT_TARGETS = [
  { match: /toni/i, amount: 750, label: "Toni €750" },
  { match: /toni/i, amount: 500, label: "Toni €500" },
  { match: /toni/i, amount: 250, label: "Toni €250" },
  { match: /laura/i, amount: 200, label: "Laura €200" },
  { match: /laura/i, amount: 150, label: "Laura €150" },
];

function planJulyAugFix(expenses, expPetty) {
  const patches = { expenses: [], expPetty: [] };
  const july = monthLines(expenses, "2026-07");
  JULY_FLOAT_TARGETS.forEach(function (t) {
    const hit = july.find(function (e) {
      if (!e || !M.isCrewDayPayExpense(e)) return false;
      if (!near(e.amount, t.amount)) return false;
      const v = String(e.vendor || e.description || "");
      return t.match.test(v);
    });
    if (!hit) {
      patches.expenses.push({ id: null, label: t.label, error: "not found" });
      return;
    }
    const before = {
      floatPay: hit.floatPay === true,
      crewPayStatus: hit.crewPayStatus,
      paidFrom: hit.paidFrom,
    };
    const need =
      hit.floatPay !== true ||
      String(hit.crewPayStatus || "") !== "Paid" ||
      String(hit.paidFrom || "") !== "Petty cash";
    patches.expenses.push({
      id: hit.id,
      label: t.label,
      before: before,
      after: { floatPay: true, crewPayStatus: "Paid", paidFrom: "Petty cash" },
      need: need,
    });
  });

  const aug = pettyFor(expPetty, "2026-08");
  const bfBefore = aug ? Number(aug.broughtForwardShort) || 0 : null;
  patches.expPetty.push({
    month: "2026-08",
    field: "broughtForwardShort",
    before: bfBefore,
    after: 110,
    need: !(aug && near(bfBefore, 110)),
    create: !aug,
  });
  return patches;
}

function printSettlement(label, mon, expenses, expPetty) {
  const open = M.resolvePettyMonthOpen(mon, expPetty, expenses, {});
  const close = M.resolvePettyMonthClose(mon, expPetty, expenses, {});
  const bridge = M.summarizeCaptainPocketMonthBridge(expenses, mon);
  console.log("\n=== " + label + " (" + mon + ") ===");
  console.log(
    "  open: start",
    open.pettyStart,
    "BF short",
    open.broughtForwardShort,
    "mode",
    open.startMode,
    "src",
    open.source
  );
  console.log(
    "  close: onboard",
    close.onboard,
    "short",
    close.short,
    close.empty ? "(empty)" : ""
  );
  console.log(
    "  pocket bridge: BF",
    bridge.broughtForward,
    "monthSpend",
    bridge.monthSpend,
    "repay",
    bridge.monthRepay,
    "open",
    bridge.closingOpen,
    "repay→prior",
    bridge.repayToPrior
  );
}

async function main() {
  console.log("Loading tracker blob…");
  const data = await loadLive();
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const expPetty = Array.isArray(data.expPetty) ? data.expPetty : [];
  console.log("Loaded expenses", expenses.length, "expPetty months", expPetty.length);

  printSettlement("July", "2026-07", expenses, expPetty);
  printSettlement("August", "2026-08", expenses, expPetty);

  const plan = planJulyAugFix(expenses, expPetty);
  console.log("\n=== Planned July/Aug reconstruction ===");
  plan.expenses.forEach(function (p) {
    console.log(
      "  expense",
      p.label,
      p.id || "—",
      p.error ||
        (p.need
          ? "NEED " + JSON.stringify(p.before) + " → " + JSON.stringify(p.after)
          : "ok")
    );
  });
  plan.expPetty.forEach(function (p) {
    console.log(
      "  expPetty",
      p.month,
      p.field,
      p.need ? "NEED " + p.before + " → " + p.after : "ok (" + p.before + ")"
    );
  });

  const carryPlan = M.planPettyCarryMaterialize(expPetty, expenses, null, {});
  console.log(
    "\n=== Pure carry materialize plan (not auto-applied) n=" + carryPlan.n + " ==="
  );
  carryPlan.patches.slice(0, 12).forEach(function (p) {
    console.log(" ", p.month, p.reason, p.fields);
  });

  if (!APPLY) {
    console.log("\nDry-run only. To apply known reconstruction: --apply-july-aug-2026");
    console.log("Backup only (no write): node scripts/tracker-db-backup.mjs [label]");
    return;
  }

  const needExp = plan.expenses.filter(function (p) {
    return p.need && p.id;
  });
  const needPetty = plan.expPetty.filter(function (p) {
    return p.need;
  });
  if (!needExp.length && !needPetty.length) {
    console.log("\nNothing to apply — data already matches reconstruction targets.");
    return;
  }

  /* ── mandatory backup before any live write ── */
  console.log("\n=== BACKUP (required before apply) ===");
  const { backup } = await backupLive("pre-apply-july-aug-2026", { data: data });
  const backupDir = backup.dir;

  let nextExpenses = expenses.slice();
  needExp.forEach(function (p) {
    nextExpenses = nextExpenses.map(function (e) {
      if (!e || String(e.id) !== String(p.id)) return e;
      return Object.assign({}, e, {
        floatPay: true,
        crewPayStatus: "Paid",
        paidFrom: "Petty cash",
        payStatusManual: true,
        updatedAt: new Date().toISOString(),
      });
    });
  });

  let nextPetty = expPetty.slice();
  needPetty.forEach(function (p) {
    const idx = nextPetty.findIndex(function (r) {
      return r && String(r.month).slice(0, 7) === p.month;
    });
    if (idx >= 0) {
      nextPetty[idx] = Object.assign({}, nextPetty[idx], {
        broughtForwardShort: p.after,
        updatedAt: new Date().toISOString(),
      });
    } else {
      nextPetty.push({
        month: p.month,
        pettyStart: 0,
        broughtForwardShort: p.after,
        startMode: "carry",
        carriedFrom: "2026-07",
        cashIns: [],
        updatedAt: new Date().toISOString(),
      });
    }
  });

  if (needExp.length) {
    console.log("\nSaving expenses (" + needExp.length + " floatPay patches)…");
    await saveCollection("expenses", nextExpenses, { backupDir: backupDir });
  }
  if (needPetty.length) {
    console.log("Saving expPetty (BF short patches)…");
    await saveCollection("expPetty", nextPetty, { backupDir: backupDir });
  }

  const verify = await loadLive();
  printSettlement("July (after)", "2026-07", verify.expenses, verify.expPetty);
  printSettlement("August (after)", "2026-08", verify.expenses, verify.expPetty);
  console.log("\nApply complete. Backup kept at:", backupDir);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
