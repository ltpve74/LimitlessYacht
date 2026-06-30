#!/bin/sh
# Printed into context at the start of every Claude Code session (SessionStart hook,
# configured in .claude/settings.json). Keeps the load-bearing decisions in front of the
# agent so a good change isn't reversed on a hunch. Full rationale: DECISIONS.md.
cat <<'EOF'
========== LOAD-BEARING DECISIONS — read DECISIONS.md before changing things ==========
Before touching PERFORMANCE, FONTS, CSS/JS LOADING, CLS, or the BUILD, open DECISIONS.md.
Several choices below look like bugs or easy wins but are DELIBERATE and measured.
If a request would undo one, say so and confirm with the owner first — do not reverse it on a hunch.

DO NOT (without re-reading DECISIONS.md + owner sign-off):
  • Re-add a Montserrat @font-face to CSS, or preload the font. It is deliberately OFF the
    critical path (protects the 1.1s LCP). A reported "font shift" is NOT a reason to revert —
    measure CLS first; the live site does not shift (the fallback is metric-matched).
  • Turn the inlined net-tier loader back into an external <script src> (re-adds a
    render-blocking fetch ahead of all the CSS).
  • Parallelize main.css with the hero or restore the 1500ms defer (the ~300ms gap protects LCP).
  • Remove the reviews / hero-pull-quote / carousel-nav CLS reserves.
  • Weaken a test tagged "# DECISION" to make a change pass — the test is right, your change is
    undoing a decision. (The pre-commit hook blocks this; running --accept is a conscious override.)

Why each exists, and the "symptom that looks like a regression but isn't": DECISIONS.md
=======================================================================================
EOF
