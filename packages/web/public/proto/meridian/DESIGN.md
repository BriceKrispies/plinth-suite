# Meridian: Swiss precision for Plinth

Open at `/proto/meridian/` (index) or `/proto/meridian/?d=ops-board`. `?as=` selects the identity.

## Artistic intent

International Typographic Style applied to operations software. Typography is the structure: a heavy,
tightly tracked grotesque title, small tracked capitals for labels, and numbers set in tabular
lining figures as the hero of every tile. Boxes are replaced by hairline rules: each panel hangs from a
1 px ink rule, the masthead from a 6 px rule. The palette is near-monochrome and the single accent
(vermilion) is a signal, never decoration. It marks exactly three things: a change attributed to an event,
a threshold breach, and the live connection mark. When an agent adds a panel, the viewer sees the accent
rule draw across the top of it, the panel reveal, and a solid tag reading `#412 Added by agent planner`.

## Token system (`css/tokens.css`)

Colour is OKLCH, paired with `light-dark()` so the dark theme is a designed counterpart, not an inversion.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | 0.992 0.002 90 | 0.17 0.009 260 | page |
| `--paper-2` | 0.962 0.003 90 | 0.215 0.010 260 | code blocks, empty tiles |
| `--ink` / `--ink-2` / `--ink-3` | L 0.19 / 0.38 / 0.49 | L 0.965 / 0.80 / 0.70 | text, secondary, muted (all at least 4.5:1) |
| `--rule` | 0.87 0.004 260 | 0.32 0.011 260 | hairlines |
| `--accent` | 0.55 0.215 29 | 0.72 0.185 32 | signal only |
| `--series-0..4` | ink, slate blue, grey, teal-grey, light grey | lifted equivalents | charts; also told apart by dash and marker shape |
| `--ribbon-*` | near-black strip in both themes | | the trace instrument |

Type: system grotesque stack (Helvetica Neue, Helvetica, Nimbus Sans, Arial Nova, Arial) and a system mono, no web fonts.
Scale: `--step--2` 0.6875rem, `--step--1` 0.8125rem, `--step-0` 1rem, `--step-1` and `--step-2` and `--step-3` fluid with `clamp()`.
The root size itself is fluid: 16 px at 1280, about 21 px at 1920, so the wall display scales every rem value, including the ribbon.
KPI figures use container units: `clamp(2.75rem, 21cqi, 8rem)` of the panel's own width.
Space: 4 px grid, `--space-1` to `--space-8`. Radius is 0. Elevation is a hairline plus one floating shadow for the menu and dialog only.
Motion: `--dur-1/2/3` 120/260/700 ms, one easing curve, `--cause-hold` 6 s.

## Layout and information architecture

- Masthead: product, breadcrumb, then tools (live status, labelled "Viewing as" identity select, presence avatar, theme).
- Board header: a 12-column split. The title takes 8 columns; the facts (revision, panel count, audit chain verification) hang from a hairline in the other 4.
- Panel grid: a 12-column CSS grid honouring each `at`, with `--x --y --w --h` set per panel and consumed in the layout layer. Below 48rem it becomes one column in reading order (sorted by y, then x), with height proportional to the declared rows.
- Panels are numbered 01, 02, ... so a presenter can refer to them; the number is decorative and hidden from assistive tech.
- Trace ribbon: a sticky, always-dark instrument strip. The newest event is a larger block (seq at display size, tag, actor, kind and title, ops summary, rule chips). Tags: `LIVE` solid signal fill, `REPLAY` dashed, `UI` solid outline, `SESSION` dotted. On a phone it collapses to one line with a toggle.
- Inspector: a modal `dialog` with identity, formatted query, visual spec JSON and result metadata (as_of, rows, policy hash, plan summary, watermarks). It stays current if a live change touches its panel.
- States: first-load skeleton (static, no shimmer), per-panel empty ("No rows for this query" plus the query summary) and error (code and message), board empty, unknown board, load failure, and an offline banner with automatic reconnect and `since_seq` resume.

## Code structure

CSS: `styles.css` declares `@layer reset, tokens, base, layout, components, utilities, overrides;` once and imports six files each into its layer. Container queries drive panel content; `:has()` drives the phone ribbon; nesting, logical properties, `color-mix()` and `light-dark()` throughout. `!important` appears only in the overrides layer (`[hidden]`, reduced motion).
JS: ES modules with no globals: `api`, `rt` (socket with backoff and resume), `board` (load, diff, cause attribution), `panel`, `visuals`, `chart-kit`, `chart-xy`, `chart-grid`, `trace`, `inspector`, `masthead`, `dashboard` (controller), `index-page`, `main`. DOM is built with a small `h()`/`s()` helper that only uses text nodes and `setAttribute`, so no data reaches `innerHTML`. Charts redraw from a `ResizeObserver` throttled to one frame and only when the measured size changes.

## Animation honesty

Nothing animates on load. `attributeCauses` compares the previous and next board and animates only panels whose revision, result hash, error or layout changed while a realtime event was pending; the cause shown is that event's `seq`. Reduced motion removes the motion but keeps the tag and the signal rule.

## Accessibility

- Landmarks: `header`, `nav` (breadcrumb), `main`, `footer` (trace), `aside` (parameters), modal `dialog`. One `h1`; panels are `section`s named by their `h2`.
- Live updates: the trace list is `aria-live="polite"`; a separate `role="status"` region announces "Panel added: X, change 412" and "Panel changed".
- Identity switch is a native `select` with a visible label. The inspector uses `showModal()`, focuses its Close button, and returns focus to the panel's menu button on close (also on Escape).
- The panel menu follows the menu pattern (arrows, Home, End, Escape, focus return). Table toggle uses `aria-pressed`.
- Charts are `role="img"` SVGs with `<title>` and a computed `<desc>`, each with a real `<table>` alternative. Breaches use a hatch fill, a triangle glyph and a sentence of text in addition to colour. Series differ by dash and marker shape.
- Visible 3 px focus ring, 4.5:1 text contrast, 44 px touch targets on coarse pointers, `forced-colors` rules in the overrides layer.

## What I would do next

Keyboard brushing and arrow-key readout on line charts; column sorting in tables; per-panel loading state so slow queries do not hold the board; a presence list fed by the server instead of a single avatar; a compare-with-previous-revision view in the inspector; print stylesheet for the board.
