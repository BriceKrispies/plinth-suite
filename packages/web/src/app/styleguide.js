// /styleguide: every design-system component in every state, each in a light and a dark panel side by side.
// A client-only route (no API needed), registered with the page host. Overlays (dialog, drawer, popover,
// toast) open on the page's own theme, because they live in the top layer.
import { h } from "../ds/js/dom.js";
import { icon, ICON_PATHS } from "../ds/js/icons.js";
import { artwork, badgeArt, avatarArt } from "../ds/js/artwork.js";
import { button, iconButton, linkButton } from "../ds/js/button.js";
import {
  textField,
  textArea,
  numberField,
  selectField,
  checkboxField,
  switchField,
  radioGroup,
  dateTimeField,
  searchField,
  fieldset,
  formErrors,
} from "../ds/js/field.js";
import { combobox } from "../ds/js/combobox.js";
import { openDialog, confirmDialog } from "../ds/js/dialog.js";
import { openDrawer } from "../ds/js/drawer.js";
import { openSheet } from "../ds/js/sheet.js";
import { popover } from "../ds/js/popover.js";
import { menuButton } from "../ds/js/menu.js";
import { toast } from "../ds/js/toast.js";
import { tabs } from "../ds/js/tabs.js";
import { dataTable, pager } from "../ds/js/table.js";
import { card } from "../ds/js/card.js";
import { pill, statusPill, STATUS_VOCABULARIES } from "../ds/js/pill.js";
import { countBadge, updateCount } from "../ds/js/count-badge.js";
import { avatar, avatarStack, personChip } from "../ds/js/avatar.js";
import { statTile } from "../ds/js/stat.js";
import { emptyState, skeleton, errorState, loading } from "../ds/js/states.js";
import { timeline } from "../ds/js/timeline.js";
import { progressBar, progressRing } from "../ds/js/progress.js";
import { sparkline, miniBars, donut } from "../ds/js/chart.js";
import { ruleBuilder, stepList } from "../ds/js/builder.js";
import { pageHeader, section, splitView, toolbar } from "../ds/js/layout.js";
import { kbd } from "../ds/js/kbd.js";
import { inlineText } from "../ds/js/richtext.js";
import { widgetFrame } from "../ds/js/widget-frame.js";
import {
  points,
  signedPoints,
  cents,
  number,
  percent,
  relativeTime,
  dateTime,
  date,
  initials,
} from "../ds/js/format.js";
import { addClientRoute } from "../core/page-host.js";

const TONES = ["neutral", "info", "success", "warning", "danger", "signal"];
const NOW = "2026-11-22T12:00:00Z";
const PEOPLE = [
  {
    subject: "user:maya",
    handle: "maya-ortiz",
    display_name: "Maya Ortiz",
    kind: "human",
    avatar: { initials: "MO", hue: 0 },
  },
  {
    subject: "user:jonas",
    handle: "jonas-becker",
    display_name: "Jonas Becker",
    kind: "human",
    avatar: { initials: "JB", hue: 47 },
  },
  {
    subject: "user:priya",
    handle: "priya-nair",
    display_name: "Priya Nair",
    kind: "human",
    avatar: { initials: "PN", hue: 94 },
  },
  {
    subject: "user:tomas",
    handle: "tomas-alvarez",
    display_name: "Tomás Alvarez",
    kind: "human",
    avatar: { initials: "TA", hue: 141 },
  },
  {
    subject: "user:leah",
    handle: "leah-okafor",
    display_name: "Leah Okafor",
    kind: "human",
    avatar: { initials: "LO", hue: 188 },
  },
  {
    subject: "agent:claude-code",
    handle: null,
    display_name: "Claude Code",
    kind: "agent",
    avatar: { initials: "AI", hue: 265 },
  },
];
const FACTS = [
  {
    path: "tier",
    label: "Tier",
    type: "enum",
    values: ["bronze", "silver", "gold", "platinum"],
    ops: ["eq", "ne", "in", "not_in"],
  },
  {
    path: "region",
    label: "Region",
    type: "enum",
    values: ["NA", "EMEA", "APAC", "LATAM", "ANZ"],
    ops: ["eq", "ne", "in", "not_in"],
  },
  {
    path: "balance",
    label: "Points balance",
    type: "int",
    ops: ["eq", "ne", "lt", "lte", "gt", "gte", "between"],
  },
  {
    path: "badges",
    label: "Holds badge",
    type: "string[]",
    values: ["early-bird", "team-player", "streak-7"],
    ops: ["contains", "not_contains"],
  },
  {
    path: "department",
    label: "Department",
    type: "string",
    ops: ["eq", "ne", "in", "not_in", "contains", "exists", "not_exists"],
  },
  { path: "joined_at", label: "Joined", type: "timestamp", ops: ["gt", "lt", "between"] },
  { path: "opted_in", label: "Opted in", type: "bool", ops: ["eq", "ne"] },
];

