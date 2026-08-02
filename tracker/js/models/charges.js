/**
 * LY_MODELS · charges (bill type, captain upsell commission)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory(typeof module === "object" && module.exports ? require("./util.js") : (root.LY_MODELS_PARTS || {}).util, typeof module === "object" && module.exports ? require("./leads.js") : (root.LY_MODELS_PARTS || {}).leads);
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.charges = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util, leads) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;
  var moneyFromBase = util.moneyFromBase;
  var CAPTAIN_COMMISSION_PCT = leads.CAPTAIN_COMMISSION_PCT;
  var constrainBillType = leads.constrainBillType;
  var commissionVatPct = leads.commissionVatPct;
  var BILL_TYPES = { cash: 1, invoice: 1, mix: 1 };

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
  if (t === "invoice") return 0;
  /* Cash-only: prefer cashPaid (actual received) over amount (may still hold ledger shortfall) */
  if (t === "cash") {
    var got = num(r.cashPaid);
    if (!(got > 0) && num(r.cashAmt) > 0) got = num(r.cashAmt);
    if (got > 0) return round2(got);
    return total > 0 ? total : 0;
  }
  if (!(total > 0)) return 0;
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

/**
 * Explicit checkbox only — never guess from notes.
 * Amount may be 0 when only extAmt is set (same-bill extension on APA).
 */
