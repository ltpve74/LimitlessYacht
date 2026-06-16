# Limitless Yacht — Claude Code Guidelines

## Branch strategy
- `experiment-no-prices` — **readable dev source** (multi-line HTML/CSS). Always edit here.
- `main` — production on Netlify. Merge from `experiment-no-prices` when publishing; resolve conflicts with `git checkout --theirs`.

## Publishing workflow
1. Commit on `experiment-no-prices` — pre-commit **only rebuilds locales** (no minification).
2. Merge into `main` and commit — pre-commit **rebuilds locales → minifies → runs 49 tests**.
3. Push `main` — Netlify publishes the already-minified files as-is (no build/minify step).

Never minify on `experiment-no-prices`. Never hand-edit minified files on `main`.

## Navigation / scrolling
**Always use native browser anchor navigation.** CSS handles positioning:
- `html { scroll-padding-top }` — keeps anchors below the fixed nav
- `#target { scroll-margin-top }` — per-element viewport-specific offsets
- `html { scroll-behavior: smooth }` under `@media (prefers-reduced-motion: no-preference)`

Only reach for JS when doing something genuinely beyond native capability:
- Scrolling to a *different* element than the href target (e.g. skipping a hidden section header)
- Activating a tab or triggering a side effect alongside navigation
- In those cases: fire the JS, then let the native action complete — do not replicate scrolling in JS

Never intercept anchor clicks just to recompute a scroll offset that CSS already handles.

## CSS architecture
- Mobile breakpoint: `max-width: 640px`
- Tablet breakpoint: `max-width: 768px` / `min-width: 769px`
- `scroll-padding-top`: 5rem default, 4.9rem at ≤640px, 6.25rem at 769–1100px
- Viewport-conditional landing (e.g. `#enquire`): use `scroll-margin-top` inside `@media (min-height: …)` queries — no JS

## Anchor position pattern
Zero-height span marks the exact landing point inside a section:
```html
<span id="target" style="display:block;height:0;overflow:hidden" aria-hidden="true"></span>
```
Place the span where content should appear on landing; use `scroll-margin-top` in CSS to reveal content above it on tall viewports.