/** A light panel and a dark panel, each built by a fresh call of `make`. */
const pair = (make) =>
  h(
    "div",
    { class: "sg-pair" },
    ...["light", "dark"].map((theme) =>
      h(
        "div",
        { class: "sg-theme", "data-theme": theme },
        h("p", { class: "sg-theme__label" }, theme),
        make(theme),
      ),
    ),
  );

const block = (id, title, note, ...kids) =>
  h(
    "section",
    { class: "sg-section", id, "aria-labelledby": `${id}-h` },
    h("h2", { id: `${id}-h` }, title),
    note ? h("p", { class: "sg-note" }, note) : null,
    ...kids,
  );

const row = (...kids) => h("div", { class: "sg-row" }, ...kids);

const sampleRows = [
  { id: "r1", name: "Fleece quarter-zip", price: 4200, stock: "in_stock", updated: "2026-11-21T09:00:00Z" },
  { id: "r2", name: "Trail bottle", price: 1800, stock: "low", updated: "2026-11-20T16:30:00Z" },
  { id: "r3", name: "Summit pack", price: 9600, stock: "out", updated: "2026-11-18T08:10:00Z" },
];

const tokens = () => [
  block(
    "tokens",
    "Tokens",
    "Colour is OKLCH inside light-dark(); the dark panel is a counterpart, not an inversion.",
    pair(() =>
      h(
        "div",
        { class: "sg-grid" },
        ...[
          "--paper",
          "--paper-2",
          "--ink",
          "--ink-2",
          "--ink-3",
          "--rule",
          "--control-border",
          "--accent",
          "--accent-wash",
          "--focus",
        ].map((t) =>
          h(
            "div",
            { class: "sg-swatch" },
            h("span", { class: "sg-swatch__chip", style: `background:var(${t})` }),
            t,
          ),
        ),
      ),
    ),
    pair(() =>
      h(
        "div",
        { class: "sg-grid" },
        ...TONES.map((tone) =>
          h(
            "div",
            { class: "sg-swatch" },
            h(
              "span",
              {
                class: "sg-swatch__chip",
                style: `background:var(--${tone}-bg);border-color:var(--${tone}-border);color:var(--${tone}-fg);display:grid;place-items:center;font-weight:600`,
              },
              "Aa",
            ),
            `${tone}: fg bg border`,
          ),
        ),
        ...["bronze", "silver", "gold", "platinum"].map((t) =>
          h(
            "div",
            { class: "sg-swatch" },
            h("span", { class: "sg-swatch__chip", style: `background:var(--tier-${t})` }),
            `tier ${t}`,
          ),
        ),
      ),
    ),
    pair(() =>
      h(
        "div",
        { class: "sg-type" },
        ...[
          ["--step-2", "Step 2: page titles and stat values"],
          ["--step-1", "Step 1: section titles"],
          ["--step-0", "Step 0: body text 1 240 pts"],
          ["--step--1", "Step -1: table cells, pills, helper text"],
        ].map(([v, text]) =>
          h(
            "span",
            { style: `font-size:var(${v});font-weight:${v === "--step-0" || v === "--step--1" ? 400 : 700}` },
            text,
          ),
        ),
        h("span", { class: "u-caps" }, "Step -2: caps label"),
        h("span", { class: "u-tabular" }, "Tabular: 0123456789"),
      ),
    ),
    pair(() =>
      h(
        "div",
        { class: "sg-type" },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
          h(
            "div",
            { class: "sg-space" },
            h("span", { class: "sg-space__bar", style: `inline-size:var(--space-${i})` }),
            `--space-${i}`,
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "sg-pair" },
      h(
        "div",
        { class: "sg-theme" },
        h("p", { class: "sg-theme__label" }, "Elevation tiers"),
        h(
          "div",
          { class: "sg-grid" },
          ...["0 page", "1 raised", "2 chrome", "3 overlay", "4 modal"].map((t, i) =>
            h("div", { class: `sg-tier sg-tier--${i}` }, `Tier ${t}`),
          ),
        ),
      ),
      h(
        "div",
        { class: "sg-theme", "data-theme": "dark" },
        h("p", { class: "sg-theme__label" }, "Elevation tiers, dark"),
        h(
          "div",
          { class: "sg-grid" },
          ...["0 page", "1 raised", "2 chrome", "3 overlay", "4 modal"].map((t, i) =>
            h("div", { class: `sg-tier sg-tier--${i}` }, `Tier ${t}`),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "sg-pair" },
      ...["default", "compact"].map((d) =>
        h(
          "div",
          {
            class: "sg-theme",
            "data-density": d,
            style: d === "compact" ? "--row-h:2.25rem;--control-h-md:2rem;--control-h-sm:1.5rem" : "",
          },
          h("p", { class: "sg-theme__label" }, `Density: ${d}`),
          h(
            "div",
            { class: "sg-dens" },
            row(button({ label: "Primary", variant: "primary" }), button({ label: "Small", size: "sm" })),
            textField({ name: "d", label: "Field", value: "Value" }),
          ),
        ),
      ),
    ),
  ),
];

const buttons = () =>
  block(
    "buttons",
    "Buttons",
    "Primary is ink; danger never fills red; signal is for the one committing action on a screen.",
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        ...["primary", "secondary", "ghost", "danger", "signal"].map((v) =>
          row(
            button({ label: v, variant: v }),
            button({ label: `${v} small`, variant: v, size: "sm" }),
            button({ label: "Disabled", variant: v, disabled: true }),
            button({ label: "Saving", variant: v, busy: true }),
            button({ label: "With icon", variant: v, icon: "plus" }),
          ),
        ),
        row(
          button({ label: "Pressed", pressed: true }),
          button({ label: "Toggle", pressed: false }),
          iconButton({ icon: "bell", label: "Notifications" }),
          iconButton({ icon: "more", label: "More", variant: "secondary" }),
          linkButton({ href: "#buttons", label: "Link button", icon: "external" }),
        ),
      ),
    ),
  );

const fields = () => {
  const formDemo = (theme) => {
    const form = h("form", { class: "sg-form", novalidate: true, onsubmit: (e) => e.preventDefault() });
    const t = textField({ name: "/title", label: "Title", required: true, hint: "Shown to members" });
    form.append(
      h("p", { class: "c-field__hint" }, "Fields marked * are required"),
      t,
      numberField({ name: "/amount", label: "Amount", hint: "In points" }),
      button({
        label: "Submit with an error",
        variant: "primary",
        type: "button",
        onClick: () => {
          const summary = formErrors(
            { code: "VALIDATION_FAILED", path: "/title", message: "Enter a title" },
            { form },
          );
          summary?.focus();
        },
      }),
      button({ label: "Clear errors", type: "button", onClick: () => formErrors(null, { form }) }),
    );
    void theme;
    return form;
  };
  return block(
    "fields",
    "Form fields",
    "Names are JSON pointers, so an API error path lands on the right field.",
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        textField({
          name: "/a",
          label: "Text field",
          placeholder: "Placeholder",
          hint: "A hint below the label",
        }),
        textField({ name: "/b", label: "Required", required: true, value: "Value" }),
        textField({ name: "/c", label: "With error", value: "bad", error: "Enter a valid value" }),
        textField({ name: "/d", label: "Disabled", value: "Cannot edit", disabled: true }),
        textArea({ name: "/e", label: "Text area", rows: 3, value: "Several lines of text" }),
        numberField({ name: "/f", label: "Number", value: 1240, min: 0, step: 10 }),
        selectField({
          name: "/g",
          label: "Select",
          value: "gold",
          options: [
            { value: "bronze", label: "Bronze" },
            { value: "gold", label: "Gold" },
          ],
        }),
        dateTimeField({ name: "/h", label: "Date and time", value: "2026-11-22T14:30" }),
        searchField({ name: "/i", label: "Search", value: "fleece", placeholder: "Search products" }),
        checkboxField({ name: "/j", label: "Single checkbox", value: true }),
        checkboxField({
          name: "/k",
          label: "Regions",
          options: [
            { value: "NA", label: "North America" },
            { value: "EMEA", label: "EMEA" },
          ],
          value: ["EMEA"],
        }),
        radioGroup({
          name: "/l",
          label: "Audience",
          options: [
            { value: "all", label: "Everyone" },
            { value: "seg", label: "A segment" },
          ],
          value: "all",
        }),
        switchField({ name: "/m", label: "Notify members", value: true }),
        switchField({ name: "/n", label: "Disabled switch", value: false, disabled: true }),
        fieldset({ legend: "Fieldset", children: [textField({ name: "/o", label: "Inside a fieldset" })] }),
      ),
    ),
    pair(formDemo),
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        combobox({
          label: "Combobox: single",
          name: "/who",
          search: async (q) =>
            PEOPLE.filter((p) => p.display_name.toLowerCase().includes(q.toLowerCase())).map((p) => ({
              value: p.handle ?? p.subject,
              label: p.display_name,
              description: p.handle ? `@${p.handle}` : "Agent",
              avatar: p.avatar,
            })),
          placeholder: "Find a person",
          hint: "Type to search",
        }),
        combobox({
          label: "Combobox: multiple",
          name: "/many",
          multiple: true,
          search: async (q) =>
            ["EMEA", "APAC", "NA", "LATAM", "ANZ"]
              .filter((r) => r.toLowerCase().includes(q.toLowerCase()))
              .map((r) => ({ value: r, label: r, group: "Regions" })),
          value: [{ value: "EMEA", label: "EMEA" }],
        }),
        combobox({ label: "Combobox: error", name: "/err", search: async () => [], error: "Choose someone" }),
      ),
    ),
  );
};

