// points.transfer: recipient, amount within limits, memo, a confirm step with the balance after, then a receipt.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number } from "../../ds/js/format.js";
import { button, linkButton } from "../../ds/js/button.js";
import { numberField, textField } from "../../ds/js/field.js";
import { combobox } from "../../ds/js/combobox.js";
import { personChip } from "../../ds/js/avatar.js";
import { skeleton, emptyState } from "../../ds/js/states.js";
import { icon } from "../../ds/js/icons.js";
import {
  disposer,
  myHandle,
  peopleSearch,
  showFormError,
  withBusy,
  reportLoadError,
  kv,
  dl,
  messageOf,
} from "./_kit.js";

const QUICK = [50, 100, 250, 500];
const FIELD_FOR = {
  INSUFFICIENT_POINTS: "/points",
  LIMIT_EXCEEDED: "/points",
  SELF_ACTION: "/to",
  MEMBER_DISABLED: "/to",
};

export default {
  id: "points.transfer",
  domain: "points",
  title: "Transfer points",
  configSchema: schemaOf("points.transfer"),
  sizes: ["m", "l"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-transfer w-points-transfer--${size}` });
    el.append(root);

    if (!ctx.me?.member) {
      root.append(
        emptyState({
          icon: "transfer",
          title: "Transfers need a member account",
          body: "Agents and services cannot send points.",
        }),
      );
      return () => {};
    }

    const state = {
      step: "form", // form | confirm | done
      recipient: null, // { handle, label, card }
      amount: null,
      memo: "",
      key: null,
      summary: null,
      result: null,
      formError: null,
      recipientError: null,
    };
    let limitsEl = null;

    const maxAmount = () =>
      state.summary
        ? Math.max(0, Math.min(state.summary.balance, state.summary.transfer_remaining_today))
        : null;

    const loadSummary = async ({ initial = false } = {}) => {
      try {
        const s = await api.call("points.summary", {});
        if (life.done) return;
        state.summary = s;
        if (initial) {
          ctx.setState("ready");
          render();
        } else paintLimits();
      } catch (e) {
        if (life.done) return;
        if (initial)
          reportLoadError({
            ctx,
            host: root,
            error: e,
            retry: () => loadSummary({ initial: true }),
            initial: true,
          });
      }
    };

    const paintLimits = () => {
      if (!limitsEl || !state.summary) return;
      const s = state.summary;
      clear(limitsEl);
      limitsEl.append(
        h("span", {}, "Your balance ", h("strong", { class: "u-tabular" }, points(s.balance))),
        h("span", { class: "u-muted" }, ` · you can send ${points(maxAmount())} more today`),
      );
    };

    const setRecipient = (handle, label, card) => {
      state.recipient = handle ? { handle, label: label ?? handle, card } : null;
      state.recipientError = null;
    };

    const resolveHandle = async (handle) => {
      setRecipient(handle, handle, null);
      try {
        const res = await api.call("people.directory", { q: handle, limit: 5 });
        const hit = res.items.find((m) => m.person.handle === handle);
        if (life.done || !hit) return;
        setRecipient(handle, hit.person.display_name, hit);
        if (state.step === "form") render();
      } catch {
        /* the handle alone is enough to send */
      }
    };

    // ---- form ----
    const validate = () => {
      const max = maxAmount();
      if (!state.recipient) return { path: "/to", message: "Choose who receives the points" };
      if (state.recipient.handle === myHandle())
        return { path: "/to", message: "You cannot send points to yourself" };
      if (!Number.isInteger(state.amount) || state.amount < 1)
        return { path: "/points", message: "Enter a whole number of points, at least 1" };
      if (max !== null && state.amount > state.summary.balance)
        return { path: "/points", message: `You only have ${points(state.summary.balance)}` };
      if (max !== null && state.amount > state.summary.transfer_remaining_today)
        return {
          path: "/points",
          message: `Only ${points(state.summary.transfer_remaining_today)} can still be sent today`,
        };
      const memo = state.memo.trim();
      if (!memo) return { path: "/memo", message: "Add a short memo" };
      if (memo.length > 200) return { path: "/memo", message: "Use at most 200 characters" };
      return null;
    };

    const renderForm = () => {
      const pending = state.formError;
      state.formError = null;
      const pendingPath = pending
        ? (pending.raw.path ?? FIELD_FOR[pending.raw.details?.reason] ?? null)
        : null;
      if (pendingPath === "/to") state.recipientError = messageOf(pending.raw);
      const form = h("form", { class: "w-kit-form", novalidate: true });
      limitsEl = h("p", { class: "w-points-transfer__limits", role: "status" });
      const people = combobox({
        label: "Recipient",
        name: "/to",
        required: true,
        value: state.recipient ? { value: state.recipient.handle, label: state.recipient.label } : undefined,
        placeholder: "Search by name",
        error: state.recipientError ?? undefined,
        search: peopleSearch(api, { exclude: [myHandle()].filter(Boolean) }),
        onChange: (opt) => {
          state.recipientError = null;
          state.recipient = opt ? { handle: opt.value, label: opt.label, card: opt.card } : null;
        },
      });
      const amountField = numberField({
        name: "/points",
        label: "Amount",
        required: true,
        min: 1,
        step: 1,
        value: state.amount ?? undefined,
        hint: "Whole points. Transfers keep the original expiry of the points sent.",
        onInput: (v) => (state.amount = v),
      });
      const chips = h(
        "div",
        { class: "w-points-transfer__chips", role: "group", "aria-label": "Quick amounts" },
        ...QUICK.map((n) =>
          button({
            label: number(n),
            variant: "secondary",
            size: "sm",
            onClick: () => {
              const max = maxAmount();
              const v = max === null ? n : Math.min(n, max);
              state.amount = v;
              const input = form.querySelector('[name="/points"]');
              input.value = String(v);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.focus();
            },
          }),
        ),
        button({
          label: "Max",
          variant: "ghost",
          size: "sm",
          onClick: () => {
            const max = maxAmount();
            if (!max) return;
            state.amount = max;
            const input = form.querySelector('[name="/points"]');
            input.value = String(max);
            input.focus();
          },
        }),
      );
      const memoField = textField({
        name: "/memo",
        label: "Memo",
        required: true,
        value: state.memo,
        placeholder: "What is this for?",
        hint: "Up to 200 characters. The recipient sees it.",
        onInput: (v) => (state.memo = v),
      });
      const submit = button({
        label: "Review transfer",
        type: "submit",
        variant: "primary",
        icon: "chevron-right",
      });
      form.append(
        h("p", { class: "u-muted w-kit-small" }, "Fields marked * are required"),
        limitsEl,
        people,
        h("div", { class: "w-points-transfer__amount" }, amountField, chips),
        memoField,
        h("div", { class: "w-kit-actions" }, submit),
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const bad = validate();
        if (bad) {
          if (bad.path === "/to") {
            state.recipientError = bad.message;
            render();
            root.querySelector('[name="/to"]')?.focus();
            return;
          }
          showFormError(form, { code: "VALIDATION_FAILED", path: bad.path, message: bad.message });
          return;
        }
        state.key = api.idempotencyKey("transfer");
        state.step = "confirm";
        render();
      });
      paintLimits();
      if (pending && pendingPath === "/to") queueMicrotask(() => root.querySelector('[name="/to"]')?.focus());
      else if (pending) queueMicrotask(() => showFormError(form, pending.raw, FIELD_FOR));
      return form;
    };

    // ---- confirm ----
    const renderConfirm = () => {
      const s = state.summary;
      const after = s.balance - state.amount;
      const left = s.transfer_remaining_today - state.amount;
      const box = h("div", { class: "w-points-transfer__confirm" });
      const send = button({ label: `Send ${points(state.amount)}`, variant: "primary", icon: "transfer" });
      send.addEventListener("click", async () => {
        await withBusy(send, async () => {
          try {
            const res = await api.call("points.transfer", {
              to: state.recipient.handle,
              points: state.amount,
              memo: state.memo.trim(),
              idempotency_key: state.key,
            });
            if (life.done) return;
            state.result = res;
            state.step = "done";
            if (state.summary) state.summary = { ...state.summary, balance: res.balance };
            ctx.announce(`Sent ${points(state.amount)} to ${state.recipient.label}`);
            render();
          } catch (e) {
            if (life.done) return;
            // The key belongs to this intent; a refused or failed attempt starts a new intent when edited.
            state.formError = { raw: e };
            state.step = "form";
            render();
            ctx.toast({ title: "Transfer not sent", body: messageOf(e), tone: "danger" });
          }
        });
      });
      box.append(
        h("p", { class: "u-caps" }, "Check before sending"),
        dl([
          kv(
            "To",
            state.recipient.card
              ? personChip(state.recipient.card.person)
              : `${state.recipient.label} (@${state.recipient.handle})`,
          ),
          kv("Amount", h("strong", { class: "u-tabular" }, points(state.amount))),
          kv("Memo", state.memo.trim()),
          kv("Balance now", points(s.balance)),
          kv("Balance after", h("strong", { class: "u-tabular" }, points(after))),
          kv("Still sendable today", points(Math.max(0, left))),
        ]),
        ...[
          after < 0
            ? h(
                "p",
                { class: "w-kit-note w-kit-note--danger" },
                icon("alert", { size: 16 }),
                " This is more than your balance.",
              )
            : null,
        ].filter(Boolean),
        h(
          "p",
          { class: "u-muted w-kit-small" },
          "Transfers cannot be undone by you. Finance can reverse a mistaken transfer.",
        ),
        h(
          "div",
          { class: "w-kit-actions" },
          button({
            label: "Back",
            variant: "secondary",
            icon: "chevron-left",
            onClick: () => {
              state.step = "form";
              render();
            },
          }),
          send,
        ),
      );
      return box;
    };

    // ---- done ----
    const renderDone = () => {
      const r = state.result;
      return h(
        "div",
        { class: "w-points-transfer__done" },
        h(
          "p",
          { class: "w-kit-note w-kit-note--success", role: "status" },
          icon("check-circle", { size: 20 }),
          ` Sent ${points(state.amount)} to ${state.recipient.label}`,
        ),
        dl(
          [
            kv("Transaction", `#${number(r.txn_no)}`),
            kv("Your balance now", h("strong", { class: "u-tabular" }, points(r.balance))),
            kv("Memo", state.memo.trim()),
            r.replayed ? kv("Note", "This was already sent; nothing was charged twice.") : null,
          ].filter(Boolean),
        ),
        h(
          "div",
          { class: "w-kit-actions" },
          button({
            label: "Send another",
            variant: "primary",
            icon: "plus",
            onClick: () => {
              state.step = "form";
              state.recipient = null;
              state.amount = null;
              state.memo = "";
              state.result = null;
              state.key = null;
              render();
              loadSummary();
            },
          }),
          linkButton({ href: nav.href("/points"), label: "View statement", variant: "secondary" }),
        ),
      );
    };

    function render() {
      clear(root);
      limitsEl = null;
      const order = ["form", "confirm", "done"];
      const steps = h(
        "ol",
        { class: "w-kit-steps", "aria-label": "Transfer steps" },
        ...["Details", "Confirm", "Done"].map((label, i) =>
          h(
            "li",
            {
              "aria-current": order[i] === state.step ? "step" : null,
              class: i < order.indexOf(state.step) ? "is-done" : "",
            },
            label,
          ),
        ),
      );
      root.append(steps);
      const body =
        state.step === "form" ? renderForm() : state.step === "confirm" ? renderConfirm() : renderDone();
      root.append(body);
      if (state.step !== "form") queueMicrotask(() => body.querySelector("button")?.focus());
    }

    root.append(skeleton({ lines: 4 }));
    life.add(
      rt.on("points.posted", (ev) => {
        const p = ev.payload;
        if (!p.member || p.member !== myHandle()) return;
        if (state.summary) {
          state.summary = { ...state.summary, balance: p.balance };
          paintLimits();
        }
        loadSummary();
      }),
    );
    life.add(
      bus.subscribe("member.selected", (p) => {
        const handle = p?.id;
        if (!handle || handle === myHandle() || state.step === "done") return;
        state.step = "form";
        resolveHandle(handle);
        render();
      }),
    );
    if (typeof config.to === "string" && config.to) resolveHandle(config.to);
    const latest = bus.latest?.("member.selected");
    if (!state.recipient && latest?.id && latest.id !== myHandle()) resolveHandle(latest.id);
    loadSummary({ initial: true });
    return life.dispose;
  },
};
