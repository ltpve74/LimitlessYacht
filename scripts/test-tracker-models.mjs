#!/usr/bin/env node
/**
 * Locked-rule tests for tracker/js/models.js
 * Run: node scripts/test-tracker-models.mjs
 * Failures exit 1 — keep these green when changing money logic.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = join(__dirname, "..");
const M = require(join(root, "tracker/js/models.js"));

let failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log("  ✓  " + name);
  } else {
    failed++;
    console.log("  ✗  " + name + (detail ? " — " + detail : ""));
  }
}

/** Inline script must parse — a SyntaxError kills login (whole page dead). */
function checkTrackerHtmlSyntax() {
  console.log("[Tracker index.html inline JS syntax]");
  const html = readFileSync(join(root, "tracker/index.html"), "utf8");
  const m = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) {
    ok("inline script present", false, "no inline <script> found");
    return;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(m[1]);
    ok("inline script parses (login/boot can run)", true);
  } catch (e) {
    ok("inline script parses (login/boot can run)", false, e && e.message);
  }
  const modelFiles = [
    "tracker/js/models.js",
    "tracker/js/models/util.js",
    "tracker/js/models/leads.js",
    "tracker/js/models/charges.js",
    "tracker/js/models/expenses.js",
    "tracker/js/models/cash.js",
    "tracker/js/models/diesel.js",
    "tracker/js/models/stews.js",
    "tracker/js/models/apa.js",
    "tracker/js/models/index.js",
    "tracker/js/controllers/expenses.js",
    "tracker/js/controllers/cashReport.js",
    "tracker/js/controllers/charges.js",
    "tracker/js/controllers/leads.js",
    "tracker/js/controllers/apa.js",
    "tracker/js/controllers/stews.js",
    "tracker/js/controllers/index.js",
    "tracker/js/pdf/expenses-cash.js",
    "tracker/js/pdf/owner-cash.js",
  ];
  for (const rel of modelFiles) {
    const chk = spawnSync(process.execPath, ["--check", join(root, rel)], { encoding: "utf8" });
    ok(rel + " syntax", chk.status === 0, chk.stderr || chk.stdout);
  }
}

