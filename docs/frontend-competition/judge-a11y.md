# Judge review: accessibility and semantic HTML

Lens: landmarks, headings, accessible names, identity control, dialog focus, polite live regions, SVG chart accessibility, non-colour breach signalling, focus styles, forced-colors and reduced-motion. Sources: each prototype's `index.html`, the JS that builds the DOM, the CSS focus and media rules, and the desktop screenshots. Live-run facts are the coordinator's observations.

## Scores (0 to 10, this lens only)

| Rank | Prototype | Score | One-line verdict |
|---|---|---|---|
| 1 | Lattice | 8.0 | Broadest set of native and ARIA-correct primitives; live trace gated by a busy flag that needs a check |
| 2 | Folio | 7.6 | Best announcement wording and focus handling; chart rendering bug undermines its SVG alternative |
| 3 | Meridian | 7.4 | Solid panel/menu/inspector model with focus restore and live refresh; local-time trace with no zone |
| 4 | Strata | 6.9 | Good breach text and region scroller; trace seq read without a "change" word; "nullnull" text |
| 5 | Nocturne | 6.8 | Strong heading and landmark structure; stray "null" text and announcements that never fired in the live run |

Scores are close. The gap between rank 1 and rank 5 is about 1.2 points and rests on a few concrete items below.

## Cross-cutting findings

- All five use `<a class="skip-link">`, a labelled `<select>` for identity, `aria-live` regions for the trace, `role="img"` SVG roots with `<title>` and `<desc>` (or `aria-label`), and `textContent`/DOM APIs. No prototype relies on colour alone for breach: all five pair a hatch or pattern with text (Meridian `chart-grid.js:117-120` "▲ N above threshold"; Nocturne `charts/bar.js:54` note plus triangle marker; Folio `charts/bar.js:121` `breach-glyph` labels; Lattice `charts/bar.js:99-103` hatch, triangle and `breachNote`; Strata `panel.js:99-101` "▲ N over limit" flag, and the desktop shot shows "▲ 1 over limit").
- All five have a `prefers-reduced-motion` block and a `forced-colors` block. Depth varies (see per-prototype notes).
- Table alternatives exist in all five. Table caption and `scope="col"` appear in Meridian `visuals.js:30-31`, Nocturne `charts/datatable.js:37`, Folio `charts/table.js:16-18`, Lattice `charts/table.js:36,62`, Strata `visuals/table.js:13-16`.
- None of the five announces the "panel added" moment with a dedicated status line that is guaranteed to fire while the board is unchanged. The announcement paths exist (see below), but the live run showed Meridian and Nocturne did not add the panel, so their announcements did not fire at the key moment.

## Lattice (8.0)

Strengths
- Native disclosure for the Display menu: `<details class="menu menu--display">` with `<fieldset>`/`<legend>` radio groups for Theme and Density (`index.html`, Display block). No custom focus trap needed.
- Inspector: `dialog.insp` with `aria-labelledby`, a close button with `aria-label="Close inspector"`, focus returned to the trigger on `close` (`js/inspector.js`, `dialog.addEventListener('close')`).
- Sortable tables use real `<button class="th-sort">` inside `<th scope="col">` with `aria-sort` (`js/charts/table.js:36-38`), and the caption says "Column headers sort the table."
- Chart descriptions are generated from data (`js/charts/bar.js:54`, `heatmap.js:35`, `scatter.js:45`), so the SVG alternative is informative, not decorative.
- Cause announcements are written in full: `"... Caused by change N from <actor>."` (`js/views/dashboard.js:161`).
- Forced-colors coverage spans four files (`css/base.css:50`, `charts.css:280`, `controls.css:313`, plus the chart line and threshold strokes). Motion is opt-in with `prefers-reduced-motion: no-preference` (`css/panel.css` and `charts.css`), which is the safer default.
- `aria-busy` on the trace list during backfill, released after live (`js/main.js:100-106`), so the initial replay is not read out line by line.

