// A configuration form generated from a widget's config JSON Schema (draft 7, as served by the widget catalogue).
// Enums become selects, booleans switches, arrays of enums checkbox groups, numbers number fields, strings text
// fields; a value that may be a route binding gets a "Bind to route parameter" switch; anything structured (a
// query, a visual) is edited as JSON. Field names are JSON pointers so server errors land on their field.
import { h } from "../../ds/js/dom.js";
import {
  checkboxField,
  numberField,
  selectField,
  switchField,
  textArea,
  textField,
} from "../../ds/js/field.js";
import { checkSchema } from "../../core/schema-check.js";

const PARAM = /^[a-z][a-z_]{0,31}$/;

const deref = (schema, root) => {
  let s = schema;
  for (let i = 0; i < 6 && s && s.$ref; i += 1) {
    const name = s.$ref.replace("#/$defs/", "");
    s = {
      ...(root.$defs?.[name] ?? {}),
      ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$ref")),
    };
  }
  return s ?? {};
};

const isBindingSchema = (s, root) => {
  const d = deref(s, root);
  return d.type === "object" && d.properties?.param && d.required?.includes("param");
};

/** Classify one property: { kind, schema, binding? } where kind is enum, string, number, boolean, enumArray, stringArray or json. */
const classify = (propSchema, root) => {
  let s = deref(propSchema, root);
  let binding = false;
  if (Array.isArray(s.anyOf)) {
    const rest = s.anyOf.filter((x) => !isBindingSchema(x, root));
    binding = rest.length !== s.anyOf.length;
    s = rest.length === 1 ? deref(rest[0], root) : { ...s, anyOf: rest };
  }
  if (Array.isArray(s.enum) && (s.type === "string" || s.type === undefined))
    return { kind: "enum", schema: s, binding };
  if (s.type === "string") return { kind: "string", schema: s, binding };
  if (s.type === "integer" || s.type === "number") return { kind: "number", schema: s, binding };
  if (s.type === "boolean") return { kind: "boolean", schema: s, binding };
  if (s.type === "array") {
    const item = deref(s.items ?? {}, root);
    if (Array.isArray(item.enum)) return { kind: "enumArray", schema: s, item, binding };
    if (item.type === "string") return { kind: "stringArray", schema: s, binding };
  }
  return { kind: "json", schema: s, binding };
};

const label = (name) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const isBound = (v) => v && typeof v === "object" && !Array.isArray(v) && typeof v.param === "string";

/**
 * Build the form. Returns `{ el, read() }`. `read()` resolves to `{ config, errors }` where errors are
 * `[{ path, message }]` (JSON pointers like `/limit`) from the field rules and from the catalogue schema.
 */
