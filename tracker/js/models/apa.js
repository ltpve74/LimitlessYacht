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
    var cats = {
      "Drinks & Bar": byCat["Drinks & Bar"] || 0,
      "Dockage / Marina": byCat["Dockage / Marina"] || 0,
      "Crew Tips": byCat["Crew Tips"] || 0,
      Miscellaneous:
        (byCat["Miscellaneous"] || 0) + (byCat["Fuel / Diesel"] || 0) + (byCat["Food & Provisions"] || 0),
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

  return {
    APA_EXP_CATS: APA_EXP_CATS,
    summarizeApaTripTotals: summarizeApaTripTotals,
    apaHasPrepaid: apaHasPrepaid,
    apaDueAmount: apaDueAmount,
  };
});
