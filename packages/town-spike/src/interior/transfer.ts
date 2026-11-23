// The Transfer room (points.transfer; spec 02 section 2.3 "Forms"): a page pushed inside the room, never a modal.
// Fields are stacked native inputs with visible labels, hints and errors; the primary action ("Review transfer",
// then "Send N points") lives in the room's dock, in the thumb zone, and rides directly above the on-screen keyboard.
// "Send" posts the real transfer; the measurement script never presses it.

import { h, t, clear, setText } from "../plat/dom";
import { idempotencyKey, sendTransfer, type MemberCard, type PointsSummary, ApiError } from "./api";
import { fmt } from "../format";

export interface TransferCallbacks {
  readonly onDirty: () => void;
  readonly announce: (msg: string) => void;
  readonly back: () => void;
  readonly me: string;
  readonly siblingHref: string;
  readonly onSibling: (e: MouseEvent) => void;
  readonly onSent: (balance: number) => void;
}

export class TransferRoom {
  readonly root: HTMLElement;
  readonly heading: HTMLElement;
  readonly dock: HTMLElement;
  private readonly body: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private readonly secondary: HTMLButtonElement;
  step: "form" | "confirm" | "done" = "form";
  private recipient = "";
  private amount = "";
  private memo = "";
  private key = "";
  private error: { field: string; message: string } | null = null;

  constructor(
    private summary: PointsSummary | null,
    private people: MemberCard[],
    private readonly cb: TransferCallbacks,
  ) {
    this.heading = t("h2", "Transfer points", {
      id: "transfer-title",
      class: "room-title",
      tabindex: -1,
      "data-paint": "text",
    });
    const sibling = h(
      "a",
      { class: "sibling", href: cb.siblingHref, "aria-label": "Previous pane: Statement" },
      "‹ Statement",
    );
    sibling.addEventListener("click", cb.onSibling);
    this.body = h("div", { class: "form-host" });
    const back = h(
      "button",
      { type: "button", class: "dock-btn back", "aria-label": "Back to the Bank lobby" },
      "‹ Back",
    );
    back.addEventListener("click", () => cb.back());
    this.secondary = h("button", { type: "button", class: "dock-btn" }, "Edit");
    this.secondary.addEventListener("click", () => this.onSecondary());
    this.primary = h(
      "button",
      { type: "submit", class: "dock-btn primary", form: "transfer-form" },
      "Review transfer",
    );
    this.primary.addEventListener("click", (e) => {
      if (this.step === "form") return; // submits the form
      e.preventDefault();
      if (this.step === "confirm") void this.send();
      else this.reset();
    });
    this.dock = h(
      "div",
      { class: "dock room-dock form-dock", role: "toolbar", "aria-label": "Transfer actions" },
      back,
      h("span", { class: "grow" }),
      this.secondary,
      this.primary,
    );
    this.root = h(
      "section",
      {
        class: "room",
        "data-room": "transfer",
        "aria-labelledby": "transfer-title",
        "data-paint": "surface",
        "data-surface": "pane",
      },
      h("div", { class: "room-strip" }, sibling, h("span", { class: "grow" })),
      this.heading,
      this.body,
      this.dock,
    );
    this.render();
  }

  /** The people directory arrives after the first paint; refresh the recipient suggestions (not the typing). */
  setPeople(people: MemberCard[]): void {
    this.people = people;
    const list = this.root.querySelector("#people-list");
    if (!list) return;
    clear(list);
    for (const p of people)
      if (p.person.handle && p.person.handle !== this.cb.me)
        list.append(h("option", { value: p.person.handle }, p.person.display_name));
  }

  setSummary(s: PointsSummary | null): void {
    this.summary = s;
    if (this.step === "form") this.render();
  }

  private nameOf(handle: string): string {
    const m = this.people.find((p) => p.person.handle === handle);
    return m ? m.person.display_name : handle;
  }

  private render(): void {
    clear(this.body);
    if (this.step === "form") this.body.append(this.renderForm());
    else if (this.step === "confirm") this.body.append(this.renderConfirm());
    else this.body.append(this.renderDone());
    const n = Number(this.amount);
    setText(
      this.primary,
      this.step === "form"
        ? "Review transfer"
        : this.step === "confirm"
          ? `Send ${fmt(n)} points`
          : "Send another",
    );
    this.primary.type = this.step === "form" ? "submit" : "button";
    this.secondary.hidden = this.step !== "confirm";
    this.root.setAttribute("data-transfer-step", this.step); // not data-step: the confirm body carries that
    this.cb.onDirty();
  }

