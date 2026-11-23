// notifications.send: an ad-hoc notice to people and groups, with a live preview and a confirmation for wide sends.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { textField, textArea, selectField, formErrors } from "../../ds/js/field.js";
import { toErrorInfo } from "../../core/api.js";
import { clockStore } from "../../core/stores.js";
import {
  lifecycle,
  recipientPicker,
  charCounter,
  audienceEstimate,
  errorText,
  notificationRow,
  plural,
  safeIcon,
  typeInfo,
} from "../../shell/kit.js";

const TYPES = [
  { value: "system", label: "System notice" },
  { value: "automation_alert", label: "Automation alert" },
  { value: "promotion_started", label: "Promotion started" },
];
const ROUTE = /^\/[A-Za-z0-9/_.:?=&%-]*$/;

export default {
  id: "notifications.send",
  domain: "notifications",
  title: "Send a notice",
  configSchema: schemaOf("notifications.send"),
  sizes: ["m", "l"],
  mount(el, { size, api, ctx }) {
    const life = lifecycle();
    const root = h("div", { class: "w-send", "data-size": size });
    el.append(root);
    const st = { key: null, busy: false, type: "system", result: null };
    const vals = { title: "", body: "", link: "" };
    let picker;
    let known = new Map();
    let form;

    const previewHost = h("div", { class: "w-send__preview", "aria-label": "Preview" });
    const estimate = h("p", { class: "w-hint", role: "status" });

    const paintPreview = () => {
      clear(previewHost);
      const note = {
        type: st.type,
        title: vals.title || "Your title appears here",
        body: vals.body || "Your message appears here.",
        link: vals.link || null,
        actor: ctx.me?.principal ?? null,
        created_at: clockStore.get().virtual_now,
        read_at: null,
      };
      previewHost.append(
        h("p", { class: "w-send__previewlabel" }, "Preview in a member's feed"),
        h(
          "div",
          { class: "w-send__previewrow" },
          notificationRow(note, { now: clockStore.get().virtual_now }),
        ),
        h(
          "p",
          { class: "w-hint" },
          `Shown as “${typeInfo(st.type).label}”. Each person's own preferences decide whether it appears in the app, by email or in a digest.`,
        ),
      );
    };
    const paintEstimate = () => {
      const to = picker.value();
      const n = audienceEstimate(to, known);
      estimate.textContent = to.length
        ? `Reaches about ${plural(n, "person", "people")} before preferences are applied.`
        : "";
    };

    const build = () => {
      clear(root);
      st.result = null;
      picker = recipientPicker({
        api,
        label: "To",
        name: "/to",
        required: true,
        hint: "People and groups. Groups are expanded when you send.",
        onChange: (_v, map) => {
          known = map;
          paintEstimate();
        },
      });
      const type = selectField({
        name: "/type",
        label: "Type",
        value: st.type,
        options: TYPES,
        onChange: (v) => {
          st.type = v;
          paintPreview();
        },
      });
      const title = textField({
        name: "/title",
        label: "Title",
        required: true,
        value: vals.title,
        placeholder: "A short headline",
      });
      const titleEl = title.querySelector("input");
      titleEl.setAttribute("maxlength", "140");
      const titleCount = charCounter(140);
      titleCount.update(vals.title.length);
      titleEl.addEventListener("input", () => {
        vals.title = titleEl.value;
        titleCount.update(vals.title.length);
        paintPreview();
      });
      const body = textArea({
        name: "/body",
        label: "Message",
        rows: 4,
        value: vals.body,
        placeholder: "What should people know?",
      });
      const bodyEl = body.querySelector("textarea");
      const bodyCount = charCounter(500);
      bodyCount.update(vals.body.length);
      bodyEl.addEventListener("input", () => {
        vals.body = bodyEl.value;
        bodyCount.update(vals.body.length);
        paintPreview();
      });
      const linkField = textField({
        name: "/link",
        label: "Link (optional)",
        value: vals.link,
        placeholder: "/store or /people/ana-silva",
        hint: "An address inside the app, starting with a slash.",
      });
      const linkEl = linkField.querySelector("input");
      linkEl.addEventListener("input", () => {
        vals.link = linkEl.value.trim();
        paintPreview();
      });
      const status = h("p", { class: "w-hint", role: "status" });
      const send = button({ label: "Send notice", icon: "send", variant: "primary", type: "submit" });
      const reset = button({
        label: "Clear",
        variant: "ghost",
        onClick: () => {
          vals.title = vals.body = vals.link = "";
          st.type = "system";
          st.key = null;
          build();
        },
      });
      form = h(
        "form",
        { class: "c-form w-send__form", novalidate: true, "aria-label": "Send a notice" },
        h("p", { class: "w-hint" }, "Fields marked * are required"),
        picker.el,
        estimate,
        type,
        title,
        titleCount,
        body,
        bodyCount,
        linkField,
        h("div", { class: "w-send__foot" }, status, reset, send),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (st.busy) return;
        formErrors(null, { form });
        status.textContent = "";
        status.classList.remove("w-hint--error");
        const to = picker.value();
        const problems = [];
        if (to.length === 0) problems.push({ path: "/to", message: "Choose at least one recipient" });
        if (!vals.title.trim()) problems.push({ path: "/title", message: "Add a title" });
        if (vals.body.length > 500)
          problems.push({ path: "/body", message: "The message can be up to 500 characters" });
        if (vals.link && !ROUTE.test(vals.link))
          problems.push({ path: "/link", message: "Use an address inside the app, such as /store" });
        if (problems.length) {
          formErrors({ code: "VALIDATION_FAILED", ...problems[0] }, { form });
          for (const p of problems.slice(1)) {
            const field = form.querySelector(`[name="${p.path}"]`)?.closest(".c-field");
            if (field) {
              field.classList.add("c-field--invalid");
              field.append(h("p", { class: "c-field__error" }, p.message));
            }
          }
          form.querySelector(".c-form-errors")?.focus();
          return;
        }
        const n = audienceEstimate(to, known);
        const wide = to.some((r) => r.startsWith("group:")) || n >= 10;
        if (wide) {
          const ok = await ctx.confirm({
            title: "Send this notice?",
            message: `It will reach about ${plural(n, "person", "people")}. This cannot be recalled.`,
            confirmLabel: "Send notice",
          });
          if (!ok || life.dead) return;
        }
        st.busy = true;
        send.setAttribute("aria-busy", "true");
        st.key ??= api.idempotencyKey("notify");
        const input = {
          to,
          type: st.type,
          title: vals.title.trim(),
          body: vals.body,
          idempotency_key: st.key,
        };
        if (vals.link) input.link = vals.link;
        try {
          const out = await api.call("notifications.send", input);
          if (life.dead) return;
          st.key = null;
          showResult(out, input);
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
      root.append(
        size === "l"
          ? h("div", { class: "w-send__split" }, form, previewHost)
          : h(
              "div",
              { class: "w-send__stack" },
              form,
              h("details", { class: "w-send__details" }, h("summary", {}, "Preview"), previewHost),
            ),
      );
      paintPreview();
      paintEstimate();
    };

    const showResult = (out, input) => {
      clear(root);
      const heading = h(
        "h3",
        { class: "w-send__done-title", tabindex: "-1" },
        out.replayed ? "Already sent" : "Notice sent",
      );
      ctx.announce(`Notice sent to ${plural(out.recipients, "person", "people")}`);
      root.append(
        h(
          "div",
          { class: "w-send__done" },
          h("span", { class: "w-send__done-icon" }, safeIcon("check-circle", "check", { size: 24 })),
          heading,
          h("p", {}, `“${input.title}” reached ${plural(out.recipients, "person", "people")}.`),
          out.suppressed
            ? h(
                "p",
                { class: "w-hint" },
                `${plural(out.suppressed, "person", "people")} did not get it because of their preferences or quiet hours.`,
              )
            : null,
          button({
            label: "Send another",
            icon: "plus",
            onClick: () => {
              vals.title = vals.body = vals.link = "";
              build();
            },
          }),
        ),
      );
      heading.focus();
    };

    build();
    ctx.setState("ready");
    return () => life.dispose();
  },
};
