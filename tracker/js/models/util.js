/**
 * LY_MODELS · util (num / money helpers)
 * Pure domain model — no DOM. Part of LY_MODELS.
 * @see tracker/js/models/README.md
 */
(function (root, factory) {
  "use strict";
  var exp = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.util = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
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


/**
 * Split a VAT-inclusive gross into net + VAT.
 * @param {number} gross
 * @param {number} [pct] default 21
 * @returns {{ net, vat, gross, pct }}
 */
function invoiceSplitGross(gross, pct) {
  pct = pct == null || pct === "" ? 21 : Number(pct) || 0;
  gross = Number(gross) || 0;
  if (pct <= 0) return { net: gross, vat: 0, gross: gross, pct: 0 };
  var net = gross / (1 + pct / 100);
  var vat = gross - net;
  return { net: net, vat: vat, gross: gross, pct: pct };
}

  return {
    num: num,
    round2: round2,
    moneyFromBase: moneyFromBase,
    invoiceSplitGross: invoiceSplitGross
  };
});