const displays = () => [
  block(
    "pills",
    "Pills, status pills and counts",
    null,
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        row(...TONES.map((tone) => pill({ label: tone, tone, icon: tone === "neutral" ? null : "info" }))),
        row(
          countBadge(3, { label: "unread" }),
          countBadge(120, { label: "unread" }),
          countBadge(1, { label: "in cart" }),
          (() => {
            const c = countBadge(0, { label: "unread" });
            c.hidden = false;
            c.textContent = "0 (hidden at zero)";
            return c;
          })(),
        ),
        row(...["bronze", "silver", "gold", "platinum"].map((t) => statusPill("tier", t))),
      ),
    ),
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        ...Object.entries(STATUS_VOCABULARIES).map(([vocab, rows]) =>
          h(
            "div",
            { class: "sg-form" },
            h("p", { class: "u-caps" }, vocab),
            row(...Object.keys(rows).map((k) => statusPill(vocab, k))),
          ),
        ),
      ),
    ),
  ),
  block(
    "avatars",
    "Avatars and people",
    null,
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        row(
          ...["xs", "sm", "md", "lg", "xl"].map((size, i) =>
            avatar({ name: PEOPLE[i].display_name, avatar: PEOPLE[i].avatar, size }),
          ),
        ),
        row(
          avatar({ name: "Maya Ortiz", avatar: PEOPLE[0].avatar, size: "lg", presence: "online" }),
          avatar({ name: "Jonas Becker", avatar: PEOPLE[1].avatar, size: "lg", presence: "away" }),
          avatar({ name: "Priya Nair", avatar: PEOPLE[2].avatar, size: "lg", href: "#avatars" }),
        ),
        avatarStack(PEOPLE, { max: 4 }),
        row(personChip(PEOPLE[0], { href: "#avatars" }), personChip(PEOPLE[5])),
      ),
    ),
  ),
  block(
    "cards",
    "Cards, stat tiles, charts and progress",
    null,
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        card({
          eyebrow: "Eyebrow",
          title: "Card title",
          actions: [iconButton({ icon: "more", label: "More" })],
          body: h(
            "p",
            {},
            "Cards sit on tier 1: a hairline, a whisper of shadow, a lift on hover when linked.",
          ),
          footer: "Footer text",
        }),
        card({
          title: "Linked card with tone",
          href: "#cards",
          tone: "success",
          body: "The whole card is the link.",
        }),
        row(
          statTile({
            label: "Points balance",
            value: 1240,
            unit: "pts",
            delta: "+12 %",
            good: "up",
            spark: [3, 5, 4, 8, 7, 11, 9, 14],
          }),
          statTile({ label: "Refunds", value: "18", delta: "+4", good: "down", hint: "This week" }),
          statTile({ label: "Orders", value: "92", delta: "−3 %", good: "up", href: "#cards" }),
        ),
        row(
          sparkline([3, 5, 4, 8, 7, 11, 9, 14], { label: "Points earned" }),
          miniBars([4, 8, 3, 9, 6], { labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], label: "Orders per day" }),
        ),
        donut(
          [
            { label: "Apparel", value: 42 },
            { label: "Drinkware", value: 28 },
            { label: "Bags", value: 18 },
            { label: "Other", value: 12 },
          ],
          { label: "Orders by category" },
        ),
        progressBar({ value: 62, max: 100, label: "Tier progress" }),
        progressBar({ value: 80, max: 100, label: "Budget used", tone: "warning" }),
        row(
          progressRing({ value: 3, max: 5, label: "Badge progress" }),
          progressRing({ value: 9, max: 10, label: "Almost", size: 56 }),
        ),
      ),
    ),
  ),
  block(
    "timeline",
    "Timeline, rich text and keys",
    null,
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        timeline({
          label: "Order history",
          now: NOW,
          items: [
            {
              at: "2026-11-22T11:50:00Z",
              icon: "box",
              tone: "info",
              title: "Order shipped",
              body: "Left the warehouse",
              actor: PEOPLE[1],
            },
            {
              at: "2026-11-21T08:00:00Z",
              icon: "check-circle",
              tone: "success",
              title: "Approved",
              actor: PEOPLE[0],
            },
            {
              at: "2026-11-15T08:00:00Z",
              icon: "alert",
              tone: "danger",
              title: "Payment flagged",
              href: "#timeline",
            },
          ],
        }),
        inlineText(
          "Thanks **everyone**, special mention for @maya-ortiz and _the fulfilment crew_. <b>not html</b>",
          { mentions: (hdl) => `/people/${hdl}` },
        ),
        row(kbd("Ctrl+K"), kbd("Shift+Alt+ArrowUp")),
      ),
    ),
  ),
];

