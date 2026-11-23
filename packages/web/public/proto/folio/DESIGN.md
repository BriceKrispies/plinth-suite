# Folio: editorial report

## Artistic intent

The dashboard is a briefing document that updates itself. Paper-toned surfaces, a confident serif for
headings and numerals, a clean sans for data, generous whitespace, and the apparatus of a printed report:
an eyebrow and headline, an italic dek, a dateline in the margin, numbered figures ("Fig. 3"), captions
that cite the source and the time of the data. Charts are drawn with editorial restraint: direct labels
at the end of lines instead of legends, hairline grids, values printed on the bars.

The live moment is treated as an editorial correction. When an agent adds or changes a panel, the figure
gains a vermilion margin rule, its kicker turns into an attribution ("Added by agent, #412") and a stamp
carries the causing change `seq`. A dark ledger band at the foot of the viewport, like a wire-service
ticker, lists the changes themselves, newest largest. Nothing animates on initial load; the only motion
anywhere is caused by a realtime event.

## Token system (`css/tokens.css`)

All colour is OKLCH, defined once with `light-dark()` (daylight and evening editions follow the system).

| Role | Light | Notes |
|---|---|---|
| paper / surface / sunken | L .968 / .992 / .940, hue 88, chroma .006-.015 | warm off-white |
| ink / ink-2 / ink-3 | L .24 / .44 / .52, hue 255 | blue-black text, all >= 4.5:1 on paper |
| accent | oklch(.42 .11 258) | ink blue: links, selection, sparklines |
| signal | oklch(.52 .17 32) | vermilion: live, cause, threshold breach |
| series 1-5 | blue, ochre, teal, plum, olive at L .44-.55 | always paired with a direct label or a marker shape |
| heat lo / hi | paper-tone to ink blue, mixed with `color-mix(in oklch)` | on-heat text flips at t > .5 |

- Type: serif stack (Iowan Old Style, Charter, Sitka Text, Palatino, Georgia) for headings and numerals,
  system sans (Segoe UI Variable, system-ui) for data, system mono for seq numbers. Scale `--text-xs`
  .75rem to `--text-display` (fluid `clamp()`), numerals tabular.
- Wall display: root font size is `clamp(16px, .75vw + 6.4px, 28px)`, so the whole interface, including
  chart text and margins (JS reads the root size), scales from 1280 px to 1920 px.
- Space: 4 px base, `--space-1..8`; `--gutter` and `--board-gap` are fluid. `--row-h` is the grid row unit.
- Shape and depth: 2 px and 6 px radii, one hairline shadow, one overlay shadow. Depth comes from rules.
- Motion: `--dur-1..3` collapse to 0 under `prefers-reduced-motion`; keyframes exist only for causal arrival.

## CSS architecture

`styles.css` declares `@layer reset, tokens, base, layout, components, utilities, overrides;` once and
imports one file per concern; every rule in every file sits in a layer. `!important` appears only in
`overrides.css` (`[hidden]`, print). Container queries drive the board (phone stacking below 44rem of
board width), each panel (kicker detail) and the ledger (single-line phone form). `:has()` powers the
ledger's expanded state. Logical properties throughout, native nesting for state-driven blocks, flat
low-specificity selectors elsewhere. `forced-colors` gets explicit borders, system colours and non-colour cues.

## Layout and information architecture

1. Masthead: product, breadcrumb, live state, identity switch (labelled native `select`), presence.
2. Report heading: eyebrow, dashboard title (the only `h1`), dek that states the latest change and who
   made it, dateline (revision, figures, latest change).
3. Figures: a 12-column grid honouring `at`; reading order (y, then x) is DOM order, so phones stack
   in order. Each panel: kicker (figure number, type), title, plot, caption (source, rows, as-of).
4. Ledger: sticky band; `seq` large, `live` / `replay` / `ui` tag, actor, node kind and title, ops
   summary, rule chips. On first connect the last eight changes are replayed into it (flagged backfill,
   no motion). On phones it shows the newest change and expands on request.
5. Inspector: a right-hand sheet (`dialog`) with identity, formatted query clauses, visual spec,
   result metadata. Colophon: audit hash chain status.

## Accessibility

Landmarks (`header`, `nav`, `main`, `aside`, `footer`), one `h1`, panels are `section`s labelled by
their `h2`. The ledger list is `aria-live="polite"` with additions only; panel changes also go to a
shared status region. Charts are `role="img"` with `<title>`, `<desc>` and a computed summary; every
non-table chart has "View as table" (a `menuitemcheckbox`) revealing a real `<table>`. Breaches carry a
hatch, a triangle glyph and text, never colour alone; series differ by marker shape. The panel menu
follows the menu-button pattern (arrow keys, Escape, focus return). The inspector focuses its heading on
open and returns focus to the menu button on close. Brushing is also keyboard operable (arrow keys,
Shift to resize, Escape). Visible 3 px focus rings; skip link; scrollable regions are focusable.

## JavaScript

ES modules, no globals: `api`, `realtime` (resume with `since_seq`, backoff, `online` retry), `board`
(data), `view-board` (reconcile panels by slug, attribute causes), `panel`, `charts/*` (one module per
visual plus `svg`, `scales`, `host`), `trace`, `inspector`, `menu`, `masthead`. DOM is built with a
tiny `h()` helper using text nodes only. Charts measure only in a `ResizeObserver` and redraw in
`requestAnimationFrame`.

## What I would do next

Hover crosshair tooltips shared across series, a real legend-free multi-series stacked-bar annotation
(bars currently use a compact series key), saved brush ranges shared across panels, a print stylesheet
that lays figures out as a paginated report, and a theme toggle alongside the system preference.
