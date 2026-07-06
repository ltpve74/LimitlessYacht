# Mobile hero candidates — three top-down boat shots

Processed for A/B comparison on **portrait mobile hero** (`media="(orientation: portrait)"` source). Each candidate has a **landscape** hero set (desktop / preview fallback) and a **portrait** set (`*p`, source rotated −90°) wired like production `maiora_20s_18` / `maiora_20s_18p`.

## How to preview (site agent)

Swap portrait `<source>` + preview `<source>` to `images/mobile/hero_topdown_Xp-{480,720,960}.webp` and preview `images/mobile/hero_topdown_Xp-prev.jpg`. Desktop/default sources use `hero_topdown_X` tiers. See `index.html` hero `<picture>` block (currently `maiora_20s_18` / `18p`).

## Candidates

| ID | landscape basename | portrait basename (mobile hero) | source | notes |
|----|------------------|-------------------------------|--------|-------|
| **A** | `hero_topdown_a` | `hero_topdown_ap` | 1.mp4 @ 13.5s | **Current live hero** — same frame as `maiora_20s_18` / `18p`; clean overhead, turquoise water, minimal clutter |
| **B** | `hero_topdown_b` | `hero_topdown_bp` | 1.mp4 @ 11.5s | Same clip, slightly earlier — near-duplicate of A but different boat position on water sparkles |
| **C** | `hero_topdown_c` | `hero_topdown_cp` | 4.mp4 @ 5.5s | Overhead with hex float platform off the bow + guests on deck — more “life aboard” in hero |

## Recommendation

- **Safest mobile hero:** **A** (`hero_topdown_ap`) — matches production; boat centred, no platform clutter.
- **If you want more energy:** **C** (`hero_topdown_cp`) — platform adds story but may compete with rates pill / crop.
- **B** is a fine-tune of A — only switch if side-by-side on 375×667 favours its framing.

## Files per candidate

Each basename includes: desktop `.jpg` + `.webp` + `-640/-960/-1280.webp`, mobile `.webp` + `-480/-720/-960.webp`, `-prev.jpg` (desktop + mobile).

## Not processed here

`maiora_20s_19` gallery stills and lifestyle overhead shots (`life_seabob`, etc.) — different pipeline / aspect. This batch is **hero-tier only** for the three top-down exterior frames.