const overlays = () => {
  const anchor = () => {
    const b = button({ label: "Open popover", icon: "info" });
    b.addEventListener("click", () =>
      popover(
        b,
        h(
          "div",
          {},
          h("p", { class: "u-caps" }, "Popover"),
          h("p", {}, "Tier 3: a defined edge, a lift, dismiss on outside press."),
          button({ label: "Action", size: "sm" }),
        ),
        { placement: "bottom-start", label: "Example popover" },
      ),
    );
    return b;
  };
  return block(
    "overlays",
    "Menus, tabs, dialogs, drawers, sheets, toasts",
    "Overlays open in the top layer, so they take the page's current theme.",
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        row(
          menuButton({
            label: "Menu button",
            icon: "more",
            items: [
              {
                label: "Edit",
                icon: "edit",
                shortcut: "Ctrl+E",
                onSelect: () => toast({ title: "Edit chosen" }),
              },
              { label: "Duplicate", icon: "copy", onSelect: () => {} },
              { label: "Disabled", disabled: true, onSelect: () => {} },
              { label: "Delete", icon: "trash", danger: true, separatorBefore: true, onSelect: () => {} },
            ],
          }),
          anchor(),
        ),
        tabs({
          label: "Example tabs",
          items: [
            { id: "a", label: "Overview", panel: () => h("p", {}, "Overview panel, rendered lazily") },
            { id: "b", label: "Activity", count: 4, panel: () => h("p", {}, "Activity panel") },
            { id: "c", label: "Settings", panel: () => h("p", {}, "Settings panel") },
          ],
        }),
      ),
    ),
    h(
      "div",
      { class: "sg-row" },
      button({
        label: "Open dialog",
        onClick: () =>
          openDialog({
            title: "Dialog title",
            body: h("p", {}, "Tier 4: opaque surface, a heavy shadow, a scrim. Escape closes."),
            actions: [
              { label: "Cancel", value: null },
              { label: "Save", value: "ok", variant: "primary", autofocus: true },
            ],
          }),
      }),
      button({
        label: "Confirm dialog",
        onClick: () =>
          confirmDialog({
            title: "Delete this promotion?",
            message: "This cannot be undone.",
            confirmLabel: "Delete",
            tone: "danger",
          }),
      }),
      button({
        label: "Open drawer",
        onClick: () =>
          openDrawer({
            title: "Drawer",
            body: h("p", {}, "A side drawer; below 40rem it is a bottom sheet."),
            footer: [button({ label: "Done", variant: "primary" })],
          }),
      }),
      button({
        label: "Open sheet",
        onClick: () => openSheet({ title: "Sheet", body: h("p", {}, "Bottom sheet on every width.") }),
      }),
      ...TONES.map((tone) =>
        button({
          label: `Toast: ${tone}`,
          size: "sm",
          onClick: () =>
            toast({
              title: `${tone} toast`,
              body: "Pauses on hover and focus.",
              tone,
              action: { label: "Undo", onClick: () => {} },
            }),
        }),
      ),
      button({
        label: "Queue six toasts",
        size: "sm",
        onClick: () =>
          Array.from({ length: 6 }, (_, i) => toast({ title: `Toast ${i + 1} of 6`, tone: "info" })),
      }),
    ),
  );
};

