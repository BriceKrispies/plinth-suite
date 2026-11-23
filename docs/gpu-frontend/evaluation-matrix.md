# GPU frontend: evaluation matrix and recommendation

Inputs:
- the brief, `BRIEF.md`;
- five proposals in `proposals/`: Orbit, Township, Instrument, Atelier and Constellation, about 13,000 lines in all;
- three adversarial reviews in `reviews/`: `judge-feasibility.md`, `judge-experience.md` and `judge-access.md`.

## Rankings by lens

| Rank | Feasibility and architecture | Experience and visual impact | Accessibility and daily use |
|---|---|---|---|
| 1 | Orbit | Township | Township |
| 2 | Atelier | Orbit | Orbit |
| 3 | Township | Constellation | Instrument |
| 4 | Instrument | Atelier | Atelier |
| 5 | Constellation | Instrument | Constellation |

Borda count (5 points for 1st down to 1 for 5th): **Township 13, Orbit 13**, Atelier 8, Instrument 6, Constellation 5.

## Scores

Experience judge (1–10):

| Proposal | Wow | Meaningful 3D | Enterprise | Wayfinding | Demo | Phone | Domain coherence | Total |
|---|---|---|---|---|---|---|---|---|
| Township | 9 | 7 | 6 | 9 | 9 | 7 | 7 | 54 |
| Orbit | 7 | 7 | 8 | 6 | 8 | 4 | 8 | 48 |
| Instrument | 5 | 7 | 9 | 4 | 6 | 5 | 8 | 44 |
| Constellation | 9 | 7 | 4 | 3 | 8 | 4 | 5 | 40 |
| Atelier | 8 | 4 | 5 | 3 | 7 | 4 | 6 | 37 |

Feasibility judge (1–10; for authoring cost, higher means cheaper):

| Proposal | Stack | A11y mirror | Authoring cost | Backend | Perf | Plan |
|---|---|---|---|---|---|---|
| Orbit | 6 | 9 | 4 | 9 | 5 | 8 |
| Township | 7 | 7 | 8 | 5 | 6 | 7 |
| Atelier | 5 | 8 | 6 | 3 | 5 | 8 |
| Instrument | 5 | 5 | 3 | 3 | 4 | 7 |
| Constellation | 4 | 6 | 5 | 4 | 4 | 6 |

## What all five agree on, and what none of them has proven

All five converged on the same core:
- **three.js `WebGPURenderer` with TSL**, so one shader source runs on WebGPU and on its WebGL2 backend;
- **one view tree per widget** that drives both the GPU scene and a **real semantic DOM layer** over the canvas. That layer owns focus, screen readers, selection, IME, autofill and find-in-page. Shown with a plain stylesheet, it is also the no-GPU mode.

That convergence is itself a finding: nobody found a credible way to do enterprise forms and accessibility in a
pure canvas.

Unproven across all five, so these must be spiked before anything is committed (`judge-feasibility.md` lists six spikes):
1. **GPU-drawn text over a transparent DOM layer.** Alignment within 1 CSS px, selection, IME, native scrolling,
   zoom to 200% and text spacing. If this fails, every proposal falls back to visible DOM text in 3D panels.
2. **WebGL2 parity of the central materials** in three r180: per-attachment blending, integer attributes, storage
   buffers and compute.
3. **Forced colours.** Four specs keep mirror text `transparent`, which forced-colours mode overrides, so text would be
   drawn twice. Needs `forced-color-adjust` handling and a switch to visible DOM.
4. **`ui.present` does not reach browsers today.** The MCP tool writes nothing and the rt gateway forwards nothing.
   Only Orbit and Constellation plan the gateway change.

## Recommendation

**Township as the base, with grafts from Orbit, Instrument and Atelier, gated by a spike.**

**Why Township:**
- It ranks first on both experience and accessibility, and has the lowest widget authoring cost.
- It is the most literal expression of the owner's model: each domain is a district, and each widget is an app
  you walk into.
- It has the strongest demo, with a rebuild that literally constructs the city, and the best wayfinding for a
  first-time viewer.

**Its weaknesses to fix:**
- Interiors are flat, so the GPU adds little once you are inside.
- The `ui.present` claim is wrong.
- The text gate is too lax.
- Art direction is unplanned.

**Grafts:**
- **From Orbit:**
  - UI text is never tonemapped or bloomed;
  - the correct `ui.present` gateway change;
  - the agent as a visible light with a follow-the-agent pose and an off-screen indicator;
  - the G1 spike gate before any widget wave;
  - kill criteria K1–K7.
- **From Instrument:** depth inside the buildings: heatmap to terrain, ledger to flow ribbon, an exploded
  permission matrix by role, GPU table filtering and chart morphs. This answers "interiors are flat".
- **From Atelier:** a stamp per MCP call along the agent's trail, the vellum revision fan for content diffs, and
  building Paper/Plain mode first as the harness.
- **From Constellation:** the timeline scrubber and the automation circuits as a visible pulse through steps.
- **From the access review:**
  - the 14 must-add requirements: forced colours shows the DOM; single-key shortcuts off by default; a visible
    Motion control; focus never waits on camera motion; rendered-pixel contrast tests; and the rest;
  - a task-time study as the gate before cutover.

**The runner-up option, if the owner prefers calm over charm:** Orbit, as a spatial workspace. It has the best
architecture and accessibility contract, but its reading pose looks like a flat page with shadows and its phone
experience drops the 3D.

## Proposed next step, ordered by dependency

1. **Spike (gates everything else).** In a new `packages/gpu-spike`: three r180 WebGPU and WebGL2, one Township
   building interior holding one real widget (`points.ledger`). Cover GPU MSDF text over the transparent DOM mirror,
   native scroll, selection, IME in a form field, zoom 200%, forced colours, and the frame time on this machine's GPU.
   Measure against Township's and Orbit's kill criteria.
2. **Spec synthesis**: the merged Township+grafts spec, written into `docs/gpu-frontend/spec/` with the access
   judge's must-adds as numbered requirements.
3. **The `ui.present` gateway change** in the backend, which is independent and can run alongside 1.
4. Only then the city shell, the rebuild choreography and the widget waves.
