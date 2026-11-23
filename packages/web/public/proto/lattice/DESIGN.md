# Lattice: systematic enterprise

## Artistic intent

Lattice reads as software that scales to five hundred screens. Every surface, control and state is
drawn from one token architecture, so a new panel type or a new page looks like it was always part
of the product. The palette is crisp neutral greys plus a single corporate blue; colour is spent on
meaning (accent, ok, warn, bad) and never on decoration. Light and dark are both first-class, and a
compact density mode serves operators who want more rows per screen.

## Token system

Three tiers, all in `css/tokens.css`:

1. **Primitives.** `--blue-50..900` and `--grey-0..1000` in OKLCH from one hue (`--hue: 255`), each
   step a fixed lightness and chroma. Change the hue and every blue re-derives.
2. **Semantic.** `--surface`, `--border`, `--text`, `--accent`, `--ok`, `--warn`, `--bad` and so on,
   each a `light-dark()` pair. `:root[data-theme]` overrides `color-scheme`; the default follows the
   system.
3. **Component.** Local aliases such as `--c` (series colour via `[data-s]`), `--t` (heat ramp
   position) and `--tag-c` (trace tag colour). Components never name a primitive.

| Scale | Values |
| --- | --- |
| Type | fluid `clamp()` steps `--text-xs` to `--text-3xl`; system sans and mono stacks |
| Space | 4 px scale `--space-1` (4) to `--space-12` (48) |
| Radius | 4 / 6 / 10 px |
| Elevation | four tiers, shadow ink is theme-aware |
| Motion | 120 / 200 / 520 ms, one ease-out curve; all keyframes sit under `prefers-reduced-motion: no-preference` |
| Density | `--control-h`, `--pad-*`, `--cell-*`, `--gap` swap under `[data-density="compact"]`; coarse pointers always get a 44 px control |

The wall display scales the whole rem-based system with a root font-size step at 1700 px and 2400 px
rather than patching components.

## CSS architecture

`styles.css` declares `@layer reset, tokens, base, layout, components, utilities, overrides;` once and
imports each file into exactly one layer. No rule exists outside a layer; `!important` appears once, in
`overrides` (`[hidden]`). Container queries drive the page (`board`: stack below 46rem), the top bar,
the trace ribbon and each panel (`panel`: collapse the table toggle to an icon). Nesting, logical
properties, `:has()` (segmented control, selected state), `color-mix()` in OKLCH (series tints, heat
ramp, hatched breach colours) and `cqi`-based KPI type are used where they simplify.

## Layout and information architecture

- **Chrome (sticky):** top bar (brand, breadcrumb, live state, display menu, identity switch,
  presence) above the trace ribbon. The trace is persistent and sits where the eye already is.
- **Main:** page head (h1, slug, revision, panel count, parameters form) then the 12-column grid. Each
  panel places itself with `--x --y --w --h`; the DOM is sorted by y then x, so the phone stack is
  reading order.
- **Trace ribbon:** instrument cards, newest first, each a large mono `seq`, a tag with icon (`live`
  agent over MCP, `replay` driver, `ui`), actor, rule ids, node kind and title, and the ops summary.
  At 1920 px the cards grow; on a phone only seq, tag, actor and title remain.
- **Arrival:** a panel animates in only when a realtime event caused it. A solid accent band on the
  panel names the cause (`Added by agent · claude · mcp · seq 142`) for eight seconds. The initial
  load and the trace backfill never animate.
- **Panel states:** loading skeleton, empty ("No rows for this query" plus the query summary), error
  (code and message), ready. Threshold breaches carry a hatch, an outline, a triangle glyph and a
  sentence in the panel foot.
- **Inspector:** a modal side sheet with the formatted query, raw JSON, visual spec, result metadata
  (`as_of`, rows, columns, `policy_hash`, `plan_summary`, watermarks) and the node URI and revision.
- **Index:** a filterable data table of dashboards. Unknown and empty dashboards, load failure and
  offline each have a designed state.

## Accessibility

- Landmarks: `header`, `nav` (breadcrumb), `aside` (trace), `main`, `footer`; skip link; one `h1`
  per view, panels are `section`s named by their `h2`.
- Live updates: the trace list is `aria-live="polite"` and `aria-busy` until the backfill lands; a
  separate status region announces "Panel added / Updated" with the causing change.
- The identity switch is a labelled `select`. The inspector is a modal `<dialog>`; focus moves in on
  open and is restored to the opening control on close. Visible `:focus-visible` rings everywhere.
- Charts are `role="img"` SVG with `<title>`, `<desc>` and a computed summary; every chart has a
  "View as table" toggle (`aria-pressed`) and a panel menu entry that reveals a real `<table>` of the
  same rows, with a Status column that spells out breaches. Tables have captions, `scope` and
  `aria-sort` on sortable headers.
- Colour is never the only signal: live state uses icon and word, deltas use arrows and a hidden
  "favourable/unfavourable", breaches use hatch, glyph, label and text, scatter series use marker shapes.
- `prefers-reduced-motion`, `forced-colors` and coarse-pointer sizing are honoured.

## JS structure

Small ES modules, no globals: `api`, `realtime` (reconnect with `since_seq`, replay flagging),
`board` (layout, query, change signature), `panel` (one panel's DOM and state machine, ResizeObserver
driven draws), `charts/*` (seven visual types plus scales and SVG helpers), `trace`, `inspector`,
`prefs`, `views/*`. All text is set through text nodes; there is no `innerHTML`.

## What I would do next

- Keyboard brushing for time charts (arrow keys to move and resize a window).
- Per-series direct labels and a crosshair that spans all series.
- Virtualised rows for very large tables, column resizing and a column picker.
- A presence stack showing other viewers, and a focus mode that pins the newest panel on the wall.
- Visual regression fixtures per token tier and per density.