const tables = () =>
  block(
    "tables",
    "Data table and pager",
    "Resize below 40rem to see rows become cards.",
    pair(() => {
      let sort = { key: "name", dir: "ascending" };
      const host = h("div", { class: "sg-form" });
      const draw = () => {
        const rows = [...sampleRows].sort(
          (a, b) =>
            (sort?.dir === "descending" ? -1 : 1) *
            String(a[sort?.key ?? "name"]).localeCompare(String(b[sort?.key ?? "name"])),
        );
        host.replaceChildren(
          dataTable({
            caption: "Products",
            rowKey: "id",
            rows,
            sort,
            selectable: true,
            onSort: (next) => ((sort = next?.dir ? next : null), draw()),
            rowHref: (r) => `#${r.id}`,
            columns: [
              { key: "name", label: "Name", sortable: true },
              { key: "price", label: "Price", align: "end", sortable: true, render: (r) => cents(r.price) },
              { key: "stock", label: "Stock", render: (r) => statusPill("stock", r.stock) },
              { key: "updated", label: "Updated", render: (r) => relativeTime(r.updated, NOW) },
            ],
          }),
          pager({ nextCursor: "x", onNext: () => {}, onPrev: () => {}, label: "Products pages" }),
        );
      };
      draw();
      return h(
        "div",
        { class: "sg-form" },
        host,
        dataTable({
          caption: "Loading",
          rowKey: "id",
          rows: [],
          loading: true,
          columns: [
            { key: "a", label: "A" },
            { key: "b", label: "B" },
            { key: "c", label: "C" },
          ],
        }),
        dataTable({
          caption: "Empty",
          rowKey: "id",
          rows: [],
          columns: [{ key: "a", label: "A" }],
          empty: emptyState({
            icon: "box",
            title: "No orders yet",
            body: "Orders appear here once members check out.",
          }),
        }),
      );
    }),
  );

