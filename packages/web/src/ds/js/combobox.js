// APG Combobox, list autocomplete. DESIGN-SYSTEM 6.3 and 6.29.
// `<p-combobox>` is a form-associated custom element in light DOM: the visible input, chips and listbox are the
// same markup the helper always drew, and the element itself owns the form value, validity, reset and state restore.
import { h, uid, clear } from "./dom.js";
import { icon } from "./icons.js";
import { avatar } from "./avatar.js";
import { anchorSupported } from "./popover.js";
import { PElement, define, reflect } from "./element-base.js";

const plain = (list) => list.map(({ value, label }) => ({ value, label }));

export class PCombobox extends PElement {
  static formAssociated = true;
  static observedAttributes = [
    "label",
    "name",
    "multiple",
    "placeholder",
    "hint",
    "error",
    "required",
    "disabled",
    "max",
  ];

  /** `async (query) => [{ value, label, description?, avatar?, icon?, group? }]` */
  search = null;
  /** Called with the selection (an array when `multiple`, else the option or null) after every user change. */
  onChange = null;
  _id = uid("cb");
  _selected = [];
  _initial = null;
  _input = null;
  _touched = false;
  _formDisabled = false;
  _custom = "";
  _dispose = null;

  // ---- form association ----
  get form() {
    return this.internals?.form ?? null;
  }
  get labels() {
    return this.internals?.labels ?? [];
  }
  get type() {
    return this.localName;
  }
  get validity() {
    return this.internals?.validity;
  }
  get validationMessage() {
    return this.internals?.validationMessage ?? "";
  }
  get willValidate() {
    return this.internals?.willValidate ?? false;
  }
  checkValidity() {
    return this.internals?.checkValidity() ?? true;
  }
  reportValidity() {
    this._touched = true;
    this._syncState();
    return this.internals?.reportValidity() ?? true;
  }
  setCustomValidity(message) {
    this._custom = String(message ?? "");
    this._syncForm();
  }
  formResetCallback() {
    this._selected = (this._initial ?? []).slice();
    this._touched = false;
    this.requestRender();
  }
  formDisabledCallback(disabled) {
    this._formDisabled = disabled;
    if (this._input) this._input.disabled = this._isDisabled();
  }
  formStateRestoreCallback(state) {
    try {
      const list = JSON.parse(String(state));
      if (Array.isArray(list)) {
        this._selected = list.filter((o) => o && "value" in o);
        this.requestRender();
      }
    } catch {
      /* an unreadable state leaves the selection alone */
    }
  }

  // ---- value ----
  /** The selection: an array when `multiple`, else the chosen option or null. */
  get selection() {
    return this.multiple ? this._selected.slice() : (this._selected[0] ?? null);
  }
  set selection(v) {
    this._selected = v ? (Array.isArray(v) ? [...v] : [v]) : [];
    if (this._initial === null && !this.rendered) this._initial = this._selected.slice();
    this.requestRender();
  }
  /** The form value: the chosen option's value ("" for none; the first one when `multiple`). */
  get value() {
    return this._selected[0]?.value ?? "";
  }
  /** Every chosen value. */
  get values() {
    return this._selected.map((s) => s.value);
  }

  focus(options) {
    if (this._input) this._input.focus(options);
    else super.focus(options);
  }

  _isDisabled() {
    return this.hasAttribute("disabled") || this._formDisabled;
  }

  _runSearch(q) {
    return this.search?.(q);
  }

  _notify() {
    this.onChange?.(this.selection);
  }

  _commit() {
    this._touched = true;
    this._syncForm();
    const detail = { value: this.value, selection: this.selection };
    this.dispatchEvent(new CustomEvent("input", { bubbles: true, detail }));
    this.dispatchEvent(new CustomEvent("change", { bubbles: true, detail }));
    this._notify();
  }

  _syncState() {
    const invalid = Boolean(this.error) || (this._touched && this.internals?.validity.valid === false);
    this.setState("invalid", invalid);
    this.setState("filled", this._selected.length > 0);
  }

  _syncForm() {
    const i = this.internals;
    if (!i) return;
    const name = this.getAttribute("name");
    let value = null;
    if (name && this._selected.length) {
      if (this.multiple) {
        value = new FormData();
        for (const s of this._selected) value.append(name, s.value);
      } else value = String(this._selected[0].value);
    }
    i.setFormValue(value, JSON.stringify(plain(this._selected)));
    const anchor = this._input ?? undefined;
    if (this.required && this._selected.length === 0)
      i.setValidity({ valueMissing: true }, "Choose an option from the list.", anchor);
    else if (this.error) i.setValidity({ customError: true }, this.error, anchor);
    else if (this._custom) i.setValidity({ customError: true }, this._custom, anchor);
    else i.setValidity({});
    this._syncState();
  }

