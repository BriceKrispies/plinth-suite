// messaging.compose: recipient picker (people and groups), subject, body with @mentions, attachment metadata, send.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button, linkButton } from "../../ds/js/button.js";
import { textField, textArea, formErrors } from "../../ds/js/field.js";
import { pill } from "../../ds/js/pill.js";
import { toErrorInfo } from "../../core/api.js";
import {
  lifecycle,
  recipientPicker,
  attachmentPicker,
  attachMentions,
  charCounter,
  audienceEstimate,
  errorText,
  link,
  plural,
  safeIcon,
} from "../../shell/kit.js";

const DRAFT_KEY = "plinth-compose-draft";

const loadDraft = () => {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
  } catch {
    return null;
  }
};
const saveDraft = (draft) => {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* the draft then lasts for this view only */
  }
};

/** Recipients named by the address bar (`/messages/new?to=user:ana-silva,group:ops`) or route parameters. */
const fromAddress = (ctx) => {
  const raw = ctx.params?.to ?? new URLSearchParams(location.search).get("to");
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((r) => (r.includes(":") ? r : `user:${r}`))
    .filter((r) => /^(user:[a-z][a-z0-9-]+|group:[a-z][a-z0-9.-]+)$/.test(r));
};

export default {
  id: "messaging.compose",
  domain: "messaging",
  title: "Compose",
  configSchema: schemaOf("messaging.compose"),
  sizes: ["m", "l", "xl"],
  mount(el, { config, size, api, bus, rt, ctx }) {
    void rt;
    const life = lifecycle();
    const draft = loadDraft();
    const initialTo = [...new Set([...(config.to ?? []), ...fromAddress(ctx)])];
    // The values the form starts from; kept in step with what the person types so a rebuild loses nothing.
    const vals = {
      to: draft?.to?.length ? draft.to : initialTo,
      subject: draft?.subject ?? config.subject ?? "",
      body: draft?.body ?? "",
    };
    const st = {
      view: "form",
      expanded: !config.collapsed || Boolean(vals.body) || vals.to.length > 0,
      sent: null,
      busy: false,
      key: null,
      cc: false,
    };
    const root = h("div", { class: "w-compose", "data-size": size });
    el.append(root);

    let picker;
    let ccPicker;
    let attach;
    let subjectEl;
    let bodyEl;
    let form;
    let known = new Map();

    const estimateLine = h("p", { class: "w-hint w-estimate", role: "status" });
    const persist = () => {
      if (st.view !== "form" || !bodyEl || !picker) return;
      vals.body = bodyEl.value;
      vals.subject = subjectEl.value;
      vals.to = picker.value();
      saveDraft(vals.body || vals.subject || vals.to.length ? { ...vals } : null);
    };
    const resetVals = () => {
      vals.to = [];
      vals.subject = "";
      vals.body = "";
      saveDraft(null);
    };

    const paintEstimate = () => {
      const to = picker.value();
      const n = audienceEstimate([...to, ...(ccPicker?.value() ?? [])], known);
      estimateLine.textContent = to.length
        ? `Reaches about ${plural(n, "person", "people")}. Groups are expanded when you send.`
        : "";
    };

    const buildForm = () => {
      clear(root);
      st.view = "form";
      if (!st.expanded) {
        root.append(
          h(
            "button",
            {
              type: "button",
              class: "w-compose__prompt",
              onclick: () => {
                st.expanded = true;
                buildForm();
                subjectEl?.focus();
              },
            },
            safeIcon("edit", "plus"),
            h("span", {}, "Write a message to this group"),
          ),
        );
        return;
      }
      picker = recipientPicker({
        api,
        label: "To",
        name: "/to",
        initial: vals.to,
        required: true,
        hint: "Search people and groups. Groups are expanded when you send.",
        onChange: (_v, map) => {
          known = map;
          paintEstimate();
          persist();
        },
      });
      ccPicker = st.cc
        ? recipientPicker({
            api,
            label: "Cc",
            name: "/cc",
            onChange: (_v, map) => {
              known = map;
              paintEstimate();
            },
          })
        : null;
      const subject = textField({
        name: "/subject",
        label: "Subject",
        required: true,
        value: vals.subject,
        placeholder: "What is this about?",
      });
      subjectEl = subject.querySelector("input");
      subjectEl.setAttribute("maxlength", "140");
      const subjectCount = charCounter(140);
      subjectCount.update(subjectEl.value.length);
      subjectEl.addEventListener("input", () => {
        subjectCount.update(subjectEl.value.length);
        persist();
      });
      const body = textArea({
        name: "/body",
        label: "Message",
        required: true,
        rows: size === "m" ? 5 : 8,
        value: vals.body,
        placeholder: "Write your message. Use **bold**, _emphasis_ and @handle to mention someone.",
      });
      bodyEl = body.querySelector("textarea");
      const bodyCount = charCounter(10000);
      bodyCount.update(bodyEl.value.length);
      const mentionPool = new Map();
      const mentions = attachMentions(bodyEl, () => {
        for (const [value, o] of known) {
          if (o.kind === "person" && value.startsWith("user:"))
            mentionPool.set(value, {
              handle: value.slice(5),
              display_name: o.label,
              avatar: o.avatar ?? { initials: "?", hue: 0 },
            });
        }
        return [...mentionPool.values()];
      });
      bodyEl.addEventListener("input", () => {
        bodyCount.update(bodyEl.value.length);
        persist();
      });
      life.add(mentions.destroy);
      attach = attachmentPicker({ max: 10 });
      const status = h("p", { class: "w-hint", role: "status" });
      const send = button({ label: "Send", icon: "send", variant: "primary", type: "submit" });
      const discard = button({
        label: "Discard",
        variant: "ghost",
        onClick: () => {
          resetVals();
          st.cc = false;
          buildForm();
        },
      });
      const ccToggle = button({
        label: st.cc ? "Remove Cc" : "Add Cc",
        variant: "ghost",
        size: "sm",
        onClick: () => {
          persist();
          st.cc = !st.cc;
          buildForm();
        },
      });
      form = h(
        "form",
        { class: "c-form w-compose__form", novalidate: true, "aria-label": "New message" },
        h("p", { class: "c-form__note w-hint" }, "Fields marked * are required"),
        picker.el,
        h("div", { class: "w-compose__cc" }, ccToggle),
        ccPicker ? ccPicker.el : null,
        estimateLine,
        subject,
        subjectCount,
        h("div", { class: "w-mention-host" }, body, mentions.list),
        bodyCount,
        attach.el,
        h("div", { class: "w-compose__foot" }, status, discard, send),
      );
      paintEstimate();
      form.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          form.requestSubmit();
        }
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (st.busy) return;
        formErrors(null, { form });
        status.textContent = "";
        status.classList.remove("w-hint--error");
        const to = picker.value();
        const subjectText = subjectEl.value.trim();
        const bodyText = bodyEl.value.trim();
        const problems = [];
        if (to.length === 0) problems.push({ path: "/to", message: "Choose at least one recipient" });
        else if (to.length > 50)
          problems.push({ path: "/to", message: "You can address up to 50 recipients" });
        if (!subjectText) problems.push({ path: "/subject", message: "Add a subject" });
        if (!bodyText) problems.push({ path: "/body", message: "Write a message" });
        const closed = to.filter((r) => known.get(r)?.allowed === false);
        if (closed.length)
          problems.push({ path: "/to", message: `${known.get(closed[0]).label} is not open to you` });
        if (problems.length) {
          const first = problems[0];
          formErrors({ code: "VALIDATION_FAILED", ...first }, { form });
          // Show the remaining problems on their own fields as well.
          for (const p of problems.slice(1)) {
            const field = form.querySelector(`[name="${p.path}"]`)?.closest(".c-field");
            if (field && !field.classList.contains("c-field--invalid")) {
              field.classList.add("c-field--invalid");
              field.append(h("p", { class: "c-field__error" }, p.message));
            }
          }
          (form.querySelector(".c-form-errors") ?? form).focus?.();
          return;
        }
        st.busy = true;
        send.setAttribute("aria-busy", "true");
        st.key ??= api.idempotencyKey("send");
        const input = {
          to,
          subject: subjectText,
          body: bodyText,
          idempotency_key: st.key,
        };
        const cc = ccPicker?.value() ?? [];
        if (cc.length) input.cc = cc;
        if (attach.get().length) input.attachments = attach.get();
        try {
          const out = await api.call("messages.send", input);
          if (life.dead) return;
          resetVals();
          st.key = null;
          st.sent = out;
          st.sent.subject = subjectText;
          bus.publish("thread.selected", { id: out.thread_id });
          ctx.announce(`Message sent to ${plural(out.recipient_count, "person", "people")}`);
          buildSent();
        } catch (err) {
          const info = toErrorInfo(err);
          if (info.path) formErrors({ ...info, message: errorText(err) }, { form });
          else {
            status.textContent = errorText(err);
            status.classList.add("w-hint--error");
          }
        } finally {
          st.busy = false;
          send.removeAttribute("aria-busy");
        }
      });
      root.append(form);
    };

    const buildSent = () => {
      clear(root);
      st.view = "sent";
      const out = st.sent;
      const heading = h("h3", { class: "w-compose__done-title", tabindex: "-1" }, "Message sent");
      root.append(
        h(
          "div",
          { class: "w-compose__done" },
          h("span", { class: "w-compose__done-icon" }, safeIcon("check-circle", "check", { size: 24 })),
          heading,
          h("p", {}, `“${out.subject}” went to ${plural(out.recipient_count, "person", "people")}.`),
          out.replayed ? pill({ label: "Already sent", tone: "info" }) : null,
          h(
            "div",
            { class: "w-compose__done-actions" },
            linkButton({
              href: link(`/messages/t/${out.thread_id}`),
              label: "Open conversation",
              icon: "inbox",
              variant: "primary",
            }),
            button({
              label: "Write another",
              icon: "plus",
              onClick: () => {
                resetVals();
                st.cc = false;
                st.sent = null;
                st.expanded = true;
                buildForm();
                subjectEl?.focus();
              },
            }),
          ),
        ),
      );
      heading.focus();
    };

    // A person selected elsewhere on the page becomes a recipient.
    life.add(
      bus.subscribe("member.selected", (payload) => {
        if (!payload?.id || st.view !== "form") return;
        if (!st.expanded) {
          st.expanded = true;
          buildForm();
        }
        if (picker.add(`user:${payload.id}`)) ctx.announce(`Added @${payload.id} as a recipient`);
      }),
    );

    buildForm();
    ctx.setState("ready");
    return () => {
      persist();
      life.dispose();
    };
  },
};