export const configForm = ({ schema, config, widgetId }) => {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const readers = [];
  const addReader = (name, fn) => {
    fn.propName = name;
    readers.push(fn);
  };
  const kids = [];

  for (const [name, raw] of Object.entries(props)) {
    const { kind, schema: s, binding, item } = classify(raw, schema);
    const value = config[name];
    const bound = isBound(value);
    const fieldName = `/${name}`;
    const req = required.has(name);
    const hint = s.description && s.description.length < 140 ? s.description : undefined;
    const lab = label(name);
    let control;
    let read;
    switch (kind) {
      case "enum": {
        const opts = [
          ...(req ? [] : [{ value: "", label: "Not set" }]),
          ...s.enum.map((v) => ({ value: v, label: String(v) })),
        ];
        control = selectField({
          name: fieldName,
          label: lab,
          value: bound ? "" : (value ?? ""),
          options: opts,
          required: req,
          hint,
        });
        read = (root) => root.querySelector(`[name="${fieldName}"]`).value || undefined;
        break;
      }
      case "string": {
        control = textField({
          name: fieldName,
          label: lab,
          value: bound ? "" : (value ?? ""),
          required: req,
          hint: hint ?? (s.pattern ? `Pattern ${s.pattern}` : undefined),
        });
        read = (root) => root.querySelector(`[name="${fieldName}"]`).value.trim() || undefined;
        break;
      }
      case "number": {
        control = numberField({
          name: fieldName,
          label: lab,
          value: bound ? null : (value ?? null),
          min: s.minimum,
          max: s.maximum,
          step: s.type === "integer" ? 1 : "any",
          required: req,
          hint:
            hint ??
            (s.minimum !== undefined && s.maximum !== undefined ? `${s.minimum} to ${s.maximum}` : undefined),
        });
        read = (root) => {
          const v = root.querySelector(`[name="${fieldName}"]`).value;
          return v === "" ? undefined : Number(v);
        };
        break;
      }
      case "boolean": {
        control = switchField({ name: fieldName, label: lab, value: bound ? false : Boolean(value), hint });
        read = (root) => root.querySelector(`[name="${fieldName}"]`).checked;
        break;
      }
      case "enumArray": {
        const chosen = new Set(Array.isArray(value) ? value.map(String) : []);
        control = checkboxField({
          name: fieldName,
          label: lab,
          required: req,
          hint: hint ?? (s.maxItems ? `Choose up to ${s.maxItems}` : undefined),
          value: [...chosen],
          options: item.enum.map((v) => ({ value: v, label: String(v) })),
        });
        read = (root) => {
          const picked = [...root.querySelectorAll(`[name="${fieldName}"]:checked`)].map((i) => i.value);
          return picked.length ? picked : undefined;
        };
        break;
      }
      case "stringArray": {
        control = textField({
          name: fieldName,
          label: lab,
          value: Array.isArray(value) ? value.join(", ") : "",
          hint: "Separate values with commas.",
        });
        read = (root) => {
          const parts = root
            .querySelector(`[name="${fieldName}"]`)
            .value.split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          return parts.length ? parts : undefined;
        };
        break;
      }
      default: {
        control = textArea({
          name: fieldName,
          label: `${lab} (JSON)`,
          rows: Math.min(14, Math.max(5, JSON.stringify(value ?? {}, null, 2).split("\n").length)),
          value: value === undefined ? "" : JSON.stringify(value, null, 2),
          required: req,
          hint: hint ?? "Edited as JSON and checked against the widget schema.",
        });
        control.querySelector("textarea").classList.add("rp-json");
        read = (root) => {
          const t = root.querySelector(`[name="${fieldName}"]`).value.trim();
          if (!t) return undefined;
          return JSON.parse(t);
        };
      }
    }

    if (binding) {
      const toggle = switchField({
        name: `${fieldName}/bind`,
        label: `Bind ${lab.toLowerCase()} to a route parameter`,
        value: bound,
      });
      const param = textField({
        name: `${fieldName}/param`,
        label: "Route parameter name",
        value: bound ? value.param : "",
        hint: "For example handle on /people/:handle",
      });
      const sync = () => {
        const on = toggle.querySelector("input").checked;
        param.hidden = !on;
        control.hidden = on;
      };
      toggle.querySelector("input").addEventListener("change", sync);
      kids.push(h("div", { class: "rp-bindable" }, control, toggle, param));
      queueMicrotask(sync);
      const inner = read;
      addReader(name, (root) => {
        if (root.querySelector(`[name="${fieldName}/bind"]`).checked) {
          const p = root.querySelector(`[name="${fieldName}/param"]`).value.trim();
          if (!PARAM.test(p))
            throw Object.assign(new Error("Use lowercase letters and underscores, starting with a letter."), {
              path: `${fieldName}/param`,
            });
          return [name, { param: p }];
        }
        return [name, inner(root)];
      });
    } else {
      kids.push(control);
      addReader(name, (root) => [name, read(root)]);
    }
  }

  const el = h(
    "div",
    { class: "rp-form rp-config" },
    ...(kids.length ? kids : [h("p", { class: "u-muted" }, "This widget has no settings.")]),
  );

  return {
    el,
    read() {
      const out = {};
      const errors = [];
      for (const r of readers) {
        let pair;
        try {
          pair = r(el);
        } catch (e) {
          errors.push({
            path: e.path ?? `/${r.propName}`,
            message: e.message?.includes("JSON") ? "This is not valid JSON." : e.message,
          });
          continue;
        }
        const [k, v] = pair;
        if (
          v !== undefined &&
          !(typeof v === "boolean" && v === false && !required.has(k) && config[k] === undefined)
        )
          out[k] = v;
      }
      for (const name of required)
        if (out[name] === undefined) errors.push({ path: `/${name}`, message: "This is required." });
      if (errors.length === 0) {
        for (const e of checkSchema(schema, out)) {
          const top = String(e.path).split("/").filter(Boolean)[0];
          errors.push({ path: top ? `/${top}` : "/", message: e.message });
        }
      }
      void widgetId;
      return { config: out, errors };
    },
  };
};