Weaknesses
- The trace list is `aria-busy="true"` in the markup and only released after the socket reaches `live` plus 900 ms (`js/main.js:106`). If the first connection never reaches `live`, the trace announcements stay suppressed. Needs a fallback release on a timer or on the first live event.
- `<main id="main" aria-label="Content">` (`index.html`) is a generic name. The board title is an `h1` inside, so `aria-label` is redundant and overrides the heading as the name.
- Live run: the trace DOM did not update (still showed seq 12 first), so the trace path could not be confirmed live.
- The blue "ADDED by agent" banner and highlight are visible, which is good, but the banner text is the only non-colour attribution. Acceptable, and better than most.

## Folio (7.6)

Strengths
- Announcement wording is the most complete of the five: `"Panel added: <title>, by <actor>, change N."` and `"Panel updated: ..."` (`js/view-board.js:74,133`), sent through a debounced `announce()` that clears first (`js/dom.js:28-38`).
- Inspector focuses its own `h2` on open (`tabindex="-1"`, `js/inspector.js` `title.focus()`), returns focus to the opener on close, and closes on backdrop click.
- Identity control is a labelled `<select>` inside `role="group" aria-label="Identity"` (`index.html`), with the avatar hidden from AT.
- Presence is a real `<ul role="list">` (`index.html`); the self avatar is `role="img"` with `aria-label` "You, <name>" (`js/masthead.js:20`).
- Table toggle is a `menuitemcheckbox` in the panel menu ("View as table", `js/panel.js:29`), with `disabled` set when no table is possible.
- Forced-colors handling is specific: the panel border, the `data-cause` left rule and the stamp use system colours (`css/panel.css:98-102`). `main:focus { outline: none }` is limited to the programmatic focus target. `:focus:not(:focus-visible)` removes the ring for mouse users (`css/base.css:23-29`).
- Print stylesheet hides masthead and trace (`css/overrides.css:9-12`).

Weaknesses
- Live run: Folio's bar chart draws axes and no bars. Its `role="img"` description (`charts/bar.js:59`) still reads out the highest and lowest values, so a screen reader user gets data that a sighted user cannot see. This is a rendering defect that the accessibility layer currently hides from no one.
- The new bar panel's axis labels overlap (live run). Overlapping text is a legibility failure for low-vision users.
- `forced-colors` rule `.chart .bar { fill: CanvasText }` (`css/charts.css:57`) targets a class the empty bar chart does not produce, so the forced-colors bar path is untested in practice.
- The chart frame is `role="group"` (`charts/xy.js:199`) while `root()` already sets `role="img"`; the nested roles are contradictory. Minor.

## Meridian (7.4)

Strengths
- Panel is a `<section aria-labelledby>` with a real `h2` (`js/panel.js` constructor). The "Table" toggle is `aria-pressed` with a state-describing `aria-label` ("Table view of X").
- Roving-focus menu with arrow keys, Home/End, Escape, outside pointer close, and focus restored to the trigger (`js/panel.js` `createMenu`). The menu items are `role="menuitem"` inside `role="menu"` with `role="none"` wrappers.
- Inspector: `autofocus` on Close (`js/inspector.js`), focus returned to the opener on `close`, and `refresh()` keeps focus inside the dialog when a realtime change re-renders it (`hadFocus` branch). This is the most careful focus model in the set for a live-updating modal.
- Trace items carry a screen-reader prefix: `<span class="sr-only">Change </span>#N` (`js/trace.js`), so the sequence reads as "Change #12" instead of a bare number.
- Chart SVG is `role="img"` with `aria-labelledby` pointing to `<title>` and `<desc>` (`js/chart-kit.js:94-109`), plus a bar-by-bar `<title>` for each mark (`chart-grid.js:87,99`).
- Forced-colors and reduced-motion blocks; reduced-motion uses `!important` in the single allowed overrides layer (`css/overrides.css:10-13`).
- Theme toggle label carries its state: `aria-label="Colour theme: auto. Activate to change."` (`js/masthead.js:62`).
- Desktop shot: "Waiting for changes" with "Head #12" in the trace footer; table toggles are plain text labels ("TABLE").

