/**
 * LY_PDF.cardReceipts — one page per card expense, same order as the spreadsheet.
 *
 * Paint only. Rows come from LY_CONTROLLERS.expenses.cardMonthReport.
 * A row with no JPEG/PNG is left out. Page numbers count only the photos.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  root.LY_PDF = root.LY_PDF || {};
  root.LY_PDF.cardReceipts = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pdfMoney(n) {
    var x = Math.round((Number(n) || 0) * 100) / 100;
    var neg = x < 0;
    x = Math.abs(x);
    var s = x.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? "-" : "") + "EUR " + s;
  }

  function safeText(s) {
    var t = String(s == null ? "" : s);
    t = t.replace(/\u20AC/g, "EUR ");
    t = t.replace(/[\u2013\u2014\u2212\u2010]/g, "-");
    t = t.replace(/[\u2018\u2019\u201A\u2032]/g, "'");
    t = t.replace(/[\u201C\u201D\u2033]/g, '"');
    t = t.replace(/\u2026/g, "...");
    t = t.replace(/[\u00B7\u2022]/g, "-");
    t = t.replace(/[\u00A0\u202F]/g, " ");
    t = t.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, function (ch) {
      try {
        var n = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (/^[\x20-\x7E]$/.test(n)) return n;
      } catch (eN) {}
      return "?";
    });
    return t;
  }

  function fileName(month) {
    return "Limitless-card-receipts-" + String(month || "").slice(0, 7) + ".pdf";
  }

  function dataUrlBytes(url) {
    var s = String(url || "").trim();
    var m = s.match(/^data:image\/(?:png|jpeg|jpg);base64,([\s\S]+)$/i);
    if (!m) return null;
    var b64 = m[1].replace(/\s/g, "");
    if (!b64) return null;
    try {
      if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    } catch (eB) {}
    try {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
      return out;
    } catch (eA) {
      return null;
    }
  }

  /**
   * @param {object} report DTO from buildCardExpenseReport
   * @param {object} PDFLib pdf-lib namespace
   * @returns {Promise<Blob>}
   */
  function build(report, PDFLib) {
    if (!report) return Promise.reject(new Error("No card report"));
    if (!PDFLib || !PDFLib.PDFDocument) return Promise.reject(new Error("PDF library not available"));
    var PDFDocument = PDFLib.PDFDocument;
    var rgb = PDFLib.rgb;
    var StandardFonts = PDFLib.StandardFonts;
    var W = 595.28;
    var H = 841.89;
    var margin = 36;

    return PDFDocument.create().then(function (doc) {
      return Promise.all([
        doc.embedFont(StandardFonts.Helvetica),
        doc.embedFont(StandardFonts.HelveticaBold),
      ]).then(function (fonts) {
        var font = fonts[0];
        var fontBold = fonts[1];
        var navy = rgb(0.06, 0.14, 0.28);
        var gold = rgb(0.79, 0.66, 0.3);
        var ink = rgb(0.12, 0.13, 0.15);
        var muted = rgb(0.42, 0.45, 0.5);
        var rows = Array.isArray(report.rows) ? report.rows : [];
        var monthLabel = safeText(report.monthLabel || report.month || "");

        function fit(text, size, bold, maxW) {
          var f = bold ? fontBold : font;
          var str = safeText(text);
          if (!str) return "";
          if (f.widthOfTextAtSize(str, size) <= maxW) return str;
          while (str.length > 2 && f.widthOfTextAtSize(str + "...", size) > maxW) str = str.slice(0, -1);
          return str + "...";
        }
        function draw(page, text, x, y, size, bold, color) {
          var str = safeText(text);
          if (!str) return;
          try {
            page.drawText(str, {
              x: x,
              y: y,
              size: size,
              font: bold ? fontBold : font,
              color: color || ink,
            });
          } catch (e) {}
        }
        function drawImage(page, img, top) {
          var maxW = W - margin * 2;
          var maxH = Math.max(40, top - margin);
          var sc = Math.min(maxW / img.width, maxH / img.height);
          if (!isFinite(sc) || sc <= 0) sc = 1;
          var w = img.width * sc;
          var h = img.height * sc;
          var x = margin + (maxW - w) / 2;
          page.drawImage(img, { x: x, y: top - h, width: w, height: h });
        }
        function drawRight(page, text, rightX, y, size, bold, color) {
          var str = safeText(text);
          if (!str) return;
          var w = (bold ? fontBold : font).widthOfTextAtSize(str, size);
          draw(page, str, rightX - w, y, size, bold, color);
        }
        function paintChrome(page, index, total, label) {
          draw(page, "M/Y LIMITLESS", margin, H - 48, 11, true, navy);
          if (total > 0) drawRight(page, index + " of " + total, W - margin, H - 48, 11, false, muted);
          draw(page, "Card receipts · " + monthLabel, margin, H - 66, 10, false, muted);
          page.drawRectangle({
            x: margin,
            y: H - 76,
            width: W - margin * 2,
            height: 2,
            color: gold,
          });
          draw(page, label, margin, H - 98, 13, true, ink);
          return H - 116;
        }
        function paintNotice(title, line) {
          var page = doc.addPage([W, H]);
          paintChrome(page, 0, 0, title);
          if (line) draw(page, line, margin, H - 124, 11, false, muted);
        }
        function embedRow(row) {
          var photo = row && row.receipt;
          var bytes = photo ? dataUrlBytes(photo) : null;
          if (!bytes) return Promise.resolve(null);
          var pending = /^data:image\/png/i.test(photo) ? doc.embedPng(bytes) : doc.embedJpg(bytes);
          return Promise.resolve(pending)
            .then(function (img) {
              return { row: row, img: img };
            })
            .catch(function () {
              return null;
            });
        }
        function paintPhoto(item, index, total) {
          var row = item.row || {};
          var label =
            (row.date || "") +
            "  ·  " +
            (row.vendor || "Expense") +
            "  ·  " +
            pdfMoney(row.amount);
          var page = doc.addPage([W, H]);
          var top = paintChrome(page, index, total, fit(label, 13, true, W - margin * 2));
          drawImage(page, item.img, top);
        }

        if (!rows.length) {
          paintNotice("No card expenses this month", "Cash, APA cash, and bank transfers are left out.");
          return doc.save();
        }
        var chain = Promise.resolve([]);
        rows.forEach(function (row) {
          chain = chain.then(function (kept) {
            return embedRow(row).then(function (item) {
              if (item) kept.push(item);
              return kept;
            });
          });
        });
        return chain.then(function (kept) {
          if (!kept.length) {
            paintNotice("No receipt photos this month", "Charges without a photo are left out.");
            return doc.save();
          }
          kept.forEach(function (item, i) {
            paintPhoto(item, i + 1, kept.length);
          });
          return doc.save();
        });
      });
    }).then(function (bytes) {
      return new Blob([bytes], { type: "application/pdf" });
    });
  }

  return {
    fileName: fileName,
    pdfMoney: pdfMoney,
    safeText: safeText,
    build: build,
  };
});
