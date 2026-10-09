---
name: architecture-diagrams
description: Use when asked for an architecture, system, block, or infrastructure diagram as HTML/SVG — especially a client-facing one that must fit one screen, or when a previous attempt has floating arrows, labels on lines, text overflowing boxes, or "boxes in a grid" that doesn't read as an architecture.
---

# Architecture Diagrams

## Overview

Hand-placed SVG coordinates always collide: arrows drift off box edges, labels sit on lines, text overflows,
and each screenshot fix breaks something else. **Generate the diagram from a node registry and refuse to
emit if the geometry is wrong.** The bundled `diagram.gen.py` does this; copy it, edit its CONTENT section,
run it. It exits 1 with a list of collisions instead of writing bad HTML.

## Requirements

- **Python 3.12+** — the generator uses f-string syntax older versions reject. Check with `python3 --version`.
- **Google Chrome** — only for the screenshot check in step 4.
- **Network on first use of a brand logo** — fetched once from jsDelivr into `~/.cache/architecture-diagrams/icons`
  (override with `ICON_CACHE`). Offline, an auto-matched logo falls back to the generic icon; a forced `brand=` fails.

Installs either with the `ai-workflow` plugin or on its own: copy this folder to `~/.claude/skills/architecture-diagrams/`.

## Workflow

1. `cp <this skill's base directory>/diagram.gen.py <project>/assets/<name>.gen.py` (the directory this
   `SKILL.md` was loaded from: the plugin's `skills/architecture-diagrams/`, or `~/.claude/skills/architecture-diagrams/`)
2. Replace the **CONTENT** section only (nodes, arrows, labels, regions, legend, titles, `VW/VH`). Everything
   outside it is style + validator; if you find yourself editing it, the template is missing a feature — add it
   there as a parameter, not as a one-off hack.
3. `python3 <name>.gen.py` — fix every line of `VALIDATION FAILED` before anything else.
4. Screenshot at 1512×900 **and read it** — the validator can't judge taste:
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars --window-size=1512,900 --screenshot=out.png --virtual-time-budget=3000 file://<html>`
5. Publish the HTML as an Artifact; republish to the same file path on every change.

## What makes it read as an architecture (not a table of boxes)

| Do | Because |
|---|---|
| **Shaped nodes**: cylinders for stores (`shape="cyl"`), icons on services (`icon="code"/"db"/"people"/"cloud"/…`), real logos where the product is known (see Brand logos) | Same-shaped rectangles read as a spreadsheet; a Redis or Postgres mark is read before its caption |
| **Named, coloured paths** — one colour per business flow (commerce = orange, editorial = green, internal = blue), named in the legend | The reader follows a story, not wires |
| **Main request left → right**, stores hanging **under their owner**, one dashed `region()` around what is new | Mirrors how people already draw systems; "new" is the one thing the reader must find |
| **Every arrow labelled** with what travels (`ON MISS → /api/*`, `PURGE ON PUBLISH`) | Unlabelled arrows are the #1 client question |
| **Body copy says what the box does**, 1–3 short lines; a leading space marks a wrapped continuation (no bullet) | A bullet per wrapped line reads as separate facts |
| Header = eyebrow + title only. No stat tiles, no footer prose | They were the first thing every reviewer asked to remove |

## Geometry rules (the validator enforces most of these)

- Arrow ends come **only** from `E(node, side, t)`. Use `ty(node, y)` / `tx(node, x)` so both ends share a y (or x) — anything else renders as a tilt.
- **Labels sit beside lines, never on them.** Prefer `along(a, "TEXT")` where `a = arrow(...)`: it centres the label on the longest segment, above a horizontal or right of a vertical (`side=`, `seg=`, `at=` to override), in the arrow's colour. Long label → a tuple of short lines, `along(a, ("ON MISS", "/api/*"))`. Raw `label()` is for free-standing captions. Never add white halos to hide a line under text.
- **Keep the corridors empty**: nothing sits in the lane between two connected boxes. If a lane is blocked, move the blocking box (typically a store) *under* its owner, not around.
- `both=True` **only for stores** (read + write). Request/response is one arrow in the request direction.
- **No stub arrows** pointing at nothing. An out-of-band flow either gets a real (dashed) route or a line in the legend/footer.
- Don't route a path around three sides of the canvas — that is the largest single source of clutter. Reposition nodes until it's ≤ 2 segments.
- Gaps: ≥ 60px between connected boxes (arrowhead + breathing room), ≥ 20px anywhere.
- Copy budget is per box width: ~30 chars at 12.5px in a 240px box. The validator tells you the exact overflow; shorten the words, don't shrink the font below 12.
- A colleague's hand-edited HTML is **input, not the source**: extract its nodes/arrows/text, re-express them in the generator, run the validator. It will find overflows and off-plumb arrows the editor couldn't see.

## Common mistakes

| Symptom | Fix |
|---|---|
| Arrow "a bit tilted" | one end used `0.5`, other used a different `t` → use `ty()`/`tx()` for both |
| Label kisses a box or crosses a region border | the validator rejects both; switch to `along()` or move it fully inside/outside the region |
| Node straddles a region border | decide whether it is new; move it fully in or out |
| Validator passes, HTML unchanged | it refuses to write on failure — re-run and read the errors, don't republish the stale file |
| Two verticals between the same pair of boxes | put each label on the *outside* of its line, split into two words |
| Fullscreen leaves a dead band | the viewBox has margin; tighten `VW/VH` to the content, don't shrink fonts |
| Legend entry with no matching line on the canvas | legend is content — list only styles that actually appear |
| Region note runs through an arrow | `region(note=)` is validated as a label; move it to the other corner or shorten |

## Verifying claims on the diagram

Every box's copy and every arrow should trace to a source (code, config, a live probe, a KB doc). Where a
flow is only what the *old* system does, say so in the box (e.g. "via the legacy render service") rather
than drawing it as settled.

## Brand logos

`node()` attaches a Simple Icons logo (CC0, pinned version, cached in `~/.cache/architecture-diagrams/icons`, override with `ICON_CACHE`) **only when
it is certain**, otherwise it keeps the generic `icon=`:

- `brand="slug"` forces one; a slug that doesn't exist fails validation. `brand=False` opts out.
- Auto: the title, lower-cased, exactly matches a `BRANDS` alias (`Redis`, `Postgres`, `S3`, `Strapi`…), or
  **exactly one** subtitle segment does (`React · k8s` → React). Two matches (`Go · ECS`) is ambiguous: it
  prints a note and keeps the generic icon. There is no fuzzy matching.
- Internal, in-house service names never match, by design. Their job is said by the generic icon.
- To add a product: check `https://cdn.jsdelivr.net/npm/simple-icons@<SIMPLE_ICONS>/icons/<slug>.svg`
  returns 200, then add the alias. Simple Icons has no logo for some products (e.g. Gumlet, CloudFront).
- Logos render monochrome in the node's accent so they don't compete with the coloured flow paths.
