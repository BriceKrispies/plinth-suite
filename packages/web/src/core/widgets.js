// The widget runtime (UI-MAP 3.2 and 4): the registry, config decoding, the widget frame, the scoped context,
// the error boundary and the placeholder for widgets whose module has not landed.
import { WIDGET_CATALOGUE } from "./widget-schemas.js";
import { WIDGET_MANIFEST, WIDGET_ROUTES } from "./widget-manifest.js";
import { checkSchema, defaultsFromSchema } from "./schema-check.js";
import * as apiClient from "./api.js";
import * as rt from "./rt.js";
import * as router from "./router.js";
import { meStore, can } from "./stores.js";
import { widgetFrame } from "../ds/js/widget-frame.js";
import { announce, h } from "../ds/js/dom.js";
import { toast } from "../ds/js/toast.js";
import { openDrawer } from "../ds/js/drawer.js";
import { openDialog, confirmDialog } from "../ds/js/dialog.js";

const BY_ID = new Map(WIDGET_CATALOGUE.map((w) => [w.id, w]));

/** The catalogue entry (id, domain, title, sizes, grid, config_schema, views, actions, events, ...) or undefined. */
export const catalogEntry = (id) => BY_ID.get(id);
export const schemaOf = (id) => BY_ID.get(id)?.config_schema;
/** Defaults declared by the config schema (most widgets declare none). */
export const defaultsOf = (id) => defaultsFromSchema(schemaOf(id));

/** `{ ok, errors: [{ path, message }] }` against the catalogue's config JSON Schema. */
export const validateConfig = (id, config) => {
  const schema = schemaOf(id);
  if (!schema) return { ok: false, errors: [{ path: "/", message: "unknown widget" }] };
  const errors = checkSchema(schema, config ?? {});
  return { ok: errors.length === 0, errors };
};

const isBinding = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === 1 &&
  typeof v.param === "string";

