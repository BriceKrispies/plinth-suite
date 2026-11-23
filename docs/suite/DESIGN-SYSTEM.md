# Plinth Suite design system

Status: specification for the design-system (DS) builder. Four domain packages build widgets on top of it in parallel,
so every name, path and signature in this document is fixed. Where this document and the code disagree after the DS
builder lands, the code is wrong until this document is changed.

Related fixed contracts: `packages/spec/src/suite/primitives.ts` (ICON_NAMES, TONES, ARTWORK_PATTERNS, Artwork, Avatar),
`packages/spec/src/suite/events.ts` (status vocabularies), `packages/spec/src/suite/conditions.ts` (CondTree, FactDef).
Route and data contracts are in UI-MAP.md and are not repeated here.

Contents

1. Intent
2. Cascade and files
3. Tokens
4. Elevation tiers and surfaces
5. App shell
6. Components
7. Generated artwork
8. Icons
9. Patterns
10. Themes
11. Accessibility checklist
12. Acceptance criteria for the DS builder

---

## 1. Intent

The Suite is a dense, multi-module application: messages, points, orders, promotions, content, tasks, approvals,
reports and an audit log share one shell. Meridian's Swiss discipline carries over unchanged in its core rules, and
gains the structure a dense app needs.

- **Typography is structure.** Hierarchy comes from the grotesque, small tracked capitals for labels, and tabular
  figures for every number. Boxes are rare; sections hang from hairline rules.
- **Hairlines carry structure.** `--rule` separates regions and rows. It is decorative. Anything a user must operate
  gets its own boundary colour (`--control-border`).
- **Accent is a signal, never decoration.** `--accent` marks exactly three things: a change attributed to an event,
  a threshold breach, and the live connection mark. Status colour uses the semantic tones in section 3, not the accent.
- **Elevation is new, and restrained.** Five tiers (section 4) give floating layers (menus, toasts, dialogs) a
  defined surface, shadow, z-index and backdrop. Tier 0 and tier 1 stay flat.
- **Both themes are designed.** Every colour is OKLCH paired with `light-dark()`. The dark theme is a counterpart,
  not an inversion.

---

## 2. Cascade and files

### 2.1 Layer order

Declared once, in `packages/web/src/styles.css`, as the first statement of the file:

```css
@layer reset, tokens, base, layout, components, looks, modules, utilities, overrides;
```

`looks` holds the switchable site looks (`html[data-look]`); see section 6A.

Rules:

- Lower layers lose to higher layers regardless of selector specificity. Nothing in the suite relies on specificity
  to win against another layer.
- Only `tokens.css` defines the token custom properties on `:root`. No other file defines a token.
- `layer(modules)` is the only layer a domain package writes into (its widgets' CSS and, for package A, the shell's).
  It may style its own widgets. It may not restyle a DS component, redefine a token, or set a value that a DS
  component owns.
- `!important` appears only in `overrides.css` (`[hidden]`, reduced motion, forced colours, print). Any other
  occurrence fails the acceptance checks in section 12.
- Widget-local custom properties use the prefix `--w-<domain>-` (for example `--w-store-card-min`). Component-local
  private properties use `--_` and live inside the component file that owns them.

### 2.2 File table

The file table is fixed. Paths are relative to `packages/web/`.

| Path | Layer | Owner | Purpose |
|---|---|---|---|
| `index.html` | n/a | DS | Shell skeleton and mount points (section 2.3) |
| `scripts/check.mjs` | n/a | DS | Module syntax and import check (existing behaviour kept) |
| `vite.config.ts` | n/a | DS | Dev server: SPA fallback for every app route, `/api` and `/rt` proxies |
| `src/styles.css` | n/a | DS | The one `@layer` declaration and every `@import` (DS files and module CSS) |
| `src/ds/css/reset.css` | reset | DS | Layer reset |
| `src/ds/css/tokens.css` | tokens | DS | Every custom property, light and dark |
| `src/ds/css/base.css` | base | DS | Element defaults and typography |
| `src/ds/css/shell.css` | layout | DS | App shell grid: side nav, top bar, main, drawers region |
| `src/ds/css/components/<name>.css` | components | DS | One file per component module (section 6), same `<name>` as the JS module |
| `src/ds/css/utilities.css` | utilities | DS | `.sr-only`, `.u-tabular`, `.u-arrive`, spacing helpers |
| `src/ds/css/overrides.css` | overrides | DS | `[hidden]`, reduced motion, forced colours, print |
| `src/ds/js/<name>.js` | n/a | DS | Component modules (section 6) |
| `src/ds/js/dom.js` | n/a | DS | `h()`, `s()`, `$()`, `clear()`, `uid()`, `frameOnce()`; same contract as today's `src/js/dom.js` |
| `src/ds/js/icons.js` | n/a | DS | `icon(name, { label?, size? })`, the `<p-icon>` element |
| `src/ds/js/element-base.js`, `src/ds/js/elements.js`, `src/ds/js/people-picker.js` | n/a | DS | Custom-element base, the registry, and `<p-people-picker>` (section 6.29) |
| `src/ds/js/artwork.js` | n/a | DS | `artwork()`, `badgeArt()`, `avatarArt()` (section 7) |
| `src/ds/js/format.js` | n/a | DS | Number, points, date and text formatters (section 9.7) |
| `src/core/api.js` | n/a | DS | Request client |
| `src/core/rt.js` | n/a | DS | Realtime client |
| `src/core/router.js` | n/a | DS | History-API router |
| `src/core/bus.js` | n/a | DS | Page bus (UI-MAP 3.2) |
| `src/core/widgets.js` | n/a | DS | Widget runtime and registry: load, validate config, resolve bindings, mount in `widgetFrame` (UI-MAP 3.2, 4) |
| `src/core/page-host.js` | n/a | DS | Resolves a path to a Page and lays its widgets out on the page grid (section 13) |
| `src/core/widget-manifest.js` | n/a | DS | Widget id to module path for all 77 catalogue widgets |
| `src/core/widget-schemas.js`, `src/core/action-routes.js` | n/a | generated | Written by `pnpm schema:gen`; never edited by hand |
| `src/core/stores.js` | n/a | DS | `createStore()` and the stores `meStore`, `countsStore`, `prefsStore`, `clockStore`, `navStore` |
| `src/core/identity.js` | n/a | DS | Dev identity: `?as=<handle>` maps to a bearer token |
| `src/app/main.js` | n/a | DS | Boot: identity, `GET /suite/me`, realtime connect, stores, router start, `mountShell()` |
| `src/shell/**` | modules | package A | The shell: nav, top bar, balance chip, bell popover, palette, toasts (`src/shell/shell.css`) |
| `src/widgets/<domain>/**` | modules | the package owning the domain (UI-MAP 6) | Widget modules and `src/widgets/<domain>/<domain>.css` |

`styles.css` (DS-owned) imports `src/shell/shell.css` and every `src/widgets/<domain>/<domain>.css` into
`layer(modules)`; each package creates its files (empty is fine) and never edits `styles.css`.

### 2.3 index.html mount points

The DS owns the markup. Package modules render into the shell mount points only.

```html
<a class="skip-link" href="#main">Skip to content</a>
<div class="app" data-shell>
  <nav class="app__nav" id="app-nav" aria-label="Primary"></nav>
  <header class="app__topbar" id="app-topbar"></header>
  <main class="app__main" id="main" tabindex="-1"></main>
</div>
<div class="app__drawers" id="app-drawers"></div>
<section class="toasts" id="toasts" aria-label="Notifications"></section>
<dialog class="palette" id="palette" aria-label="Command palette"></dialog>
<p class="sr-only" id="announcer" role="status" aria-live="polite"></p>
```

- `#app-nav` and `#app-topbar` are filled by package A's `mountShell()` (`src/shell/shell.js`), using the DS shell
  layout and components of section 5. Badge counts are updated with `updateCount()` (section 6.14).
- `#main` belongs to the page host (`src/core/page-host.js`); widgets render only inside the element the runtime
  gives them. It is focused on route change (section 5.5).
- `#app-drawers` receives drawers and sheets.
- `#toasts` receives toasts; `toastRegion(el)` binds it once in `main.js`.
- `#palette` is the command palette dialog (section 5.4).
- `#announcer` is the single polite status region for route titles and form or action outcomes.

---

## 3. Tokens

All tokens live in `src/ds/css/tokens.css` on `:root`. Colours are OKLCH values inside `light-dark(light, dark)`.
The table gives the light value first and the dark value second. "Measured" ratios are WCAG 2.x contrast of the
pair as listed, computed from these exact values; the gallery page (section 12) must reproduce them.

### 3.1 Colour scheme

