// The Statement room (points.ledger; spec 02 sections 2.3 and 2.6). One component, two presentations chosen by the
// pane's own width (its ResizeObserver, spec 00 section 0.3.2):
//   - pane-compact (< 30 rem), the design: two-line list items that expand to show every other field, windowed
//     over the document's own scroller; Select mode adds a checkbox per item and the dock reads "Copy N";
//   - wider panes: the table, with sticky headers, its own scroller and native drag selection copying TSV.
// Search covers every line (whole-dataset search) from a sheet whose field sits at the bottom, above the dock.
// The flow-ribbon diorama accompanies the list as a band that opens collapsed and at most 35 % of the viewport tall;
// it is baked to an image (it scrolls with the page) and orbited by buttons, by drag only with a fine pointer.
// The room's dock holds Back, Search, View (List | Flow), Select and, in Select mode, Copy N and Done.

import { h, t, setText, clear } from "../plat/dom";
import { counterpartyText, type StatementLine } from "./api";
import { fmt, signed, typeLabel, utc } from "../format";
import { paintImage } from "../town/paint-image";

const ITEM_H = 64;
const ROW_H = 32;
const OVERSCAN = 30;
/** Pane-compact below 30 rem: list; otherwise the table (spec 00 section 0.3.2). */
const TABLE_FROM_REM = 30;

export interface StatementCallbacks {
  readonly onDirty: () => void;
  readonly announce: (msg: string) => void;
  readonly back: () => void;
  /** Bake the flow ribbon (from the GPU chunk once it has loaded; null before that and in Plain mode). */
  readonly bakeRibbon: () =>
    | ((
        lines: StatementLine[],
        azimuth: number,
        w: number,
        h: number,
        dpr: number,
      ) => Promise<ImageData | null>)
    | null;
  readonly siblingHref: string;
  readonly onSibling: (e: MouseEvent) => void;
}

const COLUMNS = [
  { key: "no", label: "NO.", cls: "num mono", width: "11%" },
  { key: "date", label: "DATE (UTC)", cls: "mono", width: "19%" },
  { key: "type", label: "TYPE", cls: "", width: "13%" },
  { key: "memo", label: "DETAILS", cls: "", width: "31%" },
  { key: "delta", label: "Δ POINTS", cls: "num mono", width: "12%" },
  { key: "balance", label: "BALANCE", cls: "num mono", width: "14%" },
] as const;

/** The six fields of a line as the table shows them; the list and copy use the same strings. */
export const cellTexts = (l: StatementLine): string[] => {
  const cp = counterpartyText(l.counterparty);
  const memo = l.memo?.trim() ? l.memo.trim() : "No memo";
  return [
    fmt(l.txn_no),
    utc(l.occurred_at),
    typeLabel(l.txn_type),
    cp ? `${memo} · ${cp}` : memo,
    signed(l.amount),
    fmt(l.balance_after),
  ].map((s) => s.replace(/\s+/g, " ").trim());
};