Weaknesses
- Trace time is rendered with `clockSeconds(Date.now())` in a `<time>` element with no `datetime` attribute (`js/trace.js` `eventItem`). The brief requires the audience to see UTC (the data is UTC, 14:30); local time (08:30) is read out as if it were the same clock. Use `datetime` in UTC and display the zone.
- Live run: Meridian updated its trace but did not add the panel to the board. The announcement path (`dashboard.js:218`) only fires for notes it generates, so a silent failure to render means no "panel added" announcement reaches AT users.
- The footer `ribbon` is a `<footer aria-label="Trace ribbon">` at body level, which becomes a contentinfo landmark. Ribbon-as-contentinfo is an unusual landmark choice; a labelled `<section>` or `role="region"` would describe it better.
- The board `section` uses `aria-busy="true"` until load (`dashboard.js:63`), which is correct, but the `h1` is set to the slug first (`dashboard.js:60`), so a slow load reads the slug as the title.

## Strata (6.9)

Strengths
- Trace is a labelled region: `<div class="trace__scroller" tabindex="0" role="region" aria-label="Recent changes, newest first">` (`index.html`), with an `aria-live="polite" aria-relevant="additions"` list (`data-trace-list`). The footer is `hidden` until data arrives, so the empty state does not announce.
- Breach is conveyed three ways: hatch fill, text flag "▲ N over limit" (`js/panel.js:99-101`), and the heatmap cell title "(over limit)" (`visuals/heatmap.js:71`). The desktop shot shows the flag rendered next to the heatmap title.
- Inspector: `autofocus` on the close button with `aria-label="Close inspector"`, `section` headings with `aria-labelledby` ids (`js/inspector.js:15-16`), and a live refresh that updates the open dialog in place.
- Identity control has a `label for` and a wrapper that shows focus with `:has(:focus-visible)` (`css/masthead.css:170-176`), so the ring sits on the whole control.
- Forced-colors block covers the panel, trace, inspector, menu, banner and masthead (`css/overrides.css:18-25`). Reduced-motion is set in two places (`css/base.css:6`, `layout.css:93`) and in the overrides layer.
- Announcer clears then sets text on the next animation frame (`js/main.js:14-18`), so repeated sentences announce again.

Weaknesses
- Trace sequence is rendered as `<span aria-hidden="true">#</span>12` (`js/trace.js` `beat`), so a screen reader reads only "12". Meridian's "Change #12" reads better in a live region.
- The header displays "nullnull" at top right in the desktop shot. It is visible text that AT reads, and it signals an unfinished binding.
- Trace footer is a `<footer>` with `aria-labelledby` (a contentinfo landmark), same as Meridian.
- Live run: Strata updated its trace but did not add the panel to the board. The `announce()` call for panel changes (`dashboard-view.js:151`) is keyed to the causes map, so a missing panel gives no announcement.
- `aria-busy="true"` on the skeleton section is set with `aria-label="Loading panel"` (`dashboard-view.js:50`), which is fine, but the skeleton `section` is then a named region before its content exists.

## Nocturne (6.8)

Strengths
- Best heading and landmark skeleton: `h1#page-title` in the masthead, `main aria-labelledby="page-title"`, and the trace is `<aside aria-labelledby="trace-title">` with an `<output for="trace-list">` for head seq (`index.html`).
- Icon sprite is `aria-hidden="true" focusable="false"` and every icon sits beside a text label (comment in `index.html`). The brand link has `aria-label="Plinth, all boards"`.
- Connection state is `role="status"` (`index.html`, `.conn`), and the offline banner is `role="status"`.
- Theme toggle is an `aria-pressed` button with a fixed label "Light theme" (`js/main.js`), so the state reads as "Light theme, toggle button, pressed or not".
- Inspector heading takes focus on open (`js/inspector.js`: `Focus moves to the heading on open`), `section aria-label` on each block, `tabindex="0"` on `pre` blocks.
- Charts are built through `chartFrame` with `role="img"` and `aria-labelledby` (`charts/frame.js:30-32`); `datatable.js` uses `role="region"` with `tabindex="0"` for scrolling tables and `aria-sort` on sortable headers.
- Announcement text carries the cause: `"Panel <title> added by <actor>, seq N. N panels on the board."` (`js/board-view.js:132`).
- Forced-colors block (`css/overrides.css:10-17`) and reduced-motion block (`css/panel.css:52`).