  render() {
    this._dispose?.();
    if (this._initial === null) this._initial = this._selected.slice();
    this.classList.add("c-combobox", "c-field");
    this.classList.toggle("c-field--invalid", Boolean(this.error));
    this.dataset.fid = this._id;
    this._mount();
    this._syncForm();
  }

  disconnectedCallback() {
    this._dispose?.();
    this._dispose = null;
    this.rendered = false;
  }

  _mount() {
    const host = this;
    const id = this._id;
    const label = this.label;
    const multiple = this.multiple;
    const hint = this.hint;
    const error = this.error;
    const required = this.required;
    const max = this.max;
    let selected = this._selected;
    let options = [];
    let active = -1;
    let seq = 0;
    let timer = 0;

    const status = h("p", { class: "c-field__status sr-only", "aria-live": "polite" });
    const list = h("ul", {
      class: "c-combobox__list",
      role: "listbox",
      id: `${id}-list`,
      "aria-labelledby": `${id}-label`,
      hidden: true,
    });
    const box = h("div", { class: "c-combobox__box" });
    // The listbox hangs off the box with CSS anchor positioning (combobox.css); otherwise it keeps the static placement.
    if (anchorSupported()) {
      box.style.setProperty("anchor-name", `--anchor-${id}`);
      list.style.setProperty("position-anchor", `--anchor-${id}`);
      list.dataset.anchored = "";
    }
    const chips = h("ul", { class: "c-combobox__chips", role: "list" });
    const hid = `${id}-hint`;
    const eid = `${id}-err`;
    const input = h("input", {
      id,
      class: "c-field__control c-combobox__input",
      role: "combobox",
      autocomplete: "off",
      "aria-expanded": "false",
      "aria-autocomplete": "list",
      "aria-controls": list.id,
      "aria-labelledby": `${id}-label`,
      "aria-haspopup": "listbox",
      "aria-describedby": [hint ? hid : null, error ? eid : null].filter(Boolean).join(" ") || null,
      "aria-invalid": error ? "true" : null,
      "aria-required": required ? "true" : null,
      placeholder: this.placeholder,
      disabled: this._isDisabled() ? true : null,
    });
    this._input = input;
    if (!multiple && selected[0]) input.value = selected[0].label;

    // The element is the control: the inner input's own change events are not the value changing.
    input.addEventListener("change", (e) => e.stopPropagation());

    const commit = () => {
      this._selected = selected;
      this._commit();
    };
    const renderChips = () => {
      clear(chips);
      for (const s of selected) {
        chips.append(
          h(
            "li",
            { class: "c-chip" },
            h("span", {}, s.label),
            h(
              "button",
              {
                type: "button",
                class: "c-chip__remove",
                "aria-label": `Remove ${s.label}`,
                onclick: () => (remove(s), input.focus()),
              },
              icon("x", { size: 16 }),
            ),
          ),
        );
      }
      chips.hidden = !multiple || selected.length === 0;
    };
    const remove = (s) => {
      selected = selected.filter((x) => x.value !== s.value);
      renderChips();
      commit();
    };
    const setOpen = (open) => {
      list.hidden = !open;
      input.setAttribute("aria-expanded", String(open));
      host.setState("open", open);
      if (!open) {
        active = -1;
        input.removeAttribute("aria-activedescendant");
      }
    };
    const setActive = (i) => {
      const opts = [...list.querySelectorAll("[role=option]")];
      if (opts.length === 0) return;
      active = (i + opts.length) % opts.length;
      opts.forEach((o, k) => o.classList.toggle("is-active", k === active));
      input.setAttribute("aria-activedescendant", opts[active].id);
      opts[active].scrollIntoView({ block: "nearest" });
    };
    const choose = (opt) => {
      if (multiple) {
        if (!selected.some((s) => s.value === opt.value)) {
          if (max && selected.length >= max) {
            status.textContent = `At most ${max} can be chosen`;
            setOpen(false);
            return;
          }
          selected = [...selected, opt];
        }
        input.value = "";
        renderChips();
      } else {
        selected = [opt];
        input.value = opt.label;
      }
      setOpen(false);
      commit();
    };
    const renderOptions = (q) => {
      clear(list);
      if (options.length === 0) {
        list.append(
          h(
            "li",
            { class: "c-combobox__empty", role: "presentation", "aria-disabled": "true" },
            `No results for ‘${q}’`,
          ),
        );
        status.textContent = "No results";
        return;
      }
      let group = null;
      options.forEach((opt, i) => {
        if (opt.group && opt.group !== group) {
          group = opt.group;
          list.append(h("li", { class: "c-combobox__group", role: "presentation" }, group));
        }
        const picked = selected.some((s) => s.value === opt.value);
        const li = h(
          "li",
          {
            role: "option",
            id: `${id}-o-${i}`,
            class: "c-combobox__option",
            "aria-selected": String(picked),
          },
          opt.avatar
            ? avatar({ name: opt.label, avatar: opt.avatar, size: "xs" })
            : opt.icon
              ? icon(opt.icon, { size: 16 })
              : null,
          h(
            "span",
            { class: "c-combobox__text" },
            h("span", { class: "c-combobox__label" }, opt.label),
            opt.description ? h("span", { class: "c-combobox__desc" }, opt.description) : null,
          ),
          picked ? h("span", { class: "c-combobox__check" }, icon("check", { size: 16 })) : null,
        );
        li.addEventListener("pointerdown", (e) => e.preventDefault());
        li.addEventListener("click", () => choose(opt));
        list.append(li);
      });
      status.textContent = `${options.length} results`;
    };
    const run = async () => {
      const q = input.value;
      const mine = ++seq;
      status.textContent = "Searching";
      try {
        const found = await host._runSearch(q);
        if (mine !== seq) return;
        options = found ?? [];
      } catch {
        if (mine !== seq) return;
        options = [];
      }
      renderOptions(q);
      setOpen(true);
      if (options.length) setActive(0);
    };
    input.addEventListener("input", run);
    // Typing in the search box is not the value changing; the element dispatches input/change on a choice.
    input.addEventListener("input", (e) => e.stopPropagation());
    input.addEventListener("focus", () => {
      if (list.hidden && !host._isDisabled()) run();
    });
    input.addEventListener("blur", () => {
      host._touched = true;
      timer = setTimeout(() => {
        setOpen(false);
        host._syncState();
      }, 120);
    });
    input.addEventListener("keydown", (e) => {
      const opts = [...list.querySelectorAll("[role=option]")];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (list.hidden) run();
        else setActive(active + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === "Home" && !list.hidden) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End" && !list.hidden) {
        e.preventDefault();
        setActive(opts.length - 1);
      } else if (e.key === "Enter" && !list.hidden && active >= 0) {
        e.preventDefault();
        choose(options[active]);
      } else if (e.key === "Escape") {
        if (!list.hidden) {
          e.stopPropagation();
          setOpen(false);
        } else input.value = multiple ? "" : input.value;
      } else if (e.key === "Backspace" && multiple && input.value === "" && selected.length) {
        remove(selected[selected.length - 1]);
      }
    });