```css
:root { color-scheme: light dark; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

`light-dark()` resolves from the element's `color-scheme`, so forcing a theme needs only the `color-scheme`
declaration above. No token is redefined per theme.

### 3.2 Neutrals (Meridian names kept)

| Token | Light | Dark | Use | Measured |
|---|---|---|---|---|
| `--paper` | `oklch(0.992 0.002 90)` | `oklch(0.17 0.009 260)` | page background (`--surface-0`) | n/a |
| `--paper-2` | `oklch(0.962 0.003 90)` | `oklch(0.215 0.01 260)` | sunken areas, table header wash, skeletons, neutral tone background | n/a |
| `--ink` | `oklch(0.19 0.012 260)` | `oklch(0.965 0.004 90)` | primary text | 19.7 / 16.6 on paper |
| `--ink-2` | `oklch(0.38 0.012 260)` | `oklch(0.8 0.008 260)` | secondary text, caps labels | 18.3 / 5.5 on paper |
| `--ink-3` | `oklch(0.49 0.012 260)` | `oklch(0.78 0.009 260)` | tertiary text, placeholder text, captions | 15.8 / 4.8 on paper |
| `--rule` | `oklch(0.87 0.004 260)` | `oklch(0.32 0.011 260)` | hairlines: section rules, row separators | 2.3 / 1.0 on paper; decorative only |
| `--control-border` | `oklch(0.52 0.008 260)` | `oklch(0.74 0.01 260)` | edges of inputs, checkboxes, radios, switch tracks, buttons with a visible edge, and tone borders' neutral case | 14.8 / 3.7 on paper |

Change from Meridian: Meridian's dark `--ink-3` was `oklch(0.70 0.010 260)`, which measures 2.9:1 on the dark paper and
does not meet the 4.5:1 that Meridian claimed. The value above fixes it. `--ribbon-*` tokens are removed; the
Meridian prototype under `public/proto/meridian/` keeps its own stylesheet and is not loaded by the Suite.

### 3.3 Signal and focus

| Token | Light | Dark | Use | Measured |
|---|---|---|---|---|
| `--accent` | `oklch(0.55 0.215 29)` | `oklch(0.72 0.185 32)` | signal only (section 1); text of the signal tone | 7.7 / 5.5 on paper; 5.8 / 5.4 on `--accent-wash` |
| `--accent-on` | `oklch(0.99 0 0)` | `oklch(0.16 0.01 260)` | text on an `--accent` fill | n/a |
| `--accent-wash` | `color-mix(in oklch, var(--accent) 11%, var(--paper))` | same expression, resolves per theme | signal tone background | see `--accent` |
| `--focus` | `oklch(0.5 0.16 255)` | `oklch(0.78 0.13 250)` | focus ring colour | 13.3 / 5.7 on paper |
| `--focus-width` | `3px` | same | focus ring width | n/a |
| `--focus-offset` | `2px` | same | focus ring offset | n/a |

`--accent` and `--focus` are different hues on purpose. The focus ring must never read as a signal, and a signal
must never read as focus.

### 3.4 Surfaces per elevation tier

| Token | Light | Dark | Tier |
|---|---|---|---|
| `--surface-0` | `var(--paper)` | `var(--paper)` | 0 page |
| `--surface-1` | `oklch(1 0 0)` | `oklch(0.2 0.009 260)` | 1 raised panel or card |
| `--surface-2` | `oklch(0.985 0.002 90)` | `oklch(0.155 0.009 260)` | 2 sticky chrome (top bar, side nav) |
| `--surface-3` | `oklch(1 0 0)` | `oklch(0.235 0.01 260)` | 3 overlay (popover, menu, combobox list, toast) |
| `--surface-4` | `var(--surface-3)` | `var(--surface-3)` | 4 modal (dialog, drawer, sheet, palette) |
| `--backdrop` | `light-dark(oklch(0.19 0.012 260 / 0.45), oklch(0.08 0.005 260 / 0.6))` | (same expression) | scrim behind tier 4 |

### 3.5 Semantic tones

Six tones, the closed set in `TONES` (`primitives.ts`): `neutral`, `info`, `success`, `warning`, `danger`, `signal`.
Each has three tokens: `--<tone>-fg` (text and icon colour), `--<tone>-bg` (wash), `--<tone>-border` (edge).

Requirements, all checked against the pair that uses them: `-fg` on `-bg` at least 4.5:1; `-fg` on the paper it sits
on at least 4.5:1; `-border` on the page at least 3:1.

| Tone | `-fg` light | `-fg` dark | `-bg` light | `-bg` dark | `-border` light | `-border` dark | Measured fg/bg light, dark |
|---|---|---|---|---|---|---|---|
| neutral | `var(--ink-2)` | `var(--ink-2)` | `var(--paper-2)` | `var(--paper-2)` | `var(--control-border)` | `var(--control-border)` | 15.1 / 5.4 |
| info | `oklch(0.42 0.12 250)` | `oklch(0.82 0.09 250)` | `oklch(0.94 0.03 250)` | `oklch(0.26 0.04 250)` | `oklch(0.6 0.1 250)` | `oklch(0.78 0.1 250)` | 12.2 / 6.8 |
| success | `oklch(0.4 0.11 150)` | `oklch(0.82 0.13 150)` | `oklch(0.94 0.04 150)` | `oklch(0.25 0.05 150)` | `oklch(0.6 0.12 150)` | `oklch(0.74 0.12 150)` | 13.0 / 7.8 |
| warning | `oklch(0.4 0.1 70)` | `oklch(0.86 0.14 80)` | `oklch(0.95 0.05 90)` | `oklch(0.27 0.05 75)` | `oklch(0.65 0.14 75)` | `oklch(0.76 0.13 80)` | 13.7 / 9.0 |
| danger | `oklch(0.46 0.19 27)` | `oklch(0.8 0.13 25)` | `oklch(0.95 0.035 27)` | `oklch(0.27 0.06 27)` | `oklch(0.62 0.18 27)` | `oklch(0.7 0.16 25)` | 9.3 / 6.4 |
| signal | `var(--accent)` | `var(--accent)` | `var(--accent-wash)` | `var(--accent-wash)` | `var(--accent)` | `var(--accent)` | 5.8 / 5.4 |

Borders measured on the paper, light / dark: info 10.2 / 5.5, success 9.7 / 4.6, warning 7.7 / 4.7, danger 6.3 / 4.5.
Danger and signal are different in hue, so colour is never the only difference between them: a danger item always
carries its icon and its text label.

### 3.6 Tier colours

Membership tiers `bronze`, `silver`, `gold`, `platinum` (`TIERS` in `primitives.ts`). `--tier-<name>` is for fills,
rings and chips' edges (3:1 or better on the paper). `--tier-<name>-fg` is for text.

| Token | Light | Dark | Measured (light / dark, on paper) |
|---|---|---|---|
| `--tier-bronze` | `oklch(0.6 0.09 55)` | `oklch(0.72 0.1 60)` | 10.4 / 3.7 |
| `--tier-bronze-fg` | `oklch(0.45 0.08 55)` | `oklch(0.84 0.08 60)` | 16.6 / 7.6 |
| `--tier-silver` | `oklch(0.68 0.01 260)` | `oklch(0.8 0.01 260)` | 7.6 / 5.5 |
| `--tier-silver-fg` | `oklch(0.42 0.01 260)` | `oklch(0.8 0.01 260)` | 17.7 / 5.5 |
| `--tier-gold` | `oklch(0.76 0.13 85)` | `oklch(0.84 0.12 90)` | 4.3 / 7.7 |
| `--tier-gold-fg` | `oklch(0.5 0.12 80)` | `oklch(0.84 0.12 90)` | 14.8 / 7.7 |
| `--tier-platinum` | `oklch(0.72 0.03 230)` | `oklch(0.85 0.03 230)` | 5.9 / 7.9 |
| `--tier-platinum-fg` | `oklch(0.45 0.03 230)` | `oklch(0.85 0.03 230)` | 16.9 / 7.9 |

### 3.7 Chart series

Meridian's series are kept. Series are told apart by dash pattern and marker shape as well as lightness, so the
palette may be read by people who cannot separate the hues.

| Token | Light | Dark | Measured on paper (light / dark) | Dash | Marker |
|---|---|---|---|---|---|
| `--series-0` | `var(--ink)` | `var(--ink)` | 19.7 / 16.6 | `--series-dash-0` | circle |
| `--series-1` | `oklch(0.5 0.11 255)` | `oklch(0.74 0.09 250)` | 14.5 / 4.1 | `--series-dash-1` | square |
| `--series-2` | `oklch(0.6 0.02 260)` | `oklch(0.76 0.02 260)` | 11.3 / 4.2 | `--series-dash-2` | triangle |
| `--series-3` | `oklch(0.42 0.06 200)` | `oklch(0.78 0.07 195)` | 17.3 / 5.5 | `--series-dash-3` | diamond |
| `--series-4` | `oklch(0.72 0.01 260)` | `oklch(0.78 0.01 260)` | 6.0 / 4.8 | `--series-dash-4` | cross |

Dash tokens (values for `stroke-dasharray`):

| Token | Value |
|---|---|
| `--series-dash-0` | `none` |
| `--series-dash-1` | `6 3` |
| `--series-dash-2` | `2 2` |
| `--series-dash-3` | `8 3 2 3` |
| `--series-dash-4` | `1 3` |

Chart chrome: `--chart-grid: var(--rule)`, `--chart-axis: var(--ink-3)`, `--chart-breach: var(--accent)` (used with a
hatch fill and a text label, never colour alone; section 6.20).

### 3.8 Type

Families (no web fonts):

```css
--font-sans: "Helvetica Neue", Helvetica, "Nimbus Sans", "Arial Nova", Arial, system-ui, sans-serif;
--font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace;
```

Scale (kept from Meridian):

| Token | Value | Role |
|---|---|---|
| `--step--2` | `0.6875rem` (11 px at 16 px root) | caps labels, column headers, tiny meta |
| `--step--1` | `0.8125rem` | table cells, secondary text, pills, helper text |
| `--step-0` | `1rem` | body text, field values, buttons |
| `--step-1` | `clamp(1.125rem, 1rem + 0.45vw, 1.5rem)` | section titles (h2), card titles (h3 uses `--step-0` bold) |
| `--step-2` | `clamp(1.5rem, 1.1rem + 1.3vw, 2.5rem)` | page titles (h1), stat values |
| `--step-3` | `clamp(2.5rem, 1.2rem + 4.4vw, 6rem)` | reserved for the dashboard hero figure only |
| `--track-caps` | `0.08em` | tracking for caps labels |
| `--track-tight` | `-0.02em` | tracking for h1 and h2 |

Weights: `--weight-regular: 400`, `--weight-semi: 600`, `--weight-bold: 700`. Titles are bold, labels are semi-bold caps.
Leading: `--leading-tight: 1.15` (titles), `--leading-body: 1.45` (text).

Caps label rule: `font-size: var(--step--2); font-weight: var(--weight-semi); letter-spacing: var(--track-caps);
text-transform: uppercase; color: var(--ink-2);`

Numbers: every numeric value uses `font-variant-numeric: tabular-nums lining-nums` (class `u-tabular`, and the
`c-table__cell--num` modifier). Figures never shift width when they change.

### 3.9 Space, sizes and density

Space (kept from Meridian, 4 px grid on a 16 px root):

| Token | Value |
|---|---|
| `--space-1` | `0.25rem` (4 px) |
| `--space-2` | `0.5rem` (8 px) |
| `--space-3` | `0.75rem` (12 px) |
| `--space-4` | `1rem` (16 px) |
| `--space-5` | `1.5rem` (24 px) |
| `--space-6` | `2rem` (32 px) |
| `--space-7` | `3rem` (48 px) |
| `--space-8` | `4.5rem` (72 px) |

Layout tokens:

| Token | Value | Use |
|---|---|---|
| `--gutter` | `clamp(1rem, 0.3rem + 2.6vw, 3.5rem)` | page side gutter; minimum 1rem (16 px) on phones |
| `--column-gap` | `clamp(1rem, 0.5rem + 1.6vw, 2.5rem)` | grid and split gaps |
| `--topbar-h` | `3.5rem` | top bar height |
| `--nav-w` | `15rem` | side nav width when docked |
| `--content-max` | `90rem` | main content maximum width |
| `--form-max` | `40rem` | single-column form maximum width |

Density. Default and compact values; `data-density` is set on `<html>` by the shell from `prefsStore`.

```css
:root {
  --row-h: 3rem;             /* table row minimum height */
  --control-h-sm: 1.75rem;   /* 28 px */
  --control-h-md: 2.25rem;   /* 36 px */
  --space-cell-y: var(--space-3);
}
[data-density="compact"] {
  --row-h: 2.25rem;          /* 36 px */
  --control-h-sm: 1.5rem;    /* 24 px, the minimum target size */
  --control-h-md: 2rem;      /* 32 px */
  --space-cell-y: var(--space-2);
}
```

Coarse pointers ignore density: `@media (pointer: coarse)` sets every interactive control to at least `2.75rem` (44 px).

### 3.10 Shape

| Token | Value | Use |
|---|---|---|
| `--radius-0` | `0` | default. Buttons, inputs, cards, tables, dialogs, menus, toasts |
| `--radius` | `var(--radius-0)` | alias used by base styles |
| `--radius-1` | `2px` | statusPill, pill, countBadge only |
| `--radius-round` | `999px` | avatars, presence dots, the switch thumb |
| `--hairline` | `1px` | hairline width |
| `--rule-heavy` | `0.375rem` (6 px) | masthead rule of a page header (`.c-page-header`) |

Why `--radius-1` exists: a pill at 11 px with square corners reads as a rectangle of text. A 2 px corner keeps it a
tag, while every control keeps the square Swiss edge. Avatars are circles by `--radius-round`, which is a shape for
people, not a corner. Inputs stay square.

### 3.11 Elevation, z-index and motion

Shadows:

| Token | Value | Tier |
|---|---|---|
| `--shadow-0` | `none` | 0 |
| `--shadow-1` | `none` | 1 (hairline only) |
| `--shadow-2` | `0 1px 0 var(--rule)` | 2 (sticky chrome edge) |
| `--shadow-3` | `0 0.75rem 1.5rem -0.75rem color-mix(in oklch, var(--ink) 30%, transparent)` | 3 |
| `--shadow-4` | `0 1px 0 var(--ink), 0 1.25rem 2.5rem -0.5rem color-mix(in oklch, var(--ink) 28%, transparent)` (Meridian `--shadow-float`) | 4 |

`--ink` flips per theme, so the shadow darkens on the light theme and reads as a lift on the dark theme.

Z-index scale:

| Token | Value | Layer |
|---|---|---|
| `--z-page` | `0` | page content |
| `--z-raised` | `1` | sticky table headers and in-panel sticky rows |
| `--z-chrome` | `100` | side nav, top bar |
| `--z-overlay` | `1000` | popovers, menus, combobox lists |
| `--z-modal` | `2000` | drawers, sheets, dialogs (native `<dialog>` lives in the top layer, so z-index applies to its backdrop only) |
| `--z-palette` | `2100` | command palette |
| `--z-toast` | `3000` | toast region |

Motion (kept from Meridian; one easing):

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | the only easing curve |
| `--dur-1` | `120ms` | hover, press, focus, small toggles |
| `--dur-2` | `260ms` | popovers, menus, drawers, sheets, arrival rule |
| `--dur-3` | `700ms` | arrival reveal and the signal rule draw |
| `--cause-hold` | `6s` | how long a realtime arrival stays marked before its marker fades |

Reduced motion sets every `--dur-*` to `0ms` and removes transforms (section 10.5).

Registered properties (`@property` in `tokens.css`): `--radius-1`, `--radius-control` and `--radius-card` (`<length>`), so a
look change eases corner radii app-wide, and `--_live-ring` (`<number>`, not inherited), which drives the pulse ring of the
live dot (`.c-live`). The colour tokens are deliberately **not** registered: they are `light-dark()` pairs, and a registered
`<color>` is computed where it is declared and inherited as that value, which would freeze them at the root's scheme and
break the subtrees that re-resolve them under another `color-scheme` (nocturne's side bar and top bar, the styleguide's
scheme panels). Colours ease instead through `transition` on `html`, `body` and the app chrome surfaces
(`components/transitions.css`).

View transitions (`core/transition.js`, `components/transitions.css`). Every animated swap goes through `transition(update,
{ kind })`: `document.startViewTransition` where it exists and motion is allowed, otherwise the update runs at once with no
animation. It is skipped under `prefers-reduced-motion: reduce` and `data-reduced-motion="true"`. A newer transition skips the
running one, and an update that throws still lets the page render (the error is rethrown to the caller afterwards).
`html[data-vt]` holds the kind while it runs, and every `view-transition-name` exists only under it:

| Kind | Trigger | Behaviour |
|---|---|---|
| `route` | navigation in `core/page-host.js` (not a refresh, not the first render) | `#main` cross-fades with a 0.5rem rise; the nav and top bar have their own names and do not animate |
| `look` | a live change of site look or density (`app/main.js`) | the new look is revealed as a circle growing from the top bar's right end |
| `live` | widgets added, removed or moved on the current page | each grid cell carries `--_vt` (from its node slug, sanitised and hashed); survivors glide, new cells grow in, removed cells shrink out. The `is-entering` class is not added then |
| `nav` | nav items appearing or disappearing live | items are named inline during the transition; same glide, grow and leave as `live` |

Fallbacks: without `startViewTransition` the DOM updates at once, the `is-entering` animation (`live-build.css`) still plays for
arriving cells and nav items, and a look change eases colour and radius through the plain `transition` declarations. During a
view transition those declarations are switched off so the new state is captured whole.


### 3.12 Focus

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: var(--focus-width) solid var(--focus);
  outline-offset: var(--focus-offset);
}
```

Focus is shown only on `:focus-visible`. A focus ring is never removed without a replacement. On a `--surface-3` or
`--surface-4` surface the ring keeps the same colour (both measure above 3:1 on those surfaces).

### 3.13 Breakpoints

Custom properties cannot be used inside `@media`, so the values are written literally in media queries, and the same
numbers are kept as JS constants in the one component that needs them (`dialog.js` for the drawer-to-sheet switch,
`table.js` for the card fallback, `shell.js` for the nav).

| Name | Value | Behaviour |
|---|---|---|
| phone | `max-width: 39.99rem` (below 640 px) | single column; nav is a drawer; drawers become sheets; tables become cards |
| tablet | `min-width: 40rem` | two-column forms; data tables; drawer stays a side drawer |
| desktop | `min-width: 64rem` | side nav docked; split views side by side |
| wide | `min-width: 90rem` | dashboard grid reaches 12 columns |

The two breakpoints named in section 5 are the phone and desktop rows. The drawer-to-sheet switch is at `40rem`
(phone row); the nav docking is at `64rem` (desktop row).

---

## 4. Elevation tiers and surfaces

Five tiers. A component sits on exactly one tier. A tier-4 component must not be nested inside another tier-4
component (a dialog that opens a second dialog replaces its own content or stacks as a new dialog that is closed
first).

| Tier | Name | Surface | Edge | Shadow | z-index | Backdrop | Components on this tier |
|---|---|---|---|---|---|---|---|
| 0 | page | `--surface-0` | none | `--shadow-0` | `--z-page` | none | `main` content, page header, section, splitView panes, timeline, dataTable body |
| 1 | raised | `--surface-1` | `1px solid var(--rule)` on top edge only | `--shadow-1` | `--z-raised` | none | card, statTile, dashboard widget, editor preview panel, grouped form panel (`fieldset` in a section) |
| 2 | chrome | `--surface-2` | `--shadow-2` bottom edge | `--shadow-2` | `--z-chrome` | none | `app__nav`, `app__topbar`, sticky table header, sticky page header actions row |
| 3 | overlay | `--surface-3` | `1px solid var(--control-border)` | `--shadow-3` | `--z-overlay` | none (dismiss on outside press) | popover, menuButton list, combobox list, toast, tooltip |
| 4 | modal | `--surface-4` | `1px solid var(--control-border)` | `--shadow-4` | `--z-modal` | `--backdrop` | openDialog, confirmDialog, openDrawer, openSheet, command palette |

Rules:

- Tier 0 and tier 1 never cast a shadow. Only overlays (tier 3 and tier 4) lift.
- Tier 2 is flat with a single hairline edge, so the chrome reads as part of the page.
- Backdrops are shown only for tier 4. Tier 3 dismisses on outside pointer press and on Escape without a scrim.
- Surfaces are opaque. The only translucent surface is `--backdrop`. The top bar does not blur content behind it.
- Forced colours (section 10.4) drops all shadows and backgrounds and relies on the edges.

---

## 5. App shell

Owned by `shell.css` (layer `layout`) and the DS shell code that `main.js` calls as `mountShell()`.

### 5.1 Grid

Docked (desktop row and wider):

```css
.app {
  display: grid;
  grid-template-columns: var(--nav-w) minmax(0, 1fr);
  grid-template-rows: var(--topbar-h) minmax(0, 1fr);
  grid-template-areas:
    "nav  topbar"
    "nav  main";
  min-block-size: 100dvh;
}
.app__nav     { grid-area: nav; position: sticky; top: 0; block-size: 100dvh; overflow-y: auto; }
.app__topbar  { grid-area: topbar; position: sticky; top: 0; z-index: var(--z-chrome); }
.app__main    { grid-area: main; min-inline-size: 0; padding: var(--space-5) var(--gutter); max-inline-size: var(--content-max); }
```

Below the desktop row the grid becomes one column (`grid-template-areas: "topbar" "main"`), and `.app__nav` is not
in the grid. The nav content is shown in a start-side drawer opened from the top bar's menu button (section 5.3).
The phone row gives `--gutter` of 16 px on each side and no horizontal page scroll: wide tables scroll inside their
own container, and pills and toolbars wrap.

`.app__drawers` is outside `.app` in the DOM, so its drawers are top-layer `<dialog>` elements and do not depend on the
grid.

### 5.2 Top bar

Height `--topbar-h`, surface tier 2, bottom edge `--shadow-2`. Items left to right; the spacer takes the free space.

| Slot | Element | Behaviour |
|---|---|---|
| Menu (phone and tablet rows only) | `iconButton({ icon: "menu", label: "Open navigation" })` | opens the nav drawer (`openDrawer({ side: "start" })`) |
| Product mark | `a.app__brand` to the home route | text mark "Plinth Suite" in caps label style |
| Search and palette trigger | `button({ label: "Search or run a command", icon: "search", variant: "secondary" })` with a `kbd("Ctrl+K")` hint | opens `#palette`; `aria-keyshortcuts="Control+K Meta+K"` |
| Spacer | `div.app__spacer` | flex grow |
| Balance chip | `a.c-chip` with `icon: "coins"` and `points(balance)` | route to the wallet; text "Balance 1 240 pts" for the accessible name |
| Inbox count | `linkButton({ href: <inbox>, label: "Inbox", icon: "inbox" })` with a `countBadge(n, { label: "unread messages" })` | count from `countsStore.messages_unread` |
| Bell | `iconButton({ icon: "bell", label: "Notifications" })` with a `countBadge(n, { label: "unread" })` | opens a popover (tier 3) listing recent notifications; count from `countsStore.notifications_unread` |
| Avatar menu | `menuButton({ label: <display name>, items: [...] })` with the user's `avatar` | items: profile, settings, theme (see below), sign out |
| Theme | part of the avatar menu: three `menuitemradio` items System, Light, Dark, with `aria-checked` on the current one | persists the choice (section 10.2) |
| Live mark | `span.c-live` | text "Live" with a signal dot when the realtime connection is up; "Reconnecting" in `--warning-fg` when it is not; a `role="status"` region is not used for it, the state is announced only by `#announcer` on change |

The live mark is the one place the accent appears in the top bar, as the live connection mark (section 1).

### 5.3 Side nav

`nav.app__nav` with `aria-label="Primary"` (already in `index.html`).

Structure:

```html
<nav class="app__nav" aria-label="Primary">
  <div class="c-nav">
    <section class="c-nav__section" aria-labelledby="nav-s1">
      <h2 class="c-nav__heading" id="nav-s1">Section title</h2>
      <ul class="c-nav__list">
        <li><a class="c-nav__item" href="/route" aria-current="page">
          <span class="c-nav__icon" aria-hidden="true">…</span>
          <span class="c-nav__label">Inbox</span>
          <span class="c-count">3</span>
        </a></li>
      </ul>
    </section>
  </div>
</nav>
```

- Sections and items come from `navStore` (Page nodes with a `nav` entry, `pages.list`), filtered by `nav.permission`.
  This document fixes structure, not grouping.