  private renderForm(): HTMLElement {
    const s = this.summary;
    const limits = t(
      "p",
      s
        ? `Your balance ${fmt(s.balance)} · you can send ${fmt(Math.max(0, Math.min(s.balance, s.transfer_remaining_today)))} more today`
        : "Your balance is loading",
      { class: "small", role: "status", "data-tone": "ink-2", "data-paint": "text" },
    );
    const datalist = h(
      "datalist",
      { id: "people-list" },
      ...this.people
        .filter((p) => p.person.handle && p.person.handle !== this.cb.me)
        .map((p) => h("option", { value: p.person.handle ?? "" }, p.person.display_name)),
    );
    const field = (id: string, label: string, input: HTMLInputElement, hint: string | null): HTMLElement => {
      const err = this.error && this.error.field === id ? this.error.message : null;
      if (err) input.setAttribute("aria-invalid", "true");
      const describedBy = [hint ? `${id}-hint` : null, err ? `${id}-err` : null].filter(Boolean).join(" ");
      if (describedBy) input.setAttribute("aria-describedby", describedBy);
      return h(
        "div",
        { class: "field" },
        t("label", label, { for: id, "data-paint": "text" }),
        input,
        hint
          ? t("p", hint, { id: `${id}-hint`, class: "small", "data-tone": "ink-2", "data-paint": "text" })
          : null,
        err
          ? t("p", `✕ ${err}`, {
              id: `${id}-err`,
              class: "error",
              role: "alert",
              "data-tone": "debit",
              "data-paint": "text",
            })
          : null,
      );
    };
    const input = (
      attrs: Record<string, string | number | boolean>,
      set: (v: string) => void,
      value: string,
    ) => {
      const el = h("input", { class: "kit-input", "data-paint": "field", ...attrs });
      el.value = value;
      el.addEventListener("input", () => set(el.value));
      return el;
    };
    const to = input(
      {
        id: "tr-to",
        name: "to",
        list: "people-list",
        autocomplete: "off",
        placeholder: "Handle, e.g. jonas-becker",
        required: true,
        enterkeyhint: "next",
      },
      (v) => (this.recipient = v),
      this.recipient,
    );
    const amt = input(
      {
        id: "tr-amount",
        name: "points",
        type: "number",
        inputmode: "numeric",
        min: 1,
        step: 1,
        required: true,
        enterkeyhint: "next",
      },
      (v) => (this.amount = v),
      this.amount,
    );
    const memo = input(
      {
        id: "tr-memo",
        name: "memo",
        type: "text",
        maxlength: 200,
        required: true,
        placeholder: "What is this for?",
        enterkeyhint: "done",
      },
      (v) => (this.memo = v),
      this.memo,
    );
    const form = h(
      "form",
      { id: "transfer-form", class: "form", novalidate: true, "aria-labelledby": "transfer-title" },
      limits,
      field("tr-to", "Recipient", to, null),
      field(
        "tr-amount",
        "Amount",
        amt,
        "Whole points. Transfers keep the original expiry of the points sent.",
      ),
      field("tr-memo", "Memo", memo, "Up to 200 characters. The recipient sees it."),
      datalist,
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const bad = this.validate();
      this.error = bad;
      if (bad) {
        this.render();
        document.getElementById(bad.field)?.focus();
        this.cb.announce(`1 error. ${bad.message}`);
        return;
      }
      this.key = idempotencyKey("transfer");
      this.step = "confirm";
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.render();
      this.heading.focus();
      this.cb.announce("Check the transfer before sending.");
    });
    return form;
  }

  private validate(): { field: string; message: string } | null {
    const r = this.recipient.trim();
    if (!r) return { field: "tr-to", message: "Choose who receives the points" };
    if (r === this.cb.me) return { field: "tr-to", message: "You cannot send points to yourself" };
    const n = Number(this.amount);
    if (!Number.isInteger(n) || n < 1)
      return { field: "tr-amount", message: "Enter a whole number of points, at least 1" };
    if (this.summary && n > this.summary.balance)
      return { field: "tr-amount", message: `You only have ${fmt(this.summary.balance)}` };
    if (!this.memo.trim()) return { field: "tr-memo", message: "Add a short memo" };
    return null;
  }

  private renderConfirm(): HTMLElement {
    const n = Number(this.amount);
    const after = this.summary ? this.summary.balance - n : null;
    const kv = (k: string, v: string) =>
      h(
        "div",
        { class: "kv" },
        t("span", k, { class: "k", "data-tone": "ink-2", "data-paint": "text" }),
        t("span", v, { class: "v", "data-paint": "text" }),
      );
    return h(
      "div",
      { class: "form", "data-step": "confirm" },
      t("p", "CHECK BEFORE SENDING", { class: "caps", "data-paint": "text" }),
      kv("To", `${this.nameOf(this.recipient.trim())} (@${this.recipient.trim()})`),
      kv("Amount", `${fmt(n)} points`),
      kv("Memo", this.memo.trim()),
      after !== null ? kv("Balance after", fmt(after)) : null,
      t("p", "Transfers cannot be undone by you. Finance can reverse a mistaken transfer.", {
        class: "small",
        "data-tone": "ink-2",
        "data-paint": "text",
      }),
    );
  }

  private renderDone(): HTMLElement {
    return h(
      "div",
      { class: "form" },
      t("p", `Sent ${fmt(Number(this.amount))} points to ${this.nameOf(this.recipient.trim())}`, {
        class: "prose",
        role: "status",
        "data-tone": "credit",
        "data-paint": "text",
      }),
    );
  }

  private onSecondary(): void {
    if (this.step !== "confirm") return;
    this.step = "form";
    this.render();
    document.getElementById("tr-to")?.focus();
  }

  private reset(): void {
    this.step = "form";
    this.recipient = "";
    this.amount = "";
    this.memo = "";
    this.render();
    document.getElementById("tr-to")?.focus();
  }

  /** True when a field holds typed input that has not been sent (the live swap waits for it, 06 section 6.7.4). */
  get dirty(): boolean {
    return this.step !== "done" && Boolean(this.recipient || this.amount || this.memo);
  }

  private async send(): Promise<void> {
    try {
      const res = await sendTransfer({
        to: this.recipient.trim(),
        points: Number(this.amount),
        memo: this.memo.trim(),
        idempotency_key: this.key,
      });
      if (this.summary) this.summary = { ...this.summary, balance: res.balance };
      this.cb.onSent(res.balance);
      this.step = "done";
      this.cb.announce(`Sent ${fmt(Number(this.amount))} points to ${this.nameOf(this.recipient.trim())}`);
    } catch (e) {
      this.step = "form";
      this.error = {
        field: e instanceof ApiError && e.path === "/to" ? "tr-to" : "tr-amount",
        message: e instanceof Error ? e.message : String(e),
      };
    }
    this.render();
  }
}
