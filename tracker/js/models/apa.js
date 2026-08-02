/**
 * LY_MODELS · apa (guest pot totals)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * Diesel line costs must be precomputed by caller (controller injects diesel math).
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory(
    typeof module === "object" && module.exports ? require("./util.js") : (root.LY_MODELS_PARTS || {}).util
  );
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.apa = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;

  var APA_EXP_CATS = [
    "Drinks & Bar",
    "Dockage / Marina",
    "Crew Tips",
    "Miscellaneous",
    "Fuel / Diesel",
    "Food & Provisions",
  ];

  /**
   * Pure pot settlement math.
   *
   * @param {{
   *   apaSent?: number,
   *   topUps?: number,
   *   expenses?: Array<{amount?:number, category?:string}>,
   *   provisions?: Array<{amount?:number}>,
   *   dieselLines?: Array<{lit?:number, cost?:number}>,
   *   paidCovered?: number,
   *   cashSettled?: boolean
   * }} input
   */
  function summarizeApaTripTotals(input) {
    input = input || {};
    var expSum = 0;
    var byCat = {};
    APA_EXP_CATS.forEach(function (c) {
      byCat[c] = 0;
    });
    (Array.isArray(input.expenses) ? input.expenses : []).forEach(function (e) {
      if (!e) return;
      var a = num(e.amount);
      expSum += a;
      var cat = String(e.category || "Miscellaneous");
      if (byCat[cat] != null) byCat[cat] += a;
      else byCat["Miscellaneous"] = (byCat["Miscellaneous"] || 0) + a;
    });
    expSum = round2(expSum);
    var prov = 0;
    (Array.isArray(input.provisions) ? input.provisions : []).forEach(function (p) {
      if (p) prov += num(p.amount);
    });
    prov = round2(prov);
    var dLit = 0;
    var dCost = 0;
    (Array.isArray(input.dieselLines) ? input.dieselLines : []).forEach(function (r) {
      if (!r) return;
      dLit += num(r.lit);
      dCost += num(r.cost);
    });
    dLit = round2(dLit);
    dCost = round2(dCost);
    var fuelExp = byCat["Fuel / Diesel"] || 0;
    var cats = {
      "Drinks & Bar": byCat["Drinks & Bar"] || 0,
      "Dockage / Marina": byCat["Dockage / Marina"] || 0,
      "Crew Tips": byCat["Crew Tips"] || 0,
      "Fuel / Diesel": fuelExp,
      "Food & Provisions": byCat["Food & Provisions"] || 0,
      Miscellaneous: byCat["Miscellaneous"] || 0,
    };
    var spent = round2(expSum + prov + dCost);
    var basePot = round2(num(input.apaSent) + num(input.topUps));
    var paidCovered = round2(num(input.paidCovered));
    var cashSettled = !!input.cashSettled;
    var available = round2(basePot + paidCovered);
    var bal = round2(available - spent);
    if (cashSettled && bal < -0.009) {
      paidCovered = round2(paidCovered + -bal);
      available = round2(basePot + paidCovered);
      bal = 0;
    } else if (cashSettled && bal < 0) {
      bal = 0;
    }
    var pct = available > 0 ? spent / available : 0;
    var overage = bal < 0 ? round2(-bal) : 0;
    if (cashSettled) overage = 0;
    return {
      expSum: expSum,
      prov: prov,
      dLit: dLit,
      dCost: dCost,
      cats: cats,
      spent: spent,
      basePot: basePot,
      paidCovered: paidCovered,
      available: available,
      bal: bal,
      pct: pct,
      cashSettled: cashSettled,
      overage: overage,
    };
  }

  /** Prepaid pot present? */
  function apaHasPrepaid(t) {
    return num(t && t.apaSent) + num(t && t.topUps) > 0;
  }

  function apaDueAmount(t) {
    return round2(num(t && t.apaSent) + num(t && t.topUps));
  }

  /** Engine litres: port + starboard, legacy engineL fallback. */
  function apaEngineLitres(r) {
    if (!r) return 0;
    var port = num(r.enginePortL);
    var stbd = num(r.engineStbdL);
    if (port > 0 || stbd > 0) return port + stbd;
    return num(r.engineL);
  }

  /**
   * One APA diesel line → litres + cost.
   * Freeze ledger €: manual cost → stored amount → litres × line/trip rate.
   * Never re-prices historical lines from a later bunker.
   *
   * @param {{ genBurn?: number, dieselPrice?: number }} tripCtx
   * @param {object} row diesel log line
   */
  function apaDieselLineCalc(tripCtx, row) {
    tripCtx = tripCtx || {};
    var port = num(row && row.enginePortL);
    var stbd = num(row && row.engineStbdL);
    var eng = apaEngineLitres(row);
    var hrs = num(row && row.genHrs);
    var burn = num(tripCtx.genBurn);
    if (!(burn > 0)) burn = 6;
    var genL = hrs * burn;
    var lit = eng + genL;
    var manual = num(row && row.cost);
    var stored = num(row && row.amount);
    var price = num(row && row.price);
    if (!(price > 0)) price = num(tripCtx.dieselPrice);
    var cost = 0;
    if (manual > 0) cost = manual;
    else if (stored > 0) cost = stored;
    else if (lit > 0 && price > 0) cost = lit * price;
    cost = round2(cost);
    if (lit > 0 && cost > 0 && !(price > 0)) price = Math.round((cost / lit) * 10000) / 10000;
    else if (lit > 0 && stored > 0) price = Math.round((stored / lit) * 10000) / 10000;
    return {
      genL: round2(genL),
      lit: round2(lit),
      cost: cost,
      price: price,
      burn: burn,
      eng: eng,
      port: port,
      stbd: stbd,
    };
  }

  /**
   * Sum APA base recovered from Paid shortfall charges.
   * @param {Array} linkedCharges charge rows already filtered as linked to the trip
   * @param {{ chargeIsPaid?: function, chargeApaBaseTowardPot?: function }} helpers
   */
  function summarizeApaPaidCovered(linkedCharges, helpers) {
    helpers = helpers || {};
    var isPaid =
      typeof helpers.chargeIsPaid === "function"
        ? helpers.chargeIsPaid
        : function (c) {
            return c && (c.payStatus === "Paid" || c.status === "Paid");
          };
    var baseToward =
      typeof helpers.chargeApaBaseTowardPot === "function"
        ? helpers.chargeApaBaseTowardPot
        : function (c) {
            return Math.max(0, num(c && c.apaBaseAmt) || num(c && c.amount));
          };
    var s = 0;
    (Array.isArray(linkedCharges) ? linkedCharges : []).forEach(function (c) {
      if (!c || !isPaid(c)) return;
      s += baseToward(c);
    });
    return round2(s);
  }

  /**
   * Paid cash APA shortfall settles the pot (no residual ledger pennies as “owed”).
   */
  function isApaCashSettlementCharge(c, opts) {
    opts = opts || {};
    if (!c) return false;
    var isPaid =
      typeof opts.chargeIsPaid === "function"
        ? opts.chargeIsPaid(c)
        : c.payStatus === "Paid" || c.status === "Paid" || c.status === "Pending";
    if (!isPaid) return false;
    var isApa =
      c.kind === "apa" ||
      !!(c.apaTripId) ||
      (opts.isApaChargeRow && opts.isApaChargeRow(c));
    if (!isApa) return false;
    var bt =
      typeof opts.chargeBillType === "function"
        ? opts.chargeBillType(c)
        : String(c.billType || "").toLowerCase();
    if (bt === "cash") return true;
    if (c.moneyManual && (bt === "cash" || bt === "mix" || c.cashDeal || c.payMethod === "Cash"))
      return true;
    if (c.cashDeal && (bt === "cash" || c.payMethod === "Cash")) return true;
    return false;
  }

