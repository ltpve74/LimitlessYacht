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
        /* Slightly wider + generous margins — less crammed */
        var W = 420;
        var margin = 22;
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
          push(px || 14, function () {});
        }
        function sectionHead(title) {
          gap(10);
          push(26, function (y) {
            drawText(title, margin, y - 6, 11, true, navy);
            page.drawRectangle({ x: margin, y: y - 12, width: 36, height: 2.5, color: gold });
          });
          gap(6);
        }
        function kvRow(lab, val, o) {
          o = o || {};
          var h = o.big ? 32 : 24;
          push(h, function (y) {
            if (o.bg) {
              page.drawRectangle({
                x: margin,
                y: y - h + 6,
                width: contentW,
                height: h - 2,
                color: o.bg,
              });
            }
            drawText(
              lab,
              margin + (o.bg ? 10 : 2),
              y - (o.big ? 8 : 5),
              o.big ? 12 : 11,
              !!o.boldLab,
              o.labColor || muted,
              contentW - 120
            );
            drawRight(
              val,
              W - margin - (o.bg ? 10 : 2),
              y - (o.big ? 8 : 5),
              o.big ? 14 : 12,
              true,
              o.valColor || ink
            );
          });
        }
        function noteLine(t, color) {
          var lines = wrapLines(t, 9, false, contentW - 8);
          var h = 8 + lines.length * 12;
          push(h, function (y) {
            lines.forEach(function (ln, i) {
              drawText(ln, margin + 4, y - 4 - i * 12, 9, false, color || muted, contentW - 8);
            });
          });
        }
        function lineItem(title, amount, sub, idx, accent) {
          var titleW = contentW - 100;
          var titleLines = wrapLines(title, 10, true, titleW);
          var subH = sub ? measureWrap(sub, 9, false, contentW - 16, 11) : 0;
          var h = 14 + titleLines.length * 13 + subH + 10;
          push(h, function (y) {
            if (idx % 2 === 0) {
              page.drawRectangle({
                x: margin,
                y: y - h + 6,
                width: contentW,
                height: h - 2,
                color: zebra,
              });
            }
            if (accent) {
              page.drawRectangle({
                x: margin,
                y: y - h + 6,
                width: 3,
                height: h - 2,
                color: accent,
              });
            }
            var x0 = margin + (accent ? 10 : 8);
            var ty = y - 4;
            titleLines.forEach(function (ln, i) {
              drawText(ln, x0, ty - i * 13, 10, true, ink, titleW);
            });
            drawRight(pdfMoney(amount), W - margin - 8, ty, 12, true, ink);
            if (sub) {
              drawWrap(sub, x0, ty - titleLines.length * 13 - 2, 9, false, muted, contentW - 16, 11);
            }
          });
        }

        var gen = "";
        try {
          gen = new Date(report.generatedAt).toLocaleString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        } catch (eG) {
          gen = "";
        }

        var periodLab = report.monthLabel || report.month || "";
        var periodNote = "Period: " + periodLab + "  ·  figures as of end of that month";
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
        var commMonth = Number(report.bizMonthComm) || 0;
        var commThrough = Number(report.commissionEarned != null ? report.commissionEarned : report.bizThroughComm) || 0;
        var commPrior =
          commThrough > commMonth + 0.009
            ? Math.round((commThrough - commMonth) * 100) / 100
            : 0;

        /* —— Header —— */
        push(52, function (y) {
          page.drawRectangle({ x: 0, y: y - 42, width: W, height: 52, color: navy });
          page.drawRectangle({ x: 0, y: y - 45, width: W, height: 3, color: gold });
          drawText("M/Y LIMITLESS", margin, y - 16, 10, true, white);
          drawText("Cash only", W - margin - 56, y - 16, 9, false, goldSoft);
          drawText("Expense report", margin, y - 34, 16, true, gold);
        });
        gap(10);
        /* Period only — do NOT mix with "generated today" (confuses the owner) */
        push(36, function (y) {
          page.drawRectangle({
            x: margin,
            y: y - 30,
            width: contentW,
            height: 32,
            color: goldSoft,
          });
          drawText(periodLab, margin + 10, y - 12, 14, true, navy);
          drawText("Figures as of the last day of this month", margin + 10, y - 26, 9, false, muted, contentW - 20);
        });
        gap(12);

        /* —— 1) PETTY CASH at a glance —— */
        sectionHead("1 · PETTY CASH");
        noteLine(periodNote, muted);
        gap(6);
        kvRow("Cash in", pdfMoney(cashIn), { big: true, boldLab: true, bg: greenBg, labColor: greenInk, valColor: greenInk });
        gap(4);
        kvRow("Cash out", pdfMoney(cashOut), { big: true, boldLab: true });
        gap(4);
        kvRow("On board (end of month)", pdfMoney(onBoard), {
          big: true,
          bg: onBoard > 0.009 ? greenBg : amberBg,
          labColor: onBoard > 0.009 ? greenInk : amberInk,
          valColor: onBoard > 0.009 ? greenInk : amberInk,
          boldLab: true,
        });
        if (boatShort > 0.009) {
          gap(4);
          kvRow("Petty cash short — OUTSTANDING", pdfMoney(boatShort), {
            big: true,
            bg: redBg,
            labColor: redInk,
            valColor: redInk,
            boldLab: true,
          });
          noteLine("Carries into next month until cash covers the hole.", redInk);
        }

        /* —— 2) STILL OUTSTANDING: outline first (3 lines), then detail —— */
        sectionHead("2 · STILL OUTSTANDING");
        noteLine(periodNote, muted);
        gap(6);
        if (!hasOutstanding) {
          kvRow("Nothing outstanding", pdfMoney(0), {
            big: true,
            bg: greenBg,
            labColor: greenInk,
            valColor: greenInk,
            boldLab: true,
          });
        } else {
          /* Outline — all three buckets visible immediately */
          noteLine("Outline (end of " + periodLab + "):", navy);
          gap(6);
          if (boatShort > 0.009) {
            kvRow("Petty cash short (crew / other)", pdfMoney(boatShort), {
              big: true,
              bg: redBg,
              labColor: redInk,
              valColor: redInk,
              boldLab: true,
            });
            gap(4);
          }
          if (commOpen > 0.009) {
            kvRow("Captain commission — OUTSTANDING", pdfMoney(commOpen), {
              big: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
            gap(4);
          }
          if (pocketOpen > 0.009) {
            kvRow("Captain out of pocket — OUTSTANDING", pdfMoney(pocketOpen), {
              big: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
            gap(4);
          }
          gap(4);
          kvRow("Total still outstanding", pdfMoney(outSum), {
            big: true,
            bg: redBg,
            labColor: redInk,
            valColor: redInk,
            boldLab: true,
          });
          gap(12);

          /* Detail under the outline */
          noteLine("Detail:", navy);
          gap(6);

          /* Crew pay (petty short on crew lines) */
          if (crewShortAmt > 0.009 || (boatShort > 0.009 && shorts.some(function (s) { return s.kind === "crew"; }))) {
            kvRow("Crew pay (petty cash short)", pdfMoney(crewShortAmt > 0.009 ? crewShortAmt : 0), {
              boldLab: true,
              bg: redBg,
              labColor: redInk,
              valColor: redInk,
            });
            noteLine("Crew lines marked from petty cash beyond cash in " + periodLab + ".", redInk);
            gap(4);
            shorts.forEach(function (s, idx) {
              if (s.kind !== "crew" && s.kind !== "daypay") return;
              var subBits = [];
              if (s.date) subBits.push(fmtDate(s.date));
              if (s.fullAmount > 0.009 && Math.abs((s.fullAmount || 0) - (s.amount || 0)) > 0.009) {
                subBits.push(
                  "of " + pdfMoney(s.fullAmount) + "  ·  petty cash covered " + pdfMoney(s.covered || 0)
                );
              } else {
                subBits.push("not covered by petty cash");
              }
              lineItem(s.label || "Crew", s.amount, subBits.join(" · "), idx, redInk);
            });
            gap(8);
          }

          /* Other petty cash short (e.g. crew pocket repay) */
          if (otherShortAmt > 0.009) {
            kvRow("Other petty cash short", pdfMoney(otherShortAmt), {
              boldLab: true,
              bg: redBg,
              labColor: redInk,
              valColor: redInk,
            });
            gap(4);
            shorts.forEach(function (s, idx) {
              if (s.kind === "crew" || s.kind === "daypay") return;
              var subBits = [];
              if (s.date) subBits.push(fmtDate(s.date));
              subBits.push("not covered by petty cash");
              lineItem(s.label || "Petty out", s.amount, subBits.join(" · "), idx, redInk);
            });
            gap(8);
          }

          /* Captain commission detail */
          if (commOpen > 0.009) {
            kvRow("Captain commission — detail", pdfMoney(commOpen), {
              boldLab: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
            });
            if (commPrior > 0.009) {
              noteLine(
                "Includes prior charters through end of " +
                  periodLab +
                  " (this month " +
                  pdfMoney(commMonth) +
                  " + earlier " +
                  pdfMoney(commPrior) +
                  ").",
                amberInk
              );
            } else {
              noteLine(
                "For charters in " + periodLab + " — not paid from petty cash in this period.",
                amberInk
              );
            }
            gap(4);
            kvRow("  Earned (through end of " + periodLab + ")", pdfMoney(commThrough));
            gap(2);
            kvRow("  Paid from petty cash (through end of " + periodLab + ")", pdfMoney(report.commissionPaidAll || 0));
            gap(2);
            kvRow("  Paid from petty cash this month", pdfMoney(report.commissionPaidThisMonth || 0));
            gap(8);
          }

          /* Captain out of pocket detail */
          if (pocketOpen > 0.009) {
            kvRow("Captain out of pocket — detail", pdfMoney(pocketOpen), {
              boldLab: true,
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
            });
            noteLine(
              "Fronted in " +
                periodLab +
                " (and any prior still open). Not repaid from petty cash by month end.",
              amberInk
            );
            gap(4);
            if (PS) {
              if ((PS.monthSpend || 0) > 0.009) {
                kvRow("  Fronted in " + periodLab, pdfMoney(PS.monthSpend || 0));
                gap(2);
              }
              if ((PS.broughtForward || 0) > 0.009) {
                kvRow("  Still open from before " + periodLab, pdfMoney(PS.broughtForward || 0));
                gap(2);
              }
              kvRow("  Repaid from petty cash in " + periodLab, pdfMoney(PS.monthRepay || 0));
            }
            gap(8);
          }
        }

        /* —— Petty cash detail —— */
        sectionHead("PETTY CASH · DETAIL");
        noteLine(periodNote, muted);
        gap(6);
        kvRow("Start", pdfMoney(start));
        gap(2);
        kvRow("Cash in", pdfMoney(cashIn));
        gap(2);
        kvRow("Cash out", pdfMoney(cashOut));
        if ((report.priorSettled || 0) > 0.009) {
          gap(2);
          kvRow("Prior short taken from cash-in", pdfMoney(report.priorSettled));
        }
        gap(4);
        kvRow("On board (end of month)", pdfMoney(onBoard), {
          big: true,
          bg: onBoard > 0.009 ? greenBg : amberBg,
          labColor: onBoard > 0.009 ? greenInk : amberInk,
          valColor: onBoard > 0.009 ? greenInk : amberInk,
          boldLab: true,
        });

        if ((report.cashIns || []).length) {
          gap(8);
          noteLine("Cash in lines", navy);
          gap(4);
          (report.cashIns || []).forEach(function (r, idx) {
            lineItem(r.label || "Cash in", r.amount, r.date ? fmtDate(r.date) : "", idx, greenInk);
          });
        }

        /* Cash out buckets only if something left pot */
        var bucketRows = [
          { lab: "Crew day pay", val: B.crewDayPay || 0 },
          { lab: "Captain commission", val: B.commission || 0 },
          { lab: "Repay captain pocket", val: B.reimburseCaptain || 0 },
          { lab: "Repay crew pocket", val: B.reimburseCrew || 0 },
          { lab: "Tip payouts", val: B.tipPayout || 0 },
          { lab: "Other", val: B.otherPetty || 0 },
        ].filter(function (r) {
          return r.val > 0.009;
        });
        if (bucketRows.length) {
          sectionHead("WHERE THE CASH WENT");
          bucketRows.forEach(function (r, i) {
            if (i) gap(2);
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
        var booksCrew = crew.booksOnly || 0;
        var ownerCrew = crew.fromOwner || 0;
        if (
          potCrewCovered > 0.009 ||
          potCrewMarked > 0.009 ||
          potCrewShort > 0.009 ||
          capCrew > 0.009 ||
          booksCrew > 0.009 ||
          ownerCrew > 0.009
        ) {
          sectionHead("CREW");
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
              /* Prefer span already in ownerDetail; ensure readable dates */
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
            kvRow("Paid from petty cash (cash covered)", pdfMoney(potCrewCovered), {
              big: true,
              bg: greenBg,
              labColor: greenInk,
              valColor: greenInk,
              boldLab: true,
            });
            if (potCrewShort > 0.009) {
              gap(4);
              kvRow("Crew short — marked petty, no cash left", pdfMoney(potCrewShort), {
                big: true,
                bg: redBg,
                labColor: redInk,
                valColor: redInk,
                boldLab: true,
              });
              noteLine(
                "Lines total " +
                  pdfMoney(potCrewMarked) +
                  " marked from petty, but cash in only covered " +
                  pdfMoney(potCrewCovered) +
                  ". Extra " +
                  pdfMoney(potCrewShort) +
                  " is books short (see outstanding).",
                redInk
              );
              gap(4);
              /* Point at the crew short line(s) */
              (report.shortLines || []).forEach(function (s, idx) {
                if (s.kind !== "crew" && s.kind !== "daypay") return;
                var subBits = [];
                if (s.date) subBits.push(fmtDate(s.date));
                subBits.push(
                  "line " +
                    pdfMoney(s.fullAmount || s.amount) +
                    " · petty covered " +
                    pdfMoney(s.covered || 0) +
                    " · short " +
                    pdfMoney(s.amount)
                );
                lineItem(s.label || "Crew", s.amount, subBits.join(" · "), idx, redInk);
              });
            }
            gap(6);
            noteLine("Crew lines (full amounts as booked):", navy);
            gap(4);
            (crew.potLines || []).forEach(function (r, idx) {
              crewOwnerLine(r, idx, greenInk);
            });
          }
          if (capCrew > 0.009) {
            gap(8);
            kvRow("Paid by captain (own money)", pdfMoney(capCrew), {
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
            noteLine("Not boat cash-out — shows under captain pocket.", amberInk);
            gap(4);
            (crew.captainLines || []).forEach(function (r, idx) {
              crewOwnerLine(r, idx, amberInk);
            });
          }
          if (ownerCrew > 0.009) {
            gap(6);
            kvRow("Paid by owner", pdfMoney(ownerCrew), { boldLab: true });
          }
          if (booksCrew > 0.009) {
            gap(6);
            kvRow("On books only (not petty cash)", pdfMoney(booksCrew), { boldLab: true });
            noteLine("Marked paid on books — cash did not leave petty cash.", muted);
          }
        }

        /* Captain pocket */
        sectionHead("CAPTAIN POCKET");
        if (PS && ((PS.monthSpend || 0) > 0.009 || (PS.closingOpen || 0) > 0.009 || (PS.broughtForward || 0) > 0.009)) {
          if ((PS.broughtForward || 0) > 0.009) {
            kvRow("Open from prior months", pdfMoney(PS.broughtForward), {
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
            gap(4);
          }
          kvRow("Fronted this month", pdfMoney(PS.monthSpend || 0), { boldLab: true });
          if ((PS.stewMonth || 0) > 0.009) {
            gap(2);
            kvRow("  Stew day rates", pdfMoney(PS.stewMonth));
          }
          if ((PS.shopMonth || 0) > 0.009) {
            gap(2);
            kvRow("  Shops / other", pdfMoney(PS.shopMonth));
          }
          gap(4);
          kvRow("Repaid from petty cash this month", pdfMoney(PS.monthRepay || 0));
          gap(6);
          kvRow("Still open end of month", pdfMoney(PS.closingOpen || 0), {
            big: true,
            bg: (PS.closingOpen || 0) > 0.009 ? amberBg : greenBg,
            labColor: (PS.closingOpen || 0) > 0.009 ? amberInk : greenInk,
            valColor: (PS.closingOpen || 0) > 0.009 ? amberInk : greenInk,
            boldLab: true,
          });
          if ((PS.monthRepay || 0) < 0.01 && (PS.closingOpen || 0) > 0.009) {
            gap(4);
            noteLine("Not repaid this month — still outstanding.", amberInk);
          }
        } else {
          noteLine("No captain pocket activity this month.", muted);
        }

        /* Commission — charter month only (no future bookings) */
        if (
          (report.bizMonthComm || 0) > 0.009 ||
          (report.commissionPaidThisMonth || 0) > 0.009 ||
          commOpen > 0.009 ||
          (report.commissionEarned || 0) > 0.009
        ) {
          sectionHead("CAPTAIN COMMISSION");
          noteLine("Only charters in this month (or started earlier). Future bookings excluded.", muted);
          gap(4);
          if ((report.bizMonthGross || 0) > 0.009) {
            kvRow("Business generated (this month)", pdfMoney(report.bizMonthGross || 0));
            gap(2);
            kvRow("Commission on that", pdfMoney(report.bizMonthComm || 0), { boldLab: true });
            gap(4);
          }
          /* List deals counted — owner can see no future charter slipped in */
          var dealItems = report.bizMonthItems || [];
          if (dealItems.length) {
            noteLine("Charters counted:", navy);
            gap(4);
            dealItems.forEach(function (it, idx) {
              var title = (it.name || "Guest") + (it.kind === "charge" ? " · upsell" : "");
              var sub = it.start
                ? it.end && it.end !== it.start
                  ? fmtDate(it.start) + " to " + fmtDate(it.end)
                  : fmtDate(it.start)
                : "";
              lineItem(title, it.comm || 0, sub, idx, gold);
            });
            gap(6);
          }
          if ((report.bizThroughComm || 0) > 0.009 && Math.abs((report.bizThroughComm || 0) - (report.bizMonthComm || 0)) > 0.5) {
            kvRow("Commission earned through end of month", pdfMoney(report.commissionEarned || report.bizThroughComm || 0));
            gap(2);
          }
          kvRow("Paid from petty cash this month", pdfMoney(report.commissionPaidThisMonth || 0));
          gap(2);
          kvRow("Paid from petty cash through end of month", pdfMoney(report.commissionPaidAll || 0));
          if (commOpen > 0.009) {
            gap(4);
            kvRow("Still outstanding (through end of month)", pdfMoney(commOpen), {
              bg: amberBg,
              labColor: amberInk,
              valColor: amberInk,
              boldLab: true,
            });
          }
        }

        gap(16);
        push(20, function (y) {
          drawText("Cash only  ·  as of end of month  ·  Limitless", margin, y - 6, 8, false, muted);
        });
        gap(12);

        var totalH = 20;
        items.forEach(function (it) {
          totalH += it.h;
        });
        totalH += 20;
        var H = Math.min(Math.max(Math.ceil(totalH), 520), 16000);
        page = doc.addPage([W, H]);
        var y = H - 16;
        items.forEach(function (it) {
          if (y - it.h < 8) return;
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
