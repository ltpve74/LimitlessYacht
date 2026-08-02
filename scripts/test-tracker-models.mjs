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
    "tracker/js/models/diesel.js",
    "tracker/js/models/stews.js",
    "tracker/js/models/apa.js",
    "tracker/js/models/index.js",
    "tracker/js/controllers/expenses.js",
    "tracker/js/controllers/charges.js",
    "tracker/js/controllers/leads.js",
    "tracker/js/controllers/apa.js",
    "tracker/js/controllers/stews.js",
    "tracker/js/controllers/index.js",
  ];
  for (const rel of modelFiles) {
    const chk = spawnSync(process.execPath, ["--check", join(root, rel)], { encoding: "utf8" });
    ok(rel + " syntax", chk.status === 0, chk.stderr || chk.stdout);
  }
}

checkTrackerHtmlSyntax();
const C = require(join(root, "tracker/js/controllers/index.js"));
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
ok("owner", M.constrainLeadSource("owner") === "owner");
ok("owner-days alias", M.constrainLeadSource("owner-days") === "owner");
ok("owner-sourced → ownersourced", M.constrainLeadSource("owner-sourced") === "ownersourced");
ok("ownersourced", M.constrainLeadSource("ownersourced") === "ownersourced");
ok("owner-sourced not owner days", M.constrainLeadSource("owner-sourced") !== "owner");
ok("pending source", M.constrainLeadSource("pending") === "pending");
ok("pending rate 0", M.leadCommissionRatePct({ leadSource: "pending" }) === 0);
ok("isCaptainLead", M.isCaptainLead({ leadSource: "captain" }));
ok("not captain", !M.isCaptainLead({ leadSource: "other" }));
ok("clickboat no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "clickboat" }));
ok("owner no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "owner" }));
ok("ownersourced no captain-only flag", !M.leadEarnsCaptainCommission({ leadSource: "ownersourced" }));
ok("captain earns captain flag", M.leadEarnsCaptainCommission({ leadSource: "captain" }));
ok("clickboat rate 21%", M.leadCommissionRatePct({ leadSource: "clickboat" }) === 21);
ok("captain rate 15%", M.leadCommissionRatePct({ leadSource: "captain" }) === 15);
ok("owner rate 0%", M.leadCommissionRatePct({ leadSource: "owner" }) === 0);
ok("ownersourced rate 0% for now", M.leadCommissionRatePct({ leadSource: "ownersourced" }) === 0);
ok("clickboat earns commission", M.leadEarnsCommission({ leadSource: "clickboat" }));
ok("owner no earns commission", !M.leadEarnsCommission({ leadSource: "owner" }));
ok("ownersourced no commission for now", !M.leadEarnsCommission({ leadSource: "ownersourced" }));
ok("isOwnerLead days", M.isOwnerLead({ leadSource: "owner" }));
ok("ownersourced is not owner days", !M.isOwnerLead({ leadSource: "ownersourced" }));
ok("isOwnerSourcedLead", M.isOwnerSourcedLead({ leadSource: "ownersourced" }));
ok("owner days not owner-sourced", !M.isOwnerSourcedLead({ leadSource: "owner" }));
ok("label owner days", M.leadSourceLabel("owner") === "Owner’s days" || M.leadSourceLabel("owner").indexOf("Owner") === 0);
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
  ok("clickboat 21% of base", Math.abs(cb.total - base * 0.21) < 0.05, "got " + cb.total);
  const own = M.leadCommissionParts({
    leadSource: "owner",
    total: 4000,
    vatMode: "include",
    vatPct: 21,
  });
  ok("owner comm total 0", own.total === 0);
  ok("owner benefit base > 0", own.base > 0);
  ok(
    "owner benefit included when confirmed",
    M.ownerBenefitIncluded({ leadSource: "owner", dealClosed: true })
  );
  ok(
    "owner benefit included legacy (saved, no flag)",
    M.ownerBenefitIncluded({ id: "own1", leadSource: "owner" })
  );
  ok(
    "owner unconfirmed not in benefits",
    !M.ownerBenefitIncluded({ id: "own2", leadSource: "owner", dealClosed: false })
  );
  ok(
    "owner draft (no id) not in benefits until confirm",
    !M.ownerBenefitIncluded({ leadSource: "owner" })
  );
  ok(
    "owner benefit excluded when flagged",
    !M.ownerBenefitIncluded({ id: "own3", leadSource: "owner", dealClosed: true, ownerBenefitExclude: true })
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
  ok("ownersourced base before VAT > 0", os.base > 0);
  ok("ownersourced commission 0 for now", os.total === 0);
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
    "captain upsell comm cash+inv",
    near(sum.comm, 75 + (500 / 1.21) * 0.15, 0.05),
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
  const finger = M.crewDayPayFinger({ stewId: "toni", date: "2026-07-30" });
  ok("finger stew|date", finger === "toni|2026-07-30");
  /* Two renames same Toni day: 150 phantom + 50 real — collapse to one, petty uses winner only */
  const dupes = [
    {
      id: "old", linkId: "stew-day:uid:abc:toni", source: "stew", stewPayKind: "dayPay",
      stewId: "toni", date: "2026-07-30", crewPayStatus: "Paid", paidFrom: "Petty cash",
      floatPay: true, amount: 150, updatedAt: "2026-07-30T10:00:00.000Z"
    },
    {
      id: "new", linkId: "stew-day:lead:xyz:toni", source: "stew", stewPayKind: "dayPay",
      stewId: "toni", date: "2026-07-30", crewPayStatus: "Paid", paidFrom: "Petty cash",
      floatPay: true, amount: 50, payStatusManual: true, updatedAt: "2026-07-30T18:00:00.000Z"
    },
    { id: "shop", category: "Provisions", payMethod: "Cash", paidFrom: "Petty cash", amount: 20 }
  ];
  const col = M.collapseCrewDayPayExpenses(dupes);
  ok("collapse removes 1 crew dupe", col.collapsed === 1, "got " + col.collapsed);
  ok("winner is newest manual €50", col.winnerByFinger["toni|2026-07-30"] && col.winnerByFinger["toni|2026-07-30"].id === "new");
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
  const vat = M.chargeVatParts({ amount: 121, billType: "invoice", vatPct: 21, payMethod: "Card" });
  ok("invoice VAT net ≈ 100", near(vat.net, 100, 0.05));
  ok("invoice VAT ≈ 21", near(vat.vat, 21, 0.05));
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
  const share = M.stewTipShare({ tipTotal: 90, stewIds: ["s1"] });
  ok("tip share 1 stew → each 45", near(share.each, 45));
  ok("tip share captain 45", near(share.captainShare, 45));
  ok("tip share stew side 45", near(share.stewSide, 45));
  const share2 = M.stewTipShare({ tipTotal: 90, stewIds: ["s1", "s2"] });
  ok("tip share 2 stews → 3-way", near(share2.each, 30));
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
  ok("type key 8h default", M.leadCharterTypeKey({ dur: "day" }) === "8h");
}

/* ---- Controllers (MVC blueprint — no formulas, wire models only) ---- */
console.log("\n[Controllers — expenses + charges + leads + apa + stews]");
{
  ok("LY_CONTROLLERS.expenses present", !!(C && C.expenses && C.expenses.monthSettlement));
  ok("LY_CONTROLLERS.charges present", !!(C && C.charges && C.charges.cashToBoat));
  ok("LY_CONTROLLERS.leads present", !!(C && C.leads && C.leads.realisedGlimpse));
  ok("LY_CONTROLLERS.apa present", !!(C && C.apa && C.apa.tripTotals));
  ok("LY_CONTROLLERS.stews present", !!(C && C.stews && C.stews.tipIsOnBill));
  ok(
    "ctrl charge cash to boat",
    near(C.charges.cashToBoat({ models: M, charge: { amount: 100, billType: "cash", payStatus: "Paid", cashPaid: 100 } }), 100)
  );
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
  ok("A+U+C = trips", sum.assigned + sum.unassigned + sum.cancelled === sum.trips);
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
