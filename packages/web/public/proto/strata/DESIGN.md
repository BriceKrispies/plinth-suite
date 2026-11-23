# Strata: layered depth for Plinth

## Artistic intent

Modern spatial calm. The interface is a stack of surfaces and every surface says where it sits: the canvas
at the bottom, panels one layer above it, charts recessed into a well inside each panel, and menus, tooltips
and the inspector at the top. Depth is used to explain, not to decorate. Elevation is a soft, hue-tinted
shadow with a one-pixel edge; translucency appears in exactly two places (the masthead and the trace ribbon,
which float over scrolling content); there are no glass cards, no neon, no gradients except a faint accent
wash on the canvas and on KPI tiles. Motion explains causality: when an agent commits a panel, the panel rises
from the layer beneath it, its shadow deepens, and a tab on its upper edge names the change that caused it.

The page always reads as a sober instrument for a boardroom: one hue, rounded but not bubbly corners
(0.375 to 0.9rem), tabular numerals, system fonts.

## Token system (`css/tokens.css`)

- **One hue.** `--hue: 262`. Every neutral, surface, accent and shadow is `oklch(L C var(--hue))`, so the
  whole product re-tints by changing one number. Light and dark are paired in `light-dark()`.
- **Ink:** `--ink-1` (L 24 / 96), `--ink-2`, `--ink-3` (L 49 / 72, at least 4.5:1 on every surface).
- **Layers:** `--canvas`, `--layer-1` (panels), `--layer-2` (raised: menus, tooltips, inspector head),
  `--sunken` (chart wells). `--glass` is `layer-1` at 80% for the two floating bars.
- **Accent and state:** `--accent`, `--good`, `--warn`, `--bad`, each with a `color-mix()` soft tint.
- **Data colour:** six categorical hues `--c1..--c6` at matched lightness and chroma; a sequential ramp
  `--seq-lo` to `--seq-hi` from the same hue, interpolated per cell with `color-mix(in oklch, ...)` from a
  `--t` custom property set by JS; `--hatch` for breach patterns.
- **Elevation:** `--elev-1` (panels), `--elev-2` (hover, newest trace card, arriving panels), `--elev-3`
  (menus, inspector), `--inset` (wells). Each is a 1px edge, an upper-edge highlight, and two tinted shadows.
- **Type:** system stack; steps `--fs-xs .75rem`, `sm .8125`, `md .9375`, `lg 1.125`, `xl` fluid, `--fs-kpi`
  sized by container width (`cqi`). The root font size is fluid (`clamp(16px, 1.1vw + 2px, 26px)`), so
  everything, including the trace ribbon, scales to a wall display.
- **Space:** `--sp-1..6` (0.25 to 2.25rem), fluid `--gutter`. **Radius:** `sm .375`, `md .625`, `lg .9`.
- **Motion:** `--dur-1/2/3` (120, 240, 640ms) and one easing, `--ease`. Reduced motion collapses durations.

## CSS architecture

`styles.css` declares `@layer reset, tokens, base, layout, components, utilities, overrides;` once and imports
each file into a layer. Components are one file each (masthead, controls, panel, charts, trace, inspector,
states). Use of modern CSS: nesting, container queries (`@container panel` for panel density), `:has()`
(panel stacks above neighbours while its menu is open; cards and the identity pill react to focus and hover
inside), logical properties throughout, `light-dark()`, `color-mix()`, OKLCH, `@starting-style` for the
inspector, `clamp()`. `!important` appears only in `overrides` (hidden attribute, reduced motion).

## Layout and information architecture

- **Masthead** (banner): brand and breadcrumb on the left; connection state, identity switch and presence on the
  right. **Main:** board title, meta line (slug, revision, panel count), parameters and the brushed-window chip,
  then the 12-column board. Panels are placed from `at` through `--x --y --w --h` custom properties, so CSS owns
  the layout and the responsive reflow. **Trace ribbon** (footer): persistent, sticky to the bottom.
- **Trace as an instrument.** A row of cards, newest at the left and raised. Each card carries a large
  sequence number, a `live` / `replay` / `ui` tag (live is filled with a pulsing dot), actor, rule ids, node
  kind and title, and the ops summary. At 1600px and above the cards grow for the back of the room; at phone
  width they collapse to a slim strip of seq, tag and title. The head shows the audit-chain verification.
- **Arrival moment.** A new panel rises (translate, scale, shadow), a ring halos around it, and a tab on its top
  edge reads `#42  Added by agent`. A changed panel gets the ring and tab only. Both clear after eight seconds.
  Nothing animates on first load, on parameter edits or on plain refetches (`attributeCauses` in `board.js`).
- **Responsive.** Under 52rem the board becomes a single column in reading order (KPI tiles pair up). Wall
  display scales through the fluid root; the layout is the same 12 columns.
- **Inspector** is a modal `dialog` docked to the right (a bottom sheet on phones): identity, formatted query,
  visual spec, result metadata, with a raw query disclosure. It stays live while open.

## Accessibility

- Landmarks: `header`, `nav` (breadcrumb), `main`, `footer` (trace), plus a skip link. One `h1` per page; panel
  titles are `h2`; inspector sections `h3`.
- Every panel is a `section` named by its heading. Panel loading uses `aria-busy`.
- Live updates: the trace list is `aria-live="polite"` with `aria-relevant="additions"` and new items are
  prepended; a separate `role="status"` region announces "Panel X added by agent, change 42". The connection chip
  is its own status region.
- The identity switch is a native `select` with a visible label (visually hidden on phones).
- The panel menu is a disclosure of real buttons: Escape closes and returns focus, arrows move, focus-out closes.
- Inspector: `showModal()`, focus lands on the close button, and returns to the opener on close; Escape and
  backdrop click close it.
- Charts are `role="img"` SVG with `<title>` and `<desc>` (range, series, breach count). Every chart has "View as
  table" in the panel menu, rendering a real `<table>` of the same rows with a text Status column.
- Threshold breaches use shape and words, not colour alone: dashed limit line with a triangle and "Limit N" label,
  triangle markers on points, hatched bars and heatmap cells with a heavier ring, a panel flag "N over limit".
- Visible focus rings on every control; `prefers-reduced-motion` removes all keyframes (the ring and tab remain);
  `forced-colors` maps borders, marks and thresholds to system colours.

## JavaScript

Small ES modules, no globals: `api`, `realtime` (reconnect with backoff and `since_seq`), `board` (loading,
cause attribution, query formatting), `panel`, `menu`, `trace`, `inspector`, `header`, `banner`,
`dashboard-view`, `index-view`, and `visuals/*` (one module per chart family around a shared measured-plot
core). All DOM is built with a tiny `h()` / `s()` helper that uses text nodes, so data is never parsed as markup.
Panels are reconciled by key, so a refresh touches only what changed.

## What I would do next

- Keyboard brushing for the line chart (arrow keys on the plot), and focusable data points with a live readout.
- Real presence from the socket, with avatar stack and "viewing this panel" hints.
- Per-panel resize/relayout animation for when an agent moves existing panels.
- A density toggle and a high-contrast theme alongside light and dark.
- Virtualised table rows for large results, and column sorting.