/**
 * Pure decision for APA shortfall charge sync (no DOM / state).
 *
 * @param {{
 *   overage: number,
 *   hasReusable: boolean,
 *   allowCreate: boolean,
 *   suppressShortfall: boolean,
 *   paidManual: boolean,
 *   force: boolean,
 *   chargeLocked: boolean
 * }} input
 * @returns {{ action: string, reason?: string }}
 *   pin | update | create | clear | skip | skip_locked
 */
function planApaShortfallSync(input) {
  input = input || {};
  var over = Number(input.overage) || 0;
  if (input.hasReusable) {
    if (!input.force || input.chargeLocked) return { action: "pin", reason: "locked_or_no_force" };
    if (over <= 0) return { action: "update_zero_base", reason: "no_overage" };
    return { action: "update", reason: "overage" };
  }
  if (over <= 0) return { action: "clear", reason: "no_overage" };
  if (input.suppressShortfall) return { action: "clear", reason: "suppress" };
  if (input.paidManual) return { action: "pin_paid_manual", reason: "cash_settled" };
  /*
   * Create first shortfall when allowCreate (Sync, new pot, or saveApa first-overspend).
   * Without allowCreate we skip — never Danny×2 from background jobs.
   */
  if (!input.allowCreate) return { action: "skip", reason: "no_create" };
  return { action: "create", reason: "overage_allowed" };
}

/**
 * Build charge money fields for APA shortfall amount (apa base toward pot).
 * Does not invent bill type beyond invoice default for shortfall.
 */
function planApaShortfallChargeFields(over, tripMeta) {
  tripMeta = tripMeta || {};
  var amt = Math.max(0, Math.round((Number(over) || 0) * 100) / 100);
  return {
    amount: amt,
    apaBaseAmt: amt,
    extAmt: 0,
    billType: "invoice",
    kind: "apa",
    apaTripId: tripMeta.tripId || "",
    apaZeroPot: !!tripMeta.zeroPot,
  };
}

  return {
    APA_EXP_CATS: APA_EXP_CATS,
    summarizeApaTripTotals: summarizeApaTripTotals,
    apaHasPrepaid: apaHasPrepaid,
    apaDueAmount: apaDueAmount,
    apaEngineLitres: apaEngineLitres,
    apaDieselLineCalc: apaDieselLineCalc,
    summarizeApaPaidCovered: summarizeApaPaidCovered,
    isApaCashSettlementCharge: isApaCashSettlementCharge,
    planApaShortfallSync: planApaShortfallSync,
    planApaShortfallChargeFields: planApaShortfallChargeFields,
  };
});