const states = () =>
  block(
    "states",
    "Empty, loading and error states",
    null,
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        emptyState({
          icon: "inbox",
          title: "No messages",
          body: "New messages from your colleagues land here.",
          action: button({ label: "New message", variant: "primary", icon: "plus" }),
        }),
        errorState({
          error: { code: "FORBIDDEN", message: "You need the points:ledger permission." },
          retry: () => {},
        }),
        errorState({ error: { code: "ERROR", message: "Something unexpected" } }),
        loading("orders"),
        skeleton({ shape: "text", lines: 3 }),
        row(skeleton({ shape: "tile" }), skeleton({ shape: "card", lines: 2 })),
        skeleton({ shape: "table", lines: 4 }),
      ),
    ),
  );

const builders = () => {
  const out = h(
    "pre",
    { class: "sg-note u-mono", style: "white-space:pre-wrap" },
    "onChange output appears here",
  );
  return block(
    "builders",
    "Rule builder and step list",
    "The rule builder only ever emits a valid condition tree.",
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        ruleBuilder({
          label: "Segment rule",
          facts: FACTS,
          value: {
            all: [
              { field: "tier", op: "in", value: ["gold", "platinum"] },
              {
                any: [
                  { field: "region", op: "eq", value: "EMEA" },
                  { field: "balance", op: "gte", value: 5000 },
                ],
              },
            ],
          },
          onChange: (t) => (out.textContent = JSON.stringify(t, null, 1)),
        }),
        (() => {
          let steps = ["Send message", "Award points", "Create task"];
          const host = h("div", {});
          const draw = () =>
            host.replaceChildren(
              stepList({
                label: "Automation steps",
                items: steps,
                max: 5,
                addLabel: "Add step",
                renderItem: (item) =>
                  textField({ name: `/steps/${steps.indexOf(item)}`, label: "Action", value: item }),
                onAdd: () => ((steps = [...steps, "New step"]), draw()),
                onRemove: (i) => ((steps = steps.filter((_, k) => k !== i)), draw()),
                onMove: (from, to) => {
                  const next = [...steps];
                  next.splice(to, 0, next.splice(from, 1)[0]);
                  steps = next;
                  draw();
                },
              }),
            );
          draw();
          return host;
        })(),
      ),
    ),
    h("div", { class: "sg-theme" }, h("p", { class: "sg-theme__label" }, "Last emitted tree"), out),
  );
};

const art = () =>
  block(
    "artwork",
    "Generated artwork and icons",
    "No image files: artwork is a pure function of its data.",
    pair(() =>
      h(
        "div",
        { class: "sg-form" },
        row(
          ...["solid", "stripes", "dots", "rings", "grid", "waves"].map((p, i) =>
            artwork(
              {
                icon: ["store", "gift", "coffee", "shirt", "laptop", "headphones"][i],
                hue: i * 57,
                pattern: p,
                glyph: i === 1 ? "GF" : undefined,
              },
              { size: 72, label: `${p} pattern` },
            ),
          ),
        ),
        row(
          ...["disc", "hexagon", "shield", "star", "diamond"].map((shape, i) =>
            badgeArt(
              {
                shape,
                icon: ["trophy", "medal", "shield", "star", "crown"][i],
                hue: i * 70,
                ring: [null, "bronze", "silver", "gold", "platinum"][i],
              },
              { size: 72, label: `${shape} badge` },
            ),
          ),
        ),
        row(...[0, 60, 120, 180, 240, 300].map((hue) => avatarArt({ initials: "AB", hue }, { size: 40 }))),
      ),
    ),
    pair(() =>
      h(
        "div",
        { class: "sg-grid" },
        ...Object.keys(ICON_PATHS).map((name) =>
          h("div", { class: "sg-icon" }, icon(name, { size: 24 }), name),
        ),
      ),
    ),
  );

