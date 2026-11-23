// The shell, designed for the thumb first (spec 00 section 0.4): a read-only top bar (up, title, breadcrumb, balance
// chip, Motion), the status layer ("Updates") directly after it in the DOM, and the bottom bar at every altitude
// (City, Inbox, Approvals for approvers, Command, Alerts, You). The bar becomes a rail on the leading edge from the
// medium breakpoint. Sheets are bottom sheets (<dialog> opened with showModal, a visible Close, Escape and history
// back close them); from the medium breakpoint they are centred dialogs.

import { h, t, clear, setText } from "../plat/dom";
import type { Motion } from "../engine/capability";
import type { ExperienceOverride } from "../swap/experience";
import { fmt } from "../format";

export interface DirectoryEntry {
  readonly label: string;
  readonly section: string;
  readonly path: string;
  readonly keywords?: string;
}

export interface ShellHooks {
  navigate(path: string): void;
  href(path: string): string;
  motion(): Motion;
  setMotion(m: Motion): void;
  hand(): "right" | "left";
  setHand(h: "right" | "left"): void;
  experience(): ExperienceOverride;
  chooseExperience(choice: ExperienceOverride): void;
  classicHref(): string;
  cityPressed(): void;
  directory(): DirectoryEntry[];
  announce(msg: string): void;
}

const MOTION_LABEL: Record<Motion, string> = { full: "Full", reduced: "Reduced", off: "Off" };
const MOTION_GLYPH: Record<Motion, string> = { full: "◉", reduced: "◐", off: "○" };

export interface Sheet {
  readonly name: string;
  readonly dialog: HTMLDialogElement;
  readonly body: HTMLElement;
  opener: HTMLElement | null;
}

export class Shell {
  readonly topbar: HTMLElement;
  readonly updates: HTMLElement;
  readonly bottombar: HTMLElement;
  readonly sheets = new Map<string, Sheet>();
  readonly sheetHost: HTMLElement;
  private readonly up: HTMLAnchorElement;
  private readonly title: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly balanceChip: HTMLElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly counts = new Map<string, HTMLElement>();
  private readonly status = new Map<string, { priority: number; el: HTMLElement }>();
  private readonly approvalsSlot: HTMLElement;
  private openSheetName: string | null = null;
  private pushedForSheet = false;
  /** The popstate our own history.back() (closing a sheet) causes: not a navigation. */
  private ownPop = false;
  private me: { name: string; handle: string; balance: number | null; tier: string | null } = {
    name: "",
    handle: "",
    balance: null,
    tier: null,
  };
  private cmdList: HTMLElement | null = null;
  private cmdInput: HTMLInputElement | null = null;
  private cmdActive = -1;
  private cmdResults: DirectoryEntry[] = [];

