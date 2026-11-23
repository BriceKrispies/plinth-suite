// Form fields (DESIGN-SYSTEM 6.2). `name` is a JSON pointer into the request body (9.3).
import { h, uid } from "./dom.js";
import { icon } from "./icons.js";
import { iconButton } from "./button.js";

const describe = (ids) => ids.filter(Boolean).join(" ") || null;

const hintNode = (id, hint) => (hint ? h("p", { class: "c-field__hint", id }, hint) : null);

const errorNode = (id, error) =>
  error
    ? h(
        "p",
        { class: "c-field__error", id },
        h("span", { class: "c-field__error-icon", "aria-hidden": "true" }, icon("alert", { size: 16 })),
        error,
      )
    : null;

const labelNode = (label, id, required) =>
  h(
    "label",
    { class: "c-field__label", for: id },
    label,
    required ? h("span", { class: "c-field__req", "aria-hidden": "true" }, " *") : null,
  );

/** Apply an error message to a field root; clears when the control changes. */
const showError = (root, message) => {
  const control = root.querySelector("[name]") ?? root.querySelector(".c-combobox__input");
  root.querySelector(".c-field__error")?.remove();
  root.classList.add("c-field--invalid");
  const base = root.dataset.fid;
  const err = errorNode(`${base}-err`, message);
  root.append(err);
  if (control) {
    control.setAttribute("aria-invalid", "true");
    const ids = new Set((control.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
    ids.add(`${base}-err`);
    control.setAttribute("aria-describedby", [...ids].join(" "));
    const clear = () => {
      root.classList.remove("c-field--invalid");
      control.removeAttribute("aria-invalid");
      err.remove();
      control.removeEventListener("input", clear);
    };
    control.addEventListener("input", clear);
  }
};

/** Shared frame for single-control fields. */
const single = (o, makeControl, { after } = {}) => {
  const id = uid("f");
  const hid = `${id}-hint`;
  const eid = `${id}-err`;
  const control = makeControl(id);
  control.classList.add("c-field__control");
  control.setAttribute("name", o.name ?? "");
  if (o.required) control.setAttribute("required", "");
  if (o.disabled) control.setAttribute("disabled", "");
  if (o.error) control.setAttribute("aria-invalid", "true");
  const d = describe([o.hint ? hid : null, o.error ? eid : null]);
  if (d) control.setAttribute("aria-describedby", d);
  return h(
    "div",
    { class: `c-field${o.error ? " c-field--invalid" : ""}`, "data-fid": id },
    labelNode(o.label, id, o.required),
    after ? h("div", { class: "c-field__wrap" }, control, after(control)) : control,
    hintNode(hid, o.hint),
    errorNode(eid, o.error),
  );
};

const wire = (input, o, read = (el) => el.value) => {
  if (o.onInput) input.addEventListener("input", () => o.onInput(read(input)));
  if (o.onChange) input.addEventListener("change", () => o.onChange(read(input)));
  return input;
};

const inputField = (type) => (o) =>
  single(o, (id) =>
    wire(
      h("input", {
        id,
        type,
        value: o.value ?? null,
        placeholder: o.placeholder,
        min: o.min,
        max: o.max,
        step: o.step,
      }),
      o,
    ),
  );

export const textField = inputField("text");
export const numberField = (o) =>
  single(o, (id) =>
    wire(
      h("input", {
        id,
        type: "number",
        value: o.value ?? null,
        placeholder: o.placeholder,
        min: o.min,
        max: o.max,
        step: o.step,
        inputmode: "decimal",
      }),
      o,
      (el) => (el.value === "" ? null : Number(el.value)),
    ),
  );
export const dateTimeField = (o) =>
  single(o, (id) =>
    wire(
      h("input", {
        id,
        type: "datetime-local",
        value: o.value ?? null,
        min: o.min,
        max: o.max,
        step: o.step,
      }),
      o,
    ),
  );

export const textArea = (o) =>
  single(o, (id) => {
    const ta = h("textarea", { id, rows: o.rows ?? 4, placeholder: o.placeholder });
    ta.value = o.value ?? "";
    return wire(ta, o);
  });

export const selectField = (o) =>
  single(o, (id) => {
    const sel = h(
      "select",
      { id },
      ...(o.options ?? []).map((opt) =>
        h(
          "option",
          { value: opt.value, selected: String(opt.value) === String(o.value) ? true : null },
          opt.label,
        ),
      ),
    );
    return wire(sel, o);
  });

export const searchField = (o) =>
  single(
    o,
    (id) => {
      const input = h("input", { id, type: "search", value: o.value ?? null, placeholder: o.placeholder });
      return wire(input, o);
    },
    {
      after: (input) => {
        const clearBtn = iconButton({
          icon: "x",
          label: "Clear search",
          size: "sm",
          onClick: () => {
            input.value = "";
            clearBtn.hidden = true;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.focus();
          },
        });
        clearBtn.classList.add("c-field__clear");
        clearBtn.hidden = !input.value;
        input.addEventListener("input", () => {
          clearBtn.hidden = !input.value;
        });
        return clearBtn;
      },
    },
  );

const group = (o, type) => {
  const id = uid("f");
  const eid = `${id}-err`;
  const hid = `${id}-hint`;
  const selected = new Set([].concat(o.value ?? []).map(String));
  const items = (o.options ?? []).map((opt) => {
    const cid = uid("f");
    const input = h("input", {
      id: cid,
      type,
      name: type === "radio" ? o.name : null,
      value: opt.value,
      checked: selected.has(String(opt.value)) ? true : null,
      disabled: o.disabled ? true : null,
    });
    return h("div", { class: "c-field__choice" }, input, h("label", { for: cid }, opt.label));
  });
  const read = (root) => {
    const picked = [...root.querySelectorAll("input:checked")].map((i) => i.value);
    return type === "radio" ? (picked[0] ?? null) : picked;
  };
  const root = h(
    "fieldset",
    {
      class: `c-field c-field--group${o.error ? " c-field--invalid" : ""}`,
      "data-fid": id,
      "aria-describedby": describe([o.hint ? hid : null, o.error ? eid : null]),
      "aria-invalid": o.error ? "true" : null,
    },
    h(
      "legend",
      { class: "c-field__label" },
      o.label,
      o.required ? h("span", { class: "c-field__req", "aria-hidden": "true" }, " *") : null,
    ),
    h("div", { class: "c-field__choices" }, ...items),
    hintNode(hid, o.hint),
    errorNode(eid, o.error),
  );
  if (type === "checkbox")
    for (const box of root.querySelectorAll("input")) box.setAttribute("name", o.name ?? "");
  if (o.onChange) root.addEventListener("change", () => o.onChange(read(root)));
  if (o.onInput) root.addEventListener("input", () => o.onInput(read(root)));
  return root;
};

export const radioGroup = (o) => group(o, "radio");

export const checkboxField = (o) => {
  if (o.options) return group(o, "checkbox");
  const id = uid("f");
  const hid = `${id}-hint`;
  const eid = `${id}-err`;
  const input = h("input", {
    id,
    type: "checkbox",
    name: o.name ?? "",
    checked: o.value ? true : null,
    disabled: o.disabled ? true : null,
    required: o.required ? true : null,
    "aria-invalid": o.error ? "true" : null,
    "aria-describedby": describe([o.hint ? hid : null, o.error ? eid : null]),
  });
  wire(input, o, (el) => el.checked);
  return h(
    "div",
    { class: `c-field c-field--check${o.error ? " c-field--invalid" : ""}`, "data-fid": id },
    h("div", { class: "c-field__choice" }, input, h("label", { for: id }, o.label)),
    hintNode(hid, o.hint),
    errorNode(eid, o.error),
  );
};

export const switchField = (o) => {
  const id = uid("f");
  const hid = `${id}-hint`;
  const eid = `${id}-err`;
  const state = h("span", { class: "c-switch__state", "aria-hidden": "true" }, o.value ? "On" : "Off");
  const input = h("input", {
    id,
    type: "checkbox",
    role: "switch",
    class: "c-switch__input",
    name: o.name ?? "",
    checked: o.value ? true : null,
    disabled: o.disabled ? true : null,
    "aria-invalid": o.error ? "true" : null,
    "aria-describedby": describe([o.hint ? hid : null, o.error ? eid : null]),
  });
  input.addEventListener("change", () => {
    state.textContent = input.checked ? "On" : "Off";
  });
  wire(input, o, (el) => el.checked);
  return h(
    "div",
    { class: `c-field c-field--switch${o.error ? " c-field--invalid" : ""}`, "data-fid": id },
    h(
      "div",
      { class: "c-switch" },
      input,
      h("span", { class: "c-switch__track", "aria-hidden": "true" }, h("span", { class: "c-switch__thumb" })),
      h("label", { class: "c-field__label", for: id }, o.label),
      state,
    ),
    hintNode(hid, o.hint),
    errorNode(eid, o.error),
  );
};

export const fieldset = ({ legend, children }) =>
  h(
    "fieldset",
    { class: "c-fieldset" },
    h("legend", { class: "c-fieldset__legend" }, legend),
    ...[].concat(children ?? []),
  );

/**
 * Summary of an API error body ({ code, path, message }). With `form`, the field whose name equals
 * `path` also shows the error. Null clears every field error in the form and returns null.
 */
export const formErrors = (errorBody, { form } = {}) => {
  if (form) {
    for (const root of form.querySelectorAll(".c-field--invalid")) {
      root.classList.remove("c-field--invalid");
      root.querySelector(".c-field__error")?.remove();
      root.querySelector("[aria-invalid]")?.removeAttribute("aria-invalid");
    }
    form.querySelector(".c-form-errors")?.remove();
  }
  if (!errorBody) return null;
  const path = errorBody.path ?? null;
  let target = null;
  if (form && path) {
    for (const el of form.querySelectorAll("[name]")) {
      if (el.getAttribute("name") === path) {
        target = el.closest(".c-field");
        break;
      }
    }
  }
  if (target) showError(target, errorBody.message);
  const link = target
    ? h("a", { href: `#${target.querySelector("[id]")?.id ?? ""}` }, errorBody.message)
    : null;
  const summary = h(
    "div",
    { class: "c-form-errors", role: "alert", tabindex: "-1" },
    h("p", { class: "c-form-errors__title" }, icon("alert", { size: 16 }), "Check the form"),
    h("ul", {}, h("li", {}, link ?? errorBody.message)),
  );
  if (form) form.prepend(summary);
  return summary;
};
