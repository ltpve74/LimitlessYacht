---
name: be-proactive-with-suggestions
description: "User wants Claude to proactively suggest obvious improvements, not wait to be asked"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 1b62144d-44dd-4710-a58e-6732204ec60f
---

The user wants me to **proactively suggest obvious, common-sense improvements** rather than waiting for them to think of them.

**Why:** when working on the site, things like "it's high season, so show the peak price first on mobile" or "this will go stale in September unless it's dynamic" are obvious wins the user shouldn't have to surface themselves — they expect me to spot and propose them.

**How to apply:** when working in an area, scan for adjacent obvious improvements (seasonality, staleness/maintenance traps, mobile-first ordering, accuracy vs. what's bookable now, consistency across locales) and surface them concisely as suggestions — don't wait to be asked. Keep proposing the better-engineered option (e.g. dynamic/auto over manual) when it avoids future maintenance. Still respect [[no-auto-push]] and confirm before big changes.