/** Substitute `{ param }` bindings from the route params. `"$me"` is left for the widget (`ctx.memberHandle`). */
export const resolveBindings = (config, params = {}, _me) => {
  const walk = (v) => {
    if (isBinding(v)) return params[v.param] ?? null;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(config ?? {});
};

const placeholderModule = (id) => ({
  id,
  domain: id.split(".")[0],
  title: catalogEntry(id)?.title ?? id,
  placeholder: true,
  sizes: catalogEntry(id)?.sizes ?? [],
  mount(el) {
    el.append(
      h(
        "div",
        { class: "c-placeholder", "data-placeholder": id },
        h("strong", {}, "Widget not built yet"),
        h("span", { class: "c-placeholder__id" }, id),
      ),
    );
    return () => {};
  },
});

/**
 * The module for a widget id. Unknown ids (not in the catalogue) reject; a catalogue widget whose module file
 * is absent resolves to a placeholder module so packages can land independently.
 */
export const loadWidget = async (id) => {
  if (!BY_ID.has(id)) throw Object.assign(new Error(`Unknown widget "${id}"`), { code: "unknown_widget" });
  const loader = WIDGET_MANIFEST[id];
  if (!loader) return placeholderModule(id);
  const mod = await loader();
  const def = mod.default ?? mod;
  if (!def || typeof def.mount !== "function") throw new TypeError(`Widget module "${id}" has no mount()`);
  return def;
};

// ---- scoped handles: everything a widget subscribes to is removed on unmount ----

const scopedRt = (tracked) => {
  const track = (off) => {
    tracked.add(off);
    return () => {
      tracked.delete(off);
      off();
    };
  };
  return {
    on: (type, fn) => track(rt.on(type, fn)),
    onChange: (predicate, fn) => track(rt.onChange(predicate, fn)),
    /** Changes naming one node (its uri) or any node of a kind (`"Page"`). */
    onNode: (uriOrKind, fn) =>
      track(
        rt.onChange(
          (c) =>
            uriOrKind.startsWith("plinth://")
              ? c.node === uriOrKind
              : String(c.node).includes(`/${uriOrKind}/`),
          fn,
        ),
      ),
  };
};

const scopedBus = (bus, group, tracked) => {
  const scope = bus.scope(group);
  return {
    publish: scope.publish,
    subscribe: (topic, fn) => {
      const off = scope.subscribe(topic, fn);
      tracked.add(off);
      return () => {
        tracked.delete(off);
        off();
      };
    },
    latest: scope.latest,
  };
};

const memberHandle = (target) => {
  if (target === "$me") return meStore.get()?.member?.handle ?? null;
  return typeof target === "string" ? target : null;
};

const narrowQuery = typeof matchMedia === "function" ? matchMedia("(max-width: 47.99rem)") : null;

/** The size to render at: on one-column pages a widget shows its `m` size, or its smallest. */
export const effectiveSize = (id, size) => {
  if (!narrowQuery?.matches) return size;
  const sizes = catalogEntry(id)?.sizes ?? [size];
  return sizes.includes("m") ? "m" : sizes[0];
};

/**
 * The context object a widget's `mount` receives (UI-MAP 4.2). One construction shared by `mountWidget` and
 * `<plinth-widget>`. `tracked` is the Set the scoped `rt`/`bus` handles register their unsubscribers in.
 */
export const widgetContext = ({
  mod,
  cfg,
  size,
  bus,
  tracked,
  page,
  params,
  instance,
  title,
  frame,
  remount,
}) => {
  const group = typeof cfg.link_group === "string" ? cfg.link_group : "page";
  const nav = { go: (path) => router.navigate(path), href: router.href };
  return {
    config: cfg,
    size,
    api: {
      call: apiClient.call,
      nodes: apiClient.nodes,
      query: apiClient.query,
      idempotencyKey: apiClient.idempotencyKey,
    },
    rt: scopedRt(tracked),
    bus: scopedBus(bus, group, tracked),
    nav,
    ctx: {
      me: meStore.get(),
      can,
      memberHandle,
      params: params ?? {},
      page,
      instance: instance ?? { uri: null, slug: null, title },
      setTitle: (text) => frame.setTitle(text),
      setCount: (n) => frame.setCount(n),
      setState: (state, info) => frame.setState(state, { ...info, retry: info?.retry ?? remount }),
      announce,
      toast,
      openDrawer,
      openDialog,
      confirm: confirmDialog,
      module: mod?.id,
    },
  };
};

/**
 * Mount a widget into `el`.
 *   opts: { id, config, size, instance?: { uri, slug, title }, page?: { slug, kind, editable },
 *           bus, params?, title?, chrome?, unavailable?, arrived?, onRemove?, onConfigure?, onState?(state, info) }
 * Returns `{ update(config, size), unmount() }`.
 */
export const mountWidget = (el, opts) => {
  const { id, bus } = opts;
  const entry = catalogEntry(id);
  let config = opts.config ?? {};
  let size = opts.size ?? entry?.default_size ?? "m";
  const page = opts.page ?? { slug: "", kind: "custom", editable: false };
  const title = () => config.title ?? opts.title ?? opts.instance?.title ?? entry?.title ?? id;
  const route = WIDGET_ROUTES[id];

  const menu = [{ label: "Refresh", icon: "history", onSelect: () => remount() }];
  if (route && router.current().path !== route)
    menu.push({ label: "Open as page", icon: "external", onSelect: () => router.navigate(route) });
  if (page.editable)
    menu.push({
      label: "Configure in the page editor",
      icon: "sliders",
      onSelect: () => (opts.onConfigure ? opts.onConfigure() : router.navigate(`/pages/${page.slug}/edit`)),
    });
  if (page.kind === "personal" && opts.onRemove)
    menu.push({
      label: "Remove from personal page",
      icon: "trash",
      danger: true,
      separatorBefore: true,
      onSelect: () => opts.onRemove(),
    });

  const frame = widgetFrame({
    id,
    title: title(),
    size,
    menu,
    chrome: opts.chrome ?? (size === "full" && page.kind === "module" ? "rule" : "card"),
  });
  el.replaceChildren(frame.element);
  if (opts.arrived) frame.arrive();

  let unmountFn = null;
  let tracked = new Set();
  let live = true;
  let generation = 0;
  let activeModule = null;

  const release = () => {
    try {
      unmountFn?.();
    } catch (e) {
      console.error(e);
    }
    unmountFn = null;
    for (const off of [...tracked]) off();
    if (tracked.size > 0) console.warn(`Widget ${id} left ${tracked.size} subscriptions behind`);
    tracked = new Set();
    frame.body.replaceChildren();
  };

  if (opts.onState) {
    // every state the frame enters (including the ones a widget sets through ctx.setState) is reported
    const setFrameState = frame.setState;
    frame.setState = (state, info) => {
      setFrameState(state, info);
      opts.onState(state, info);
    };
  }

  const fail = (error, retry = remount) => frame.setState("error", { error, retry });

  const context = (cfg, sz, mod) =>
    widgetContext({
      mod,
      cfg,
      size: sz,
      bus,
      tracked,
      page,
      params: opts.params,
      instance: opts.instance,
      title: title(),
      frame,
      remount,
    });

  const run = async () => {
    const mine = ++generation;
    frame.setState("loading");
    if (opts.unavailable) {
      frame.setState("unavailable", { reason: opts.unavailable });
      return;
    }
    let mod;
    try {
      mod = await loadWidget(id);
    } catch (e) {
      if (!live || mine !== generation) return;
      if (e?.code === "unknown_widget") frame.setState("unavailable", { reason: "unknown_widget" });
      else fail(e);
      return;
    }
    if (!live || mine !== generation) return;
    activeModule = mod;
    const check = validateConfig(id, config);
    if (!check.ok) {
      fail(
        { code: "INVALID_CONFIG", message: check.errors.map((x) => `${x.path} ${x.message}`).join("; ") },
        null,
      );
      return;
    }
    frame.setState("ready");
    try {
      const { config: cfg, size: sz, ...handles } = context(config, size, mod);
      const result = await mod.mount(frame.body, { config: cfg, size: sz, ...handles });
      if (!live || mine !== generation) {
        if (typeof result === "function") result();
        return;
      }
      unmountFn = typeof result === "function" ? result : null;
    } catch (e) {
      if (!live || mine !== generation) return;
      console.error(e);
      release();
      fail(e);
    }
  };

  function remount() {
    release();
    run();
  }

  run();

  return {
    update(nextConfig, nextSize) {
      if (!live) return;
      const sameConfig = JSON.stringify(nextConfig) === JSON.stringify(config);
      const nextEffective = nextSize ?? size;
      if (sameConfig && nextEffective === size) return;
      config = nextConfig ?? config;
      if (nextEffective !== size) {
        frame.element.classList.replace(`c-widget--${size}`, `c-widget--${nextEffective}`);
        size = nextEffective;
      }
      frame.setTitle(title());
      if (activeModule && typeof activeModule.update === "function" && unmountFn !== null) {
        try {
          activeModule.update(config, size);
        } catch (e) {
          console.error(e);
          release();
          fail(e);
        }
      } else remount();
    },
    unmount() {
      if (!live) return;
      live = false;
      release();
      frame.element.remove();
    },
    frame,
  };
};
