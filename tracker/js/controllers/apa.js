/**
 * LY_CONTROLLERS.apa — APA pot application service.
 *
 * Snapshot in → LY_MODELS → write plan / DTO out.
 * No DOM. No blob save. View applies plans and paints.
 */
(function (root, factory) {
  "use strict";
  var api = factory(
    typeof module === "object" && module.exports ? require("../models.js") : root.LY_MODELS
  );
  root.LY_CONTROLLERS_PARTS = root.LY_CONTROLLERS_PARTS || {};
  root.LY_CONTROLLERS_PARTS.apa = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultModels) {
  "use strict";

  function M(input) {
    var m = (input && input.models) || defaultModels || (typeof LY_MODELS !== "undefined" ? LY_MODELS : null);
    if (!m) throw new Error("LY_CONTROLLERS.apa: LY_MODELS missing");
    return m;
  }

  function guestKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['’]/g, "")
      .replace(/\s+/g, " ");
  }

  function isApaChargeRow(c) {
    if (!c) return false;
    if (c.kind === "apa" || c.apaTripId) return true;
    return /synced from APA|APA shortfall|APA ·|pot \(sent|spend to invoice/i.test(String(c.notes || ""));
  }

  function chargeLocked(c, models) {
    if (!c) return false;
    if (c.moneyManual) return true;
    if (c.invStatus === "Issued") return true;
    if (models.chargeIsPaid && models.chargeIsPaid(c)) return true;
    return c.payStatus === "Paid" || c.status === "Paid";
  }

  /** Raw charge → model pick DTO. */
  function mapChargeDto(c, models) {
    if (!c || c.id == null || c.id === "") return null;
    var paid = models.chargeIsPaid
      ? !!models.chargeIsPaid(c)
      : c.payStatus === "Paid" || c.status === "Paid";
    var isApa = isApaChargeRow(c);
    return {
      id: String(c.id),
      apaTripId: c.apaTripId ? String(c.apaTripId) : "",
      clientKey: guestKey(c.client),
      isPaid: paid,
      isCashSettlement: !!models.isApaCashSettlementCharge(c, {
        chargeIsPaid: function (x) {
          return models.chargeIsPaid ? models.chargeIsPaid(x) : x && (x.payStatus === "Paid" || x.status === "Paid");
        },
        chargeBillType: models.chargeBillType
          ? function (x) {
              return models.chargeBillType(x);
            }
          : null,
        chargePayMethod: models.chargePayMethod
          ? function (x) {
              return models.chargePayMethod(x);
            }
          : null,
        isApaChargeRow: isApaChargeRow,
      }),
      isApa: isApa,
      amount: Number(c.amount) || 0,
      cashPaid: Number(c.cashPaid) || 0,
      moneyManual: !!c.moneyManual,
      hasInv: !!c.inv,
      locked: chargeLocked(c, models),
    };
  }

  function mapCharges(charges, models, tombstonedIds) {
    tombstonedIds = tombstonedIds || {};
    var out = [];
    (Array.isArray(charges) ? charges : []).forEach(function (c) {
      if (!c || c.id == null) return;
      if (tombstonedIds[String(c.id)]) return;
      var d = mapChargeDto(c, models);
      if (d) out.push(d);
    });
    return out;
  }

  function liveTripIds(trips, exceptId, tombstonedTripIds) {
    var live = {};
    tombstonedTripIds = tombstonedTripIds || {};
    (Array.isArray(trips) ? trips : []).forEach(function (t) {
      if (!t || !t.id) return;
      if (exceptId && String(t.id) === String(exceptId)) return;
      if (tombstonedTripIds[String(t.id)]) return;
      live[String(t.id)] = 1;
    });
    return live;
  }

  function potIsEmptyShell(trip, models, dieselCalc) {
    if (!trip) return true;
    var dieselLines = (trip.diesel || []).map(function (r) {
      if (typeof dieselCalc === "function") return dieselCalc(trip, r) || { lit: 0, cost: 0 };
      return models.apaDieselLineCalc(
        { genBurn: trip.genBurn != null ? trip.genBurn : 6, dieselPrice: trip.dieselPrice },
        r
      );
    });
    var tot = models.summarizeApaTripTotals({
      apaSent: trip.apaSent,
      topUps: trip.topUps,
      expenses: trip.expenses || [],
      provisions: trip.provisions || [],
      dieselLines: dieselLines,
      paidCovered: 0,
      cashSettled: false,
    });
    return (
      (tot.spent || 0) <= 0.009 &&
      !(Number(trip.apaSent) > 0) &&
      !(Number(trip.topUps) > 0) &&
      !(trip.expenses && trip.expenses.length) &&
      !(trip.provisions && trip.provisions.length) &&
      !(trip.diesel && trip.diesel.length)
    );
  }

  function dieselLine(input) {
    input = input || {};
    var models = M(input);
    var t = input.trip || {};
    var genBurn = t.genBurn != null ? t.genBurn : 6;
    var price =
      input.linePrice != null
        ? input.linePrice
        : input.dieselPrice != null
          ? input.dieselPrice
          : t.dieselPrice;
    return models.apaDieselLineCalc(
      { genBurn: genBurn, dieselPrice: price },
      input.row || input.line || {}
    );
  }

  function tripTotals(input) {
    input = input || {};
    var models = M(input);
    var t = input.trip || {};
    var dieselLines = input.dieselLines;
    if (!dieselLines) {
      dieselLines = (t.diesel || []).map(function (r) {
        if (typeof input.dieselCalc === "function") return input.dieselCalc(t, r) || { lit: 0, cost: 0 };
        return dieselLine({ models: models, trip: t, row: r });
      });
    }
    var paidCovered = input.paidCovered;
    if (paidCovered == null && input.linkedCharges) {
      paidCovered = models.summarizeApaPaidCovered(input.linkedCharges, {
        chargeIsPaid: models.chargeIsPaid,
        chargeApaBaseTowardPot: models.chargeApaBaseTowardPot,
      });
    }
    if (paidCovered == null) paidCovered = 0;
    var cashSettled = input.cashSettled;
    if (cashSettled == null && input.linkedCharges) {
      cashSettled =
        t.apaCashSettled === true ||
        t.apaCashSettled === "true" ||
        t.apaCashSettled === 1 ||
        (input.linkedCharges || []).some(function (c) {
          return models.isApaCashSettlementCharge(c, {
            chargeIsPaid: models.chargeIsPaid,
            chargeBillType: models.chargeBillType,
            isApaChargeRow: isApaChargeRow,
          });
        });
    }
    return models.summarizeApaTripTotals({
      apaSent: t.apaSent,
      topUps: t.topUps,
      expenses: t.expenses || [],
      provisions: t.provisions || [],
      dieselLines: dieselLines,
      paidCovered: paidCovered,
      cashSettled: !!cashSettled,
    });
  }

  function overageAmount(input) {
    var tot = tripTotals(input);
    return tot.overage != null ? tot.overage : tot.bal < 0 ? Math.round(-tot.bal * 100) / 100 : 0;
  }

  function paidCovered(input) {
    input = input || {};
    var models = M(input);
    return models.summarizeApaPaidCovered(input.linkedCharges || [], {
      chargeIsPaid: models.chargeIsPaid,
      chargeApaBaseTowardPot: models.chargeApaBaseTowardPot,
    });
  }

  /**
   * Pick charge id for pot (display | reusable).
   * @returns {{ chargeId: string|null, reason: string }}
   */
  function pickCharge(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var dtos =
      input.chargeDtos ||
      mapCharges(input.charges, models, input.tombstonedChargeIds || {});
    return models.pickApaCharge({
      tripId: trip.id || input.tripId,
      chargeId: trip.chargeId != null ? trip.chargeId : input.chargeId,
      guestKey: input.guestKey || guestKey(trip.guest),
      potEmpty:
        input.potEmpty != null
          ? !!input.potEmpty
          : potIsEmptyShell(trip, models, input.dieselCalc),
      purpose: input.purpose || "reusable",
      charges: dtos,
      liveTripIds: input.liveTripIds || liveTripIds(input.trips, null, input.tombstonedTripIds),
    });
  }

  /** Same-trip multi-charge collapse → drop losers, pin winner. */
  function planSameTripCollapse(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var tripId = String(trip.id || "");
    var plan = { dropChargeIds: [], chargePatches: [], tripPatch: {} };
    if (!tripId) return plan;
    var dtos = mapCharges(input.charges, models, input.tombstonedChargeIds || {});
    var list = dtos.filter(function (c) {
      if (!c.isApa) return false;
      if (String(c.apaTripId || "") === tripId) return true;
      if (trip.chargeId && String(c.id) === String(trip.chargeId)) return true;
      return false;
    });
    if (list.length < 2) return plan;
    list = list.slice().sort(function (a, b) {
      var sa =
        (a.isCashSettlement ? 8000 : 0) +
        (a.isPaid ? 5000 : 0) +
        (a.moneyManual ? 3000 : 0) +
        (a.amount || 0) * 10 +
        (a.hasInv ? 20 : 0);
      var sb =
        (b.isCashSettlement ? 8000 : 0) +
        (b.isPaid ? 5000 : 0) +
        (b.moneyManual ? 3000 : 0) +
        (b.amount || 0) * 10 +
        (b.hasInv ? 20 : 0);
      return sb - sa;
    });
    var win = list[0];
    list.slice(1).forEach(function (loser) {
      if (loser.locked && !win.locked) {
        var tmp = win;
        win = loser;
        loser = tmp;
      }
      plan.dropChargeIds.push(String(loser.id));
    });
    plan.chargePatches.push({ id: String(win.id), apaTripId: tripId, kind: "apa" });
    plan.tripPatch.chargeId = String(win.id);
    return plan;
  }

  function planGuestChargeCollapse(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var dtos = mapCharges(input.charges, models, input.tombstonedChargeIds || {});
    return models.planApaGuestChargeCollapse({
      tripId: trip.id,
      chargeId: trip.chargeId,
      guestKey: input.guestKey || guestKey(trip.guest),
      otherLiveTripIds: liveTripIds(input.trips, trip.id, input.tombstonedTripIds),
      charges: dtos,
    });
  }

  /**
   * Full save orchestration write plan for one pot.
   * View: apply drop/patches/tripPatch; execute shortfall action.
   */
  function planSaveTrip(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var empty = { dropChargeIds: [], chargePatches: [], tripPatch: {}, shortfall: { action: "skip" } };
    if (!trip || !trip.id || !String(trip.guest || "").trim()) return empty;

    var same = planSameTripCollapse(input);
    var guest = planGuestChargeCollapse(input);
    var drop = {};
    (same.dropChargeIds || []).forEach(function (id) {
      drop[id] = 1;
    });
    (guest.dropChargeIds || []).forEach(function (id) {
      drop[id] = 1;
    });
    var dropChargeIds = Object.keys(drop);
    var chargePatches = (same.chargePatches || []).concat(guest.chargePatches || []);
    var tripPatch = Object.assign({}, same.tripPatch || {}, guest.tripPatch || {});

    /* Charges after planned drops — re-map for pick */
    var remainIds = {};
    dropChargeIds.forEach(function (id) {
      remainIds[id] = 1;
    });
    var chargesAfter = (input.charges || [])
      .filter(function (c) {
        return c && c.id && !remainIds[String(c.id)];
      })
      .map(function (c) {
        return Object.assign({}, c);
      });
    /* Apply patches virtually for pick (do not mutate caller's rows) */
    chargePatches.forEach(function (p) {
      chargesAfter.forEach(function (c) {
        if (c && String(c.id) === String(p.id)) {
          if (p.apaTripId != null) c.apaTripId = p.apaTripId;
          if (p.kind != null) c.kind = p.kind;
        }
      });
    });
    var tripForPick = Object.assign({}, trip, tripPatch);

    var pick = pickCharge({
      models: models,
      trip: tripForPick,
      charges: chargesAfter,
      trips: input.trips,
      purpose: "reusable",
      dieselCalc: input.dieselCalc,
      tombstonedChargeIds: input.tombstonedChargeIds,
      tombstonedTripIds: input.tombstonedTripIds,
    });
    var chId = pick.chargeId;
    var chRow = chId
      ? chargesAfter.filter(function (c) {
          return c && String(c.id) === String(chId);
        })[0]
      : null;
    var chDto = chRow ? mapChargeDto(chRow, models) : null;

    var linked = chargesAfter.filter(function (c) {
      if (!c) return false;
      if (String(c.apaTripId || "") === String(trip.id)) return true;
      if (tripForPick.chargeId && String(c.id) === String(tripForPick.chargeId)) return true;
      return false;
    });
    var over = overageAmount({
      models: models,
      trip: tripForPick,
      linkedCharges: linked,
      paidCovered: input.paidCovered,
      cashSettled: input.cashSettled,
      dieselCalc: input.dieselCalc,
    });
    if (input.overage != null) over = Number(input.overage) || 0;

    var hasCash =
      !!(chDto && chDto.isCashSettlement) ||
      linked.some(function (c) {
        return models.isApaCashSettlementCharge(c, {
          chargeIsPaid: models.chargeIsPaid,
          chargeBillType: models.chargeBillType,
          isApaChargeRow: isApaChargeRow,
        });
      }) ||
      tripForPick.apaCashSettled === true ||
      tripForPick.apaCashSettled === "true" ||
      tripForPick.apaCashSettled === 1;

    var paidManual = linked.some(function (c) {
      if (!(models.chargeIsPaid ? models.chargeIsPaid(c) : c.payStatus === "Paid")) return false;
      if (c.moneyManual) return true;
      var bt = models.chargeBillType ? models.chargeBillType(c) : String(c.billType || "");
      return bt === "cash" || bt === "mix" || !!c.cashDeal;
    });

    var force = input.force !== false;
    var allowCreate = !!input.allowCreate;
    var hasReusable = !!chId;
    if (!hasReusable && over > 0.009 && !trip.suppressShortfallCharge && !hasCash) {
      allowCreate = allowCreate || !!input.firstShortfall;
    }

    var decision = models.planApaShortfallSync({
      overage: over,
      hasReusable: hasReusable,
      allowCreate: allowCreate,
      suppressShortfall: !!trip.suppressShortfallCharge,
      paidManual: paidManual,
      hasCashSettlement: hasCash,
      force: force,
      chargeLocked: chDto ? !!chDto.locked : false,
    });

    var shortfall = {
      action: decision.action || "skip",
      reason: decision.reason || "",
      chargeId: chId,
      overage: over,
      guest: trip.guest || "",
      zeroPot: !models.apaHasPrepaid(trip),
    };
    if (decision.action === "create" || decision.action === "update" || decision.action === "update_zero_base") {
      shortfall.moneyFields = models.planApaShortfallChargeFields(
        decision.action === "update_zero_base" ? 0 : over,
        { tripId: trip.id, zeroPot: shortfall.zeroPot }
      );
    }

    return {
      dropChargeIds: dropChargeIds,
      chargePatches: chargePatches,
      tripPatch: tripPatch,
      shortfall: shortfall,
    };
  }

  function planTripDelete(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var lineIds = {};
    var lineExpenseIds = {};
    function mark(arr) {
      (arr || []).forEach(function (x) {
        if (!x) return;
        if (x.id) lineIds[String(x.id)] = 1;
        if (x.expenseId) lineExpenseIds[String(x.expenseId)] = 1;
        if (x.fromExpenseId) lineExpenseIds[String(x.fromExpenseId)] = 1;
      });
    }
    mark(trip.expenses);
    mark(trip.provisions);
    mark(trip.diesel);
    mark(trip.dieselLoads);

    var dtos = mapCharges(input.charges, models, input.tombstonedChargeIds || {});
    var expenses = (input.expenses || []).map(function (e) {
      if (!e || !e.id) return null;
      return {
        id: String(e.id),
        apaTripId: e.apaTripId ? String(e.apaTripId) : "",
        fromApaLineId: e.fromApaLineId ? String(e.fromApaLineId) : "",
        source: e.source || "",
      };
    }).filter(Boolean);

    return models.planApaTripDelete({
      tripId: trip.id,
      chargeId: trip.chargeId,
      guestKey: input.guestKey || guestKey(trip.guest),
      otherLiveTripIds: liveTripIds(input.trips, trip.id, input.tombstonedTripIds),
      lineIds: lineIds,
      lineExpenseIds: lineExpenseIds,
      charges: dtos,
      expenses: expenses,
      apaSent: trip.apaSent,
      topUps: trip.topUps,
      leadApa: input.leadApa,
      leadApas: input.leadApas,
    });
  }

  function planStartEmptyPot(input) {
    input = input || {};
    var models = M(input);
    var lead = input.lead || {};
    var dtos = mapCharges(input.charges, models, input.tombstonedChargeIds || {});
    return models.planApaStartEmptyPot({
      guestKey: input.guestKey || guestKey(input.guest || lead.name),
      keepTripId: input.keepTripId,
      liveTripIds: input.liveTripIds || liveTripIds(input.trips, null, input.tombstonedTripIds),
      charges: dtos,
      leadApa: lead.apa != null ? lead.apa : input.leadApa,
      leadApas: lead.apas != null ? lead.apas : input.leadApas,
      leadApaInv: lead.apaInv != null ? lead.apaInv : input.leadApaInv,
      leadApaLabel: input.leadApaLabel || "APA",
    });
  }

  /** Fix pot that already has shortfall € mis-seeded as apaSent. */
  function planSanitizeLinkedPotSeed(input) {
    input = input || {};
    var models = M(input);
    var trip = input.trip || {};
    var lead = input.lead || {};
    return models.planApaSanitizeLinkedPotSeed({
      leadLinked: !!(input.leadLinked || lead.id || /^lead:/.test(String(trip.clientKey || ""))),
      leadApas: lead.apas != null ? lead.apas : input.leadApas,
      apaSent: trip.apaSent,
      linkInvAmount: trip.linkInvAmount,
    });
  }

  function planShortfallSync(input) {
    return M(input).planApaShortfallSync(input || {});
  }

  function shortfallChargeFields(input) {
    input = input || {};
    return M(input).planApaShortfallChargeFields(input.overage, input.tripMeta || {});
  }

  return {
    guestKey: guestKey,
    isApaChargeRow: isApaChargeRow,
    dieselLine: dieselLine,
    tripTotals: tripTotals,
    overageAmount: overageAmount,
    paidCovered: paidCovered,
    pickCharge: pickCharge,
    planSameTripCollapse: planSameTripCollapse,
    planGuestChargeCollapse: planGuestChargeCollapse,
    planSaveTrip: planSaveTrip,
    planTripDelete: planTripDelete,
    planStartEmptyPot: planStartEmptyPot,
    planSanitizeLinkedPotSeed: planSanitizeLinkedPotSeed,
    planShortfallSync: planShortfallSync,
    shortfallChargeFields: shortfallChargeFields,
  };
});
