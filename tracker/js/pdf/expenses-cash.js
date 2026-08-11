/**
 * LY_PDF.expensesCash — build cash expense PDF from a report DTO.
 *
 * Paint only. No money formulas. DTO comes from LY_CONTROLLERS.cashReport.monthReport
 * (models only for €).
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  root.LY_PDF = root.LY_PDF || {};
  root.LY_PDF.expensesCash = api;
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
    return "Limitless-cash-expenses-" + String(month || "").slice(0, 7) + ".pdf";
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
        var W = 390;
        var margin = 14;
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
        var page = null;
        var B = report.outBuckets || {};
        var cashIn = report.cashInTotal || 0;
        var cashOut = report.cashOut || 0;
        var onBoard = report.pettyOnboard || 0;
        var start = report.pettyStart || 0;
        var crew = report.crew || {};
        var PS = report.pocketStory || null;

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
          return wrapLines(t, size, bold, maxW).length * (lineH || size + 4);
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
          lineH = lineH || size + 4;
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
        function sectionHead(title) {
          push(20, function (y) {
            drawText(title, margin, y - 4, 10, true, navy);
            page.drawRectangle({ x: margin, y: y - 8, width: 28, height: 2, color: gold });
          });
        }
        function kvRow(lab, val, o) {
          o = o || {};
          var h = o.big ? 26 : 20;
          push(h, function (y) {
            if (o.bg) page.drawRectangle({ x: margin, y: y - h + 5, width: contentW, height: h - 1, color: o.bg });
            drawText(lab, margin + (o.bg ? 7 : 2), y - (o.big ? 5 : 2), o.big ? 11 : 10, !!o.boldLab, o.labColor || muted, contentW - 108);
            drawRight(val, W - margin - (o.bg ? 7 : 2), y - (o.big ? 5 : 2), o.big ? 12 : 11, true, o.valColor || ink);
          });
        }
        function lineItem(title, amount, sub, idx, accent) {
          var titleW = contentW - 92;
          var titleLines = wrapLines(title, 10, true, titleW);
          var subH = sub ? measureWrap(sub, 8, false, contentW - 12, 10) : 0;
          var h = 10 + titleLines.length * 12 + subH + 8;
          push(h, function (y) {
            if (idx % 2 === 0) page.drawRectangle({ x: margin, y: y - h + 5, width: contentW, height: h - 1, color: zebra });
            if (accent) page.drawRectangle({ x: margin, y: y - h + 5, width: 3, height: h - 1, color: accent });
            var x0 = margin + (accent ? 7 : 5);
            var ty = y - 3;
            titleLines.forEach(function (ln, i) {
              drawText(ln, x0, ty - i * 12, 10, true, ink, titleW);
            });
            drawRight(pdfMoney(amount), W - margin - 5, ty, 11, true, ink);
            if (sub) drawWrap(sub, x0, ty - titleLines.length * 12 - 1, 8, false, muted, contentW - 12, 10);
          });
        }

        var gen = "";
        try {
          gen = new Date(report.generatedAt).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
        } catch (eG) {
          gen = "";
        }

        /* Header */
        push(48, function (y) {
          page.drawRectangle({ x: 0, y: y - 38, width: W, height: 48, color: navy });
          page.drawRectangle({ x: 0, y: y - 41, width: W, height: 3, color: gold });
          drawText("M/Y LIMITLESS", margin, y - 14, 9, true, white);
          drawText("Cash only", W - margin - 48, y - 14, 8, false, goldSoft);
          drawText("Expense report", margin, y - 30, 14, true, gold);
        });
        push(28, function (y) {
          drawText(report.monthLabel || report.month, margin, y - 10, 12, true, navy);
          drawText(gen, margin, y - 22, 8, false, muted, contentW);
        });

        /* Totals — boat pot from model */
        sectionHead("TOTALS");
        kvRow("Start", pdfMoney(start));
        kvRow("Cash in", pdfMoney(cashIn));
        kvRow("Cash out", pdfMoney(cashOut));
        if ((report.priorSettled || 0) > 0.009) kvRow("Prior short settled", pdfMoney(report.priorSettled));
        kvRow("On board", pdfMoney(onBoard), { big: true, bg: greenBg, labColor: greenInk, valColor: greenInk, boldLab: true });
        if ((report.cashShort || 0) > 0.009) {
          kvRow("Books short", pdfMoney(report.cashShort), { bg: amberBg, labColor: amberInk, valColor: amberInk, boldLab: true });
        }

        sectionHead("CASH IN  ·  " + pdfMoney(cashIn));
        var ins = report.cashIns || [];
        if (!ins.length) {
          push(18, function (y) {
            drawText("None", margin + 4, y - 6, 10, false, muted);
          });
        } else {
          ins.forEach(function (r, idx) {
            lineItem(r.label || "Cash in", r.amount, r.date ? fmtDate(r.date) : "", idx, greenInk);
          });
        }

        sectionHead("CASH OUT  ·  " + pdfMoney(cashOut));
        [
          { lab: "Captain commission (from pot)", val: B.commission || 0 },
          { lab: "Crew day pay (boat pot)", val: B.crewDayPay || 0 },
          { lab: "Repay captain pocket", val: B.reimburseCaptain || 0 },
          { lab: "Repay crew pocket", val: B.reimburseCrew || 0 },
          { lab: "Tip payouts", val: B.tipPayout || 0 },
          { lab: "Other", val: B.otherPetty || 0 },
        ]
          .filter(function (r) {
            return r.val > 0.009;
          })
          .forEach(function (r) {
            kvRow(r.lab, pdfMoney(r.val));
          });

        /*
         * Crew — model buckets only. Section total = boat pot crew (matches cash-out).
         * Captain / books shown separately; never sum into a fake cash headline.
         */
        var potCrew = crew.fromBoatPot != null ? crew.fromBoatPot : B.crewDayPay || 0;
        var capCrew = crew.fromCaptain || 0;
        var booksCrew = crew.booksOnly || 0;
        var ownerCrew = crew.fromOwner || 0;
        if (potCrew > 0.009 || capCrew > 0.009 || booksCrew > 0.009 || ownerCrew > 0.009) {
          sectionHead("CREW DAY PAY  ·  BOAT POT  " + pdfMoney(potCrew));
          if (potCrew > 0.009) {
            kvRow("From boat pot (cash left envelope)", pdfMoney(potCrew), {
              boldLab: true,
              bg: greenBg,
              labColor: greenInk,
              valColor: greenInk,
            });
            (crew.potLines || report.crewLinesPot || []).forEach(function (r, idx) {
              var t = r.vendor || "Crew";
              if (r.description) t = t + " - " + r.description;
              lineItem(t, r.amount, [r.date ? fmtDate(r.date) : "", "Boat pot"].filter(Boolean).join(" · "), idx, greenInk);
            });
          }
          if (capCrew > 0.009) {
            kvRow("Paid by captain (own money) — not boat cash-out", pdfMoney(capCrew), {
              boldLab: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
            });
            (crew.captainLines || []).forEach(function (r, idx) {
              var t = r.vendor || "Crew";
              if (r.description) t = t + " - " + r.description;
              lineItem(t, r.amount, [r.date ? fmtDate(r.date) : "", "Captain pocket"].filter(Boolean).join(" · "), idx, amberInk);
            });
          }
          if (ownerCrew > 0.009) {
            kvRow("Paid by owner — not boat cash-out", pdfMoney(ownerCrew), { boldLab: true });
          }
          if (booksCrew > 0.009) {
            kvRow("On books only — not boat cash-out", pdfMoney(booksCrew), { boldLab: true });
            (crew.booksLines || []).forEach(function (r, idx) {
              var t = r.vendor || "Crew";
              if (r.description) t = t + " - " + r.description;
              lineItem(t, r.amount, [r.date ? fmtDate(r.date) : "", "Books only"].filter(Boolean).join(" · "), idx, muted);
            });
          }
        }

        sectionHead("CASH OUT DETAIL");
        var potLines = report.cashOutLines || [];
        if (!potLines.length) {
          push(18, function (y) {
            drawText("None", margin + 4, y - 6, 10, false, muted);
          });
        } else {
          potLines.forEach(function (r, idx) {
            var vend = r.label || r.vendor || "-";
            if (r.detail) vend = vend + " - " + r.detail;
            var bits = [];
            if (r.date) bits.push(fmtDate(r.date));
            if (r.purposeLabel) bits.push(r.purposeLabel);
            lineItem(vend, r.amount, bits.join(" · "), idx, r.kind === "commission" ? gold : null);
          });
        }

        /* Captain pocket last — model bridge as-of month end */
        sectionHead("CAPTAIN POCKET  ·  END OF MONTH");
        if (PS) {
          if ((PS.broughtForward || 0) > 0.009) {
            kvRow("Open from prior months (carried in)", pdfMoney(PS.broughtForward), {
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
          }
          kvRow("Fronted this month (captain cash)", pdfMoney(PS.monthSpend || 0), { boldLab: true });
          if ((PS.stewMonth || 0) > 0.009) kvRow("  of which stew day rates", pdfMoney(PS.stewMonth));
          if ((PS.shopMonth || 0) > 0.009) kvRow("  of which shops / other", pdfMoney(PS.shopMonth));
          kvRow("Repaid from boat pot this month", pdfMoney(PS.monthRepay || 0));
          if ((PS.monthRepay || 0) < 0.01 && (PS.closingOpen || 0) > 0.009) {
            push(16, function (y) {
              drawText(
                "No pot repay in this month — captain still out of pocket at month end.",
                margin + 2,
                y - 4,
                8,
                false,
                amberInk,
                contentW
              );
            });
          }
          kvRow(
            "Still open (end of " + (report.monthLabel || "month") + ")",
            pdfMoney(PS.closingOpen || 0),
            (PS.closingOpen || 0) > 0.009
              ? { big: true, bg: amberBg, labColor: amberInk, valColor: amberInk, boldLab: true }
              : { big: true, bg: greenBg, labColor: greenInk, valColor: greenInk, boldLab: true }
          );
          if ((PS.monthLines || []).length) {
            push(16, function (y) {
              drawText("Fronted this month", margin + 2, y - 2, 9, true, muted);
            });
            (PS.monthLines || []).forEach(function (p, idx) {
              var what = p.vendor || "Spend";
              if (p.description && p.description !== p.vendor) what = p.vendor + " - " + p.description;
              var tag = p.isLongDay ? "Stew long day" : p.isStew ? "Stew day rate" : "Shop";
              lineItem(what, p.amount, [p.date ? fmtDate(p.date) : "", tag].filter(Boolean).join(" · "), idx, amberInk);
            });
          }
        } else {
          push(18, function (y) {
            drawText("No pocket activity", margin + 4, y - 6, 10, false, muted);
          });
        }

        sectionHead("CAPTAIN COMMISSION  ·  END OF MONTH");
        if ((report.bizMonthGross || 0) > 0.009 || (report.bizMonthComm || 0) > 0.009) {
          kvRow("Business generated (gross) · this month", pdfMoney(report.bizMonthGross || 0), { boldLab: true });
          kvRow("Commission on that business · this month", pdfMoney(report.bizMonthComm || 0));
        }
        if ((report.bizThroughGross || 0) > 0.009) {
          kvRow("Business generated (gross) · through end of month", pdfMoney(report.bizThroughGross || 0));
          kvRow("Commission earned · through end of month", pdfMoney(report.commissionEarned || 0));
        }
        kvRow("Paid from boat this month", pdfMoney(report.commissionPaidThisMonth || 0), { boldLab: true });
        kvRow("Paid from boat · through end of month", pdfMoney(report.commissionPaidAll || 0));
        if ((report.commissionOpen || 0) > 0.009) {
          kvRow("Commission outstanding · end of month", pdfMoney(report.commissionOpen), {
            bg: amberBg,
            labColor: amberInk,
            valColor: amberInk,
            boldLab: true,
          });
        }

        var pocketOpenEnd = PS && PS.closingOpen != null ? PS.closingOpen : 0;
        if (pocketOpenEnd > 0.009 || (report.commissionOpen || 0) > 0.009 || (report.cashShort || 0) > 0.009) {
          sectionHead("OUTSTANDING · END OF MONTH");
          if (pocketOpenEnd > 0.009) {
            kvRow("Captain pocket (still out of pocket)", pdfMoney(pocketOpenEnd), {
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
          }
          if ((report.commissionOpen || 0) > 0.009) kvRow("Captain commission", pdfMoney(report.commissionOpen));
          if ((report.cashShort || 0) > 0.009) kvRow("Books short", pdfMoney(report.cashShort));
        }

        push(22, function (y) {
          drawText("Cash only · card excluded · as-of end of month · Limitless", margin, y - 8, 8, false, muted);
        });

        var totalH = 14;
        items.forEach(function (it) {
          totalH += it.h;
        });
        totalH += 14;
        var H = Math.min(Math.max(Math.ceil(totalH), 480), 14000);
        page = doc.addPage([W, H]);
        var y = H - 10;
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
