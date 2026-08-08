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
   * Reconstruct-only guest €/L when trip/line rate is missing.
   * Same figure as diesel.DIESEL_LEGACY_FALLBACK_SELL — fuel must never be free.
   */
  var APA_DIESEL_FALLBACK_PRICE = 1.75;

  /**
   * One APA diesel line → litres + cost.
   * Freeze ledger €: manual cost → stored amount → litres × line/trip rate.
   * Never re-prices historical lines that already store amount/cost.
   * If litres exist but rate is missing/0, use fallbackPrice (or 1.75) so
   * pot spend and shortfall charges still move money.
   *
   * @param {{ genBurn?: number, dieselPrice?: number, fallbackPrice?: number }} tripCtx
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
    /* Line unitPrice first, then row.price alias, then trip rate */
    var price = num(row && row.unitPrice);
    if (!(price > 0)) price = num(row && row.price);
    if (!(price > 0)) price = num(tripCtx.dieselPrice);
    var fallback = num(tripCtx.fallbackPrice);
    if (!(fallback > 0)) fallback = APA_DIESEL_FALLBACK_PRICE;
    var usedFallback = false;
    if (!(price > 0) && lit > 0 && !(manual > 0) && !(stored > 0)) {
      price = fallback;
      usedFallback = true;
    }
    var cost = 0;
    if (manual > 0) cost = manual;
    else if (stored > 0) cost = stored;
    else if (lit > 0 && price > 0) cost = lit * price;
    cost = round2(cost);
    if (lit > 0 && cost > 0 && !(price > 0)) price = Math.round((cost / lit) * 10000) / 10000;
    else if (lit > 0 && stored > 0 && !(num(row && row.unitPrice) > 0))
      price = Math.round((stored / lit) * 10000) / 10000;
    return {
      genL: round2(genL),
      lit: round2(lit),
      cost: cost,
      price: price,
      burn: burn,
      eng: eng,
      port: port,
      stbd: stbd,
      usedFallback: usedFallback,
    };
  }

  /**
   * Pure plan: freeze diesel consumption onto a durable ledger line.
   * Ensures amount + unitPrice are set so pot totals always include fuel €.
   *
   * @param {{
   *   tripCtx?: { genBurn?: number, dieselPrice?: number, fallbackPrice?: number },
   *   row?: object,
   *   id?: string,
   *   date?: string,
   *   notes?: string
   * }} input
   * @returns {{
   *   ok: boolean,
   *   reason?: string,
   *   line?: object,
   *   calc?: object,
   *   pinTripPrice?: number
   * }}
   */
  function planApaDieselConsumptionLine(input) {
    input = input || {};
    var row = Object.assign({}, input.row || {});
    var tripCtx = input.tripCtx || {};
    var calc = apaDieselLineCalc(tripCtx, row);
    if (!(calc.lit > 0.0009) && !(calc.cost > 0.009)) {
      return { ok: false, reason: "empty", calc: calc };
    }
    if (!(calc.cost > 0.009) && calc.lit > 0.0009) {
      /* Should not happen after fallback — refuse free fuel */
      return { ok: false, reason: "no_price", calc: calc };
    }
    var line = {
      id: input.id != null ? String(input.id) : row.id != null ? String(row.id) : "",
      date: String(input.date || row.date || "").slice(0, 10),
      enginePortL: calc.port > 0 ? calc.port : row.enginePortL != null && row.enginePortL !== "" ? row.enginePortL : "",
      engineStbdL: calc.stbd > 0 ? calc.stbd : row.engineStbdL != null && row.engineStbdL !== "" ? row.engineStbdL : "",
      engineL: calc.eng > 0 ? calc.eng : "",
      genHrs: calc.genL > 0 || num(row.genHrs) > 0 ? num(row.genHrs) || round2(calc.genL / (calc.burn || 6)) : "",
      cost: num(row.cost) > 0 ? round2(num(row.cost)) : "",
      amount: calc.cost,
      unitPrice: calc.price,
      notes: input.notes != null ? String(input.notes) : row.notes != null ? String(row.notes) : "",
    };
    if (!(num(line.genHrs) > 0)) line.genHrs = "";
    var pinTripPrice = 0;
    if (!(num(tripCtx.dieselPrice) > 0) && calc.price > 0) pinTripPrice = calc.price;
    return {
      ok: true,
      line: line,
      calc: calc,
      pinTripPrice: pinTripPrice,
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
   * Requires explicit payStatus/status Paid — never treat Pending as paid.
   *
   * Cash received may differ from ledger (loose change, e.g. €650 for €664.95) —
   * that still fully settles the pot. Do not re-open shortfall for the difference.
   *
   * Shortfall rows start as billType "invoice"; Paid + Cash still counts as cash settlement.
   */
  function isApaCashSettlementCharge(c, opts) {
    opts = opts || {};
    if (!c) return false;
    var isPaid;
    if (typeof opts.chargeIsPaid === "function") {
      isPaid = !!opts.chargeIsPaid(c);
    } else if (c.payStatus != null && String(c.payStatus) !== "") {
      isPaid = String(c.payStatus) === "Paid";
    } else {
      isPaid = String(c.status || "") === "Paid";
    }
    if (!isPaid) return false;
    var isApa =
      c.kind === "apa" ||
      !!(c.apaTripId) ||
      (opts.isApaChargeRow && opts.isApaChargeRow(c));
    if (!isApa) return false;
    var bt =
      typeof opts.chargeBillType === "function"
        ? String(opts.chargeBillType(c) || "").toLowerCase()
        : String(c.billType || "").toLowerCase();
    var payM =
      typeof opts.chargePayMethod === "function"
        ? String(opts.chargePayMethod(c) || "")
        : String(c.payMethod || "");
    if (bt === "cash") return true;
    if (payM === "Cash") return true;
    if (c.cashDeal) return true;
    if (c.moneyManual && (bt === "mix" || bt === "cash" || payM === "Cash" || num(c.cashPaid) > 0))
      return true;
    if (bt === "mix" && num(c.cashPaid) > 0) return true;
    return false;
  }

  function chargeCashAmt(c) {
    var a = num(c && c.cashPaid);
    if (a > 0) return a;
    return num(c && c.amount);
  }

  /**
   * Pure charge pick for an APA pot (display or reusable pin).
   * Priority: paid cash settlement → unpaid shortfall → other paid → orphan unpaid
   * (orphans only when pot is not empty shell).
   *
   * Charges must be pre-flagged by the controller/view adapter:
   *   { id, apaTripId, clientKey, isPaid, isCashSettlement, isApa, amount, cashPaid,
   *     moneyManual, hasInv, locked }
   *
   * @returns {{ chargeId: string|null, reason: string }}
   */
  function pickApaCharge(input) {
    input = input || {};
    var tripId = String(input.tripId || "");
    var pinId = input.chargeId != null ? String(input.chargeId) : "";
    var guestKey = String(input.guestKey || "");
    var live = input.liveTripIds || {};
    var potEmpty = !!input.potEmpty;
    var purpose = input.purpose === "display" ? "display" : "reusable";
    var rows = Array.isArray(input.charges) ? input.charges.filter(Boolean) : [];

    function score(c) {
      var s = 0;
      if (c.isCashSettlement) s += 50000;
      if (c.isPaid) s += 10000;
      if (c.locked || c.moneyManual) s += 3000;
      if (c.hasInv) s += 20;
      s += chargeCashAmt(c) * 10;
      if (pinId && String(c.id) === pinId) s += 500;
      if (tripId && String(c.apaTripId || "") === tripId) s += 100;
      return s;
    }

    function byId(id) {
      if (!id) return null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i].id) === String(id)) return rows[i];
      }
      return null;
    }

    /* 1) Cash settlement for this pot (linked / pin / guest not owned by other live pot) */
    var cash = rows
      .filter(function (c) {
        if (!c || !c.isCashSettlement || !c.isApa) return false;
        if (pinId && String(c.id) === pinId) return true;
        if (tripId && String(c.apaTripId || "") === tripId) return true;
        if (!guestKey || String(c.clientKey || "") !== guestKey) return false;
        var tid = String(c.apaTripId || "");
        if (tid && tid !== tripId && live[tid]) return false;
        return true;
      })
      .sort(function (a, b) {
        return score(b) - score(a);
      });
    if (cash.length) return { chargeId: String(cash[0].id), reason: "cash_settlement" };

    /* 2) Linked unpaid shortfall */
    var unpaid = rows
      .filter(function (c) {
        if (!c || !c.isApa || c.isPaid) return false;
        if (pinId && String(c.id) === pinId) return true;
        return tripId && String(c.apaTripId || "") === tripId;
      })
      .sort(function (a, b) {
        return score(b) - score(a);
      });
    if (unpaid.length) return { chargeId: String(unpaid[0].id), reason: "linked_unpaid" };

    /* 3) Explicit pin (any status) */
    var pinned = byId(pinId);
    if (pinned && pinned.isApa) return { chargeId: String(pinned.id), reason: "charge_pin" };

    /* 4) Any linked paid / unpaid by trip id */
    var linked = rows
      .filter(function (c) {
        return c && c.isApa && tripId && String(c.apaTripId || "") === tripId;
      })
      .sort(function (a, b) {
        return score(b) - score(a);
      });
    if (linked.length) return { chargeId: String(linked[0].id), reason: "linked_trip" };

    /* 5) Display may stop here; reusable may adopt one unpaid orphan */
    if (purpose === "display") return { chargeId: null, reason: "none" };
    if (potEmpty) return { chargeId: null, reason: "empty_shell_no_orphan" };

    var orphans = rows
      .filter(function (c) {
        if (!c || !c.isApa || c.isPaid) return false;
        if (guestKey && String(c.clientKey || "") !== guestKey) return false;
        var tid = String(c.apaTripId || "");
        if (!tid) return true;
        if (tid === tripId) return true;
        if (!live[tid]) return true;
        return false;
      })
      .sort(function (a, b) {
        return score(b) - score(a);
      });
    if (orphans.length) return { chargeId: String(orphans[0].id), reason: "orphan_unpaid" };
    return { chargeId: null, reason: "none" };
  }

  /**
   * Write plan: collapse guest APA charges when saving pot t.
   * If a paid cash settlement exists → pin it, drop unpaid ghosts for that guest.
   * Else collapse unpaid orphans to one winner.
   *
   * @returns {{
   *   tripPatch: object,
   *   chargePatches: Array<{id:string, apaTripId?:string, kind?:string}>,
   *   dropChargeIds: string[]
   * }}
   */
  function planApaGuestChargeCollapse(input) {
    input = input || {};
    var tripId = String(input.tripId || "");
    var guestKey = String(input.guestKey || "");
    var liveOther = input.otherLiveTripIds || {};
    var rows = Array.isArray(input.charges) ? input.charges.filter(Boolean) : [];
    var plan = { tripPatch: {}, chargePatches: [], dropChargeIds: [] };
    if (!tripId || !guestKey) return plan;

    var cashPick = pickApaCharge({
      tripId: tripId,
      chargeId: input.chargeId,
      guestKey: guestKey,
      liveTripIds: Object.assign({}, liveOther, (function () {
        var o = {};
        o[tripId] = 1;
        return o;
      })()),
      potEmpty: false,
      purpose: "display",
      charges: rows,
    });
    var cash =
      cashPick.chargeId &&
      rows.filter(function (c) {
        return c && String(c.id) === String(cashPick.chargeId) && c.isCashSettlement;
      })[0];

    if (cash) {
      plan.tripPatch = {
        chargeId: String(cash.id),
        apaCashSettled: true,
        apaCashSettledAmt: round2(chargeCashAmt(cash)),
        suppressShortfallCharge: true,
      };
      plan.chargePatches.push({ id: String(cash.id), apaTripId: tripId, kind: "apa" });
      rows.forEach(function (c) {
        if (!c || !c.isApa) return;
        if (String(c.id) === String(cash.id)) return;
        if (String(c.clientKey || "") !== guestKey) return;
        if (c.isPaid) return;
        var tid = String(c.apaTripId || "");
        if (tid && liveOther[tid]) return;
        plan.dropChargeIds.push(String(c.id));
      });
      return plan;
    }

    var unpaid = rows
      .filter(function (c) {
        if (!c || !c.isApa || c.isPaid) return false;
        if (String(c.clientKey || "") !== guestKey) return false;
        var tid = String(c.apaTripId || "");
        if (tid === tripId) return true;
        if (!tid) return true;
        if (liveOther[tid]) return false;
        return true;
      })
      .sort(function (a, b) {
        var sa =
          (a.moneyManual ? 3000 : 0) +
          num(a.amount) * 10 +
          (String(a.apaTripId) === tripId ? 100 : 0) +
          (a.hasInv ? 20 : 0);
        var sb =
          (b.moneyManual ? 3000 : 0) +
          num(b.amount) * 10 +
          (String(b.apaTripId) === tripId ? 100 : 0) +
          (b.hasInv ? 20 : 0);
        return sb - sa;
      });
    if (!unpaid.length) return plan;
    var win = unpaid[0];
    plan.tripPatch = { chargeId: String(win.id) };
    plan.chargePatches.push({ id: String(win.id), apaTripId: tripId, kind: "apa" });
    unpaid.slice(1).forEach(function (c) {
      plan.dropChargeIds.push(String(c.id));
    });
    return plan;
  }

  /**
   * Write plan: delete APA pot (hard).
   * Drops pot-owned monthly mirrors; unlinks user-tagged monthly; drops linked
   * shortfall charges + unpaid guest orphans not owned by another live pot.
   *
   * @returns {{
   *   tombstoneTripId: string,
   *   dropChargeIds: string[],
   *   dropExpenseIds: string[],
   *   unlinkExpenseIds: string[],
   *   tripSuppressShortfall: boolean
   * }}
   */
  function planApaTripDelete(input) {
    input = input || {};
    var tripId = String(input.tripId || "");
    var guestKey = String(input.guestKey || "");
    var liveOther = input.otherLiveTripIds || {};
    var lineIds = input.lineIds || {};
    var lineExpenseIds = input.lineExpenseIds || {};
    var charges = Array.isArray(input.charges) ? input.charges : [];
    var expenses = Array.isArray(input.expenses) ? input.expenses : [];
    var onlyUnpaidCharges = !!input.onlyUnpaidCharges;
    var plan = {
      tombstoneTripId: tripId,
      dropChargeIds: [],
      dropExpenseIds: [],
      unlinkExpenseIds: [],
      tripSuppressShortfall: true,
    };
    if (!tripId) return plan;

    charges.forEach(function (c) {
      if (!c || !c.id || !c.isApa) return;
      var cid = String(c.id);
      var linked =
        String(c.apaTripId || "") === tripId ||
        (input.chargeId && String(c.id) === String(input.chargeId));
      if (linked) {
        if (onlyUnpaidCharges && c.isPaid) return;
        plan.dropChargeIds.push(cid);
        return;
      }
      /* Unpaid orphan for same guest (not owned by another live pot) */
      if (c.isPaid) return;
      if (guestKey && String(c.clientKey || "") !== guestKey) return;
      var tid = String(c.apaTripId || "");
      if (tid && liveOther[tid]) return;
      plan.dropChargeIds.push(cid);
    });

    expenses.forEach(function (e) {
      if (!e || !e.id) return;
      var eid = String(e.id);
      var fromLine = e.fromApaLineId ? String(e.fromApaLineId) : "";
      var onTrip = String(e.apaTripId || "") === tripId;
      var isMirror = e.source === "apa" || !!fromLine;
      if (isMirror && (onTrip || (fromLine && lineIds[fromLine]) || lineExpenseIds[eid])) {
        plan.dropExpenseIds.push(eid);
        return;
      }
      if (onTrip) plan.unlinkExpenseIds.push(eid);
    });

    var leadPatch = planApaLeadAfterPotDelete({
      apaSent: input.apaSent,
      topUps: input.topUps,
      leadApa: input.leadApa,
      leadApas: input.leadApas,
    });
    if (leadPatch) plan.leadPatch = leadPatch;

    return plan;
  }

  /**
   * Lead overnight APA is prepaid only when Issued/Paid.
   * Otherwise lead.apa may hold shortfall-to-invoice (syncLeadApaInvoiceAmount) —
   * that must NEVER seed pot.apaSent as “APA received”.
   */
  function leadApaIsPrepaid(apasStatus) {
    var s = String(apasStatus || "").trim();
    return s === "Issued" || s === "Paid";
  }

  /**
   * Write plan: start empty pot for guest — drop unpaid orphans not on a live pot.
   * When starting from a lead, seed apaSent only from true prepaid APA.
   */
  function planApaStartEmptyPot(input) {
    input = input || {};
    var guestKey = String(input.guestKey || "");
    var keepTripId = input.keepTripId != null ? String(input.keepTripId) : "";
    var live = Object.assign({}, input.liveTripIds || {});
    if (keepTripId) live[keepTripId] = 1;
    var prepaid = leadApaIsPrepaid(input.leadApas);
    var leadApa = round2(num(input.leadApa));
    var plan = {
      dropChargeIds: [],
      emptyLedger: true,
      /* Pot seed — never treat shortfall-to-invoice as prepaid received */
      potSeed: {
        apaSent: prepaid && leadApa > 0 ? leadApa : 0,
        topUps: 0,
        linkInvAmount: prepaid && leadApa > 0 ? leadApa : 0,
        linkInvNo: prepaid ? String(input.leadApaInv || "") : "",
        linkInvLabel: prepaid ? String(input.leadApaLabel || "APA") : "",
        chargeId: "",
        suppressShortfallCharge: false,
        apaCashSettled: false,
        apaCashSettledAmt: 0,
      },
    };
    if (!guestKey) return plan;
    (Array.isArray(input.charges) ? input.charges : []).forEach(function (c) {
      if (!c || !c.id || !c.isApa || c.isPaid) return;
      if (String(c.clientKey || "") !== guestKey) return;
      var tid = String(c.apaTripId || "");
      if (tid && live[tid]) return;
      plan.dropChargeIds.push(String(c.id));
    });
    return plan;
  }

  /**
   * When deleting a pot whose lead APA is not Issued/Paid, clear lead.apa.
   * That field is used for shortfall-to-invoice tracking and was showing €460
   * on the dashed “Start ledger” card after delete.
   * Issued/Paid prepaid APA on the lead is left alone.
   *
   * Note: do NOT gate on pot.apaSent — a mis-seeded pot can have apaSent>0
   * while the lead is still “Not issued” (Roman bug).
   */
  function planApaLeadAfterPotDelete(input) {
    input = input || {};
    if (leadApaIsPrepaid(input.leadApas)) return null;
    if (!(num(input.leadApa) > 0)) return null;
    return { apa: 0, apas: "Not issued" };
  }

  /**
   * Amount to show on “Start ledger” dashed card for a lead.
   * Only Issued/Paid prepaid APA — never shortfall-to-invoice residue.
   */
  function leadApaListDisplayAmount(leadApa, leadApas) {
    if (!leadApaIsPrepaid(leadApas)) return 0;
    return round2(num(leadApa));
  }

  /**
   * Linked lead without Issued/Paid APA: pot must not show lead shortfall € as
   * APA received (Roman €460 bug). Clear mistaken apaSent/linkInvAmount.
   */
  function planApaSanitizeLinkedPotSeed(input) {
    input = input || {};
    if (!input.leadLinked) return null;
    if (leadApaIsPrepaid(input.leadApas)) return null;
    if (!(num(input.apaSent) > 0) && !(num(input.linkInvAmount) > 0)) return null;
    return {
      tripPatch: {
        apaSent: 0,
        linkInvAmount: 0,
        linkInvNo: "",
      },
    };
  }

  /**
   * Pure decision for APA shortfall charge sync (no DOM / state).
   *
   * @returns {{ action: string, reason?: string }}
   *   pin | update | create | clear | skip | skip_locked | pin_paid_manual | update_zero_base
   */
  function planApaShortfallSync(input) {
    input = input || {};
    var over = Number(input.overage) || 0;
    /* Paid cash settlement closes the pot — never create/update an unpaid twin */
    if (input.hasCashSettlement || input.paidManual) {
      if (input.hasReusable) return { action: "pin_paid_manual", reason: "cash_settled" };
      return { action: "pin_paid_manual", reason: "cash_settled_no_row" };
    }
    if (input.hasReusable) {
      if (!input.force || input.chargeLocked) return { action: "pin", reason: "locked_or_no_force" };
      if (over <= 0) return { action: "update_zero_base", reason: "no_overage" };
      return { action: "update", reason: "overage" };
    }
    if (over <= 0) return { action: "clear", reason: "no_overage" };
    /*
     * suppress = user deleted the shortfall charge. Keep it gone until they
     * explicitly recreate (Sync / allowCreate) or first-overspend path with
     * allowCreate. Without allowCreate we clear (no row) so incidental saves
     * do not Danny×2 — never auto-create while suppressed.
     */
    if (input.suppressShortfall && !input.allowCreate) {
      return { action: "clear", reason: "suppress" };
    }
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
    APA_DIESEL_FALLBACK_PRICE: APA_DIESEL_FALLBACK_PRICE,
    summarizeApaTripTotals: summarizeApaTripTotals,
    apaHasPrepaid: apaHasPrepaid,
    apaDueAmount: apaDueAmount,
    apaEngineLitres: apaEngineLitres,
    apaDieselLineCalc: apaDieselLineCalc,
    planApaDieselConsumptionLine: planApaDieselConsumptionLine,
    summarizeApaPaidCovered: summarizeApaPaidCovered,
    isApaCashSettlementCharge: isApaCashSettlementCharge,
    leadApaIsPrepaid: leadApaIsPrepaid,
    leadApaListDisplayAmount: leadApaListDisplayAmount,
    pickApaCharge: pickApaCharge,
    planApaGuestChargeCollapse: planApaGuestChargeCollapse,
    planApaTripDelete: planApaTripDelete,
    planApaStartEmptyPot: planApaStartEmptyPot,
    planApaLeadAfterPotDelete: planApaLeadAfterPotDelete,
    planApaSanitizeLinkedPotSeed: planApaSanitizeLinkedPotSeed,
    planApaShortfallSync: planApaShortfallSync,
    planApaShortfallChargeFields: planApaShortfallChargeFields,
  };
});