const layouts = () => {
  const frames = (theme) => {
    void theme;
    const mk = (state, size, info) => {
      const f = widgetFrame({
        id: "demo.widget",
        title: `State: ${state}`,
        size,
        count: state === "ready" ? 3 : undefined,
        menu: [
          { label: "Refresh", icon: "history", onSelect: () => {} },
          { label: "Remove", icon: "trash", danger: true, onSelect: () => {} },
        ],
      });
      f.setState(state === "ready" ? "ready" : state, info);
      if (state === "ready") f.body.append(h("p", {}, "Widget content renders here, inside the frame body."));
      return h("div", { style: "min-block-size:10rem;display:grid" }, f.element);
    };
    return h(
      "div",
      { class: "sg-form" },
      mk("ready", "m"),
      mk("loading", "m"),
      mk("error", "m", { error: { code: "ERROR", message: "Could not load" }, retry: () => {} }),
      mk("unavailable", "m", { reason: "forbidden" }),
      mk("unavailable", "m", { reason: "missing" }),
      mk("unavailable", "m", { reason: "unknown_widget" }),
    );
  };
  const gridDemo = h(
    "div",
    { class: "c-page-grid sg-grid-demo" },
    ...[
      ["s", 0, 0, 3, 3],
      ["m", 3, 0, 4, 5],
      ["l", 7, 0, 5, 6],
      ["xl", 0, 5, 8, 6],
      ["full", 0, 11, 12, 3],
    ].map(([size, x, y, w, hh]) =>
      h(
        "div",
        {
          class: "c-page-grid__item",
          style: `--x:${x + 1};--y:${y + 1};--w:${w};--h:${hh};--x6:${Math.floor(x / 2) + 1};--w6:${Math.min(Math.ceil(w / 2), 6 - Math.floor(x / 2))}`,
        },
        (() => {
          const f = widgetFrame({
            id: `demo.${size}`,
            title: `Size ${size}`,
            size,
            chrome: size === "full" ? "rule" : "card",
          });
          f.setState("ready");
          f.body.append(h("p", { class: "u-muted" }, `${w} by ${hh} cells`));
          return f.element;
        })(),
      ),
    ),
  );
  return [
    block(
      "layout",
      "Page header, section, split view, toolbar",
      null,
      h(
        "div",
        { class: "sg-theme" },
        pageHeader({
          eyebrow: "Rewards",
          title: "Page header",
          meta: ["Operations", "Updated just now"],
          actions: [
            button({ label: "Customise", icon: "sliders" }),
            button({ label: "Edit page", variant: "primary" }),
          ],
          back: { href: "#layout", label: "Back" },
        }),
      ),
      h(
        "div",
        { class: "sg-theme" },
        section({
          title: "Section",
          actions: [button({ label: "Action", size: "sm" })],
          body: h("p", {}, "Sections hang from a hairline rule."),
        }),
        toolbar({
          label: "Demo toolbar",
          children: [
            button({ label: "Filter", icon: "filter", size: "sm" }),
            button({ label: "Sort", icon: "sort", size: "sm" }),
            searchField({ name: "q", label: "Search", placeholder: "Search" }),
          ],
        }),
      ),
      h(
        "div",
        { class: "sg-theme" },
        splitView({
          label: "Demo list and detail",
          list: h(
            "ul",
            {},
            ...["Thread one", "Thread two", "Thread three"].map((t) =>
              h("li", {}, h("a", { href: "#layout" }, t)),
            ),
          ),
          detail: h("p", {}, "The detail pane; one column at a time on narrow screens."),
        }),
      ),
    ),
    block(
      "widgets",
      "Widget frame and page grid",
      "The frame in each state, then a page grid with an item of every size. Resize the window to see the 6-column and one-column collapse.",
      pair(frames),
      h("div", { class: "sg-theme" }, h("p", { class: "sg-theme__label" }, "Page grid"), gridDemo),
    ),
  ];
};

const motion = () =>
  block(
    "motion",
    "Arrival and formats",
    "Only a realtime event marks an arrival; the button below stands in for one.",
    pair(() => {
      const item = h(
        "div",
        { class: "c-card", style: "padding:var(--space-4)" },
        "An item already on screen",
      );
      const countEl = countBadge(3, { label: "unread" });
      return h(
        "div",
        { class: "sg-form" },
        item,
        button({
          label: "Simulate an arrival",
          onClick: () => {
            item.classList.add("u-arrive");
            item.append(pill({ label: "New", tone: "signal" }));
            updateCount(countEl, 4);
            setTimeout(() => item.classList.remove("u-arrive"), 6000);
          },
        }),
        row(
          countEl,
          h(
            "span",
            { class: "u-tabular" },
            `${points(1240)} · ${signedPoints(1200)} · ${signedPoints(-300)} · ${number(12450)} · ${percent(0.427)} · ${percent(0.074)} · ${cents(1234)}`,
          ),
        ),
        h(
          "p",
          { class: "u-muted u-tabular" },
          `${relativeTime("2026-11-22T11:57:00Z", NOW)} · ${relativeTime("2026-11-24T12:00:00Z", NOW)} · ${dateTime("2026-11-20T14:30:00Z")} · ${date("2026-11-20T14:30:00Z")} · ${initials("Tomás Alvarez")}`,
        ),
      );
    }),
  );

