// One panel: a labelled region with a head (title, cause tag, table toggle, menu), a body and a foot.
import { h, clear, uid } from "./dom.js";
import { summarizeQuery } from "./board.js";
import { actorLabel } from "./events.js";
import { clockSeconds, num } from "./format.js";
import { ChannelError, buildTable, buildVisual, channelColumns } from "./visuals.js";

const CAUSE_MS = 6000;

const stateBlock = (kind, ...kids) => h("div", { class: `state state--${kind}` }, ...kids);

/** Roving-focus menu: arrow keys, Home/End, Escape, and outside click. */
const createMenu = (label, items) => {
  const trigger = h("button", { type: "button", class: "menu__trigger", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": label }, h("span", { "aria-hidden": "true" }, "⋯"));
  const list = h("ul", { class: "menu__list", role: "menu", "aria-label": label, hidden: true });
  const root = h("div", { class: "menu" }, trigger, list);
  const buttons = () => [...list.querySelectorAll("button:not([hidden])")];

  const close = (restore) => {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (restore) trigger.focus();
  };
  function outside(e) {
    if (!root.contains(e.target)) close(false);
  }
  const open = () => {
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    buttons()[0]?.focus();
  };

  for (const it of items) {
    const btn = h("button", { type: "button", role: "menuitem", tabindex: "-1" }, it.text);
    btn.addEventListener("click", () => {
      close(true);
      it.run();
    });
    it.button = btn;
    list.append(h("li", { role: "none" }, btn));
  }

  trigger.addEventListener("click", () => (list.hidden ? open() : close(true)));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && list.hidden) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement);
    const go = (i) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
  });
  return { root, trigger, items, close };
};

export class Panel {
  /**
   * handlers: { onInspect(slug), onBrush(range), getWindow() }
   */
  constructor(entry, handlers) {
    this.entry = entry;
    this.handlers = handlers;
    this.showTable = false;
    this.dispose = () => {};
    this.causeTimer = undefined;
    const titleId = uid("panel-title");

    this.titleEl = h("h2", { class: "panel__title", id: titleId });
    this.indexEl = h("span", { class: "panel__index", "aria-hidden": "true" });
    this.causeEl = h("p", { class: "panel__cause", hidden: true });
    this.toggle = h("button", { type: "button", class: "panel__toggle", "aria-pressed": "false" }, "Table");
    this.toggle.addEventListener("click", () => this.setTable(!this.showTable));

    this.tableItem = { text: "View as table", run: () => this.setTable(!this.showTable) };
    this.menu = createMenu(`Actions for ${entry.title}`, [{ text: "Inspect", run: () => handlers.onInspect(entry.slug) }, this.tableItem]);

    this.body = h("div", { class: "panel__body" });
    this.foot = h("footer", { class: "panel__foot" });
    this.el = h(
      "section",
      { class: "panel", "aria-labelledby": titleId, "data-slug": entry.slug },
      h("header", { class: "panel__head" }, this.indexEl, this.titleEl, this.causeEl, this.toggle, this.menu.root),
      this.body,
      this.foot,
    );
    this.render();
  }

  get chartable() {
    const e = this.entry;
    return Boolean(e.result && !e.error && e.visual && e.visual.type !== "table" && e.result.rows.length > 0);
  }

  setIndex(n) {
    this.indexEl.textContent = String(n).padStart(2, "0");
  }

  setTable(on) {
    this.showTable = on;
    this.render();
  }

  update(entry) {
    this.entry = entry;
    this.render();
  }

  /** Redraw charts that depend on session state (the brushed window). */
  refreshWindow() {
    if (this.entry.visual?.type === "line" || this.entry.visual?.type === "area") this.render();
  }

  render() {
    const e = this.entry;
    this.dispose();
    this.dispose = () => {};
    this.titleEl.textContent = e.title;
    this.el.dataset.visual = e.visual?.type ?? "none";
    const chartable = this.chartable;
    this.toggle.hidden = !chartable;
    this.tableItem.button.hidden = !chartable;
    this.tableItem.button.textContent = this.showTable ? "View as chart" : "View as table";
    this.toggle.setAttribute("aria-pressed", String(chartable && this.showTable));
    this.toggle.setAttribute("aria-label", `Table view of ${e.title}`);

    clear(this.body);
    const ctx = { title: e.title, window: this.handlers.getWindow(), onBrush: this.handlers.onBrush };
    this.el.dataset.state = "ready";
    if (e.error || !e.result) {
      this.el.dataset.state = "error";
      const err = e.error ?? { code: "NO_RESULT", message: "The query returned no result." };
      this.body.append(stateBlock("error", h("p", { class: "state__code" }, err.code), h("p", { class: "state__text" }, err.message), err.fix_hint ? h("p", { class: "state__hint" }, err.fix_hint) : null));
    } else if (e.result.rows.length === 0) {
      this.el.dataset.state = "empty";
      this.body.append(stateBlock("empty", h("p", { class: "state__title" }, "No rows for this query"), h("p", { class: "state__text state__text--mono" }, summarizeQuery(e.query))));
    } else {
      try {
        const built =
          this.showTable && chartable
            ? buildTable(e.result, channelColumns(e.visual), { caption: e.title })
            : buildVisual(e.visual, e.result, ctx);
        this.dispose = built.dispose;
        this.body.append(built.el);
      } catch (err) {
        if (!(err instanceof ChannelError)) throw err;
        this.el.dataset.state = "error";
        this.body.append(stateBlock("error", h("p", { class: "state__code" }, "CHANNEL_MAPPING"), h("p", { class: "state__text" }, err.message)));
      }
    }

    clear(this.foot);
    if (e.result) {
      const asOf = Date.parse(e.result.as_of);
      this.foot.append(
        h("span", null, "As of ", h("time", { datetime: e.result.as_of }, Number.isNaN(asOf) ? e.result.as_of : clockSeconds(asOf))),
        h("span", null, `${num(e.result.row_count)} ${e.result.row_count === 1 ? "row" : "rows"}${e.result.truncated ? " (truncated)" : ""}`),
      );
    }
  }

  /** Attribute an appearance or change to the realtime event that caused it. Animation is allowed only here. */
  showCause({ event, isNew }) {
    clearTimeout(this.causeTimer);
    this.causeEl.replaceChildren(
      h("span", { class: "panel__cause-seq" }, `#${event.seq}`),
      ` ${isNew ? "Added" : "Changed"} by ${actorLabel(event.actor)}`,
    );
    this.causeEl.hidden = false;
    this.el.classList.remove("is-arriving", "is-changed");
    void this.el.offsetWidth; // restart the CSS animation for back-to-back changes
    this.el.classList.add(isNew ? "is-arriving" : "is-changed");
    this.el.dataset.cause = String(event.seq);
    this.causeTimer = setTimeout(() => this.clearCause(), CAUSE_MS);
  }

  clearCause() {
    this.causeEl.hidden = true;
    this.el.classList.remove("is-arriving", "is-changed");
    delete this.el.dataset.cause;
  }

  destroy() {
    clearTimeout(this.causeTimer);
    this.dispose();
    this.menu.close(false);
  }
}
