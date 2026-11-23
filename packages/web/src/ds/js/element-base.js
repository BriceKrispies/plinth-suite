// Base for the design system's custom elements. Light DOM on purpose (DESIGN-SYSTEM 6.29): the tokens, looks,
// @scope rules and every existing class selector keep applying, because the element carries the same classes the
// helpers always drew. Attributes are the source of truth; properties reflect them.

/** Define `tag` once. A second module graph (or a hot reload) finding it defined is not an error. */
export const define = (tag, ctor) => {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tag)) customElements.define(tag, ctor);
};

/**
 * Reflect properties to attributes. `spec` maps a property to `[attribute, type]`; type is "string", "bool" or
 * "number". A null/undefined/false value removes the attribute.
 */
export const reflect = (ctor, spec) => {
  for (const [prop, [attr, type, fallback]] of Object.entries(spec)) {
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      get() {
        if (type === "bool") return this.hasAttribute(attr);
        const raw = this.getAttribute(attr);
        if (raw === null) return fallback ?? null;
        return type === "number" ? Number(raw) : raw;
      },
      set(v) {
        if (type === "bool") this.toggleAttribute(attr, Boolean(v));
        else if (v === null || v === undefined || v === false) this.removeAttribute(attr);
        else this.setAttribute(attr, String(v));
      },
    });
  }
};

/** Swap a managed class: removes `previous` (when set) and adds `next`. Returns `next`. */
export const swapClass = (el, previous, next) => {
  if (previous && previous !== next) el.classList.remove(previous);
  if (next) el.classList.add(next);
  return next;
};

export class PElement extends HTMLElement {
  #depth = 0;
  #dirty = false;
  #internals = null;
  rendered = false;

  /** ElementInternals, created on first use. */
  get internals() {
    if (!this.#internals) {
      try {
        this.#internals = this.attachInternals();
      } catch {
        this.#internals = null;
      }
    }
    return this.#internals;
  }

  /** Toggle a `:state(name)` custom state (older engines spell it `--name`). */
  setState(name, on) {
    const states = this.internals?.states;
    if (!states) return;
    try {
      if (on) states.add(name);
      else states.delete(name);
    } catch {
      try {
        if (on) states.add(`--${name}`);
        else states.delete(`--${name}`);
      } catch {
        /* no custom states here */
      }
    }
  }

  /** Assign several properties, rendering once at the end. Returns the element. */
  configure(props) {
    this.#depth += 1;
    try {
      for (const [k, v] of Object.entries(props ?? {})) if (v !== undefined) this[k] = v;
      this.#dirty = true;
    } finally {
      this.#depth -= 1;
    }
    this.#flush();
    return this;
  }

  requestRender() {
    this.#dirty = true;
    this.#flush();
  }

  #flush() {
    if (this.#depth > 0 || !this.#dirty) return;
    this.#dirty = false;
    this.rendered = true;
    this.render();
  }

  attributeChangedCallback() {
    this.requestRender();
  }

  connectedCallback() {
    if (!this.rendered) this.requestRender();
    this.connected?.();
  }

  /** Subclasses draw here. Must be safe to call repeatedly. */
  render() {}
}