const sentence = (l: StatementLine): string => {
  const c = cellTexts(l);
  return `${c[3]}, ${l.amount >= 0 ? "plus" : "minus"} ${fmt(Math.abs(l.amount))} points, ${c[1]} UTC, ${c[2]}, balance ${c[5]}`;
};

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export class StatementRoom {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly dock: HTMLElement;
  readonly list: HTMLUListElement;
  readonly scroller: HTMLDivElement;
  readonly table: HTMLTableElement;
  readonly ribbonFigure: HTMLElement;
  readonly ribbonCanvas: HTMLCanvasElement;
  readonly searchSheet: HTMLElement;
  readonly searchInput: HTMLInputElement;
  private readonly tbody: HTMLTableSectionElement;
  private readonly status: HTMLElement;
  private readonly searchCount: HTMLElement;
  private readonly selectBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly viewList: HTMLButtonElement;
  private readonly viewFlow: HTMLButtonElement;
  /** Azimuth of the ribbon's camera in degrees (0 = the default three-quarter view). */
  private azimuth = 0;
  private ribbonKey = "";
  presentation: "list" | "table" = "list";
  filtered: StatementLine[];
  query = "";
  flowOpen = false;
  selecting = false;
  readonly selected = new Set<number>(); // indexes into `filtered`
  expanded = -1;
  private expandedExtra = 0;
  windowStart = 0;
  windowEnd = 0;
  active = false;

  constructor(
    readonly lines: StatementLine[],
    private readonly cb: StatementCallbacks,
  ) {
    this.filtered = lines;
    const total = lines.length;
    this.heading = t("h2", "Statement", {
      id: "statement-title",
      class: "room-title",
      tabindex: -1,
      "data-paint": "text",
    });
    const count = t("span", `${fmt(total)} lines`, {
      class: "chip",
      "data-paint": "surface text",
      "data-surface": "chip",
      "data-tone": "ink-2",
    });
    const sibling = h(
      "a",
      { class: "sibling", href: cb.siblingHref, "aria-label": "Next pane: Transfer points" },
      "Transfer ›",
    );
    sibling.addEventListener("click", cb.onSibling);
    this.status = t("p", "", {
      class: "hint",
      id: "statement-status",
      "data-tone": "ink-2",
      "data-paint": "text",
    });

    // Flow ribbon band (accompanying diorama, collapsed until View → Flow).
    this.ribbonCanvas = h("canvas", { class: "ribbon-image", "aria-hidden": "true" });
    const opening = lines.length
      ? lines[lines.length - 1]!.balance_after - lines[lines.length - 1]!.amount
      : 0;
    const closing = lines[0]?.balance_after ?? 0;
    const orbit = (step: number) => {
      this.azimuth = (this.azimuth + step + 360) % 360;
      this.ribbonKey = "";
      void this.bakeRibbon();
    };
    const orbitBtn = (label: string, glyph: string, step: number) =>
      h(
        "button",
        { type: "button", class: "mini-btn", "aria-label": label, onclick: () => orbit(step) },
        glyph,
      );
    this.ribbonFigure = h(
      "figure",
      { class: "ribbon-band", "data-open": "false" },
      h("div", { class: "ribbon-well" }, this.ribbonCanvas),
      h(
        "div",
        { class: "ribbon-tools" },
        orbitBtn("Orbit the flow left", "⟲", -30),
        orbitBtn("Orbit the flow right", "⟳", 30),
      ),
      t(
        "figcaption",
        `Flow of ${fmt(total)} lines: height is the balance after each line, from ${fmt(opening)} to ${fmt(closing)}; width is the size of each credit or debit; credits green, debits red. The list below has every line.`,
        { class: "small", "data-tone": "ink-2", "data-paint": "text" },
      ),
    );
    this.installRibbonDrag();

    // List presentation.
    this.list = h("ul", { class: "items", role: "list", "aria-label": `Statement, ${fmt(total)} lines` });
    this.list.addEventListener("click", (e) => this.onListClick(e));
    this.list.addEventListener("change", (e) => this.onListChange(e));

    // Table presentation.
    this.tbody = h("tbody");
    const headRow = h(
      "tr",
      { "data-paint": "surface", "data-surface": "thead" },
      ...COLUMNS.map((c) =>
        h(
          "th",
          { scope: "col", class: c.cls, "data-paint": "text", "data-clip": "", "data-tone": "ink-3" },
          c.label,
        ),
      ),
    );
    this.table = h(
      "table",
      { class: "ledger", "aria-rowcount": total + 1, "aria-labelledby": "statement-title" },
      h("caption", { class: "sr-only" }, `Your statement, ${fmt(total)} lines, newest first`),
      h("colgroup", {}, ...COLUMNS.map((c) => h("col", { style: `width: ${c.width}` }))),
      h("thead", {}, headRow),
      this.tbody,
    );
    this.scroller = h(
      "div",
      {
        class: "scroller",
        tabindex: 0,
        role: "region",
        "aria-label": `Statement, ${fmt(total)} lines`,
        "data-clip": "",
        "data-clip-sticky": "thead",
      },
      this.table,
    );
    this.scroller.addEventListener(
      "scroll",
      () => {
        this.renderTable(false);
        this.cb.onDirty();
      },
      { passive: true },
    );
    this.table.addEventListener("copy", (e) => this.onTableCopy(e));

    // Search sheet: a non-modal peek sheet, its field at the bottom edge above the dock, the list visible above it.
    this.searchInput = h("input", {
      id: "statement-search",
      class: "kit-input",
      type: "search",
      placeholder: "Memo, person, type or number",
      autocomplete: "off",
      enterkeyhint: "search",
      "data-paint": "field",
    });
    this.searchInput.addEventListener("input", () => this.setQuery(this.searchInput.value));
    this.searchCount = t("p", "", {
      class: "small",
      role: "status",
      "data-tone": "ink-2",
      "data-paint": "text",
    });
    const closeSearch = h("button", { type: "button", class: "mini-btn", "aria-label": "Close search" }, "✕");
    closeSearch.addEventListener("click", () => this.closeSearch());
    this.searchSheet = h(
      "div",
      {
        class: "search-sheet",
        role: "dialog",
        "aria-label": "Search the statement",
        hidden: true,
        "data-paint": "surface",
        "data-surface": "hud",
      },
      this.searchCount,
      h(
        "div",
        { class: "search-row" },
        h("label", { class: "sr-only", for: "statement-search" }, "Search all lines"),
        this.searchInput,
        closeSearch,
      ),
    );
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.closeSearch();
      }
    });

    // The dock.
    const dockBtn = (label: string, cls: string, attrs: Record<string, string> = {}) =>
      h("button", { type: "button", class: `dock-btn ${cls}`, ...attrs }, label);
    const back = dockBtn("‹ Back", "back", { "aria-label": "Back to the Bank lobby" });
    back.addEventListener("click", () => cb.back());
    const search = dockBtn("⌕ Search", "search", { "aria-haspopup": "dialog" });
    search.addEventListener("click", () => this.openSearch());
    this.viewList = dockBtn("List", "seg", { role: "radio", "aria-checked": "true" });
    this.viewFlow = dockBtn("Flow", "seg", { role: "radio", "aria-checked": "false" });
    this.viewList.addEventListener("click", () => this.setFlow(false));
    this.viewFlow.addEventListener("click", () => this.setFlow(true));
    const view = h(
      "div",
      { class: "segmented", role: "radiogroup", "aria-label": "View" },
      this.viewList,
      this.viewFlow,
    );
    this.selectBtn = dockBtn("☐ Select", "select", { "aria-pressed": "false" });
    this.selectBtn.addEventListener("click", () => this.setSelecting(!this.selecting));
    this.copyBtn = dockBtn("Copy 0", "primary copy");
    this.copyBtn.hidden = true;
    this.copyBtn.addEventListener("click", () => void this.copySelected());
    this.dock = h(
      "div",
      { class: "dock room-dock", role: "toolbar", "aria-label": "Statement tools" },
      back,
      search,
      view,
      this.selectBtn,
      this.copyBtn,
    );

    this.root = h(
      "section",
      {
        class: "room",
        "data-room": "statement",
        "aria-labelledby": "statement-title",
        "data-paint": "surface",
        "data-surface": "pane",
      },
      h("div", { class: "room-strip" }, this.heading, count, h("span", { class: "grow" }), sibling),
      this.status,
      this.ribbonFigure,
      this.list,
      this.scroller,
      this.searchSheet,
      this.dock,
    );

    if (typeof ResizeObserver !== "undefined") {
      let last = -1;
      new ResizeObserver(() => {
        const w = this.root.clientWidth;
        if (Math.abs(w - last) < 1) return;
        last = w;
        this.choosePresentation();
        if (this.flowOpen) void this.bakeRibbon();
      }).observe(this.root);
    }
    window.addEventListener(
      "scroll",
      () => {
        if (this.active && this.presentation === "list") this.renderList(false);
      },
      { passive: true },
    );
  }

  /** Call when the room is shown and laid out. */
  mount(): void {
    this.active = true;
    this.choosePresentation(true);
  }

  unmount(): void {
    this.active = false;
    this.closeSearch();
  }

  private choosePresentation(force = false): void {
    const w = this.root.clientWidth;
    if (w <= 0) return;
    const next = w >= TABLE_FROM_REM * remPx() ? "table" : "list";
    if (next === this.presentation && !force) return;
    this.presentation = next;
    this.root.setAttribute("data-presentation", next);
    this.list.hidden = next !== "list";
    this.scroller.hidden = next !== "table";
    if (next === "list") this.renderList(true);
    else this.renderTable(true);
    this.updateSelectUi();
    this.cb.onDirty();
  }

  // ------------------------------------------------------------ list

  private itemTop(i: number): number {
    return i * ITEM_H + (this.expanded >= 0 && i > this.expanded ? this.expandedExtra : 0);
  }

  renderList(force: boolean): void {
    const n = this.filtered.length;
    const r = this.list.getBoundingClientRect();
    const viewTop = Math.max(0, -r.top);
    const viewH = window.innerHeight || 800;
    let first = Math.floor(viewTop / ITEM_H);
    if (this.expanded >= 0 && first > this.expanded)
      first = Math.floor((viewTop - this.expandedExtra) / ITEM_H);
    first = Math.max(0, Math.min(n, first));
    const last = Math.min(n, Math.ceil((viewTop + viewH) / ITEM_H) + 1);
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(n, last + OVERSCAN);
    this.setStatus(first, last, n);
    if (!force && start === this.windowStart && end === this.windowEnd) return;
    this.windowStart = start;
    this.windowEnd = end;
    const items: HTMLElement[] = [];
    if (start > 0)
      items.push(
        h("li", { class: "spacer", "aria-hidden": "true", style: `height: ${this.itemTop(start)}px` }),
      );
    for (let i = start; i < end; i++) items.push(this.item(i, n));
    if (end < n) {
      const rest = this.itemTop(n) - this.itemTop(end) + (this.expanded >= end ? this.expandedExtra : 0);
      items.push(h("li", { class: "spacer", "aria-hidden": "true", style: `height: ${rest}px` }));
    }
    const focusedRow = (document.activeElement as HTMLElement | null)
      ?.closest?.("li.item")
      ?.getAttribute("data-row");
    clear(this.list);
    this.list.append(...items);
    if (focusedRow)
      this.list
        .querySelector<HTMLElement>(`li.item[data-row="${focusedRow}"] .item-btn`)
        ?.focus({ preventScroll: true });
    if (this.expanded >= start && this.expanded < end) {
      const li = this.list.querySelector<HTMLElement>(`li.item[data-row="${this.expanded}"]`);
      if (li) {
        const extra = li.offsetHeight - ITEM_H;
        if (Math.abs(extra - this.expandedExtra) > 1) {
          this.expandedExtra = extra;
          this.renderList(true);
          return;
        }
      }
    }
    this.cb.onDirty();
  }

  private item(i: number, n: number): HTMLElement {
    const l = this.filtered[i]!;
    const c = cellTexts(l);
    const open = this.expanded === i;
    const tone = l.amount >= 0 ? "credit" : "debit";
    const btn = h(
      "button",
      {
        type: "button",
        class: "item-btn",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": `item-${i}-detail`,
        "aria-label": sentence(l),
      },
      h(
        "span",
        { class: "l1" },
        t("span", c[3], { class: "primary" }),
        t("span", c[4], { class: `trail mono ${tone}`, "data-tone": tone }),
      ),
      h(
        "span",
        { class: "l2" },
        t("span", `${c[1]} · ${c[2]} · No. ${c[0]}`, { class: "secondary", "data-tone": "ink-2" }),
        t("span", c[5], { class: "trail-sub mono", "data-tone": "ink-2" }),
      ),
    );
    const pick = h("input", { type: "checkbox", class: "pick", "aria-label": `Select line ${c[0]}` });
    pick.checked = this.selected.has(i);
    pick.hidden = !this.selecting;
    const li = h(
      "li",
      {
        class: `item${open ? " open" : ""}${this.selected.has(i) ? " picked" : ""}`,
        "data-row": i,
        "aria-setsize": n,
        "aria-posinset": i + 1,
      },
      pick,
      btn,
    );
    if (open) {
      const dd = (label: string, value: string, cls = "") =>
        [t("dt", label, { "data-tone": "ink-3" }), t("dd", value, { class: cls })] as const;
      li.append(
        h(
          "dl",
          { id: `item-${i}-detail`, class: "detail" },
          ...dd("Details", c[3]!, "memo"),
          ...dd("Number", c[0]!),
          ...dd("Date (UTC)", c[1]!),
          ...dd("Type", c[2]!),
          ...dd("Change", c[4]!),
          ...dd("Balance after", c[5]!),
        ),
      );
    }
    return li;
  }

  private onListClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest(".item-btn");
    if (!btn) return;
    const li = btn.closest("li.item");
    const i = Number(li?.getAttribute("data-row"));
    if (!Number.isInteger(i)) return;
    if (this.selecting) {
      this.toggleSelected(i);
      return;
    }
    this.expanded = this.expanded === i ? -1 : i;
    this.expandedExtra = 0;
    this.renderList(true);
    this.list
      .querySelector<HTMLElement>(`li.item[data-row="${i}"] .item-btn`)
      ?.focus({ preventScroll: true });
  }

  private onListChange(e: Event): void {
    const box = e.target as HTMLInputElement;
    if (!box.classList.contains("pick")) return;
    const i = Number(box.closest("li.item")?.getAttribute("data-row"));
    if (Number.isInteger(i)) this.toggleSelected(i, box.checked);
  }

  toggleSelected(i: number, on?: boolean): void {
    const want = on ?? !this.selected.has(i);
    if (want) this.selected.add(i);
    else this.selected.delete(i);
    const li = this.list.querySelector(`li.item[data-row="${i}"]`);
    li?.classList.toggle("picked", want);
    const box = li?.querySelector<HTMLInputElement>("input.pick");
    if (box) box.checked = want;
    this.updateSelectUi();
  }

  setSelecting(on: boolean): void {
    this.selecting = on;
    if (!on) this.selected.clear();
    if (on) this.expanded = -1;
    this.renderList(true);
    this.updateSelectUi();
    this.cb.announce(on ? "Select mode. Tap lines to select them." : "Select mode off.");
  }

  private updateSelectUi(): void {
    const n = this.selected.size;
    this.selectBtn.setAttribute("aria-pressed", String(this.selecting));
    setText(this.selectBtn, this.selecting ? "Done" : "☐ Select");
    this.selectBtn.hidden = this.presentation === "table" && !this.selecting;
    this.copyBtn.hidden = !this.selecting;
    setText(this.copyBtn, `Copy ${n}`);
    this.copyBtn.disabled = n === 0;
    this.root.toggleAttribute("data-selecting", this.selecting);
  }

  rowText(i: number): string[] {
    const l = this.filtered[i];
    return l ? cellTexts(l) : [];
  }

  rowsTsv(idx: number[]): string {
    return idx.map((i) => this.rowText(i).join("\t")).join("\n");
  }

  /** Copy writes TSV and an HTML table, exactly as a table selection does (spec 02 section 2.6.1). */
  async copySelected(): Promise<string> {
    const idx = [...this.selected].sort((a, b) => a - b);
    const tsv = this.rowsTsv(idx);
    let ok = false;
    try {
      const html = `<table>${idx
        .map(
          (i) =>
            `<tr>${this.rowText(i)
              .map((c) => `<td>${escapeHtml(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</table>`;
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([tsv], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
      } else await navigator.clipboard.writeText(tsv);
      ok = true;
    } catch {
      // Fallback: a hidden textarea and execCommand, still from the user's tap.
      const ta = h("textarea", { class: "sr-only", "aria-hidden": "true" });
      ta.value = tsv;
      document.body.append(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    this.cb.announce(ok ? `Copied ${idx.length} line${idx.length === 1 ? "" : "s"}` : "Could not copy");
    return tsv;
  }

  // ------------------------------------------------------------ table

  renderTable(force: boolean): void {
    const n = this.filtered.length;
    const view = this.scroller.clientHeight || 600;
    const top = this.scroller.scrollTop;
    const first = Math.floor(top / ROW_H);
    const last = Math.min(n, Math.ceil((top + view) / ROW_H));
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(n, last + OVERSCAN);
    this.setStatus(first, last, n);
    if (!force && start === this.windowStart && end === this.windowEnd) return;
    this.windowStart = start;
    this.windowEnd = end;
    const rows: HTMLTableRowElement[] = [];
    if (start > 0) rows.push(this.spacer(start * ROW_H));
    for (let i = start; i < end; i++) {
      const l = this.filtered[i]!;
      const texts = cellTexts(l);
      const tone = l.amount >= 0 ? "credit" : "debit";
      rows.push(
        h(
          "tr",
          {
            class: "row",
            "aria-rowindex": i + 2,
            "data-row": i,
            ...(i % 2 === 1 ? { "data-paint": "surface", "data-surface": "zebra" } : {}),
          },
          ...texts.map((txt, c) =>
            h(
              "td",
              {
                class: `${COLUMNS[c]!.cls} ${c === 4 ? tone : ""}`.trim(),
                "data-paint": "text",
                "data-clip": "",
                "data-tone": c === 4 ? tone : c === 0 || c === 1 ? "ink-2" : "ink",
              },
              txt,
            ),
          ),
        ),
      );
    }
    if (end < n) rows.push(this.spacer((n - end) * ROW_H));
    clear(this.tbody);
    this.tbody.append(...rows);
  }

  private spacer(height: number): HTMLTableRowElement {
    return h(
      "tr",
      { class: "spacer", "aria-hidden": "true" },
      h("td", { colspan: COLUMNS.length, style: `height: ${height}px` }),
    );
  }

  scrollToRow(index: number): void {
    if (this.presentation === "table") {
      this.scroller.scrollTop = Math.max(0, index * ROW_H);
      this.renderTable(false);
    } else {
      const top = this.list.getBoundingClientRect().top + window.scrollY + this.itemTop(index);
      window.scrollTo(0, Math.max(0, top - 160));
      this.renderList(true);
    }
  }

  /** Multi-row selections in the table copy as TSV of the rows they touch; within one cell, natively. */
  private onTableCopy(e: ClipboardEvent): void {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || !e.clipboardData) return;
    const range = sel.getRangeAt(0);
    const rows = [...this.tbody.querySelectorAll<HTMLTableRowElement>("tr.row")].filter((tr) =>
      range.intersectsNode(tr),
    );
    if (rows.length < 2) return;
    const idx = rows.map((r) => Number(r.dataset["row"]));
    e.clipboardData.setData("text/plain", this.rowsTsv(idx));
    e.clipboardData.setData(
      "text/html",
      `<table>${idx
        .map(
          (i) =>
            `<tr>${this.rowText(i)
              .map((c) => `<td>${escapeHtml(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</table>`,
    );
    e.preventDefault();
  }

  // ------------------------------------------------------------ search, view, status

  private setStatus(first: number, last: number, n: number): void {
    setText(
      this.status,
      n === 0
        ? "No lines match. Clear the search to see all lines."
        : `Showing ${fmt(Math.min(n, first + 1))} to ${fmt(Math.max(first + 1, Math.min(n, last)))} of ${fmt(n)}. Search finds any line.`,
    );
  }

  openSearch(): void {
    this.searchSheet.hidden = false;
    this.root.setAttribute("data-searching", "");
    this.searchInput.focus();
    this.cb.onDirty();
  }

  closeSearch(): void {
    if (this.searchSheet.hidden) return;
    this.searchSheet.hidden = true;
    this.root.removeAttribute("data-searching");
    this.dock.querySelector<HTMLElement>(".dock-btn.search")?.focus({ preventScroll: true });
    this.cb.onDirty();
  }

  setQuery(q: string): void {
    this.query = q.trim().toLowerCase();
    const qq = this.query;
    this.filtered = qq
      ? this.lines.filter((l) => cellTexts(l).join(" ").toLowerCase().includes(qq))
      : this.lines;
    this.selected.clear();
    this.expanded = -1;
    this.scroller.scrollTop = 0;
    if (this.presentation === "list") this.renderList(true);
    else this.renderTable(true);
    this.updateSelectUi();
    const msg = qq
      ? `${fmt(this.filtered.length)} of ${fmt(this.lines.length)} lines match`
      : "Showing all lines";
    setText(this.searchCount, msg);
    this.cb.announce(msg);
  }

  setFlow(open: boolean): void {
    this.flowOpen = open;
    this.ribbonFigure.setAttribute("data-open", String(open));
    this.viewList.setAttribute("aria-checked", String(!open));
    this.viewFlow.setAttribute("aria-checked", String(open));
    this.cb.announce(
      open
        ? `Flow view. ${fmt(this.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))} in, ${fmt(
            this.lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0),
          )} out.`
        : "List view.",
    );
    if (open) void this.bakeRibbon();
    this.cb.onDirty();
  }

  /** Bake the ribbon for the well's current size (re-baked on orbit and resize only). */
  async bakeRibbon(): Promise<boolean> {
    const bake = this.cb.bakeRibbon();
    if (!bake || this.lines.length < 2) return false;
    const well = this.ribbonCanvas.parentElement!;
    const w = well.clientWidth;
    const hgt = well.clientHeight;
    if (w < 8 || hgt < 8) return false;
    const key = `${w}x${hgt}@${this.azimuth}`;
    if (key === this.ribbonKey) return true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const img = await bake(this.lines, this.azimuth, w, hgt, dpr);
    if (!img) return false;
    this.ribbonCanvas.style.width = `${w}px`;
    this.ribbonCanvas.style.height = `${hgt}px`;
    paintImage(this.ribbonCanvas, img);
    this.ribbonKey = key;
    this.ribbonFigure.setAttribute("data-baked", "");
    return true;
  }

  /** Drag to orbit only with a fine pointer (spec 00 section 0.5); touch keeps native scrolling. */
  private installRibbonDrag(): void {
    if (!matchMedia("(pointer: fine)").matches) return;
    let x0: number | null = null;
    let az0 = 0;
    let pending = false;
    this.ribbonCanvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      x0 = e.clientX;
      az0 = this.azimuth;
      this.ribbonCanvas.setPointerCapture(e.pointerId);
    });
    this.ribbonCanvas.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      this.azimuth = (az0 + (e.clientX - x0) * 0.5 + 360) % 360;
      this.ribbonKey = "";
      if (pending) return;
      pending = true;
      void this.bakeRibbon().finally(() => (pending = false));
    });
    this.ribbonCanvas.addEventListener("pointerup", () => (x0 = null));
  }

  get total(): number {
    return this.lines.length;
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
