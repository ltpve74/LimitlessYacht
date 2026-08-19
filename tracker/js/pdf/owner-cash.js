/**
 * LY_PDF.ownerCash — simple on-board cash PDF for the owner.
 *
 * At a glance: opening · cash in · cash out · on board.
 * Then itemised cash in / cash out. No charter P&L, no commissions earned.
 * Paint only — DTO from LY_CONTROLLERS.cashReport.monthReport.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  root.LY_PDF = root.LY_PDF || {};
  root.LY_PDF.ownerCash = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pdfMoney(n) {
    var x = Math.round((Number(n) || 0) * 100) / 100;
    var neg = x < 0;
    x = Math.abs(x);
    var s = x.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (neg ? "-" : "") + "EUR " + s;
  }

  function publicLabel(s) {
    var t = String(s == null ? "" : s);
    if (!t) return "";
    t = t.replace(/\bCaptain\s*\(\s*me\s*\)/gi, "Captain");
    t = t.replace(/\bCaptain\s*\(\s*you\s*\)/gi, "Captain");
    t = t.replace(/\(\s*me\s*\)/gi, "");
    t = t.replace(/\(\s*you\s*\)/gi, "");
    t = t.replace(/\bCommission to you\b/gi, "Captain commission");
    t = t.replace(/\bReimbursement to you\b/gi, "Captain reimbursement");
    t = t.replace(/\bRepay you\b/gi, "Repay captain");
    t = t.replace(/\bPaid to you\b/gi, "Paid to captain");
    t = t.replace(/\bstill owe you\b/gi, "still owed to captain");
    t = t.replace(/\byour (share|pocket|commission)\b/gi, function (_, w) {
      return "captain " + String(w || "").toLowerCase();
    });
    t = t.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
    return t;
  }

  function safeText(s) {
    var t = publicLabel(s);
    t = t.replace(/\u20AC/g, "EUR ");
    t = t.replace(/[\u2013\u2014\u2212\u2010]/g, "-");
    t = t.replace(/[\u2018\u2019\u201A\u2032]/g, "'");
    t = t.replace(/[\u201C\u201D\u2033]/g, '"');
    t = t.replace(/\u2026/g, "...");
    t = t.replace(/[\u00B7\u2022\u2023\u2043\u2219\u25CF\u25E6]/g, "-");
    t = t.replace(/[\u00A0\u202F\u2007\u2009]/g, " ");
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
    return "Limitless-owner-cash-" + String(month || "").slice(0, 7) + ".pdf";
  }

  /**
   * @param {object} report DTO from cashReport.monthReport
   * @param {object} PDFLib pdf-lib namespace
   * @param {{ fmtDate?: function }} [opts]
   * @returns {Promise<Blob>}
   */
  function build(report, PDFLib, opts) {
    opts = opts || {};
    if (!report) return Promise.reject(new Error("No report DTO"));
    if (!PDFLib || !PDFLib.PDFDocument) return Promise.reject(new Error("PDF library not available"));

    var fmtDate =
      typeof opts.fmtDate === "function"
        ? opts.fmtDate
        : function (d) {
            return String(d || "").slice(0, 10);
          };

    var PDFDocument = PDFLib.PDFDocument;
    var rgb = PDFLib.rgb;
    var StandardFonts = PDFLib.StandardFonts;

    return PDFDocument.create().then(function (doc) {
      return Promise.all([
        doc.embedFont(StandardFonts.Helvetica),
        doc.embedFont(StandardFonts.HelveticaBold),
      ]).then(function (res) {
        var font = res[0];
        var fontBold = res[1];
        var W = 480;
        var margin = 28;
        var contentW = W - margin * 2;
        var navy = rgb(0.06, 0.14, 0.28);
        var gold = rgb(0.79, 0.66, 0.3);
        var goldSoft = rgb(0.96, 0.93, 0.84);
        var ink = rgb(0.12, 0.13, 0.15);
        var muted = rgb(0.42, 0.45, 0.5);
        var zebra = rgb(0.97, 0.98, 0.99);
        var white = rgb(1, 1, 1);
        var greenInk = rgb(0.1, 0.36, 0.28);
        var greenBg = rgb(0.91, 0.96, 0.93);
        var amberBg = rgb(1, 0.97, 0.9);
        var amberInk = rgb(0.55, 0.35, 0.05);
        var redInk = rgb(0.55, 0.12, 0.1);
        var redBg = rgb(1, 0.94, 0.93);
        var slateBg = rgb(0.93, 0.94, 0.97);
        var slateInk = rgb(0.18, 0.22, 0.32);
        var page = null;

        var cashIn = Number(report.cashInTotal) || 0;
        var cashOut = Number(report.cashOut) || 0;
        var onBoard = Number(report.pettyOnboard) || 0;
        var start = Number(report.pettyStart) || 0;
        var boatShort = Math.max(0, Number(report.cashShort) || 0);
        var periodLab = report.monthLabel || report.month || "";
        var pend = report.cashPending || { total: 0, boat: 0, owner: 0, n: 0, items: [] };
        var proj = report.cashProjected || { total: 0, boat: 0, owner: 0, n: 0, items: [] };
        var pendBoat = Number(pend.boat) || 0;
        var pendOwner = Number(pend.owner) || 0;
        var projBoat = Number(proj.boat) || 0;
        var projOwner = Number(proj.owner) || 0;
        var pendTot = Number(pend.total) || pendBoat + pendOwner;
        var projTot = Number(proj.total) || projBoat + projOwner;
        var expectBoat = Math.round((onBoard + pendBoat + projBoat) * 100) / 100;

        function wrapLines(t, size, bold, maxW) {
          var f = bold ? fontBold : font;
          var str = safeText(t);
          if (!str) return [];
          var words = str.split(/\s+/);
          var lines = [];
          var cur = "";
          words.forEach(function (w) {
            var trial = cur ? cur + " " + w : w;
            if (f.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
            else {
              if (cur) lines.push(cur);
              cur = w;
              while (f.widthOfTextAtSize(cur, size) > maxW && cur.length > 4) {
                var cut = cur.length - 1;
                while (cut > 4 && f.widthOfTextAtSize(cur.slice(0, cut), size) > maxW) cut--;
                lines.push(cur.slice(0, cut));
                cur = cur.slice(cut);
              }
            }
          });
          if (cur) lines.push(cur);
          return lines.length ? lines : [""];
        }
        function measureWrap(t, size, bold, maxW, lineH) {
          return wrapLines(t, size, bold, maxW).length * (lineH || size + 5);
        }
        function drawText(t, x, yy, size, bold, color, maxW) {
          var f = bold ? fontBold : font;
          var str = safeText(t);
          if (!str) return;
          if (maxW) {
            while (str.length > 3 && f.widthOfTextAtSize(str, size) > maxW) str = str.slice(0, -2);
            if (str.length && str !== safeText(t)) str = str.slice(0, -1) + "...";
          }
          try {
            page.drawText(str, { x: x, y: yy, size: size, font: f, color: color || ink });
          } catch (e) {
            str = str.replace(/[^\x20-\x7E]/g, "?");
            if (str) page.drawText(str, { x: x, y: yy, size: size, font: f, color: color || ink });
          }
        }
        function drawRight(t, rightX, yy, size, bold, color) {
          var f = bold ? fontBold : font;
          var str = safeText(t);
          if (!str) return;
          var w = f.widthOfTextAtSize(str, size);
          try {
            page.drawText(str, { x: rightX - w, y: yy, size: size, font: f, color: color || ink });
          } catch (e) {}
        }
        function drawWrap(t, x, yy, size, bold, color, maxW, lineH) {
          lineH = lineH || size + 5;
          var lines = wrapLines(t, size, bold, maxW);
          lines.forEach(function (ln, i) {
            drawText(ln, x, yy - i * lineH, size, bold, color);
          });
          return lines.length * lineH;
        }

        var items = [];
        function push(h, drawFn) {
          items.push({ h: h, draw: drawFn });
        }
        function gap(px) {
          push(px || 14, function () {});
        }
        function sectionHead(title) {
          gap(18);
          push(34, function (y) {
            page.drawRectangle({
              x: margin,
              y: y - 28,
              width: contentW,
              height: 30,
              color: navy,
            });
            page.drawRectangle({
              x: margin,
              y: y - 28,
              width: 5,
              height: 30,
              color: gold,
            });
            drawText(title, margin + 14, y - 17, 12, true, white, contentW - 24);
          });
          gap(10);
        }
        function kvRow(lab, val, o) {
          o = o || {};
          var h = o.big ? 40 : 30;
          push(h, function (y) {
            if (o.bg) {
              page.drawRectangle({
                x: margin,
                y: y - h + 4,
                width: contentW,
                height: h - 4,
                color: o.bg,
              });
            }
            drawText(
              lab,
              margin + (o.bg ? 12 : 4),
              y - (o.big ? 14 : 10),
              o.big ? 13 : 11,
              !!o.boldLab,
              o.labColor || muted,
              contentW - 140
            );
            drawRight(
              val,
              W - margin - (o.bg ? 12 : 4),
              y - (o.big ? 14 : 10),
              o.big ? 16 : 13,
              true,
              o.valColor || ink
            );
          });
        }
        function noteLine(t, color) {
          var lines = wrapLines(t, 10, false, contentW - 12);
          var h = 8 + lines.length * 13;
          push(h, function (y) {
            lines.forEach(function (ln, i) {
              drawText(ln, margin + 6, y - 4 - i * 13, 10, false, color || muted, contentW - 12);
            });
          });
        }
        function lineItem(title, amount, sub, idx, accent, signed) {
          var titleW = contentW - 120;
          var titleLines = wrapLines(title, 11, true, titleW);
          var subH = sub ? measureWrap(sub, 9, false, contentW - 20, 11) : 0;
          var h = 14 + titleLines.length * 14 + subH + 10;
          var absAmt = Math.abs(Number(amount) || 0);
          var amtStr = pdfMoney(absAmt);
          if (signed === "+") amtStr = "+" + amtStr;
          if (signed === "-") amtStr = "-" + amtStr;
          push(h, function (y) {
            if (idx % 2 === 0) {
              page.drawRectangle({
                x: margin,
                y: y - h + 4,
                width: contentW,
                height: h - 4,
                color: zebra,
              });
            }
            if (accent) {
              page.drawRectangle({
                x: margin,
                y: y - h + 4,
                width: 4,
                height: h - 4,
                color: accent,
              });
            }
            var x0 = margin + (accent ? 12 : 10);
            var ty = y - 6;
            titleLines.forEach(function (ln, i) {
              drawText(ln, x0, ty - i * 14, 11, true, ink, titleW);
            });
            drawRight(amtStr, W - margin - 10, ty, 12, true, accent || ink);
            if (sub) {
              drawWrap(sub, x0, ty - titleLines.length * 14 - 2, 9, false, muted, contentW - 20, 11);
            }
          });
        }

        /* —— Header —— */
        push(50, function (y) {
          page.drawRectangle({ x: 0, y: y - 40, width: W, height: 50, color: navy });
          page.drawRectangle({ x: 0, y: y - 43, width: W, height: 3, color: gold });
          drawText("M/Y LIMITLESS", margin, y - 15, 10, true, white);
          drawText("For owner", W - margin - 58, y - 15, 9, false, goldSoft);
          drawText("On-board cash", margin, y - 33, 15, true, gold);
        });
        gap(10);
        push(44, function (y) {
          page.drawRectangle({
            x: margin,
            y: y - 38,
            width: contentW,
            height: 40,
            color: goldSoft,
          });
          drawText(periodLab || "Month", margin + 12, y - 14, 15, true, navy);
          drawText(
            "Cash on board + cash still to collect. No charter P&L or commissions earned.",
            margin + 12,
            y - 32,
            9,
            false,
            muted,
            contentW - 24
          );
        });
        gap(14);

        /* —— At a glance —— */
        sectionHead("AT A GLANCE");
        kvRow("Opening", pdfMoney(start), {
          big: true,
          boldLab: true,
          bg: slateBg,
          labColor: slateInk,
          valColor: slateInk,
        });
        gap(4);
        kvRow("Cash in (received)", pdfMoney(cashIn), {
          big: true,
          boldLab: true,
          bg: greenBg,
          labColor: greenInk,
          valColor: greenInk,
        });
        gap(4);
        kvRow("Cash out", pdfMoney(cashOut), {
          big: true,
          boldLab: true,
          bg: slateBg,
          labColor: slateInk,
          valColor: slateInk,
        });
        gap(4);
        kvRow("On board now", pdfMoney(onBoard), {
          big: true,
          boldLab: true,
          bg: onBoard > 0.009 ? greenBg : amberBg,
          labColor: onBoard > 0.009 ? greenInk : amberInk,
          valColor: onBoard > 0.009 ? greenInk : amberInk,
        });
        gap(6);
        kvRow("Pending cash (due now)", pdfMoney(pendTot), {
          big: true,
          boldLab: true,
          bg: pendTot > 0.009 ? amberBg : slateBg,
          labColor: pendTot > 0.009 ? amberInk : slateInk,
          valColor: pendTot > 0.009 ? amberInk : slateInk,
        });
        if (pendTot > 0.009 && (pendBoat > 0.009 || pendOwner > 0.009)) {
          gap(2);
          noteLine(
            (pendBoat > 0.009 ? "Boat " + pdfMoney(pendBoat) : "") +
              (pendBoat > 0.009 && pendOwner > 0.009 ? "  ·  " : "") +
              (pendOwner > 0.009 ? "Owner pocket " + pdfMoney(pendOwner) : ""),
            muted
          );
        }
        gap(4);
        kvRow("Projected cash (upcoming)", pdfMoney(projTot), {
          big: true,
          boldLab: true,
          bg: projTot > 0.009 ? greenBg : slateBg,
          labColor: projTot > 0.009 ? greenInk : slateInk,
          valColor: projTot > 0.009 ? greenInk : slateInk,
        });
        if (projTot > 0.009 && (projBoat > 0.009 || projOwner > 0.009)) {
          gap(2);
          noteLine(
            (projBoat > 0.009 ? "Boat " + pdfMoney(projBoat) : "") +
              (projBoat > 0.009 && projOwner > 0.009 ? "  ·  " : "") +
              (projOwner > 0.009 ? "Owner pocket " + pdfMoney(projOwner) : ""),
            muted
          );
        }
        gap(6);
        kvRow("Expected on boat (after collect)", pdfMoney(expectBoat), {
          big: true,
          boldLab: true,
          bg: expectBoat > 0.009 ? greenBg : amberBg,
          labColor: expectBoat > 0.009 ? greenInk : amberInk,
          valColor: expectBoat > 0.009 ? greenInk : amberInk,
        });
        gap(2);
        noteLine(
          "On board now + pending to boat + projected to boat. Owner-pocket cash is listed but not added here.",
          muted
        );
        if (boatShort > 0.009) {
          gap(8);
          kvRow("Books short", pdfMoney(boatShort), {
            big: true,
            boldLab: true,
            bg: redBg,
            labColor: redInk,
            valColor: redInk,
          });
          gap(4);
          noteLine(
            "Marked cash-outs exceeded cash on hand this month. Short carries until covered.",
            redInk
          );
        }

        /* —— Cash in lines —— */
        sectionHead("CASH IN");
        var inRows = (report.cashIns || []).slice().sort(function (a, b) {
          return String((a && a.date) || "").localeCompare(String((b && b.date) || ""));
        });
        if (inRows.length) {
          inRows.forEach(function (r, idx) {
            if (!r || !(Number(r.amount) > 0.009)) return;
            var when = r.date ? fmtDate(r.date) : "Date not recorded";
            var lab = String(r.label || "Cash in").replace(/\s+/g, " ").trim();
            lineItem(when + "  ·  " + lab, r.amount, "", idx, greenInk, "+");
          });
          gap(6);
          kvRow("Total cash in", pdfMoney(cashIn), {
            boldLab: true,
            bg: greenBg,
            labColor: greenInk,
            valColor: greenInk,
          });
        } else {
          noteLine("No cash came onto the boat this month.", muted);
        }

        /* —— Cash out lines —— */
        sectionHead("CASH OUT");
        var outRows = (report.cashOutLines || []).slice();
        /* Full DTO drops virtual prior-short rows; still part of cashOut total */
        var priorSettled = Math.max(0, Number(report.priorSettled) || 0);
        if (priorSettled > 0.009) {
          var hasPrior = outRows.some(function (r) {
            return r && (r.kind === "prior-short" || r.virtual);
          });
          if (!hasPrior) {
            outRows.unshift({
              kind: "prior-short",
              virtual: true,
              label: "Brought forward · boat short",
              purposeLabel: "Prior short paid from this month's cash first",
              amount: priorSettled,
              date: "",
            });
          }
        }
        outRows.sort(function (a, b) {
          var da = String((a && (a.date || a.charterDate)) || "");
          var db = String((b && (b.date || b.charterDate)) || "");
          if (da !== db) return da.localeCompare(db);
          return String((a && a.label) || "").localeCompare(String((b && b.label) || ""));
        });
        if (outRows.length) {
          outRows.forEach(function (r, idx) {
            if (!r || !(Number(r.amount) > 0.009)) return;
            var when =
              r.date || r.charterDate
                ? fmtDate(r.date || r.charterDate)
                : r.virtual
                  ? "Brought forward"
                  : "Date not recorded";
            var lab = String(r.label || r.purposeLabel || "Cash out")
              .replace(/\s+/g, " ")
              .trim();
            var sub = "";
            if (r.purposeLabel && r.purposeLabel !== lab) sub = String(r.purposeLabel);
            else if (r.detail) sub = String(r.detail).slice(0, 90);
            lineItem(when + "  ·  " + lab, r.amount, sub, idx, slateInk, "-");
          });
          gap(6);
          kvRow("Total cash out", pdfMoney(cashOut), {
            boldLab: true,
            bg: slateBg,
            labColor: slateInk,
            valColor: slateInk,
          });
        } else {
          noteLine("Nothing left the boat envelope this month.", muted);
        }

        /* —— Pending cash (sailed / today, not yet received) —— */
        sectionHead("PENDING CASH");
        noteLine(
          "Confirmed charters already sailed (or today) where free cash / cash deal is still marked not received — e.g. guest or stew still holding notes.",
          muted
        );
        gap(8);
        var pendItems = Array.isArray(pend.items) ? pend.items : [];
        if (pendItems.length) {
          pendItems.forEach(function (r, idx) {
            if (!r || !(Number(r.cash) > 0.009)) return;
            var when = r.start ? fmtDate(r.start) : "Date not recorded";
            var destLab = r.dest === "owner" ? "owner pocket" : "boat";
            var kindLab = r.kind === "cash" ? "Cash deal" : "Split free cash";
            lineItem(
              when + "  ·  " + String(r.name || "Guest"),
              r.cash,
              kindLab + " · not received yet · → " + destLab,
              idx,
              amberInk,
              "+"
            );
          });
          gap(6);
          kvRow("Total pending", pdfMoney(pendTot), {
            boldLab: true,
            bg: amberBg,
            labColor: amberInk,
            valColor: amberInk,
          });
        } else {
          noteLine("Nothing pending — all sailed cash deals are marked received.", muted);
        }

        /* —— Projected cash (upcoming confirmed) —— */
        sectionHead("PROJECTED CASH");
        noteLine(
          "Confirmed upcoming charters with free cash or a cash-only fee still to collect (e.g. Friday split deal).",
          muted
        );
        gap(8);
        var projItems = Array.isArray(proj.items) ? proj.items : [];
        if (projItems.length) {
          projItems.forEach(function (r, idx) {
            if (!r || !(Number(r.cash) > 0.009)) return;
            var when = r.start ? fmtDate(r.start) : "Date not recorded";
            var destLab = r.dest === "owner" ? "owner pocket" : "boat";
            var kindLab = r.kind === "cash" ? "Cash deal" : "Split free cash";
            lineItem(
              when + "  ·  " + String(r.name || "Guest"),
              r.cash,
              kindLab + " · upcoming · → " + destLab,
              idx,
              greenInk,
              "+"
            );
          });
          gap(6);
          kvRow("Total projected", pdfMoney(projTot), {
            boldLab: true,
            bg: greenBg,
            labColor: greenInk,
            valColor: greenInk,
          });
        } else {
          noteLine("No upcoming confirmed cash still to collect.", muted);
        }

        gap(16);
        noteLine(
          "Opening + cash in - cash out = on board now. Pending / projected are still to collect (not in the envelope yet).",
          muted
        );

        var totalH = 28;
        items.forEach(function (it) {
          totalH += it.h;
        });
        totalH += 28;
        var H = Math.min(Math.max(Math.ceil(totalH), 520), 20000);
        page = doc.addPage([W, H]);
        var y = H - 18;
        items.forEach(function (it) {
          it.draw(y);
          y -= it.h;
        });
        return doc.save().then(function (bytes) {
          return new Blob([bytes], { type: "application/pdf" });
        });
      });
    });
  }

  return {
    build: build,
    fileName: fileName,
    pdfMoney: pdfMoney,
    safeText: safeText,
  };
});
