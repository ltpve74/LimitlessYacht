/**
 * LY_MODELS · receipt photo read
 * Pure: turn a model’s receipt JSON into shop / date / euro total,
 * and decide which form fields may be filled.
 * Never writes the ledger. The captain saves.
 *
 * @see netlify/functions/lib/receipt-read.mjs
 */
(function (root, factory) {
  "use strict";
  var util =
    typeof module === "object" && module.exports
      ? require("./util.js")
      : (root.LY_MODELS_PARTS || {}).util;
  var exp = factory(util);
  if (typeof module === "object" && module.exports) {
    module.exports = exp;
  } else {
    root.LY_MODELS_PARTS = root.LY_MODELS_PARTS || {};
    root.LY_MODELS_PARTS.receipt = exp;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (util) {
  "use strict";
  if (!util || typeof util.num !== "function" || typeof util.round2 !== "function") {
    throw new Error("receipt model needs util.num and util.round2");
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? "0" + n : n;
  }

  function utcToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysIso(iso, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
  }

  function parseReceiptDate(v, today) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    var dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
    var y;
    var mo;
    var d;
    if (iso) {
      y = +iso[1];
      mo = +iso[2];
      d = +iso[3];
    } else if (dmy) {
      d = +dmy[1];
      mo = +dmy[2];
      y = +dmy[3];
    } else {
      return "";
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
    var out = y + "-" + pad2(mo) + "-" + pad2(d);
    if (out < "2024-01-01") return "";
    var limit = addDaysIso(today || utcToday(), 14);
    if (limit && out > limit) return "";
    return out;
  }

  function prettyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    return +m[3] + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }

  function cleanVendor(v) {
    var s = String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^["']+|["']+$/g, "");
    if (!s) return "";
    if (/^(unknown|n\/a|na|none|null|-|receipt)$/i.test(s)) return "";
    if (s.length > 60) s = s.slice(0, 60).trim();
    return s;
  }

  function cleanAmount(v) {
    if (v == null || v === "") return null;
    var n = util.round2(util.num(v));
    if (!(n > 0) || n > 20000) return null;
    return n;
  }

  function isEur(c) {
    var s = String(c == null ? "" : c)
      .trim()
      .toLowerCase();
    if (!s) return true;
    return s === "eur" || s === "euro" || s === "euros" || s === "€";
  }

  function euroLabel(n) {
    return "€" + util.round2(n).toFixed(2);
  }

  /**
   * @param {object} raw vendor, date, amount, currency from the reader
   * @param {string} [today] YYYY-MM-DD, for rejecting future slips
   */
  function normalizeReceiptRead(raw, today) {
    raw = raw || {};
    var day = today || utcToday();
    var vendor = cleanVendor(raw.vendor);
    var date = parseReceiptDate(raw.date, day);
    var eur = isEur(raw.currency);
    var amount = eur ? cleanAmount(raw.amount) : null;
    var foreignAmount = !eur ? cleanAmount(raw.amount) : null;
    var currency = eur ? "EUR" : String(raw.currency || "").trim().toUpperCase().slice(0, 8);
    var parts = [];
    if (vendor) parts.push(vendor);
    if (date) parts.push(prettyDate(date));
    if (amount != null) parts.push(euroLabel(amount));
    else if (foreignAmount != null && currency) parts.push(currency + " " + util.round2(foreignAmount).toFixed(2) + " (not euros — not filled)");
    return {
      vendor: vendor,
      date: date,
      amount: amount,
      currency: currency || (eur ? "EUR" : ""),
      summary: parts.join(" · "),
    };
  }

  /**
   * Which fields the open form may take from a suggestion.
   * Null means leave the field alone.
   * amount is a string ready for the money input.
   */
  function planReceiptFieldFill(input) {
    input = input || {};
    var sug = input.suggestion || {};
    var out = { date: null, vendor: null, amount: null, summary: sug.summary || "" };
    if (input.allowDate && sug.date) out.date = sug.date;
    if (input.allowVendor && sug.vendor && !String(input.currentVendor || "").trim()) out.vendor = sug.vendor;
    var amtCur = String(input.currentAmount == null ? "" : input.currentAmount).trim();
    if (input.allowAmount && sug.amount != null && !amtCur) out.amount = util.round2(sug.amount).toFixed(2);
    return out;
  }

  /** Shop name for “is this the same till?”. Drops legal suffixes and punctuation. */
  function vendorKey(v) {
    return String(v == null ? "" : v)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(s\.?\s*l\.?\s*u?\.?|s\.?\s*a\.?)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function vendorsAlike(a, b) {
    a = vendorKey(a);
    b = vendorKey(b);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) return true;
    var aw = a.split(" ")[0];
    var bw = b.split(" ")[0];
    return aw.length >= 4 && aw === bw;
  }

  /**
   * Same shop, same day, same euro total as a row already in the books.
   * A linked APA line and its expense count once. skipIds is the row being edited.
   * Does not write anything.
   */
  function findReceiptCopies(input) {
    input = input || {};
    var vendor = String(input.vendor == null ? "" : input.vendor).trim();
    var date = String(input.date || "").slice(0, 10);
    var amount = util.round2(util.num(input.amount));
    var empty = { matches: [], notice: "" };
    if (!vendor || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0)) return empty;
    var skip = {};
    var skipIds = Array.isArray(input.skipIds) ? input.skipIds : [];
    for (var s = 0; s < skipIds.length; s++) {
      if (skipIds[s]) skip[String(skipIds[s])] = true;
    }
    var rows = Array.isArray(input.rows) ? input.rows : [];
    var hits = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.id == null) continue;
      var id = String(row.id);
      if (!id || skip[id]) continue;
      var link = row.linkId ? String(row.linkId) : "";
      if (link && skip[link]) continue;
      if (seen[id] || (link && seen[link])) continue;
      if (!vendorsAlike(vendor, row.vendor)) continue;
      if (String(row.date || "").slice(0, 10) !== date) continue;
      var amt = util.round2(util.num(row.amount));
      if (Math.abs(amt - amount) > 0.009) continue;
      seen[id] = true;
      if (link) seen[link] = true;
      hits.push({
        id: id,
        vendor: String(row.vendor || "").trim(),
        date: date,
        amount: amt,
        where: String(row.where || "").trim(),
      });
    }
    if (!hits.length) return empty;
    var h = hits[0];
    var notice =
      "Already entered" +
      (h.where ? " in " + h.where : "") +
      ": " +
      (h.vendor || vendor) +
      " · " +
      prettyDate(h.date) +
      " · " +
      euroLabel(h.amount);
    if (hits.length > 1) notice += " (+" + (hits.length - 1) + " more)";
    return { matches: hits, notice: notice };
  }

  return {
    normalizeReceiptRead: normalizeReceiptRead,
    planReceiptFieldFill: planReceiptFieldFill,
    parseReceiptDate: parseReceiptDate,
    findReceiptCopies: findReceiptCopies,
  };
});
