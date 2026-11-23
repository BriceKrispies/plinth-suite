// <plinth-widget>: a widget as a vanilla custom element (UI-MAP 4.5). Light DOM only, so the layered tokens, @scope
// rules and looks keep applying. It owns the whole widget lifecycle: it looks the module up, builds the frame,
// calls the module's `mount` with the widget context, reflects its state as an attribute and unmounts on disconnect.
// Nothing here assumes the page host is the parent: the element works inside any HTML (an article, the styleguide).
//
//   <plinth-widget type="store.catalog" size="l" config='{"category":"mugs"}'></plinth-widget>
//
// Attributes: `type` (catalogue id), `config` (JSON), `size` (s|m|l|xl|full), `instance` (Widget node slug),
// `page` (Page slug), `unavailable` (a reason such as "forbidden": renders the frame's unavailable state).
// Reflected: `state` = loading | ready | error | unavailable.
// Events (bubbling, composed): `plinth-widget:ready`, `plinth-widget:error`, and `plinth-widget:mount` (the frame
// exists; `event.target.frame` is the widget frame handle), each with `detail: { type, ... }`.
// The page host passes what attributes cannot carry through the `host` property: `{ bus, params, page, instance,
// title, chrome, arrived, onRemove, onConfigure }`.
import { createBus } from "./bus.js";
import { mountWidget, catalogEntry } from "./widgets.js";

/** The bus of widgets that are not on a page: they share one, so link groups still connect them with each other. */
let looseBus = null;
const sharedBus = () => (looseBus ??= createBus());

const parseConfig = (text) => {
  if (text === null || text.trim() === "") return { config: {} };
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return { config: value };
    return { error: new Error("config must be a JSON object") };
  } catch (e) {
    return { error: new Error(`config is not valid JSON: ${e.message}`) };
  }
};

export class PlinthWidget extends HTMLElement {
  static observedAttributes = ["type", "config", "size", "unavailable"];

  /** Set by the page host before connecting: `{ bus, params, page, instance, title, chrome, arrived, onRemove, onConfigure }`. */
  host = null;
  /** The mount handle from the runtime (`{ update, unmount, frame }`), or null while not mounted. */
  handle = null;
  #flush = false;

  /** The widget frame (`{ element, body, setTitle, ... }`), or null while not mounted. */
  get frame() {
    return this.handle?.frame ?? null;
  }

  connectedCallback() {
    if (!this.style.display) this.style.display = "contents";
    if (!this.handle) this.#mount();
  }

  disconnectedCallback() {
    // moving the element (the page host re-orders cells) disconnects and reconnects it in one task: only a real removal unmounts
    queueMicrotask(() => {
      if (!this.isConnected) this.unmount();
    });
  }

  attributeChangedCallback(name, before, after) {
    if (before === after || !this.handle) {
      if (name === "type" && this.isConnected && !this.handle) this.#mount();
      return;
    }
    if (name === "type" || name === "unavailable") {
      this.unmount();
      this.#mount();
      return;
    }
    // config and size changed in the same task are applied together
    if (this.#flush) return;
    this.#flush = true;
    queueMicrotask(() => {
      this.#flush = false;
      if (!this.handle) return;
      const { config, error } = parseConfig(this.getAttribute("config"));
      if (error) {
        this.#setState("error", { error: { code: "INVALID_CONFIG", message: error.message } });
        return;
      }
      this.handle.update(config, this.getAttribute("size") ?? undefined);
    });
  }

  /** Unmount now (the module's unmount, scoped subscriptions, the frame). The element can mount again if reconnected. */
  unmount() {
    const handle = this.handle;
    if (!handle) return;
    this.handle = null;
    handle.unmount();
    this.removeAttribute("state");
  }

  #setState(state, info) {
    // the frame has the state UI; this reports it (`empty` is a ready widget showing its own empty state)
    this.handle?.frame.setState(state, info);
  }

  #report(state, info) {
    const reflected = state === "empty" ? "ready" : state;
    if (this.getAttribute("state") !== reflected) this.setAttribute("state", reflected);
    const type = this.getAttribute("type");
    if (reflected === "ready")
      this.dispatchEvent(
        new CustomEvent("plinth-widget:ready", { bubbles: true, composed: true, detail: { type } }),
      );
    else if (reflected === "error")
      this.dispatchEvent(
        new CustomEvent("plinth-widget:error", {
          bubbles: true,
          composed: true,
          detail: { type, error: info?.error },
        }),
      );
  }

  #mount() {
    const id = this.getAttribute("type");
    if (!id) return;
    const host = this.host ?? {};
    const parsed = parseConfig(this.getAttribute("config"));
    const instanceSlug = this.getAttribute("instance");
    const pageSlug = this.getAttribute("page");
    const entry = catalogEntry(id);
    const size = this.getAttribute("size") ?? entry?.default_size ?? "m";
    this.handle = mountWidget(this, {
      id,
      config: parsed.error ? {} : parsed.config,
      size,
      title: host.title,
      chrome: host.chrome,
      arrived: host.arrived,
      onRemove: host.onRemove,
      onConfigure: host.onConfigure,
      params: host.params,
      bus: host.bus ?? sharedBus(),
      page: host.page ?? { slug: pageSlug ?? "", kind: "custom", editable: false },
      instance: host.instance ?? (instanceSlug ? { uri: null, slug: instanceSlug, title: "" } : undefined),
      unavailable: this.getAttribute("unavailable") ?? undefined,
      onState: (state, info) => this.#report(state, info),
    });
    this.dispatchEvent(new CustomEvent("plinth-widget:mount", { bubbles: true, detail: { type: id } }));
    if (parsed.error)
      this.#setState("error", { error: { code: "INVALID_CONFIG", message: parsed.error.message } });
  }
}

/** Define `<plinth-widget>` (once). Call at boot, before any page renders. */
export const defineWidgetElement = () => {
  if (!customElements.get("plinth-widget")) customElements.define("plinth-widget", PlinthWidget);
};