  constructor(private readonly hooks: ShellHooks) {
    this.up = h(
      "a",
      { class: "up", href: hooks.href("/"), "aria-label": "Up to the town" },
      h("span", { "aria-hidden": "true" }, "‹"),
    );
    this.up.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      hooks.navigate(this.up.getAttribute("data-path") ?? "/");
    });
    this.title = t("span", "Northwind", { class: "top-title", "data-paint": "text" });
    this.crumb = t("span", "Town", { class: "top-crumb", "data-paint": "text", "data-tone": "ink-2" });
    this.balanceChip = t("span", "", {
      class: "balance-chip",
      "data-paint": "surface text",
      "data-surface": "chip",
      "aria-label": "Balance",
    });
    this.motionBtn = h("button", {
      type: "button",
      class: "motion",
      "aria-haspopup": "dialog",
      onclick: () => this.open("motion", this.motionBtn),
    });
    this.topbar = h(
      "header",
      { id: "topbar", "data-paint": "surface", "data-surface": "hud" },
      this.up,
      h("div", { class: "top-text" }, this.title, this.crumb),
      this.balanceChip,
      this.motionBtn,
    );
    this.updates = h("section", { id: "updates", "aria-label": "Updates" });

    const slot = (
      key: string,
      glyph: string,
      label: string,
      onClick: (el: HTMLElement) => void,
      count?: string,
    ) => {
      const badge = count ? h("span", { class: "count", "aria-hidden": "true", hidden: true }) : null;
      if (badge && count) this.counts.set(count, badge);
      const el = h(
        "button",
        {
          type: "button",
          class: "slot",
          "data-slot": key,
          "data-paint": "surface",
          "data-surface": "button",
        },
        h("span", { class: "glyph", "aria-hidden": "true" }, glyph),
        t("span", label, { class: "slot-label" }),
        badge,
      );
      el.addEventListener("click", () => onClick(el));
      return el;
    };
    this.approvalsSlot = slot(
      "approvals",
      "⛩",
      "Approvals",
      () => hooks.navigate("/approvals"),
      "approvals_pending",
    );
    this.approvalsSlot.hidden = true;
    this.bottombar = h(
      "nav",
      { id: "bottombar", "aria-label": "Main", "data-paint": "surface", "data-surface": "hud" },
      slot("city", "⌂", "City", () => hooks.cityPressed()),
      slot("inbox", "✉", "Inbox", () => hooks.navigate("/messages"), "messages_unread"),
      this.approvalsSlot,
      slot("command", "⌕", "Command", (el) => this.open("command", el)),
      slot("alerts", "♪", "Alerts", (el) => this.open("alerts", el), "notifications_unread"),
      slot("you", "◯", "You", (el) => this.open("you", el)),
    );
    this.sheetHost = h("div", { id: "sheets" });
    this.buildSheets();
    this.setMotion(hooks.motion());
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.open("command", null);
      }
    });
  }

  // ------------------------------------------------------------ top bar

  setTop(opts: { title: string; crumb: string; up: { path: string; label: string } | null }): void {
    setText(this.title, opts.title);
    setText(this.crumb, opts.crumb);
    if (opts.up) {
      this.up.hidden = false;
      this.up.href = this.hooks.href(opts.up.path);
      this.up.setAttribute("data-path", opts.up.path);
      this.up.setAttribute("aria-label", `Up to ${opts.up.label}`);
    } else this.up.hidden = true;
  }

  setMotion(m: Motion): void {
    clear(this.motionBtn);
    this.motionBtn.append(h("span", { "aria-hidden": "true" }, MOTION_GLYPH[m]));
    this.motionBtn.setAttribute("aria-label", `Motion: ${MOTION_LABEL[m]}`);
    for (const r of this.sheetHost.querySelectorAll<HTMLInputElement>('input[name="motion"]'))
      r.checked = r.value === m;
  }

  setMe(me: {
    name: string;
    handle: string;
    balance: number | null;
    tier: string | null;
    approver: boolean;
  }): void {
    this.me = me;
    setText(this.balanceChip, me.balance === null ? "" : `◉ ${fmt(me.balance)}`);
    this.balanceChip.setAttribute(
      "aria-label",
      me.balance === null ? "Balance unknown" : `Balance ${fmt(me.balance)} points`,
    );
    this.balanceChip.hidden = me.balance === null;
    this.approvalsSlot.hidden = !me.approver;
    this.renderYou();
  }

  setBalance(balance: number): void {
    this.setMe({ ...this.me, balance, approver: !this.approvalsSlot.hidden });
  }

  setCounts(counts: Record<string, number>): void {
    for (const [key, el] of this.counts) {
      const n = counts[key] ?? 0;
      el.hidden = n <= 0;
      el.textContent = n > 99 ? "99+" : String(n);
      const slot = el.closest("button");
      const label = slot?.querySelector(".slot-label")?.textContent ?? "";
      slot?.setAttribute("aria-label", n > 0 ? `${label}, ${n} new` : label);
    }
    const alerts = this.sheets.get("alerts");
    if (alerts) {
      clear(alerts.body);
      const n = counts["notifications_unread"] ?? 0;
      alerts.body.append(
        t("p", n > 0 ? `${fmt(n)} unread notifications.` : "No unread notifications.", {
          class: "sheet-text",
        }),
        this.linkButton("Open notifications", "/notifications"),
      );
    }
  }

  // ------------------------------------------------------------ status layer

  /** Show an item in the status layer (at most two at once, by priority; the rest behind "+N"). */
  showStatus(id: string, priority: number, el: HTMLElement): void {
    this.status.get(id)?.el.remove();
    el.dataset["status"] = id;
    this.status.set(id, { priority, el });
    this.layoutStatus();
  }

  hideStatus(id: string): void {
    const s = this.status.get(id);
    if (!s) return;
    s.el.remove();
    this.status.delete(id);
    this.layoutStatus();
  }

  private layoutStatus(): void {
    clear(this.updates);
    const items = [...this.status.values()].sort((a, b) => a.priority - b.priority);
    const max = matchMedia("(max-height: 30rem)").matches ? 1 : 2;
    const shown = items.length > max ? items.slice(0, max - 1) : items;
    for (const s of shown) this.updates.append(s.el);
    if (items.length > max) {
      const rest = items.slice(max - 1);
      const more = h("button", { type: "button", class: "status-item more" }, `+${rest.length} more updates`);
      more.addEventListener("click", () => {
        const sheet = this.sheets.get("updates")!;
        clear(sheet.body);
        for (const r of rest) sheet.body.append(r.el.cloneNode(true));
        this.open("updates", more);
      });
      this.updates.append(more);
    }
    document.documentElement.style.setProperty("--status-h", `${Math.min(items.length, max) * 44}px`);
  }

  // ------------------------------------------------------------ sheets

  private sheet(name: string, title: string): Sheet {
    const body = h("div", { class: "sheet-body" });
    const close = h("button", { type: "button", class: "sheet-close", "aria-label": `Close ${title}` }, "✕");
    const handle = h("button", { type: "button", class: "sheet-handle", "aria-label": "Expand" });
    const dialog = h(
      "dialog",
      { class: "sheet", "data-sheet": name, "aria-label": title },
      h("div", { class: "sheet-head" }, handle, t("h2", title, { class: "sheet-title" }), close),
      body,
    );
    handle.addEventListener("click", () => {
      const full = dialog.toggleAttribute("data-full");
      handle.setAttribute("aria-label", full ? "Collapse" : "Expand");
    });
    close.addEventListener("click", () => this.close());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) this.close(); // a tap on the scrim
    });
    this.sheetHost.append(dialog);
    const s: Sheet = { name, dialog, body, opener: null };
    this.sheets.set(name, s);
    return s;
  }

  private linkButton(label: string, path: string): HTMLElement {
    const a = h("a", { class: "sheet-link", href: this.hooks.href(path) }, label);
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      this.close(false);
      this.hooks.navigate(path);
    });
    return a;
  }

  private buildSheets(): void {
    // Command: the palette as a bottom sheet, its field at the bottom edge, results above it with the best match
    // nearest the field. DOM order: field, then the listbox in rank order (spec 04 section 4.13.1).
    const cmd = this.sheet("command", "Command");
    this.cmdInput = h("input", {
      id: "cmd-input",
      class: "kit-input cmd-input",
      type: "search",
      role: "combobox",
      "aria-expanded": "true",
      "aria-controls": "cmd-list",
      "aria-autocomplete": "list",
      "aria-label": "Go to a page",
      placeholder: "Go to…",
      autocomplete: "off",
      enterkeyhint: "go",
    });
    this.cmdList = h("ul", { id: "cmd-list", class: "cmd-list", role: "listbox", "aria-label": "Results" });
    cmd.body.append(h("div", { class: "cmd" }, this.cmdInput, this.cmdList));
    this.cmdInput.addEventListener("input", () => this.renderCommand());
    this.cmdInput.addEventListener("keydown", (e) => {
      const n = this.cmdResults.length;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.cmdActive = Math.min(n - 1, this.cmdActive + 1);
        this.markActive();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.cmdActive = Math.max(-1, this.cmdActive - 1);
        this.markActive();
      } else if (e.key === "Enter") {
        const pick = this.cmdResults[Math.max(0, this.cmdActive)];
        if (pick) {
          e.preventDefault();
          this.close(false);
          this.hooks.navigate(pick.path);
        }
      }
    });

    this.sheet("alerts", "Alerts").body.append(t("p", "No unread notifications.", { class: "sheet-text" }));
    this.sheet("you", "You");
    this.sheet("updates", "Updates");
    this.sheet("boroughs", "Go to a borough");

    // Motion: three states, also in the You sheet.
    const motion = this.sheet("motion", "Motion");
    motion.body.append(this.motionGroup("motion-sheet"));
  }

  private motionGroup(idPrefix: string): HTMLElement {
    const group = h("fieldset", { class: "choice" }, h("legend", {}, "Motion"));
    for (const m of ["full", "reduced", "off"] as const) {
      const id = `${idPrefix}-${m}`;
      const input = h("input", { type: "radio", name: "motion", id, value: m });
      input.checked = this.hooks.motion() === m;
      input.addEventListener("change", () => {
        this.hooks.setMotion(m);
        this.setMotion(m);
      });
      group.append(h("label", { class: "choice-row", for: id }, input, h("span", {}, MOTION_LABEL[m])));
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      group.append(h("p", { class: "sheet-note" }, "Your system asks for reduced motion."));
    return group;
  }

  private renderYou(): void {
    const you = this.sheets.get("you");
    if (!you) return;
    clear(you.body);
    const me = this.me;
    you.body.append(
      h(
        "div",
        { class: "you-id" },
        t("p", me.name || me.handle, { class: "you-name" }),
        t("p", `@${me.handle}`, { class: "sheet-note" }),
        t(
          "p",
          me.balance === null
            ? "No points balance"
            : `${fmt(me.balance)} points${me.tier ? ` · ${me.tier}` : ""}`,
          {
            class: "you-balance",
          },
        ),
      ),
    );
    // The experience toggle (UI-MAP 8.5 rule 2): the same three choices as Classic's.
    const exp = h("fieldset", { class: "choice", "data-choice": "experience" }, h("legend", {}, "View"));
    const choices: [ExperienceOverride, string][] = [
      ["classic", "Classic view"],
      ["town", "3D view"],
      ["site", "Follow site default"],
    ];
    for (const [value, label] of choices) {
      const id = `exp-${value}`;
      const input = h("input", { type: "radio", name: "experience", id, value });
      input.checked = this.hooks.experience() === value;
      input.addEventListener("change", () => this.hooks.chooseExperience(value));
      exp.append(h("label", { class: "choice-row", for: id }, input, h("span", {}, label)));
    }
    exp.append(h("a", { class: "sheet-link", href: this.hooks.classicHref() }, "Open this page in Classic"));
    you.body.append(exp, this.motionGroup("motion-you"));
    const hand = h("fieldset", { class: "choice" }, h("legend", {}, "Hand"));
    for (const v of ["right", "left"] as const) {
      const id = `hand-${v}`;
      const input = h("input", { type: "radio", name: "hand", id, value: v });
      input.checked = this.hooks.hand() === v;
      input.addEventListener("change", () => this.hooks.setHand(v));
      hand.append(
        h(
          "label",
          { class: "choice-row", for: id },
          input,
          h("span", {}, v === "right" ? "Right hand" : "Left hand"),
        ),
      );
    }
    you.body.append(hand);
  }

  renderBoroughs(items: { label: string; path: string; current: boolean }[]): void {
    const s = this.sheets.get("boroughs");
    if (!s) return;
    clear(s.body);
    const ul = h("ul", { class: "sheet-list" });
    for (const it of items) {
      const a = this.linkButton(it.label, it.path);
      if (it.current) a.setAttribute("aria-current", "page");
      ul.append(h("li", {}, a));
    }
    s.body.append(ul);
  }

  private renderCommand(): void {
    const list = this.cmdList;
    const input = this.cmdInput;
    if (!list || !input) return;
    const q = input.value.trim().toLowerCase();
    const all = this.hooks.directory();
    this.cmdResults = q
      ? all
          .map((e) => {
            const hay = `${e.label} ${e.section} ${e.keywords ?? ""}`.toLowerCase();
            const i = hay.indexOf(q);
            return { e, score: i < 0 ? -1 : e.label.toLowerCase().startsWith(q) ? 0 : 1 + i / 100 };
          })
          .filter((x) => x.score >= 0)
          .sort((a, b) => a.score - b.score)
          .map((x) => x.e)
      : all;
    clear(list);
    this.cmdActive = -1;
    this.cmdResults.forEach((e, i) => {
      const li = h(
        "li",
        { id: `cmd-opt-${i}`, role: "option", class: "cmd-opt", "aria-selected": "false" },
        h("span", { class: "cmd-label" }, e.label),
        h("span", { class: "cmd-section" }, e.section),
      );
      li.addEventListener("click", () => {
        this.close(false);
        this.hooks.navigate(e.path);
      });
      list.append(li);
    });
    if (this.cmdResults.length === 0)
      list.append(h("li", { class: "cmd-empty", role: "presentation" }, "No page matches."));
    input.removeAttribute("aria-activedescendant");
  }

  private markActive(): void {
    const list = this.cmdList;
    if (!list || !this.cmdInput) return;
    for (const li of list.querySelectorAll(".cmd-opt")) li.setAttribute("aria-selected", "false");
    const li = list.querySelector(`#cmd-opt-${this.cmdActive}`);
    if (li) {
      li.setAttribute("aria-selected", "true");
      this.cmdInput.setAttribute("aria-activedescendant", li.id);
      li.scrollIntoView({ block: "nearest" });
    } else this.cmdInput.removeAttribute("aria-activedescendant");
  }

  isOpen(): boolean {
    return this.openSheetName !== null;
  }

  get openName(): string | null {
    return this.openSheetName;
  }

  open(name: string, opener: HTMLElement | null): void {
    const s = this.sheets.get(name);
    if (!s) return;
    if (this.openSheetName) this.close(false);
    s.opener = opener ?? (document.activeElement as HTMLElement | null);
    if (name === "command") {
      if (this.cmdInput) this.cmdInput.value = "";
      this.renderCommand();
    }
    if (name === "you") this.renderYou();
    s.dialog.removeAttribute("data-full");
    try {
      s.dialog.showModal();
    } catch {
      s.dialog.setAttribute("open", "");
    }
    this.openSheetName = name;
    // Opening a modal sheet pushes a history entry so the platform back gesture closes it.
    history.pushState({ ...(history.state ?? {}), sheet: name }, "", location.href);
    this.pushedForSheet = true;
    if (name === "command") this.cmdInput?.focus();
    else s.dialog.querySelector<HTMLElement>(".sheet-close")?.focus();
  }

  /** Close the open sheet. `viaHistory` pops the entry its opening pushed. */
  close(viaHistory = true): void {
    const name = this.openSheetName;
    if (!name) return;
    const s = this.sheets.get(name)!;
    this.openSheetName = null;
    s.dialog.close();
    s.dialog.removeAttribute("open");
    if (this.pushedForSheet) {
      this.pushedForSheet = false;
      if (viaHistory) {
        this.ownPop = true;
        history.back();
      } else history.replaceState({ ...(history.state ?? {}), sheet: null }, "", location.href);
    }
    if (s.opener?.isConnected) s.opener.focus();
  }

  /** popstate while a sheet is open: the platform back closed it. Returns true when it handled the event. */
  onPopState(): boolean {
    if (this.ownPop) {
      this.ownPop = false;
      return true;
    }
    if (!this.openSheetName) return false;
    this.pushedForSheet = false;
    this.close(false);
    return true;
  }
}