function isChargeCaptainComm(c) {
  if (!c) return false;
  if (
    c.captainComm === false ||
    c.captainComm === "false" ||
    c.captainComm === 0 ||
    c.captainComm === "0"
  )
    return false;
  var on =
    c.captainComm === true ||
    c.captainComm === "true" ||
    c.captainComm === 1 ||
    c.captainComm === "1" ||
    String(c.captainComm || "").toLowerCase() === "yes";
  if (!on) return false;
  /* Commissionable slice present */
  if (num(c.amount) > 0) return true;
  if (num(c.extAmt) > 0) return true;
  if (num(c.extHours) > 0) return true;
  return false;
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

/**
 * Captain commissions from Charges (upsells / extensions with captainComm).
 * Display-only aggregate — does not mutate charges.
 * @param {Array} charters
 * @returns {{ n, gross, base, comm, items }}
 */
function summarizeCaptainChargeCommissions(charters) {
  var n = 0;
  var gross = 0;
  var base = 0;
  var comm = 0;
  var items = [];
  (Array.isArray(charters) ? charters : []).forEach(function (c) {
    if (!c || !isChargeCaptainComm(c)) return;
    var p = chargeCommissionParts(c);
    if (!(p.total > 0.009) && !(p.base > 0.009)) return;
    n++;
    gross = round2(gross + (p.gross || 0));
    base = round2(base + (p.base || 0));
    comm = round2(comm + (p.total || 0));
    items.push({
      id: c.id,
      client: String(c.client || "Upsell").trim() || "Upsell",
      date: String(c.date || "").slice(0, 10),
      gross: p.gross || 0,
      base: p.base || 0,
      comm: p.total || 0,
      hours: p.hours || 0,
    });
  });
  items.sort(function (a, b) {
    var da = String(a.date || ""),
      db = String(b.date || "");
    if (da && db && da !== db) return db < da ? -1 : 1;
    return String(b.client || "").localeCompare(String(a.client || ""));
  });
  return { n: n, gross: gross, base: base, comm: comm, items: items };
}

/**
 * Payment status for cash/envelope rules.
 * Defaults Paid for legacy rows without payStatus (Pending / Invoiced / Paid status).
 */
function chargeIsPaid(r) {
  if (!r) return false;
  if (r.payStatus) return String(r.payStatus) === "Paid";
  if (r.status === "Pending") return true;
  if (r.status === "Invoiced" || r.status === "Paid") return true;
  return String(r.status || "Paid") === "Paid" || !r.status;
}

/**
 * Explicit Paid only — for boat cash ledger / cash-to-boat.
 * Never treats Pending or bare status defaults as paid (that inflated cash-in).
 */
function chargeIsExplicitlyPaid(r) {
  if (!r) return false;
  if (r.payStatus != null && String(r.payStatus) !== "") return String(r.payStatus) === "Paid";
  return String(r.status || "") === "Paid";
}

/**
 * Cash that enters the boat pot from this charge when Paid.
 * Strict: only the cash settlement slice — never full invoice/card total.
 * Requires explicit Paid (not legacy Pending default).
 *
 * @param {object} r charge row
 * @returns {number}
 */
function chargeCashToBoat(r) {
  if (!r || !chargeIsExplicitlyPaid(r)) return 0;
  var total = num(r.amount);
  var bt = chargeBillType(r);
  if (bt === "invoice") return 0;
  if (bt === "cash") {
    var got = num(r.cashPaid);
    if (!(got > 0.009)) got = num(r.cashAmt);
    if (got > 0.009) return round2(got);
    return total > 0 ? total : 0;
  }
  if (bt === "mix") {
    if (!(total > 0)) total = num(r.cashPaid) || num(r.cashAmt) || 0;
    var part = chargeCashPart(r);
    if (part > 0) return round2(Math.min(part, total > 0 ? total : part));
    var explicit = num(r.cashPaid);
    return explicit > 0 ? round2(Math.min(explicit, total > 0 ? total : explicit)) : 0;
  }
  var part2 = chargeCashPart(r);
  if (part2 > 0) return round2(Math.min(part2, total > 0 ? total : part2));
  var m = chargePayMethod(r);
  var explicit2 = num(r.cashPaid);
  if (m === "Card") return 0;
  if (m === "Split") return explicit2 > 0 ? round2(Math.min(explicit2, total > 0 ? total : explicit2)) : 0;
  if (m === "Cash")
    return explicit2 > 0 ? round2(Math.min(explicit2, total > 0 ? total : explicit2)) : total > 0 ? total : 0;
  return 0;
}

/**
 * VAT breakdown for display / invoice lines.
 * VAT applies only to the invoice portion.
 *
 * @param {object} r
 * @returns {{ net, vat, pct, gross, inv, cash }}
 */
function chargeVatParts(r) {
  var inv = chargeInvoicePart(r);
  var cash = chargeCashPart(r);
  var gross = num(r.amount);
  var pct = r && r.vatPct != null && r.vatPct !== "" ? Number(r.vatPct) : 21;
  var bt = chargeBillType(r);
  if (bt === "cash" || (r && r.vatMode === "none")) {
    return { net: gross, vat: 0, pct: 0, gross: gross, inv: inv, cash: cash };
  }
  if (r && r.vat != null && r.net != null && inv <= 0.009) {
    return {
      net: Number(r.net) || 0,
      vat: Number(r.vat) || 0,
      pct: pct,
      gross: gross,
      inv: inv,
      cash: cash,
    };
  }
  var splitFn = util.invoiceSplitGross;
  if (inv > 0.009 && typeof splitFn === "function") {
    var sp = splitFn(inv, pct);
    return {
      net: round2(cash + sp.net),
      vat: sp.vat,
      pct: sp.pct,
      gross: gross,
      inv: inv,
      cash: cash,
    };
  }
  if (inv > 0.009) {
    var netInv = pct > 0 ? inv / (1 + pct / 100) : inv;
    return {
      net: round2(cash + netInv),
      vat: inv - netInv,
      pct: pct,
      gross: gross,
      inv: inv,
      cash: cash,
    };
  }
  var net = pct > 0 ? gross / (1 + pct / 100) : gross;
  return { net: net, vat: gross - net, pct: pct, gross: gross, inv: inv, cash: cash };
}

/** Extra-hours / upsell gross for income rollups. */
function chargeUpsellGross(c) {
  if (!c) return 0;
  var ext = chargeExtAmt(c);
  if (ext > 0) return ext;
  var kind = String(c.kind || c.chargeKind || "").toLowerCase();
  if (kind === "extension" || kind === "extra" || kind === "upsell") return Math.max(0, num(c.amount));
  return 0;
}

/**
 * Sum cash-to-boat for Paid charges (petty cash-in auto lines).
 * @param {Array} charters
 * @returns {{ total, n, items }}
 */
function summarizeChargeCashToBoat(charters) {
  var total = 0;
  var items = [];
  (Array.isArray(charters) ? charters : []).forEach(function (c) {
    if (!c) return;
    var a = chargeCashToBoat(c);
    if (!(a > 0.009)) return;
    total = round2(total + a);
    items.push({ id: c.id, amount: a, date: String(c.date || "").slice(0, 10), client: c.client || "" });
  });
  return { total: total, n: items.length, items: items };
}


  return {
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
    summarizeCaptainChargeCommissions: summarizeCaptainChargeCommissions,
    chargeIsPaid: chargeIsPaid,
    chargeIsExplicitlyPaid: chargeIsExplicitlyPaid,
    chargeCashToBoat: chargeCashToBoat,
    chargeVatParts: chargeVatParts,
    chargeUpsellGross: chargeUpsellGross,
    summarizeChargeCashToBoat: summarizeChargeCashToBoat
  };
});
