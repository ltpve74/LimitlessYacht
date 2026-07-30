/**
 * LY_MODELS · diesel (bunker buy + sticky guest sell)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory(typeof module === "object" && module.exports ? require("./util.js") : (root.LY_MODELS_PARTS || {}).util);
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.diesel = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  var num = util.num;
  var round2 = util.round2;

/* ---------- Diesel (bunker buy + sticky active guest sell) ---------- */
/**
 * Model rules (locked):
 *  1. After each bunker, set buyPrice and an explicit guest sellPrice
 *     (default = bunker + markup; captain may type a different sell).
 *  2. sellPrice is ACTIVE for all subsequent sell / new APA rates until
 *     the next bunker or a manual sell change.
 *  3. Manual sell edits stick (sellSource = manual) until the next bunker.
 *  4. Never treat legacy 1.75 as “today’s rate” when buy or sell is known.
 *  5. Historical lines store their own €/L — never re-price them.
 */
var DIESEL_MARKUP = 0.1;
var DIESEL_DEFAULT_BUY = 1.74;
/* Reconstruct-only when a pre-model trip has fuel but no bunker/rate. Not “current”. */
var DIESEL_LEGACY_FALLBACK_SELL = 1.75;
/* Obsolete fixed default from an early build — scrub if still stored */
var DIESEL_PREV_DEFAULT_HIGH = 2.2;

function dieselSuggestedSell(buyPrice, markup) {
  var m = markup == null ? DIESEL_MARKUP : Number(markup);
  if (!isFinite(m)) m = DIESEL_MARKUP;
  var b = round2(num(buyPrice));
  if (!(b > 0)) return 0;
  return round2(b + m);
}

/**
 * Normalize settings row. Fills missing buy/sell; scrubs obsolete 2.20.
 * Does NOT overwrite a valid sell with buy+markup (manual/bunker sell sticks).
 */
function dieselNormalizeSettings(settings, opts) {
  opts = opts || {};
  var out = settings && typeof settings === "object" ? settings : {};
  var dirty = false;
  function set(k, v) {
    if (out[k] !== v) {
      out[k] = v;
      dirty = true;
    }
  }
  var buy = round2(num(out.buyPrice));
  if (!(buy > 0)) {
    var lb = round2(num(opts.lastBunkerBuy));
    buy = lb > 0 ? lb : DIESEL_DEFAULT_BUY;
    set("buyPrice", buy);
  }
  var sell = round2(num(out.sellPrice));
  if (Math.abs(sell - DIESEL_PREV_DEFAULT_HIGH) < 0.001) sell = 0;
  if (!(sell > 0)) {
    sell = dieselSuggestedSell(buy);
    set("sellPrice", sell);
    if (!out.sellSource) set("sellSource", "suggested");
  }
  if (!out.sellSource) {
    set("sellSource", out.sellPinned ? "manual" : "suggested");
  }
  return {
    settings: out,
    changed: dirty,
    buyPrice: round2(num(out.buyPrice)),
    sellPrice: round2(num(out.sellPrice)),
    sellSource: String(out.sellSource || "suggested"),
    suggestedSell: dieselSuggestedSell(round2(num(out.buyPrice))),
  };
}

/**
 * After bunkering: set buy + sale price for subsequent transactions.
 * explicitSell > 0 wins; else suggested = buy + markup.
 * Always refreshes sell (new bunker = new sale period).
 */
function dieselApplyBunker(settings, bunkerBuy, explicitSell) {
  var buy = round2(num(bunkerBuy));
  if (!(buy > 0)) {
    return {
      settings: settings || {},
      changed: false,
      buyPrice: 0,
      sellPrice: 0,
      suggestedSell: 0,
      sellSource: "",
    };
  }
  var suggested = dieselSuggestedSell(buy);
  var sell = round2(num(explicitSell));
  if (!(sell > 0)) sell = suggested;
  var src = Math.abs(sell - suggested) < 0.001 ? "bunker" : "manual";
  var out = settings && typeof settings === "object" ? settings : {};
  var dirty = false;
  if (round2(num(out.buyPrice)) !== buy) {
    out.buyPrice = buy;
    dirty = true;
  }
  if (round2(num(out.sellPrice)) !== sell) {
    out.sellPrice = sell;
    dirty = true;
  }
  if (out.sellSource !== src) {
    out.sellSource = src;
    dirty = true;
  }
  if (out.sellPinned) {
    out.sellPinned = false;
    dirty = true;
  }
  return {
    settings: out,
    changed: dirty,
    buyPrice: buy,
    sellPrice: sell,
    suggestedSell: suggested,
    sellSource: src,
  };
}

/** Captain sets active sale price between bunkers (spread / market). */
function dieselSetActiveSell(settings, sellPrice) {
  var sell = round2(num(sellPrice));
  var out = settings && typeof settings === "object" ? settings : {};
  if (!(sell > 0)) {
    return { settings: out, changed: false, sellPrice: 0, sellSource: "" };
  }
  var dirty = false;
  if (round2(num(out.sellPrice)) !== sell) {
    out.sellPrice = sell;
    dirty = true;
  }
  if (out.sellSource !== "manual") {
    out.sellSource = "manual";
    dirty = true;
  }
  if (!out.sellPinned) {
    out.sellPinned = true;
    dirty = true;
  }
  return {
    settings: out,
    changed: dirty,
    sellPrice: sell,
    sellSource: "manual",
  };
}

/** Active guest sell for NEW sells / new APA — settings only, no 1.75 invent. */
function dieselActiveSell(settings) {
  return dieselNormalizeSettings(settings || {}).sellPrice;
}

/**
 * Guest sell for a calendar day (historical resolve for unpinned trips).
 * Last bunker on/before date → buy + markup.
 * No bunker: opts.activeSell if set, else legacy reconstruct fallback only.
 */
function dieselGuestSellForDate(bunkers, dateStr, opts) {
  opts = opts || {};
  var markup = opts.markup == null ? DIESEL_MARKUP : opts.markup;
  var cut = dateStr ? String(dateStr).slice(0, 10) : "";
  var best = null;
  (bunkers || []).forEach(function (e) {
    if (!e || (e.kind && e.kind !== "buy")) return;
    var px = round2(num(e.price));
    if (!(px > 0)) return;
    var d = String(e.date || "").slice(0, 10);
    if (cut && d && d > cut) return;
    if (!best) {
      best = { date: d, price: px };
      return;
    }
    if (!d) return;
    if (d > String(best.date || "")) {
      best = { date: d, price: px };
      return;
    }
    if (d === String(best.date || "")) best = { date: d, price: px };
  });
  if (best && best.price > 0) return dieselSuggestedSell(best.price, markup);
  var active = round2(num(opts.activeSell));
  if (active > 0) return active;
  return DIESEL_LEGACY_FALLBACK_SELL;
}


  return {
    DIESEL_MARKUP: DIESEL_MARKUP,
    DIESEL_DEFAULT_BUY: DIESEL_DEFAULT_BUY,
    DIESEL_LEGACY_FALLBACK_SELL: DIESEL_LEGACY_FALLBACK_SELL,
    DIESEL_PREV_DEFAULT_HIGH: DIESEL_PREV_DEFAULT_HIGH,
    dieselSuggestedSell: dieselSuggestedSell,
    dieselNormalizeSettings: dieselNormalizeSettings,
    dieselApplyBunker: dieselApplyBunker,
    dieselSetActiveSell: dieselSetActiveSell,
    dieselActiveSell: dieselActiveSell,
    dieselGuestSellForDate: dieselGuestSellForDate
  };
});
