/**
 * LY_MODELS — Limitless Tracker domain models (pure, no DOM).
 *
 * Single source of truth for money rules we have already locked:
 *   - free cash black (never auto “ex VAT” suggested)
 *   - captain commission (VAT strip; split = white ex VAT + cash)
 *   - charge bill type (cash / invoice / mix)
 *   - charge captain commission (explicit flag only)
 *   - expense envelope: reimbursement / petty vs own-money (structured fields only)
 *
 * Browser: loaded before the main tracker script → window.LY_MODELS
 * Tests:   node scripts/test-tracker-models.mjs
 *
 * When changing a locked rule: update HERE, update tests, then thin wrappers
 * in tracker/index.html — do not re-implement the same math in the UI.
 *
 * NEVER classify money from free-text regex on descriptions. Past data fixes
 * belong in explicit migrations that set category/flags once, not in hot path.
 */
(function (root) {
  "use strict";

  var CAPTAIN_COMMISSION_PCT = 15;
  var BILL_TYPES = { cash: 1, invoice: 1, mix: 1 };
  var LEAD_SOURCES = { captain: 1, other: 1 };

  function num(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    var s = String(v).trim().replace(/[€\s\u00a0]/g, "");
    if (!s) return 0;
    var lastC = s.lastIndexOf(","),
      lastD = s.lastIndexOf(".");
    if (lastC > -1 && lastD > -1) {
      if (lastC > lastD) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lastC > -1) {
      var after = s.length - lastC - 1;
      if (after <= 2) s = s.replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, "");
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  /** VAT math: include | add | none */
  function moneyFromBase(base, vatMode, vatPctRaw) {
    var mode = vatMode || "include";
    var pct =
      mode === "none"
        ? 0
        : vatPctRaw === "" || vatPctRaw == null
          ? 21
          : Number(vatPctRaw) || 0;
    base = Number(base) || 0;
    var net, vat, total;
    if (mode === "none" || pct <= 0) {
      net = base;
      vat = 0;
      total = base;
      pct = 0;
    } else if (mode === "add") {
      net = base;
      vat = (base * pct) / 100;
      total = net + vat;
    } else {
      total = base;
      net = base / (1 + pct / 100);
      vat = total - net;
      mode = "include";
    }
    return { base: base, net: net, vat: vat, total: total, vatPct: pct, vatMode: mode };
  }

  function leadHasSplit(r) {
    return !!(
      r &&
      (r.split || r.splitCash) &&
      (num(r.invoiceNet) > 0 ||
        num(r.invoiceTotal) > 0 ||
        num(r.cashAmt) > 0 ||
        num(r.dealNet) > 0 ||
        r.split ||
        r.splitCash)
    );
  }

  function leadSource(r) {
    if (!r) return "other";
    var s = String(r.leadSource || "").toLowerCase();
    if (s === "captain" || s === "cpt" || r.captainLead === true) return "captain";
    return "other";
  }

  function isCaptainLead(r) {
    return leadSource(r) === "captain";
  }

  function constrainLeadSource(v) {
    var s = String(v || "").toLowerCase();
    return LEAD_SOURCES[s] ? s : "other";
  }

  function constrainBillType(v) {
    var s = String(v || "").toLowerCase();
    return BILL_TYPES[s] ? s : "invoice";
  }

  /* ---------- free cash black (locked: never suggested ex-VAT) ---------- */

  function leadSplitVatSwallowed(l) {
    return (
      l &&
      (l.splitVatOnTop === false ||
        l.splitVatOnTop === 0 ||
        l.splitVatOnTop === "0" ||
        l.splitVatOnTop === "false" ||
        l.splitVatOnTop === "swallow")
    );
  }

  /**
   * Formal white on PDF / card (always net + VAT when invoice has VAT).
   * Guest settles this amount on the invoice; cash is separate.
   */
  function leadWhiteClientPay(l) {
    if (!l) return 0;
    var total = num(l.invoiceTotal);
    var net = num(l.invoiceNet);
    if (!(total > 0) && net > 0) {
      total = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
    }
    if (!(total > 0) && net > 0) total = net;
    return round2(total > 0 ? total : net);
  }

  /** Deal base for split cash: quote without full VAT (e.g. 4000÷1.21 = 3305.79). */
  function leadDealBase(l) {
    if (!l) return 0;
    if (num(l.dealNet) > 0) return round2(num(l.dealNet));
    var base = num(l.base) || num(l.price) || 0;
    if (!(base > 0) && l.rate && l.days) base = num(l.rate) * num(l.days);
    if (!(base > 0)) return 0;
    return round2(moneyFromBase(base, l.vatMode || "include", l.vatPct).net);
  }

  /**
   * Suggested free cash after white invoice is paid in full (PDF total).
   *
   * Deal base B = quote ex full VAT (4000÷1.21).
   * White net W, white VAT V, formal invoice T = W+V.
   *   Swallow V: final = B;           cash = B − T
   *   Charge V:  final = B + V;       cash = B − W
   * (e.g. B=3305.79, W=1000, V=210 → charge cash 2305.79, final 3515.79)
   */
  function leadSuggestedCashAmt(l) {
    if (!l) return null;
    var B = leadDealBase(l);
    if (!(B > 0)) return null;
    var total = num(l.invoiceTotal);
    var net = num(l.invoiceNet);
    if (!(total > 0) && net > 0) {
      total = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
    }
    if (!(net > 0) && total > 0) {
      net = moneyFromBase(total, l.whiteVatMode || "include", l.vatPct).net;
    }
    if (leadSplitVatSwallowed(l)) {
      if (!(total > 0)) return null;
      return round2(Math.max(0, B - total));
    }
    if (!(net > 0)) return null;
    return round2(Math.max(0, B - net));
  }

  /** Final client price for split: B (swallow) or B + white VAT (charge). */
  function leadSplitFinalPrice(l) {
    if (!l) return 0;
    if (!leadHasSplit(l)) return round2(num(l.total) || num(l.base) || num(l.price));
    var B = leadDealBase(l);
    if (!(B > 0)) return round2(num(l.total) || 0);
    if (leadSplitVatSwallowed(l)) return B;
    var total = num(l.invoiceTotal);
    var net = num(l.invoiceNet);
    var vat = num(l.invoiceVat);
    if (!(vat > 0) && total > 0 && net > 0) vat = round2(total - net);
    if (!(vat > 0) && net > 0) {
      var built = moneyFromBase(net, l.whiteVatMode === "add" ? "add" : "include", l.vatPct);
      vat = round2(built.vat);
    }
    if (!(vat > 0) && total > 0 && !(net > 0)) {
      var fromIncl = moneyFromBase(total, l.whiteVatMode || "include", l.vatPct);
      vat = round2(fromIncl.vat);
    }
    return round2(B + Math.max(0, vat));
  }

  function cashAmtLooksSuggested(l) {
    var cash = num(l && l.cashAmt);
    if (!(cash > 0)) return false;
    var sug = leadSuggestedCashAmt(l);
    if (sug != null && sug > 0 && Math.abs(cash - sug) < 1.01) return true;
    /* €1.652,89 = white net (2000÷1.21) — classic corrupt free-cash value */
    var wNet = num(l.invoiceNet);
    if (wNet > 0 && Math.abs(cash - wNet) < 1.01) return true;
    if (num(l.invoiceTotal) > 0) {
      var wn = moneyFromBase(num(l.invoiceTotal), l.whiteVatMode || "include", l.vatPct || 21).net;
      if (wn > 0 && Math.abs(cash - wn) < 1.01) return true;
    }
    return false;
  }

  /**
   * Free cash black for ops/APA — never returns the auto ex-VAT figure (€1.652,89).
   * pin (optional device pin) wins when stored cash is missing or looks suggested.
   */
  function leadFreeCashAmt(l, pin) {
    pin = round2(num(pin));
    var cash = round2(num(l && l.cashAmt));
    if (pin > 0 && !cashAmtLooksSuggested(Object.assign({}, l || {}, { cashAmt: pin }))) {
      if (!(cash > 0) || cashAmtLooksSuggested(l) || Math.abs(cash - pin) > 0.02) return pin;
    }
    if (cashAmtLooksSuggested(l)) return 0;
    return cash > 0 ? cash : 0;
  }

  /** Mutate lead: replace suggested cash with pin or clear corrupt value. */
  function sanitizeLeadCash(l, pin) {
    if (!l || !leadHasSplit(l)) return false;
    var free = leadFreeCashAmt(l, pin);
    var cur = round2(num(l.cashAmt));
    if (Math.abs(cur - free) < 0.02 && !(cashAmtLooksSuggested(l) && free <= 0)) {
      if (free > 0) l.cashAmtUser = true;
      return false;
    }
    if (free > 0) {
      l.cashAmt = free;
      l.cashAmtUser = true;
    } else if (cashAmtLooksSuggested(l)) {
      /* Drop corrupt €1.652,89 so APA/notices do not use it */
      l.cashAmt = 0;
      l.cashAmtUser = false;
    } else {
      return false;
    }
    l.total = leadSplitFinalPrice(l);
    return true;
  }

  /**
   * Client total for split = formal white (PDF) + free cash when cash is set;
   * else theoretical final (B or B+V). Prefer stored cash + invoice total when present.
   */
  function leadClientTotal(l) {
    if (!l) return 0;
    if (!leadHasSplit(l)) return round2(num(l.total) || num(l.base) || num(l.price));
    var cash = round2(num(l.cashAmt));
    if (cash > 0 && !l.cashAmtUser) {
      var wNet = num(l.invoiceNet);
      if (wNet > 0 && Math.abs(cash - wNet) < 1.01) cash = 0;
      else if (num(l.invoiceTotal) > 0) {
        var wn = moneyFromBase(num(l.invoiceTotal), l.whiteVatMode || "include", l.vatPct || 21).net;
        if (wn > 0 && Math.abs(cash - wn) < 1.01) cash = 0;
      }
    }
    var whitePay = leadWhiteClientPay(l);
    if (cash > 0 && whitePay > 0) return round2(whitePay + cash);
    return leadSplitFinalPrice(l);
  }

  /* ---------- commission (locked) ---------- */

  function commissionVatPct(r) {
    var raw = r && r.vatPct;
    if (raw === "" || raw == null) return 21;
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return 21;
    return n;
  }

  function leadCommissionGrossAmount(r) {
    if (!r) return 0;
    var g = num(r.total);
    if (!(g > 0)) g = num(r.base);
    if (!(g > 0)) g = num(r.price);
    if (!(g > 0) && r.rate && r.days) g = num(r.rate) * num(r.days);
    return round2(g);
  }

  function leadCommissionWhiteBeforeVat(r) {
    if (!r) return 0;
    var pct = commissionVatPct(r);
    var whiteGross = num(r.invoiceTotal);
    var whiteNet = num(r.invoiceNet);
    var wMode = String(r.whiteVatMode || "include").toLowerCase();
    if (!(whiteGross > 0) && !(whiteNet > 0)) return 0;
    if (wMode === "none") return round2(whiteGross > 0 ? whiteGross : whiteNet);
    if (wMode === "add") {
      if (whiteNet > 0 && whiteNet < whiteGross * 0.99) return round2(whiteNet);
      if (whiteGross > 0) return round2(whiteGross);
      return round2(whiteNet);
    }
    if (whiteGross > 0) {
      if (whiteNet > 0 && whiteNet < whiteGross * 0.95) return round2(whiteNet);
      return round2(whiteGross / (1 + pct / 100));
    }
    return round2(whiteNet);
  }

  /**
   * Lead commission breakdown (numbers only — UI formats strings).
   * Split: 15% white before VAT + 15% cash black.
   * Normal VAT-include: 15% of total÷1.21.
   */
  function leadCommissionParts(r) {
    var pctRate = CAPTAIN_COMMISSION_PCT / 100;
    var empty = {
      split: false,
      whiteBeforeVat: 0,
      cashBlack: 0,
      base: 0,
      whiteComm: 0,
      cashComm: 0,
      total: 0,
      gross: 0,
    };
    if (!r) return empty;
    var pct = commissionVatPct(r);
    var mode = String(r.vatMode || "include").toLowerCase();
    var isSplit = !!(
      r.split === true ||
      r.splitCash === true ||
      r.split === "true" ||
      r.splitCash === "true" ||
      leadHasSplit(r)
    );

    if (
      isSplit &&
      (num(r.invoiceTotal) > 0 || num(r.invoiceNet) > 0 || num(r.cashAmt) > 0 || r.split || r.splitCash)
    ) {
      var whiteB = leadCommissionWhiteBeforeVat(r);
      var cashB = round2(num(r.cashAmt));
      var whiteC = round2(whiteB * pctRate);
      var cashC = round2(cashB * pctRate);
      var base = round2(whiteB + cashB);
      var total = round2(whiteC + cashC);
      var whiteG = num(r.invoiceTotal);
      if (!(whiteG > 0) && num(r.invoiceNet) > 0) whiteG = num(r.invoiceNet);
      var gross = round2(whiteG + cashB);
      return {
        split: true,
        whiteBeforeVat: whiteB,
        cashBlack: cashB,
        base: base,
        whiteComm: whiteC,
        cashComm: cashC,
        total: total,
        gross: gross,
      };
    }

    var grossN = leadCommissionGrossAmount(r);
    if (!(grossN > 0)) return empty;
    var baseN;
    if (mode === "none") {
      baseN = grossN;
    } else if (mode === "add") {
      var ex = num(r.base) || num(r.price);
      if (!(ex > 0) && r.rate && r.days) ex = num(r.rate) * num(r.days);
      if (!(ex > 0) && num(r.net) > 0 && num(r.net) < grossN * 0.99) ex = num(r.net);
      if (ex > 0 && Math.abs(ex - grossN) < 0.05) baseN = round2(grossN / (1 + pct / 100));
      else if (ex > 0) baseN = round2(ex);
      else baseN = round2(grossN / (1 + pct / 100));
    } else {
      baseN = round2(grossN / (1 + pct / 100));
    }
    var totalN = round2(baseN * pctRate);
    return {
      split: false,
      whiteBeforeVat: baseN,
      cashBlack: 0,
      base: baseN,
      whiteComm: totalN,
      cashComm: 0,
      total: totalN,
      gross: grossN,
    };
  }

  function leadCommissionBase(r) {
    return leadCommissionParts(r).base;
  }
  function leadCommissionAmt(r) {
    return leadCommissionParts(r).total;
  }

  /* ---------- charges ---------- */

  function chargePayMethod(r) {
    var m = r && r.payMethod ? String(r.payMethod) : "";
    if (m === "Cash" || m === "Card" || m === "Split") return m;
    if (r && num(r.cashPaid) > 0 && num(r.cashPaid) < num(r.amount) - 0.009) return "Split";
    if (r && /cash/i.test(String(r.notes || "")) && !/card/i.test(String(r.notes || ""))) return "Cash";
    return "Card";
  }

  function chargeBillType(r) {
    if (!r) return "invoice";
    var bt = constrainBillType(r.billType);
    if (r.billType && BILL_TYPES[String(r.billType).toLowerCase()]) return bt;
    var tot = num(r.amount),
      cashP = num(r.cashPaid),
      free = num(r.cashAmt);
    if (r.cashDeal || r.vatMode === "none") {
      if (free > 0 && tot > free + 0.02) return "mix";
      if (cashP > 0 && cashP < tot - 0.009) return "mix";
      if (chargePayMethod(r) === "Cash" || r.vatMode === "none") return "cash";
    }
    if (chargePayMethod(r) === "Cash") return "cash";
    if (chargePayMethod(r) === "Split" || (cashP > 0 && cashP < tot - 0.009)) return "mix";
    return "invoice";
  }

  function chargeCashPart(r) {
    var total = num(r.amount);
    var t = chargeBillType(r);
    if (!(total > 0) || t === "invoice") return 0;
    if (t === "cash") return total;
    var cash = num(r.cashPaid);
    if (!(cash > 0) && num(r.cashAmt) > 0) cash = Math.min(total, num(r.cashAmt));
    if (!(cash > 0)) cash = 0;
    return Math.min(total, round2(cash));
  }

  function chargeInvoicePart(r) {
    return Math.max(0, round2(num(r.amount) - chargeCashPart(r)));
  }

  function chargeNeedsInvoice(r) {
    return chargeInvoicePart(r) > 0.009;
  }

  /** Explicit checkbox only — never guess from notes. */
  function isChargeCaptainComm(c) {
    if (!c || !(num(c.amount) > 0)) return false;
    if (c.captainComm === false || c.captainComm === "false" || c.captainComm === 0) return false;
    return c.captainComm === true || c.captainComm === "true" || c.captainComm === 1;
  }

  function chargeExtHours(c) {
    if (!c) return 0;
    if (num(c.extHours) > 0) return num(c.extHours);
    var n = String(c.notes || "");
    var m =
      n.match(/(?:extra|extension|extended|overtime|\+)\s*(\d+(?:[.,]\d+)?)\s*h/i) ||
      n.match(/(\d+(?:[.,]\d+)?)\s*(?:extra\s*)?h(?:ou)?rs?/i);
    if (m) return num(m[1]);
    return 0;
  }

  /** Extra-hour € amount on a charge (same bill as APA spend when set). */
  function chargeExtAmt(c) {
    return num(c && c.extAmt) > 0 ? round2(num(c.extAmt)) : 0;
  }

  /** How the extension is settled: "invoice" (card / same bill) or "cash". */
  function chargeExtSettle(c) {
    var s = c && c.extSettle != null ? String(c.extSettle).toLowerCase() : "";
    return s === "cash" ? "cash" : "invoice";
  }

  /**
   * Build total / bill type from APA ledger base + optional extension on the same charge.
   * extSettle "invoice" → full amount on formal invoice (bank statement matches one bill).
   * extSettle "cash" → extension is cash (mix if APA base > 0).
   */
  /**
   * Slice of a paid APA charge that restores the pot (shortfall only).
   * Extra charter hours (extAmt) are never pot money — counting them
   * made settled APAs show a fake positive “remaining”.
   */
  function chargeApaBaseTowardPot(c) {
    if (!c) return 0;
    var ext = chargeExtAmt(c);
    if (c.apaBaseAmt != null && c.apaBaseAmt !== "") {
      var b = round2(num(c.apaBaseAmt));
      if (b >= 0) return b;
    }
    return Math.max(0, round2(num(c.amount) - ext));
  }

  function chargeTotalsFromApaAndExt(apaBase, extAmt, extSettle) {
    apaBase = Math.max(0, round2(num(apaBase)));
    extAmt = Math.max(0, round2(num(extAmt)));
    var settle = String(extSettle || "invoice").toLowerCase() === "cash" ? "cash" : "invoice";
    var amount = round2(apaBase + extAmt);
    var billType = "invoice";
    var cashPaid = 0;
    if (extAmt > 0 && settle === "cash") {
      if (apaBase > 0.009) {
        billType = "mix";
        cashPaid = extAmt;
      } else {
        billType = "cash";
        cashPaid = extAmt;
      }
    }
    var invPart = billType === "cash" ? 0 : round2(amount - cashPaid);
    var vatPct = billType === "cash" ? 0 : 21;
    var vatMode = billType === "cash" ? "none" : "include";
    var net = 0,
      vat = 0;
    if (billType === "cash") {
      net = amount;
      vat = 0;
    } else if (billType === "mix") {
      var invNet = invPart > 0 ? invPart / 1.21 : 0;
      var invVat = invPart - invNet;
      net = round2(cashPaid + invNet);
      vat = round2(invVat);
    } else {
      net = amount > 0 ? round2(amount / 1.21) : 0;
      vat = round2(amount - net);
    }
    return {
      apaBase: apaBase,
      extAmt: extAmt,
      extSettle: settle,
      amount: amount,
      billType: billType,
      cashPaid: cashPaid,
      net: net,
      vat: vat,
      vatPct: vatPct,
      vatMode: vatMode,
    };
  }

  /**
   * Extra charter hours:
   *   Prefer same charge as APA (extAmt + extSettle) so one invoice matches the card payment.
   *   Commission only on the extension slice when extAmt is set (not on APA spend).
   *   Cash ext → 15% of full ext €; invoice ext → 15% before VAT.
   */
  function chargeCommissionParts(c) {
    var empty = { base: 0, total: 0, gross: 0, hours: 0, billType: "invoice", mode: "" };
    if (!c || !isChargeCaptainComm(c)) return empty;
    var pctRate = CAPTAIN_COMMISSION_PCT / 100;
    var hours = chargeExtHours(c);
    var extA = chargeExtAmt(c);
    var base = 0;
    var mode = "";
    var gross = 0;
    var bt = chargeBillType(c);

    /* Same-bill extension: commission only on extAmt (APA pot spend is not commissionable). */
    if (extA > 0) {
      gross = extA;
      if (chargeExtSettle(c) === "cash") {
        base = gross;
        mode = "cash";
      } else {
        base = round2(gross / (1 + commissionVatPct(c) / 100));
        mode = "invoice";
      }
      return {
        base: base,
        total: round2(base * pctRate),
        gross: gross,
        hours: hours,
        billType: bt,
        mode: mode,
      };
    }

    gross = num(c.amount);
    if (!(gross > 0)) return empty;
    if (bt === "cash" || c.vatMode === "none") {
      base = gross;
      mode = "cash";
    } else if (bt === "mix") {
      var cashP = chargeCashPart(c);
      var invP = chargeInvoicePart(c);
      var invBase = invP > 0 ? invP / (1 + commissionVatPct(c) / 100) : 0;
      base = round2(invBase + cashP);
      mode = "mix";
    } else {
      var vp = commissionVatPct(c);
      if (c.vatMode === "add" && num(c.net) > 0 && num(c.net) < gross * 0.99) {
        base = round2(num(c.net));
      } else {
        base = round2(gross / (1 + vp / 100));
      }
      mode = "invoice";
    }
    return {
      base: base,
      total: round2(base * pctRate),
      gross: gross,
      hours: hours,
      billType: bt,
      mode: mode,
    };
  }

  function chargeCommissionAmt(c) {
    return chargeCommissionParts(c).total;
  }

  /* ---------- Expenses / petty envelope (structured fields only) ---------- */

  var EXP_REIMBURSE_CATS = {
    "Captain reimbursement": 1,
    "Crew reimbursement": 1,
    Reimbursement: 1,
  };
  var EXP_POCKET_CAPTAIN = "captain";

  /**
   * Reimbursement = boat (or captain) repays someone for a pocket spend.
   * Source of truth (any one is enough):
   *   - category in EXP_REIMBURSE_CATS
   *   - reimburseCaptain / reimburseCrew flags
   *   - reimbursesExpenseId link to the original own-money spend
   * Description text is NEVER used.
   */
  function isExpenseReimbursement(e) {
    if (!e) return false;
    if (e.reimburseCaptain === true || e.reimburseCrew === true) return true;
    if (e.reimbursesExpenseId != null && String(e.reimbursesExpenseId) !== "") return true;
    var c = String(e.category || "");
    return !!EXP_REIMBURSE_CATS[c];
  }

  /** Paid-from envelope: petty | own | card (card is payMethod). */
  function expensePaidFrom(e) {
    if (!e) return "petty";
    if (String(e.payMethod || "") === "Credit Card") return "card";
    var p = String(e.paidFrom || "").trim();
    if (p === "Own money" || /^own money\b/i.test(p)) return "own";
    if (p === "Petty cash" || /^petty\b/i.test(p)) return "petty";
    /* Blank / unknown on a reimbursement defaults to petty (boat cash left envelope) */
    if (isExpenseReimbursement(e)) return "petty";
    /* Blank on normal cash expense = petty (legacy) */
    if (!p) return "petty";
    if (/\bown money\b/i.test(p) || /^(my|captain)/i.test(p)) return "own";
    return "petty";
  }

  /**
   * Does this row remove physical cash from the boat envelope?
   *  - Credit card: never
   *  - Own money: never
   *  - Reimbursement from petty: yes
   *  - Reimbursement from own money: no (captain paid person; boat owes captain)
   *  - Normal cash + petty: yes
   *  - Crew day-pay: only when floatPay === true (caller may pass crew flag)
   */
  function expenseHitsPettyCash(e, opts) {
    opts = opts || {};
    if (!e) return false;
    if (opts.isCrewDayPay) {
      if (e.crewPayStatus !== "Paid") return false;
      if (expensePaidFrom(e) === "own" || expensePaidFrom(e) === "card") return false;
      return e.floatPay === true;
    }
    if (expensePaidFrom(e) === "card") return false;
    if (isExpenseReimbursement(e)) return expensePaidFrom(e) === "petty";
    if (expensePaidFrom(e) === "own") return false;
    return true;
  }

  /** Normalize reimbursement row to explicit structured fields (idempotent). */
  function normalizeExpenseReimbursement(e) {
    if (!e || !isExpenseReimbursement(e)) return { changed: false, expense: e };
    var dirty = false;
    var out = e;
    function set(k, v) {
      if (out[k] !== v) {
        out[k] = v;
        dirty = true;
      }
    }
    if (String(out.payMethod || "") === "Credit Card") set("payMethod", "Cash");
    var pf = expensePaidFrom(out);
    if (pf === "own") {
      set("paidFrom", "Own money");
      if (!out.paidById) set("paidById", EXP_POCKET_CAPTAIN);
    } else {
      set("paidFrom", "Petty cash");
      set("paidById", "");
    }
    var to =
      out.reimburseToId != null && String(out.reimburseToId) !== ""
        ? String(out.reimburseToId)
        : out.reimburseCaptain
          ? EXP_POCKET_CAPTAIN
          : EXP_POCKET_CAPTAIN;
    set("reimburseToId", to);
    if (to === EXP_POCKET_CAPTAIN) {
      set("category", "Captain reimbursement");
      set("reimburseCaptain", true);
      set("reimburseCrew", false);
    } else {
      if (!EXP_REIMBURSE_CATS[String(out.category || "")]) set("category", "Crew reimbursement");
      set("reimburseCaptain", false);
      set("reimburseCrew", true);
    }
    set("chargeTo", "boat");
    return { changed: dirty, expense: out };
  }

  /**
   * Classify one expense for envelope + pocket books.
   * Returns a plain DTO — UI must not invent parallel rules.
   */
  function classifyExpenseCash(e, opts) {
    opts = opts || {};
    var a = round2(num(e && e.amount));
    var reimb = isExpenseReimbursement(e);
    var pf = expensePaidFrom(e);
    var hitsPetty = expenseHitsPettyCash(e, opts);
    return {
      amount: a,
      isReimbursement: reimb,
      paidFrom: pf, /* petty | own | card */
      hitsPettyCash: hitsPetty,
      hitsOwnMoneyPocket: !reimb && pf === "own",
      /* Reimburse recipient always gets pocket credit when row is a reimbursement */
      clearsPocketFor:
        reimb && e
          ? e.reimburseToId != null && String(e.reimburseToId) !== ""
            ? String(e.reimburseToId)
            : EXP_POCKET_CAPTAIN
          : "",
      /* Who funded an own-money reimbursement (boat now owes them) */
      ownMoneyPayerId:
        reimb && pf === "own"
          ? e.paidById != null && String(e.paidById) !== ""
            ? String(e.paidById)
            : EXP_POCKET_CAPTAIN
          : !reimb && pf === "own"
            ? e.paidById != null && String(e.paidById) !== ""
              ? String(e.paidById)
              : EXP_POCKET_CAPTAIN
            : "",
    };
  }

  var api = {
    CAPTAIN_COMMISSION_PCT: CAPTAIN_COMMISSION_PCT,
    BILL_TYPES: Object.keys(BILL_TYPES),
    LEAD_SOURCES: Object.keys(LEAD_SOURCES),
    EXP_REIMBURSE_CATS: Object.keys(EXP_REIMBURSE_CATS),
    EXP_POCKET_CAPTAIN: EXP_POCKET_CAPTAIN,
    num: num,
    round2: round2,
    moneyFromBase: moneyFromBase,
    leadHasSplit: leadHasSplit,
    leadSource: leadSource,
    isCaptainLead: isCaptainLead,
    constrainLeadSource: constrainLeadSource,
    constrainBillType: constrainBillType,
    leadSplitVatSwallowed: leadSplitVatSwallowed,
    leadWhiteClientPay: leadWhiteClientPay,
    leadDealBase: leadDealBase,
    leadSuggestedCashAmt: leadSuggestedCashAmt,
    leadSplitFinalPrice: leadSplitFinalPrice,
    cashAmtLooksSuggested: cashAmtLooksSuggested,
    leadFreeCashAmt: leadFreeCashAmt,
    sanitizeLeadCash: sanitizeLeadCash,
    leadClientTotal: leadClientTotal,
    commissionVatPct: commissionVatPct,
    leadCommissionWhiteBeforeVat: leadCommissionWhiteBeforeVat,
    leadCommissionParts: leadCommissionParts,
    leadCommissionBase: leadCommissionBase,
    leadCommissionAmt: leadCommissionAmt,
    chargePayMethod: chargePayMethod,
    chargeBillType: chargeBillType,
    chargeCashPart: chargeCashPart,
    chargeInvoicePart: chargeInvoicePart,
    chargeNeedsInvoice: chargeNeedsInvoice,
    isChargeCaptainComm: isChargeCaptainComm,
    chargeExtHours: chargeExtHours,
    chargeExtAmt: chargeExtAmt,
    chargeExtSettle: chargeExtSettle,
    chargeApaBaseTowardPot: chargeApaBaseTowardPot,
    chargeTotalsFromApaAndExt: chargeTotalsFromApaAndExt,
    chargeCommissionParts: chargeCommissionParts,
    chargeCommissionAmt: chargeCommissionAmt,
    isExpenseReimbursement: isExpenseReimbursement,
    expensePaidFrom: expensePaidFrom,
    expenseHitsPettyCash: expenseHitsPettyCash,
    normalizeExpenseReimbursement: normalizeExpenseReimbursement,
    classifyExpenseCash: classifyExpenseCash,
  };

  root.LY_MODELS = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
