# Nocturne: a quiet control room

## Artistic intent

A calm, low-chroma dark console for people who watch systems all day, tuned for a wall display in a dim
room and still comfortable on a phone. Surfaces are deep neutral blue-greys separated by small luminance
steps, not borders and shadows. Colour is rationed: one cool accent means "live" and "caused by a change";
red appears only for a breach or a failure; amber only for replayed history. The trace ribbon is the
instrument: a fixed strip of large monospaced sequence numbers that you can read from across a room. Dark is
the default (the point of the direction); a header toggle switches every token to a light set via
`light-dark()` and remembers the choice in `localStorage`, treated as a per-viewer convenience.

## Token system (`css/tokens.css`, all colour in OKLCH)

- **Neutrals** (hue 252, chroma 0.005-0.011): `--surface-0` page L0.165, `--surface-1` panel L0.205,
  `--surface-2` raised L0.245, `--surface-3` hover/chip L0.292. Light set mirrors these at L0.97-0.925.
  Lines L0.31 / L0.40. Text L0.93, dim L0.76, faint L0.66 (all at least 4.5:1 on their surface).
- **Accent** `oklch(0.80 0.095 205)`; focus ring `oklch(0.82 0.11 225)`.
- **Status** good 155, warn 85, bad 25, each with a `color-mix()` soft tint. Always paired with an icon,
  word or pattern.
- **Series**: six hues at matched lightness (L0.76-0.80, chroma about 0.10), each also given a marker shape
  in scatter and legends. **Heatmap ramp**: two stops (`--heat-lo`, `--heat-hi`); each cell sets only `--t`
  and CSS mixes the colour with `color-mix(in oklch ...)`.
- **Type**: system stacks only. Fluid scale `--text-2xs` to `--text-xl` with `clamp()`; mono for seq numbers,
  actors, rules and hashes; tabular numerals everywhere. The whole rem-based system scales to 112.5% at
  1700px and 150% at 2400px for wall displays.
- **Space** `--space-3xs` (2px) to `--space-2xl` (48px); fluid `--gutter` and `--gap`.
- **Radius** 0.3 / 0.5 / 0.75rem. **Elevation** three steps: a hairline highlight plus short shadow, a menu
  step and a modal step; the luminance ladder carries most of the depth.
- **Motion** `--dur-fast` 120ms, `--dur` 220ms, `--dur-cause` 6s. `prefers-reduced-motion` zeroes them.

## CSS architecture

`styles.css` declares `@layer reset, tokens, base, layout, components, utilities, overrides;` once and pulls
each file in with `@import ... layer(name)`, so every rule is layered. `components` is split by concern
(chrome, panel, charts, trace, inspector, views). Nesting, `:has()` (failed or breached panel edge, open-menu
stacking, KPI with or without sparkline), logical properties, container queries (`board` for the grid,
`panel` for panel content, `trace`), `clamp()`, and `color-mix()` are used where they simplify. `!important`
appears only in `overrides.css` (the `[hidden]` guarantee and forced-colors).

## Layout and information architecture

Header (product, board title, live state, identity, presence, theme) then a board bar (slug, revision, panel
count, parameters) then the grid then the audit footer, with the trace ribbon pinned to the bottom edge.
The 12-column grid honours `at` on desktop; the board container drops to six columns on tablet (each panel
takes half its share) and stacks in reading order (y, then x) on phone, with KPI tiles pairing up. DOM order
is always reading order. The dashboard index shows each board with a thumbnail drawn from its real layout.
States: per-panel loading skeleton, empty ("No rows for this query" plus the query summary), error (code and
message), board with no panels, unknown board, and offline (banner, stale panels dimmed, auto-reconnect with
backoff resuming from `since_seq`).

**The agent moment.** A panel that arrives or changes because of a realtime event gets one short rise
(arrivals only) and a 6-second accent glow with a badge reading "Added/Updated, seq N, actor". Cause
attribution is a port of the reference rule: the newest event on the panel's node, else the newest event.
Initial load, backfilled history and refetches without an event never animate. The same event is announced
in a polite status region. Trace cells for live events arrive with a short settle and an accent top rule.

## Accessibility

Landmarks: `header`, `nav`-style breadcrumb, `main`, `aside` (trace), `footer`. Every panel is a `section`
labelled by its heading. The trace is an `aria-live="polite"` ordered list, and a separate `role="status"`
region announces panel changes. The identity switch is a native labelled `select`. The inspector is a native
modal `dialog`; focus moves to its heading on open and returns to the opening menu button (or `main` if that
panel was replaced). The panel menu follows the menu-button pattern (arrow keys, Home/End, Escape, Tab).
Charts are `role="img"` SVG with `<title>` and a generated `<desc>`, hover readouts are supplementary, and
every chart has a "View as table" toggle (`aria-pressed`) that swaps in a real `<table>` of the same rows with
an extra "against limit" column in words. Breaches use hatch fill, a triangle glyph, the limit line label
and a text note, never colour alone. Sortable table headers expose `aria-sort`. Focus is always visible;
`forced-colors` is handled in the overrides layer.

## JS structure (`js/`, ES modules, no dependencies)

`api`, `realtime` (reconnect, `since_seq` resume, backfill flag), `board` (structure then per-panel
hydration, query formatting), `causes`, `panel` (persistent shell, body rebuilt only when its signature
changes), `menu`, `inspector`, `trace`, `board-view`, `index-view`, `main`. `charts/` holds `frame` (SVG
sized by `ResizeObserver`, redrawn on resize), `scales`, `marks`, `xy` (line, area, scatter, with optional
brush-to-zoom), `bar`, `heatmap`, `kpi`, `datatable`, `visuals`. DOM is built with `h()`/`s()` helpers using
text nodes and `setAttribute` only, so nothing is injected as markup.

## What I would do next

Real timestamps on events for relative ages in the trace; a trace filter (agent only, a given board); keyboard
navigation of chart marks; a compare-revisions view in the inspector; a wall-display mode that auto-cycles
boards; contrast verification of all tokens with an automated check; unit tests for scales and cause
attribution.
