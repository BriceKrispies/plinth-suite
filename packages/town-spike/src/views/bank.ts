// The Bank (/town/points): the lobby and its rooms (spec 02 sections 2.1 and 2.3).
//
// Compact (the design): the lobby is the page's panes as cards in the authored phone order (points.balance whole and
// pinned, points.ledger summary, points.transfer entry); a card's header opens its room, one pane full height with
// its dock just above the bottom bar (/town/points/statement, /town/points/transfer). Medium and wider: the lobby
// and the room side by side (the Statement room is shown beside the lobby when no room is chosen), and the
// Statement becomes a table once its pane is wide enough.

import { h, t, setText, clear } from "../plat/dom";
import { StatementRoom, cellTexts } from "../interior/statement";
import { TransferRoom } from "../interior/transfer";
import { fmt } from "../format";
import { routeLink, type ViewCtx } from "./types";

export type RoomId = "statement" | "transfer";

export class BankView {
  readonly root: HTMLElement;
  readonly lobby: HTMLElement;
  readonly h1: HTMLElement;
  readonly statement: StatementRoom;
  readonly transfer: TransferRoom;
  room: RoomId | null = null;
  private readonly balanceValue: HTMLElement;
  private readonly balanceTier: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly transferStatus: HTMLElement;
  readonly cardLinks: Record<RoomId, HTMLAnchorElement>;

  constructor(
    private readonly ctx: ViewCtx,
    onSent: (balance: number) => void,
  ) {
    const d = ctx.data;
    const toLobby = () => ctx.back("/points");
    const sibling = (path: string) => (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      ctx.navigate(path, { replace: true });
    };
    this.statement = new StatementRoom(d.lines, {
      onDirty: () => ctx.markDirty(),
      announce: (m) => ctx.announce(m),
      back: toLobby,
      bakeRibbon: () => {
        const g = ctx.gpu();
        return g ? (lines, az, w, h, dpr) => g.bakeRibbon(lines, az, w, h, dpr) : null;
      },
      siblingHref: ctx.href("/points/transfer"),
      onSibling: sibling("/points/transfer"),
    });
    this.transfer = new TransferRoom(d.summary, d.people, {
      onDirty: () => ctx.markDirty(),
      announce: (m) => ctx.announce(m),
      back: toLobby,
      me: d.handle,
      siblingHref: ctx.href("/points/statement"),
      onSibling: sibling("/points/statement"),
      onSent,
    });

    this.h1 = t("h1", "Points", {
      id: "bank-title",
      class: "view-title",
      tabindex: -1,
      "data-paint": "text",
    });
    const sub = t("p", "Bank · balance, statement and transfers", {
      class: "view-sub",
      "data-tone": "ink-2",
      "data-paint": "text",
    });

    // Card: points.balance (whole, pinned).
    this.balanceValue = t("p", "", { class: "kpi", "data-paint": "text" });
    this.balanceTier = t("p", "", { class: "small", "data-tone": "ink-2", "data-paint": "text" });
    const balanceCard = h(
      "article",
      {
        class: "card whole",
        "data-card": "balance",
        "aria-labelledby": "card-balance-title",
        "data-paint": "surface",
        "data-surface": "pane",
      },
      h(
        "div",
        { class: "card-head plain" },
        t("h2", "Points balance", { id: "card-balance-title", class: "card-title", "data-paint": "text" }),
      ),
      this.balanceValue,
      this.balanceTier,
    );

    // Card: points.ledger (summary): the header opens the room; the body is the first three items.
    const cardHead = (title: string, id: string, path: string, room: RoomId) =>
      routeLink(
        ctx,
        h(
          "a",
          { class: "card-head", "aria-labelledby": `${id} ${id}-open`, "data-room-link": room },
          t("h2", title, { id, class: "card-title", "data-paint": "text" }),
          t("span", "Open ›", {
            id: `${id}-open`,
            class: "card-open",
            "data-tone": "accent",
            "data-paint": "text",
          }),
        ),
        path,
      );
    const stmtLink = cardHead(
      `Statement · ${fmt(d.lines.length)} lines`,
      "card-statement-title",
      "/points/statement",
      "statement",
    );
    this.preview = h("ul", { class: "preview", "aria-label": "Latest lines" });
    const statementCard = h(
      "article",
      { class: "card summary", "data-card": "statement", "data-paint": "surface", "data-surface": "pane" },
      stmtLink,
      this.preview,
    );

    // Card: points.transfer (entry).
    const trLink = cardHead("Transfer points", "card-transfer-title", "/points/transfer", "transfer");
    this.transferStatus = t("p", "", { class: "small", "data-tone": "ink-2", "data-paint": "text" });
    const transferCard = h(
      "article",
      { class: "card entry", "data-card": "transfer", "data-paint": "surface", "data-surface": "pane" },
      trLink,
      this.transferStatus,
    );
    this.cardLinks = { statement: stmtLink, transfer: trLink };

    this.lobby = h(
      "div",
      { class: "lobby", role: "region", "aria-labelledby": "bank-title" },
      h("div", { class: "view-head" }, this.h1, sub),
      balanceCard,
      statementCard,
      transferCard,
    );
    this.root = h(
      "section",
      { class: "view bank", "data-view": "bank", "aria-labelledby": "bank-title" },
      this.lobby,
      this.statement.root,
      this.transfer.root,
    );
    this.update();
  }