const LOOKS = [
  ["calm", "Calm", "The default: quiet, one accent, semantic colour only where it means something."],
  ["meridian", "Meridian", "The original look: boxed, uppercase, a heavy ink rule."],
  ["nocturne", "Nocturne", "Blue-grey surfaces climbing in luminance steps, a teal signal."],
  ["folio", "Folio", "Editorial: warm paper, serif headings, thin ink rules."],
  ["lattice", "Lattice", "Dense corporate grid, one blue hue, small tinted badges."],
  ["strata", "Strata", "Layered surfaces lifted by tinted shadow, generous radii."],
];
const currentLook = () => document.documentElement.dataset.look || "calm";

/** One sample of the busy-prone parts (header, pills, counts, people, widget) under a look. */
const lookSample = (look, scheme) => {
  const f = widgetFrame({
    id: "demo.look",
    title: "My tasks",
    count: 3,
    menu: [{ label: "Refresh", icon: "history", onSelect: () => {} }],
  });
  f.setState("ready");
  f.body.append(
    h(
      "ul",
      { class: "sg-look__rows" },
      h("li", {}, "Approve the spring promotion", pill({ label: "Urgent", tone: "danger", icon: "alert" })),
      h("li", {}, statusPill("task", "in_progress"), personChip(PEOPLE[0])),
      h(
        "li",
        {},
        statusPill("approval", "pending_approval"),
        pill({ label: "Order" }),
        personChip(PEOPLE[1]),
      ),
      h("li", {}, statusPill("task", "open"), pill({ label: "Normal" }), statusPill("task", "done")),
    ),
  );
  const attention = countBadge(2, { label: "awaiting decision" });
  attention.classList.add("c-count--warning");
  return h(
    "div",
    { class: "sg-look", "data-look": look, "data-scheme": scheme },
    h(
      "header",
      { class: "c-page-header" },
      h("h3", { class: "c-page-header__title" }, "Home"),
      h(
        "div",
        { class: "c-page-header__meta" },
        h("span", { class: "c-page-header__meta-item" }, "What needs you today, across the suite."),
      ),
    ),
    row(countBadge(7, { label: "unread" }), attention, pill({ label: "New", tone: "signal" })),
    f.element,
  );
};

const looksBlock = () => {
  const group = h("div", { class: "sg-looks", role: "group", "aria-label": "Site look" });
  const draw = () => {
    const now = currentLook();
    group.replaceChildren(
      ...LOOKS.map(([id, label, note]) => {
        const b = button({
          label,
          variant: now === id ? "primary" : "secondary",
          size: "sm",
          pressed: now === id,
          onClick: () => {
            document.documentElement.dataset.look = id;
            draw();
          },
        });
        b.title = note;
        return b;
      }),
    );
  };
  draw();
  return block(
    "looks",
    "Looks",
    "html[data-look] switches the whole site; calm is the default. Pick one to preview the page you are on, or compare all of them below, each in light and dark.",
    group,
    h(
      "div",
      { class: "sg-looks-grid" },
      ...LOOKS.flatMap(([id, label, note]) => [
        h(
          "div",
          { class: "sg-looks-cell" },
          h("h3", {}, label),
          h("p", { class: "sg-note" }, note),
          lookSample(id, "light"),
        ),
        h(
          "div",
          { class: "sg-looks-cell" },
          h("h3", {}, `${label}, dark`),
          h("p", { class: "sg-note" }, note),
          lookSample(id, "dark"),
        ),
      ]),
    ),
  );
};

const SECTIONS = [
  ["looks", "Looks"],
  ["tokens", "Tokens"],
  ["buttons", "Buttons"],
  ["fields", "Fields"],
  ["pills", "Pills"],
  ["avatars", "Avatars"],
  ["cards", "Cards and charts"],
  ["timeline", "Timeline"],
  ["overlays", "Overlays"],
  ["tables", "Tables"],
  ["states", "States"],
  ["builders", "Builders"],
  ["artwork", "Artwork and icons"],
  ["layout", "Layout"],
  ["widgets", "Widget frame and grid"],
  ["motion", "Arrival and formats"],
];

export const registerStyleguide = () => {
  addClientRoute("/styleguide", (main) => {
    main.append(
      h(
        "div",
        { class: "c-page-host sg" },
        pageHeader({
          eyebrow: "Design system",
          title: "Styleguide",
          meta: ["Every component, every state, light and dark"],
        }),
        h(
          "nav",
          { class: "sg-toc", "aria-label": "Styleguide sections" },
          ...SECTIONS.map(([id, label]) => h("a", { href: `#${id}` }, label)),
        ),
        looksBlock(),
        ...tokens(),
        buttons(),
        fields(),
        ...displays(),
        overlays(),
        tables(),
        states(),
        builders(),
        art(),
        ...layouts(),
        motion(),
      ),
    );
    return { title: "Styleguide" };
  });
};
