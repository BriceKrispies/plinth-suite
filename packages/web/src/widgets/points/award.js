// points.award: a manager awards points to one or many members with a category and a reason. Shows promotion
// multipliers on the receipt and the approval hold when the award is above the manager limit.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { points, number } from "../../ds/js/format.js";
import { button, linkButton, iconButton } from "../../ds/js/button.js";
import { numberField, selectField, textArea } from "../../ds/js/field.js";
import { combobox } from "../../ds/js/combobox.js";
import { personChip } from "../../ds/js/avatar.js";
import { pill } from "../../ds/js/pill.js";
import { dataTable } from "../../ds/js/table.js";
import { icon } from "../../ds/js/icons.js";
import { emptyState } from "../../ds/js/states.js";
import { disposer, myHandle, peopleSearch, showFormError, withBusy, kv, dl, messageOf } from "./_kit.js";

const CATEGORIES = [
  { value: "recognition", label: "Recognition" },
  { value: "performance", label: "Performance" },
  { value: "milestone", label: "Milestone" },
  { value: "service", label: "Service" },
  { value: "other", label: "Other" },
];
const PRESETS = [50, 100, 250, 500];
const MAX_RECIPIENTS = 50;
const FIELD_FOR = { LIMIT_EXCEEDED: "/points", SELF_ACTION: "/to", MEMBER_DISABLED: "/to" };