Weaknesses
- Visible text "null" at top right of the board header (desktop shot) and in the `board` meta. Same defect class as Strata: an unfinished binding that AT reads.
- Live run: Nocturne's trace cards and the board did not update, though the head-seq counter did. Since the announcement is raised from the board update path (`board-view.js:132`), no "panel added" message fired in the live run.
- `menu` button text is an icon only, with `aria-label` set to the menu label (`js/menu.js`), so the label is good, but there is no visible affordance for the table/chart toggle except the "View as table" button; acceptable.
- Trace is `<ol tabindex="0" aria-live="polite">` (`index.html`). Making the live list focusable is a reasonable keyboard path, but it also means keyboard focus enters a region that moves as items arrive.

## Ideas to graft into the winner, whichever it is

1. Meridian's `sr-only` "Change " prefix on trace seq (`js/trace.js`), so the sequence reads as a sentence.
2. Meridian's `refresh()` pattern for the inspector: re-render in place and restore focus to the close button if focus was inside (`js/inspector.js`).
3. Folio's announcement wording: "Panel added: <title>, by <actor>, change N." (`js/view-board.js:74`), plus a debounced `announce()` that clears first (`js/dom.js`).
4. Strata's breach flag as text next to the panel title ("▲ N over limit", `js/panel.js:99-101`), so a breach is never colour-only at the panel level.
5. Lattice's `aria-sort` plus `<button class="th-sort">` in headers (`js/charts/table.js:36-38`), and the caption that tells the user headers sort the table.
6. Lattice's native `<details>` display menu with `<fieldset>`/`<legend>` radio groups (`index.html`), which avoids a custom menu for simple settings.
7. Nocturne's `<output for="trace-list">` for head seq, and `h1` plus `main aria-labelledby` on the board title.
8. Trace time in UTC inside `<time datetime="...">` with the zone shown, never local time alone (fixes the Meridian/Lattice 08:30 vs 14:30 mismatch).
9. A chart-table toggle that is `aria-pressed` with a state-describing `aria-label`, in the panel head, as in Meridian `js/panel.js` and Nocturne `js/panel.js`.
10. Forced-colors coverage per component (panel, trace, inspector, menu, banner) rather than one block, as in Strata `css/overrides.css:18-25`.
11. Folio's `:focus:not(:focus-visible) { outline: none }` with a visible `:focus-visible` ring, plus `main:focus { outline: none }` only for the programmatic target.

## Fixes any winner needs

- Replace the "null" and "nullnull" bindings (Nocturne, Strata) with empty strings or an explicit "No title" fallback.
- Give the trace a UTC `<time datetime>` and a zone label (Meridian, Lattice).
- Make the Folio bar chart draw its bars; the description currently describes data that is not visible.
- Confirm Lattice's trace releases `aria-busy` on a timer or first event, not only on `live`.
- Confirm that a new panel fires an announcement even when the board re-render is slow (Meridian, Nocturne, Strata did not add the panel in the live run).

## Method and limits

- Read: each `index.html`, the JS modules that build the DOM for the inspector, panel, trace and masthead, and the focus, `prefers-reduced-motion` and `forced-colors` rules. Grep for `aria-*`, `role`, `<title>`, `<desc>`, `<caption>`, `scope`, `showModal`, and `announce`.
- Viewed: desktop screenshots for Meridian, Nocturne, Folio, Lattice and Strata. Phone, wall and live shots were not inspected for this lens; the live-run facts are taken from the coordinator's brief.
- Not run: no browser, no screen reader, no contrast measurement. Findings are from source and static screenshots, so keyboard and AT behaviour is inferred from code paths, not observed.
