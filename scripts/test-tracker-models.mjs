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
  const chk = spawnSync(process.execPath, ["--check", join(root, "tracker/js/models.js")], {
    encoding: "utf8",
  });
  ok("models.js syntax", chk.status === 0, chk.stderr || chk.stdout);
}

checkTrackerHtmlSyntax();
function near(a, b, eps) {
  eps = eps == null ? 0.02 : eps;
  return Math.abs(Number(a) - Number(b)) <= eps;
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  Tracker domain models (locked rules)");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

/* ---- Commission: VAT-included total (Joel) ---- */
console.log("[Commission — VAT included]");
{
  const joel = { total: 12000, base: 12000, net: 9917.36, vatMode: "include", vatPct: 21 };
  const p = M.leadCommissionParts(joel);
  ok("Joel base ≈ 12000/1.21", near(p.base, 12000 / 1.21, 0.05), "got " + p.base);
  ok("Joel commission ≈ 1487.60", near(p.total, (12000 / 1.21) * 0.15, 0.05), "got " + p.total);
  ok("Joel commission is NOT 1800", !near(p.total, 1800, 1), "got " + p.total);
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
  ok("white comm 15%", near(p.whiteComm, whiteNet * 0.15, 0.05));
  ok("cash comm 15% of 1800", near(p.cashComm, 270, 0.02));
  ok("total = white comm + cash comm", near(p.total, p.whiteComm + p.cashComm, 0.02));
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
  ok("suggested cash ≈ dealNet − white net", near(M.leadSuggestedCashAmt(lead), 4000 / 1.21 - 2000 / 1.21, 1));
}

/* ---- Lead source ---- */
console.log("\n[Lead source model]");
ok("constrain other", M.constrainLeadSource("agency") === "other");
ok("constrain captain", M.constrainLeadSource("captain") === "captain");
ok("isCaptainLead", M.isCaptainLead({ leadSource: "captain" }));
ok("not captain", !M.isCaptainLead({ leadSource: "other" }));

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
  ok("extension commission ~130.17", near(p.total, (1050 / 1.21) * 0.15, 0.05), "got " + p.total);
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
  ok("€500 cash: commission €75", near(p.total, 75), "got " + p.total);
  ok("€500 cash: mode cash", p.mode === "cash");
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
  ok("€500 invoice: commission ≈ 61.98", near(p.total, (500 / 1.21) * 0.15, 0.05), "got " + p.total);
  ok("€500 invoice: mode invoice", p.mode === "invoice");
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
  ok("same-bill inv: not 15% of 1300", !near(p.total, (1300 / 1.21) * 0.15, 1));
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
  ok("same-bill cash ext: comm €75", near(p.total, 75));
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

console.log("\n──────────────────────────────────────────────────────────");
if (failed) {
  console.log("FAILED  " + failed + " check(s)");
  process.exit(1);
}
console.log("PASSED  All tracker model checks");
console.log("──────────────────────────────────────────────────────────\n");