    renderChips();
    box.append(chips, input);
    this.replaceChildren(
      ...[
        h(
          "label",
          { class: "c-field__label", id: `${id}-label`, for: id },
          label,
          required ? h("span", { class: "c-field__req", "aria-hidden": "true" }, " *") : null,
        ),
        box,
        list,
        status,
        hint ? h("p", { class: "c-field__hint", id: hid }, hint) : null,
        error ? h("p", { class: "c-field__error", id: eid }, icon("alert", { size: 16 }), error) : null,
      ].filter(Boolean),
    );
    this._dispose = () => {
      clearTimeout(timer);
      seq += 1;
      host.setState("open", false);
    };
  }
}
reflect(PCombobox, {
  label: ["label", "string"],
  name: ["name", "string"],
  multiple: ["multiple", "bool"],
  placeholder: ["placeholder", "string"],
  hint: ["hint", "string"],
  error: ["error", "string"],
  required: ["required", "bool"],
  disabled: ["disabled", "bool"],
  max: ["max", "number", 0],
});
define("p-combobox", PCombobox);

export const combobox = ({
  label,
  name,
  multiple = false,
  search,
  value,
  onChange,
  placeholder,
  hint,
  error,
  required,
  disabled,
}) => {
  const el = document.createElement("p-combobox");
  el.search = search;
  el.onChange = onChange ?? null;
  return el.configure({
    label,
    name: name ?? null,
    multiple,
    placeholder: placeholder ?? null,
    hint: hint ?? null,
    error: error ?? null,
    required: Boolean(required),
    disabled: Boolean(disabled),
    selection: multiple ? (value ?? []) : (value ?? null),
  });
};
