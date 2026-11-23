// tasks.quick-add: a short form for a new task (title, assignee, due, priority, optional link). One idempotency
// key per intent, server errors mapped to fields by their JSON pointer, the form kept intact on failure.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { combobox } from "../../ds/js/combobox.js";
import { dateTimeField, formErrors, selectField, textArea, textField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { localInputToIso, toErrorInfo } from "../reporting/_common.js";
import { priorityOptions } from "./_task.js";

const LINK_KINDS = [
  "order",
  "content",
  "promotion",
  "automation",
  "automation_run",
  "member",
  "approval",
  "product",
  "thread",
];
const HREF = /^\/[A-Za-z0-9/_.:?=&%-]*$/;

export default {
  id: "tasks.quick-add",
  domain: "tasks",
  title: "New task",
  configSchema: schemaOf("tasks.quick-add"),
  sizes: catalogEntry("tasks.quick-add")?.sizes ?? [],
  mount(el, { size, api, bus, ctx }) {
    const compact = size === "s";
    const canAssign = ctx.can("tasks:manage");
    const form = h("form", { class: "rp-form rp-quick", "aria-label": "New task", novalidate: true });
    el.append(form);
    let key = api.idempotencyKey("tk");
    let alive = true;
    let assignee = null;
    let busy = false;

    const search = async (q) => {
      try {
        const out = await api.call("people.directory", { q: q || undefined, limit: 8 });
        return out.items.map((m) => ({
          value: m.person.subject,
          label: m.person.display_name,
          description: m.title,
          avatar: m.person.avatar,
        }));
      } catch {
        return [];
      }
    };

    const build = (values = {}) => {
      const title = textField({
        name: "/title",
        label: "Title",
        value: values.title ?? "",
        required: true,
        placeholder: "What needs doing?",
      });
      const parts = [h("p", { class: "rp-form__note" }, "Fields marked * are required."), title];
      const extras = [];
      if (canAssign)
        extras.push(
          combobox({
            label: "Assignee",
            name: "/assignee",
            search,
            value: assignee ? { value: assignee.value, label: assignee.label } : undefined,
            placeholder: "Me",
            hint: "Leave empty to assign it to yourself.",
            onChange: (v) => (assignee = v),
          }),
        );
      extras.push(
        h(
          "div",
          { class: "rp-form__row" },
          selectField({
            name: "/priority",
            label: "Priority",
            value: values.priority ?? "normal",
            options: priorityOptions,
          }),
          dateTimeField({ name: "/due_at", label: "Due", value: values.due ?? "" }),
        ),
        textArea({ name: "/description", label: "Description", value: values.description ?? "", rows: 3 }),
        h(
          "details",
          { class: "rp-disclosure" },
          h("summary", {}, "Link to something"),
          h(
            "div",
            { class: "rp-form__row" },
            selectField({
              name: "/link/kind",
              label: "Kind",
              value: values.linkKind ?? "order",
              options: LINK_KINDS.map((k) => ({ value: k, label: k.replace("_", " ") })),
            }),
            textField({
              name: "/link/ref",
              label: "Reference",
              value: values.linkRef ?? "",
              placeholder: "R-000123",
            }),
          ),
          h(
            "div",
            { class: "rp-form__row" },
            textField({ name: "/link/label", label: "Label", value: values.linkLabel ?? "" }),
            textField({
              name: "/link/href",
              label: "Path",
              value: values.linkHref ?? "",
              placeholder: "/store/orders/...",
              hint: "An app path starting with /",
            }),
          ),
        ),
      );
      if (compact)
        parts.push(h("details", { class: "rp-disclosure" }, h("summary", {}, "More options"), ...extras));
      else parts.push(...extras);
      parts.push(
        h(
          "div",
          { class: "rp-form__actions" },
          button({ label: "Clear", variant: "ghost", onClick: () => reset() }),
          button({ label: "Add task", icon: "plus", variant: "primary", type: "submit" }),
        ),
      );
      form.replaceChildren(...parts);
    };

    const read = () => {
      const val = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
      return {
        title: val("/title").trim(),
        description: val("/description").trim(),
        priority: val("/priority") || "normal",
        due: val("/due_at"),
        linkKind: val("/link/kind"),
        linkRef: val("/link/ref").trim(),
        linkLabel: val("/link/label").trim(),
        linkHref: val("/link/href").trim(),
      };
    };

    const reset = () => {
      assignee = null;
      key = api.idempotencyKey("tk");
      build();
      form.querySelector('[name="/title"]')?.focus();
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      formErrors(null, { form });
      const v = read();
      if (!v.title) {
        formErrors(
          { code: "VALIDATION_FAILED", path: "/title", message: "Enter a title for the task." },
          { form },
        );
        form.querySelector('[name="/title"]')?.focus();
        return;
      }
      const link = v.linkHref || v.linkRef || v.linkLabel;
      if (link && !HREF.test(v.linkHref)) {
        formErrors(
          {
            code: "VALIDATION_FAILED",
            path: "/link/href",
            message: "A link needs a path that starts with /, for example /store/orders/abc.",
          },
          { form },
        );
        return;
      }
      if (link && (!v.linkRef || !v.linkLabel)) {
        formErrors(
          {
            code: "VALIDATION_FAILED",
            path: v.linkRef ? "/link/label" : "/link/ref",
            message: "A link needs a reference, a label and a path.",
          },
          { form },
        );
        return;
      }
      const body = {
        title: v.title,
        description: v.description || undefined,
        priority: v.priority,
        due_at: localInputToIso(v.due) ?? undefined,
        assignee: canAssign && assignee ? assignee.value : undefined,
        link: link ? { kind: v.linkKind, ref: v.linkRef, label: v.linkLabel, href: v.linkHref } : undefined,
        idempotency_key: key,
      };
      busy = true;
      const submit = form.querySelector('button[type="submit"]');
      submit?.setAttribute("aria-busy", "true");
      try {
        const task = await api.call("tasks.create", body);
        if (!alive) return;
        ctx.toast({
          title: `Task #${task.task_no} created`,
          body: task.title,
          tone: "success",
          action: { label: "Show", onClick: () => bus.publish("task.selected", { id: task.task_id }) },
        });
        ctx.announce(`Task ${task.task_no} created`);
        bus.publish("task.selected", { id: task.task_id });
        reset();
      } catch (err) {
        const info = toErrorInfo(err);
        submit?.removeAttribute("aria-busy");
        const summary = formErrors(
          { code: info.code, path: info.path, message: info.message ?? info.code },
          { form },
        );
        summary?.focus();
      } finally {
        busy = false;
        submit?.removeAttribute("aria-busy");
      }
    });

    build();
    return () => {
      alive = false;
    };
  },
};
