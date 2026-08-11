/**
 * LY_PDF.expensesCash — build cash expense PDF from a report DTO.
 *
 * Paint only. No money formulas. DTO from LY_CONTROLLERS.cashReport.monthReport.
 * Layout: open, scannable — snapshot first, outstanding next, detail later.
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
        /* Wide page + airy gaps — owner-scannable, not cramped */
        var W = 500;
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
        var B = report.outBuckets || {};
        var cashIn = report.cashInTotal || 0;
        var cashOut = report.cashOut || 0;
        var onBoard = report.pettyOnboard || 0;
        var start = report.pettyStart || 0;
        var crew = report.crew || {};
        var PS = report.pocketStory || null;
        var boatShort = Math.max(0, Number(report.cashShort) || 0);
        var pocketOpen = PS && PS.closingOpen != null ? Number(PS.closingOpen) : 0;
        var commOpen = Math.max(0, Number(report.commissionOpen) || 0);
        var hasOutstanding = boatShort > 0.009 || pocketOpen > 0.009 || commOpen > 0.009;

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
          push(px || 16, function () {});
        }
        /** Clear full-width section band — easy to spot when scanning. */
        function sectionHead(title) {
          gap(22);
          push(36, function (y) {
            page.drawRectangle({
              x: margin,
              y: y - 30,
              width: contentW,
              height: 32,
              color: navy,
            });
            page.drawRectangle({
              x: margin,
              y: y - 30,
              width: 5,
              height: 32,
              color: gold,
            });
            drawText(title, margin + 16, y - 18, 13, true, white, contentW - 28);
          });
          gap(12);
        }
        function kvRow(lab, val, o) {
          o = o || {};
          var h = o.big ? 38 : 30;
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
              y - (o.big ? 12 : 10),
              o.big ? 12 : 11,
              !!o.boldLab,
              o.labColor || muted,
              contentW - 140
            );
            drawRight(
              val,
              W - margin - (o.bg ? 12 : 4),
              y - (o.big ? 12 : 10),
              o.big ? 15 : 13,
              true,
              o.valColor || ink
            );
          });
        }
        function noteLine(t, color) {
          var lines = wrapLines(t, 10, false, contentW - 12);
          var h = 10 + lines.length * 13;
          push(h, function (y) {
            lines.forEach(function (ln, i) {
              drawText(ln, margin + 6, y - 4 - i * 13, 10, false, color || muted, contentW - 12);
            });
          });
        }
        function lineItem(title, amount, sub, idx, accent) {
          var titleW = contentW - 120;
          var titleLines = wrapLines(title, 11, true, titleW);
          var subH = sub ? measureWrap(sub, 10, false, contentW - 20, 12) : 0;
          var h = 16 + titleLines.length * 14 + subH + 12;
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
            drawRight(pdfMoney(amount), W - margin - 10, ty, 13, true, ink);
            if (sub) {
              drawWrap(sub, x0, ty - titleLines.length * 14 - 2, 10, false, muted, contentW - 20, 12);
            }
          });
        }

        /* One period label only — never "generated today" (confuses the owner). */
        var periodLab = report.monthLabel || report.month || "";
        /* Outstanding split (model DTO only) */
        var shorts = report.shortLines || [];
        var crewShortAmt = 0;
        var otherShortAmt = 0;
        shorts.forEach(function (s) {
          var a = Number(s.amount) || 0;
          if (s.kind === "crew" || s.kind === "daypay") crewShortAmt += a;
          else otherShortAmt += a;
        });
        crewShortAmt = Math.round(crewShortAmt * 100) / 100;
        otherShortAmt = Math.round(otherShortAmt * 100) / 100;
        var outSum =
          Math.round((boatShort + Math.max(0, pocketOpen) + commOpen) * 100) / 100;
        /*
         * Captain-sourced business = cumulative completed charters only
         * (through asOf day). Never month-only (misses prior paid work) and
         * never unstarted future charters still inside the report month.
         */
        var asOfYmd = String(report.bizAsOfYmd || "").slice(0, 10);
        var bizN = Number(report.bizThroughN) || 0;
        var bizGross = Number(report.bizThroughGross) || 0;
        var bizBase = Number(report.bizThroughBase) || 0;
        var bizComm = Number(
          report.commissionEarned != null ? report.commissionEarned : report.bizThroughComm
        ) || 0;
        var commStatus = String(report.commissionStatus || "").toLowerCase();
        if (!commStatus) {
          if (!(bizComm > 0.009) && !(commOpen > 0.009) && !(report.commissionPaidAll > 0.009))
            commStatus = "none";
          else if (commOpen < 0.01) commStatus = "paid";
          else if ((report.commissionPaidAll || 0) > 0.009) commStatus = "partial";
          else commStatus = "outstanding";
        }
        var commStatusLabel =
          commStatus === "paid"
            ? "Fully paid"
            : commStatus === "partial"
              ? "Partly paid"
              : commStatus === "outstanding"
                ? "Unpaid"
                : "None";
        var hasCommStory =
          bizComm > 0.009 ||
          (report.commissionPaidThisMonth || 0) > 0.009 ||
          commOpen > 0.009 ||
          (report.commissionPaidAll || 0) > 0.009 ||
          bizN > 0;

        /* —— Header —— */
        push(52, function (y) {
          page.drawRectangle({ x: 0, y: y - 42, width: W, height: 52, color: navy });
          page.drawRectangle({ x: 0, y: y - 45, width: W, height: 3, color: gold });
          drawText("M/Y LIMITLESS", margin, y - 16, 10, true, white);
          drawText("Cash only", W - margin - 56, y - 16, 9, false, goldSoft);
          drawText("Month cash report", margin, y - 34, 16, true, gold);
        });
        gap(10);
        /* Period banner — owner must see THIS is the month, closed at month end */
        push(48, function (y) {
          page.drawRectangle({
            x: margin,
            y: y - 42,
            width: contentW,
            height: 44,
            color: goldSoft,
          });
          drawText(periodLab, margin + 12, y - 16, 16, true, navy);
          drawText(
            "Position at the END of this month  ·  not a live balance today",
            margin + 12,
            y - 34,
            10,
            false,
            muted,
            contentW - 24
          );
        });
        gap(14);

        /* —— 1) PETTY CASH snapshot —— */
        sectionHead("1 · PETTY CASH");
        noteLine("Boat envelope cash for " + periodLab + " only.", muted);
        gap(8);
        kvRow("Cash in", pdfMoney(cashIn), {
          big: true,
          boldLab: true,
          bg: greenBg,
          labColor: greenInk,
          valColor: greenInk,
        });
        gap(6);
        kvRow("Cash out", pdfMoney(cashOut), {
          big: true,
          boldLab: true,
          bg: slateBg,
          labColor: slateInk,
          valColor: slateInk,
        });
        gap(6);
        kvRow("On board at month end", pdfMoney(onBoard), {
          big: true,
          boldLab: true,
          bg: onBoard > 0.009 ? greenBg : amberBg,
          labColor: onBoard > 0.009 ? greenInk : amberInk,
          valColor: onBoard > 0.009 ? greenInk : amberInk,
        });

        /* —— 2) PETTY SHORT — who & why (not mixed with commission) —— */
        if (boatShort > 0.009) {
          sectionHead("2 · PETTY CASH SHORT");
          noteLine(
            "At the end of " +
              periodLab +
              " the envelope was short. Cash in did not cover every line marked from petty. Not paid later in this report — that is next month.",
            muted
          );
          gap(10);
          kvRow("Short at month end", pdfMoney(boatShort), {
            big: true,
            bg: redBg,
            labColor: redInk,
            valColor: redInk,
            boldLab: true,
          });
          gap(8);
          noteLine("Who / why:", navy);
          gap(6);
          shorts.forEach(function (s, idx) {
            var subBits = [];
            if (s.date) subBits.push(fmtDate(s.date));
            if (s.kind === "crew" || s.kind === "daypay") {
              if (s.fullAmount > 0.009 && Math.abs((s.fullAmount || 0) - (s.amount || 0)) > 0.009) {
                subBits.push(
                  "day rate " +
                    pdfMoney(s.fullAmount) +
                    "  ·  petty covered " +
                    pdfMoney(s.covered || 0)
                );
              } else {
                subBits.push("crew day pay not covered by petty");
              }
            } else {
              subBits.push("not covered by petty");
            }
            lineItem(s.label || "Petty line", s.amount, subBits.join(" · "), idx, redInk);
          });
          gap(8);
          noteLine("Carries into the next month until cash covers the hole.", redInk);
        }

        /* —— 3) CAPTAIN-SOURCED BUSINESS — completed only, then settlement status —— */
        if (hasCommStory) {
          sectionHead("3 · CAPTAIN-SOURCED BUSINESS");
          noteLine(
            "Only charters that have already taken place up until " +
              (asOfYmd ? fmtDate(asOfYmd) : "this date") +
              ". Confirmed future charters are excluded until they run — figures reflect money-generating activity that has happened, not the forward book. Commission = 15% of the amount BEFORE VAT.",
            muted
          );
          gap(12);
          noteLine("Business completed to date:", navy);
          gap(8);
          if (bizN > 0) {
            kvRow("Charters completed to date", String(bizN), {
              big: true,
              boldLab: true,
              bg: slateBg,
              labColor: slateInk,
              valColor: slateInk,
            });
            gap(6);
          }
          kvRow("Total gross (client prices)", pdfMoney(bizGross), {
            big: true,
            boldLab: true,
            bg: greenBg,
            labColor: greenInk,
            valColor: greenInk,
          });
          gap(6);
          kvRow("Amount before VAT", pdfMoney(bizBase), {
            big: true,
            boldLab: true,
            bg: slateBg,
            labColor: slateInk,
            valColor: slateInk,
          });
          gap(10);
          noteLine(
            "Commission on that completed business = 15% of the amount before VAT.",
            navy
          );
          gap(8);
          kvRow("Commission earned (15% before VAT)", pdfMoney(bizComm), {
            big: true,
            boldLab: true,
            bg: goldSoft,
            labColor: navy,
            valColor: navy,
          });
          gap(10);
          if (bizGross > 0.009 && bizComm > 0.009) {
            noteLine(
              "Read it this way: completed captain-sourced charters brought in about " +
                pdfMoney(bizGross) +
                " gross. Commission on that work is " +
                pdfMoney(bizComm) +
                " (15% before VAT).",
              muted
            );
            gap(10);
          }
          /* Settlement status: paid / partly paid / unpaid */
          var paidAll = Number(report.commissionPaidAll) || 0;
          var payoutRows = Array.isArray(report.commissionPayouts)
            ? report.commissionPayouts.slice()
            : [];
          payoutRows.sort(function (a, b) {
            return String((a && a.date) || "").localeCompare(String((b && b.date) || ""));
          });
          var statusBg =
            commStatus === "paid" ? greenBg : commStatus === "partial" ? amberBg : redBg;
          var statusInk =
            commStatus === "paid" ? greenInk : commStatus === "partial" ? amberInk : redInk;
          kvRow("Settlement status", commStatusLabel, {
            big: true,
            boldLab: true,
            bg: statusBg,
            labColor: statusInk,
            valColor: statusInk,
          });
          gap(10);
          noteLine("Payments from petty cash (with date):", navy);
          gap(8);
          if (payoutRows.length) {
            payoutRows.forEach(function (p, idx) {
              var when = p.date ? fmtDate(p.date) : "Date not recorded";
              var lab = "Paid " + when;
              lineItem(lab, p.amount || 0, "Commission paid from boat petty cash", idx, greenInk);
            });
            gap(10);
          } else if (paidAll > 0.009) {
            noteLine(
              "Total paid is on the ledger, but individual payment dates were not found.",
              muted
            );
            gap(8);
          } else {
            noteLine("No commission payments from petty cash yet.", muted);
            gap(8);
          }
          kvRow("Total paid to date", pdfMoney(paidAll), {
            boldLab: true,
            bg: paidAll > 0.009 ? greenBg : undefined,
            labColor: paidAll > 0.009 ? greenInk : undefined,
            valColor: paidAll > 0.009 ? greenInk : undefined,
          });
          gap(8);
          kvRow("Still outstanding", pdfMoney(commOpen), {
            big: true,
            bg: commOpen > 0.009 ? amberBg : greenBg,
            labColor: commOpen > 0.009 ? amberInk : greenInk,
            valColor: commOpen > 0.009 ? amberInk : greenInk,
            boldLab: true,
          });
          if (commOpen > 0.009) {
            gap(6);
            if (paidAll > 0.009) {
              noteLine(
                "Partly settled: commission earned on completed business is " +
                  pdfMoney(bizComm) +
                  "; " +
                  pdfMoney(paidAll) +
                  " has already been paid from petty. Balance " +
                  pdfMoney(commOpen) +
                  " remains unpaid.",
                amberInk
              );
            } else {
              noteLine(
                "Unpaid: commission earned on the completed business above has not yet been paid from petty.",
                amberInk
              );
            }
          } else if (paidAll > 0.009 && bizComm > 0.009) {
            gap(6);
            noteLine(
              "Fully paid: commission on completed business to date has been settled from petty.",
              greenInk
            );
          }
        }

        /* —— 4) CAPTAIN OUT OF POCKET —— */
        if (
          pocketOpen > 0.009 ||
          (PS &&
            ((PS.monthSpend || 0) > 0.009 ||
              (PS.monthRepay || 0) > 0.009 ||
              (PS.broughtForward || 0) > 0.009 ||
              (PS.openLines || []).length))
        ) {
          sectionHead("4 · CAPTAIN OUT OF POCKET");
          noteLine(
            "Money the captain put in from own pocket (crew / shops). Separate from captain-sourced business. A repay only covers spends on or before that repay date.",
            muted
          );
          gap(10);
          if (PS) {
            function pocketLineTitle(r) {
              var when = r.date ? fmtDate(r.date) : "Date not recorded";
              var who = r.vendor || (r.isStew ? "Crew" : "Spend");
              return when + " · " + who;
            }
            function pocketLineSub(r, mode) {
              var bits = [];
              if (r.isStew) bits.push(r.isLongDay ? "Long day rate" : "Day rate");
              else if (r.description) bits.push(String(r.description).slice(0, 52));
              if (r.charterDate) bits.push("charter " + fmtDate(r.charterDate));
              if (mode === "prior") bits.push("open from before " + periodLab);
              if (mode === "open") bits.push("own money — not repaid from petty yet");
              if (mode === "fronted") bits.push("fronted from own money");
              if (mode === "repaid") bits.push("repaid from boat petty cash");
              return bits.join(" · ");
            }

            /* Prior balance with concrete spend dates */
            if ((PS.broughtForward || 0) > 0.009) {
              kvRow("Open from before " + periodLab, pdfMoney(PS.broughtForward), {
                big: true,
                bg: amberBg,
                labColor: amberInk,
                valColor: amberInk,
                boldLab: true,
              });
              gap(8);
              noteLine("Brought forward (with date):", navy);
              gap(6);
              var priorOpenRows = (PS.priorLines || []).filter(function (r) {
                return (r.remainOpenAtMonthStart != null ? r.remainOpenAtMonthStart : r.amount) > 0.009;
              });
              if (!priorOpenRows.length) priorOpenRows = PS.priorLines || [];
              priorOpenRows.forEach(function (r, idx) {
                var amt =
                  r.remainOpenAtMonthStart != null ? r.remainOpenAtMonthStart : r.amount;
                lineItem(pocketLineTitle(r), amt, pocketLineSub(r, "prior"), idx, amberInk);
              });
              gap(12);
            }

            /* Fronted this period — each spend dated */
            if ((PS.monthSpend || 0) > 0.009 || (PS.monthLines || []).length) {
              kvRow("Fronted in " + periodLab, pdfMoney(PS.monthSpend || 0), {
                big: true,
                boldLab: true,
              });
              gap(8);
              noteLine("Fronted from own money (with date):", navy);
              gap(6);
              (PS.monthLines || []).forEach(function (r, idx) {
                lineItem(pocketLineTitle(r), r.amount, pocketLineSub(r, "fronted"), idx, amberInk);
              });
              gap(12);
            }

            /* Repayments — concrete dates from ledger */
            if ((PS.monthRepay || 0) > 0.009 || (PS.monthRepayLines || []).length) {
              kvRow("Repaid from petty in " + periodLab, pdfMoney(PS.monthRepay || 0), {
                big: true,
                bg: greenBg,
                labColor: greenInk,
                valColor: greenInk,
                boldLab: true,
              });
              gap(8);
              noteLine("Repayments from petty cash (with date):", navy);
              gap(6);
              var repayRows = (PS.monthRepayLines || []).slice().sort(function (a, b) {
                return String((a && a.date) || "").localeCompare(String((b && b.date) || ""));
              });
              if (repayRows.length) {
                repayRows.forEach(function (r, idx) {
                  var when = r.date ? fmtDate(r.date) : "Date not recorded";
                  lineItem(
                    "Repaid " + when,
                    r.amount,
                    pocketLineSub(r, "repaid") || "Repaid from boat petty cash",
                    idx,
                    greenInk
                  );
                });
              } else {
                noteLine(
                  "Total repaid is on the ledger, but individual repayment dates were not found.",
                  muted
                );
              }
              gap(12);
            }

            kvRow("Still open up until this date", pdfMoney(PS.closingOpen || 0), {
              big: true,
              bg: (PS.closingOpen || 0) > 0.009 ? amberBg : greenBg,
              labColor: (PS.closingOpen || 0) > 0.009 ? amberInk : greenInk,
              valColor: (PS.closingOpen || 0) > 0.009 ? amberInk : greenInk,
              boldLab: true,
            });
            var openPocket = PS.openLines || [];
            if (openPocket.length) {
              gap(10);
              noteLine("Still open (with date):", navy);
              gap(6);
              openPocket.forEach(function (r, idx) {
                lineItem(
                  pocketLineTitle(r),
                  r.remainOpen != null ? r.remainOpen : r.amount,
                  pocketLineSub(r, "open"),
                  idx,
                  amberInk
                );
              });
            } else if ((PS.closingOpen || 0) > 0.009) {
              gap(6);
              noteLine(
                "Not fully repaid from petty by the end of " + periodLab + ".",
                amberInk
              );
            } else if ((PS.monthRepay || 0) > 0.009) {
              gap(6);
              noteLine("Pocket cleared up until this date.", greenInk);
            }
          }
        }

        /* —— Detail sections —— */
        sectionHead("5 · PETTY CASH DETAIL");
        kvRow("Start", pdfMoney(start));
        gap(6);
        kvRow("Cash in", pdfMoney(cashIn));
        gap(6);
        kvRow("Cash out", pdfMoney(cashOut));
        if ((report.priorSettled || 0) > 0.009) {
          gap(6);
          kvRow("Prior short taken from cash-in", pdfMoney(report.priorSettled));
        }
        gap(10);
        kvRow("On board at month end", pdfMoney(onBoard), {
          big: true,
          bg: onBoard > 0.009 ? greenBg : amberBg,
          labColor: onBoard > 0.009 ? greenInk : amberInk,
          valColor: onBoard > 0.009 ? greenInk : amberInk,
          boldLab: true,
        });

        if ((report.cashIns || []).length) {
          gap(14);
          noteLine("Cash in lines", navy);
          gap(6);
          (report.cashIns || []).forEach(function (r, idx) {
            lineItem(r.label || "Cash in", r.amount, r.date ? fmtDate(r.date) : "", idx, greenInk);
          });
        }

        /* Cash out buckets only if something left pot */
        var bucketRows = [
          { lab: "Crew day rates", val: B.crewDayPay || 0 },
          {
            lab: "Commission paid on business generated",
            val: B.commission || 0,
          },
          { lab: "Reimbursement of captain out-of-pocket", val: B.reimburseCaptain || 0 },
          { lab: "Reimbursement of crew out-of-pocket", val: B.reimburseCrew || 0 },
          { lab: "Tip payouts", val: B.tipPayout || 0 },
          { lab: "Other", val: B.otherPetty || 0 },
        ].filter(function (r) {
          return r.val > 0.009;
        });
        if (bucketRows.length) {
          sectionHead("6 · WHERE THE CASH WENT");
          noteLine(
            "Cash that left the boat envelope this month. Commission paid is settlement of amounts earned on captain-sourced business (see section 3).",
            muted
          );
          gap(10);
          bucketRows.forEach(function (r, i) {
            if (i) gap(8);
            kvRow(r.lab, pdfMoney(r.val), { boldLab: true });
          });
        }

        /* Crew — petty first; covered cash ≠ marked floatPay when short */
        var potCrewCovered =
          report.crewFromPotCovered != null
            ? report.crewFromPotCovered
            : crew.fromBoatPotCovered != null
              ? crew.fromBoatPotCovered
              : B.crewDayPay || 0;
        var potCrewMarked =
          report.crewFromPotMarked != null
            ? report.crewFromPotMarked
            : crew.fromBoatPotMarked != null
              ? crew.fromBoatPotMarked
              : crew.fromBoatPot != null
                ? crew.fromBoatPot
                : potCrewCovered;
        var potCrewShort =
          report.crewFromPotShort != null
            ? report.crewFromPotShort
            : crew.fromBoatPotShort || 0;
        var potCrew = potCrewCovered;
        var capCrew = crew.fromCaptain || 0;
        var ownerCrew = crew.fromOwner || 0;
        /* booksOnly (Paid, no floatPay) pre-dates Owner money — never show on PDF. */
        if (
          potCrewCovered > 0.009 ||
          potCrewMarked > 0.009 ||
          potCrewShort > 0.009 ||
          capCrew > 0.009 ||
          ownerCrew > 0.009
        ) {
          sectionHead("7 · CREW");
          function crewOwnerLine(r, idx, accent) {
            /* Model ownerTitle/ownerDetail: overnight / long day / day + guest + dates */
            var title = r.ownerTitle || r.vendor || "Crew";
            var detail = r.ownerDetail || "";
            if (!detail) {
              var bits = [];
              if (r.tierLabel) bits.push(r.tierLabel);
              if (r.guest) bits.push(r.guest);
              if (r.charterStart && r.charterEnd && r.charterEnd !== r.charterStart) {
                bits.push(fmtDate(r.charterStart) + " to " + fmtDate(r.charterEnd));
              } else if (r.date || r.charterStart) {
                bits.push(fmtDate(r.charterStart || r.date));
              }
              detail = bits.join(" · ");
            } else if (r.charterStart && r.charterEnd && r.charterEnd !== r.charterStart) {
              detail = detail
                .replace(
                  /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/,
                  function (_, a, b) {
                    return fmtDate(a) + " to " + fmtDate(b);
                  }
                )
                .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, function (m) {
                  return fmtDate(m);
                });
            } else {
              detail = detail.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, function (m) {
                return fmtDate(m);
              });
            }
            lineItem(title, r.amount, detail, idx, accent);
          }
          if (potCrewCovered > 0.009 || potCrewMarked > 0.009) {
            kvRow("Paid from petty cash", pdfMoney(potCrewCovered), {
              big: true,
              bg: greenBg,
              labColor: greenInk,
              valColor: greenInk,
              boldLab: true,
            });
            if (potCrewShort > 0.009) {
              gap(10);
              kvRow("Crew short (see section 2)", pdfMoney(potCrewShort), {
                big: true,
                bg: redBg,
                labColor: redInk,
                valColor: redInk,
                boldLab: true,
              });
            }
            gap(12);
            noteLine("From petty cash:", navy);
            gap(6);
            (crew.potLines || []).forEach(function (r, idx) {
              crewOwnerLine(r, idx, greenInk);
            });
          }
          if (capCrew > 0.009) {
            gap(16);
            kvRow("Paid by captain (own money)", pdfMoney(capCrew), {
              big: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
            gap(6);
            noteLine("Not boat cash — under captain pocket.", amberInk);
            gap(6);
            (crew.captainLines || []).forEach(function (r, idx) {
              crewOwnerLine(r, idx, amberInk);
            });
          }
          if (ownerCrew > 0.009) {
            gap(16);
            kvRow("Paid by owner", pdfMoney(ownerCrew), { big: true, boldLab: true });
            gap(6);
            (crew.ownerLines || []).forEach(function (r, idx) {
              crewOwnerLine(r, idx, muted);
            });
          }
        }

        gap(28);
        push(24, function (y) {
          drawText(
            "Cash only  ·  " + (periodLab || "month") + "  ·  Limitless",
            margin,
            y - 8,
            9,
            false,
            muted
          );
        });
        gap(16);

        var totalH = 28;
        items.forEach(function (it) {
          totalH += it.h;
        });
        totalH += 28;
        var H = Math.min(Math.max(Math.ceil(totalH), 600), 20000);
        page = doc.addPage([W, H]);
        var y = H - 20;
        items.forEach(function (it) {
          /* Never skip rows — page height is sized from totalH */
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
