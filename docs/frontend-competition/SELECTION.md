# Frontend competition: selection

**Winner: Meridian (Swiss precision).** It becomes Plinth's frontend and replaces the React client.
The other four prototypes stay in `packages/web/public/proto/` as a record.

## Scores (three independent judges, 0–10 per lens)

| Prototype | Visual and IA | Accessibility and semantics | CSS/JS architecture | Mean |
|---|---:|---:|---:|---:|
| **Meridian** | **8.5** | 7.4 | 7.1 | **7.67** |
| Lattice | 7.0 | **8.0** | 6.8 | 7.27 |
| Folio | 6.5 | 7.6 | **7.6** | 7.23 |
| Nocturne | 7.5 | 6.8 | 6.2 | 6.83 |
| Strata | 5.5 | 6.9 | 6.4 | 6.27 |

Full reviews: `judge-visual.md`, `judge-a11y.md`, `judge-arch.md`. Screenshots: `shots/`.

## Why Meridian

- **The strongest, most credible identity.** Its typography is the structure: tabular hero numerals,
  tracked small-caps labels, hairline rules instead of boxes, and one vermilion accent kept for
  "live", attribution and breaches. It reads as serious enterprise software without the stock
  design-system look the visual judge held against Lattice and Strata.
- **The trace reads as an instrument.** The newest change is shown at display size and older ones
  dimmed. On a phone it collapses to one line with a "Show recent" control.
- **Accessibility is solid:**
  - roving-focus menus (arrow keys, Home/End, Escape, focus restore);
  - an inspector that keeps focus while it live-updates;
  - labelled panel regions;
  - `aria-pressed` table toggles;
  - accessible SVG with a title, a description and per-mark titles.
- **The defects are local.** The losers' defects are more expensive to fix: Folio's bar geometry,
  Nocturne's and Lattice's stale trace, Strata's charts that do not render at phone width.

## Fixes required in the winner

1. **Incremental realtime updates.** Today every event triggers a full board reload and re-runs
   every panel's query, so a new panel arrives late. An event re-fetches only the node it names: the
   dashboard for layout changes, or the one panel. Only the queries of affected panels re-run. The
   attribution then appears within a frame of the event.
2. **UTC everywhere.** Format all times in UTC with the zone marked (`14:30:00 UTC`). Every `<time>`
   element gets a `datetime` attribute.
3. **Minimum chart heights.** Category and value labels must never collide: a bar panel at `h: 2`
   still has room for its axis. Reduce ticks or rotate labels before clipping.
4. **The heatmap breach must read at a glance.** Draw breach cells in the accent with hatch and a
   glyph, not as a slightly different grey.
5. **The live indicator** scales with the viewport on wall displays.
6. **Before load,** `h1` must not show the slug as the title. Use a skeleton heading.

## Ideas grafted from the other prototypes

- **Lattice:** a full-width solid attribution band inside the new panel for the attribution
  window: "Added by agent claude-code · mcp · seq N". Sortable table headers as buttons with
  `aria-sort`. Forced-colors coverage across all component CSS.
- **Nocturne:** a text row under a breaching chart that spells out the threshold ("1 cell over
  600 ms: Crane / EMEA 759.9"). A footer that states "Times are UTC". Large monospaced seq numerals
  in the trace, readable across a room.
- **Folio:** a dek under the board title that rewrites itself to the latest change and who made it.
  On load the trace backfills the last eight changes, without motion. Each panel carries a source
  and as-of caption.
- **Strata:** value labels on bars when they fit.