export default {
  id: "points.award",
  domain: "points",
  title: "Award points",
  configSchema: schemaOf("points.award"),
  sizes: ["m", "l"],
  mount(el, { config, size, api, bus, nav, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-points w-points-award w-points-award--${size}` });
    el.append(root);

    if (!ctx.can("points:award")) {
      root.append(
        emptyState({
          icon: "lock",
          title: "Awarding is for managers",
          body: "Your role does not include awarding points.",
        }),
      );
      return () => {};
    }

    const state = {
      step: "form",
      recipients: [], // { handle, label, card }
      points: null,
      category: "recognition",
      reason: "",
      key: null,
      result: null,
      recipientError: null,
      pending: null,
    };

    const has = (handle) => state.recipients.some((r) => r.handle === handle);
    const addRecipient = (handle, label, card) => {
      if (!handle || handle === myHandle() || has(handle)) return false;
      if (state.recipients.length >= MAX_RECIPIENTS) {
        ctx.toast({
          title: "Recipient limit reached",
          body: `An award can go to at most ${MAX_RECIPIENTS} members.`,
          tone: "warning",
        });
        return false;
      }
      state.recipients.push({ handle, label: label ?? handle, card: card ?? null });
      state.recipientError = null;
      return true;
    };

    const resolveHandle = async (handle) => {
      if (!addRecipient(handle, handle, null)) return;
      if (state.step === "form") render();
      try {
        const res = await api.call("people.directory", { q: handle, limit: 5 });
        const hit = res.items.find((m) => m.person.handle === handle);
        if (life.done || !hit) return;
        const r = state.recipients.find((x) => x.handle === handle);
        if (r) {
          r.label = hit.person.display_name;
          r.card = hit;
          if (state.step === "form") render();
        }
      } catch {
        /* the handle alone identifies the member */
      }
    };

    // ---- form ----
    const recipientsBlock = () => {
      const block = h("div", { class: "w-points-award__recipients" });
      const draw = () => {
        clear(block);
        const picker = combobox({
          label: "Recipients",
          name: "/to",
          required: true,
          placeholder: "Search by name to add",
          hint: `Up to ${MAX_RECIPIENTS} members. You cannot award yourself.`,
          error: state.recipientError ?? undefined,
          search: peopleSearch(api, {
            exclude: [myHandle(), ...state.recipients.map((r) => r.handle)].filter(Boolean),
          }),
          onChange: (opt) => {
            if (!opt) return;
            if (addRecipient(opt.value, opt.label, opt.card)) {
              draw();
              block.querySelector("input")?.focus();
              ctx.announce(`${opt.label} added, ${state.recipients.length} selected`);
            }
          },
        });
        const list = h(
          "ul",
          { class: "w-points-award__chips", "aria-label": `Selected recipients, ${state.recipients.length}` },
          ...state.recipients.map((r) =>
            h(
              "li",
              {},
              r.card ? personChip(r.card.person) : h("span", {}, `${r.label} (@${r.handle})`),
              iconButton({
                icon: "x",
                label: `Remove ${r.label}`,
                size: "sm",
                onClick: () => {
                  state.recipients = state.recipients.filter((x) => x.handle !== r.handle);
                  draw();
                  block.querySelector("input")?.focus();
                  ctx.announce(`${r.label} removed, ${state.recipients.length} selected`);
                },
              }),
            ),
          ),
        );
        block.append(list, picker);
      };
      draw();
      return block;
    };

    const validate = () => {
      if (state.recipients.length === 0) return { path: "/to", message: "Add at least one recipient" };
      if (!Number.isInteger(state.points) || state.points < 1)
        return { path: "/points", message: "Enter a whole number of points, at least 1" };
      const reason = state.reason.trim();
      if (!reason) return { path: "/reason", message: "Say why the points are awarded" };
      if (reason.length > 280) return { path: "/reason", message: "Use at most 280 characters" };
      return null;
    };

    const renderForm = () => {
      const pending = state.pending;
      state.pending = null;
      const pendingPath = pending ? (pending.path ?? FIELD_FOR[pending.details?.reason] ?? null) : null;
      if (pendingPath === "/to") state.recipientError = messageOf(pending);
      const form = h("form", { class: "w-kit-form", novalidate: true });
      const pointsField = numberField({
        name: "/points",
        label: "Points per recipient",
        required: true,
        min: 1,
        step: 1,
        value: state.points ?? undefined,
        hint: "Awards above your per-award limit are held for approval. Promotion multipliers apply when posted.",
        onInput: (v) => (state.points = v),
      });
      const presets = h(
        "div",
        { class: "w-points-transfer__chips", role: "group", "aria-label": "Quick amounts" },
        ...PRESETS.map((n) =>
          button({
            label: number(n),
            variant: "secondary",
            size: "sm",
            onClick: () => {
              state.points = n;
              const input = form.querySelector('[name="/points"]');
              input.value = String(n);
              input.focus();
            },
          }),
        ),
      );
      const reasonField = textArea({
        name: "/reason",
        label: "Reason",
        required: true,
        rows: size === "m" ? 3 : 4,
        value: state.reason,
        hint: "Shown to the recipients and kept in the audit trail (up to 280 characters).",
        onInput: (v) => {
          state.reason = v;
          counter.textContent = `${v.length} / 280`;
        },
      });
      const counter = h(
        "span",
        { class: "w-points-award__counter u-muted u-tabular", "aria-hidden": "true" },
        `${state.reason.length} / 280`,
      );
      const submit = button({
        label: "Review award",
        type: "submit",
        variant: "primary",
        icon: "chevron-right",
      });
      form.append(
        h("p", { class: "u-muted w-kit-small" }, "Fields marked * are required"),
        recipientsBlock(),
        h("div", { class: "w-points-transfer__amount" }, pointsField, presets),
        selectField({
          name: "/category",
          label: "Category",
          value: state.category,
          options: CATEGORIES,
          onChange: (v) => (state.category = v),
        }),
        h("div", { class: "w-points-award__reason" }, reasonField, counter),
        h("div", { class: "w-kit-actions" }, submit),
      );
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const bad = validate();
        if (bad) {
          if (bad.path === "/to") {
            state.recipientError = bad.message;
            render();
            queueMicrotask(() => root.querySelector('[name="/to"]')?.focus());
            return;
          }
          showFormError(form, { code: "VALIDATION_FAILED", path: bad.path, message: bad.message });
          return;
        }
        state.key = api.idempotencyKey("award");
        state.step = "confirm";
        render();
      });
      if (pending && pendingPath === "/to") queueMicrotask(() => root.querySelector('[name="/to"]')?.focus());
      else if (pending) queueMicrotask(() => showFormError(form, pending, FIELD_FOR));
      return form;
    };

    // ---- confirm ----
    const renderConfirm = () => {
      const n = state.recipients.length;
      const total = n * state.points;
      const send = button({ label: `Award ${points(total)}`, variant: "primary", icon: "award" });
      send.addEventListener("click", async () => {
        await withBusy(send, async () => {
          try {
            const res = await api.call("points.award", {
              to: state.recipients.map((r) => r.handle),
              points: state.points,
              category: state.category,
              reason: state.reason.trim(),
              idempotency_key: state.key,
            });
            if (life.done) return;
            state.result = res;
            state.step = "done";
            ctx.announce(res.status === "pending_approval" ? "Award sent for approval" : "Points awarded");
            render();
          } catch (e) {
            if (life.done) return;
            state.pending = e;
            state.step = "form";
            render();
            ctx.toast({ title: "Award not made", body: messageOf(e), tone: "danger" });
          }
        });
      });
      return h(
        "div",
        { class: "w-points-award__confirm" },
        h("p", { class: "u-caps" }, "Check before awarding"),
        dl([
          kv("Recipients", `${n} ${n === 1 ? "member" : "members"}`),
          kv("Per recipient", points(state.points)),
          kv("Total from issuance", h("strong", { class: "u-tabular" }, points(total))),
          kv("Category", CATEGORIES.find((c) => c.value === state.category)?.label ?? state.category),
          kv("Reason", state.reason.trim()),
        ]),
        dataTable({
          caption: "Recipients",
          density: "compact",
          rows: state.recipients,
          rowKey: "handle",
          columns: [
            {
              key: "label",
              label: "Member",
              render: (r) => (r.card ? personChip(r.card.person) : `${r.label} (@${r.handle})`),
            },
            { key: "pts", label: "Points", align: "end", render: () => points(state.points) },
          ],
        }),
        h(
          "p",
          { class: "u-muted w-kit-small" },
          "Active promotions may add a bonus to each award. You will see it on the receipt. Awards above your limit are filed for approval instead of posting.",
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
    };

    // ---- done ----
    const renderDone = () => {
      const r = state.result;
      const held = r.status === "pending_approval";
      const names = new Map(state.recipients.map((x) => [x.handle, x]));
      return h(
        "div",
        { class: "w-points-award__done" },
        held
          ? h(
              "p",
              { class: "w-kit-note w-kit-note--warning", role: "status" },
              icon("clock", { size: 20 }),
              " This award is above your limit, so it is held for approval. Nothing has been posted yet.",
            )
          : h(
              "p",
              { class: "w-kit-note w-kit-note--success", role: "status" },
              icon("check-circle", { size: 20 }),
              ` Awarded to ${r.results.length} ${r.results.length === 1 ? "member" : "members"}`,
            ),
        held && r.approval_id
          ? dl([kv("Approval", h("code", { class: "w-kit-code" }, r.approval_id))])
          : null,
        r.replayed
          ? h(
              "p",
              { class: "u-muted w-kit-small" },
              "This award had already been made; nothing was posted twice.",
            )
          : null,
        dataTable({
          caption: held ? "Recipients awaiting approval" : "Receipt",
          density: "compact",
          rows: r.results,
          rowKey: "member",
          columns: [
            {
              key: "member",
              label: "Member",
              render: (x) =>
                names.get(x.member)?.card
                  ? personChip(names.get(x.member).card.person)
                  : (names.get(x.member)?.label ?? x.member),
            },
            { key: "base_points", label: "Base", align: "end", render: (x) => points(x.base_points) },
            {
              key: "bonus_points",
              label: "Bonus",
              align: "end",
              render: (x) => (x.bonus_points ? `+${points(x.bonus_points)}` : "–"),
            },
            {
              key: "promotions",
              label: "Promotions",
              render: (x) =>
                x.promotions.length
                  ? h(
                      "span",
                      { class: "w-kit-pills" },
                      ...x.promotions.map((p) => pill({ label: p, tone: "signal", icon: "percent" })),
                    )
                  : "–",
            },
          ],
        }),
        h(
          "div",
          { class: "w-kit-actions" },
          button({
            label: "Award more",
            variant: "primary",
            icon: "plus",
            onClick: () => {
              state.step = "form";
              state.recipients = [];
              state.points = null;
              state.reason = "";
              state.result = null;
              state.key = null;
              render();
            },
          }),
          held
            ? linkButton({ href: nav.href("/approvals"), label: "Open approvals", variant: "secondary" })
            : null,
        ),
      );
    };

    function render() {
      clear(root);
      const order = ["form", "confirm", "done"];
      root.append(
        h(
          "ol",
          { class: "w-kit-steps", "aria-label": "Award steps" },
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
        ),
      );
      const body =
        state.step === "form" ? renderForm() : state.step === "confirm" ? renderConfirm() : renderDone();
      root.append(body);
      if (state.step !== "form") queueMicrotask(() => body.querySelector("button")?.focus());
    }

    life.add(
      bus.subscribe("member.selected", (p) => {
        if (state.step === "done") {
          state.step = "form";
          state.recipients = [];
          state.points = null;
          state.reason = "";
        }
        if (p?.id) resolveHandle(p.id);
      }),
    );
    for (const handle of config.to ?? []) addRecipient(handle, handle, null);
    render();
    for (const handle of config.to ?? []) {
      api
        .call("people.directory", { q: handle, limit: 5 })
        .then((res) => {
          const hit = res.items.find((m) => m.person.handle === handle);
          const r = state.recipients.find((x) => x.handle === handle);
          if (life.done || !hit || !r) return;
          r.label = hit.person.display_name;
          r.card = hit;
          if (state.step === "form") render();
        })
        .catch(() => {});
    }
    const latest = bus.latest?.("member.selected");
    if (latest?.id) resolveHandle(latest.id);
    return life.dispose;
  },
};