- Item = icon (20 px, `aria-hidden`), label, optional `countBadge` (hidden at 0; the count is part of the accessible
  name through the badge's own text, for example "Inbox, 3 unread").
- The current route's item has `aria-current="page"`. Exactly one item carries it.
- Section headings are `h2` visually styled as caps labels, so the nav does not add an h1.
- Item states: hover (`--paper-2` wash), focus-visible (section 3.12), current (a 2 px `--ink` bar on the inline start
  edge and `--weight-bold`; no accent), disabled items are not rendered.
- Below the desktop row the same markup is rendered inside the nav drawer.

### 5.4 Command palette

`#palette` is a native `<dialog>` at tier 4 with `aria-label="Command palette"`. It contains a combobox (section 6.3)
whose search returns routes, people, and commands. It opens on Ctrl+K and Meta+K, closes on Escape, returns focus to the
trigger. The listbox uses `aria-activedescendant` (APG Combobox, list autocomplete pattern).

### 5.5 Skip link, focus and announcements on route change

Skip link: `a.skip-link` is the first focusable element. It is visually hidden until focused, then sits at the top
inline start with `--paper` background, `--ink` text and the focus ring.

On every route change the router performs these steps in order:

1. Sets `document.title` to `<page title> · Plinth Suite`.
2. Replaces the text of `#announcer` with the page title. The change is announced politely.
3. Renders the new page into `#main`.
4. Focuses `#main` (`tabindex="-1"`, `focus({ preventScroll: true })`) so the next Tab goes to the first control of the
   page, not to the top bar.
5. Scrolls to the top, unless the URL has a fragment, which is scrolled into view instead.

Focus is not moved on a same-route update (filter change, pagination, realtime count change).

---

## 6. Components

Common rules for every component module:

- Every exported function returns DOM nodes or a handle object built with `h()` or `s()`. No module assigns
  `innerHTML` with data. Text is always a text node. The only `innerHTML` allowed is an empty string to clear, and it
  is written with `clear()`.
- Every component's root class starts with `c-<component>`. Parts use `__`, modifiers use `--`.
- A component reads colour only from tokens. A component that needs a value not in section 3 says so in its entry
  and the value is added to `tokens.css` by the DS builder, never inline.
- Each component's CSS file is `components/<name>.css` in layer `components`.
- Keyboard behaviour cites the WAI-ARIA Authoring Practices Guide (APG) pattern by name.

Each subsection gives: signature, markup, ARIA and keys, visual and states, responsive.

### 6.1 button.js

Signature (fixed):

```js
button({ label, icon?, variant: "primary"|"secondary"|"ghost"|"danger"|"signal", size?: "sm"|"md",
         type?: "button"|"submit", disabled?, busy?, pressed?, onClick?, title? }) -> HTMLButtonElement
iconButton({ icon, label, ...same }) -> HTMLButtonElement
linkButton({ href, label, icon?, variant? }) -> HTMLAnchorElement
```

Markup: `<button class="c-button c-button--primary c-button--md" type="button">` with an optional
`span.c-button__icon` (icon, 20 px, `aria-hidden`) before a `span.c-button__label`. `iconButton` renders no label text
and sets `aria-label` from `label`; `title` is set to `label` if not given. `linkButton` renders `a.c-button`.

ARIA and keys: native button semantics. `pressed` sets `aria-pressed="true|false"` (toggle button). `busy` sets
`aria-busy="true"` and `aria-disabled="true"`, keeps the label, and shows the label "Saving" or the caller's label
through `label`; busy buttons do not fire `onClick`. `disabled` sets the native `disabled` attribute, so the button is
removed from the tab order; a disabled button that explains why is a `hint` next to it, not a tooltip alone.
Enter and Space activate (native). Escape is not handled here.

Variants: `primary` (`--ink` fill, `--paper` text), `secondary` (transparent, `--control-border` edge, `--ink` text),
`ghost` (no edge, `--ink-2` text, `--paper-2` wash on hover), `danger` (`--danger-fg` text and `--danger-border` edge,
wash `--danger-bg` on hover; never a red fill), `signal` (`--accent` fill with `--accent-on` text; used for one primary
action per screen at most, and only for an action that commits a change attributed to an event).

States:

| State | Visual |
|---|---|
| default | per variant |
| hover | ghost and secondary take `--paper-2`; primary takes `color-mix(in oklch, var(--ink) 88%, var(--paper))` |
| focus-visible | section 3.12 ring |
| active | `transform: translateY(1px)` only when motion is allowed |
| disabled | `opacity` not used; colours go to `--ink-3` and the edge to `--rule`; cursor default |
| busy | label kept, a static caret glyph (`icon: "clock"`) replaces the icon; no spinner |
| pressed (toggle) | `--paper-2` wash and a 2 px `--ink` inline-start bar |

Sizes: `sm` is `--control-h-sm`, `md` is `--control-h-md`. Padding inline `--space-3`. Caps labels are not used on
buttons; buttons use `--step--1` semi-bold sentence case.

Responsive: on coarse pointers the minimum height is 2.75rem. On the phone row, `button` with `variant: "primary"`
inside a dialog footer or a sheet footer spans the full width.

### 6.2 field.js

Signature (fixed):

```js
textField({ name, label, value?, hint?, error?, required?, disabled?, options?, min?, max?, step?, rows?,
            placeholder?, onInput?, onChange? }) -> HTMLElement
textArea, numberField, selectField, checkboxField, switchField, radioGroup, dateTimeField, searchField
  // each takes the same object; see below for which fields apply to which
fieldset({ legend, children }) -> HTMLElement
formErrors(errorBody | null, { form? }) -> HTMLElement | null       // optional second argument (section 9.3)
```

The field functions share the object shape above. `options` is used by `selectField` and `radioGroup` as
`[{ value, label }]`. `min`, `max`, `step` are used by `numberField` and `dateTimeField`. `rows` is used by
`textArea`. `placeholder` is used by text-like fields.

Markup, for every field:

```html
<div class="c-field c-field--invalid?" >
  <label class="c-field__label" for="f-3">Title <span class="c-field__req" aria-hidden="true">*</span></label>
  <input class="c-field__control" id="f-3" name="/title" required aria-invalid="true" aria-describedby="f-3-hint f-3-err">
  <p class="c-field__hint" id="f-3-hint">Shown to members</p>
  <p class="c-field__error" id="f-3-err"><span class="c-field__error-icon" aria-hidden="true">…</span> Enter a title</p>
</div>
```

- `id` is generated with `uid("f")`. `name` is the form field name (section 9.3 explains why names are JSON pointers).
- `aria-describedby` lists the hint id only when a hint exists, and the error id only when an error exists.
- The required marker is `aria-hidden`; the form's note "Fields marked * are required" sits above the first field,
  and `required` sets the native attribute, which is announced.
- `radioGroup` and `checkboxField` wrap their controls in `fieldset` with a `legend` equal to the label. `switchField`
  renders `input type="checkbox" role="switch"` with a visible state word ("On" or "Off") next to the track.
- `dateTimeField` uses `type="datetime-local"` and returns and accepts ISO 8601 local strings. The value is shown in the
  user's timezone (section 9.7); the stored value is UTC, converted by the caller.
- `searchField` is `type="search"` with a visible clear button (`iconButton({ icon: "x", label: "Clear search" })`) that
  appears when the field has a value.

ARIA and keys: native semantics. Invalid state sets `aria-invalid="true"` and `c-field--invalid`. The error text
replaces the hint in the description list only when present; the hint stays visible above it.

Visual: label is `--step--1` semi-bold, `--ink`. Control has a 1px `--control-border` edge, square corners, `--surface-1`
background, `--ink` text, `--step-0` size, height `--control-h-md` (`textArea` grows with rows). Placeholder is
`--ink-3`. Hover: edge `--ink-2`. Focus-visible: section 3.12 ring, edge stays. Disabled: `--paper-2` background, `--ink-3`
text, edge `--rule`. Invalid: edge and error text in `--danger-border` and `--danger-fg`, with the error icon. Hint and
error are `--step--1`.

Responsive: on the tablet row and wider, `.c-form__row` (a two-column grid) places fields side by side; on the phone row
everything is one column. Labels never move beside controls.

`fieldset({ legend, children })` renders `fieldset.c-fieldset` with a `legend.c-fieldset__legend` (caps label style).

`formErrors(errorBody, { form? })`: `errorBody` is the API error body `{ code, path, message }` (or `null`, which returns
`null`). Returns a summary: `div.c-form-errors[role="alert"]` containing a heading "Check the form" and a list of
`li > a[href="#<field id>"]` with the message. When `form` is given, the matching field also receives the error (section
9.3). An error whose path matches no field is listed without a link.

### 6.3 combobox.js
> Element: `<p-combobox>` (form-associated) and `<p-people-picker>`, a light-DOM custom element (section 6.29). The helper below returns it with the same options.

Signature (fixed, with four optional parameters added; see section 12 item 4):

```js
combobox({ label, name, multiple?, search: async (q) => [{ value, label, description?, avatar?, icon?, group? }],
           value?, onChange, placeholder?,
           hint?, error?, required?, disabled? })  -> HTMLElement
```

The four added optional parameters are `hint`, `error`, `required` and `disabled`, with the same meaning as in
section 6.2. Without them, a form could not show a field-level error on a combobox.

Pattern: APG Combobox, list autocomplete (`aria-autocomplete="list"`). Single select: the input shows the selected label.
Multiple: chips (`span.c-chip` with a `button` "Remove <label>") precede the input inside the same control box.

Markup:

```html
<div class="c-combobox" >
  <label class="c-field__label" id="cb-1-label" for="cb-1">Members</label>
  <div class="c-combobox__box">
    <ul class="c-combobox__chips" role="list"> … </ul>   <!-- multiple only -->
    <input id="cb-1" role="combobox" aria-expanded="false" aria-autocomplete="list"
           aria-controls="cb-1-list" aria-labelledby="cb-1-label" aria-haspopup="listbox" aria-describedby="…">
  </div>
  <ul id="cb-1-list" role="listbox" aria-labelledby="cb-1-label" class="c-combobox__list" hidden>
    <li role="option" id="cb-1-o-0" aria-selected="false"> avatar · label · description </li>
  </ul>
  <p class="c-field__status" aria-live="polite"></p>   <!-- "4 results" or "No results" -->
</div>
```

Keys (APG): typing filters (debounced by the caller's `search`); ArrowDown opens the list and moves to the first option;
ArrowUp and ArrowDown move the active option (`aria-activedescendant`); Home and End move to the first and last option
while the input keeps focus; Enter selects the active option; Escape closes the list (if open) and otherwise clears the
input; Backspace in an empty input removes the last chip when `multiple`; Tab accepts nothing and moves on. Groups
(`group`) render a non-selectable `li role="presentation"` heading.

Status: the `p.c-field__status` text is the only live output: "4 results", "No results", "Searching". It is
`aria-live="polite"` and updated after each search resolves, not on each keystroke.

Visual: the list is tier 3 (`--surface-3`, `--shadow-3`, edge `--control-border`), max height 20rem, scrolls
internally. The active option has the `--paper-2` wash and a 2 px `--ink` inline-start bar. Selected options show a
check icon (`icon: "check"`, `aria-hidden`). Avatars use `avatar` size `xs`; icons are 16 px.

States: empty input (placeholder `--ink-3`), loading (status text "Searching", the list keeps its last results),
no results (a single non-option row "No results for ‘q’" with `aria-disabled`), invalid and disabled as in 6.2.

Responsive: on the phone row the list is capped at 50vh and is positioned by the popover logic; if there is no room
below, it opens above.

### 6.4 dialog.js

Signature (fixed):

```js
openDialog({ title, body: Node | () => Node, actions: [{ label, variant?, value, autofocus? }],
             size?: "sm"|"md"|"lg", dismissable? }) -> Promise<value | null>
confirmDialog({ title, message, confirmLabel, tone?: "danger"|"default" }) -> Promise<boolean>
```

Pattern: APG Dialog (Modal). `confirmDialog` with `tone: "danger"` uses the APG Alert Dialog pattern (`role="alertdialog"`).

Markup: a native `<dialog class="c-dialog c-dialog--md" aria-labelledby aria-describedby>` appended to `#app-drawers`,
opened with `showModal()`. Structure: `header.c-dialog__head` (h2 title, close `iconButton` "Close" when dismissable),
`div.c-dialog__body`, `footer.c-dialog__foot` (actions, right-aligned, primary last). Sizes: `sm` 28rem, `md` 36rem,
`lg` 48rem; capped at the viewport width minus `--gutter` twice.

Focus: on open, focus goes to the action with `autofocus: true`, else to the first focusable in the body, else to the
close button. Focus is trapped by the modal dialog itself (the rest of the page is inert). On close, focus returns to the
element that had focus when the dialog opened. Escape closes when `dismissable` is not `false` (default true) and
resolves `null`. Clicking the backdrop does not close a dialog (only the close button, Escape or an action does).

Return values: each action's `value` resolves the promise. `confirmDialog` resolves `true` for the confirm action and
`false` for cancel or Escape. In `tone: "danger"` the confirm action is `variant: "danger"`; the default cancel action
is the one focused on open, so Enter does not destroy data by accident.

Visual: tier 4. Surface `--surface-4`, edge `1px solid var(--control-border)`, `--shadow-4`, backdrop `--backdrop`
(`::backdrop`). Title is `--step-1` bold. Body text `--step-0`. Footer separated by a hairline `--rule`.

Responsive: on the phone row a dialog is full width minus the 16 px gutters, with actions stacked full width, primary on top.

### 6.5 drawer.js

Signature (fixed):

```js
openDrawer({ title, body, footer?, side?: "end"|"start", width?: "sm"|"md"|"lg", onClose? })
  -> { close(), element }
```

Pattern: APG Dialog (Modal) with the side-sheet visual. Native `<dialog class="c-drawer c-drawer--end c-drawer--md">`
in `#app-drawers`. Width `sm` 22rem, `md` 30rem, `lg` 44rem, capped at 100vw.

Behaviour: same focus and Escape rules as dialogs (section 6.4). `onClose` runs after the element is removed, with no
return value. `close()` is idempotent.

Responsive: below 40rem (the phone row) a drawer becomes a bottom sheet with the sheet visual (section 6.6), same
markup and same handle object. This switch is a CSS media query and the JS constant `40rem` in `drawer.js`.

Visual: tier 4, edge on the inline-start (or end) side only, no radius, `--shadow-4`. The footer, when given, sits at the
bottom with actions right-aligned.

### 6.6 sheet.js

Signature (fixed):

```js
openSheet({ title, body, footer?, onClose? }) -> { close(), element }
```

Bottom sheet on every width. Native `<dialog class="c-sheet">` in `#app-drawers`, full width, `max-block-size: 88dvh`,
edge on the block-start side, a grab handle that is decorative (`aria-hidden`, no drag). Same focus, Escape and return
rules as dialogs. Visual: tier 4, `--surface-4`, `--shadow-4`, `--backdrop`. Used on the phone row for filters, the
notification list and any action a drawer would otherwise hold.

### 6.7 popover.js

Signature (fixed):

```js
popover(anchor, content, { placement?: "bottom-start"|"bottom-end"|"top-start"|"top-end", onClose? }) -> { close() }
```

Implementation: the Popover API (`popover="auto"`, which gives top layer and light dismiss) on a `div.c-popover`,
placed with CSS anchor positioning (section 6.28). `anchorTo(anchor, el, placement)` (exported, shared with menu.js)
gives the trigger a unique `anchor-name` (`--anchor-<id>`), points the floating element at it with `position-anchor`
and sets `data-placement`; popover.css turns that into `position-area` with `position-try-fallbacks: flip-block,
flip-inline`. Where `CSS.supports("position-anchor: --a")` is false, `anchorTo` instead sets fixed `top` and `left` from
`getBoundingClientRect()` on open and on `resize` and `scroll` (`frameOnce`-throttled), flipping vertically when there
is no room. The anchor keeps `aria-expanded="true"` while the popover is open when the anchor is
a button.

Keys and dismissal: Escape closes and returns focus to the anchor. Pressing outside closes (light dismiss). Focus moves
into the content on open only when the content is interactive and the open was by keyboard; a pointer open leaves
focus on the anchor. `onClose` runs after the popover hides.

Role: the content root is `role="dialog"` with an `aria-label` from the caller's content. Menus do not use `popover()`;
they use `menuButton` (section 6.8).

Visual: tier 3. `--surface-3`, edge `1px solid var(--control-border)`, `--shadow-3`, padding `--space-3`, max width 24rem.
Enter and leave use `--dur-1` opacity and a 4 px translate, removed under reduced motion.

### 6.8 menu.js
> Element: `<p-menu-button>`, a light-DOM custom element (section 6.29). The helper below returns it with the same options.

Signature (fixed):

```js
menuButton({ label, icon?, variant?, items: [{ label, icon?, onSelect, danger?, disabled?, shortcut?,
                                                separatorBefore? }] }) -> HTMLElement
```

Pattern: APG Menu Button. Markup: `div.c-menu` containing `button.c-button[aria-haspopup="menu"][aria-expanded]` and
`ul.c-menu__list[role="menu"][aria-labelledby]` (tier 3, `--surface-3`) containing `li[role="none"] > button[role="menuitem"]`
(or `[role="menuitemradio"]` with `aria-checked`, used in the avatar theme items). `shortcut` renders a `kbd` with
`aria-keyshortcuts` on the item. `separatorBefore` renders `li[role="separator"]`.

Keys (APG): Enter, Space and ArrowDown on the button open the menu and focus the first enabled item. Within the menu:
ArrowDown and ArrowUp move focus (wrapping), Home and End go to the first and last enabled item, a printable character
moves to the next item beginning with it, Enter and Space invoke, Escape closes and returns focus to the button, Tab
closes the menu and moves on. Disabled items are focusable (APG) and marked `aria-disabled="true"`, and do not invoke.

Visual: items are `--step--1` at the `md` row height; hover and focus-visible use the `--paper-2` wash; the `danger` item
uses `--danger-fg` text and an icon, never colour alone. Separators are `--rule` hairlines. Max width 18rem.

Responsive: on the phone row the menu opens as a sheet (section 6.6) instead of a popover, with the same items and keys.

### 6.9 toast.js

Signature (fixed):

```js
toast({ title, body?, tone?: "neutral"|"info"|"success"|"warning"|"danger"|"signal", icon?,
        action?: { label, href?, onClick? }, timeout?: number /* ms, default 6000, 0 = sticky */ }) -> { dismiss() }
toastRegion(el)   // binds the #toasts element once, called by main.js
```

Markup: `section#toasts.toasts` at the end of the document; each toast is `article.c-toast.c-toast--<tone>` containing the
icon (tone icon by default: `info`, `check-circle`, `alert`, `alert`, `bolt` for signal, none for neutral),
`h`-free title text as `p.c-toast__title`, body `p.c-toast__body`, the action as a `button` or `a`, and a dismiss
`iconButton({ icon: "x", label: "Dismiss notification" })`.

Stacking: at most four toasts are visible. The newest is on top; older visible toasts sit below it. A fifth and later
toast waits in a queue and enters when a visible toast leaves. Nothing is dropped from the queue.

Live politeness, by tone: `danger` toasts carry `role="alert"` (assertive). All other tones carry `role="status"`
(polite). The `#toasts` region itself has no live attribute, so each announcement is made once.

Timers: `timeout` defaults to 6000 ms; `0` is sticky. The timer pauses while the pointer is over the toast or focus is
inside it, and resumes with the remaining time when both leave. A sticky toast never auto-dismisses.

Focus: toasts never take focus when they appear. The action and dismiss controls are reachable with Tab, because the
region is at the end of the document; the region is not a focus trap.

Visual: tier 3 (`--surface-3`, `--shadow-3`), a 3 px inline-start edge in the tone's `-border` colour, text with the tone's
`-fg` for the icon only. Width 24rem, max width `calc(100vw - 2 * var(--gutter))`. Position: bottom inline-end on
desktop, bottom full width on the phone row. Enter and leave use `--dur-2` slide and fade, removed under reduced motion.

### 6.10 tabs.js

Signature (fixed):

```js
tabs({ label, items: [{ id, label, count?, panel: () => Node }], selected?, onChange?, urlParam? }) -> HTMLElement
```

Pattern: APG Tabs with automatic activation. Markup: `div.c-tabs` with `div.c-tabs__list[role="tablist"][aria-label]`,
each `button.c-tabs__tab[role="tab"][aria-selected][aria-controls][id]` containing the label and optional
`countBadge(count, { label: "items" })`, and one `div.c-tabs__panel[role="tabpanel"][aria-labelledby]` for the selected
tab. Panels are rendered lazily: `panel()` runs the first time a tab is selected, then the node is kept.

Keys: ArrowLeft and ArrowRight move and activate (wrapping), Home and End go to the first and last tab, Tab moves into the
selected panel. Roving tabindex: only the selected tab has `tabindex="0"`.

`urlParam`: when given (for example `"tab"`), the selected id is written with `history.replaceState` to `?tab=<id>`, so
reloading returns to the same tab and the back button is not affected. The router is informed through the shared
`replaceState` helper so it does not treat the change as navigation.

Visual: tabs are caps labels at `--step--2`; the selected tab has a 2 px `--ink` bottom bar and `--ink` text; others
are `--ink-2`. The list has a hairline `--rule` underneath. Hover is `--ink`. Count badges use the `count-badge` styles.

Responsive: when the tabs overflow, the list scrolls horizontally inside its own container (never the page), and the
selected tab is scrolled into view.

### 6.11 table.js

Signatures (fixed):

```js
dataTable({ caption, columns: [{ key, label, align?: "start"|"end", sortable?, width?,
                                 render?: (row) => Node|string }],
            rows, rowKey, onRowClick?, rowHref?, selectable?, selected?, onSelect?,
            sort?: { key, dir }, onSort?, empty?: Node, loading?: boolean,
            density?: "default"|"compact" }) -> HTMLElement
pager({ nextCursor, onNext, onPrev?, label }) -> HTMLElement
```

Markup: `div.c-table` (scroll container, `overflow-x: auto`, `max-block-size` set by the caller's CSS if needed) containing
`table.c-table__table` with `caption` (visible caption in caps label style; it is required), `thead` (sticky), `tbody`.

Headers: `th scope="col"`. A sortable header contains `button.c-table__sort` with the label and a sort icon (`sort`,
`chevron-up`, or `chevron-down`, `aria-hidden`), and the `th` carries `aria-sort="ascending" | "descending" | "none"`.
The sort button's accessible name is the column label; the sort state is conveyed by `aria-sort`, not by the icon.
Activating a sortable header calls `onSort({ key, dir })`; the next direction cycles ascending, descending, none for that
column. The table does not sort rows itself; the caller sorts and passes `rows` in order.

Sticky header: `thead th { position: sticky; top: 0; z-index: var(--z-raised); background: var(--surface-1); }` with a
`--rule` bottom edge. It sticks inside the nearest scroll container (`.c-table`).

Selection: when `selectable` is true, the first column is a checkbox `input[type="checkbox"]` with `aria-label` "Select <row
label>", where the row label is the text of the first non-selection column. The header checkbox selects all rows, uses
the `indeterminate` property when some rows are selected, and is labelled "Select all rows". `onSelect(keys)` receives the
selected row keys. Selected rows get a `--paper-2` wash and the checkbox is checked.

Row links: when `rowHref(row)` returns a path, the first non-selection cell holds an `a` whose `::after` stretches over
the row (a stretched link), so the whole row is clickable and the link remains the single focusable target. `onRowClick`
handles clicks on rows without a link. Keyboard users use the link or the checkbox; rows are not focusable themselves.

Alignment and numbers: `align: "end"` columns are right-aligned (`text-align: end`) with `u-tabular` figures, and
their headers align to match. Numeric cells use `font-variant-numeric: tabular-nums` and never wrap.

Density: `density: "compact"` applies the compact row height (section 3.9), otherwise the default row height applies.

Loading: `loading: true` sets `aria-busy="true"` on the table and renders `skeleton({ shape: "table" })` rows with the same
column count in place of the body. Rows are not replaced until data arrives.

Empty: when `rows` is empty and `loading` is false, `empty` is rendered in one row spanning all columns. If `empty` is
absent the table renders "Nothing to show" in `--ink-2`.

Responsive, the narrow-screen card fallback: below the tablet row (40rem), each row displays as a card: `tr` becomes a
two-column grid, each `td` shows its column label from a `data-label` attribute through `::before { content:
attr(data-label); }` in caps label style, and the `thead` is visually hidden with `.sr-only` so the header association
remains for assistive technology. The selection checkbox sits at the top of the card. Cards have a `--rule` bottom edge
and no shadow.

Status cells: a status column renders `statusPill(...)` (section 6.13) and never colour alone.

`pager({ nextCursor, onNext, onPrev?, label })`: `nav.c-pager[aria-label=label]` with a "Previous" button (only when
`onPrev` is given) and a "Next" button. "Next" is disabled when `nextCursor` is `null`. There are no page numbers; the
API is cursor-based. A status line "Showing the first 50" is not produced because counts are not known; the pager
shows only the buttons.

### 6.12 card.js

Signature (fixed):

```js
card({ title?, eyebrow?, actions?, body, footer?, href?, tone? }) -> HTMLElement
```

Markup: `section.c-card` when `title` is given (`aria-labelledby` the title), otherwise `div.c-card`. Structure:
`header.c-card__head` (eyebrow caps label, `h3` title, `actions` nodes right-aligned), `div.c-card__body`,
`footer.c-card__foot`. With `href`, the title is an `a` with a stretched link covering the card, and the card's
`footer` and `actions` stay above the stretch with `position: relative`.

`tone` sets the top edge: a 2 px rule in that tone's `-border` colour (`--signal-border` for signal). No background
change by tone, so tone never changes text contrast.

Visual: tier 1 (`--surface-1`, no shadow). The top edge is a `--rule` hairline (the Meridian panel rule). Padding
`--space-5` (phone: `--space-4`). Card titles are `--step-0` bold. Hover on linked cards: `--paper-2` wash on the card
background (wash on tier 1 stays readable because `--ink` on `--paper-2` measures above 12:1).

Responsive: cards are full width on the phone row; in a dashboard grid the width follows the grid (section 9.1).

Aligned rows: pass `sub: true` (or add `c-card--sub`) for a card that lives in a `.c-card-grid`; see section 6.28.
A card with an `img`, `picture` or `video` as a direct child clips it to the card edge (`:has(> img)`).

### 6.13 pill.js and statusPill
> Element: `<p-pill>`, a light-DOM custom element (section 6.29). The helper below returns it with the same options.

Signatures (fixed):

```js
pill({ label, tone?, icon? })     // tone defaults to "neutral"
statusPill(vocabulary, status)    // vocabulary: "order"|"promotion"|"content"|"run"|"step"|"task"|"approval"|"stock"|"tier"
```

Markup: `span.c-pill.c-pill--<tone>` with optional `icon` (16 px, `aria-hidden`) and label text. `statusPill` adds
`c-pill--status-<vocabulary>`. For `tier`, the pill also gets `c-pill--tier-<name>` and uses the tier token rather than a
tone.

Visual: `--step--1`, semi-bold, height `1.5rem`, inline padding `--space-2`, `--radius-1`. Background `-bg` tone, text
`-fg`, edge `1px solid -border`. Text is always present: colour is never the only information.

Mapping table for `statusPill`. Every status value of every vocabulary in `events.ts` and `primitives.ts` is listed.
Labels are sentence case.

| Vocabulary | Status value | Label | Tone |
|---|---|---|---|
| order (`ORDER_STATUSES`) | `placed` | Placed | info |
| order | `approved` | Approved | info |
| order | `fulfilled` | Fulfilled | info |
| order | `shipped` | Shipped | info |
| order | `delivered` | Delivered | success |
| order | `cancelled` | Cancelled | neutral |
| order | `refunded` | Refunded | warning |
| promotion (`PROMOTION_STATUSES`) | `draft` | Draft | neutral |
| promotion | `scheduled` | Scheduled | info |
| promotion | `active` | Active | success |
| promotion | `paused` | Paused | warning |
| promotion | `ended` | Ended | neutral |
| content (`CONTENT_STATUSES`) | `draft` | Draft | neutral |
| content | `in_review` | In review | warning |
| content | `approved` | Approved | info |
| content | `published` | Published | success |
| content | `archived` | Archived | neutral |
| run (`RUN_STATUSES`) | `queued` | Queued | neutral |
| run | `running` | Running | info |
| run | `succeeded` | Succeeded | success |
| run | `failed` | Failed | danger |
| run | `skipped` | Skipped | neutral |
| run | `cancelled` | Cancelled | neutral |
| step (`STEP_STATUSES`) | `pending` | Pending | neutral |
| step | `running` | Running | info |
| step | `succeeded` | Succeeded | success |
| step | `failed` | Failed | danger |
| step | `skipped` | Skipped | neutral |
| task (`TASK_STATUSES`) | `open` | Open | neutral |
| task | `in_progress` | In progress | info |
| task | `blocked` | Blocked | danger |
| task | `done` | Done | success |
| task | `cancelled` | Cancelled | neutral |
| approval (`ApprovalItem.status`) | `pending_approval` | Awaiting decision | warning |
| approval | `approved` | Approved | success |
| approval | `rejected` | Rejected | danger |
| approval | `withdrawn` | Withdrawn | neutral |
| approval | `expired` | Expired | neutral |
| approval | `stale` | Stale | neutral |
| approval | `failed` | Failed after approval | danger |
| stock (`StockStatus`) | `in_stock` | In stock | success |
| stock | `low` | Low stock | warning |
| stock | `out` | Out of stock | danger |
| tier (`TIERS`) | `bronze` | Bronze | neutral, tier ring `--tier-bronze` |
| tier | `silver` | Silver | neutral, tier ring `--tier-silver` |
| tier | `gold` | Gold | neutral, tier ring `--tier-gold` |
| tier | `platinum` | Platinum | neutral, tier ring `--tier-platinum` |

Notes on the table:

- The `approval` vocabulary is `ApprovalItem.status` (`packages/spec/src/suite/api/work.ts`); `approval.decided`
  carries the same status string.
- Tier pills show the tier name with a 2 px inline-start edge in the tier colour; the tier never replaces the label.
- Task priorities (`TASK_PRIORITIES`) and notification types are not status vocabularies and use `pill({ tone })`
  directly, not `statusPill`.

### 6.14 count-badge.js
> Element: `<p-count>`, a light-DOM custom element (section 6.29). The helper below returns it with the same options.

Signatures (fixed):

```js
countBadge(n, { label, max?: 99 }) -> HTMLElement
updateCount(el, n) -> void
```

Markup: `span.c-count` containing the visible number, with a visually hidden suffix from `label`. Accessible text is
"3 unread" for `label: "unread"`. Above `max`, the visible text is `99+` and the accessible text is "more than 99
unread". At zero the element has the `hidden` attribute (the `[hidden]` rule in `overrides.css` keeps it hidden even when a
class sets `display`).

`updateCount(el, n)` sets the text, the accessible suffix and `hidden` in place, so the node stays in the DOM and keeps
its place in the nav. Count badges are not live regions: a count change is not announced; the shell announces only what
the user did or what the realtime layer reports through `#announcer` (section 9.6).

Visual: `--step--2` semi-bold, min width 1.25rem, height 1.25rem, inline padding `--space-1`, `--radius-1`. Default colours
`--ink` on `--paper-2`. In the nav, a count for an item that needs attention uses the warning tone (`countBadge` takes no
tone; the nav applies `c-count--warning` to the element).

### 6.15 avatar.js
> Element: `<p-avatar>` and `<p-person>`, a light-DOM custom element (section 6.29). The helper below returns it with the same options.

Signatures (fixed):

```js
avatar({ name, avatar: { initials, hue }, size?: "xs"|"sm"|"md"|"lg"|"xl", presence?: "online"|"away"|null, href? })
avatarStack(people, { max })
personChip(personRef, { href? })
```

Markup: `span.c-avatar.c-avatar--<size>` with `role="img"` and `aria-label` set to `name` when not a link. Inside, the
initials `span` with `aria-hidden="true"` and a visually hidden copy of the name when the avatar is a link. When `href`
is given, the root is `a.c-avatar` with the name as its text (visually hidden) and the initials `aria-hidden`.
`presence` renders `span.c-avatar__presence` (`aria-hidden`), with a visible text state in the accessible name
("Maya Ortiz, online").

Sizes: xs 1.25rem, sm 1.5rem, md 2rem, lg 2.5rem, xl 3.5rem. The background and text are generated from `hue` by the avatar
art helper (section 7.3); the component never reads an image.

`avatarStack(people, { max })`: a row of up to `max` avatars with `--space-1` overlap, and a `+N` overflow avatar. The
overflow is `span` with `aria-label` "and N more" and the visible text `+N`.

`personChip(personRef, { href? })`: `span.c-person` containing an `xs` avatar, the display name, and when the person is an
agent or service a `pill` "Agent" or "Service" in `neutral`. Handles are shown after the name in `--ink-3` when the person
has a handle (`@handle`), and are not shown for agents and services (`handle` is null).

Visual: `--radius-round`. No edge. Presence dot 0.5rem in `--success-fg` (online) or `--warning-fg` (away), with a 2 px
`--surface-1` ring so it reads on any avatar.

Responsive: unchanged; avatar sizes do not depend on the viewport.

### 6.16 stat.js

Signature (fixed):

```js
statTile({ label, value, unit?, delta?, good?: "up"|"down", spark?: number[], href?, hint? }) -> HTMLElement
```

`value` is a string already formatted by `format.js`. A number is accepted and formatted with `number()`.
`delta` is a string already formatted (for example "+12 %"), with its sign. `good` says which direction is good; it sets
the delta's tone (`success` for good, `danger` for bad, `neutral` for no change), so the sign and an arrow icon carry
the direction, and the colour carries the judgement.

Markup: `div.c-stat` (or `a.c-stat` with a stretched link when `href` is given). Contents: `p.c-stat__label` (caps label),
`p.c-stat__value` (`--step-2`, `u-tabular`) with `span.c-stat__unit` (for example "pts") after it, `p.c-stat__delta`
with an arrow icon (`chevron-up` or `chevron-down`, `aria-hidden`) and the text, `p.c-stat__hint` in `--ink-2`, and
`spark` as a `sparkline` (section 6.20) below the value.

Accessible name and text: the value and unit are read in order ("Points balance, 1 240 pts, up 12 percent"). The delta
text carries its own sign and direction words through `format.js`. The spark is decorative when the tile's values are
visible in the delta text; otherwise the sparkline carries its own label.

Visual: tier 1. The label sits above the value with `--space-2`. Hover on linked tiles: wash `--paper-2`.

### 6.17 states.js

Signatures (fixed):

```js
emptyState({ icon, title, body?, action? }) -> HTMLElement
skeleton({ lines?, shape?: "text"|"card"|"table"|"tile" }) -> HTMLElement
errorState({ error, retry? }) -> HTMLElement
loading(label) -> HTMLElement
```

`emptyState`: `section.c-state.c-state--empty` with the icon at 24 px (`aria-hidden`), `h2`-free `p.c-state__title` in
`--step-0` bold, `body` in `--ink-2`, and `action` as a `button` or `linkButton`. Used for a list or panel with no rows.
It explains what is empty and offers the next step when the user has one.

`skeleton`: `div.c-skeleton.c-skeleton--<shape>` with `aria-hidden="true"`; the owning region carries `aria-busy="true"`.
Shapes: `text` (rows of `--paper-2` bars of decreasing width; `lines` sets the count, default 3), `card` (a rectangle with
the card's rule), `table` (header bar and rows, matching the table's column count via `lines`), `tile` (a stat-sized
block). Skeletons are static: no shimmer and no animation (Meridian's rule for first load).

`errorState({ error, retry? })`: `section.c-state.c-state--error[role="alert"]` with the icon "alert" in `--danger-fg`,
the title "Something went wrong" (or the mapped message for known codes), the error code and message in `--step--1`,
and a `button` "Try again" that calls `retry` when given. The raw error body is shown only as code and message; never a
stack trace or JSON. Refusal reasons (`details.reason`) use their message from the caller.

`loading(label)`: `p.c-state.c-state--loading[role="status"]` with the text "Loading <label>" in `--ink-2`. No spinner.
Loading placeholders (skeletons) appear only after a fixed 300 ms delay, so fast responses do not flash. Within the
delay the region is simply empty and `aria-busy` is set.

Responsive: states are centred on the tablet row and wider; on the phone row they are left-aligned.

### 6.18 timeline.js

Signature (fixed):

```js
timeline({ label, items: [{ at, icon?, tone?, title, body?, actor?: PersonRef, href? }] }) -> HTMLElement
```

Markup: `ol.c-timeline[aria-label=label]`; each item `li.c-timeline__item` with a marker (the icon in a 1.5rem square with
the tone's `-border` edge, or a tone-coloured dot), `time.c-timeline__time[datetime]` showing `relativeTime(at, now)` with
the full `dateTime(at)` in `title`, the title (linked when `href` is given), `body` (plain text or a `richtext` node from
the caller), and `actor` as a `personChip`. The list is a plain ordered list; it is not a live region.

Visual: a 1 px `--rule` line runs down the marker column. Items are separated by `--space-4`. Titles `--step-0`
semi-bold; time and actor `--step--1` in `--ink-2`. Tone colours the marker and never the body text.

Responsive: unchanged; the timeline is full width on every row.

### 6.19 progress.js

Signatures (fixed):

```js
progressBar({ value, max, label, tone? })  -> HTMLElement
progressRing({ value, max, label, size? }) -> HTMLElement
```

`progressBar`: `div.c-progress` with a native `progress` element (`value`, `max`, `aria-label` set to `label`). The fill is
the tone's `-fg` colour on a `--paper-2` track with a 1 px `--control-border` edge (3:1 for the track edge). The visible
text beside it is the percentage through `percent()`. Tone defaults to `info`; a threshold breach uses `warning` or
`danger` with a text sentence (for example "Budget 80 % used"), never colour alone.

`progressRing`: `svg.c-ring[role="img"]` with a `title` of "<label>, <percent>". Track circle `--paper-2`, progress arc
`--ink`, stroke 4 px at size 40 px by default (`size` sets the pixel size, 32 to 96). The percentage is rendered as text at
the centre, `aria-hidden`, because the title already carries it.

Visual: no animation on change. A value that changes through a realtime event follows the arrival rule only if the caller
marks it (section 9.6).

### 6.20 chart.js

Signatures (fixed):

```js
sparkline(values, { label }) -> SVGElement
miniBars(values, { labels, label }) -> SVGElement
donut(parts, { label }) -> SVGElement
```

These are small inline charts for tiles and table cells. Full charts stay in the reporting module.

- Each returns `svg.c-chart[role="img"]` with `aria-label` set to `label` and a `title` child containing the label and a
  computed summary sentence (for example "Points earned, 12 days, from 40 to 310, highest on day 9").
- A visually hidden list (`ul.sr-only`) follows the svg with the values, so the numbers are reachable without the drawing.
- `sparkline`: a polyline in `--series-1` with `--series-dash-0`, 2 px stroke, no axes, no fill. Height 2rem.
- `miniBars`: one `rect` per value in `--series-1`, bar tooltip as `title` text, `labels` used for `title` text and the
  hidden list. Height 3rem.
- `donut(parts, { label })`: `parts` is `[{ label, value }]`. Segments use `--series-0` to `--series-4` in order, each with
  its `--series-dash-<i>` dash on the stroke and its marker in the legend. The legend is a text list beside the donut
  (`ul.c-chart__legend`), with the label, the value through `number()`, and the percentage. Colour is never the only key.
- Charts redraw only when their measured size changes, through a `ResizeObserver` that calls `frameOnce`.

### 6.21 builder.js

Signatures (fixed):

```js
ruleBuilder({ label, facts: FactDef[], value: CondTree, onChange, maxDepth?: 3 }) -> HTMLElement
stepList({ label, items, renderItem: (item, index) => Node, onAdd, onRemove, onMove, addLabel, max }) -> HTMLElement
```

#### ruleBuilder

Edits the `CondTree` grammar from `conditions.ts`. The tree has four node kinds: `all` (array of children, 1 to 20),
`any` (same), `not` (exactly one child), and a `Condition` (`field`, `op`, `value`). The root is always a group. Output
is always a valid `CondTree`; `onChange(tree)` is called only with a valid tree.

Structure:

```html
<div class="c-rule" role="group" aria-label="<label>">
  <fieldset class="c-rule__group" >
    <legend class="c-rule__legend">
      <select class="c-rule__join"> All of / Any of / Not </select>
    </legend>
    <div class="c-rule__children">
      <div class="c-rule__row"> <select fact> <select op> <value control> <iconButton remove> </div>
      <fieldset class="c-rule__group c-rule__group--nested"> … </fieldset>
    </div>
    <div class="c-rule__actions"> button "Add condition" · button "Add group" · button "Remove group" (nested only) </div>
  </fieldset>
  <p class="c-rule__summary">Members where tier is Gold and region is one of EMEA, APAC</p>
</div>
```

Group join operator: `all` shows "All of the following are true"; `any` shows "Any of the following is true"; `not` shows "None of the
following is true" and holds exactly one child, so "Add condition" and "Add group" are disabled inside a `not` group that
already has its child, with the hint "Wrap this in an All or Any group to add more". Changing the join keeps the children.

Depth: the root group is depth 1. A nested group at depth `maxDepth` (default 3) gets no "Add group" button. Each group
holds at most 20 children (the grammar limit); "Add condition" is disabled at 20 with a hint.

Empty groups: an `all` or `any` group with no children is not a valid tree. The builder keeps the last valid tree, shows the
group's error "Add at least one condition or remove this group", and does not call `onChange` until the group has a child.

Condition row: fact select lists `facts` by `label`. Changing the fact resets the operator to the first operator of the new
fact's `ops` and the value to empty. Operator labels: `eq` "is", `ne` "is not", `lt` "is less than", `lte` "is at most",
`gt` "is more than", `gte` "is at least", `in` "is one of", `not_in` "is none of", `contains` "includes", `not_contains`
"does not include", `exists` "is set", `not_exists` "is not set", `between` "is between". Only the fact's `ops` are offered.

Value control by `FactDef.type`:

| Type | Operators with a value | Control |
|---|---|---|
| `string` | `eq`, `ne`, `contains`, `not_contains` | `textField` |
| `string` with `in`, `not_in` | list of text values | `textField` with comma-separated values, trimmed, empty items dropped |
| `int`, `float` | `eq`, `ne`, `lt`, `lte`, `gt`, `gte` | `numberField` (`step` 1 for `int`, `any` for `float`) |
| `int`, `float` with `between` | `between` | two `numberField`s, "from" and "to"; "from" must not exceed "to" |
| `bool` | `eq`, `ne` | `selectField` with Yes and No |
| `timestamp` | `eq`, `ne`, `lt`, `lte`, `gt`, `gte` | `dateTimeField` |
| `timestamp` with `between` | `between` | two `dateTimeField`s |
| `enum` | `eq`, `ne` | `selectField` over `values` |
| `enum` | `in`, `not_in` | a `fieldset` of `checkboxField`s, one per value |
| `string[]` | `contains`, `not_contains` | `combobox` (multiple) when `values` is given; otherwise `textField` with comma-separated values |
| any | `exists`, `not_exists` | no value control; the row reads "Tier is set" |

Keyboard model: Tab and Shift+Tab move through the controls in document order. Buttons are the only way to add or remove
rows and groups; there are no custom shortcuts. Adding a row moves focus to the new row's fact select. Removing a row
moves focus to the next row's fact select, or the previous one, or the group's "Add condition" button. Each add, remove
and fact change posts a short message to `#announcer` ("Condition added, 3 in this group"). The builder does not use an
APG pattern for its rows; it is a form made of groups, so native form semantics and focus order carry it.

Summary: the `p.c-rule__summary` sentence is generated from the tree and the fact labels. It is `aria-live="off"`, and it
is recomputed on each valid change. Values in the sentence are formatted with `format.js` (points with "pts", timestamps
with `dateTime`), and enum and list values are quoted by their labels.

Max depth and size are validated before `onChange`. The builder never parses a value as code; values are typed by the
`FactDef.type`.

#### stepList

An ordered list of step cards for workflows (automation steps, promotion stages).

Markup: `ol.c-steps[aria-label=label]` with `li.c-step` per item. Each item has a header row: "Step <n>" caps label,
buttons "Move up", "Move down" (`iconButton` with `chevron-up` and `chevron-down`), "Remove step" (`iconButton` with `x`),
and the body `renderItem(item, index)` below. "Add step" is a `button` with `addLabel` after the last item.

Keyboard reorder: the header buttons are the reliable path. On a focused step, Alt+ArrowUp and Alt+ArrowDown also move
the step, and move focus with it. Each move calls `onMove(from, to)` and announces through `#announcer` ("Step 2 moved
to position 1 of 3").

Limits: `max` disables "Add step" at the limit with the hint "Up to <max> steps". "Move up" is disabled on the first
item and "Move down" on the last. Removing a step does not confirm; the caller decides whether to use `confirmDialog`.

Visual: each step is a tier 1 card with a `--rule` top edge and the step number in caps label style. Steps are separated by
`--space-3`. Responsive: the header buttons wrap under the step number on the phone row; no horizontal scroll.

### 6.22 layout.js

Signatures (fixed):

```js
pageHeader({ title, eyebrow?, meta?: Node[], actions?: Node[], back?: { href, label } }) -> HTMLElement
section({ title?, actions?, body, id? }) -> HTMLElement
splitView({ list, detail, label }) -> HTMLElement
toolbar({ label, children }) -> HTMLElement
```

`pageHeader`: `header.c-page-header` inside `main`. Contents: an optional `linkButton` back link (`chevron-left` icon,
label from `back.label`), `p.c-page-header__eyebrow` (caps label), `h1.c-page-header__title` (`--step-2`, bold,
`--track-tight`), `div.c-page-header__meta` (nodes separated by a `--rule` vertical hairline, `--step--1`), and
`div.c-page-header__actions` (right-aligned on desktop; below the title on the phone row). The header has a top edge of
`--rule-heavy` (6 px) in `--ink`, the Meridian masthead rule. Each page has exactly one `pageHeader` and one `h1`.

`section`: `section.c-section[aria-labelledby]` with a `--rule` top edge, `h2.c-section__title` (`--step-1`, bold) and
`actions` at the right. `id` sets the element id for anchor links. Sections without `title` are `div.c-section`.

`splitView({ list, detail, label })`: `div.c-split[aria-label=label]` with `div.c-split__list` and `div.c-split__detail`.
On the desktop row and wider, the list is `minmax(16rem, 22rem)` and the detail takes the rest, both scrolling
independently. On the phone and tablet rows only one column shows at a time: the list by default, the detail when a
selection exists (the root carries `data-view="detail"`, set by the caller). The detail column has a "Back to list"
`linkButton`-styled button shown only in the single-column layout. Focus moves to the detail heading when the view
switches to detail, and back to the selected list item when it returns to the list.

`toolbar({ label, children })`: `div.c-toolbar[role="toolbar"][aria-label=label]` containing the children as controls.
Roving tabindex per APG Toolbar: Left and Right move between controls (Home and End to the ends), Tab leaves the toolbar.
Controls inside are buttons, selects or search fields; the toolbar wraps on the phone row with a `--space-2` gap.

### 6.23 kbd.js

Signature (fixed): `kbd("Ctrl+K")` returns `span.c-kbd`, which contains one `kbd` element per key name separated by `+`.
The text is split on `+`; each part is a `kbd`. Used in menu shortcuts, the palette trigger and tooltips. The element's
text reads "Ctrl plus K" through `aria-label` on the span, and the inner `kbd` elements are `aria-hidden`.

### 6.24 richtext.js

Signature (fixed): `inlineText(text, { mentions?: (handle) => href })` returns a `span` whose children are text nodes and
elements.

Grammar (the content and message inline grammar):

- `**bold**` becomes `strong`.
- `_em_` becomes `em`, only when the underscores sit at word boundaries.
- `@handle` (handle pattern from `primitives.ts`, `^[a-z][a-z0-9-]{1,39}$`) becomes an `a.c-mention` when `mentions(handle)`
  returns a path, otherwise a `span.c-mention`. Mentions are never links to external URLs.
- Markers do not nest. An unmatched marker is rendered literally.

Implementation: a single pass over the string with a tokenizer, creating text nodes with `document.createTextNode` and
elements with `h()`. No HTML is parsed. Any `<`, `>` or `&` in the input is plain text.

### 6.25 icons.js

Signature (fixed): `icon(name, { label?, size? }) -> SVGElement`. `name` is one of `ICON_NAMES`. An unknown name throws a
`TypeError` in development; the `check.mjs` extension in section 12 verifies that every name in `ICON_NAMES` has a path
and that every name used by a module is in `ICON_NAMES`. Sizes: `16`, `20` (default) and `24` px. Section 8 gives the
full icon rules.

### 6.26 format.js

Signatures (fixed; semantics in section 9.7): `points(n)`, `signedPoints(n)`, `cents(n)`, `number(n)`, `percent(x)`,
`relativeTime(iso, nowIso)`, `dateTime(iso)`, `date(iso)`, `initials(name)`. Pure functions, no DOM.

### 6.27 dom.js

Contract (same as today's `src/js/dom.js`): `h(tag, attrs, ...children)` builds an HTML element, `s(tag, attrs, ...children)`
builds an SVG element; `attrs` values are set with `setAttribute`, properties `on*` are event listeners; children may be
nodes, strings or arrays; `clear(el)` removes children; `uid(prefix = "m")` returns `prefix-<n>`; `frameOnce(fn)` returns
a function that calls `fn` at most once per animation frame. `$(selector, root = document)` returns the first match.

---

### 6.28 Modern CSS patterns: anchors, popovers, `:has()`, subgrid

These are the platform features the components use in place of script. Each is the pattern a widget should reuse.

**Anchor positioning.** A floating element is tied to its trigger in CSS. Name the trigger (`anchor-name: --anchor-<id>`,
set from JS with a unique id, never a shared name), point the floating element at it (`position-anchor`), choose the
side with `position-area` and let the browser handle the edge with `position-try-fallbacks: flip-block, flip-inline`.
Placements map to areas: `bottom-start` is `block-end span-inline-end`, `bottom-end` is `block-end span-inline-start`,
`top-start` is `block-start span-inline-end`, `top-end` is `block-start span-inline-start`. Use `anchorTo()` from
popover.js rather than writing the names by hand; it is used by `popover()` (bell panel, points and reporting
popovers) and `menuButton` (topbar identity and theme menus). The combobox listbox (a non-popover element) names its
`.c-combobox__box` and uses `position-area: block-end` with `inline-size: anchor-size(inline)`. Without support
(`CSS.supports("position-anchor: --a")` false) popover.js and menu.js fall back to fixed `top` and `left` computed once
on open and on resize and scroll, and the combobox keeps its static `inset-block-start: calc(100% + 4px)` placement.
Do not read `getBoundingClientRect()` to place overlays anywhere else.

**Popover API.** Overlays that float over a trigger use `popover="auto"`: the browser provides top layer, light dismiss
and Escape. Keyboard and ARIA stay as in sections 6.7 and 6.8 (focus return, `aria-expanded`, roles). Entry and exit use
`@starting-style` with `transition: opacity, translate, overlay, display` and `allow-discrete`, so the element animates
in and out of the top layer. Dialogs, drawers and sheets do the same, including `::backdrop`.

**`:has()` for native state.** Prefer a selector over a state class where the DOM already carries the state:
`.c-field:has(:user-invalid)` and `.c-field:has(.c-field__control:focus-visible)` (field state),
`.c-nav__section:has(> .c-nav__heading [aria-expanded="true"])` (open section), `tr:has(.c-table__select input:checked)`
(selected row), `.c-card:has(> img)` (card with media) and `body:has(dialog[open])` (scroll lock). The classes
`c-field--invalid` and `is-selected` stay supported because widgets set them for their own state; the design system no
longer sets `is-selected` on checkbox rows or `is-open` on nav sections. The nav section list animates its height with
`interpolate-size: allow-keywords` and `content-visibility` as a discrete transition.

**Subgrid card grids.** `.c-card-grid` is an auto-fill grid of cards (`--_card-min`, default `16rem`). A card with
`.c-card--sub` spans `--_card-rows` rows (default 3) with `grid-template-rows: subgrid`, so title, body and foot align
across the cards of a grid row. `.c-card__head`, `.c-card__body` and `.c-card__foot` take rows 1, 2 and 3. For more parts
use `.c-card-grid--rows-4` or `--rows-5` and put each part in `.c-card__row-1` to `.c-card__row-5` (for example title,
meta, price, actions). Every card in a grid must use the same row count. Without subgrid support the cards keep their
flex column.

**Small pieces.** Textareas use `field-sizing: content` (no auto-grow script, between two control heights and half the
viewport). Headings and card and dialog titles use `text-wrap: balance`; body copy in cards, dialogs and popovers uses
`text-wrap: pretty`.

### 6.29 Custom elements (light DOM)

The primitives below are vanilla custom elements. The helpers (`pill()`, `countBadge()`, `updateCount()`,
`personChip()`, `avatar()`, `icon()`, `menuButton()`, `combobox()`, `recipientPicker()`) keep their signatures and
return the element, configured through the same options, so no widget changes. Every element is registered by its own
module when it loads and again, guarded, by `src/ds/js/elements.js` (`defineAll()`, safe to import any number of
times). The shared base is `src/ds/js/element-base.js` (`PElement`, `define`, `reflect`).

**Light DOM on purpose.** No element uses shadow DOM. Tokens, looks (`html[data-look]`), `@scope` rules, layers and
every existing class selector keep applying, because each element carries the classes the helper always drew
(`<p-pill class="c-pill c-pill--warning">`), and descendants keep their classes (`.c-combobox__input`,
`.c-menu__list`). Shadow DOM would cut all of that off for no gain here. The cost is that the element's children are
visible to the page; they are the element's own markup and are rebuilt by `render()`, so callers must not edit them.

**Attributes are the source of truth.** Each property reflects its attribute (`el.tone = "warning"` sets `tone`);
changing an attribute re-renders. Constructors add nothing (a `createElement` result must stay empty), so drawing
happens when attributes change, when properties are set through `el.configure({ ... })` (one render for the batch), and
on connect. `:state()` custom states are set through `ElementInternals.states`.

| Element | Attributes (properties) | Notes |
|---|---|---|
| `<p-pill>` | `tone` = `neutral` (default), `info`, `success`, `warning`, `danger`, `signal`; `icon` (icon name) | The label is the element's text (`el.label` reads and writes it). `statusPill()` adds `c-pill--status-*` and `c-pill--tier-*` classes on top. |
| `<p-count>` | `value`, `label`, `max` (default 99), `tone` | Redraws the number and the screen-reader text on change; `hidden` at 0 or less; `data-n` mirrors the value. `tone="warning"` adds `c-count--warning`. `updateCount(el, n)` sets `value`. |
| `<p-avatar>` | `name`, `handle`, `size` = `xs`..`xl`, `presence` = `online`, `away`, `href`, `src`, `initials`, `hue` | Generated art by default, an `<img>` when `src` is set. `role="img"` with `aria-label` `name[, presence]`; with `href` the art sits in one inner `<a class="c-avatar__link">` instead. |
| `<p-person>` | `name`, `handle`, `subject`, `kind` = `agent`, `service`, `href`, `show-handle`; property `art`, property `person` (an API person record) | Renders "You" for the viewer (`isViewer`: subject, then handle) with the real name and handle in screen-reader text, the `@handle` in the title (or as text with `show-handle`), and an Agent or Service pill. |
| `<p-icon>` | `name`, `label`, `size` = 16, 20, 24 | One inline `<svg class="c-icon c-icon--N">` child. `display: contents`, so the svg is the layout item. `icon()` still throws on an unknown name. |
| `<p-menu-button>` | `label`, `icon`, `variant`, `size`, `icon-only`; property `items` | Items carry handlers, so they are a property (`[{ label, icon, shortcut, danger, disabled, checked, separatorBefore, onSelect }]`). Same trigger, popover list, phone sheet and APG keys as before. `close(restore)` and `trigger` are available. `:state(open)` while the list shows. |
| `<p-combobox>` | `label`, `name`, `multiple`, `placeholder`, `hint`, `error`, `required`, `disabled`, `max`; properties `search`, `onChange`, `selection` | Form-associated, see below. |
| `<p-people-picker>` | as `<p-combobox>` (always `multiple`, `max` defaults to 50); properties `api`, `recipients`, `known`, `onRecipients` | A `<p-combobox>` over `api.call("messages.recipients")`. `recipientPicker()` in `shell/kit.js` wraps it and keeps its `{ el, value, options, set, add, setError }` handle. |

**Events.** `<p-combobox>` and `<p-people-picker>` dispatch bubbling `input` and `change` `CustomEvent`s with
`detail: { value, selection }` when the user chooses or removes an option. The inner search box's own `input` and
`change` events do not leave the element. The `onChange` / `onRecipients` callbacks still run after every user change.
`<p-menu-button>` raises no events of its own; items call `onSelect`.

**Form association (`<p-combobox>`, `<p-people-picker>`).** `static formAssociated = true` and `attachInternals()`.

- Value: `setFormValue` submits the chosen option's `value` under `name` (one entry per value when `multiple`, as
  `FormData`). The inner `<input>` has no `name`, so the search text is never submitted. The second argument to
  `setFormValue` is the JSON of `[{ value, label }]`, restored by `formStateRestoreCallback`.
- Validity: `setValidity` with a message and the inner input as anchor, so `reportValidity()` focuses it. `required`
  with no selection is `valueMissing` ("Choose an option from the list."); an `error` attribute (or
  `setCustomValidity`) is `customError`. `validity`, `validationMessage`, `willValidate`, `checkValidity()`,
  `reportValidity()`, `form` and `labels` are exposed.
- Reset: `formResetCallback` restores the selection the element first rendered with. Disabled: the `disabled`
  attribute and `formDisabledCallback` (a disabled `<fieldset>`) both disable the inner input.
- Custom states: `:state(open)` (listbox showing), `:state(invalid)` (an `error`, or a touched required field with
  nothing chosen), `:state(filled)`. Styled in `combobox.css`.
- ARIA stays on the inner input (APG list-autocomplete combobox: `role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-activedescendant`, `aria-required`, `aria-invalid`). `internals.role` is not set, because a
  second combobox role on the host would announce twice.
- `focus()` on the element focuses the inner input, so `form.querySelector('[name="/to"]').focus()` keeps working;
  `closest(".c-field")` on it is the element itself (it carries `c-combobox c-field`), and `formErrors()` finds it by
  `name` and writes the error into it.

Widgets that build a people or recipient picker themselves (`points/award.js`, `points/transfer.js`,
`promotions/simulator.js` through `combobox()` with a people search) could adopt `<p-people-picker>` only if they move to
`messages.recipients`; today they pass their own `search`, which `<p-combobox>` already takes.

## 6A. Simplification principles and site looks

The Suite's default look is **calm**. The owner's brief: keep every feature, simplify the UX. The principles below
apply to every look except `meridian`, the original boxed look kept for comparison.

### 6A.1 Principles

- **One accent, meaning-only colour.** Colour marks exceptions (overdue, urgent, awaiting decision, failed), never
  routine state. Neutral metadata (type tags such as "Order", "Normal" priority, "Open" status) recedes to muted text.
- **Separators over boxes.** A widget is one soft surface. A table or card inside a widget draws no second border
  (`--nested-*`). Rows are divided by hairlines, not wrapped in boxes.
- **Pills.** Neutral, info and success pills are plain coloured text. Warning, danger and signal pills are tinted,
  borderless and small. Information is never carried by colour alone: the label, and the icon for warning and danger,
  stay.
- **Count badges.** Muted and rounded. Only "needs attention" counts (`c-count--warning`, the top-bar bell) take a tone.
- **People.** `personChip` and `personLine` show "You" for the viewer and drop the `@handle` from dense rows. The
  handle stays in the `title` tooltip and in screen-reader-only text, so identity is still announced.
  `personChip(p, { showHandle: true })` draws it as text for roomy detail views.
- **Page header.** A compact title and one muted description line (it wraps on a phone). No heavy rule, no wash.
- **Widget frame.** Sentence-case title (no tracked caps). The header options menu rests quiet on a fine pointer and
  returns on hover, on focus within and while its menu is open. On touch (`hover: none` or `pointer: coarse`) it is
  always visible and it is always keyboard reachable.
- **Navigation.** Each section heading is a button with `aria-expanded` that shows or hides its list. Personal
  starts open, the others collapsed, and the section holding the current route is always open. The choice is saved in
  `localStorage` (`plinth.nav.open`, inside try/catch). Headings are sentence case.
- **Nothing removed.** Anything quieter is de-emphasised or behind progressive disclosure that stays reachable.

### 6A.2 The looks contract

- **Attribute.** `html[data-look="<id>"]`. Ids: `calm` (default, and used when the attribute is absent), `meridian`,
  `nocturne`, `folio`, `lattice`, `strata`. The server sets it; the styleguide switches it locally.
- **Layer.** A new layer, `looks`, sits between `components` and `modules`:
  `reset, tokens, base, layout, components, looks, modules, utilities, overrides`.
- **Files.** `ds/css/looks/<id>.css`, one per look, plus `_quiet.css`, the shared base of component hooks that every
  look except `meridian` inherits. Order of import: `_quiet`, then the looks. Each look has equal specificity and
  wins by order.
- **Light, dark, density.** Colours use `light-dark()`, so each look works with `data-theme` and
  `prefers-color-scheme`. A look never overrides `--row-h` or the control heights when `data-density="compact"`.
- **Fonts.** System stacks only. No web font is loaded.
- **Scope for previews.** Every look block also matches `.sg-look[data-look="<id>"]`, and `tokens.css` also matches
  `.sg-look`, so the styleguide can show all looks side by side, each re-deriving its own tokens.
- **Tokens, hooks and fallbacks.** Looks may define tokens and hooks (the acceptance check allows it in
  `ds/css/looks/` only). Every hook a component reads has a fallback equal to today's Meridian value, which is why
  `meridian.css` overrides nothing.

Tokens each look overrides (all in `light-dark()` where a colour):

| Look | Tokens |
| --- | --- |
| calm | `--paper`, `--paper-2`, `--paper-3`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--control-border`, `--accent`, `--accent-on`, `--focus`, `--surface-1..3`, `--page-wash`, `--chart-breach`, `--step-2`, `--radius-1`, `--radius-control`, `--radius-card`, `--rule-heavy`, `--shadow-1`, `--shadow-1-hover`, `--font-sans` |
| meridian | none (tokens.css values); sets `--look` only |
| nocturne | neutrals and accent as calm, plus `--success-fg`, `--warning-fg`, `--danger-fg`, `--info-fg`, `--radius-*`, `--shadow-1`, `--shadow-1-hover`, `--widget-edge`, `--widget-shadow(-hover)`, `--widget-title-weight`, `--pill-weight`, `--count-bg`, `--header-title-weight`, `--nav-current-bg` |
| folio | neutrals, accent, surfaces, `--font-display`, `--font-sans`, `--track-tight`, `--radius-*`, `--shadow-1(-hover)`, `--header-rule`, `--header-pad`, `--header-title-size/-weight`, `--widget-bg`, `--widget-edge`, `--widget-radius`, `--widget-title-*`, `--nested-bg`, `--pill-radius`, `--count-radius`, `--nav-current-bg` |
| lattice | neutrals, accent, surfaces, `--radius-*`, `--shadow-1(-hover)`, `--step--2`, `--step--1`, `--space-5`, `--row-h`, `--control-h-sm/-md`, `--space-cell-y` (not when compact), `--widget-edge/-radius/-title-*`, `--header-title-size`, `--nav-current-bar/-bg`, `--pill-*` (tinted badges), `--count-radius` |
| strata | neutrals, accent, surfaces, `--page-wash`, `--radius-*`, `--rule-heavy`, tinted `--shadow-1(-hover)`, `--widget-edge/-shadow(-hover)/-title-weight`, `--header-title-weight`, `--count-bg`, `--nav-current-bg`, `--pill-weight` |

Component hooks (defaults in `_quiet.css`, fallback to Meridian elsewhere):

- pill: `--pill-h`, `--pill-px`, `--pill-radius`, `--pill-bw`, `--pill-fs`, `--pill-weight`, `--pill-icon`,
  `--pill-info-icon`, and per tone `--pill-<neutral|info|success|warning|danger|signal>-fg/-bg/-edge/-px`.
- count badge: `--count-size`, `--count-radius`, `--count-bg`, `--count-fg`, `--count-edge`, `--count-warn-bg/-fg/-edge`,
  `--badge-bg`, `--badge-fg` (top-bar badge).
- widget frame: `--widget-bg`, `--widget-edge`, `--widget-radius`, `--widget-shadow`, `--widget-shadow-hover`,
  `--widget-title-size/-weight/-track/-transform/-color`, `--widget-menu-rest`, `--nested-bg/-edge/-shadow`.
- page header: `--header-rule`, `--header-rule-color`, `--header-pad`, `--header-mb`, `--header-wash`,
  `--header-title-size/-weight`, `--header-meta-wrap/-ws/-color`, `--header-eyebrow-track/-transform`.
- app chrome and emphasis: `--app-bg` (page background, may be a gradient), `--nav-bg`, `--nav-shadow`, `--nav-inset`,
  `--nav-radius`, `--nav-blur` (a floating frosted side bar), `--topbar-bg`, `--topbar-shadow`, `--nav-current-fg`,
  `--nav-current-bar-color`, `--btn-primary-bg/-fg/-edge`, `--stat-size`, `--stat-weight`,
  `--widget-head-edge/-gap/-bg` (a ruled header band). A look may also set `color-scheme` on `.app__nav` and
  `.app__topbar` to keep them dark in light mode (nocturne), and nocturne sets `color-scheme: dark` on the root
  unless `data-theme="light"`.
- nav, brand, tables, people: `--nav-heading-size/-track/-transform`, `--nav-section-gap`, `--nav-current-bar/-bg/-weight`,
  `--brand-track/-transform`, `--th-size/-track/-transform`, `--person-weight`, `--font-display`.

---

## 7. Generated artwork

Artwork is generated from data. No image files and no external assets are used. The same input always produces the same
markup.

### 7.1 artwork()

Signature (fixed): `artwork({ icon, hue, pattern, glyph }, { size, label }) -> SVGElement`. The first argument is the
`Artwork` schema from `primitives.ts`: `icon` (an `IconName`), `hue` (0 to 359), `pattern` (one of `ARTWORK_PATTERNS`:
`solid`, `stripes`, `dots`, `rings`, `grid`, `waves`), and `glyph` (up to three characters, optional).

Geometry, in a 96 by 96 `viewBox`:

- A field: the full square, filled with the field colour (7.4).
- The pattern, drawn in the pattern colour, clipped to the field:
  - `solid`: nothing.
  - `stripes`: parallel lines at 45 degrees, 8 units apart, 2 units wide.
  - `dots`: a 12 by 12 grid of circles of radius 1.5.
  - `rings`: concentric circles centred on the field, radii 12 to 48 in steps of 12.
  - `grid`: horizontal and vertical lines every 16 units, 1 unit wide.
  - `waves`: three sine paths across the field, 16 units amplitude.
- A disc at the centre, radius 28, filled with the disc colour (7.4).
- The icon in the centre, 40 by 40 units, drawn in the icon colour (the icon path set from section 8).
- `glyph`, when set, is a text element under the icon at the bottom of the disc, in `--step--2` semi-bold, `text-anchor:
  middle`. Glyph text is set with a text node.

Colours (through CSS, section 7.4): the SVG carries `--art-hue` as a style property, and `artwork.css` assigns the field,
pattern, disc and icon colours with `light-dark()` from that hue. The geometry in JS does not depend on the theme.

Label: `label` sets `role="img"` and `aria-label`. Without a label the SVG is `aria-hidden="true"` and `focusable="false"`.

### 7.2 badgeArt()

Signature (fixed): `badgeArt({ shape, icon, hue, ring }, { size, label }) -> SVGElement`.

- `shape`: one of five outlines, each drawn in a 96 by 96 viewBox: `disc` (circle, radius 40), `hexagon` (regular hexagon,
  circumradius 42, flat top), `shield` (a heater shield with a pointed bottom), `star` (five points, outer radius 42, inner
  radius 18), `diamond` (square rotated 45 degrees, half-diagonal 42). Shape names are the shape enum for this function.
- The shape is filled with the badge field colour (hue-based, as 7.4) and the icon is drawn at the centre at 36 by 36
  units, in the disc colour.
- `ring`: `null` or a tier name (`bronze`, `silver`, `gold`, `platinum`). A tier ring is the same outline stroked 4 units
  wide, outset 4 units, in `--tier-<name>`. Its contrast against the page is 3:1 or better (section 3.6). Without a ring
  the shape has no edge.
- `label` as in 7.1.

### 7.3 avatarArt()

New export of `artwork.js` (the boundary named the avatar art helper without a signature; this document fixes it):
`avatarArt({ initials, hue }, { size, label }) -> SVGElement`. Used by `avatar()` for an avatar with no image. It draws a
square of the hue as the background and the initials centred in a system sans, with a `text` element of
`--step-0` bold. The background and text colours come from CSS on the `--art-hue` property:

- light theme: background `oklch(0.42 0.1 <hue>)`, text `oklch(0.99 0 0)` (16.7:1 at hue 200; the lightness rule holds for
  any hue at chroma 0.1);
- dark theme: background `oklch(0.82 0.08 <hue>)`, text `oklch(0.17 0.009 260)` (7.4:1 at hue 200).

The chroma is capped at 0.1, which keeps each pair above 4.5:1 for every hue. The `avatar` component wraps this SVG in
the avatar root and the initials are read by the parent's `aria-label`, so the SVG itself is `aria-hidden`.

### 7.4 Field and disc colours

For `artwork()` and `badgeArt()` the colours are defined in `artwork.css` (components layer, class `.c-art`):

```css
.c-art { --art-field: light-dark(oklch(0.9 0.05 var(--art-hue)), oklch(0.3 0.06 var(--art-hue)));
         --art-pattern: light-dark(oklch(0.62 0.12 var(--art-hue)), oklch(0.5 0.1 var(--art-hue)));
         --art-disc: var(--surface-1);
         --art-icon: var(--ink); }
```

The disc is `--surface-1` and the icon is `--ink`, so the icon contrast is the same as body text (above 15:1 on both
themes). The field and pattern carry the hue; they never carry text.

### 7.5 Category and product placeholders

Category and product images are not stored. Placeholders are derived:

- Category: `artwork({ icon: <category icon>, hue: <category hue>, pattern: <category pattern>, glyph: undefined }, ...)`
  where the category's icon, hue and pattern come from the category node's data. When the node has none, the DS builder
  uses the category slug to derive them with the rule below.
- Product: same as category, with the icon from the product's category and a glyph of the product's first two letters in
  caps, when the product has no image.
- Derivation rule for a missing hue or pattern: FNV-1a 32-bit hash of the slug, then `hue = hash mod 360` and
  `pattern = ARTWORK_PATTERNS[(hash >>> 9) mod 6]`. Same slug, same output, on every device.

### 7.6 Readability rules

- The icon and glyph are on the disc, never on the pattern. The disc is `--surface-1` in both themes.
- The field colour never falls below 1.5:1 against the disc, and the pattern never reduces the icon's contrast
  because the disc sits between them.
- Artwork has a label when it conveys information (a badge, a category with no visible text beside it). Otherwise it is
  decorative (`aria-hidden`).

---

## 8. Icons

### 8.1 Style

- A 24 by 24 grid. Stroke 1.5 units, `stroke-linecap: square`, `stroke-linejoin: miter`, no fill unless the glyph is a solid
  mark (`check-circle`, `star` when active, `heart` when active).
- Stroke and fill use `currentColor`. An icon takes its colour from its parent's `color`, never from a hard-coded value.
- Sizes: 16 px (inline with `--step--1` text, pills, tags), 20 px (default, buttons and nav), 24 px (empty states, stat
  decoration, card headers).
- `icon(name, { label, size })`: with `label`, the SVG has `role="img"` and `aria-label`. Without it, `aria-hidden="true"`
  and `focusable="false"`. Icons next to visible text are always unlabelled.
- Icons are not used alone for a status. A status icon always has its text (section 6.13).

### 8.2 Names by use

The closed set is `ICON_NAMES` in `primitives.ts`. Every name is listed here once, by its main use.

| Use | Names |
|---|---|
| Navigation and shell | `home`, `inbox`, `send`, `archive`, `bell`, `search`, `command`, `menu`, `board`, `list`, `settings`, `logout`, `globe` |
| Commerce and points | `store`, `cart`, `bag`, `tag`, `gift`, `coins`, `wallet`, `transfer`, `percent`, `ticket`, `box`, `truck` |
| Rewards and recognition | `trophy`, `medal`, `award`, `crown`, `star`, `flame`, `bolt`, `target`, `sparkle`, `heart` |
| Promotions and messaging | `megaphone`, `announcement`, `mention`, `reply`, `attachment` |
| Automation | `workflow`, `play`, `pause`, `stop`, `branch`, `webhook`, `history` |
| Content | `document`, `article`, `image`, `book`, `link`, `external` |
| People and access | `users`, `user`, `group`, `segment`, `shield`, `key`, `lock`, `eye`, `eye-off` |
| Analytics and time | `chart`, `calendar`, `clock`, `audit` |
| Tasks and status | `check`, `check-circle`, `x`, `alert`, `info`, `task` |
| Editing | `plus`, `minus`, `edit`, `trash`, `copy`, `filter`, `sort`, `more`, `sliders` |
| Navigation controls | `chevron-left`, `chevron-right`, `chevron-down`, `chevron-up` |
| Decoration and categories | `leaf`, `plant`, `mountain`, `sun`, `moon`, `coffee`, `headphones`, `laptop`, `shirt` |

Every name in `ICON_NAMES` appears once in the table above. Names used for category artwork (the decoration row) are chosen
by the category data; the DS builder adds the path for every name and nothing else.

---

## 9. Patterns

### 9.1 Widget templates

Every page is a grid of widgets (section 13); these templates describe a widget's internal layout at its larger
sizes (`l`, `xl`, `full`). At `s` and `m` a widget shows a compact summary view. Where the templates below say
"page", read "widget body"; where they say `pageHeader`, a widget uses its frame header and a `toolbar`.

Every widget body is built from one of five templates. The page's first element is the `pageHeader` (section 6.22). Within
`main`, the template is the only child under the header.

| Template | Structure | Use |
|---|---|---|
| List page | `pageHeader` with actions; `toolbar` (search field, filters, sort, bulk actions); `dataTable`; `pager` | inbox, orders, members, approvals, tasks, audit log |
| Detail page | `pageHeader` with `back`; `tabs` (`urlParam`); tab panels built from `section`s; a summary `card` in an aside on desktop, stacked above on phone | an order, a member, a promotion, a content item |
| Editor with side preview | a two-column layout: form (`--form-max` width) and a preview panel (tier 1 card) on the desktop row; stacked on phone with the preview after the form | content, promotion copy |
| Builder page | `pageHeader`; `ruleBuilder` for conditions (section 6.21) or `stepList` for workflow steps; a preview summary card with a live count | segments, promotion eligibility, automation, badge criteria |
| Dashboard grid | a 12-column CSS grid of `card`s and `statTile`s; widgets declare their column span (`span 3`, `span 4`, `span 6`, `span 12`); stacks to one column on the phone row | home, reports overview |

Dashboard grid widths: 12 columns at the wide row (`min-width: 90rem`), 6 columns at the desktop row, 2 columns at the
tablet row, 1 column at the phone row. A widget's span is clamped to the column count of the row it is on. Widgets do not
reorder by themselves; reading order is the DOM order.

Split views (section 6.22) are used for list-detail screens where the detail is opened from the list (messages, approvals,
tasks). The dashboard does not use split views.

### 9.2 Empty, loading and error

- Empty: use `emptyState` when a list or panel has no rows because nothing exists. Use a filtered empty message ("No
  results for ‘...’" plus a button to clear filters) when filters or a search exclude everything. Never show a blank
  panel. A page with no data at all says what the page is for and gives the first action, if the user may take it.
- Loading: first load of a page shows skeletons shaped like the final layout (a table skeleton with the same column count, a
  card skeleton with the same body lines). Navigation between pages of the same kind keeps the previous content with
  `aria-busy="true"` on the region, and does not flash skeletons. Placeholders appear after 300 ms (section 6.17).
- Error: use `errorState` for a failed region with its code and message and a "Try again" action. A failed panel inside a
  dashboard shows the error in its own card, so the other widgets keep working. Never show raw JSON or stack traces.

### 9.3 Forms

Layout: one column, max width `--form-max`, labels above controls, hints below labels and above errors. On the tablet row
and wider, related fields sit in a `.c-form__row` two-column grid. Required fields are marked (section 6.2). Submit is the
primary button at the end of the form, with a secondary "Cancel" to its left. The form note "Fields marked * are required"
appears above the first field.

Validation display. The API error body is `{ code, path, message }`, where `path` is a JSON pointer into the request body
(for example `/title` or `/schedule/start` or `/steps/0/amount`).

- Every field's `name` attribute is its JSON pointer relative to the request body root. A field for `title` has
  `name="/title"`; a nested field has `name="/schedule/start"`; an array item field has `name="/steps/0/amount"`. Forms build
  the request body from these names, so the name and the request path are the same string.
- `formErrors(errorBody, { form })` looks up the field whose `name` equals `path` exactly. If found, that field gets
  `aria-invalid="true"` and its error text (`message`), and the summary lists it with a link to the field's `id`. If no field
  matches, the summary lists the message alone with no link. A `null` body clears all field errors and removes the summary.
- On submit with errors, focus moves to the summary (`role="alert"` announces it), and the first invalid field is
  reachable by the summary's first link.
- A field's error clears when its value changes. The summary stays until the next submit.
- Errors with `code` `CONFLICT` and `details.reason` `STALE_VERSION` show a banner "This changed while you were editing"
  with a "Reload" action, not a field error.

### 9.4 Optimistic updates and realtime arrival

Optimistic updates: an action the user takes (mark read, star, move a task) updates the UI at once, sets the region to
`aria-busy="true"`, and sends the request. Success clears the busy state. Failure restores the previous state and shows a
`toast` with tone `danger` and the error message; a `STALE_VERSION` failure reloads the region instead. The optimistic state
does not dim the content; the change is visible at its final state.

Arrival animation: when a realtime domain event adds or changes an item in a list that is already on screen, the caller
adds the class `u-arrive` to that item and inserts a `pill({ label: "New", tone: "signal" })` into it. Only realtime events
trigger it. Items present at load never animate. `u-arrive` (utilities layer) does two things:

- a 2 px accent rule draws across the item's inline-start edge over `--dur-2`, and
- the item's background washes with `--accent-wash` and fades back to the surface over `--dur-3`.

The class is removed after `--cause-hold` (6 s), and the pill stays until the item is next re-rendered.

Reduced motion keeps the signal without motion (section 10.5): the rule is present at full width at once, the wash stays for
the hold period, and the "New" pill remains. The information is the pill and the rule; motion is never the only signal.

Counts (the bell, the inbox, nav badges) update with `updateCount` and do not animate.

### 9.5 Realtime status

The live mark in the top bar is the only realtime status on screen (section 5.2). Disconnection shows "Reconnecting" in the
warning tone and does not block the UI. When the connection returns, `rt.js` resumes from the last sequence number, and the
region announces "Live again" through `#announcer` only if the user had been told "Reconnecting".

### 9.6 Announcements

`#announcer` is the only general live region. Messages, short and in plain sentences:

- route title on navigation (section 5.5),
- form outcome ("Saved", "Order cancelled"),
- list changes made by the user ("Task moved to Done"),
- builder and step changes (`ruleBuilder` and `stepList`, section 6.21),
- connection changes (section 9.5).

A message is cleared by replacing its text. Realtime arrivals of items are not announced one by one; the list's "New"
pill is visible, and a single status message is posted per batch ("3 new messages").

### 9.7 Number and text formatting

All formatting goes through `format.js`. The user's locale and timezone come from `prefsStore`; the defaults are the
browser's.

| Function | Input | Output | Rule |
|---|---|---|---|
| `points(n)` | integer, non-negative | `1 240 pts` | thousands separated by U+2009 (thin space); unit `pts` after a U+00A0 non-breaking space; always `pts`, including for 1 and 0 |
| `signedPoints(n)` | integer, any sign | `+1 200 pts`, `−300 pts`, `0 pts` | a plus sign for positive, U+2212 minus for negative, no sign for zero |
| `cents(n)` | integer minor units | `$12.34` | `Intl.NumberFormat` with the currency code; the currency source is open (section 12, item 17) and defaults to `USD` |
| `number(n)` | number | `12 450` | thin-space grouping, no unit; decimals kept to the value, at most 2 |
| `percent(x)` | fraction 0 to 1 (or a number over 1, clamped to 1 for bars only) | `42 %` | no decimals at or above 10 %, one decimal below 10 %; a thin space before `%` in every locale that uses one, otherwise none |
| `relativeTime(iso, nowIso)` | two timestamps | `just now`, `3 min ago`, `in 2 days`, else `dateTime` | pure: `nowIso` is passed in (from `clockStore`), never read from the clock inside the function; under 45 s is "just now"; under 45 min minutes; under 22 h hours; under 6 days days; otherwise the date |
| `dateTime(iso)` | timestamp | `20 Nov 2026, 14:30` | user timezone from `prefsStore`; 24-hour or 12-hour from locale |
| `date(iso)` | timestamp | `20 Nov 2026` | as `dateTime` without the time |
| `initials(name)` | string | `MO` | first letter of the first and last word, uppercase, after Unicode normalisation (NFD, marks removed); one word gives one letter; empty gives `?`; at most 2 characters |

Tabular figures: every formatted number sits in an element with `u-tabular` or a `.c-table__cell--num` cell, so columns
line up and live counters do not shift.

Points in prose use the same `points()` output, never a bare number. A bare number next to a points label is a mistake.

---

## 10. Themes

### 10.1 Default

`prefers-color-scheme` decides the theme when the user has no saved choice. `:root { color-scheme: light dark; }` makes
`light-dark()` follow the operating system.

### 10.2 Override and persistence

The avatar menu's theme items (System, Light, Dark) set `data-theme` on `<html>` to `light`, `dark`, or remove it for System.
The shell owns this. The choice is saved as the per-viewer preference `theme` through `prefsStore`, which uses
`localStorage` inside `try/catch`; if storage is unavailable the choice lasts for the page view only. The saved value is read
before first paint by the inline boot script in `index.html` (the one allowed inline script), so the page does not flash.

### 10.3 Colour rules across themes

- No component hard-codes a colour. Every colour is a token that resolves per theme.
- Text pairs (fg on bg, fg on paper) meet 4.5:1 in both themes, as measured in section 3.
- Non-text boundaries (control edges, focus, tier rings, chart series) meet 3:1 in both themes.
- Hue is never the only signal. Tones carry icons and words. Series carry dash patterns and marker shapes.

### 10.4 Forced colours

`@media (forced-colors: active)` in `overrides.css`:

- Backgrounds and shadows are removed (`box-shadow: none`, `background: Canvas` on surfaces).
- Edges are kept with system colours: `border-color: CanvasText` on controls, `ButtonText` on buttons, `Highlight` for the
  selected tab and option.
- The focus ring uses `outline-color: Highlight` (the system highlight, which the platform makes visible).
- Pills keep their edge and text; tones are told apart by text and icon, which forced colours keep.
- Tier rings and chart series keep their stroke, so a tier and a series remain distinguishable by shape and dash.
- `currentColor` icons keep their colour from the system text colour.

### 10.5 Reduced motion

`@media (prefers-reduced-motion: reduce)` in `overrides.css`:

```css
:root {
  --dur-1: 0ms;
  --dur-2: 0ms;
  --dur-3: 0ms;
}
*, *::before, *::after {
  scroll-behavior: auto !important;
  animation: none !important;
  transition: none !important;
}
```

Nothing moves. Signals stay: the arrival rule is drawn at full length, the wash remains for the hold period, the "New" pill
stays, the live mark keeps its text. The `!important` declarations are the only ones allowed beside `[hidden]`, and they
live in `overrides.css` alone.

### 10.6 Print basics

`@media print` in `overrides.css`: light tokens forced (`color-scheme: light` on `:root` and `--paper` white), shadows and
backgrounds removed, the nav, top bar, drawers, toasts and palette hidden, `main` at full width, `pageHeader` kept,
`dataTable` rows not split across pages (`break-inside: avoid`), cards not split. Links print their text only.

---

### 10.x Modern CSS progressive enhancements

Every item is feature-detected and degrades to the plain look; none hides content when unsupported.

- **Scroll-driven animation** (`components/scroll.css`, `chart.css`, `reporting.css`, `content.css`). Inside
  `@supports (animation-timeline: view())` and `prefers-reduced-motion: no-preference`: stats and KPI cells rise and fade
  in on entry, bars grow from the axis and lines draw in as the plot enters view, the top bar gains a soft shadow over the
  first 3rem of root scroll, and long articles show a thin reading-progress bar under the top bar. Animations use
  `animation-fill-mode: backwards` and start at opacity 0.0001, so the resting state is always the real one.
- **Live-change ring** (`components/live-ring.css`). `data-live-change="human"|"agent"` on `.c-page-grid__item` (set for
  about 2.5 s by the page host) draws a conic-gradient border ring (registered `--_ring-angle`, masked to a ring).
  Human is one quick sweep; agent is a stronger accent-to-signal spin with a glow and an "Agent" corner badge. Reduced
  motion gets a static outline. Each look tunes width, glow and shape through local `--_ring-*` hooks.
- **Customizable select** (`components/field.css`). Under `@supports (appearance: base-select)`, `select` and
  `::picker(select)` are styled from tokens (surface, rule, radius, shadow, `option:checked` on `--accent-wash`). Without
  support the native select is unchanged.
- **Wide gamut.** Each look ends with `@media (color-gamut: p3)` raising the accent (and series where the look defines
  them) in chroma at the same lightness, so contrast against its surfaces and `--accent-on` pairing stay at AA.
- **Container style queries.** `--density` (`comfortable` or `compact`, from `html[data-density]`) is a token;
  `@container style(--density: compact)` in `stat.css` and `widget-frame.css` tightens widget internals. The
  `html[data-density]` rules remain the fallback.
- **Variable fonts.** Google Fonts links in `index.html` (`display=swap`): Fraunces (folio display), Inter Tight
  (lattice), IBM Plex Sans (nocturne). Calm and meridian stay on system stacks. `font-optical-sizing: auto` is set on
  `body`; weights come from `--weight-*`.
- **Speculation rules** (`index.html`). Same-origin document links are prefetched on hover (`eagerness: moderate`),
  excluding `/api/*` and any URL carrying `as=`. The app is a History-API router, so this only helps hard navigations.

## 11. Accessibility checklist

Every item is required. The DS gallery (section 12, item 22) is the place each item is checked by eye, and the acceptance
checks in section 12 check the ones that can be checked by code.

### 11.1 Contrast and colour

- Text and icon colours meet 4.5:1 on their backgrounds (section 3, measured pairs).
- Non-text boundaries (control edges, focus rings, tier rings, chart series) meet 3:1 against the adjacent colour.
- No information by colour alone: status (pill text), tone (icon and text), breach (hatch fill, triangle glyph and a
  sentence), series (dash and marker), delta (arrow and sign).

### 11.2 Targets

- Every interactive target is at least 24 by 24 CSS px (WCAG 2.5.8). Compact density keeps `sm` controls at 24 px.
- On coarse pointers (`@media (pointer: coarse)`) every interactive target is at least 44 by 44 px.
- Targets next to each other keep at least 8 px between them (`--space-2`).

### 11.3 Focus

- Focus is visible on every interactive element (section 3.12), with `:focus-visible`.
- Focus is never removed with `outline: none` without a replacement.
- Focus moves on route change to `#main`, when a dialog opens into it, and returns to the opener when it closes.
- Toasts never take focus.

### 11.4 Landmarks and headings

- Landmarks: `header` (top bar), `nav` (primary, labelled), `main`, `aside` (summary card on detail pages), `dialog` for
  dialogs, `section` with a name for named regions, `footer` where a page has one.
- One `h1` per page, in `pageHeader`. Sections are `h2`, cards are `h3`. A heading level is never skipped.
- The skip link is the first focusable element and targets `#main`.

### 11.5 Live regions

- `#announcer` is `role="status"` with `aria-live="polite"` and is the only general live region (section 9.6).
- `#toasts` has no live attribute. Individual toasts are `role="status"` (polite) or `role="alert"` (danger).
- Count badges, progress values, combobox results (`c-field__status`) and the live mark are not announced by themselves.
  Only `#announcer` and the explicit messages above are announced.
- `aria-busy="true"` marks regions that are loading; it is removed when they settle.

### 11.6 Motion

- Reduced motion removes all motion and keeps the signals (section 10.5).
- No content animates on load (section 9.4). Animation happens only on a realtime event.
- No auto-playing or looping animation exists anywhere. Skeletons are static.

### 11.7 Language and text

- `<html lang>` is set from the user's locale preference, default `en`.
- Text does not truncate without a way to read the full text (`title` attribute, or the full text in an expandable row).
  Long names wrap.
- Text zoom to 200 percent does not clip content or require horizontal scrolling of the page (tables scroll in their own
  container).

### 11.8 Forms and errors

- Every control has a visible label that is a `label` element or `aria-labelledby`.
- Errors are text next to the control and linked by `aria-describedby`; `aria-invalid` is set on the control.
- The form summary receives focus on failed submit and links to each field.

### 11.9 Keyboard

- Every function works with the keyboard alone. Pointer-only interactions do not exist.
- Patterns follow the APG names in section 6 (Dialog, Alert Dialog, Menu Button, Tabs, Combobox, Toolbar, Switch).
- Keyboard shortcuts are only the palette (Ctrl+K and Meta+K) and menu item shortcuts shown as `kbd`. None is a single
  letter key.

---

## 12. Acceptance criteria for the DS builder

Each item is verifiable. The DS builder reports against these numbers. A failing item blocks the stack.

1. `packages/web/src/styles.css` has exactly one `@layer` declaration, equal to `@layer reset, tokens, base, layout, components, modules, utilities, overrides;`, as its first statement.
2. Every file in the file table (section 2.2) exists at its path; no file is created at a path not in the table, except the module files named in section 2.2 and `public/ds-gallery.html`.
3. Every component module in section 6 exports exactly the functions named in its entry, and no others. Every exported function has the signature in its entry; the only additions are the optional parameters named in section 6.3 (combobox `hint`, `error`, `required`, `disabled`) and the second optional argument of `formErrors` in section 6.2, plus the new export `avatarArt` in `artwork.js` (section 7.3).
4. `artwork.js` exports `artwork`, `badgeArt`, `avatarArt`. `format.js` exports `points`, `signedPoints`, `cents`, `number`, `percent`, `relativeTime`, `dateTime`, `date`, `initials`. `icons.js` exports `icon`.
5. `node scripts/check.mjs` passes. Existing checks keep their behaviour. The DS builder may add checks; it may not remove or weaken one.
6. The check verifies that every name in `ICON_NAMES` (from `packages/spec/src/suite/primitives.ts`) has a path in `icons.js`, and that every icon name used by any module is in `ICON_NAMES`.
7. Every custom property referenced with `var(--name)` in any CSS file is defined on `:root` in `tokens.css`, except component-private properties prefixed `--_` and module properties prefixed `--m-`.
8. Every token defined in `tokens.css` that is a colour uses `light-dark(light, dark)` or `color-mix()` of tokens that do. No colour value appears outside `tokens.css` and `artwork.css` (`.c-art` values, section 7.4) and `overrides.css` (forced colours and print).
9. The text-pair colours listed in section 3 are the values in `tokens.css`. The gallery (item 22) and the table in section 3 agree with the token values to the displayed precision.
10. `!important` appears only in `overrides.css`. `grep` over `src/ds/css` and `src/widgets/**/*.css src/shell/**/*.css` finds no `!important` elsewhere.
11. No module CSS file defines a token name (a name without the `--m-` or `--_` prefix) or writes to `:root`.
12. Nothing in `src/ds/**` or `src/widgets/**`, `src/shell/**` assigns `innerHTML` or `outerHTML` with a non-empty value, and no call to `insertAdjacentHTML` exists. `clear()` is the only way to empty a node.
13. `dataTable` renders a `caption` (a required parameter), `th` headers with `scope="col"`, and `aria-sort` on each sortable header; and returns a sticky header in the markup and CSS.
14. `statusPill` returns the label and tone in section 6.13 for every value of every vocabulary listed there, and throws on an unknown value.
15. `toast` renders `role="alert"` for `tone: "danger"` and `role="status"` otherwise; renders at most four visible toasts; pauses on hover and focus-within; and never calls `focus()`.
16. The approval vocabulary in `statusPill` maps every `ApprovalItem.status` value as section 6.13 says.
17. The currency source for `cents()` is open. The DS builder defaults to `USD` and records the open item as a backlog task; `cents()` does not read a currency from a module.
18. `ruleBuilder` produces only valid `CondTree` values: `not` nodes have exactly one child; `all` and `any` have 1 to 20 children; depth does not exceed `maxDepth`; a `between` condition has two values in order. `onChange` is never called with an invalid tree.
19. `ruleBuilder` offers only the operators in each `FactDef.ops`, and the value control for each `FactDef.type` follows the table in section 6.21.
20. `stepList` calls `onMove(from, to)` for Move up, Move down and Alt+Arrow; `max` disables "Add step" at the limit.
21. A `grep` for `u-arrive` finds it only in `utilities.css`. Each module that uses the arrival rule adds the class only from a realtime handler. No code adds the class during initial render.
22. `packages/web/public/ds-gallery.html` is a static page (not a Page, not routed by the page host) that renders every component in section 6 in every state listed in its entry, in light and dark, with `data-theme="light"` and `data-theme="dark"` side by side. It renders without JavaScript errors in the console.
23. The gallery renders each tier in section 4, each tone in section 3.5, each `statusPill` mapping row in section 6.13, each icon name in `ICON_NAMES`, each artwork pattern and badge shape, and the density values in section 3.9.
24. The app shell (section 5) at the phone row (width 375 px) has no horizontal page scroll, a 16 px side gutter, a drawer nav, and sheets for drawers. At the desktop row (width 1280 px) the side nav is docked and the main column does not exceed `--content-max`.
25. The skip link is the first focusable element, is hidden until focused, and moves focus to `#main`. Route change focuses `#main` and writes the page title to `#announcer`.
26. `aria-current="page"` appears on exactly one nav item per route.
27. Focus-visible outlines are present for every interactive element in the gallery (checked by the gallery's own list).
28. No file in `packages/web`, and no commit message or PR text, names the tooling used to write it.
29. The DS builder writes no file outside `packages/web/`.
30. Stacked verification: the DS stack is verified by the coordinator, which runs the suite once on the stacked change, not per change.

Open items (not blocking the DS builder, recorded as backlog tasks by the coordinator):

- Item 16: `approval.decided` carries an untyped `status` string. A typed approval status enum is needed in `events.ts`.
- Item 17: currency source for `cents()` (member settings, workspace setting, or a per-account field).
- The router's `replaceState` helper used by `tabs({ urlParam })` must be the same helper the router uses (UI-MAP.md section 3).
- Section 5.3 navigation grouping comes from the route manifest; the grouping is an open design decision for the nav owner.

---

## Appendix A. Token reference

All names in one list, for review. Values are in section 3.

Neutrals: `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--control-border`.
Signal and focus: `--accent`, `--accent-on`, `--accent-wash`, `--focus`, `--focus-width`, `--focus-offset`.
Surfaces: `--surface-0`, `--surface-1`, `--surface-2`, `--surface-3`, `--surface-4`, `--backdrop`.
Tones (each with `-fg`, `-bg`, `-border`): `--neutral-*`, `--info-*`, `--success-*`, `--warning-*`, `--danger-*`, `--signal-*`.
Tiers (each with `-fg`): `--tier-bronze`, `--tier-silver`, `--tier-gold`, `--tier-platinum`.
Charts: `--series-0` to `--series-4`, `--series-dash-0` to `--series-dash-4`, `--chart-grid`, `--chart-axis`, `--chart-breach`.
Type: `--font-sans`, `--font-mono`, `--step--2`, `--step--1`, `--step-0`, `--step-1`, `--step-2`, `--step-3`, `--track-caps`,
`--track-tight`, `--weight-regular`, `--weight-semi`, `--weight-bold`, `--leading-tight`, `--leading-body`.
Space and layout: `--space-1` to `--space-8`, `--gutter`, `--column-gap`, `--topbar-h`, `--nav-w`, `--content-max`, `--form-max`,
`--row-h`, `--control-h-sm`, `--control-h-md`, `--space-cell-y`.
Shape: `--radius-0`, `--radius`, `--radius-1`, `--radius-round`, `--hairline`, `--rule-heavy`.
Elevation: `--shadow-0` to `--shadow-4`, `--z-page`, `--z-raised`, `--z-chrome`, `--z-overlay`, `--z-modal`, `--z-palette`, `--z-toast`.
Motion: `--ease`, `--dur-1`, `--dur-2`, `--dur-3`, `--cause-hold`.

Removed from Meridian: `--ribbon-bg`, `--ribbon-ink`, `--ribbon-ink-2`, `--ribbon-rule`, `--ribbon-accent`, and the single
`--row` (replaced by `--row-h`, section 3.9).

---

## Appendix B. Changes from Meridian, in one place

1. Dark `--ink-3` corrected from `oklch(0.70 0.010 260)` to `oklch(0.78 0.009 260)` (2.9:1 became 4.8:1 on the dark paper).
2. Added `--control-border` for control edges (Meridian's `--rule` is decorative and 2.3:1 on paper).
3. Added tones, tiers, elevation tiers, z-index, focus, density, breakpoints and the `--radius-1` pill exception.
4. Removed the trace ribbon tokens. The board's trace strip is a board-specific pattern and is not part of the Suite.
5. Kept: paper, paper-2, ink, ink-2, rule (names and light values), `--accent` and its use rule, `--series-0` to `--series-4`
   (with dark values re-measured for the 3:1 rule), `--step-*`, `--track-caps`, `--space-*`, `--gutter`, `--column-gap`,
   `--row` renamed to `--row-h`, `--ease`, `--dur-1`, `--dur-2`, `--dur-3`, `--cause-hold`, `--shadow-float` (now `--shadow-4`),
   `--hairline`, `--rule-heavy`, `--radius` (as an alias of `--radius-0`).

## 13. Widgets and pages

The organising model is domains and widgets (CONTRACT.md 5A, UI-MAP.md 3 and 4). The design system supplies the page
grid and the widget frame; packages supply widget bodies.

### 13.1 widget-frame.js

`widgetFrame({ id, title, count?, size, menu: [{ label, icon?, onSelect, danger? }], chrome?: "card" | "rule" }) ->
{ element, body, setTitle(text), setCount(n), setState(state, info?) }`

- Markup: `<section class="c-widget c-widget--<size>" aria-labelledby="<uid>-title" data-widget="<id>">` with
  `<header class="c-widget__header">` (an `h2` title, an optional `countBadge`, a `menuButton` labelled "Widget
  options for <title>") and `<div class="c-widget__body">` (the `body` handed to the widget).
- `chrome: "card"` (default) sits on elevation tier 1 with a hairline border; `chrome: "rule"` (used for `full`
  widgets on module pages) drops the surface and hangs the widget from a 1 px ink rule like a Meridian panel.
- States rendered by the frame: `loading` (skeleton matching the widget size, first load only), `error`
  (`errorState` with Retry calling the runtime's remount), `unavailable` (an `emptyState` with the lock icon: "Not
  available to you" for `forbidden`, "Removed" for `missing`, "Unknown widget" for `unknown_widget`), `ready`.
  `empty` is drawn by the widget itself (its copy is domain-specific).
- The frame is a container (`container-type: inline-size`); widget CSS adapts with container queries, not viewport
  media queries.
- Arrival: when the runtime mounts a widget because a realtime change placed it, the frame plays `u-arrive` (the
  signal rule draws across the top, as Meridian's panel reveal) and announces "Widget added: <title>".

### 13.2 Page grid (page-host.js)

- A 12-column CSS grid with rows of `var(--row)`; each item sets `--x --y --w --h` from its `at` (Meridian's panel
  grid, generalised). Gap `--column-gap`.
- Size variant footprints (minimums; `at` may be larger): `s` 3x3, `m` 4x5, `l` 6x6, `xl` 8x8, `full` 12x10. The host
  passes `size` (the item's `size`, or the largest variant whose footprint fits `at`).
- Below 64rem the grid becomes 6 columns (items clamp to 6, `x` halves); below 48rem one column in `(y, x)` order,
  each widget at its `m` height or its smallest size; no horizontal scroll at 360 px with the 16 px gutter.
- Page header (`pageHeader`): page title, description as `meta`, actions "Customise", "Reset to default" and "Edit
  page" as the page allows.
- Unavailable items are omitted from rendered pages; the page editor shows them as dashed placeholders.

### 13.3 Page editor affordances (used by `pages.editor`, package D)

Edit mode overlays each item with a drag handle (pointer and keyboard: arrow keys move by one column or row,
Shift+arrows resize), a size menu limited to the widget's `sizes`, Configure (a drawer with a form generated from the
widget's config JSON Schema with the field components: enums become `selectField`, booleans `switchField`, arrays of
enums `checkboxField` groups, bindable values get a "Bind to route parameter" toggle) and Remove. A catalogue drawer
lists widgets by domain with title, description and sizes. The host prevents collisions (an item cannot be dropped
over another).

### 13.4 Acceptance additions

30a. `widgetFrame` renders every state in both themes in `public/ds-gallery.html`, and the gallery shows one page grid
     with an item of every size, at 1440, 900 and 360 px wide.
30b. With no widget modules present, every seeded page renders with "Widget not built yet" placeholders and no console
     error.