  update(): void {
    const d = this.ctx.data;
    const balance = d.me?.balance ?? d.summary?.balance ?? d.lines[0]?.balance_after ?? null;
    setText(this.balanceValue, balance === null ? "—" : `${fmt(balance)} points`);
    const tier = d.me?.tier;
    setText(
      this.balanceTier,
      tier
        ? `${cap(tier.tier)}${tier.next_tier ? ` · ${Math.round(tier.progress * 100)} % of the way to ${cap(tier.next_tier)}` : ""}`
        : "",
    );
    clear(this.preview);
    for (const l of d.lines.slice(0, 3)) {
      const c = cellTexts(l);
      const tone = l.amount >= 0 ? "credit" : "debit";
      this.preview.append(
        h(
          "li",
          { class: "preview-item" },
          h(
            "span",
            { class: "l1" },
            t("span", c[3], { class: "primary", "data-paint": "text" }),
            t("span", c[4], { class: `trail mono ${tone}`, "data-tone": tone, "data-paint": "text" }),
          ),
          h(
            "span",
            { class: "l2" },
            t("span", `${c[1]} · ${c[2]}`, {
              class: "secondary",
              "data-tone": "ink-2",
              "data-paint": "text",
            }),
            t("span", c[5], { class: "trail-sub mono", "data-tone": "ink-2", "data-paint": "text" }),
          ),
        ),
      );
    }
    if (d.lines.length === 0) this.preview.append(h("li", { class: "small" }, "No lines yet."));
    const s = d.summary;
    setText(
      this.transferStatus,
      s
        ? `You can send ${fmt(Math.max(0, Math.min(s.balance, s.transfer_remaining_today)))} more today`
        : "Send points to a colleague",
    );
  }

  /** Show the lobby alone (null) or a room. At medium and wider the CSS shows both side by side. */
  show(room: RoomId | null): void {
    this.room = room;
    this.root.setAttribute("data-room", room ?? "none");
    this.statement.root.hidden = false;
    this.transfer.root.hidden = false;
    this.statement.root.toggleAttribute("data-active", room === "statement" || room === null);
    this.transfer.root.toggleAttribute("data-active", room === "transfer");
    for (const [id, a] of Object.entries(this.cardLinks)) {
      if (id === room) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    if (room === "statement" || room === null) this.statement.mount();
    else this.statement.unmount();
  }

  /** The element that takes focus after arriving: the room's heading, or the lobby's h1. */
  heading(): HTMLElement {
    if (this.room === "statement") return this.statement.heading;
    if (this.room === "transfer") return this.transfer.heading;
    return this.h1;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
