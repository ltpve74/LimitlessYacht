#!/usr/bin/env node
/**
 * Dry-run / apply: owner’s days → owner-sourced commercial.
 *
 * Policy: .agent/memory/tracker-no-load-heals-db-dryrun.md
 *
 * Usage:
 *   TRACKER_PASSCODE=… node scripts/tracker-migrate-owner-sourced.mjs
 *   TRACKER_PASSCODE=… node scripts/tracker-migrate-owner-sourced.mjs --apply
 *
 * Default: load live leads, print migration table (no write).
 * --apply: backupLive → saveCollection("leads", …) once.
 *
 * For each raw leadSource owner / owner-days / private (and existing ownersourced
 * missing notional stamp): set ownersourced, stamp ownerSourcedNotional = list×0.8,
 * set total/price/base to notional when empty or migrating from owner days.
 */
import { createRequire } from "module";
import { loadLive, backupLive, saveCollection } from "./lib/tracker-db-io.mjs";

const require = createRequire(import.meta.url);
const M = require("../tracker/js/models.js");

const PASS = process.env.TRACKER_PASSCODE || "";
const APPLY = process.argv.includes("--apply");

if (!PASS) {
  console.error("Set TRACKER_PASSCODE (captain). No passcode → refuse.");
  process.exit(2);
}

function rawIsOwnerDays(r) {
  const s = String((r && r.leadSource) || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  return (
    s === "owner" ||
    s === "owners" ||
    s === "owner-day" ||
    s === "owner-days" ||
    s === "ownerdays" ||
    s === "owner_days" ||
    s === "owner-use" ||
    s === "owner_use" ||
    s === "private"
  );
}

function planLead(r) {
  const fromOwner = rawIsOwnerDays(r);
  const alreadyOs = M.constrainLeadSource(r.leadSource) === "ownersourced";
  if (!fromOwner && !alreadyOs) return null;

  const list = M.ownerSourcedListPrice(r);
  const notional = M.ownerSourcedNotionalPrice(
    Object.assign({}, r, { ownerSourcedNotional: 0 })
  ); /* recompute from list, ignore stamp */
  const recognized = M.ownerSourcedRecognizedIncome(
    Object.assign({}, r, { leadSource: "ownersourced" })
  );
  const loss = Math.max(0, Math.round((notional - recognized) * 100) / 100);
  const fair = M.ownerSourcedCommissionParts(
    Object.assign({}, r, {
      leadSource: "ownersourced",
      ownerSourcedNotional: notional,
      total: notional,
    })
  );

  const curTot = Number(r.total) || Number(r.price) || Number(r.base) || 0;
  const shouldStampPrice = fromOwner || !(curTot > 0.009);

  const patch = {
    id: r.id,
    name: r.name || "—",
    start: String(r.start || r.cdate || "").slice(0, 10),
    fromSource: r.leadSource || "",
    leadSource: "ownersourced",
    list: list,
    notional: notional,
    recognized: recognized,
    loss: loss,
    incomeComm: fair.incomeComm,
    forgoneComm: fair.forgoneComm,
    shouldStampPrice: shouldStampPrice,
    prevTotal: curTot,
  };

  const next = Object.assign({}, r, {
    leadSource: "ownersourced",
    ownerSourcedNotional: notional,
    migratedFromOwnerDays: fromOwner || !!r.migratedFromOwnerDays,
    updatedAt: new Date().toISOString(),
  });
  if (shouldStampPrice && notional > 0) {
    next.total = notional;
    next.price = notional;
    if (!(Number(next.base) > 0)) next.base = Math.round((notional / 1.21) * 100) / 100;
  }
  patch.next = next;
  return patch;
}

async function main() {
  console.log("Loading live tracker…");
  const live = await loadLive();
  const leads = Array.isArray(live.leads) ? live.leads.slice() : [];
  const plans = [];
  leads.forEach(function (r) {
    if (!r || !r.id) return;
    const p = planLead(r);
    if (p) plans.push(p);
  });

  console.log("\n=== Owner → Owner-sourced migration plan ===");
  console.log("Rows to touch:", plans.length);
  console.log(
    [
      "name".padEnd(22),
      "start".padEnd(12),
      "from".padEnd(14),
      "list".padStart(8),
      "notional".padStart(10),
      "inBooks".padStart(10),
      "loss".padStart(10),
      "forgone10".padStart(10),
      "price?".padStart(7),
    ].join(" ")
  );
  let sumLoss = 0,
    sumForgone = 0,
    sumNotional = 0,
    sumRec = 0;
  plans.forEach(function (p) {
    sumLoss += p.loss;
    sumForgone += p.forgoneComm;
    sumNotional += p.notional;
    sumRec += p.recognized;
    console.log(
      [
        String(p.name).slice(0, 22).padEnd(22),
        String(p.start || "—").padEnd(12),
        String(p.fromSource || "—").slice(0, 14).padEnd(14),
        String(Math.round(p.list)).padStart(8),
        String(Math.round(p.notional)).padStart(10),
        String(Math.round(p.recognized)).padStart(10),
        String(Math.round(p.loss)).padStart(10),
        String(Math.round(p.forgoneComm)).padStart(10),
        (p.shouldStampPrice ? "SET" : "keep").padStart(7),
      ].join(" ")
    );
  });
  console.log("\nTotals — notional", Math.round(sumNotional), "· in books", Math.round(sumRec), "· possible loss", Math.round(sumLoss), "· forgone @10%", Math.round(sumForgone));

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply after review (backs up first).");
    return;
  }

  if (!plans.length) {
    console.log("Nothing to apply.");
    return;
  }

  const byId = {};
  plans.forEach(function (p) {
    byId[p.id] = p.next;
  });
  const out = leads.map(function (r) {
    return byId[r.id] || r;
  });

  console.log("\nBacking up…");
  const bak = backupLive(live, "owner-to-ownersourced");
  console.log("Backup:", bak.dir);

  console.log("Saving leads…");
  await saveCollection("leads", out, { backupDir: bak.dir });
  console.log("Applied", plans.length, "lead row(s). Hard-refresh the tracker.");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
