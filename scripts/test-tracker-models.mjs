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