checkTrackerHtmlSyntax();
const C = require(join(root, "tracker/js/controllers/index.js"));
const OwnerCashPdf = require(join(root, "tracker/js/pdf/owner-cash.js"));
function near(a, b, eps) {
  eps = eps == null ? 0.02 : eps;
  return Math.abs(Number(a) - Number(b)) <= eps;
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Tracker domain models (locked rules)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

/* ---- Owner on-board cash PDF (simple export) ---- */
console.log("[PDF — owner cash]");
{
  ok(
    "owner cash fileName",
    OwnerCashPdf.fileName("2026-08") === "Limitless-owner-cash-2026-08.pdf",
    OwnerCashPdf.fileName("2026-08")
  );
  ok(
    "owner cash public label rewrites you → captain",
    OwnerCashPdf.safeText("Commission to you") === "Captain commission"
  );
  ok(
    "owner cash Own money → Captain money",
    OwnerCashPdf.safeText("Own money") === "Captain money"
  );
  ok(
    "owner cash cash-in Own money label",
    OwnerCashPdf.safeText("Own money · float top-up").indexOf("Captain money") === 0
  );
  ok("owner cash exports build", typeof OwnerCashPdf.build === "function");
}

/* ---- Ops today board (day grouping) ---- */
console.log("[Ops — today board]");
{
  ok("ymdTouchesDay same day", M.ymdTouchesDay("2026-08-03", "2026-08-03", "2026-08-03"));
  ok("ymdTouchesDay multi mid", M.ymdTouchesDay("2026-08-04", "2026-08-03", "2026-08-05"));
  ok("ymdTouchesDay outside false", !M.ymdTouchesDay("2026-08-10", "2026-08-03", "2026-08-05"));
  const board = M.collectTodayOpsBoard({
    today: "2026-08-03",
    leads: [
      { id: "L1", name: "Joel", start: "2026-08-03", end: "2026-08-03", dealClosed: true, amount: 4000 },
      { id: "L2", name: "Future", start: "2026-08-10", dealClosed: true },
      { id: "L3", name: "Hold", start: "2026-08-03", dealClosed: false },
    ],
    charges: [
      { id: "C1", client: "Joel", date: "2026-08-03", amount: 200, payStatus: "Pending" },
      { id: "C2", client: "Other", date: "2026-07-01", amount: 50 },
    ],
    apa: [
      { id: "A1", guest: "Joel", start: "2026-08-03", end: "2026-08-03", apaSent: 500 },
      { id: "A2", guest: "Skip", start: "2026-08-01", end: "2026-08-01" },
    ],
    stews: [
      { eventKey: "ek1", summary: "Joel charter", start: "2026-08-03", end: "2026-08-03", stewIds: ["toni"], payStatus: "Unpaid" },
      { eventKey: "ek2", summary: "Off", start: "2026-08-03", off: true },
      { eventKey: "ek3", summary: "Tomorrow", start: "2026-08-04", stewIds: ["laura"] },
    ],
    leadIsCancelled: function () { return false; },
    stewIsOff: function (a) { return !!(a && a.off); },
  });
  ok("today board n = 5 (2 leads + 1 charge + 1 apa + 1 stew)", board.n === 5, "got " + board.n);
  ok("today board 2 leads", board.leads.length === 2, "got " + board.leads.length);
  ok("today board hold is tentative", board.leads.some(function (x) { return x.id === "L3" && x.status === "tentative"; }));
  ok("today board 1 charge", board.charges.length === 1 && board.charges[0].id === "C1");
  ok("today board 1 apa", board.apa.length === 1 && board.apa[0].id === "A1");
  ok("today board 1 stew (off skipped)", board.stews.length === 1 && board.stews[0].eventKey === "ek1");
  ok("today board groups 4 keys", board.groups && board.groups.length === 4);
  ok("today board assigned stew status", board.stews[0].status === "assigned");
  const boardNone = M.collectTodayOpsBoard({
    today: "2026-08-03",
    stews: [
      {
        eventKey: "ek-none",
        summary: "Friends day",
        start: "2026-08-03",
        end: "2026-08-03",
        stewIds: [],
        noStewNeeded: true,
      },
      {
        eventKey: "ek-gap",
        summary: "Needs crew",
        start: "2026-08-03",
        end: "2026-08-03",
        stewIds: [],
      },
    ],
    stewIsOff: function () { return false; },
  });
  ok("today board noStewNeeded is none not unassigned", boardNone.stews.some(function (x) {
    return x.eventKey === "ek-none" && x.status === "none";
  }));
  ok("today board empty crew still unassigned", boardNone.stews.some(function (x) {
    return x.eventKey === "ek-gap" && x.status === "unassigned";
  }));
  ok(
    "today board noStewNeeded no duplicate subtitle",
    (boardNone.stews.filter(function (x) { return x.eventKey === "ek-none"; })[0] || {}).subtitle === ""
  );
}

/* ---- Unpaid charge after charter end (Today / Leads highlight) ---- */
console.log("[Charges — unpaid due after end]");
{
  ok("parseClockMinutes 18:00", M.parseClockMinutes("18:00") === 18 * 60);
  ok("parseClockMinutes bad null", M.parseClockMinutes("nope") == null);
  const endMs = M.charterEndLocalMs("2026-08-03", "18:00");
  ok("charterEndLocalMs with clock", typeof endMs === "number" && endMs > 0);
  const eodMs = M.charterEndLocalMs("2026-08-03", "");
  ok("charterEndLocalMs end of day after 18:00", eodMs > endMs);

  const beforeEnd = endMs - 60 * 1000;
  const afterEnd = endMs + 60 * 1000;
  ok(
    "isPastCharterEnd false before clock",
    !M.isPastCharterEnd({ date: "2026-08-03", endTime: "18:00", nowMs: beforeEnd })
  );
  ok(
    "isPastCharterEnd true after clock",
    M.isPastCharterEnd({ date: "2026-08-03", endTime: "18:00", nowMs: afterEnd })
  );
  ok(
    "isPastCharterEnd multi-day uses end date",
    M.isPastCharterEnd({
      date: "2026-08-01",
      end: "2026-08-03",
      endTime: "18:00",
      nowMs: afterEnd,
    })
  );

  const unpaidC = {
    id: "C-due",
    client: "Joel",
    date: "2026-08-03",
    amount: 200,
    payStatus: "Pending",
  };
  const paidC = {
    id: "C-paid",
    client: "Joel",
    date: "2026-08-03",
    amount: 200,
    payStatus: "Paid",
  };
  const leadsJoel = [
    {
      id: "L1",
      name: "Joel",
      start: "2026-08-03",
      end: "2026-08-03",
      endTime: "18:00",
      dealClosed: true,
    },
  ];
  ok(
    "chargeIsUnpaidDue false before end",
    !M.chargeIsUnpaidDue(unpaidC, { leads: leadsJoel, nowMs: beforeEnd })
  );
  ok(
    "chargeIsUnpaidDue true after end",
    M.chargeIsUnpaidDue(unpaidC, { leads: leadsJoel, nowMs: afterEnd })
  );
  ok(
    "chargeIsUnpaidDue false when Paid",
    !M.chargeIsUnpaidDue(paidC, { leads: leadsJoel, nowMs: afterEnd })
  );

  const boardBefore = M.collectTodayOpsBoard({
    today: "2026-08-03",
    nowMs: beforeEnd,
    leads: leadsJoel,
    charges: [unpaidC],
  });
  ok(
    "today board charge pending before end",
    boardBefore.charges[0] && boardBefore.charges[0].status === "pending",
    "got " + (boardBefore.charges[0] && boardBefore.charges[0].status)
  );
  ok(
    "today board charge not unpaidDue before end",
    boardBefore.charges[0] && boardBefore.charges[0].unpaidDue === false
  );

  const boardAfter = M.collectTodayOpsBoard({
    today: "2026-08-03",
    nowMs: afterEnd,
    leads: leadsJoel,
    charges: [unpaidC, paidC],
  });
  const dueRow = (boardAfter.charges || []).filter(function (x) {
    return x.id === "C-due";
  })[0];
  const paidRow = (boardAfter.charges || []).filter(function (x) {
    return x.id === "C-paid";
  })[0];
  ok(
    "today board unpaid-due after end",
    dueRow && dueRow.status === "unpaid-due" && dueRow.unpaidDue === true,
    "got " + (dueRow && dueRow.status)
  );
  ok(
    "today board paid stays paid after end",
    paidRow && paidRow.status === "paid"
  );
  ok(
    "today board charge inherits lead endTime",
    dueRow && dueRow.endTime === "18:00",
    "got " + (dueRow && dueRow.endTime)
  );
}

/* ---- Commission: VAT-included total (Joel) ---- */
console.log("[Commission — VAT included]");
{
  const joel = { total: 12000, base: 12000, net: 9917.36, vatMode: "include", vatPct: 21 };
  const p = M.leadCommissionParts(joel);
  ok("Joel base ≈ 12000/1.21", near(p.base, 12000 / 1.21, 0.05), "got " + p.base);
  ok("Joel commission ≈ 991.74 at 10%", near(p.total, (12000 / 1.21) * 0.1, 0.05), "got " + p.total);
  ok("Joel commission is NOT 1800", !near(p.total, 1800, 1), "got " + p.total);
  ok("Joel at 15% preview ≈ 1487.60", near(M.leadCommissionParts(joel, 15).total, (12000 / 1.21) * 0.15, 0.05));
}
{
  const noPct = { total: 12000, vatMode: "include", vatPct: 0 };
  const p = M.leadCommissionParts(noPct);
  ok("vatPct 0 still strips 21%", near(p.base, 12000 / 1.21, 0.05), "got " + p.base);
}
{
  const none = { total: 12000, vatMode: "none", vatPct: 21 };
  const p = M.leadCommissionParts(none);
  ok("vatMode none keeps gross", near(p.base, 12000, 0.02));
}

/* ---- Commission: split deal ---- */
console.log("\n[Commission — split white + cash]");
{
  const white = 2000;
  const whiteNet = white / 1.21;
  const cash = 1800;
  const lead = {
    split: true,
    invoiceTotal: white,
    invoiceNet: whiteNet,
    cashAmt: cash,
    whiteVatMode: "include",
    vatPct: 21,
  };
  const p = M.leadCommissionParts(lead);
  ok("split is split", p.split === true);
  ok("white before VAT ≈ 1652.89", near(p.whiteBeforeVat, whiteNet, 0.05), "got " + p.whiteBeforeVat);
  ok("cash black 1800", near(p.cashBlack, 1800));
  ok("white comm 10%", near(p.whiteComm, whiteNet * 0.1, 0.05));
  ok("cash comm 10% of 1800", near(p.cashComm, 180, 0.02));
  ok("total = white comm + cash comm", near(p.total, p.whiteComm + p.cashComm, 0.02));
  ok("split at 15% force", near(M.leadCommissionParts(lead, 15).cashComm, 270, 0.02));
}

/* ---- Free cash black ---- */
console.log("\n[Free cash black — never suggested]");
{
  const lead = {
    split: true,
    base: 4000,
    price: 4000,
    vatMode: "include",
    vatPct: 21,
    invoiceTotal: 2000,
    invoiceNet: 2000 / 1.21,
    whiteVatMode: "include",
    cashAmt: 1652.89,
  };
  ok("1652.89 looks suggested", M.cashAmtLooksSuggested(lead));
  ok("free cash refuses 1652.89", M.leadFreeCashAmt(lead) === 0, "got " + M.leadFreeCashAmt(lead));
  ok("free cash uses pin 1800", near(M.leadFreeCashAmt(lead, 1800), 1800));
  const copy = Object.assign({}, lead);
  ok("sanitize clears 1652.89 without pin", M.sanitizeLeadCash(copy, 0) && copy.cashAmt === 0);
  const copy2 = Object.assign({}, lead);
  ok("sanitize applies pin 1800", M.sanitizeLeadCash(copy2, 1800) && near(copy2.cashAmt, 1800));
  lead.cashAmt = 1800;
  ok("1800 does not look suggested", !M.cashAmtLooksSuggested(lead));
  ok("client total white+cash", near(M.leadClientTotal(lead), 3800, 0.02));
  lead.cashAmt = 1652.89;
  /* Default charge VAT: cash guide = B − white net */
  ok(
    "suggested cash ≈ B − white net (charge default)",
    near(M.leadSuggestedCashAmt(lead), 4000 / 1.21 - 2000 / 1.21, 1),
    "got " + M.leadSuggestedCashAmt(lead)
  );
  /*
   * Quote 4000 inc. VAT → B ≈ 3305.79
   * Invoice 1000 + 21% → T=1210, W=1000, V=210
   * Charge: final B+V ≈ 3515.79, cash B−W ≈ 2305.79
   * Swallow: final B, cash B−T ≈ 2095.79
   */
  const B = 4000 / 1.21;
  const splitVat = {
    split: true,
    base: 4000,
    price: 4000,
    vatMode: "include",
    vatPct: 21,
    dealNet: B,
    invoiceNet: 1000,
    invoiceTotal: 1210,
    invoiceVat: 210,
    whiteVatMode: "add",
    cashAmt: 0,
    splitVatOnTop: false,
  };
  ok("PDF white always 1210", near(M.leadWhiteClientPay(splitVat), 1210));
  ok("swallow: final = B", near(M.leadSplitFinalPrice(splitVat), B, 0.05), "got " + M.leadSplitFinalPrice(splitVat));
  ok("swallow: cash = B − T", near(M.leadSuggestedCashAmt(splitVat), B - 1210, 0.05), "got " + M.leadSuggestedCashAmt(splitVat));
  splitVat.splitVatOnTop = true;
  ok("charge: final = B + V", near(M.leadSplitFinalPrice(splitVat), B + 210, 0.05), "got " + M.leadSplitFinalPrice(splitVat));
  ok("charge: cash = B − W", near(M.leadSuggestedCashAmt(splitVat), B - 1000, 0.05), "got " + M.leadSuggestedCashAmt(splitVat));
  splitVat.cashAmt = B - 1000;
  splitVat.cashAmtUser = true;
  ok("charge: client = T + cash", near(M.leadClientTotal(splitVat), 1210 + (B - 1000), 0.05));
}

/* ---- Lead source ---- */
console.log("\n[Lead source model]");
ok("constrain other", M.constrainLeadSource("agency") === "other");
ok("constrain captain", M.constrainLeadSource("captain") === "captain");
ok("website → captain", M.constrainLeadSource("website") === "captain");
ok("paul → clickboat", M.constrainLeadSource("paul") === "clickboat");
ok("clickboat", M.constrainLeadSource("clickboat") === "clickboat");
ok("owner → ownersourced", M.constrainLeadSource("owner") === "ownersourced");
ok("owner-days → ownersourced", M.constrainLeadSource("owner-days") === "ownersourced");
ok("owner-sourced → ownersourced", M.constrainLeadSource("owner-sourced") === "ownersourced");
ok("ownersourced", M.constrainLeadSource("ownersourced") === "ownersourced");
ok("private → ownersourced", M.constrainLeadSource("private") === "ownersourced");
ok("pending source", M.constrainLeadSource("pending") === "pending");
ok("pending rate 0", M.leadCommissionRatePct({ leadSource: "pending" }) === 0);
ok("dayoff source", M.constrainLeadSource("dayoff") === "dayoff");
ok("off → dayoff", M.constrainLeadSource("off") === "dayoff");
ok("day off is dayoff", !!M.leadIsDayOff({ leadSource: "dayoff", start: "2026-08-10" }));
ok("day off flag", !!M.leadIsDayOff({ dayOff: true, name: "Day off" }));
ok(
  "day off not commercial income",
  !M.leadIsClosedCommercialIncome({ leadSource: "dayoff", dealClosed: true, total: 0, id: "x" })
);
ok("day off rate 0", M.leadCommissionRatePct({ leadSource: "dayoff" }) === 0);
ok("ICS Off title", !!M.isIcsOffSummary("Off — maintenance"));
ok(
  "day off label",
  M.dayOffLabelFromSummary("Off — engine service") === "Day off — engine service"
);
ok("isCaptainLead", M.isCaptainLead({ leadSource: "captain" }));
ok("not captain", !M.isCaptainLead({ leadSource: "other" }));
ok("clickboat no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "clickboat" }));
ok("owner aliased no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "owner" }));
ok("ownersourced no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "ownersourced" }));
ok("captain earns captain flag", M.leadEarnsCaptainCommission({ leadSource: "captain" }));
ok("clickboat rate 24%", M.leadCommissionRatePct({ leadSource: "clickboat" }) === 24);
ok("captain default rate 10%", M.leadCommissionRatePct({ leadSource: "captain" }) === 10);
ok("captain book constant 10", M.CAPTAIN_COMMISSION_PCT === 10);
ok("captain target constant 15", M.CAPTAIN_COMMISSION_TARGET_PCT === 15);
ok("captain stamp 15%", M.leadCommissionRatePct({ leadSource: "captain", captainCommPct: 15 }) === 15);
ok("captain force preview 15%", M.leadCommissionRatePct({ leadSource: "captain" }, 15) === 15);
ok("stamp ignored when force 10", M.leadCommissionRatePct({ leadSource: "captain", captainCommPct: 15 }, 10) === 10);
ok("ownersourced provider rate 10%", M.leadCommissionRatePct({ leadSource: "ownersourced" }) === 10);
ok("ownersourced provider force 15%", M.leadCommissionRatePct({ leadSource: "ownersourced" }, 15) === 15);
ok("ownersourced book constant 10", M.OWNER_SOURCED_COMMISSION_PCT === 10);
ok("ownersourced target constant 15", M.OWNER_SOURCED_COMMISSION_TARGET_PCT === 15);
ok("ownersourced list discount 20%", M.OWNER_SOURCED_LIST_DISCOUNT === 0.2);
ok("clickboat earns commission", M.leadEarnsCommission({ leadSource: "clickboat" }));
ok("ownersourced not captain/CB payable", !M.leadEarnsCommission({ leadSource: "ownersourced" }));
ok("owner alias is ownersourced lead", M.isOwnerSourcedLead({ leadSource: "owner" }));
ok("isOwnerLead false after alias", !M.isOwnerLead({ leadSource: "owner" }));
ok("ownersourced is not owner days", !M.isOwnerLead({ leadSource: "ownersourced" }));
ok("isOwnerSourcedLead", M.isOwnerSourcedLead({ leadSource: "ownersourced" }));
ok("label owner alias", M.leadSourceLabel("owner") === "Owner-sourced");
ok("label owner-sourced", M.leadSourceLabel("ownersourced") === "Owner-sourced");
{
  const cb = M.leadCommissionParts({
    leadSource: "clickboat",
    total: 4000,
    vatMode: "include",
    vatPct: 21,
  });
  const base = 4000 / 1.21;
  ok("clickboat base before VAT", Math.abs(cb.base - base) < 0.05, "got " + cb.base);
  ok("clickboat 24% of base", Math.abs(cb.total - base * 0.24) < 0.05, "got " + cb.total);
  /* owner source aliases to ownersourced — no separate benefits bucket */
  ok(
    "aliased owner never owner benefit",
    !M.ownerBenefitIncluded({ id: "own1", leadSource: "owner", dealClosed: true })
  );
  ok(
    "ownersourced never owner benefit",
    !M.ownerBenefitIncluded({ id: "os1", leadSource: "ownersourced", dealClosed: true })
  );
  const os = M.leadCommissionParts({
    leadSource: "ownersourced",
    total: 4000,
    vatMode: "include",
    vatPct: 21,
  });
  const osBase = 4000 / 1.21;
  ok("ownersourced base before VAT > 0", os.base > 0);
  ok("ownersourced provider commission 10%", Math.abs(os.total - osBase * 0.1) < 0.05, "got " + os.total);
  ok("ownersourced force 15%", Math.abs(M.leadCommissionParts({ leadSource: "ownersourced", total: 4000, vatMode: "include", vatPct: 21 }, 15).total - osBase * 0.15) < 0.05);
  {
    const osLead = {
      leadSource: "ownersourced",
      start: "2026-05-10",
      dur: "8h",
      deps: "Not issued",
      fins: "Not issued",
      apas: "Not issued",
    };
    const list = M.ownerSourcedListPrice(osLead);
    ok("OS list 8h low €3000", list === 3000, "got " + list);
    const notional = M.ownerSourcedNotionalPrice(osLead);
    ok("OS notional list−20%", Math.abs(notional - 2400) < 0.05, "got " + notional);
    ok("OS recognized 0 without invoice", M.ownerSourcedRecognizedIncome(osLead) === 0);
    ok("OS possible loss = notional", Math.abs(M.ownerSourcedPossibleLoss(osLead) - 2400) < 0.05);
    const fair = M.ownerSourcedCommissionParts(osLead);
    ok("OS forgone at 10%", Math.abs(fair.forgoneComm - (2400 / 1.21) * 0.1) < 0.05, "got " + fair.forgoneComm);
    ok("OS income comm 0 when nothing issued", fair.incomeComm === 0);
    const issued = Object.assign({}, osLead, { deps: "Issued", dep: 1000, fins: "Paid", fin: 1400 });
    ok("OS recognized dep+fin", Math.abs(M.ownerSourcedRecognizedIncome(issued) - 2400) < 0.05);
    ok("OS loss 0 when fully invoiced at notional", M.ownerSourcedPossibleLoss(issued) === 0);
    const partial = Object.assign({}, osLead, { deps: "Issued", dep: 500 });
    ok("OS partial recognized 500", M.ownerSourcedRecognizedIncome(partial) === 500);
    ok("OS partial loss 1900", Math.abs(M.ownerSourcedPossibleLoss(partial) - 1900) < 0.05);
    const fair15 = M.ownerSourcedCommissionParts(osLead, 15);
    ok("OS forgone force 15%", Math.abs(fair15.forgoneComm - (2400 / 1.21) * 0.15) < 0.05);
    const high = { leadSource: "ownersourced", start: "2026-07-15", dur: "4h" };
    ok("OS list 4h high €2200", M.ownerSourcedListPrice(high) === 2200);
    ok("OS notional 4h high −20%", Math.abs(M.ownerSourcedNotionalPrice(high) - 1760) < 0.05);
  }
  ok("cash dest boat default", M.leadCashDest({ split: true, cashAmt: 1800 }) === "boat");
  ok("cash dest owner", M.leadCashDest({ cashDest: "owner" }) === "owner");
  ok(
    "owner pocket cash when settled",
    M.leadOwnerPocketCashAmt({
      split: true,
      cashAmt: 1800,
      cashDest: "owner",
      cashSettled: true,
      invoiceTotal: 1210,
    }) === 1800
  );
  ok(
    "owner pocket not on boat",
    !M.leadFreeCashIsOnBoat({
      split: true,
      cashAmt: 1800,
      cashDest: "owner",
      cashSettled: true,
      invoiceTotal: 1210,
    })
  );
  ok(
    "boat cash on boat when settled",
    M.leadFreeCashIsOnBoat({
      split: true,
      cashAmt: 1800,
      cashDest: "boat",
      cashSettled: true,
      invoiceTotal: 1210,
    })
  );
  ok(
    "owner pocket zero until received",
    M.leadOwnerPocketCashAmt({
      split: true,
      cashAmt: 1800,
      cashDest: "owner",
      cashSettled: false,
      fins: "Not issued",
      invoiceTotal: 1210,
    }) === 0
  );
  {
    const cashSum = M.summarizeLeadCashIncome([
      {
        id: "c1",
        name: "Boat guest",
        start: "2026-08-01",
        split: true,
        cashAmt: 1800,
        cashDest: "boat",
        cashSettled: true,
        invoiceTotal: 1210,
        leadSource: "captain",
      },
      {
        id: "c2",
        name: "Thomas",
        start: "2026-08-06",
        split: true,
        cashAmt: 2000,
        cashDest: "owner",
        cashSettled: true,
        invoiceTotal: 1210,
        leadSource: "ownersourced",
      },
      {
        id: "c3",
        name: "Pending cash",
        start: "2026-08-10",
        split: true,
        cashAmt: 500,
        cashDest: "boat",
        cashSettled: false,
        fins: "Not issued",
        invoiceTotal: 1210,
        leadSource: "captain",
      },
      {
        id: "c4",
        name: "Not split",
        start: "2026-08-12",
        total: 4000,
        leadSource: "captain",
      },
    ]);
    ok("cash sum total boat+owner", Math.abs(cashSum.total - 3800) < 0.02, "got " + cashSum.total);
    ok("cash sum boat 1800", Math.abs(cashSum.boat - 1800) < 0.02);
    ok("cash sum owner pocket 2000", Math.abs(cashSum.owner - 2000) < 0.02);
    ok("cash sum skips pending", cashSum.n === 2);
    ok("cash sum items 2", cashSum.items.length === 2);
    ok("cash sum no charges concept", cashSum.boatN === 1 && cashSum.ownerN === 1);
    const thomas = {
      id: "c2",
      name: "Thomas",
      start: "2026-08-06",
      split: true,
      cashAmt: 2000,
      cashDest: "owner",
      cashSettled: true,
      invoiceTotal: 1210,
      invoiceNet: 1000,
      whiteVatMode: "add",
      vatPct: 21,
      leadSource: "ownersourced",
      dealClosed: true,
    };
    const parts = M.leadProjectedNetParts(thomas);
    ok("projected net parts exclude cash", Math.abs(parts.cashBlack - 2000) < 0.02 || parts.cashBlack >= 0);
    ok("projected net ex is white only not +cash", parts.ex < 1500, "got " + parts.ex);
    ok("projected net does not equal white+cash", parts.ex + 0.01 < 2000 + parts.ex);
    const proj = M.summarizeProjectedNetExCash([thomas]);
    ok("summarize projected net is white-only net", Math.abs(proj.net - parts.net) < 0.02);
    const tot = M.summarizeTotalNetIncome(proj.net, [thomas]);
    ok("total net = projected + cash", Math.abs(tot.totalNet - (proj.net + 2000)) < 0.02, "got " + tot.totalNet);
    ok("total net cash additive full cash", Math.abs(tot.cashAdditive - 2000) < 0.02);
    const tot2 = M.summarizeTotalNetIncome(5000, [
      {
        id: "open1",
        name: "Open cash",
        split: true,
        cashAmt: 900,
        cashDest: "boat",
        cashSettled: true,
        invoiceTotal: 1210,
        leadSource: "captain",
        dealClosed: false,
      },
    ]);
    ok("total net adds cash income", Math.abs(tot2.totalNet - 5900) < 0.02, "got " + tot2.totalNet);
  }
  ok("deal closed explicit true", M.leadIsDealClosed({ id: "a", dealClosed: true }));
  ok("deal closed explicit false", !M.leadIsDealClosed({ id: "b", dealClosed: false }));
  ok("deal closed legacy undefined = closed", M.leadIsDealClosed({ id: "c" }));
  ok("deal closed new draft = open", !M.leadIsDealClosed({ dealClosed: undefined }));

  /* Commission biz as-of day — unstarted future charters stay out */
  {
    ok(
      "asOf mid-month is today not month-end",
      M.commissionBizAsOfDay("2026-08", "2026-08-12") === "2026-08-12"
    );
    ok(
      "asOf past month freezes at month-end",
      M.commissionBizAsOfDay("2026-07", "2026-08-12") === "2026-07-31"
    );
    const past = { id: "p", start: "2026-08-06", name: "Past" };
    const future = { id: "f", start: "2026-08-21", name: "Aoife" };
    ok(
      "completed charter in through+asOf",
      M.leadInCommissionBizScope(past, "2026-08", "through", "2026-08-12")
    );
    ok(
      "unstarted future charter out of through+asOf",
      !M.leadInCommissionBizScope(future, "2026-08", "through", "2026-08-12")
    );
    const biz = M.summarizeCaptainLeadBizAsOf(
      [
        {
          id: "p",
          start: "2026-07-25",
          name: "Hollman",
          leadSource: "captain",
          dealClosed: true,
          price: 2000,
          rate: 2000,
          vatMode: "include",
          vatPct: 21,
        },
        {
          id: "f",
          start: "2026-08-21",
          name: "Aoife",
          leadSource: "captain",
          dealClosed: true,
          price: 6000,
          rate: 6000,
          vatMode: "include",
          vatPct: 21,
        },
      ],
      "2026-08",
      "through",
      "2026-08-12"
    );
    ok("asOf biz n excludes future Aoife", biz.n === 1, "n=" + biz.n);
    ok("asOf biz name is past only", biz.items[0] && biz.items[0].name === "Hollman");
  }
}

/* ---- Seasonal charter pricing ---- */
console.log("\n[Charter price from event]");
{
  const half = M.charterPriceFromEvent({
    start: "2026-05-10",
    end: "2026-05-10",
    startTime: "10:00",
    endTime: "14:00",
    summary: "Guest half day",
  });
  ok("May is low season", half.season === "low");
  ok("4h low €1700", half.dur === "4h" && half.total === 1700, JSON.stringify(half));
  const highFull = M.charterPriceFromEvent({
    start: "2026-07-20",
    end: "2026-07-20",
    startTime: "10:00",
    endTime: "18:00",
    summary: "Full day",
  });
  ok("Jul high season", highFull.season === "high");
  ok("8h high €4000", highFull.dur === "8h" && highFull.total === 4000, JSON.stringify(highFull));
  /* Clock wins over stale title (12–20 is 8h even if title still says 6h) */
  const clockBeatsTitle = M.charterPriceFromEvent({
    start: "2026-08-08",
    end: "2026-08-08",
    startTime: "12:00",
    endTime: "20:00",
    summary: "Henry 6h charter NA",
  });
  ok(
    "12–20 clock → 8h despite 6h in title",
    clockBeatsTitle.dur === "8h",
    JSON.stringify(clockBeatsTitle)
  );
  /* Title hours only when no clock (all-day / missing times) */
  const titleOnly = M.charterPriceFromEvent({
    start: "2026-05-10",
    end: "2026-05-10",
    allDay: true,
    summary: "Guest 6h hold",
  });
  ok("all-day title 6h", titleOnly.dur === "6h", JSON.stringify(titleOnly));
  const multi = M.charterPriceFromEvent({
    start: "2026-07-17",
    end: "2026-07-20",
    allDay: true,
    days: ["2026-07-17", "2026-07-18", "2026-07-19"],
    summary: "Multi guest",
  });
  ok("multi days", multi.dur === "multi" && multi.days === 3, JSON.stringify(multi));
  ok("multi high 3×4000", multi.total === 12000, "got " + multi.total);
  ok("guest name", M.guestNameFromIcsSummary("Alvaro - stew Laura") === "Alvaro");
  ok("off day", M.isIcsOffSummary("Off — maintenance"));
}

/* ---- Charge bill type ---- */
console.log("\n[Charge bill type]");
ok("explicit cash", M.chargeBillType({ billType: "cash", amount: 100 }) === "cash");
ok("explicit mix", M.chargeBillType({ billType: "mix", amount: 100, cashPaid: 40 }) === "mix");
ok("constrain junk → invoice", M.constrainBillType("foo") === "invoice");
ok(
  "cash part of mix",
  near(M.chargeCashPart({ billType: "mix", amount: 1000, cashPaid: 300 }), 300)
);
ok(
  "invoice part of mix",
  near(M.chargeInvoicePart({ billType: "mix", amount: 1000, cashPaid: 300 }), 700)
);

/* ---- Charge commission: explicit only ---- */
console.log("\n[Charge commission — explicit only]");
{
  const oliver = {
    amount: 1050,
    vatMode: "include",
    vatPct: 21,
    billType: "invoice",
    notes: "Extra 3 hours",
    captainComm: true,
    extHours: 3,
  };
  const p = M.chargeCommissionParts(oliver);
  ok("extension with flag: base strips VAT", near(p.base, 1050 / 1.21, 0.05), "got " + p.base);
  ok("extension commission ~86.78 at 10%", near(p.total, (1050 / 1.21) * 0.1, 0.05), "got " + p.total);
  ok("extension at 15% force", near(M.chargeCommissionParts(oliver, 15).total, (1050 / 1.21) * 0.15, 0.05));
  ok("hours from field", p.hours === 3);
}
{
  const noFlag = {
    amount: 1050,
    vatMode: "include",
    vatPct: 21,
    notes: "Extra 3 hours",
    captainComm: false,
  };
  ok("notes alone do NOT enable commission", M.chargeCommissionAmt(noFlag) === 0);
  ok("isChargeCaptainComm false", !M.isChargeCaptainComm(noFlag));
}
{
  const off = { amount: 500, captainComm: false, notes: "extension" };
  ok("explicit false wins", !M.isChargeCaptainComm(off));
}
/* Extra hour €500 — cash vs invoice commission */
{
  const cashH = {
    amount: 500,
    billType: "cash",
    vatMode: "none",
    captainComm: true,
    extHours: 1,
    notes: "Extra 1 hour",
  };
  const p = M.chargeCommissionParts(cashH);
  ok("€500 cash: base is full 500 (no VAT)", near(p.base, 500), "got " + p.base);
  ok("€500 cash: commission €50 at 10%", near(p.total, 50), "got " + p.total);
  ok("€500 cash: mode cash", p.mode === "cash");
  ok("€500 cash: 15% force €75", near(M.chargeCommissionParts(cashH, 15).total, 75));
}
{
  const invH = {
    amount: 500,
    billType: "invoice",
    vatMode: "include",
    vatPct: 21,
    captainComm: true,
    extHours: 1,
    notes: "Extra 1 hour",
  };
  const p = M.chargeCommissionParts(invH);
  ok("€500 invoice: base before VAT ≈ 413.22", near(p.base, 500 / 1.21, 0.05), "got " + p.base);
  ok("€500 invoice: commission ≈ 41.32 at 10%", near(p.total, (500 / 1.21) * 0.1, 0.05), "got " + p.total);
  ok("€500 invoice: mode invoice", p.mode === "invoice");
}
{
  const sum = M.summarizeCaptainChargeCommissions([
    {
      amount: 500,
      extAmt: 500,
      extSettle: "cash",
      captainComm: true,
      client: "Extra hour",
      date: "2026-08-01",
    },
    {
      amount: 1300,
      apaBaseAmt: 800,
      extAmt: 500,
      extSettle: "invoice",
      vatMode: "include",
      vatPct: 21,
      captainComm: true,
      client: "APA+ext",
      date: "2026-08-02",
    },
    {
      amount: 400,
      captainComm: false,
      client: "No flag",
      date: "2026-08-03",
    },
  ]);
  ok("captain upsell sum n=2", sum.n === 2);
  ok(
    "captain upsell comm cash+inv at 10%",
    near(sum.comm, 50 + (500 / 1.21) * 0.1, 0.05),
    "got " + sum.comm
  );
  ok(
    "captain upsell ignores no-flag",
    sum.items.every(function (it) {
      return it.client !== "No flag";
    })
  );
  ok("extAmt-only with captainComm counts", M.isChargeCaptainComm({ extAmt: 500, captainComm: true, amount: 0 }));
  ok(
    "extAmt-only summary n=1",
    M.summarizeCaptainChargeCommissions([{ extAmt: 500, extSettle: "cash", captainComm: true, amount: 0, client: "Ext only" }]).n === 1
  );
}
/* Same bill: APA spend + extension — commission only on extension */
console.log("\n[APA charge + extension same bill]");
{
  const t = M.chargeTotalsFromApaAndExt(800, 500, "invoice");
  ok("invoice settle: total 1300", near(t.amount, 1300));
  ok("invoice settle: billType invoice", t.billType === "invoice");
  ok("invoice settle: cash 0", near(t.cashPaid, 0));
}
{
  const t = M.chargeTotalsFromApaAndExt(800, 500, "cash");
  ok("cash settle: total 1300", near(t.amount, 1300));
  ok("cash settle: mix", t.billType === "mix");
  ok("cash settle: cash part 500", near(t.cashPaid, 500));
}
{
  const ch = {
    amount: 1300,
    billType: "invoice",
    vatMode: "include",
    vatPct: 21,
    apaBaseAmt: 800,
    extAmt: 500,
    extSettle: "invoice",
    captainComm: true,
    extHours: 1,
  };
  const p = M.chargeCommissionParts(ch);
  ok("same-bill inv: commission only on €500", near(p.gross, 500));
  ok("same-bill inv: base before VAT", near(p.base, 500 / 1.21, 0.05));
  ok("same-bill inv: not 10% of 1300", !near(p.total, (1300 / 1.21) * 0.1, 1));
  ok("same-bill inv: 10% of ext only", near(p.total, (500 / 1.21) * 0.1, 0.05));
}
{
  const ch = {
    amount: 1300,
    billType: "mix",
    cashPaid: 500,
    extAmt: 500,
    extSettle: "cash",
    captainComm: true,
    vatMode: "include",
    vatPct: 21,
  };
  const p = M.chargeCommissionParts(ch);
  ok("same-bill cash ext: base 500", near(p.base, 500));
  ok("same-bill cash ext: comm €50 at 10%", near(p.total, 50));
}

console.log("\n[APA paid → pot: base only, not extension]");
{
  const ch = { amount: 1300, apaBaseAmt: 800, extAmt: 500 };
  ok("pot credit is 800 not 1300", near(M.chargeApaBaseTowardPot(ch), 800));
}
{
  const ch = { amount: 500, extAmt: 500 }; /* extension-only */
  ok("ext-only toward pot is 0", near(M.chargeApaBaseTowardPot(ch), 0));
}
{
  const ch = { amount: 300 }; /* pure shortfall, no fields */
  ok("legacy shortfall full amount", near(M.chargeApaBaseTowardPot(ch), 300));
}

/* ---- Expenses / petty envelope (structured only) ---- */
console.log("\n[Expenses — reimbursement & petty (no description regex)]");
{
  const shop = {
    amount: 60,
    category: "Provisions",
    payMethod: "Cash",
    paidFrom: "Own money",
    paidById: "stew-toni",
    description: "repaid Toni pocket", // free text must NOT reclassify
  };
  ok("shop own-money is NOT reimbursement (ignore description)", !M.isExpenseReimbursement(shop));
  ok("shop does not hit petty", !M.expenseHitsPettyCash(shop));
  const c = M.classifyExpenseCash(shop);
  ok("shop hits own-money pocket", c.hitsOwnMoneyPocket);
}
{
  const reimb = {
    amount: 60,
    category: "Crew reimbursement",
    payMethod: "Cash",
    paidFrom: "Petty cash",
    reimburseToId: "stew-toni",
    reimburseCrew: true,
  };
  ok("crew reimburse is reimbursement", M.isExpenseReimbursement(reimb));
  ok("crew reimburse hits petty", M.expenseHitsPettyCash(reimb));
  const c = M.classifyExpenseCash(reimb);
  ok("clears Toni pocket", c.clearsPocketFor === "stew-toni");
  ok("paidFrom petty", c.paidFrom === "petty");
}
{
  const reimbOwn = {
    amount: 200,
    category: "Crew reimbursement",
    payMethod: "Cash",
    paidFrom: "Own money",
    paidById: "captain",
    reimburseToId: "stew-vicky",
    reimburseCrew: true,
  };
  ok("own-money reimburse does NOT hit petty", !M.expenseHitsPettyCash(reimbOwn));
  const c = M.classifyExpenseCash(reimbOwn);
  ok("clears Vicky pocket", c.clearsPocketFor === "stew-vicky");
  ok("captain is payer claim", c.ownMoneyPayerId === "captain");
}
{
  const blank = {
    amount: 60,
    category: "Crew reimbursement",
    payMethod: "Cash",
    paidFrom: "",
    reimburseToId: "stew-toni",
    reimburseCrew: true,
  };
  ok("blank paidFrom on reimburse defaults to petty hit", M.expenseHitsPettyCash(blank));
}
{
  const linked = { amount: 60, reimbursesExpenseId: "exp-1", payMethod: "Cash", paidFrom: "Petty cash" };
  ok("reimbursesExpenseId alone marks reimbursement", M.isExpenseReimbursement(linked));
}
{
  const n = M.normalizeExpenseReimbursement({
    amount: 60,
    category: "Crew reimbursement",
    reimburseToId: "stew-toni",
    reimburseCrew: true,
    paidFrom: "",
    payMethod: "Cash",
  });
  ok("normalize sets Petty cash", n.expense.paidFrom === "Petty cash");
  ok("normalize keeps reimburseToId", n.expense.reimburseToId === "stew-toni");
}

/* ---- Manual Crew Salaries (Expenses + captain salary) ---- */
console.log("\n[Expenses — manual Crew Salaries not stew day-pay]");
{
  const manualUnpaid = {
    id: "sal-1",
    source: "manual",
    category: "Crew Salaries",
    vendor: "Captain",
    amount: 2500,
    payMethod: "Cash",
    paidFrom: "Petty cash",
    crewPayStatus: "Unpaid",
  };
  const manualPaid = Object.assign({}, manualUnpaid, { crewPayStatus: "Paid" });
  const manualOwnerPaid = {
    id: "sal-owner-2k",
    source: "manual",
    category: "Crew Salaries",
    vendor: "Captain",
    amount: 2000,
    payMethod: "Cash",
    paidFrom: "Owner money",
    paidById: "owner",
    crewPayStatus: "Paid",
    floatPay: false,
  };
  const bareSalaryNoSource = {
    id: "sal-bare",
    category: "Crew Salaries",
    vendor: "Captain",
    amount: 2500,
    payMethod: "Cash",
    paidFrom: "Petty cash",
    crewPayStatus: "Paid",
  };
  const stewCatOnly = {
    id: "stew-legacy",
    category: "Crew Salaries",
    amount: 200,
    crewPayStatus: "Unpaid",
    stewId: "toni",
    stewEventKey: "evt1",
  };
  ok("manual salary is NOT day-pay", !M.isCrewDayPayExpense(manualUnpaid));
  ok("bare Crew Salaries (no source) is NOT day-pay", !M.isCrewDayPayExpense(bareSalaryNoSource));
  ok("stew-linked Crew Salaries still day-pay", M.isCrewDayPayExpense(stewCatOnly));
  ok("manual unpaid does NOT hit petty", !M.expenseHitsPettyCash(manualUnpaid));
  ok("manual Paid + petty hits petty", M.expenseHitsPettyCash(manualPaid));
  ok("manual Paid + Owner money does NOT hit petty", !M.expenseHitsPettyCash(manualOwnerPaid));
  ok("manual Owner money classifies as owner", M.expensePaidFrom(manualOwnerPaid) === "owner");
  ok("bare Paid + petty still hits petty (ledger salary)", M.expenseHitsPettyCash(bareSalaryNoSource));
}

/* ---- Petty cash on board (collapse crew dupes; floatPay only) ---- */
console.log("\n[Petty cash — crew day-pay collapse & floatPay]");
{
  ok("Paid alone does NOT hit petty", !M.crewDayPayHitsPetty({
    source: "stew", stewPayKind: "dayPay", stewId: "t1", date: "2026-07-30",
    crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: false, amount: 150
  }));
  ok("floatPay true hits petty", M.crewDayPayHitsPetty({
    source: "stew", stewPayKind: "dayPay", stewId: "t1", date: "2026-07-30",
    crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 50
  }));
  ok("own money crew does not hit petty", !M.crewDayPayHitsPetty({
    source: "stew", stewPayKind: "dayPay", stewId: "t1", date: "2026-07-30",
    crewPayStatus: "Paid", paidFrom: "Own money", floatPay: true, amount: 50
  }));
  const finger = M.crewDayPayFinger({ stewId: "toni", stewEventKey: "uid:abc", date: "2026-07-30" });
  ok("finger stew|eventKey", finger === "toni|uid:abc");
  const fingerDate = M.crewDayPayFinger({ stewId: "toni", date: "2026-07-30" });
  ok("finger stew|date fallback", fingerDate === "toni|2026-07-30");
  /* Two renames same charter (same eventKey): 150 phantom + 50 real — collapse to one */
  const dupes = [
    {
      id: "old", linkId: "stew-day:uid:abc:toni", source: "stew", stewPayKind: "dayPay",
      stewId: "toni", stewEventKey: "uid:abc", date: "2026-07-30", crewPayStatus: "Paid", paidFrom: "Petty cash",
      floatPay: true, amount: 150, updatedAt: "2026-07-30T10:00:00.000Z"
    },
    {
      id: "new", linkId: "stew-day:uid:abc:toni", source: "stew", stewPayKind: "dayPay",
      stewId: "toni", stewEventKey: "uid:abc", date: "2026-07-30", crewPayStatus: "Paid", paidFrom: "Petty cash",
      floatPay: true, amount: 50, payStatusManual: true, updatedAt: "2026-07-30T18:00:00.000Z"
    },
    { id: "shop", category: "Provisions", payMethod: "Cash", paidFrom: "Petty cash", amount: 20 }
  ];
  const col = M.collapseCrewDayPayExpenses(dupes);
  ok("collapse removes 1 crew dupe", col.collapsed === 1, "got " + col.collapsed);
  ok("winner is newest manual €50", col.winnerByFinger["toni|uid:abc"] && col.winnerByFinger["toni|uid:abc"].id === "new");
  /* Two different charters same stew same pay-date must BOTH hit petty */
  const twoCharters = [
    {
      id: "diego", linkId: "stew-day:uid:diego:laura", source: "stew", stewPayKind: "dayPay",
      stewId: "laura", stewEventKey: "uid:diego", date: "2026-08-03",
      crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 200
    },
    {
      id: "dominik", linkId: "stew-day:uid:dominik:laura", source: "stew", stewPayKind: "dayPay",
      stewId: "laura", stewEventKey: "uid:dominik", date: "2026-08-03",
      crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 200
    }
  ];
  const col2 = M.collapseCrewDayPayExpenses(twoCharters);
  ok("two charters same day not collapsed", col2.collapsed === 0, "got " + col2.collapsed);
  const sum2 = M.summarizePettyCash({ pettyStart: 500, cashIns: [], expenses: twoCharters });
  ok("two charters both hit petty 400", near(sum2.cashOut, 400), "cashOut " + sum2.cashOut);
  const sum = M.summarizePettyCash({
    pettyStart: 50,
    cashIns: [],
    expenses: dupes
  });
  /* start 50 − winner 50 − shop 20 = books −20; physical never negative */
  ok("petty does not double-count 150+50", near(sum.cashOut, 70), "cashOut " + sum.cashOut);
  ok("physical on board floors at 0", near(sum.pettyOnboard, 0), "got " + sum.pettyOnboard);
  ok("pettyCash alias is physical ≥ 0", near(sum.pettyCash, 0), "got " + sum.pettyCash);
  ok("booksBalance is −20", near(sum.booksBalance, -20), "got " + sum.booksBalance);
  ok("cashShort is 20 (separate from physical)", near(sum.cashShort, 20), "got " + sum.cashShort);
  ok("nCrewPetty is 1", sum.nCrewPetty === 1, "got " + sum.nCrewPetty);
  /* Toni only €50 from last €50 on board → petty 0 */
  const toniOnly = M.summarizePettyCash({
    pettyStart: 50,
    cashIns: [],
    expenses: [{
      id: "toni50", source: "stew", stewPayKind: "dayPay", stewId: "toni", date: "2026-07-30",
      crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 50
    }]
  });
  ok("Toni €50 from €50 → petty 0", near(toniOnly.pettyCash, 0), "got " + toniOnly.pettyCash);
  ok("Toni cashOut 50", near(toniOnly.cashOut, 50));
  ok("Toni no short when exact", near(toniOnly.cashShort, 0), "got " + toniOnly.cashShort);
  /* Prior paid does not move petty */
  const prior = M.summarizePettyCash({
    pettyStart: 50,
    cashIns: [],
    expenses: [{
      id: "prior", source: "stew", stewPayKind: "dayPay", stewId: "toni", date: "2026-07-29",
      crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: false, amount: 150
    }]
  });
  ok("prior Paid leaves petty at 50", near(prior.pettyCash, 50), "got " + prior.pettyCash);
  ok("prior cashOut 0", near(prior.cashOut, 0));
  /*
   * Invented floatPay on empty envelope (the −€250 overnight bug):
   * physical on board = 0, books short = 250. Never show physical as −250.
   */
  const overnight = {
    id: "on1", source: "stew", stewPayKind: "dayPay", stewId: "laura", vendor: "Laura",
    date: "2026-07-15", crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 250
  };
  const beforeHeal = M.summarizePettyCash({ pettyStart: 0, cashIns: [], expenses: [overnight] });
  ok("empty pot + floatPay: physical 0", near(beforeHeal.pettyOnboard, 0), "got " + beforeHeal.pettyOnboard);
  ok("empty pot + floatPay: books short 250", near(beforeHeal.cashShort, 250), "got " + beforeHeal.cashShort);
  ok("empty pot + floatPay: booksBalance −250", near(beforeHeal.booksBalance, -250), "got " + beforeHeal.booksBalance);
  ok("shortLines names crew day pay", beforeHeal.shortLines && beforeHeal.shortLines.length === 1
    && beforeHeal.shortLines[0].kind === "crew"
    && near(beforeHeal.shortLines[0].amount, 250));
  ok("shortLines label has Laura", beforeHeal.shortLines[0].label && /Laura/i.test(beforeHeal.shortLines[0].label));
  /* Poison negative start is residue short, not physical cash */
  const poisonStart = M.summarizePettyCash({ pettyStart: -250, cashIns: [], expenses: [] });
  ok("poison start −250 → physical 0", near(poisonStart.pettyOnboard, 0));
  ok("poison start −250 → short 250", near(poisonStart.cashShort, 250), "got " + poisonStart.cashShort);
  ok("poison start priorStartShort 250", near(poisonStart.priorStartShort, 250));
  ok("poison start shortLines prior-start", poisonStart.shortLines && poisonStart.shortLines[0]
    && poisonStart.shortLines[0].kind === "prior-start"
    && near(poisonStart.shortLines[0].amount, 250));
  /*
   * Brought-forward boat short: last month empty but boat owed €110.
   * New cash-in pays the hole first and leaves less on board.
   */
  const brought = M.summarizePettyCash({
    pettyStart: 0,
    broughtForwardShort: 110,
    cashIns: [{ id: "in1", amount: 500, date: "2026-08-01" }],
    expenses: []
  });
  ok("brought-forward €110 + cash-in €500 → onboard 390", near(brought.pettyOnboard, 390), "got " + brought.pettyOnboard);
  ok("brought-forward priorSettled 110", near(brought.priorSettled, 110), "got " + brought.priorSettled);
  ok("brought-forward short residual 0", near(brought.cashShort, 0), "got " + brought.cashShort);
  ok("brought-forward cashOut includes prior settle", near(brought.cashOut, 110), "got " + brought.cashOut);
  ok("brought-forward virtual cash-out line", brought.cashOutLines && brought.cashOutLines.some(function (r) {
    return r && r.virtual && near(r.amount, 110);
  }));
  /* Negative start with cash-in also absorbs the hole */
  const poisonPaid = M.summarizePettyCash({
    pettyStart: -110,
    cashIns: [{ id: "in2", amount: 200, date: "2026-08-02" }],
    expenses: []
  });
  ok("poison −110 + cash 200 → onboard 90", near(poisonPaid.pettyOnboard, 90), "got " + poisonPaid.pettyOnboard);
  ok("poison −110 + cash 200 → short 0", near(poisonPaid.cashShort, 0), "got " + poisonPaid.cashShort);
  /* Partial cover of brought-forward short */
  const partialPrior = M.summarizePettyCash({
    pettyStart: 0,
    broughtForwardShort: 110,
    cashIns: [{ id: "in3", amount: 40, date: "2026-08-03" }],
    expenses: []
  });
  ok("partial prior cover onboard 0", near(partialPrior.pettyOnboard, 0));
  ok("partial prior remain short 70", near(partialPrior.cashShort, 70), "got " + partialPrior.cashShort);
  ok("partial prior settled 40", near(partialPrior.priorSettled, 40));
  /* Partial cover: €50 start, €70 out → short €20 attributed to last out */
  const partial = M.summarizePettyCash({
    pettyStart: 50,
    cashIns: [],
    expenses: [
      { id: "a", category: "Provisions", payMethod: "Cash", paidFrom: "Petty cash", amount: 40, date: "2026-07-01" },
      { id: "b", category: "Provisions", payMethod: "Cash", paidFrom: "Petty cash", amount: 30, date: "2026-07-02" }
    ]
  });
  ok("partial short 20", near(partial.cashShort, 20));
  ok("partial short on second line only", partial.shortLines && partial.shortLines.length === 1
    && partial.shortLines[0].id === "b" && near(partial.shortLines[0].amount, 20)
    && near(partial.shortLines[0].covered, 10));
  const heal = M.clearCrewFloatPayOnEmptyEnvelope([overnight], 0, []);
  ok("heal clears floatPay on empty envelope", heal.changed === true);
  ok("heal marks floatPay false", overnight.floatPay === false);
  ok("Paid status kept (prior books)", overnight.crewPayStatus === "Paid");
  const afterHeal = M.summarizePettyCash({ pettyStart: 0, cashIns: [], expenses: [overnight] });
  ok("after heal physical 0", near(afterHeal.pettyCash, 0), "got " + afterHeal.pettyCash);
  ok("after heal short 0", near(afterHeal.cashShort, 0), "got " + afterHeal.cashShort);
  ok("after heal cashOut 0", near(afterHeal.cashOut, 0));
  /* Real pay from real pot: do NOT clear floatPay */
  const real = {
    id: "r1", source: "stew", stewPayKind: "dayPay", stewId: "toni", date: "2026-07-20",
    crewPayStatus: "Paid", paidFrom: "Petty cash", floatPay: true, amount: 50
  };
  const keep = M.clearCrewFloatPayOnEmptyEnvelope([real], 50, []);
  ok("real pot €50 keeps floatPay", keep.changed === false && real.floatPay === true);
  const realSum = M.summarizePettyCash({ pettyStart: 50, cashIns: [], expenses: [real] });
  ok("real pot ends at 0 after €50 out", near(realSum.pettyCash, 0), "got " + realSum.pettyCash);
  /* Captain commission draws from petty reduce outstanding */
  const draws = [
    { id: "d1", category: "Captain commission", kind: "captainComm", payMethod: "Cash", paidFrom: "Petty cash", amount: 997, date: "2026-08-02" },
    { id: "d2", category: "Captain commission", payMethod: "Cash", paidFrom: "Own money", amount: 100, date: "2026-08-01" } /* not from boat */
  ];
  const paidSum = M.summarizeCaptainCommissionPaid(draws);
  ok("paid total is 997 (own money ignored)", near(paidSum.paid, 997), "got " + paidSum.paid);
  const bal = M.summarizeCaptainCommissionBalance({ earned: 2500, expenses: draws });
  ok("earned 2500", near(bal.earned, 2500));
  ok("outstanding 2500−997", near(bal.outstanding, 1503), "got " + bal.outstanding);
  ok("status partial", bal.status === "partial");
  const balPaid = M.summarizeCaptainCommissionBalance({ earned: 997, expenses: draws });
  ok("fully paid status", balPaid.status === "paid" && near(balPaid.outstanding, 0));
  /* Overpay then return €310 to boat → net paid drops; overpaid clears */
  const overDraws = [
    { id: "d3", category: "Captain commission", kind: "captainComm", payMethod: "Cash", paidFrom: "Petty cash", amount: 1307, date: "2026-08-10" },
  ];
  const retCash = [
    { id: "cin1", kind: "commReturn", source: "Commission return — overpay", amount: 310, date: "2026-08-15", notes: "Overpaid commission put back" },
  ];
  ok(
    "commission return cash-in detected",
    M.isCaptainCommissionReturnCashIn(retCash[0])
  );
  ok(
    "manual note overpay still detected",
    M.isCaptainCommissionReturnCashIn({
      source: "Other — put back commission overpay",
      notes: "returned 310 to boat",
      amount: 310,
    })
  );
  const balOver = M.summarizeCaptainCommissionBalance({
    earned: 997,
    expenses: overDraws,
    cashIns: retCash,
  });
  ok("overpay drawn 1307", near(balOver.drawn, 1307), "got " + balOver.drawn);
  ok("overpay returned 310", near(balOver.returned, 310), "got " + balOver.returned);
  ok("overpay net paid 997", near(balOver.paid, 997), "got " + balOver.paid);
  ok("overpay outstanding 0 after return", near(balOver.outstanding, 0));
  ok("overpay cleared after return", near(balOver.overpaid, 0), "got " + balOver.overpaid);
  ok("overpay status paid after return", balOver.status === "paid");
}

/* ---- Petty cash-in: hand-edited amount must survive auto sync ---- */
console.log("\n[Petty — cash-in amountManual vs lead sync]");
{
  const existing = {
    id: "lead-cash:L1",
    fromLeadId: "L1",
    kind: "charter-fee-cash",
    amount: 4800,
    date: "2026-08-22",
    source: "Charter fee · cash only — Guest",
    amountManual: true,
  };
  const fromLead = {
    id: "lead-cash:L1",
    fromLeadId: "L1",
    kind: "charter-fee-cash",
    amount: 5000,
    date: "2026-08-22",
    source: "Charter fee · cash only — Guest",
    amountManual: false,
  };
  ok("cashInAmountIsManual true", M.cashInAmountIsManual(existing));
  const keep = M.planMergeAutoCashInRow(existing, fromLead, {});
  ok("sync preserves 4800 when amountManual", near(keep.row.amount, 4800) && keep.preservedManual && !keep.changed);
  const forced = M.planMergeAutoCashInRow(existing, fromLead, { force: true });
  ok("lead save force overwrites to 5000", near(forced.row.amount, 5000) && forced.changed && !forced.row.amountManual);
  const create = M.planMergeAutoCashInRow(null, fromLead, {});
  ok("missing row creates from lead", create.changed && near(create.row.amount, 5000));

  const remoteMonth = {
    month: "2026-08",
    updatedAt: "2026-08-22T12:00:00.000Z",
    pettyStart: 1000,
    cashIns: [
      {
        id: "lead-cash:L1",
        fromLeadId: "L1",
        amount: 5000,
        date: "2026-08-22",
        updatedAt: "2026-08-22T12:00:00.000Z",
      },
    ],
  };
  const localMonth = {
    month: "2026-08",
    updatedAt: "2026-08-22T11:00:00.000Z", /* older month shell */
    pettyStart: 1000,
    cashIns: [
      {
        id: "lead-cash:L1",
        fromLeadId: "L1",
        amount: 4800,
        date: "2026-08-22",
        amountManual: true,
        updatedAt: "2026-08-22T11:30:00.000Z",
      },
    ],
  };
  const merged = M.mergeExpPettyMonths([localMonth], [remoteMonth]);
  ok("mergeExpPettyMonths one August row", merged.length === 1);
  ok(
    "merge keeps manual 4800 over newer remote 5000",
    merged[0].cashIns.length === 1 && near(merged[0].cashIns[0].amount, 4800),
    "got " + (merged[0].cashIns[0] && merged[0].cashIns[0].amount)
  );
  /* Phone cash-in must survive a stale desktop month bag (envelope diverge bug) */
  const phoneAug = {
    month: "2026-08",
    pettyStart: 1000,
    updatedAt: "2026-08-20T12:00:00.000Z",
    cashIns: [
      { id: "cash-phone", amount: 250, date: "2026-08-18", source: "Bank / ATM", updatedAt: "2026-08-20T12:00:00.000Z" },
    ],
  };
  const desktopStale = {
    month: "2026-08",
    pettyStart: 1000,
    updatedAt: "2026-08-19T09:00:00.000Z",
    cashIns: [],
  };
  const desktopSep = {
    month: "2026-09",
    pettyStart: 0,
    updatedAt: "2026-09-01T10:00:00.000Z",
    cashIns: [],
  };
  const cross = M.mergeExpPettyMonths([desktopStale, desktopSep], [phoneAug]);
  const crossAug = cross.filter(function (p) { return p && p.month === "2026-08"; })[0];
  ok("cross-device merge keeps Aug + Sep", cross.length === 2);
  ok(
    "cross-device keeps phone cash-in 250",
    crossAug && crossAug.cashIns.some(function (c) { return c && c.id === "cash-phone" && near(c.amount, 250); })
  );
}

/* ---- Diesel: bunker + sticky active sell ---- */
console.log("\n[Diesel — bunker buy + sticky active sell]");
{
  ok("markup is 0.10", near(M.DIESEL_MARKUP, 0.1));
  ok("suggested sell = buy + 0.10", near(M.dieselSuggestedSell(1.65), 1.75));
  ok("suggested sell 1.74 → 1.84", near(M.dieselSuggestedSell(1.74), 1.84));
}
{
  const ap = M.dieselApplyBunker({ kind: "settings" }, 1.65, null);
  ok("bunker sets buy 1.65", near(ap.buyPrice, 1.65));
  ok("bunker default sell 1.75", near(ap.sellPrice, 1.75));
  ok("bunker sellSource bunker", ap.sellSource === "bunker");
  ok("active sell after bunker", near(M.dieselActiveSell(ap.settings), 1.75));
}
{
  const ap = M.dieselApplyBunker({ kind: "settings" }, 1.65, 1.9);
  ok("bunker explicit sell 1.90", near(ap.sellPrice, 1.9));
  ok("explicit sell is manual source", ap.sellSource === "manual");
}
{
  let s = M.dieselApplyBunker({ kind: "settings" }, 1.6, null).settings;
  s = M.dieselSetActiveSell(s, 1.85).settings;
  ok("manual raise sticks", near(M.dieselActiveSell(s), 1.85));
  ok("manual source", s.sellSource === "manual");
  /* Normalize must NOT overwrite manual sell with buy+10c */
  const n = M.dieselNormalizeSettings(s);
  ok("normalize keeps manual 1.85", near(n.sellPrice, 1.85));
  ok("normalize does not force 1.70", !near(n.sellPrice, 1.7));
}
{
  const bunkers = [
    { kind: "buy", date: "2026-07-01", price: 1.5 },
    { kind: "buy", date: "2026-07-20", price: 1.65 },
  ];
  ok(
    "guest sell on 10 Jul uses earlier bunker",
    near(M.dieselGuestSellForDate(bunkers, "2026-07-10"), 1.6)
  );
  ok(
    "guest sell on 21 Jul uses later bunker",
    near(M.dieselGuestSellForDate(bunkers, "2026-07-21"), 1.75)
  );
  ok(
    "no bunker uses activeSell not 1.75 invent when provided",
    near(M.dieselGuestSellForDate([], "2026-07-21", { activeSell: 1.9 }), 1.9)
  );
  ok(
    "no bunker no active → legacy reconstruct only",
    near(M.dieselGuestSellForDate([], "2026-07-21"), M.DIESEL_LEGACY_FALLBACK_SELL)
  );
}
{
  /* Scrub obsolete 2.20 default */
  const n = M.dieselNormalizeSettings({ buyPrice: 1.74, sellPrice: 2.2 });
  ok("scrubs 2.20 to suggested", near(n.sellPrice, 1.84));
}
{
  /* Next bunker refreshes sell period */
  let s = M.dieselApplyBunker({}, 1.5, 1.9).settings;
  s = M.dieselApplyBunker(s, 1.7, null).settings;
  ok("next bunker resets sell to suggested", near(M.dieselActiveSell(s), 1.8));
  ok("next bunker source bunker", s.sellSource === "bunker");
}

/* ---- Charges cash-to-boat + VAT (model) ---- */
console.log("\n[Charges — cashToBoat / VAT]");
{
  ok(
    "invoice Paid → €0 boat",
    M.chargeCashToBoat({ amount: 500, billType: "invoice", payStatus: "Paid" }) === 0
  );
  ok(
    "cash Paid uses cashPaid 650 not amount 665",
    near(M.chargeCashToBoat({ amount: 664.95, billType: "cash", payStatus: "Paid", cashPaid: 650 }), 650)
  );
  ok(
    "unpaid cash → 0",
    M.chargeCashToBoat({ amount: 100, billType: "cash", payStatus: "Unpaid" }) === 0
  );
  ok(
    "Pending cash charge is NOT cash-to-boat (explicit Paid only)",
    M.chargeCashToBoat({ amount: 5000, billType: "cash", payStatus: "Pending", cashPaid: 5000 }) === 0
  );
  ok(
    "status Pending without payStatus is NOT cash-to-boat",
    M.chargeCashToBoat({ amount: 5000, billType: "cash", status: "Pending" }) === 0
  );
  const vat = M.chargeVatParts({ amount: 121, billType: "invoice", vatPct: 21, payMethod: "Card" });
  ok("invoice VAT net ≈ 100", near(vat.net, 100, 0.05));
  ok("invoice VAT ≈ 21", near(vat.vat, 21, 0.05));
  /* Rounded-up cash (750 for 748 ledger) — common real payment */
  const planUp = M.planChargeCashSettlementFields({
    amount: 748,
    cashPaid: 750,
    billType: "cash",
    payMethod: "Cash",
    payStatus: "Paid",
    amountUserSet: true,
    cashUserSet: true,
  });
  ok("748/750 plan keeps ledger 748", near(planUp.amount, 748));
  ok("748/750 plan keeps cash 750", near(planUp.cashPaid, 750));
  ok(
    "boat pot gets 750 not 748",
    near(
      M.chargeCashToBoat({
        payStatus: "Paid",
        billType: "cash",
        amount: 748,
        cashPaid: 750,
        payMethod: "Cash",
      }),
      750
    )
  );
  const invPaidCash = M.planChargeCashSettlementFields({
    amount: 748,
    cashPaid: 750,
    billType: "invoice",
    payMethod: "Cash",
    payStatus: "Paid",
    amountUserSet: true,
    cashUserSet: true,
  });
  ok("invoice+Paid Cash becomes cash settlement", invPaidCash.billType === "cash");
  ok(
    "invoice billType + Cash method still posts 750 to boat",
    near(
      M.chargeCashToBoat({
        payStatus: "Paid",
        billType: "invoice",
        amount: 748,
        cashPaid: 750,
        payMethod: "Cash",
      }),
      750
    )
  );
  /* Loose change: cash slightly under ledger still cash (not mix) and settles APA pot */
  const loose = {
    kind: "apa",
    apaTripId: "t-loose",
    amount: 664.95,
    apaBaseAmt: 664.95,
    cashPaid: 650,
    billType: "cash",
    payMethod: "Cash",
    payStatus: "Paid",
    cashDeal: true,
    moneyManual: true,
  };
  ok("loose change still billType cash", M.chargeBillType(loose) === "cash");
  ok("loose change still payMethod Cash", M.chargePayMethod(loose) === "Cash");
  ok("loose change is APA cash settlement", M.isApaCashSettlementCharge(loose) === true);
  ok(
    "loose change pot recovery is ledger base not cash",
    near(M.chargeApaBaseTowardPot(loose), 664.95)
  );
  ok("loose change boat gets cash notes 650", near(M.chargeCashToBoat(loose), 650));
  const looseTot = M.summarizeApaTripTotals({
    apaSent: 0,
    topUps: 0,
    expenses: [{ amount: 664.95, category: "Miscellaneous" }],
    provisions: [],
    dieselLines: [],
    paidCovered: M.chargeApaBaseTowardPot(loose),
    cashSettled: M.isApaCashSettlementCharge(loose),
  });
  ok("loose change cash settled overage 0", looseTot.overage === 0);
  ok("loose change cash settled bal 0", looseTot.bal === 0);
  ok(
    "Pending cash is NOT pot settlement",
    M.isApaCashSettlementCharge(
      Object.assign({}, loose, { payStatus: "Pending", status: "Pending" })
    ) === false
  );

  /* Spreadsheet export — date, name, amount, card/cash */
  const exportList = [
    {
      id: "c-cash",
      date: "2026-07-10",
      client: "Cash Guest",
      amount: 500,
      billType: "cash",
      payMethod: "Cash",
      payStatus: "Paid",
      cashPaid: 500,
    },
    {
      id: "c-card",
      date: "2026-07-12",
      client: "Card Guest",
      amount: 1210,
      billType: "invoice",
      payMethod: "Card",
      payStatus: "Paid",
    },
    {
      id: "c-future",
      date: "2099-01-01",
      client: "Future",
      amount: 100,
      billType: "invoice",
      payMethod: "Card",
      payStatus: "Pending",
    },
    {
      id: "c-mix",
      date: "2026-07-11",
      client: "Mix Guest, Jr.",
      amount: 1000,
      billType: "mix",
      payMethod: "Split",
      cashPaid: 400,
      payStatus: "Paid",
    },
  ];
  const expPack = M.buildChargesExportRows(exportList, { asOfYmd: "2026-07-31" });
  ok("export n excludes future", expPack.n === 3);
  ok("export oldest first", expPack.rows[0].name === "Cash Guest");
  ok("export cash paidBy", expPack.rows[0].paidBy === "Cash");
  ok("export mix paidBy", expPack.rows[1].paidBy === "Mix");
  ok("export card paidBy", expPack.rows[2].paidBy === "Card");
  ok("export mix cash slice 400", near(expPack.rows[1].cashAmount, 400));
  ok("export mix card slice 600", near(expPack.rows[1].cardAmount, 600));
  ok("export total amount sum", near(expPack.total, 500 + 1210 + 1000));
  const csvPack = M.chargesExportCsv(exportList, { asOfYmd: "2026-07-31" });
  ok("export csv has header", csvPack.csv.indexOf("Date,Name,Amount,Paid by") === 0);
  ok("export csv escapes comma name", csvPack.csv.indexOf('"Mix Guest, Jr."') >= 0);
  ok("export csv fileName uses asOf", csvPack.fileName === "Limitless-charges-2026-07-31.csv");
  ok("export csv n 3", csvPack.n === 3);
  ok("export csv has TOTAL row", /TOTAL/.test(csvPack.csv));
  ok("export money text euro", M.chargeExportMoneyText(1210) === "€1.210,00");
  ok("export csv amounts as euro text", csvPack.csv.indexOf("€500,00") >= 0 || csvPack.csv.indexOf("€500.00") >= 0 || /€/.test(csvPack.csv));
  const lastLine = csvPack.csv.trim().split("\n").pop();
  ok("export csv last line is TOTAL", lastLine.indexOf("TOTAL") >= 0);
  ok("export csv TOTAL count label", lastLine.indexOf("3 charges") >= 0);
  const xls = M.chargesExportExcelXml(exportList, { asOfYmd: "2026-07-31" });
  ok("export excel n 3", xls.n === 3);
  ok("export excel fileName xls", xls.fileName === "Limitless-charges-2026-07-31.xls");
  ok("export excel is SpreadsheetML", xls.xml.indexOf("urn:schemas-microsoft-com:office:spreadsheet") >= 0);
  ok("export excel has currency format", xls.xml.indexOf("NumberFormat") >= 0 && xls.xml.indexOf("€") >= 0);
  ok("export excel number cells", xls.xml.indexOf('ss:Type="Number"') >= 0);
  ok("export excel has TOTAL", xls.xml.indexOf("TOTAL") >= 0);
  ok("export excel total amount cell", xls.xml.indexOf(">" + String(500 + 1210 + 1000) + "<") >= 0 || xls.xml.indexOf(">2710<") >= 0);
}

/* ---- APA pot totals (model) ---- */
console.log("\n[APA — pot totals]");
{
  const tot = M.summarizeApaTripTotals({
    apaSent: 1000,
    topUps: 0,
    expenses: [{ amount: 200, category: "Drinks & Bar" }],
    provisions: [{ amount: 100 }],
    dieselLines: [{ lit: 10, cost: 50 }],
    paidCovered: 0,
    cashSettled: false,
  });
  ok("APA spent 350", near(tot.spent, 350));
  ok("APA bal 650", near(tot.bal, 650));
  ok("APA overage 0", tot.overage === 0);
  const short = M.summarizeApaTripTotals({
    apaSent: 0,
    expenses: [{ amount: 400, category: "Miscellaneous" }],
    provisions: [],
    dieselLines: [],
    paidCovered: 0,
    cashSettled: false,
  });
  ok("APA overage when short", near(short.overage, 400));
  const cashClosed = M.summarizeApaTripTotals({
    apaSent: 0,
    expenses: [{ amount: 400, category: "Miscellaneous" }],
    provisions: [],
    dieselLines: [],
    paidCovered: 350,
    cashSettled: true,
  });
  ok("cash settled closes residual overage", cashClosed.overage === 0);
  ok("cash settled bal 0", cashClosed.bal === 0);
  const fuel = M.summarizeApaTripTotals({
    expenses: [{ amount: 460, category: "Fuel / Diesel" }],
    provisions: [],
    dieselLines: [],
  });
  ok("Fuel expense in Fuel cat not Misc", near(fuel.cats["Fuel / Diesel"], 460));
  ok("Fuel expense not in Misc", near(fuel.cats.Miscellaneous || 0, 0));
}

/* ---- APA charge pick + write plans (domain) ---- */
console.log("\n[APA — charge pick + delete/start plans]");
{
  const charges = [
    {
      id: "paid-cash",
      apaTripId: "trip-d",
      clientKey: "danny",
      isPaid: true,
      isCashSettlement: true,
      isApa: true,
      amount: 650,
      cashPaid: 650,
      moneyManual: true,
      locked: true,
    },
    {
      id: "ghost-unpaid",
      apaTripId: "trip-d",
      clientKey: "danny",
      isPaid: false,
      isCashSettlement: false,
      isApa: true,
      amount: 460,
      cashPaid: 0,
    },
  ];
  const pickDisp = M.pickApaCharge({
    tripId: "trip-d",
    guestKey: "danny",
    purpose: "display",
    charges,
    liveTripIds: { "trip-d": 1 },
  });
  ok("display prefers paid cash over unpaid ghost", pickDisp.chargeId === "paid-cash");
  const collapse = M.planApaGuestChargeCollapse({
    tripId: "trip-d",
    guestKey: "danny",
    charges,
    otherLiveTripIds: {},
  });
  ok("collapse pins paid cash", collapse.tripPatch.chargeId === "paid-cash");
  ok("collapse drops unpaid ghost", collapse.dropChargeIds.indexOf("ghost-unpaid") >= 0);
  ok("collapse sets apaCashSettled", collapse.tripPatch.apaCashSettled === true);
  const del = M.planApaTripDelete({
    tripId: "trip-r",
    guestKey: "roman",
    charges: [
      {
        id: "roman-unpaid",
        apaTripId: "trip-r",
        clientKey: "roman",
        isPaid: false,
        isApa: true,
        amount: 460,
      },
    ],
    expenses: [
      { id: "e1", apaTripId: "trip-r", source: "apa", fromApaLineId: "line1" },
      { id: "e2", apaTripId: "trip-r", source: "manual" },
    ],
    lineIds: { line1: 1 },
    lineExpenseIds: {},
    otherLiveTripIds: {},
  });
  ok("delete drops pot shortfall charge", del.dropChargeIds.indexOf("roman-unpaid") >= 0);
  ok("delete drops apa mirror expense", del.dropExpenseIds.indexOf("e1") >= 0);
  ok("delete unlinks user monthly", del.unlinkExpenseIds.indexOf("e2") >= 0);
  const start = M.planApaStartEmptyPot({
    guestKey: "roman",
    keepTripId: "new-trip",
    liveTripIds: { "new-trip": 1 },
    charges: [
      {
        id: "orphan-460",
        apaTripId: "dead-trip",
        clientKey: "roman",
        isPaid: false,
        isApa: true,
        amount: 460,
      },
    ],
  });
  ok("start empty drops orphan unpaid", start.dropChargeIds.indexOf("orphan-460") >= 0);
  const syncCash = M.planApaShortfallSync({
    overage: 100,
    hasReusable: true,
    hasCashSettlement: true,
    allowCreate: true,
    force: true,
  });
  ok("cash settlement never creates/updates unpaid twin", syncCash.action === "pin_paid_manual");
  /* Danny case: billType still invoice (shortfall default) but Paid + payMethod Cash */
  ok(
    "Paid + Cash method is cash settlement even when billType invoice",
    M.isApaCashSettlementCharge(
      {
        kind: "apa",
        payStatus: "Paid",
        billType: "invoice",
        payMethod: "Cash",
        amount: 650,
        cashPaid: 650,
      },
      {
        chargeIsPaid: function (c) {
          return c.payStatus === "Paid";
        },
        chargeBillType: function (c) {
          return c.billType || "invoice";
        },
        chargePayMethod: function (c) {
          return c.payMethod || "Card";
        },
      }
    )
  );
  ok(
    "Paid + invoice + Card is NOT cash settlement",
    !M.isApaCashSettlementCharge(
      { kind: "apa", payStatus: "Paid", billType: "invoice", payMethod: "Card", amount: 650 },
      {
        chargeIsPaid: function (c) {
          return c.payStatus === "Paid";
        },
        chargeBillType: function (c) {
          return "invoice";
        },
        chargePayMethod: function (c) {
          return "Card";
        },
      }
    )
  );
  const emptyPick = M.pickApaCharge({
    tripId: "new",
    guestKey: "roman",
    potEmpty: true,
    purpose: "reusable",
    charges: [
      {
        id: "orphan",
        clientKey: "roman",
        isPaid: false,
        isApa: true,
        amount: 460,
      },
    ],
    liveTripIds: { new: 1 },
  });
  ok("empty pot does not adopt orphan", emptyPick.chargeId == null);
  /* Shortfall-to-invoice on lead must not seed APA received */
  ok("Not issued lead APA is not prepaid", !M.leadApaIsPrepaid("Not issued"));
  ok("Issued lead APA is prepaid", M.leadApaIsPrepaid("Issued"));
  const startSeed = M.planApaStartEmptyPot({
    guestKey: "roman",
    keepTripId: "new",
    leadApa: 460,
    leadApas: "Not issued",
    charges: [],
  });
  ok("start potSeed apaSent 0 when lead APA is shortfall tracking", startSeed.potSeed.apaSent === 0);
  ok("start potSeed linkInvAmount 0 when not prepaid", startSeed.potSeed.linkInvAmount === 0);
  const startPrepaid = M.planApaStartEmptyPot({
    guestKey: "joel",
    leadApa: 2400,
    leadApas: "Issued",
    charges: [],
  });
  ok("start potSeed apaSent from Issued prepaid", near(startPrepaid.potSeed.apaSent, 2400));
  const leadAfterDel = M.planApaLeadAfterPotDelete({
    apaSent: 0,
    topUps: 0,
    leadApa: 460,
    leadApas: "Not issued",
  });
  ok("delete zero-prepaid pot clears lead.apa shortfall", leadAfterDel && leadAfterDel.apa === 0);
  ok(
    "delete does not clear Issued prepaid lead",
    M.planApaLeadAfterPotDelete({ apaSent: 0, leadApa: 2400, leadApas: "Issued" }) == null
  );
  /* Mis-seeded pot apaSent>0 must still clear Not-issued lead.apa on delete */
  const leadClearMisSeed = M.planApaLeadAfterPotDelete({
    apaSent: 460,
    topUps: 0,
    leadApa: 460,
    leadApas: "Not issued",
  });
  ok("delete clears lead even when pot apaSent mis-seeded", leadClearMisSeed && leadClearMisSeed.apa === 0);
  ok("list display €0 for Not issued shortfall", M.leadApaListDisplayAmount(460, "Not issued") === 0);
  ok("list display prepaid for Issued", near(M.leadApaListDisplayAmount(2400, "Issued"), 2400));
  /* Sanitize linked pot seed — Roman mis-seed vs captain Setup entry */
  const wipeMisSeed = M.planApaSanitizeLinkedPotSeed({
    leadLinked: true,
    leadApas: "Not issued",
    leadApa: 460,
    apaSent: 460,
    linkInvAmount: 460,
  });
  ok(
    "sanitize clears mis-seeded shortfall as APA received",
    wipeMisSeed && wipeMisSeed.tripPatch && wipeMisSeed.tripPatch.apaSent === 0
  );
  const keepManual = M.planApaSanitizeLinkedPotSeed({
    leadLinked: true,
    leadApas: "Not issued",
    leadApa: 460,
    apaSent: 3000,
    linkInvAmount: 3000,
    apaSentManual: true,
  });
  ok("sanitize keeps Setup manual APA received", keepManual == null);
  const keepDistinct = M.planApaSanitizeLinkedPotSeed({
    leadLinked: true,
    leadApas: "Not issued",
    leadApa: 460,
    apaSent: 3000,
    linkInvAmount: 3000,
  });
  ok("sanitize keeps APA received ≠ lead shortfall €", keepDistinct == null);
  const keepIssued = M.planApaSanitizeLinkedPotSeed({
    leadLinked: true,
    leadApas: "Paid",
    leadApa: 3000,
    apaSent: 3000,
  });
  ok("sanitize skips when lead APA is Paid", keepIssued == null);
}

/* ---- APA controller write plans ---- */
console.log("\n[APA — controller planSaveTrip]");
{
  const C = require(join(root, "tracker/js/controllers/apa.js"));
  const trip = {
    id: "trip-d",
    guest: "Danny",
    chargeId: "ghost-unpaid",
    apaSent: 0,
    expenses: [{ amount: 100 }],
    provisions: [],
    diesel: [],
  };
  const charges = [
    {
      id: "paid-cash",
      kind: "apa",
      apaTripId: "trip-d",
      client: "Danny",
      payStatus: "Paid",
      billType: "cash",
      amount: 650,
      cashPaid: 650,
      moneyManual: true,
    },
    {
      id: "ghost-unpaid",
      kind: "apa",
      apaTripId: "trip-d",
      client: "Danny",
      payStatus: "Pending",
      billType: "invoice",
      amount: 460,
    },
  ];
  const plan = C.planSaveTrip({
    models: M,
    trip,
    charges,
    trips: [trip],
    force: true,
    allowCreate: false,
  });
  ok("ctrl save drops unpaid ghost", plan.dropChargeIds.indexOf("ghost-unpaid") >= 0);
  ok("ctrl save pins paid cash", plan.tripPatch.chargeId === "paid-cash");
  ok(
    "ctrl shortfall is cash pin not create",
    plan.shortfall.action === "pin_paid_manual" || plan.shortfall.action === "pin"
  );
}

/* ---- Boat cash ledger = Expenses summarizePettyCash (no second formula) ---- */
console.log("\n[Cash — boat ledger = Expenses petty]");
{
  /* DTO only maps petty — does not re-add free/charges */
  const led = M.summarizeBoatCashLedger({
    cashInTotal: 2475,
    cashOut: 40,
    pettyOnboard: 2535,
    physicalStart: 100,
    cashInHand: 2575,
    freeCashBoat: 1800,
    freeCashOwner: 500,
    cashOutLines: [{ label: "Shop", amount: 40 }],
  });
  ok("boat in = Expenses cashInTotal", near(led.boatIn, 2475));
  ok("boat out = Expenses cashOut", near(led.boatOut, 40));
  ok("boat net = on board", near(led.boatNet, 2535));
  ok("owner free cash reported but not in boat math", near(led.freeCashOwner, 500));
  ok("source is expenses-petty", led.source === "expenses-petty");

  const ins = M.summarizePettyCashInRows(
    [
      { id: "1", amount: 100, note: "Top up" },
      { id: "2", amount: 50, note: "Tip guest", tip: true },
    ],
    {
      skip: function (r) {
        return !!r.tip;
      },
    }
  );
  ok("petty cash-in skips tip rows", near(ins.total, 100));
  ok("petty cash-in n=1", ins.n === 1);
  const flat = M.collectPettyCashInsFromMonths([
    { month: "2026-08", cashIns: [{ id: "a", amount: 80, date: "2026-08-02" }] },
  ]);
  ok("collect petty cash-ins from months", flat.length === 1 && near(flat[0].amount, 80));

  /* Same cashIns + expenses → Leads ledger matches summarizePettyCash */
  const cashInsMonth = [
    { id: "lead-cash:L-boat", fromLeadId: "L-boat", kind: "charter-fee", amount: 1800, date: "2026-08-01" },
    { id: "charge-cash:c1", fromChargeId: "c1", kind: "end-charter", amount: 650, date: "2026-08-01" },
    { id: "manual", amount: 25, date: "2026-08-01", note: "Float top-up" },
    { id: "extra100", amount: 100, date: "2026-08-05", note: "Bank draw" },
  ];
  const expMonth = [
    {
      id: "toni-today",
      date: "2026-08-07",
      amount: 200,
      category: "Crew Salaries",
      vendor: "Toni",
      crewPayStatus: "Unpaid",
      source: "stew",
      stewId: "toni",
      stewEventKey: "evt1",
      paidFrom: "Petty cash",
    },
    {
      id: "shop",
      date: "2026-08-03",
      amount: 40,
      category: "Provisions",
      paidFrom: "Petty cash",
      payMethod: "Cash",
      vendor: "Shop",
    },
  ];
  const expPetty = M.summarizePettyCash({
    pettyStart: 100,
    cashIns: cashInsMonth,
    expenses: expMonth,
  });
  const dash = C.leads.moneyDashboard({
    models: M,
    month: "2026-08",
    pettyStart: 100,
    leads: [
      {
        id: "L-boat",
        name: "Boat free",
        start: "2026-08-01",
        captainLead: true,
        dealClosed: true,
        split: true,
        invoiceTotal: 2000,
        cashAmt: 1800,
        cashSettled: true,
        cashDest: "boat",
        fins: "Paid",
      },
      {
        id: "L-own",
        name: "Owner free",
        start: "2026-08-02",
        leadSource: "ownersourced",
        dealClosed: true,
        split: true,
        invoiceTotal: 1000,
        cashAmt: 500,
        cashSettled: true,
        cashDest: "owner",
        fins: "Paid",
      },
    ],
    charters: [],
    expenses: expMonth,
    expPetty: [{ month: "2026-08", cashIns: cashInsMonth, pettyStart: 100 }],
    today: "2026-08-10",
    cashInIsTip: function () {
      return false;
    },
  });
  ok("dashboard has cashLedger", !!dash.cashLedger);
  ok("leads cash in = Expenses cashInTotal", near(dash.cashLedger.cashInTotal, expPetty.cashInTotal));
  ok("leads cash out = Expenses cashOut", near(dash.cashLedger.cashOut, expPetty.cashOut));
  ok("leads on board = Expenses pettyOnboard", near(dash.cashLedger.boatNet, expPetty.pettyOnboard));
  ok("cash in includes all envelope lines (incl €100)", near(dash.cashLedger.cashInTotal, 1800 + 650 + 25 + 100));
  ok("cash out excludes unpaid Toni", near(dash.cashLedger.cashOut, 40));
  ok("physical start 100", near(dash.cashLedger.physicalStart, 100));
  ok("on board = start + in − out", near(dash.cashLedger.boatNet, 100 + 2575 - 40));
  ok("owner pocket free cash not added to boatIn", near(dash.cashLedger.freeCashOwner, 500));
  ok("boatIn is cashIn not free+owner", !near(dash.cashLedger.boatIn, 1800 + 500));

  /* Unpaid Toni day-pay must not hit petty outs */
  const unpaidCrew = M.summarizePettyCash({
    pettyStart: 0,
    cashIns: [],
    expenses: [
      {
        id: "toni-today",
        date: "2026-08-07",
        amount: 200,
        category: "Crew Salaries",
        vendor: "Toni",
        crewPayStatus: "Unpaid",
        source: "stew",
        stewId: "toni",
        stewEventKey: "evt1",
        paidFrom: "Petty cash",
      },
    ],
  });
  ok("unpaid crew day-pay cashOut 0", unpaidCrew.cashOut === 0);
  ok("unpaid crew not in cashOutLines", (unpaidCrew.cashOutLines || []).length === 0);
  const paidCrewNoFloat = M.summarizePettyCash({
    pettyStart: 0,
    cashIns: [],
    expenses: [
      {
        id: "toni-paid",
        date: "2026-08-01",
        amount: 200,
        category: "Crew Salaries",
        vendor: "Toni",
        crewPayStatus: "Paid",
        floatPay: false,
        source: "stew",
        stewId: "toni",
        stewEventKey: "evt0",
        paidFrom: "Petty cash",
      },
    ],
  });
  ok("Paid crew without floatPay cashOut 0", paidCrewNoFloat.cashOut === 0);
  const paidCrewFloat = M.summarizePettyCash({
    pettyStart: 0,
    cashIns: [],
    expenses: [
      {
        id: "toni-float",
        date: "2026-08-01",
        amount: 200,
        category: "Crew Salaries",
        vendor: "Toni",
        crewPayStatus: "Paid",
        floatPay: true,
        source: "stew",
        stewId: "toni",
        stewEventKey: "evt2",
        paidFrom: "Petty cash",
      },
    ],
  });
  ok("Paid + floatPay crew hits petty", near(paidCrewFloat.cashOut, 200));
  /* €8 shop from petty must reduce onboard (450 → 442) */
  const eight = M.summarizePettyCash({
    pettyStart: 450,
    cashIns: [],
    expenses: [
      {
        id: "coffee-8",
        date: "2026-08-02",
        amount: 8,
        category: "Miscellaneous",
        vendor: "Cafe",
        paidFrom: "Petty cash",
        payMethod: "Cash",
      },
    ],
  });
  ok("€8 petty out counts", near(eight.cashOut, 8));
  ok("€8 reduces 450 → 442 on board", near(eight.pettyOnboard, 442));
  /* Toni ghost Paid without float / manual must not settle */
  ok(
    "bare Paid day-pay not explicit",
    !M.crewDayPayIsExplicitlyPaid({
      category: "Crew Salaries",
      crewPayStatus: "Paid",
      floatPay: false,
      source: "stew",
      stewId: "toni",
    })
  );
  ok(
    "floatPay Paid is explicit",
    M.crewDayPayIsExplicitlyPaid({
      category: "Crew Salaries",
      crewPayStatus: "Paid",
      floatPay: true,
      source: "stew",
      stewId: "toni",
    })
  );
  const unpark = M.planUnparkDayPayNotFromFloat({
    today: "2026-08-02",
    assigns: [
      {
        eventKey: "evt-toni-today",
        start: "2026-08-02",
        payStatus: "Paid",
        payStatusManual: true,
        stewIds: ["toni"],
      },
    ],
    expenses: [
      {
        id: "toni-ghost",
        date: "2026-08-02",
        amount: 150,
        category: "Crew Salaries",
        vendor: "Toni",
        crewPayStatus: "Paid",
        floatPay: false,
        payStatusManual: true,
        source: "stew",
        stewId: "toni",
        stewEventKey: "evt-toni-today",
        stewPayKind: "dayPay",
      },
    ],
  });
  ok("unpark today Paid without float", unpark.changed === true);
  ok("unpark sets Unpaid", unpark.assignPatches[0] && unpark.assignPatches[0].payStatus === "Unpaid");
  ok("unpark drops ghost expense", unpark.dropExpenseIds.indexOf("toni-ghost") >= 0);
  /* Past Paid must never bulk-unpark */
  const unparkPast = M.planUnparkDayPayNotFromFloat({
    today: "2026-08-02",
    assigns: [
      {
        eventKey: "evt-past",
        start: "2026-07-15",
        payStatus: "Paid",
        payStatusManual: false,
        stewIds: ["laura"],
      },
    ],
    expenses: [
      {
        id: "laura-past",
        date: "2026-07-15",
        amount: 200,
        category: "Crew Salaries",
        crewPayStatus: "Paid",
        floatPay: false,
        source: "stew",
        stewId: "laura",
        stewEventKey: "evt-past",
        stewPayKind: "dayPay",
      },
    ],
  });
  ok("past Paid not bulk-unparked", unparkPast.changed === false);
  const keepFloat = M.planUnparkDayPayNotFromFloat({
    today: "2026-08-02",
    assigns: [{ eventKey: "evt-ok", start: "2026-08-02", payStatus: "Paid", stewIds: ["toni"] }],
    expenses: [
      {
        id: "toni-real",
        date: "2026-08-02",
        amount: 150,
        category: "Crew Salaries",
        crewPayStatus: "Paid",
        floatPay: true,
        source: "stew",
        stewId: "toni",
        stewEventKey: "evt-ok",
        stewPayKind: "dayPay",
      },
    ],
  });
  ok("real floatPay Paid not unparked", keepFloat.changed === false);
}


/* ---- Leads — cash-only full charter fee ---- */
console.log("\n[Leads — cash-only charter]");
{
  const cashBoat = {
    id: "L-cash",
    name: "All cash boat",
    start: "2026-08-02",
    captainLead: true,
    dealClosed: true,
    cashOnly: true,
    dealPayType: "cash",
    cashAmt: 3000,
    cashAmtUser: true,
    cashDest: "boat",
    cashSettled: true,
    fins: "Paid",
    total: 3000,
    base: 3000,
  };
  const cashOwner = {
    id: "L-own-cash",
    name: "All cash owner",
    start: "2026-08-02",
    leadSource: "ownersourced",
    dealClosed: true,
    cashOnly: true,
    dealPayType: "cash",
    cashAmt: 2800,
    cashAmtUser: true,
    cashDest: "owner",
    cashSettled: true,
    fins: "Paid",
    total: 2800,
  };
  ok("cash only is cash fee", M.leadIsCashOnlyDeal(cashBoat) === true);
  ok("cash only not split", M.leadHasSplit(cashBoat) === false);
  ok("cash only has cash fee", M.leadHasCashFee(cashBoat) === true);
  ok("deal pay type cash", M.leadDealPayType(cashBoat) === "cash");
  ok("cash only free cash 3000", near(M.leadFreeCashAmt(cashBoat), 3000));
  ok("cash only client total 3000", near(M.leadClientTotal(cashBoat), 3000));
  ok("cash only list money 3000", near(M.leadListMoney(cashBoat), 3000));
  ok("cash only received", M.leadFreeCashIsReceived(cashBoat) === true);
  ok("cash only on boat", M.leadFreeCashIsOnBoat(cashBoat) === true);
  ok("cash only owner pocket", near(M.leadOwnerPocketCashAmt(cashOwner), 2800));
  ok("cash only not on boat when owner", M.leadFreeCashIsOnBoat(cashOwner) === false);
  const sum = M.summarizeLeadCashIncome([cashBoat, cashOwner]);
  ok("cash income boat 3000", near(sum.boat, 3000));
  ok("cash income owner 2800", near(sum.owner, 2800));
  const comm = M.leadCommissionParts(cashBoat);
  ok("cash only commission base 3000", near(comm.base, 3000));
  ok("cash only cashBlack 3000", near(comm.cashBlack, 3000));
  ok("cash only white 0", near(comm.whiteBeforeVat, 0));
  ok("cash only 10% comm", near(comm.total, 300));
  ok("cash only 15% force", near(M.leadCommissionParts(cashBoat, 15).total, 450));
  const pending = Object.assign({}, cashBoat, { cashSettled: false, fins: "Not issued" });
  ok("cash only pending not received", M.leadFreeCashIsReceived(pending) === false);
  /* Form always writes cashSettled boolean — Final Paid must still count for cash-only */
  const settledFalseButPaid = Object.assign({}, cashBoat, {
    cashSettled: false,
    fins: "Paid",
    cashAmt: 2000,
    total: 2000,
    base: 2000,
    /* Legacy pollution: fee stored as invoiceTotal (pre-fix save path) */
    invoiceTotal: 2000,
    invoiceNet: 0,
    vatMode: "include",
    vatPct: 21,
  });
  ok("cash only Final Paid beats cashSettled false", M.leadFreeCashIsReceived(settledFalseButPaid) === true);
  ok("cash only on boat with Paid+false settled", M.leadFreeCashIsOnBoat(settledFalseButPaid) === true);
  ok("cash only free cash 2000 with invoiceTotal pollution", near(M.leadFreeCashAmt(settledFalseButPaid), 2000));
  ok("cash only never looks suggested", M.cashAmtLooksSuggested(settledFalseButPaid) === false);
  ok(
    "auto envelope cash-in kind charter-fee-cash",
    M.isAutoSyncedEnvelopeCashIn({ kind: "charter-fee-cash", amount: 2000 }) === true
  );
}

/* ---- Leads realised glimpse ---- */
console.log("\n[Leads — realised cash + glimpse]");
{
  const leads = [
    {
      id: "L1",
      name: "Past",
      start: "2026-07-01",
      source: "captain",
      captainLead: true,
      dealClosed: true,
      split: true,
      invoiceTotal: 2000,
      invoiceNet: 1652.89,
      cashAmt: 1800,
      cashSettled: true,
      cashDest: "boat",
    },
    {
      id: "L2",
      name: "Future",
      start: "2026-12-01",
      source: "captain",
      captainLead: true,
      dealClosed: true,
      split: true,
      invoiceTotal: 2000,
      invoiceNet: 1652.89,
      cashAmt: 1900,
      cashSettled: true,
      cashDest: "boat",
    },
  ];
  const cashAll = M.summarizeLeadCashIncome(leads);
  const cashReal = M.summarizeLeadCashIncomeRealised(leads, "2026-08-01");
  ok("all cash includes both received splits", cashAll.n === 2, "got " + cashAll.n);
  ok(
    "realised cash excludes future charter",
    cashReal.n === 1 && cashReal.items[0] && cashReal.items[0].id === "L1",
    "n=" + cashReal.n
  );
  const g = M.summarizeRealisedNetGlimpse({
    whiteEx: 1000,
    whiteComm: 150,
    cashRealised: { boat: 500, owner: 200, total: 700, n: 2, boatN: 1, ownerN: 1, items: [] },
  });
  ok("glimpse whiteNet 850", near(g.whiteNet, 850));
  ok("glimpse doneNet = white + boat only", near(g.doneNet, 1350));
  ok("owner pocket not in doneNet", near(g.cashOwner, 200));
}

/* ---- Pending + projected free cash (owner PDF) ---- */
console.log("\n[Leads — outstanding cash pending/projected]");
{
  const book = [
    {
      id: "Toni",
      name: "Toni guest",
      start: "2026-08-15",
      source: "captain",
      dealClosed: true,
      split: true,
      invoiceTotal: 2000,
      invoiceNet: 1652.89,
      cashAmt: 800,
      cashSettled: false,
      cashDest: "boat",
    },
    {
      id: "Fri",
      name: "Friday client",
      start: "2026-08-22",
      source: "captain",
      dealClosed: true,
      split: true,
      invoiceTotal: 3000,
      invoiceNet: 2479.34,
      cashAmt: 5000,
      cashSettled: false,
      cashDest: "boat",
    },
    {
      id: "Got",
      name: "Already in",
      start: "2026-08-10",
      source: "captain",
      dealClosed: true,
      split: true,
      invoiceTotal: 2000,
      invoiceNet: 1652.89,
      cashAmt: 900,
      cashSettled: true,
      cashDest: "boat",
    },
    {
      id: "Hold",
      name: "On hold",
      start: "2026-08-25",
      source: "captain",
      dealClosed: false,
      split: true,
      invoiceTotal: 2000,
      invoiceNet: 1652.89,
      cashAmt: 1200,
      cashSettled: false,
      cashDest: "boat",
    },
  ];
  const out = M.summarizeLeadCashOutstanding(book, "2026-08-19");
  ok("outstanding has pending Toni", out.pending.n === 1 && out.pending.boat === 800, "n=" + out.pending.n + " boat=" + out.pending.boat);
  ok(
    "outstanding pending name Toni",
    out.pending.items[0] && /Toni/i.test(out.pending.items[0].name)
  );
  ok(
    "outstanding projected Friday 5000",
    out.projected.n === 1 && out.projected.boat === 5000,
    "n=" + out.projected.n + " boat=" + out.projected.boat
  );
  ok(
    "outstanding skips received cash",
    !out.pending.items.some(function (x) { return x.id === "Got"; }) &&
      !out.projected.items.some(function (x) { return x.id === "Got"; })
  );
  ok(
    "outstanding skips on-hold",
    !out.projected.items.some(function (x) { return x.id === "Hold"; })
  );
  const ctrl = C.cashReport.monthReport({
    models: M,
    month: "2026-08",
    monthLabel: "August 2026",
    expenses: [],
    expPetty: [{ month: "2026-08", pettyStart: 100 }],
    leads: book,
    charters: [],
    todayYmd: "2026-08-19",
  });
  ok("cashReport exposes cashPending boat 800", near(ctrl.cashPending.boat, 800));
  ok("cashReport exposes cashProjected boat 5000", near(ctrl.cashProjected.boat, 5000));
}

/* ---- Stews tip / day pay ---- */
console.log("\n[Stews — tip on bill + day pay]");
{
  ok("tip on card is on bill", M.stewTipIsOnBill({ tipSource: "card" }));
  ok("tip cash not on bill", !M.stewTipIsOnBill({ tipSource: "cash" }));
  ok("tip total", near(M.stewTipTotal({ tipTotal: 90 }), 90));
  ok("tip paid", M.stewTipPaid({ tipPayStatus: "Paid" }));
  ok(
    "day pay by stew map",
    near(M.stewDayPayForStew({ dayPayByStew: { s1: 180 }, payEach: 200 }, "s1"), 180)
  );
  /* Cash tip: full amount to crew (no VAT) */
  const share = M.stewTipShare({ tipTotal: 90, stewIds: ["s1"], tipSource: "cash" });
  ok("cash tip share 1 stew → each 45", near(share.each, 45));
  ok("cash tip captain 45", near(share.captainShare, 45));
  ok("cash tip stew side 45", near(share.stewSide, 45));
  ok("cash tip no VAT", near(share.vat || 0, 0));
  const share2 = M.stewTipShare({ tipTotal: 90, stewIds: ["s1", "s2"], tipSource: "cash" });
  ok("cash tip 2 stews → 3-way", near(share2.each, 30));
  /* On card: guest €121 VAT-inc → pool €100 after 21% → split 50/50 */
  const cardTip = M.stewTipShare({ tipTotal: 121, stewIds: ["laura"], tipSource: "card" });
  ok("card tip gross 121", near(cardTip.gross, 121));
  ok("card tip pool after VAT 100", near(cardTip.pool, 100));
  ok("card tip VAT 21", near(cardTip.vat, 21));
  ok("card tip each 50", near(cardTip.each, 50));
  ok("card tip captain 50", near(cardTip.captainShare, 50));
  /* Per-person tip pay: captain and Laura separately (card, after VAT) */
  const partial = {
    tipTotal: 121,
    stewIds: ["laura"],
    tipPayStatus: "Partial",
    tipPaidBy: { captain: true },
    tipSource: "card",
  };
  ok("captain paid alone", M.stewTipCaptainPaid(partial) === true);
  ok("Laura not paid", M.stewTipStewPaid(partial, "laura") === false);
  ok("not all tip paid", M.stewTipPaid(partial) === false);
  const partialShare = M.stewTipShare(partial);
  ok("partial open is Laura 50 (after VAT)", near(partialShare.openTotal, 50));
  ok("partial paid is captain 50 (after VAT)", near(partialShare.paidTotal, 50));
  const payPlan = M.planTipPaidByFields({
    captain: true,
    byStew: { laura: true },
    stewIds: ["laura"],
  });
  ok("pay both → tipPayStatus Paid", payPlan.tipPayStatus === "Paid");
  const payCapOnly = M.planTipPaidByFields({
    captain: true,
    byStew: {},
    stewIds: ["laura"],
  });
  ok("pay captain only → Partial", payCapOnly.tipPayStatus === "Partial");
  const expLines = M.planStewTipPayoutExpense({
    asg: Object.assign({}, partial, { eventKey: "ev1", summary: "Trip", start: "2026-08-01" }),
    stewName: function () {
      return "Laura";
    },
  });
  ok("on-bill partial → 1 expense line (captain)", expLines.lines && expLines.lines.length === 1);
  ok("expense is captain share 50 after VAT", expLines.lines[0] && near(expLines.lines[0].amount, 50));
  const bothPaid = {
    tipTotal: 121,
    stewIds: ["laura"],
    tipPayStatus: "Paid",
    tipPaidBy: { captain: true, laura: true },
    tipSource: "card",
    eventKey: "ev2",
    summary: "Trip",
    start: "2026-08-01",
  };
  const expBoth = M.planStewTipPayoutExpense({
    asg: bothPaid,
    stewName: function () {
      return "Laura";
    },
  });
  ok("both paid → 2 expense lines", expBoth.lines && expBoth.lines.length === 2);
  const expBothSum = (expBoth.lines || []).reduce(function (s, ln) {
    return s + (ln && ln.amount ? ln.amount : 0);
  }, 0);
  ok("both paid sum after VAT 100 not 121", near(expBothSum, 100));
  /* Open tips → who is owed (Captain + Laura) */
  const openTips = M.collectOpenTipPayouts(
    [
      {
        eventKey: "ev-tip",
        onBill: true,
        paid: false,
        amount: 100,
        date: "2026-08-01",
        summary: "Day charter Laura",
        tipEach: 50,
        tipCaptain: 50,
        tipStewSide: 50,
        nStews: 1,
        stewNames: ["Laura"],
        stewIds: ["laura"],
        captainPaid: false,
        stewPaidBy: {},
      },
      {
        eventKey: "ev-paid",
        onBill: true,
        paid: true,
        amount: 80,
        date: "2026-08-01",
        tipEach: 40,
        tipCaptain: 40,
        stewNames: ["Laura"],
        stewIds: ["laura"],
        captainPaid: true,
        stewPaidBy: { laura: true },
      },
      {
        eventKey: "ev-partial",
        onBill: true,
        paid: false,
        amount: 100,
        date: "2026-08-01",
        summary: "Partial",
        tipEach: 50,
        tipCaptain: 50,
        tipStewSide: 50,
        nStews: 1,
        stewNames: ["Laura"],
        stewIds: ["laura"],
        captainPaid: true,
        stewPaidBy: { laura: false },
      },
    ],
    { focusMonth: "2026-08", today: "2026-08-02" }
  );
  ok("open tip n=2 (full unpaid + partial)", openTips.length === 2);
  const fullOpen = openTips.find(function (t) {
    return t.eventKey === "ev-tip";
  });
  ok("full open has captain+Laura shares", fullOpen && fullOpen.shares && fullOpen.shares.length === 2);
  const partOpen = openTips.find(function (t) {
    return t.eventKey === "ev-partial";
  });
  ok("partial open only Laura", partOpen && partOpen.shares && partOpen.shares.length === 1);
  ok("partial open amount 50", partOpen && near(partOpen.amount, 50));
  const byWho = M.summarizeOpenTipOwedByPerson(openTips);
  ok("tip by person n=2", byWho.n === 2);
  const cap = byWho.people.find(function (p) {
    return p.whoKey === "captain";
  });
  const laura = byWho.people.find(function (p) {
    return /laura/i.test(p.name || "");
  });
  ok("owe captain 50 (only full trip)", cap && near(cap.amount, 50));
  ok("owe Laura 100 (full + partial)", laura && near(laura.amount, 100));
  ok("captain listed first", byWho.people[0] && byWho.people[0].role === "captain");
}

/* ---- APA diesel line + paid covered ---- */
console.log("\n[APA — diesel line + paid covered]");
{
  const line = M.apaDieselLineCalc(
    { genBurn: 6, dieselPrice: 1.8 },
    { enginePortL: 10, engineStbdL: 10, genHrs: 1 }
  );
  ok("diesel lit eng+gen = 26", near(line.lit, 26));
  ok("diesel cost = lit×price", near(line.cost, 26 * 1.8));
  const frozen = M.apaDieselLineCalc(
    { genBurn: 6, dieselPrice: 9.99 },
    { engineL: 10, amount: 20 }
  );
  ok("stored amount freezes cost", near(frozen.cost, 20));
  /* Missing rate must NOT zero the pot (today’s bug: diesel → €0 money) */
  const noRate = M.apaDieselLineCalc({ genBurn: 6, dieselPrice: 0 }, { enginePortL: 40, engineStbdL: 40 });
  ok("missing rate still has litres", near(noRate.lit, 80));
  ok("missing rate uses fallback price > 0", noRate.price > 0);
  ok("missing rate still costs money", noRate.cost > 0.009, "got " + noRate.cost);
  ok("missing rate usedFallback", noRate.usedFallback === true);
  const planD = M.planApaDieselConsumptionLine({
    tripCtx: { genBurn: 6, dieselPrice: 0 },
    row: { enginePortL: 40, engineStbdL: 40, genHrs: 2, date: "2026-08-02" },
    id: "d1",
  });
  ok("plan diesel ok", planD.ok === true);
  ok("plan diesel freezes amount", planD.line && planD.line.amount > 0.009);
  ok("plan diesel freezes unitPrice", planD.line && planD.line.unitPrice > 0);
  ok("plan pins trip price when missing", planD.pinTripPrice > 0);
  const paid = M.summarizeApaPaidCovered(
    [
      { payStatus: "Paid", apaBaseAmt: 100, amount: 150 },
      { payStatus: "Unpaid", apaBaseAmt: 50 },
    ],
    {
      chargeIsPaid: function (c) {
        return c.payStatus === "Paid";
      },
      chargeApaBaseTowardPot: function (c) {
        return Number(c.apaBaseAmt) || 0;
      },
    }
  );
  ok("paid covered only Paid bases", near(paid, 100));
  ok(
    "cash settlement charge",
    M.isApaCashSettlementCharge(
      { kind: "apa", payStatus: "Paid", billType: "cash" },
      {
        chargeIsPaid: function () {
          return true;
        },
        chargeBillType: function () {
          return "cash";
        },
      }
    )
  );
}

/* ---- Fundamental money transactions (locked end-to-end) ---- */
console.log("\n[Transactions — fundamental money paths]");
{
  const dieselCalc = function (t, r) {
    return M.apaDieselLineCalc(
      {
        genBurn: t.genBurn || 6,
        dieselPrice: t.dieselPrice,
        fallbackPrice: M.APA_DIESEL_FALLBACK_PRICE || 1.75,
      },
      r
    );
  };

  /* 1) Zero-pot APA + diesel consumption → spent + overage + shortfall create */
  const tripDiesel = {
    id: "apa-d",
    guest: "Diesel Guest",
    apaSent: 0,
    topUps: 0,
    genBurn: 6,
    dieselPrice: 1.85,
    expenses: [],
    provisions: [],
    diesel: [
      {
        id: "d1",
        date: "2026-08-02",
        enginePortL: 40,
        engineStbdL: 40,
        genHrs: 2,
        amount: 170.2,
        unitPrice: 1.85,
      },
    ],
  };
  const totD = C.apa.tripTotals({
    models: M,
    trip: tripDiesel,
    paidCovered: 0,
    cashSettled: false,
    dieselCalc: dieselCalc,
  });
  ok("tx diesel spent > 0", totD.spent > 0.009, "got " + totD.spent);
  ok("tx diesel dCost matches line", near(totD.dCost, 170.2));
  ok("tx diesel overage = spent on zero pot", near(totD.overage, totD.spent));
  const saveD = C.apa.planSaveTrip({
    models: M,
    trip: tripDiesel,
    charges: [],
    force: true,
    allowCreate: true,
    firstShortfall: true,
    paidCovered: 0,
    cashSettled: false,
    overage: totD.overage,
    dieselCalc: dieselCalc,
  });
  ok("tx diesel shortfall creates charge", saveD.shortfall && saveD.shortfall.action === "create");
  ok(
    "tx diesel charge amount = overage",
    saveD.shortfall &&
      saveD.shortfall.moneyFields &&
      near(saveD.shortfall.moneyFields.amount, totD.overage)
  );

  /* 2) Missing trip dieselPrice still produces money (fallback) */
  const tripNoPrice = {
    id: "apa-np",
    guest: "No Price",
    apaSent: 0,
    dieselPrice: 0,
    genBurn: 6,
    expenses: [],
    provisions: [],
    diesel: [{ id: "d2", enginePortL: 50, engineStbdL: 50, genHrs: 0 }],
  };
  const totNP = C.apa.tripTotals({
    models: M,
    trip: tripNoPrice,
    paidCovered: 0,
    cashSettled: false,
    dieselCalc: dieselCalc,
  });
  ok("tx no-price diesel still spends", totNP.spent > 0.009, "got " + totNP.spent);
  ok("tx no-price dLit = 100", near(totNP.dLit, 100));

  /* 3) Prepaid pot + diesel reduces balance, no overage if within pot */
  const tripPre = {
    id: "apa-p",
    guest: "Prepaid",
    apaSent: 500,
    topUps: 0,
    dieselPrice: 2,
    genBurn: 6,
    expenses: [],
    provisions: [],
    diesel: [{ id: "d3", engineL: 50, amount: 100, unitPrice: 2 }],
  };
  const totP = C.apa.tripTotals({
    models: M,
    trip: tripPre,
    paidCovered: 0,
    cashSettled: false,
    dieselCalc: dieselCalc,
  });
  ok("tx prepaid bal 400", near(totP.bal, 400));
  ok("tx prepaid overage 0", near(totP.overage, 0));

  /* 4) Expense + provision + diesel all in spent */
  const tripAll = {
    id: "apa-a",
    guest: "All",
    apaSent: 1000,
    expenses: [{ amount: 100, category: "Dockage / Marina" }],
    provisions: [{ amount: 50 }],
    diesel: [{ engineL: 10, amount: 20, unitPrice: 2 }],
    dieselPrice: 2,
    genBurn: 6,
  };
  const totA = C.apa.tripTotals({
    models: M,
    trip: tripAll,
    paidCovered: 0,
    cashSettled: false,
    dieselCalc: dieselCalc,
  });
  ok("tx all spent = 100+50+20", near(totA.spent, 170));
  ok("tx all bal = 830", near(totA.bal, 830));

  /* 5) Cash settlement zeros residual overage */
  const totCash = C.apa.tripTotals({
    models: M,
    trip: {
      id: "apa-c",
      apaSent: 0,
      expenses: [{ amount: 200, category: "Miscellaneous" }],
      provisions: [],
      diesel: [],
    },
    paidCovered: 0,
    cashSettled: true,
    dieselCalc: dieselCalc,
  });
  ok("tx cash settled overage 0", near(totCash.overage, 0));
  ok("tx cash settled bal 0", near(totCash.bal, 0));

  /* 6) Charge cash-to-boat (explicit Paid only) */
  ok(
    "tx charge cash Paid → boat",
    near(
      M.chargeCashToBoat({
        payStatus: "Paid",
        billType: "cash",
        amount: 650,
        cashPaid: 650,
      }),
      650
    )
  );
  ok(
    "tx charge Pending → 0 boat",
    near(
      M.chargeCashToBoat({
        payStatus: "Pending",
        billType: "cash",
        amount: 650,
        cashPaid: 650,
      }),
      0
    )
  );

  /* 7) Free cash boat vs owner pocket */
  const free = M.summarizeLeadCashIncome([
    {
      id: "L1",
      name: "Boat",
      start: "2026-07-01",
      captainLead: true,
      dealClosed: true,
      split: true,
      invoiceTotal: 1000,
      cashAmt: 400,
      cashSettled: true,
      cashDest: "boat",
      fins: "Paid",
    },
    {
      id: "L2",
      name: "Owner",
      start: "2026-07-02",
      leadSource: "ownersourced",
      dealClosed: true,
      split: true,
      invoiceTotal: 1000,
      cashAmt: 300,
      cashSettled: true,
      cashDest: "owner",
      fins: "Paid",
    },
  ]);
  ok("tx free cash boat 400", near(free.boat, 400));
  ok("tx free cash owner 300", near(free.owner, 300));

  /* 8) Petty envelope: start + ins − outs */
  const petty = M.summarizePettyCash({
    pettyStart: 100,
    cashIns: [{ amount: 50 }],
    expenses: [
      {
        amount: 8,
        category: "Miscellaneous",
        paidFrom: "Petty cash",
        payMethod: "Cash",
        date: "2026-08-01",
      },
      {
        amount: 200,
        category: "Crew Salaries",
        vendor: "Toni",
        crewPayStatus: "Unpaid",
        source: "stew",
        stewId: "toni",
        floatPay: false,
      },
    ],
  });
  ok("tx petty cashOut €8 only", near(petty.cashOut, 8));
  ok("tx petty onboard 142", near(petty.pettyOnboard, 142));

  /* 9) Crew Paid + floatPay hits petty; Paid alone does not */
  ok(
    "tx crew floatPay hits",
    near(
      M.summarizePettyCash({
        pettyStart: 200,
        cashIns: [],
        expenses: [
          {
            amount: 150,
            category: "Crew Salaries",
            crewPayStatus: "Paid",
            floatPay: true,
            source: "stew",
            stewId: "t",
            date: "2026-08-01",
          },
        ],
      }).cashOut,
      150
    )
  );
  ok(
    "tx crew Paid no float 0",
    near(
      M.summarizePettyCash({
        pettyStart: 200,
        cashIns: [],
        expenses: [
          {
            amount: 150,
            category: "Crew Salaries",
            crewPayStatus: "Paid",
            floatPay: false,
            source: "stew",
            stewId: "t",
            date: "2026-08-01",
          },
        ],
      }).cashOut,
      0
    )
  );

  /* 10) Controller diesel plan freezes money with zero trip rate */
  const dslCtrl = C.apa.planDieselConsumption({
    models: M,
    trip: { dieselPrice: 0, genBurn: 6 },
    row: { enginePortL: 10, engineStbdL: 10, genHrs: 1, date: "2026-08-02" },
    id: "dx",
  });
  ok("tx ctrl diesel plan ok", dslCtrl.ok === true);
  ok("tx ctrl diesel amount > 0", dslCtrl.line && dslCtrl.line.amount > 0.009);
  ok("tx ctrl diesel unitPrice > 0", dslCtrl.line && dslCtrl.line.unitPrice > 0);
}

/* ---- Leads money dashboard ---- */
console.log("\n[Leads — money dashboard]");
{
  const dash = M.summarizeLeadsMoneyDashboard({
    today: "2026-08-01",
    leads: [
      {
        id: "A",
        name: "Sailed",
        start: "2026-07-10",
        source: "captain",
        captainLead: true,
        dealClosed: true,
        total: 2000,
        vatMode: "include",
        vatPct: 21,
      },
      {
        id: "B",
        name: "Future",
        start: "2026-12-01",
        source: "captain",
        captainLead: true,
        dealClosed: true,
        total: 3000,
        vatMode: "include",
        vatPct: 21,
      },
    ],
    charters: [],
  });
  ok("dashboard done n=1", dash.done.n === 1, "got " + dash.done.n);
  ok("dashboard proj n=1", dash.proj.n === 1, "got " + dash.proj.n);
  ok("dashboard captain realised n=1", dash.captain.n === 1);
  ok("dashboard captain proj n=1", dash.captain.proj && dash.captain.proj.n === 1, "got " + (dash.captain.proj && dash.captain.proj.n));
  ok("dashboard captain proj not in to-date tot", Math.abs(dash.captain.tot - 2000) < 0.05 || dash.captain.n === 1);
  const dashCb = M.summarizeLeadsMoneyDashboard({
    today: "2026-08-01",
    leads: [
      {
        id: "cb-past",
        name: "Past CB",
        start: "2026-07-15",
        leadSource: "clickboat",
        dealClosed: true,
        total: 4000,
        vatMode: "include",
        vatPct: 21,
      },
      {
        id: "cb-future",
        name: "Future CB",
        start: "2026-09-01",
        leadSource: "clickboat",
        dealClosed: true,
        total: 4000,
        vatMode: "include",
        vatPct: 21,
      },
    ],
    charters: [],
  });
  ok("clickboat to-date n=1", dashCb.clickboat.n === 1);
  ok("clickboat proj n=1", dashCb.clickboat.proj && dashCb.clickboat.proj.n === 1);
  ok(
    "clickboat proj comm uses 24%",
    dashCb.clickboat.proj &&
      Math.abs(dashCb.clickboat.proj.comm - (4000 / 1.21) * 0.24) < 0.05,
    "got " + (dashCb.clickboat.proj && dashCb.clickboat.proj.comm)
  );
  ok("booked n = done + proj", dashCb.booked && dashCb.booked.n === 2);
  ok(
    "booked tot = done + proj gross",
    dashCb.booked &&
      Math.abs(dashCb.booked.tot - (dashCb.done.tot + dashCb.proj.tot)) < 0.05
  );
  ok(
    "booked whiteNet = sum of white nets",
    dashCb.booked &&
      Math.abs(
        dashCb.booked.whiteNet -
          (Math.max(0, dashCb.done.ex - dashCb.done.comm) +
            Math.max(0, dashCb.proj.ex - dashCb.proj.comm))
      ) < 0.05
  );
  ok("clickboat source booked n=2", dashCb.clickboat.booked && dashCb.clickboat.booked.n === 2);
  ok(
    "clickboat source booked tot",
    dashCb.clickboat.booked &&
      Math.abs(
        dashCb.clickboat.booked.tot -
          (dashCb.clickboat.tot + dashCb.clickboat.proj.tot)
      ) < 0.05
  );
  ok(
    "clickboat source booked whiteNet",
    dashCb.clickboat.booked &&
      Math.abs(
        dashCb.clickboat.booked.whiteNet -
          (Math.max(0, dashCb.clickboat.exVat - dashCb.clickboat.comm) +
            Math.max(0, dashCb.clickboat.proj.exVat - dashCb.clickboat.proj.comm))
      ) < 0.05
  );
  ok("captain source booked n=2", dash.captain.booked && dash.captain.booked.n === 2);
  ok("type key 8h default", M.leadCharterTypeKey({ dur: "day" }) === "8h");
}

/* ---- Write plans (pure intents for view apply) ---- */
console.log("\n[Write plans — stew expenses + APA shortfall decision]");
{
  const unpaid = M.planStewDayPayExpenseLines({
    asg: { eventKey: "uid:a", payStatus: "Unpaid", start: "2026-07-01", stewIds: ["s1"] },
  });
  ok("unpaid day pay → clear only", unpaid.clearOnly && unpaid.lines.length === 0);
  const paid = M.planStewDayPayExpenseLines({
    asg: {
      eventKey: "uid:a",
      payStatus: "Paid",
      start: "2026-07-01",
      stewIds: ["s1"],
      summary: "Charter",
      _floatPayMark: true,
      _floatPayFrom: "Petty cash",
    },
    dayPayAmt: function () {
      return 200;
    },
    stewName: function () {
      return "Toni";
    },
    newId: function () {
      return "e1";
    },
  });
  ok("paid day pay → 1 line", paid.lines.length === 1);
  ok("floatPay true when mark from petty", paid.lines[0].floatPay === true);
  ok("amount 200", near(paid.lines[0].amount, 200));
  /* Cash left today → expense date is pay day (not charter day) so current petty moves */
  const paidToday = M.planStewDayPayExpenseLines({
    asg: {
      eventKey: "uid:diego",
      payStatus: "Paid",
      start: "2026-07-14",
      stewIds: ["laura"],
      summary: "diego",
      _floatPayMark: true,
      _floatPayFrom: "Petty cash",
      payStatusManual: true,
    },
    dayPayAmt: function () {
      return 200;
    },
    stewName: function () {
      return "Laura";
    },
    nowIso: "2026-08-03T14:40:00.000Z",
    payDate: "2026-08-03",
    newId: function () {
      return "laura-pay";
    },
  });
  ok(
    "floatPay pay date is today not charter",
    paidToday.lines[0] && paidToday.lines[0].date === "2026-08-03",
    "got " + (paidToday.lines[0] && paidToday.lines[0].date)
  );
  ok(
    "description keeps charter day",
    paidToday.lines[0] && /charter 2026-07-14/.test(String(paidToday.lines[0].description || "")),
    "got " + (paidToday.lines[0] && paidToday.lines[0].description)
  );
  /* Owner paid crew out of pocket (owner’s day) — not petty, not captain pocket */
  const ownerPaid = M.planStewDayPayExpenseLines({
    asg: {
      eventKey: "uid:owner-day",
      payStatus: "Paid",
      start: "2026-08-08",
      stewIds: ["laura"],
      summary: "Owner day",
      payStatusManual: true,
      paidFrom: "Owner money",
      _floatPayMark: false,
      _floatPayFrom: "Owner money",
      _floatPayPayerId: "owner",
    },
    dayPayAmt: function () {
      return 200;
    },
    stewName: function () {
      return "Laura";
    },
    nowIso: "2026-08-09T12:00:00.000Z",
    payDate: "2026-08-09",
    newId: function () {
      return "laura-owner-pay";
    },
  });
  ok("owner money day pay → 1 line", ownerPaid.lines.length === 1);
  ok("owner money paidFrom", ownerPaid.lines[0] && ownerPaid.lines[0].paidFrom === "Owner money");
  ok("owner money paidById owner", ownerPaid.lines[0] && ownerPaid.lines[0].paidById === "owner");
  ok("owner money floatPay false", ownerPaid.lines[0] && ownerPaid.lines[0].floatPay === false);
  ok(
    "owner money date stays charter day (not pay-day stamp)",
    ownerPaid.lines[0] && ownerPaid.lines[0].date === "2026-08-08",
    "got " + (ownerPaid.lines[0] && ownerPaid.lines[0].date)
  );
  ok(
    "owner money does not hit petty",
    ownerPaid.lines[0] && M.crewDayPayHitsPetty(ownerPaid.lines[0]) === false
  );
  /* Re-edit Owner money must keep Aug date (Laura last week of Aug bug) */
  const ownerReedit = M.planStewDayPayExpenseLines({
    asg: {
      eventKey: "uid:laura-aug",
      payStatus: "Paid",
      start: "2026-08-28",
      stewIds: ["laura"],
      summary: "Laura Aug week",
      payStatusManual: true,
      paidFrom: "Owner money",
      _floatPayMark: false,
      _floatPayFrom: "Owner money",
      _floatPayPayerId: "owner",
    },
    previousLines: [
      {
        id: "laura-aug-exp",
        source: "stew",
        stewPayKind: "dayPay",
        stewEventKey: "uid:laura-aug",
        stewId: "laura",
        crewPayStatus: "Paid",
        paidFrom: "Owner money",
        paidById: "owner",
        floatPay: false,
        amount: 200,
        date: "2026-08-28",
        charterDate: "2026-08-28",
      },
    ],
    dayPayAmt: function () {
      return 200;
    },
    stewName: function () {
      return "Laura";
    },
    nowIso: "2026-09-06T12:00:00.000Z",
    payDate: "2026-09-06",
    newId: function () {
      return "laura-aug-new";
    },
  });
  ok(
    "owner re-edit keeps Aug date",
    ownerReedit.lines[0] && ownerReedit.lines[0].date === "2026-08-28",
    "got " + (ownerReedit.lines[0] && ownerReedit.lines[0].date)
  );
  /* Boss €150 + petty top-up €50 (desktop split must not collapse to all-owner) */
  const ownerPettySplit = M.planStewDayPayExpenseLines({
    asg: {
      eventKey: "uid:laura-split",
      payStatus: "Paid",
      start: "2026-08-29",
      stewIds: ["laura"],
      summary: "Laura split",
      payStatusManual: true,
      paidFrom: "Owner money",
      guestPaidAmt: 150,
      topUpFrom: "Petty cash",
      _floatPayMark: true,
      _floatPayFrom: "Owner money",
      _floatPayPayerId: "owner",
    },
    previousLines: [
      {
        id: "laura-split-exp",
        source: "stew",
        stewPayKind: "dayPay",
        stewEventKey: "uid:laura-split",
        stewId: "laura",
        amount: 200,
        date: "2026-08-29",
        charterDate: "2026-08-29",
      },
    ],
    dayPayAmt: function () {
      return 200;
    },
    stewName: function () {
      return "Laura";
    },
    nowIso: "2026-09-06T12:00:00.000Z",
    payDate: "2026-09-06",
    newId: function () {
      return "laura-split-new";
    },
  });
  ok(
    "owner+petty split paidFrom Owner",
    ownerPettySplit.lines[0] && ownerPettySplit.lines[0].paidFrom === "Owner money"
  );
  ok(
    "owner+petty split primary 150",
    ownerPettySplit.lines[0] && near(ownerPettySplit.lines[0].guestPaidAmt, 150)
  );
  ok(
    "owner+petty split topUp 50",
    ownerPettySplit.lines[0] && near(ownerPettySplit.lines[0].topUpAmt, 50)
  );
  ok(
    "owner+petty split topUpFrom Petty",
    ownerPettySplit.lines[0] && ownerPettySplit.lines[0].topUpFrom === "Petty cash"
  );
  ok(
    "owner+petty split floatPay true",
    ownerPettySplit.lines[0] && ownerPettySplit.lines[0].floatPay === true
  );
  ok(
    "owner+petty first float moves date to pay day",
    ownerPettySplit.lines[0] && ownerPettySplit.lines[0].date === "2026-09-06",
    "got " + (ownerPettySplit.lines[0] && ownerPettySplit.lines[0].date)
  );
  ok(
    "owner money expensePaidFrom class",
    ownerPaid.lines[0] && M.expensePaidFrom(ownerPaid.lines[0]) === "owner"
  );
  ok(
    "owner money is not own-money spend (no captain pocket claim)",
    ownerPaid.lines[0] && M.isOwnMoneySpend(ownerPaid.lines[0]) === false
  );
  ok(
    "owner money desc notes paid by owner",
    ownerPaid.lines[0] && /paid by owner/i.test(String(ownerPaid.lines[0].description || "")),
    "got " + (ownerPaid.lines[0] && ownerPaid.lines[0].description)
  );
  ok(
    "EXP_POCKET_OWNER exported",
    M.EXP_POCKET_OWNER === "owner"
  );
  ok(
    "looksOwner accepts Owner money",
    M.expensePaidFromLooksOwner("Owner money") === true &&
      M.expensePaidFromLooksOwn("Owner money") === false
  );
  /* Guest paid crew + €50 shortfall top-up from own money (stew still gets full rate) */
  {
    const guestLine = {
      id: "g1",
      source: "stew",
      stewPayKind: "dayPay",
      stewEventKey: "ek-g",
      stewId: "s1",
      crewPayStatus: "Paid",
      amount: 250,
      guestPaidAmt: 200,
      topUpAmt: 50,
      topUpFrom: "Own money",
      paidFrom: "Guest",
      paidById: "captain",
      floatPay: false,
      date: "2026-08-10",
      vendor: "Laura",
      description: "Stewardess / day work — Guest X",
      category: "Crew Salaries",
      payMethod: "Cash",
    };
    ok("guest paid fund source guest", M.crewDayPayFundSource(guestLine) === "guest");
    ok("guest paid does not hit full petty", M.crewDayPayHitsPetty(guestLine) === false);
    ok("guest own top-up is own-money spend", M.isOwnMoneySpend(guestLine) === true);
    ok("guest own top-up amount is 50 not 250", near(M.ownMoneySpendAmount(guestLine), 50));
    const split = M.crewDayPayGuestSplit(guestLine);
    ok("guest split guest 200", near(split.guestPaid, 200));
    ok("guest split topUp 50", near(split.topUp, 50));
    const sum = M.summarizeCrewPayMonth([guestLine], "2026-08", {});
    ok("guest month fromGuest 200", near(sum.fromGuest, 200));
    ok("guest month fromCaptain top-up 50", near(sum.fromCaptain, 50));
    ok("guest month pot 0", near(sum.fromBoatPot, 0));
    const guestPetty = Object.assign({}, guestLine, {
      topUpFrom: "Petty cash",
      floatPay: true,
      paidById: "",
    });
    ok("guest petty top-up hits petty", M.crewDayPayHitsPetty(guestPetty) === true);
    ok("guest petty out is 50", near(M.crewDayPayPettyOutAmount(guestPetty), 50));
    const planGuest = M.planStewDayPayExpenseLines({
      asg: {
        eventKey: "ek-g2",
        payStatus: "Paid",
        paidFrom: "Guest",
        guestPaidAmt: 200,
        topUpFrom: "Own money",
        stewIds: ["laura"],
        dayPayByStew: { laura: 250 },
        start: "2026-08-10",
        summary: "Guest deal",
        _floatPayFrom: "Guest",
        _floatPayMark: false,
        _floatPayPayerId: "captain",
      },
      dayPayAmt: function (a, sid) {
        return 250;
      },
      stewName: function () {
        return "Laura";
      },
      nowIso: "2026-08-10T12:00:00.000Z",
      newId: function () {
        return "gline";
      },
    });
    ok("guest plan line n 1", planGuest.lines.length === 1);
    ok("guest plan paidFrom Guest", planGuest.lines[0] && planGuest.lines[0].paidFrom === "Guest");
    ok("guest plan guestPaid 200", planGuest.lines[0] && near(planGuest.lines[0].guestPaidAmt, 200));
    ok("guest plan topUp 50", planGuest.lines[0] && near(planGuest.lines[0].topUpAmt, 50));
    /* Boss €400 + you front €50 (Owner money split) */
    const bossLine = {
      id: "b1",
      source: "stew",
      stewPayKind: "dayPay",
      stewEventKey: "ek-b",
      stewId: "airi",
      crewPayStatus: "Paid",
      amount: 450,
      guestPaidAmt: 400,
      topUpAmt: 50,
      topUpFrom: "Own money",
      paidFrom: "Owner money",
      paidById: "captain",
      floatPay: false,
      date: "2026-08-12",
      vendor: "Airi",
      category: "Crew Salaries",
      payMethod: "Cash",
    };
    ok("boss split fund owner", M.crewDayPayFundSource(bossLine) === "owner");
    ok("boss split is own-money top-up", M.isOwnMoneySpend(bossLine) === true);
    ok("boss front amount 50", near(M.ownMoneySpendAmount(bossLine), 50));
    const bossSum = M.summarizeCrewPayMonth([bossLine], "2026-08", {});
    ok("boss month fromOwner 400", near(bossSum.fromOwner, 400));
    ok("boss month fromCaptain 50", near(bossSum.fromCaptain, 50));
    const planBoss = M.planStewDayPayExpenseLines({
      asg: {
        eventKey: "ek-b2",
        payStatus: "Paid",
        paidFrom: "Owner money",
        guestPaidAmt: 400,
        topUpFrom: "Own money",
        stewIds: ["airi"],
        dayPayByStew: { airi: 450 },
        start: "2026-08-12",
        summary: "Boss guest",
        _floatPayFrom: "Owner money",
        _floatPayMark: false,
        _floatPayPayerId: "captain",
      },
      dayPayAmt: function () {
        return 450;
      },
      stewName: function () {
        return "Airi";
      },
      nowIso: "2026-08-12T12:00:00.000Z",
      newId: function () {
        return "bline";
      },
    });
    ok("boss plan paidFrom Owner", planBoss.lines[0] && planBoss.lines[0].paidFrom === "Owner money");
    ok("boss plan primary 400", planBoss.lines[0] && near(planBoss.lines[0].guestPaidAmt, 400));
    ok("boss plan topUp 50", planBoss.lines[0] && near(planBoss.lines[0].topUpAmt, 50));
  }
  /* On-bill tip payout date = pay day; must hit petty (not misread as day-pay) */
  const tipPayDate = M.planStewTipPayoutExpense({
    asg: {
      eventKey: "uid:diego",
      tipTotal: 200,
      tipSource: "card",
      tipPayStatus: "Paid",
      start: "2026-07-14",
      stewIds: ["laura"],
      summary: "diego",
      tipPaidBy: { captain: true, laura: true },
    },
    nowIso: "2026-08-03T14:46:00.000Z",
    payDate: "2026-08-03",
    newId: function () {
      return "tip-" + Math.random();
    },
    stewName: function () {
      return "Laura";
    },
  });
  ok(
    "tip payout uses pay date not charter",
    tipPayDate.lines &&
      tipPayDate.lines.length >= 1 &&
      tipPayDate.lines.every(function (ln) {
        return ln && ln.date === "2026-08-03";
      }),
    "got " + (tipPayDate.lines && tipPayDate.lines.map(function (l) { return l.date; }))
  );
  ok(
    "tip payout is not crew day-pay",
    tipPayDate.lines &&
      tipPayDate.lines.every(function (ln) {
        return !M.isCrewDayPayExpense(ln);
      })
  );
  const tipPetty = M.summarizePettyCash({
    pettyStart: 200,
    cashIns: [],
    expenses: tipPayDate.lines || [],
  });
  ok(
    "tip payout hits petty cash out",
    tipPetty.cashOut > 100,
    "got " + tipPetty.cashOut
  );
  const tipNo = M.planStewTipPayoutExpense({
    asg: { eventKey: "uid:a", tipTotal: 50, tipSource: "cash", tipPayStatus: "Paid" },
  });
  ok("cash tip paid → remove only", tipNo.line === null && tipNo.remove === true);
  const tipYes = M.planStewTipPayoutExpense({
    asg: {
      eventKey: "uid:a",
      tipTotal: 121,
      tipSource: "card",
      tipPayStatus: "Paid",
      start: "2026-07-01",
      stewIds: ["s1"],
      summary: "Day",
    },
    newId: function () {
      return "t1";
    },
    formatMoney: function (n) {
      return "€" + n;
    },
    stewName: function () {
      return "Stew";
    },
  });
  const tipYesSum = (tipYes.lines || []).reduce(function (s, ln) {
    return s + (ln && ln.amount ? ln.amount : 0);
  }, 0);
  ok("on-bill tip paid → 2 person lines", tipYes.lines && tipYes.lines.length === 2);
  ok("on-bill tip paid → after VAT pool 100", near(tipYesSum, 100));
  ok("tip category Crew tip payout", tipYes.lines[0] && tipYes.lines[0].category === "Crew tip payout");
  ok(
    "APA sync skip without create",
    M.planApaShortfallSync({ overage: 100, hasReusable: false, allowCreate: false }).action === "skip"
  );
  ok(
    "APA sync create when allowed",
    M.planApaShortfallSync({ overage: 100, hasReusable: false, allowCreate: true }).action === "create"
  );
  ok(
    "APA sync pin locked charge",
    M.planApaShortfallSync({ overage: 50, hasReusable: true, force: true, chargeLocked: true }).action === "pin"
  );
  ok(
    "APA sync update unlocked",
    M.planApaShortfallSync({ overage: 50, hasReusable: true, force: true, chargeLocked: false }).action ===
      "update"
  );
  /* Zero-pot diesel spend: first charge must be creatable when allowCreate (saveApa first-shortfall) */
  ok(
    "zero-pot overspend create when allowCreate",
    M.planApaShortfallSync({
      overage: 180,
      hasReusable: false,
      allowCreate: true,
      suppressShortfall: false,
      paidManual: false,
    }).action === "create"
  );
  ok(
    "zero-pot still skip without allowCreate (no Danny×2 from jobs)",
    M.planApaShortfallSync({ overage: 180, hasReusable: false, allowCreate: false }).action === "skip"
  );
  /* After captain deletes shortfall charge, suppress stays until Sync / diesel save (allowCreate) */
  ok(
    "suppress blocks recreate without allowCreate",
    M.planApaShortfallSync({
      overage: 180,
      hasReusable: false,
      allowCreate: false,
      suppressShortfall: true,
    }).action === "clear"
  );
  ok(
    "suppress + allowCreate recreates (diesel after delete)",
    M.planApaShortfallSync({
      overage: 180,
      hasReusable: false,
      allowCreate: true,
      suppressShortfall: true,
    }).action === "create"
  );
  /* Diesel line deleted: reduce / clear shortfall charge */
  ok(
    "has charge + lower overage → update",
    M.planApaShortfallSync({
      overage: 100,
      hasReusable: true,
      force: true,
      chargeLocked: false,
    }).action === "update"
  );
  ok(
    "has charge + zero overage → remove (not €0 ghost)",
    M.planApaShortfallSync({
      overage: 0,
      hasReusable: true,
      force: true,
      chargeLocked: false,
    }).action === "remove"
  );
  ok(
    "locked charge + zero overage → pin (keep Issued/Paid)",
    M.planApaShortfallSync({
      overage: 0,
      hasReusable: true,
      force: true,
      chargeLocked: true,
    }).action === "pin"
  );
  /* Owner’s days: APA diesel generally not guest-invoiced */
  ok(
    "owner days: no auto-create shortfall",
    M.planApaShortfallSync({
      overage: 1448,
      hasReusable: false,
      allowCreate: true,
      ownerDays: true,
    }).action === "skip"
  );
  ok(
    "owner days: drop unpaid shortfall",
    M.planApaShortfallSync({
      overage: 1448,
      hasReusable: true,
      force: true,
      chargeLocked: false,
      ownerDays: true,
      chargeIsPaid: false,
    }).action === "remove"
  );
  ok(
    "owner days: keep paid shortfall if already Paid",
    M.planApaShortfallSync({
      overage: 1448,
      hasReusable: true,
      force: true,
      ownerDays: true,
      chargeIsPaid: true,
    }).action === "pin"
  );
  ok(
    "owner days: allowOwnerShortfall can still create",
    M.planApaShortfallSync({
      overage: 1448,
      hasReusable: false,
      allowCreate: true,
      ownerDays: true,
      allowOwnerShortfall: true,
    }).action === "create"
  );
}

/* ---- Controllers (MVC blueprint — no formulas, wire models only) ---- */
console.log("\n[Controllers — expenses + charges + leads + apa + stews]");
{
  ok("LY_CONTROLLERS.expenses present", !!(C && C.expenses && C.expenses.monthSettlement));
  ok("LY_CONTROLLERS.charges present", !!(C && C.charges && C.charges.cashToBoat));
  ok("LY_CONTROLLERS.charges exportCsv present", !!(C && C.charges && C.charges.exportCsv));
  ok("LY_CONTROLLERS.charges exportExcel present", !!(C && C.charges && C.charges.exportExcel));
  ok("LY_CONTROLLERS.leads present", !!(C && C.leads && C.leads.realisedGlimpse));
  ok("LY_CONTROLLERS.apa present", !!(C && C.apa && C.apa.tripTotals));
  ok("LY_CONTROLLERS.stews present", !!(C && C.stews && C.stews.tipIsOnBill));
  ok("write plan day pay on controller", !!(C.stews.planDayPayExpenseSync));
  ok("write plan APA shortfall on controller", !!(C.apa.planShortfallSync));
  ok(
    "ctrl charge cash to boat",
    near(C.charges.cashToBoat({ models: M, charge: { amount: 100, billType: "cash", payStatus: "Paid", cashPaid: 100 } }), 100)
  );
  const ctrlCsv = C.charges.exportCsv({
    models: M,
    charges: [
      { date: "2026-06-01", client: "A", amount: 50, billType: "cash", payMethod: "Cash", payStatus: "Paid", cashPaid: 50 },
      { date: "2026-06-02", client: "B", amount: 100, billType: "invoice", payMethod: "Card", payStatus: "Paid" },
    ],
    asOfYmd: "2026-06-30",
  });
  ok("ctrl export csv n 2", ctrlCsv.n === 2);
  ok("ctrl export csv has Card", ctrlCsv.csv.indexOf("Card") >= 0);
  ok("ctrl export csv has Cash", ctrlCsv.csv.indexOf("Cash") >= 0);
  const ctrlXls = C.charges.exportExcel({
    models: M,
    charges: [
      { date: "2026-06-01", client: "A", amount: 50, billType: "cash", payMethod: "Cash", payStatus: "Paid", cashPaid: 50 },
    ],
    asOfYmd: "2026-06-30",
  });
  ok("ctrl export excel n 1", ctrlXls.n === 1);
  ok("ctrl export excel has Money style", ctrlXls.xml.indexOf('ss:StyleID="Money"') >= 0);
  const apaC = C.apa.tripTotals({
    models: M,
    trip: {
      apaSent: 500,
      topUps: 0,
      expenses: [{ amount: 100, category: "Drinks & Bar" }],
      provisions: [],
      diesel: [],
    },
    paidCovered: 0,
    cashSettled: false,
    dieselLines: [],
  });
  ok("ctrl APA bal 400", near(apaC.bal, 400));

  const CAP = M.EXP_POCKET_CAPTAIN || "captain";
  const fig = C.expenses.monthSettlement({
    models: M,
    month: "2026-07",
    allExpenses: [
      {
        id: "crew-own",
        date: "2026-07-15",
        vendor: "Rebecca",
        amount: 261,
        source: "stew",
        stewPayKind: "dayPay",
        stewId: "s-reb",
        crewPayStatus: "Paid",
        paidFrom: "Own money",
        paidById: CAP,
        floatPay: false,
      },
      {
        id: "petty-shop",
        date: "2026-07-16",
        vendor: "Fuel dock",
        amount: 50,
        category: "Fuel",
        payMethod: "Cash",
        paidFrom: "Petty cash",
      },
      {
        id: "reimb-aug",
        date: "2026-08-01",
        amount: 261,
        category: "Captain reimbursement",
        reimburseCaptain: true,
        reimburseToId: CAP,
        reimbursesExpenseId: "crew-own",
        paidFrom: "Petty cash",
        payMethod: "Cash",
      },
    ],
    petty: { pettyStart: 500, cashIns: [], startMode: "manual", startManual: true },
    stewAssign: [],
    today: "2026-07-31",
    personName: function () {
      return "Captain";
    },
  });
  ok("controller petty out 50", near(fig.cashOut, 50));
  ok("controller own money 261", near(fig.ownMoneyExp, 261));
  ok(
    "controller marks Rebecca repaid via later reimburse",
    (fig.pocketOutLines || []).some(function (p) {
      return p.id === "crew-own" && p.repaid === true;
    })
  );
  ok("controller onboard 450", near(fig.pettyOnboard, 450));
  const open = C.expenses.openPocketOuts({
    models: M,
    month: "2026-08",
    expenses: [
      {
        id: "shop",
        date: "2026-07-10",
        amount: 80,
        category: "Provisions",
        paidFrom: "Own money",
        paidById: CAP,
        payMethod: "Cash",
      },
    ],
    personName: function () {
      return "Captain";
    },
  });
  ok("controller open pocket has shop", open.some(function (r) {
    return r.id === "shop" && near(r.amount, 80);
  }));
}

/* ---- Pocket liabilities / own-money repay (Keepafloat foundation) ---- */
console.log("\n[Pocket — own-money repay + open liabilities]");
{
  const CAP = M.EXP_POCKET_CAPTAIN || "captain";
  const rebecca = {
    id: "exp-rebecca-261",
    date: "2026-07-15",
    vendor: "Rebecca",
    amount: 261,
    source: "stew",
    stewPayKind: "dayPay",
    stewId: "s-reb",
    stewEventKey: "uid:reb",
    crewPayStatus: "Paid",
    paidFrom: "Own money",
    paidById: CAP,
    floatPay: false,
  };
  const shop = {
    id: "exp-shop-80",
    date: "2026-07-10",
    vendor: "Eroski",
    amount: 80,
    category: "Provisions",
    payMethod: "Cash",
    paidFrom: "Own money",
    paidById: CAP,
  };
  ok("Rebecca day pay is own-money spend", M.isOwnMoneySpend(rebecca));
  ok("shop is own-money spend", M.isOwnMoneySpend(shop));
  ok("who is captain", M.ownMoneySpendWhoId(rebecca) === CAP);
  ok("unrepaid = 0", M.ownMoneyRepaidAmt(rebecca, [rebecca, shop]) === 0);
  ok("not repaid yet", !M.ownMoneyIsRepaid(rebecca, [rebecca, shop]));

  /* Linked repay in later month */
  const reimbLinked = {
    id: "reimb-1",
    date: "2026-08-02",
    amount: 261,
    category: "Captain reimbursement",
    reimburseCaptain: true,
    reimburseToId: CAP,
    reimbursesExpenseId: "exp-rebecca-261",
    paidFrom: "Petty cash",
    payMethod: "Cash",
  };
  const ledger1 = [rebecca, shop, reimbLinked];
  ok("linked repay covers 261", near(M.ownMoneyRepaidAmt(rebecca, ledger1), 261));
  ok("Rebecca fully repaid via link", M.ownMoneyIsRepaid(rebecca, ledger1));
  ok("shop still open", !M.ownMoneyIsRepaid(shop, ledger1));

  /* Captain pocket month bridge — prior short carries; repay clears prior first */
  {
    const julyStew = {
      id: "j-stew",
      date: "2026-07-25",
      amount: 250,
      paidFrom: "Own money",
      category: "Crew Salaries",
      vendor: "Vicky",
      crewPayStatus: "Paid",
      stewPayKind: "dayPay",
      stewId: "v1",
    };
    const julyShop = {
      id: "j-shop",
      date: "2026-07-18",
      amount: 100,
      paidFrom: "Own money",
      category: "Provisions",
      vendor: "Shop",
    };
    const augRepay = {
      id: "a-repay",
      date: "2026-08-01",
      amount: 350,
      category: "Captain reimbursement",
      vendor: "Captain",
      reimbursesExpenseId: "",
      reimburseCaptain: true,
      paidFrom: "Petty cash",
    };
    const augStew = {
      id: "a-stew",
      date: "2026-08-07",
      amount: 200,
      paidFrom: "Own money",
      category: "Crew Salaries",
      vendor: "Airiana",
      crewPayStatus: "Paid",
      stewPayKind: "dayPay",
      stewId: "a1",
    };
    const bridgeJul = M.summarizeCaptainPocketMonthBridge(
      [julyStew, julyShop, augRepay, augStew],
      "2026-07"
    );
    ok("July bridge month spend 350", near(bridgeJul.monthSpend, 350));
    ok("July bridge stew 250", near(bridgeJul.stewMonth, 250));
    ok("July bridge shop 100", near(bridgeJul.shopMonth, 100));
    ok("July bridge no repay", near(bridgeJul.monthRepay, 0));
    ok("July bridge closing open 350", near(bridgeJul.closingOpen, 350));
    ok("July bridge BF 0", near(bridgeJul.broughtForward, 0));
    const bridgeAug = M.summarizeCaptainPocketMonthBridge(
      [julyStew, julyShop, augRepay, augStew],
      "2026-08"
    );
    ok("Aug bridge BF 350 from July", near(bridgeAug.broughtForward, 350));
    ok("Aug bridge month spend 200", near(bridgeAug.monthSpend, 200));
    ok("Aug bridge repay 350", near(bridgeAug.monthRepay, 350));
    ok("Aug bridge repay clears prior first", near(bridgeAug.repayToPrior, 350));
    ok("Aug bridge repay to this 0", near(bridgeAug.repayToThis, 0));
    ok("Aug bridge still open 200 (new stew)", near(bridgeAug.closingOpen, 200));
    ok("Aug bridge openLines has Airiana", (bridgeAug.openLines || []).length === 1);
    ok(
      "Aug bridge openLines amount 200",
      near((bridgeAug.openLines && bridgeAug.openLines[0] && bridgeAug.openLines[0].remainOpen) || 0, 200)
    );
  }

  /* Excess early repay cannot pre-pay a later pocket spend (live Aug 2026 case) */
  {
    const july = {
      id: "j-vicky",
      date: "2026-07-25",
      amount: 250,
      paidFrom: "Own money",
      paidById: "captain",
      category: "Crew Salaries",
      vendor: "Vicky",
      crewPayStatus: "Paid",
      stewPayKind: "dayPay",
      stewId: "v1",
    };
    const earlyBulk = {
      id: "a-bulk",
      date: "2026-08-01",
      amount: 450, /* more than July 250 — leftover must NOT clear Aug 7 */
      category: "Captain reimbursement",
      vendor: "Captain",
      reimburseCaptain: true,
      paidFrom: "Petty cash",
    };
    const laterStew = {
      id: "a-ari",
      date: "2026-08-07",
      amount: 200,
      paidFrom: "Own money",
      paidById: "captain",
      category: "Crew Salaries",
      vendor: "Airiana",
      crewPayStatus: "Paid",
      stewPayKind: "dayPay",
      stewId: "a1",
      description: "Thomas · charter 2026-08-06",
    };
    const b = M.summarizeCaptainPocketMonthBridge([july, earlyBulk, laterStew], "2026-08");
    ok("excess early repay BF was 250", near(b.broughtForward, 250));
    ok("excess early repay does not wipe later spend", near(b.closingOpen, 200));
    ok("excess early repay to this month 0", near(b.repayToThis, 0));
    ok("Airiana still open in openLines", (b.openLines || []).some(function (r) {
      return near(r.remainOpen, 200) && /Airiana/i.test(String(r.vendor || ""));
    }));
  }

  /* Crew pay month DTO — fund buckets in model only */
  {
    const pot = {
      id: "c1",
      date: "2026-07-04",
      amount: 500,
      source: "stew",
      stewPayKind: "dayPay",
      stewId: "t1",
      crewPayStatus: "Paid",
      floatPay: true,
      paidFrom: "Petty cash",
      vendor: "Toni",
    };
    const cap = {
      id: "c2",
      date: "2026-07-25",
      amount: 250,
      source: "stew",
      stewPayKind: "dayPay",
      stewId: "v1",
      crewPayStatus: "Paid",
      floatPay: false,
      paidFrom: "Own money",
      vendor: "Vicky",
    };
    const books = {
      id: "c3",
      date: "2026-07-03",
      amount: 200,
      source: "stew",
      stewPayKind: "dayPay",
      stewId: "b1",
      crewPayStatus: "Paid",
      floatPay: false,
      paidFrom: "Petty cash",
      vendor: "Becks",
    };
    const crewM = M.summarizeCrewPayMonth([pot, cap, books], "2026-07");
    ok("crew fund pot", M.crewDayPayFundSource(pot) === "pot");
    ok("crew fund captain", M.crewDayPayFundSource(cap) === "captain");
    ok("crew fund books", M.crewDayPayFundSource(books) === "books");
    ok("crew fromBoatPot 500", near(crewM.fromBoatPot, 500));
    ok("crew fromCaptain 250", near(crewM.fromCaptain, 250));
    ok("crew booksOnly 200", near(crewM.booksOnly, 200));
    ok("crew paidTotal 950 (not cash-out)", near(crewM.paidTotal, 950));
    ok("crew potLines n=1", crewM.potLines.length === 1);
    const buckets = M.summarizePettyCashOutBuckets([pot, cap, books]);
    ok("bucket crew day pay = pot only 500", near(buckets.crewDayPay, 500));
  }

  /* Month as-of: July report must ignore August repay / future ledger */
  {
    const julSpend = {
      id: "asof-j",
      date: "2026-07-20",
      amount: 100,
      paidFrom: "Own money",
      category: "Provisions",
      vendor: "Shop",
    };
    const augRepayAsOf = {
      id: "asof-r",
      date: "2026-08-05",
      amount: 100,
      category: "Captain reimbursement",
      reimburseCaptain: true,
      paidFrom: "Petty cash",
    };
    const ledgerAsOf = [julSpend, augRepayAsOf];
    ok(
      "full ledger: July spend repaid in Aug",
      M.ownMoneyIsRepaid(julSpend, ledgerAsOf)
    );
    ok(
      "through July: July spend NOT repaid yet",
      !M.ownMoneyIsRepaid(julSpend, ledgerAsOf, { throughMonth: "2026-07" })
    );
    ok(
      "through July repaid amt 0",
      near(M.ownMoneyRepaidAmt(julSpend, ledgerAsOf, { throughMonth: "2026-07" }), 0)
    );
    ok(
      "through Aug repaid amt 100",
      near(M.ownMoneyRepaidAmt(julSpend, ledgerAsOf, { throughMonth: "2026-08" }), 100)
    );
    const filt = M.filterLedgerThroughMonth(ledgerAsOf, "2026-07");
    ok("filter through July keeps 1 row", filt.length === 1 && filt[0].id === "asof-j");
    ok("isOnOrBeforeMonth July ok", M.isOnOrBeforeMonth("2026-07-31", "2026-07"));
    ok("isOnOrBeforeMonth Aug after July false", !M.isOnOrBeforeMonth("2026-08-01", "2026-07"));
  }

  /* Petty month open/close carry — pure, no mutation of rows */
  {
    const crewFloat = {
      id: "crew-fp",
      date: "2026-07-20",
      amount: 110,
      source: "stew",
      stewPayKind: "dayPay",
      stewId: "t1",
      crewPayStatus: "Paid",
      floatPay: true,
      paidFrom: "Petty cash",
      vendor: "Toni",
    };
    const pettyRows = [
      {
        month: "2026-07",
        pettyStart: 0,
        broughtForwardShort: 0,
        startMode: "manual",
        startManual: true,
        cashIns: [{ id: "ci1", amount: 100, source: "ATM", date: "2026-07-01" }],
      },
      {
        month: "2026-08",
        pettyStart: 0,
        broughtForwardShort: 0,
        startMode: "carry",
        cashIns: [{ id: "ci2", amount: 500, source: "Cash in", date: "2026-08-01" }],
      },
    ];
    const snap = JSON.stringify(pettyRows);
    const julClose = M.resolvePettyMonthClose("2026-07", pettyRows, [crewFloat], {});
    ok("July close onboard 0 after float 110 on 100 in", near(julClose.onboard, 0));
    ok("July close short 10 (100 in − 110 out)", near(julClose.short, 10));
    const augOpen = M.resolvePettyMonthOpen("2026-08", pettyRows, [crewFloat], {});
    ok("Aug open start from July onboard 0", near(augOpen.pettyStart, 0));
    ok("Aug open BF short from July residual", near(augOpen.broughtForwardShort, 10));
    ok("Aug open source carry", augOpen.source === "carry" || augOpen.startMode === "carry");
    const augClose = M.resolvePettyMonthClose("2026-08", pettyRows, [crewFloat], {});
    /* 500 cash-in, BF 10 settled first → 490 onboard, no outs in Aug */
    ok("Aug close onboard 490 after BF settle", near(augClose.onboard, 490));
    ok("Aug close short 0", near(augClose.short, 0));
    ok("petty rows not mutated by resolve", JSON.stringify(pettyRows) === snap);
    /* Sep: empty start 0 + cash-in activity must still open from Aug close (€490), not lock at €0 */
    const pettyWithSep = pettyRows.concat([
      {
        month: "2026-09",
        pettyStart: 0,
        broughtForwardShort: 0,
        cashIns: [{ id: "ci3", amount: 100, source: "ATM", date: "2026-09-02" }],
      },
    ]);
    const sepOpen = M.resolvePettyMonthOpen("2026-09", pettyWithSep, [crewFloat], {});
    ok("Sep open carries Aug close 490 despite zero stored start + cash-in", near(sepOpen.pettyStart, 490));
    ok("Sep open is carry (not locked legacy 0)", sepOpen.startMode === "carry");
    const sepOpenManual0 = M.resolvePettyMonthOpen(
      "2026-09",
      [
        pettyRows[0],
        pettyRows[1],
        {
          month: "2026-09",
          pettyStart: 0,
          startMode: "manual",
          startManual: true,
          cashIns: [{ id: "ci3", amount: 100, source: "ATM", date: "2026-09-02" }],
        },
      ],
      [crewFloat],
      {}
    );
    /* Accidental Save start at €0 must not wipe prior on-board notes */
    ok("Sep zero-manual still carries Aug close 490", near(sepOpenManual0.pettyStart, 490));
    ok("Sep zero-manual source is carry", sepOpenManual0.startMode === "carry");
    const sepOpenManualPos = M.resolvePettyMonthOpen(
      "2026-09",
      [
        pettyRows[0],
        pettyRows[1],
        {
          month: "2026-09",
          pettyStart: 200,
          startMode: "manual",
          startManual: true,
          cashIns: [],
        },
      ],
      [crewFloat],
      {}
    );
    ok("Sep positive manual start stays locked", near(sepOpenManualPos.pettyStart, 200));
    const planClear = M.planClearCrewFloatPayOnEmptyEnvelope(
      [crewFloat],
      0,
      [],
      { keepManual: true }
    );
    ok("plan clear floatPay on empty env", planClear.changed && planClear.clearIds.indexOf("crew-fp") >= 0);
    const planMat = M.planPettyCarryMaterialize(pettyRows, [crewFloat], ["2026-08"], {});
    ok("plan materialize has Aug patch", planMat.n >= 1 && planMat.patches.some(function (p) {
      return p.month === "2026-08" && near(p.fields.broughtForwardShort, 10);
    }));
  }

  const openAug = M.collectOpenPocketOuts(ledger1, "2026-08", {
    personName: function () {
      return "Captain";
    },
  });
  ok("open pocket drops Rebecca after link", openAug.every(function (r) {
    return r.id !== "exp-rebecca-261";
  }));
  ok("open pocket still has shop 80", openAug.some(function (r) {
    return r.id === "exp-shop-80" && near(r.amount, 80);
  }));

  /* Unlinked FIFO: bulk repay captain covers oldest first */
  const reimbFifo = {
    id: "reimb-fifo",
    date: "2026-08-05",
    amount: 80,
    category: "Captain reimbursement",
    reimburseCaptain: true,
    reimburseToId: CAP,
    paidFrom: "Petty cash",
    payMethod: "Cash",
  };
  const ledger2 = [shop, rebecca, reimbFifo]; /* shop 10 Jul, Rebecca 15 Jul — shop first */
  ok("FIFO covers shop first", M.ownMoneyIsRepaid(shop, ledger2));
  ok("FIFO does not cover Rebecca with only 80", !M.ownMoneyIsRepaid(rebecca, ledger2));
  ok("FIFO partial for shop amount", near(M.ownMoneyRepaidAmt(shop, ledger2), 80));

  /* Settled day-pay sets */
  const paidExp = {
    id: "pd1",
    source: "stew",
    stewPayKind: "dayPay",
    stewId: "s1",
    stewEventKey: "uid:a",
    date: "2026-07-20",
    crewPayStatus: "Paid",
    amount: 200,
    paidFrom: "Petty cash",
    floatPay: true,
    linkId: "stew-day:uid:a:s1",
  };
  const settled = M.buildCrewDayPaySettledSets([paidExp]);
  ok("settled by event|stew", !!settled.byEventStew["uid:a|s1"]);
  ok("settled by finger", !!settled.byFinger["s1|2026-07-20"]);
  const asgOpen = {
    eventKey: "uid:b",
    start: "2026-07-21",
    stewIds: ["s1"],
    payStatus: "Unpaid",
    payEach: 200,
    summary: "Charter B",
  };
  const asgSettled = {
    eventKey: "uid:a",
    start: "2026-07-20",
    stewIds: ["s1"],
    payStatus: "Unpaid",
    payEach: 200,
  };
  ok(
    "expense Paid settles assign",
    M.isCrewDayPaySettled(asgSettled, "s1", settled)
  );
  ok(
    "other charter not settled",
    !M.isCrewDayPaySettled(asgOpen, "s1", settled)
  );
  const openDay = M.collectOpenCrewDayPay([asgOpen, asgSettled], [paidExp], {
    focusMonth: "2026-07",
    today: "2026-07-31",
    dayPayAmt: function (a) {
      return Number(a.payEach) || 0;
    },
    personName: function () {
      return "Toni";
    },
  });
  ok("open day pay only unpaid charter", openDay.length === 1, "got " + openDay.length);
  ok("open day pay is Charter B", openDay[0] && openDay[0].eventKey === "uid:b");
  /* Tomorrow / not-finished charter must not appear as unpaid today */
  const asgTomorrow = {
    eventKey: "uid:future",
    start: "2026-08-01",
    end: "2026-08-01",
    stewIds: ["s1"],
    payStatus: "Unpaid",
    payEach: 200,
    summary: "Tomorrow",
  };
  const openNotYet = M.collectOpenCrewDayPay([asgTomorrow, asgOpen], [], {
    focusMonth: "2026-07",
    today: "2026-07-31",
    dayPayAmt: function (a) {
      return Number(a.payEach) || 0;
    },
    personName: function () {
      return "Toni";
    },
  });
  ok("open day pay skips tomorrow", openNotYet.every(function (r) {
    return r.eventKey !== "uid:future";
  }));
  ok("open day pay still has past unpaid", openNotYet.some(function (r) {
    return r.eventKey === "uid:b";
  }));
  /* Same-day charter: not finished until day after */
  const asgToday = {
    eventKey: "uid:today",
    start: "2026-07-31",
    stewIds: ["s1"],
    payStatus: "Unpaid",
    payEach: 200,
  };
  const openToday = M.collectOpenCrewDayPay([asgToday], [], {
    focusMonth: "2026-07",
    today: "2026-07-31",
    dayPayAmt: function (a) {
      return 200;
    },
    personName: function () {
      return "Toni";
    },
  });
  ok("open day pay skips unfinished today", openToday.length === 0);

  /* Settlement DTO */
  const sett = M.summarizeMonthSettlement({
    expenses: [
      {
        id: "crew-own",
        date: "2026-07-15",
        vendor: "Rebecca",
        amount: 261,
        source: "stew",
        stewPayKind: "dayPay",
        stewId: "s-reb",
        crewPayStatus: "Paid",
        paidFrom: "Own money",
        paidById: CAP,
        floatPay: false,
      },
      {
        id: "petty-shop",
        date: "2026-07-16",
        vendor: "Fuel dock",
        amount: 50,
        category: "Fuel",
        payMethod: "Cash",
        paidFrom: "Petty cash",
      },
    ],
    allExpenses: [
      {
        id: "crew-own",
        date: "2026-07-15",
        vendor: "Rebecca",
        amount: 261,
        source: "stew",
        stewPayKind: "dayPay",
        stewId: "s-reb",
        crewPayStatus: "Paid",
        paidFrom: "Own money",
        paidById: CAP,
      },
      {
        id: "reimb-aug",
        date: "2026-08-01",
        amount: 261,
        category: "Captain reimbursement",
        reimburseCaptain: true,
        reimburseToId: CAP,
        reimbursesExpenseId: "crew-own",
        paidFrom: "Petty cash",
        payMethod: "Cash",
      },
    ],
    pettyStart: 500,
    cashIns: [{ amount: 0 }],
    openDayPay: [],
    openTips: [],
    personName: function () {
      return "Captain";
    },
  });
  ok("settlement petty out 50 only (own money not float)", near(sett.cashOut, 50));
  ok("settlement own money exp 261", near(sett.ownMoneyExp, 261));
  ok(
    "settlement pocket line repaid via later month",
    sett.pocketOutLines.some(function (p) {
      return p.id === "crew-own" && p.repaid === true;
    })
  );
  ok("settlement physical onboard 450", near(sett.pettyOnboard, 450));
}

/* ---- Stew roster status (assigned = resolvable crew) ---- */
console.log("\n[Stew roster — assigned / unassigned / cancelled]");
{
  const stews = [
    { id: "s1", name: "Toni" },
    { id: "s2", name: "Laura" },
  ];
  const events = [
    { key: "uid:a", start: "2026-07-20", summary: "Charter A", status: "booked" },
    { key: "uid:b", start: "2026-07-21", summary: "Charter B", status: "booked" },
    { key: "uid:c", start: "2026-07-22", summary: "Charter C", status: "booked" },
    { key: "uid:d", start: "2026-07-23", summary: "Off", status: "booked" }, // off day skipped
    { key: "uid:e", start: "2026-07-24", summary: "Charter E", status: "cancelled" },
  ];
  const assigns = [
    { eventKey: "uid:a", stewIds: ["s1"], start: "2026-07-20", summary: "Charter A" },
    { eventKey: "b", stewIds: ["s2"], start: "2026-07-21", summary: "Charter B" }, // bare key match
    { eventKey: "uid:c", stewIds: ["gone"], start: "2026-07-22", summary: "Charter C" }, // dead id → unassigned
    { eventKey: "uid:e", stewIds: ["s1"], cancelled: true, start: "2026-07-24", summary: "Charter E" },
  ];
  ok("keys match uid vs bare", M.stewKeysMatch("uid:b", "b"));
  ok("has crew Toni", M.stewAssignHasCrew(assigns[0], stews));
  ok("dead stewId is NOT crew", !M.stewAssignHasCrew(assigns[2], stews));
  ok("cancelled flag", M.stewEventIsCancelled(events[4], assigns[3]));
  ok("status cancelled on event", M.stewEventIsCancelled(events[4], null));
  const sum = M.stewRosterSummary(events, assigns, stews);
  ok("trips skip off days (4 not 5)", sum.trips === 4, "got " + sum.trips);
  ok("assigned 2 (A+B)", sum.assigned === 2, "got " + sum.assigned);
  ok("unassigned 1 (C dead id)", sum.unassigned === 1, "got " + sum.unassigned);
  ok("cancelled 1", sum.cancelled === 1, "got " + sum.cancelled);
  ok("A+U+C = trips", sum.assigned + sum.unassigned + sum.cancelled + (sum.none||0) === sum.trips);
  /* No stew needed (friends day) */
  const noneAsg = {
    eventKey: "uid:friends",
    start: "2026-07-25",
    summary: "Friends day",
    stewIds: [],
    noStewNeeded: true,
  };
  ok("noStewNeeded flag", M.stewAssignNoStewNeeded(noneAsg));
  ok(
    "status none for friends day",
    M.stewRosterStatus(
      { key: "uid:friends", start: "2026-07-25", summary: "Friends day" },
      noneAsg,
      stews
    ) === "none"
  );
  const sumNone = M.stewRosterSummary(
    [{ key: "uid:friends", start: "2026-07-25", summary: "Friends day" }],
    [noneAsg],
    stews
  );
  ok("none count 1", sumNone.none === 1, "got " + sumNone.none);
  ok("none is not unassigned", sumNone.unassigned === 0);
  ok("none + others = trips", sumNone.assigned + sumNone.unassigned + sumNone.cancelled + sumNone.none === sumNone.trips);
  ok(
    "find assign bare key for uid:b event",
    M.findAssignForEvent(assigns, events[1]) && M.findAssignForEvent(assigns, events[1]).stewIds[0] === "s2"
  );
  ok("status A assigned", M.stewRosterStatus(events[0], assigns[0], stews) === "assigned");
  ok("status C unassigned", M.stewRosterStatus(events[2], assigns[2], stews) === "unassigned");
  ok("off event detected", M.stewIsOffEvent({ summary: "Off" }));
  /* Fuzzy summary must NOT steal an assign across same-day charters */
  {
    const day = [
      { key: "uid:x1", start: "2026-08-01", summary: "Morning private", status: "booked" },
      { key: "uid:x2", start: "2026-08-01", summary: "Evening private", status: "booked" },
    ];
    const asg = [
      {
        eventKey: "uid:x1",
        start: "2026-08-01",
        summary: "Morning private",
        stewIds: ["s1"],
      },
    ];
    const s2 = M.stewRosterSummary(day, asg, stews);
    ok("same-day: one assigned", s2.assigned === 1, "got " + s2.assigned);
    ok("same-day: one unassigned (no fuzzy steal)", s2.unassigned === 1, "got " + s2.unassigned);
    const rowX2 = s2.rows.find(function (r) {
      return r.event.key === "uid:x2";
    });
    ok("evening card unassigned", rowX2 && rowX2.status === "unassigned");
  }
}

console.log("\n──────────────────────────────────────────────────────────");
if (failed) {
  console.log("FAILED  " + failed + " check(s)");
  process.exit(1);
}
console.log("PASSED  All tracker model checks");
console.log("──────────────────────────────────────────────────────────\n");
