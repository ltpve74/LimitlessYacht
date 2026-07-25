/**
 * LY_MODELS — Limitless Tracker domain models (pure, no DOM).
 *
 * Single source of truth for money rules we have already locked:
 *   - free cash black (never auto “ex VAT” suggested)
 *   - captain commission (VAT strip; split = white ex VAT + cash)
 *   - charge bill type (cash / invoice / mix)
 *   - charge captain commission (explicit flag only)
 *
 * Browser: loaded before the main tracker script → window.LY_MODELS
 * Tests:   node scripts/test-tracker-models.mjs
 *
 * When changing a locked rule: update HERE, update tests, then thin wrappers
 * in tracker/index.html — do not re-implement the same math in the UI.
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

  function leadSuggestedCashAmt(l) {
    if (!l) return null;
    var base = num(l.base) || num(l.price) || 0;
    if (!(base > 0) && l.rate && l.days) base = num(l.rate) * num(l.days);
    if (!(base > 0)) return null;
    var ref = moneyFromBase(base, l.vatMode || "include", l.vatPct);
    var wNet = num(l.invoiceNet);
    if (!(wNet > 0) && num(l.invoiceTotal) > 0) {
      wNet = moneyFromBase(num(l.invoiceTotal), l.whiteVatMode || "include", l.vatPct).net;
    }
    if (!(wNet > 0) && !(ref.net > 0)) return null;
    return round2(Math.max(0, ref.net - wNet));
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
    var white = num(l.invoiceTotal);
    if (!(white > 0) && num(l.invoiceNet) > 0) {
      white = moneyFromBase(num(l.invoiceNet), l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
    }
    l.total = round2(white + num(l.cashAmt));
    return true;
  }

  /** Client total for split = white invoice total + free cash (never dealNet). */
  function leadClientTotal(l) {
    if (!l) return 0;
    if (!leadHasSplit(l)) return round2(num(l.total) || num(l.base) || num(l.price));
    var white = num(l.invoiceTotal);
    if (!(white > 0) && num(l.invoiceNet) > 0) {
      white = moneyFromBase(num(l.invoiceNet), l.whiteVatMode === "add" ? "add" : "include", l.vatPct).total;
    }
    var cash = leadFreeCashAmt(l);
    return round2(white + cash);
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

  /**
   * Extra charter hours / same-day extensions:
   *   Belong on Charges (not the lead, not APA).
   *   Tick captainComm → 15% commission on this charge only:
   *     - Cash settlement: 15% of full amount (no VAT strip)
   *     - Invoice: 15% of amount before VAT (÷1.21 if VAT included)
   *     - Mix: cash full + invoice part before VAT
   * Example: +1h for €500 cash → base 500, commission €75.
   *          +1h for €500 invoice (VAT incl.) → base 500/1.21, commission ≈ €61.98.
   */
  function chargeCommissionParts(c) {
    var empty = { base: 0, total: 0, gross: 0, hours: 0, billType: "invoice", mode: "" };
    if (!c || !isChargeCaptainComm(c)) return empty;
    var pctRate = CAPTAIN_COMMISSION_PCT / 100;
    var gross = num(c.amount);
    if (!(gross > 0)) return empty;
    var hours = chargeExtHours(c);
    var bt = chargeBillType(c);
    var base = 0;
    var mode = "";
    if (bt === "cash" || c.vatMode === "none") {
      base = gross;
      mode = "cash"; /* full amount — no VAT */
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
      mode = "invoice"; /* before VAT */
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

  var api = {
    CAPTAIN_COMMISSION_PCT: CAPTAIN_COMMISSION_PCT,
    BILL_TYPES: Object.keys(BILL_TYPES),
    LEAD_SOURCES: Object.keys(LEAD_SOURCES),
    num: num,
    round2: round2,
    moneyFromBase: moneyFromBase,
    leadHasSplit: leadHasSplit,
    leadSource: leadSource,
    isCaptainLead: isCaptainLead,
    constrainLeadSource: constrainLeadSource,
    constrainBillType: constrainBillType,
    leadSuggestedCashAmt: leadSuggestedCashAmt,
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
    chargeCommissionParts: chargeCommissionParts,
    chargeCommissionAmt: chargeCommissionAmt,
  };

  root.LY_MODELS = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
