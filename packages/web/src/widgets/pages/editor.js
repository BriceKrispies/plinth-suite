// pages.editor: edit a Page as a 12-column canvas. Add widgets from the catalogue (a drawer), configure each with
// a form generated from its config schema (a drawer), move and resize by pointer or keyboard (grab a handle with
// Enter, arrows move, Shift with arrows resizes, Enter drops, Escape cancels), pick a size from the widget's own
// sizes, and remove. Every change is committed to the Page node at once; collisions are refused. Shared system
// pages offer a personal copy first.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { menuButton } from "../../ds/js/menu.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState } from "../../ds/js/states.js";
import { formErrors, searchField, textField } from "../../ds/js/field.js";
import { catalogEntry, defaultsOf, schemaOf, validateConfig } from "../../core/widgets.js";
import { debounce, latest, region, toErrorInfo, toastError, isStale, scoped } from "../reporting/_common.js";
import { heldNotice } from "../admin/_admin.js";
import { configForm } from "./_schema-form.js";

const COLS = 12;
const AUTO_RELOAD_QUIET_MS = 1500;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const collides = (at, items, ignore) => items.some((it, i) => i !== ignore && overlaps(at, it.at));
const clampAt = (at) => {
  const w = clamp(at.w, 1, COLS);
  const x = clamp(at.x, 0, COLS - w);
  return { x, y: Math.max(0, at.y), w, h: Math.max(1, at.h) };
};
const findSpot = (w, hgt, items) => {
  for (let y = 0; y < 200; y += 1)
    for (let x = 0; x + w <= COLS; x += 1) {
      const at = { x, y, w, h: hgt };
      if (!collides(at, items, -1)) return at;
    }
  return { x: 0, y: 0, w, h: hgt };
};
const footprint = (entry, size) => entry?.grid?.[size] ?? { w: 4, h: 4 };
/** The largest size variant whose footprint fits `at`, else the smallest one. */
const sizeFor = (entry, at) => {
  const sizes = entry?.sizes ?? [];
  const fits = sizes.filter((s) => footprint(entry, s).w <= at.w && footprint(entry, s).h <= at.h);
  const area = (s) => footprint(entry, s).w * footprint(entry, s).h;
  return (fits.length ? fits : sizes).reduce(
    (a, s) => (a === null || (fits.length ? area(s) > area(a) : area(s) < area(a)) ? s : a),
    null,
  );
};

export default {
  id: "pages.editor",
  domain: "pages",
  title: "Page editor",
  configSchema: schemaOf("pages.editor"),
  sizes: catalogEntry("pages.editor")?.sizes ?? [],
  mount(el, { config, api, rt, nav, ctx }) {
    const slug = typeof config.page === "string" ? config.page : null;
    const stage = region("rp-editor__stage");
    el.append(h("div", { class: "rp-app rp-editor" }, stage.el));
    const next = latest();
    let alive = true;
    let resolve = null;
    let catalog = [];
    let items = [];
    let page = null;
    let canvas = null;
    let grab = null;
    let dragging = false;
    let lastOwnCommit = 0;
    let stale = false;
    let notice = null;
    let focusItem = null;

    if (!slug) {
      stage.show(
        emptyState({
          icon: "board",
          title: "No page chosen",
          body: "Open the editor from a page's Edit page action.",
        }),
      );
      return () => {};
    }

    const entryOf = (widgetId) => catalog.find((c) => c.id === widgetId) ?? catalogEntry(widgetId);
    const editable = () => Boolean(resolve?.editable) && !(resolve.spec.system && !ctx.can("node:write"));
    const specItems = () =>
      items.map((it) => ({
        item: it.item,
        at: it.at,
        ...(it.explicitSize ? { size: it.explicitSize } : {}),
      }));

    // ---- loading ----
    async function load({ first = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 6, shape: "card" });
      try {
        const [res, cat] = await Promise.all([
          api.call("pages.resolve", { page: slug }),
          catalog.length
            ? Promise.resolve({ items: catalog })
            : api.call("widgets.catalog", { include_schemas: true }),
        ]);
        if (!ok() || !alive) return;
        resolve = res;
        catalog = cat.items;
        page = res.page;
        const explicit = new Map(res.spec.layout.items.map((i) => [i.item, i.size]));
        items = res.items.map((r) => ({ ...r, explicitSize: explicit.get(r.item) }));
        stale = false;
        ctx.setTitle(`Editing ${res.page.title || res.page.slug}`);
        ctx.setCount(items.length);
        paint();
      } catch (e) {
        if (!ok() || !alive) return;
        const info = toErrorInfo(e);
        if (info.code === "UNKNOWN_REFERENCE") ctx.setState("unavailable", { reason: "missing" });
        else if (info.code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else stage.error(e, () => load({ first: true }));
      }
    }

    // ---- committing ----
    async function commitLayout(nextItems, { reason = "Edit page layout", announceText } = {}) {
      const prev = items;
      items = nextItems;
      paint();
      lastOwnCommit = Date.now();
      try {
        const res = await api.nodes.patch(
          page.uri,
          page.revision,
          [
            {
              op: "set",
              path: "/spec/layout/items",
              value: nextItems.map((it) => ({
                item: it.item,
                at: it.at,
                ...(it.explicitSize ? { size: it.explicitSize } : {}),
              })),
            },
          ],
          { reason },
        );
        if (res.status === "pending_approval") {
          items = prev;
          notice = heldNotice(res, "The layout change", nav);
          paint();
          return false;
        }
        page = { ...page, revision: res.nodes?.[0]?.result_revision ?? page.revision + 1 };
        if (announceText) ctx.announce(announceText);
        return true;
      } catch (e) {
        items = prev;
        paint();
        const info = toastError(ctx.toast, e, "Could not save the layout");
        if (isStale(info) || info.code === "CONFLICT") await load();
        return false;
      }
    }

    // ---- painting ----
    function paint() {
      if (!resolve) return;
      const spec = resolve.spec;
      const personal = Boolean(resolve.personal_of);
      const sharedLocked = spec.system && !ctx.can("node:write") && !personal;
      const head = h(
        "header",
        { class: "rp-editor__head" },
        h(
          "div",
          { class: "rp-detail__pills" },
          pill({ label: spec.kind }),
          spec.system ? pill({ label: "System page", tone: "info" }) : null,
          personal ? pill({ label: "Personal copy", tone: "info" }) : null,
          pill({ label: `Revision ${page.revision}` }),
          pill({ label: `${items.length} ${items.length === 1 ? "widget" : "widgets"}` }),
        ),
        h(
          "div",
          { class: "rp-detail__actions" },
          editable()
            ? button({
                label: "Add widget",
                icon: "plus",
                variant: "primary",
                onClick: () => openCatalogue(),
              })
            : null,
          viewHref()
            ? h(
                "a",
                { class: "c-button c-button--secondary c-button--md", href: viewHref() },
                "View the page",
              )
            : null,
          personal
            ? button({
                label: "Reset to default",
                icon: "history",
                variant: "secondary",
                onClick: resetPersonal,
              })
            : null,
        ),
      );
      const banners = [];
      if (sharedLocked)
        banners.push(
          h(
            "div",
            { class: "rp-notice", "data-tone": "info" },
            icon("info", { size: 16 }),
            h(
              "p",
              {},
              "This is a shared page, so you cannot change it for everyone. ",
              button({
                label: "Make my own copy",
                icon: "copy",
                variant: "secondary",
                size: "sm",
                onClick: personalize,
              }),
            ),
          ),
        );
      else if (!resolve.editable)
        banners.push(
          h(
            "div",
            { class: "rp-notice", "data-tone": "warning" },
            icon("lock", { size: 16 }),
            h("p", {}, "You can look at this layout but not change it."),
          ),
        );
      else if (spec.system)
        banners.push(
          h(
            "div",
            { class: "rp-notice", "data-tone": "warning" },
            icon("alert", { size: 16 }),
            h("p", {}, "You are editing a shared system page. Everyone sees your changes."),
          ),
        );
      if (stale)
        banners.push(
          h(
            "div",
            { class: "rp-notice", "data-tone": "warning", role: "status" },
            icon("clock", { size: 16 }),
            h(
              "p",
              {},
              "This page was changed elsewhere. ",
              button({
                label: "Reload",
                icon: "history",
                size: "sm",
                variant: "secondary",
                onClick: () => load(),
              }),
            ),
          ),
        );
      if (notice) banners.push(notice);

      canvas = h("div", {
        class: "rp-canvas",
        role: "group",
        "aria-label": `Layout of ${page.title || page.slug}`,
      });
      const rows = Math.max(8, ...items.map((it) => it.at.y + it.at.h + 2));
      canvas.style.setProperty("--w-pages-rows", rows);
      items.forEach((it, i) => canvas.append(boxNode(it, i)));
      const content =
        items.length === 0
          ? emptyState({
              icon: "board",
              title: "This page is empty",
              body: editable()
                ? "Add a widget from the catalogue to start."
                : "Nothing is placed on this page.",
              action: editable()
                ? button({
                    label: "Add widget",
                    icon: "plus",
                    variant: "primary",
                    onClick: () => openCatalogue(),
                  })
                : undefined,
            })
          : canvas;
      stage.show(
        head,
        ...banners,
        content,
        h(
          "p",
          { class: "rp-hint" },
          "Press Enter on a Move handle to grab a widget. Arrow keys move it, Shift with the arrows resizes it, Enter drops it and Escape cancels.",
        ),
      );
      if (focusItem) {
        canvas
          .querySelector(`[data-item="${CSS.escape(focusItem)}"] .rp-box__move`)
          ?.focus({ preventScroll: true });
        focusItem = null;
      }
    }

    const viewHref = () => {
      const r = resolve.spec.route;
      if (r && !r.includes(":")) return nav.href(r);
      return resolve.spec.kind === "custom" ? nav.href(`/p/${page.slug}`) : null;
    };

    function boxNode(it, i) {
      const entry = entryOf(it.widget);
      const size = it.size ?? sizeFor(entry, it.at);
      const can = editable();
      const move = button({
        label: `Move or resize ${it.title}`,
        icon: "sort",
        size: "sm",
        variant: "ghost",
        iconOnly: true,
        disabled: !can,
      });
      move.classList.add("rp-box__move");
      move.setAttribute("aria-pressed", String(grab?.i === i));
      if (can) {
        move.addEventListener("pointerdown", (e) => startPointer(e, i, "move"));
        move.addEventListener("keydown", (e) => handleKey(e, i, move));
        move.addEventListener("blur", () => {
          if (grab?.i === i) cancelGrab();
        });
      }
      const resize = can
        ? h("span", {
            class: "rp-box__resize",
            role: "presentation",
            title: "Drag to resize",
            onpointerdown: (e) => startPointer(e, i, "resize"),
          })
        : null;
      const menuItems = [
        ...(it.item.startsWith("widget:") && it.available
          ? [{ label: "Configure", icon: "sliders", onSelect: () => openConfigure(i) }]
          : []),
        ...(entry?.sizes ?? []).map((s) => ({
          label: `Size ${s}${s === size ? " (current)" : ""}`,
          onSelect: () => setSize(i, s),
          disabled: s === size,
        })),
        {
          label: "Remove from page",
          icon: "trash",
          danger: true,
          separatorBefore: true,
          onSelect: () => removeItem(i),
        },
      ];
      const box = h(
        "div",
        {
          class: `rp-box${it.available ? "" : " is-unavailable"}${grab?.i === i ? " is-grabbed" : ""}`,
          "data-item": it.item,
          role: "group",
          "aria-label": `${it.title}, ${it.widget}, columns ${it.at.x + 1} to ${it.at.x + it.at.w}, rows ${it.at.y + 1} to ${it.at.y + it.at.h}`,
        },
        h(
          "div",
          { class: "rp-box__head" },
          move,
          h("span", { class: "rp-box__title" }, it.title),
          pill({ label: size }),
        ),
        h("p", { class: "rp-box__id u-mono" }, it.widget),
        !it.available
          ? h(
              "p",
              { class: "rp-box__note" },
              it.unavailable_reason === "forbidden"
                ? "Not available to you"
                : it.unavailable_reason === "missing"
                  ? "Removed"
                  : "Unknown widget",
            )
          : null,
        can
          ? h(
              "div",
              { class: "rp-box__tools" },
              button({
                label: "Configure",
                icon: "sliders",
                size: "sm",
                variant: "secondary",
                disabled: !(it.item.startsWith("widget:") && it.available),
                onClick: () => openConfigure(i),
              }),
              menuButton({
                label: `More actions for ${it.title}`,
                icon: "more",
                iconOnly: true,
                variant: "ghost",
                size: "sm",
                items: menuItems,
              }),
            )
          : null,
        resize,
      );
      setAt(box, it.at);
      return box;
    }

    // ---- moving and resizing ----
    const setAt = (box, at) => {
      box.style.setProperty("--x", at.x + 1);
      box.style.setProperty("--y", at.y + 1);
      box.style.setProperty("--w", at.w);
      box.style.setProperty("--h", at.h);
    };
    const applyBox = (i, at) => {
      const box = canvas?.children[i];
      if (box) setAt(box, at);
    };

    function startPointer(e, i, mode) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture?.(e.pointerId);
      dragging = true;
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      const colW = rect.width / COLS;
      const rowPitch = parseFloat(style.gridAutoRows) + parseFloat(style.rowGap || "0");
      const start = { x: e.clientX, y: e.clientY, at: { ...items[i].at } };
      let last = start.at;
      const move = (ev) => {
        const dc = Math.round((ev.clientX - start.x) / colW);
        const dr = Math.round((ev.clientY - start.y) / rowPitch);
        const at = clampAt(
          mode === "move"
            ? { ...start.at, x: start.at.x + dc, y: start.at.y + dr }
            : { ...start.at, w: start.at.w + dc, h: start.at.h + dr },
        );
        if (!collides(at, items, i)) {
          last = at;
          applyBox(i, at);
        }
      };
      const up = async () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
        dragging = false;
        if (JSON.stringify(last) === JSON.stringify(start.at)) return;
        const nextItems = items.map((it, k) => (k === i ? { ...it, at: last } : it));
        focusItem = items[i].item;
        await commitLayout(nextItems, {
          announceText: `${items[i].title} ${mode === "move" ? "moved" : "resized"}`,
        });
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
      target.addEventListener("pointercancel", up);
    }

    function handleKey(e, i, handle) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!grab) {
          grab = { i, original: { ...items[i].at } };
          handle.setAttribute("aria-pressed", "true");
          canvas.children[i]?.classList.add("is-grabbed");
          ctx.announce(
            `${items[i].title} grabbed. Arrow keys move it, Shift with the arrows resizes it, Enter drops it, Escape cancels.`,
          );
        } else dropGrab();
        return;
      }
      if (!grab) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelGrab();
        return;
      }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      const at = items[i].at;
      const nextAt = clampAt(
        e.shiftKey ? { ...at, w: at.w + d[0], h: at.h + d[1] } : { ...at, x: at.x + d[0], y: at.y + d[1] },
      );
      if (collides(nextAt, items, i)) {
        ctx.announce("Blocked by another widget");
        return;
      }
      if (JSON.stringify(nextAt) === JSON.stringify(at)) return;
      items = items.map((it, k) => (k === i ? { ...it, at: nextAt } : it));
      applyBox(i, nextAt);
      ctx.announce(
        e.shiftKey ? `Size ${nextAt.w} by ${nextAt.h}` : `Column ${nextAt.x + 1}, row ${nextAt.y + 1}`,
      );
    }

    function cancelGrab() {
      if (!grab) return;
      const { i, original } = grab;
      grab = null;
      items = items.map((it, k) => (k === i ? { ...it, at: original } : it));
      focusItem = items[i].item;
      paint();
      ctx.announce("Move cancelled");
    }

    async function dropGrab() {
      const { i, original } = grab;
      grab = null;
      const moved = JSON.stringify(items[i].at) !== JSON.stringify(original);
      focusItem = items[i].item;
      if (!moved) {
        paint();
        return;
      }
      const dropped = items;
      items = items.map((it, k) => (k === i ? { ...it, at: original } : it));
      await commitLayout(dropped, {
        announceText: `${dropped[i].title} placed at column ${dropped[i].at.x + 1}, row ${dropped[i].at.y + 1}`,
      });
    }

    // ---- size, remove ----
    async function setSize(i, s) {
      const it = items[i];
      const fp = footprint(entryOf(it.widget), s);
      const at = clampAt({ ...it.at, w: Math.max(it.at.w, fp.w), h: Math.max(it.at.h, fp.h) });
      if (collides(at, items, i)) {
        ctx.toast({
          title: "Not enough room",
          body: "Move or shrink the neighbouring widgets first.",
          tone: "warning",
        });
        return;
      }
      focusItem = it.item;
      await commitLayout(
        items.map((x, k) => (k === i ? { ...x, at, explicitSize: s, size: s } : x)),
        { announceText: `${it.title} set to size ${s}` },
      );
    }

    async function removeItem(i) {
      const it = items[i];
      const yes = await ctx.confirm({
        title: `Remove ${it.title}?`,
        message: it.item.startsWith("widget:")
          ? "The widget leaves this page. If no other page uses it, its configuration is deleted too."
          : "The panel leaves this page. The saved panel itself is kept.",
        confirmLabel: "Remove",
        tone: "danger",
      });
      if (!yes) return;
      const ok = await commitLayout(
        items.filter((_, k) => k !== i),
        { reason: `Remove ${it.title}`, announceText: `${it.title} removed` },
      );
      if (!ok || !it.item.startsWith("widget:") || !it.node) return;
      try {
        const pages = await api.nodes.list("Page");
        const used = pages.some(
          (p) => p.uri !== page.uri && (p.body?.spec?.layout?.items ?? []).some((x) => x.item === it.item),
        );
        if (!used)
          await api.nodes.remove(it.node.uri, it.node.revision, {
            reason: `Delete unused widget ${it.title}`,
          });
      } catch {
        // the layout change stands; an unused widget node is harmless
      }
    }

    // ---- catalogue drawer ----
    function openCatalogue() {
      const holder = h("div", { class: "rp-catalogue" });
      let q = "";
      let drawer = null;
      const paintList = () => {
        const byDomain = new Map();
        for (const c of catalog) {
          const text = `${c.title} ${c.id} ${c.description}`.toLowerCase();
          if (q && !text.includes(q)) continue;
          if (!byDomain.has(c.domain)) byDomain.set(c.domain, []);
          byDomain.get(c.domain).push(c);
        }
        const groups = [...byDomain.entries()].sort(([a], [b]) => a.localeCompare(b));
        list.replaceChildren(
          ...(groups.length
            ? groups.map(([domain, entries]) =>
                h(
                  "details",
                  { class: "rp-disclosure", open: q || groups.length === 1 ? true : null },
                  h("summary", {}, `${domain[0].toUpperCase()}${domain.slice(1)} (${entries.length})`),
                  h(
                    "ul",
                    { class: "rp-rows", "aria-label": `${domain} widgets` },
                    ...entries.map((c) =>
                      h(
                        "li",
                        { class: `rp-row${c.available ? "" : " is-done"}` },
                        h(
                          "div",
                          { class: "rp-row__main" },
                          h("span", { class: "rp-row__title" }, c.title),
                          h("p", { class: "rp-row__summary" }, c.description),
                          h(
                            "div",
                            { class: "rp-row__meta" },
                            ...c.sizes.map((s) => pill({ label: s })),
                            h("span", { class: "u-mono" }, c.id),
                            c.available
                              ? null
                              : pill({ label: "Not available to you", tone: "warning", icon: "lock" }),
                          ),
                        ),
                        h(
                          "div",
                          { class: "rp-row__side" },
                          button({
                            label: "Add",
                            icon: "plus",
                            size: "sm",
                            variant: "secondary",
                            disabled: !c.available,
                            onClick: () => (drawer.close(), addWidget(c)),
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : [emptyState({ icon: "search", title: "No widgets match", body: "Try another word." })]),
        );
      };
      const list = h("div", { class: "rp-catalogue__list" });
      holder.append(
        searchField({
          name: "q",
          label: "Search widgets",
          placeholder: "Title, id or what it does",
          onInput: debounce((v) => ((q = v.trim().toLowerCase()), paintList()), 150),
        }),
        list,
      );
      paintList();
      drawer = ctx.openDrawer({ title: "Widget catalogue", width: "lg", body: scoped("pages", holder) });
    }

    // ---- adding ----
    async function addWidget(entry, cfg) {
      const defaults = cfg ?? defaultsOf(entry.id);
      if (!validateConfig(entry.id, defaults).ok) {
        openConfigure(null, { entry, config: defaults });
        return;
      }
      await createAndPlace(entry, defaults, "");
    }

    async function createAndPlace(entry, cfg, title) {
      const wslug = `${entry.id.replace(/\./g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
      const body = {
        apiVersion: "plinth/v1",
        kind: "Widget",
        metadata: { slug: wslug, title: title || entry.title },
        spec: { widget: entry.id, config: cfg },
      };
      lastOwnCommit = Date.now();
      let created;
      try {
        created = await api.nodes.create("Widget", wslug, body, { reason: `Add ${entry.title}` });
      } catch (e) {
        toastError(ctx.toast, e, "Could not add the widget");
        return false;
      }
      if (created.status === "pending_approval") {
        notice = heldNotice(created, "Adding the widget", nav);
        paint();
        return true;
      }
      const fp = footprint(entry, entry.default_size);
      const at = findSpot(fp.w, fp.h, items);
      const item = {
        item: `widget:${wslug}`,
        at,
        widget: entry.id,
        title: title || entry.title,
        available: true,
        unavailable_reason: null,
        node: created.nodes?.[0]
          ? { uri: created.nodes[0].uri, revision: created.nodes[0].result_revision }
          : null,
        size: entry.default_size,
        config: cfg,
      };
      focusItem = item.item;
      const ok = await commitLayout([...items, item], {
        reason: `Place ${entry.title}`,
        announceText: `Widget added: ${entry.title}`,
      });
      if (!ok) {
        if (created.nodes?.[0])
          await api.nodes.remove(created.nodes[0].uri, created.nodes[0].result_revision).catch(() => {});
        return false;
      }
      ctx.toast({ title: "Widget added", body: entry.title, tone: "success" });
      await load();
      return true;
    }

    // ---- configure drawer ----
    function openConfigure(i, add) {
      const it = i === null ? null : items[i];
      const entry = add?.entry ?? entryOf(it.widget);
      const schema = entry?.config_schema ?? schemaOf(entry.id);
      const form = configForm({ schema, config: add?.config ?? it?.config ?? {}, widgetId: entry.id });
      const titleField = textField({
        name: "/spec/title",
        label: "Title override",
        value: it && it.title !== entry.title ? it.title : "",
        hint: "Leave empty to use the widget's own title.",
      });
      const body = h(
        "form",
        {
          class: "rp-form",
          "aria-label": `Configure ${entry.title}`,
          novalidate: true,
          onsubmit: (e) => (e.preventDefault(), save()),
        },
        h("p", { class: "u-muted" }, entry.description),
        titleField,
        form.el,
      );
      let drawer;
      const saveBtn = button({
        label: add ? "Create and place" : "Save",
        icon: "check",
        variant: "primary",
        onClick: () => save(),
      });
      const resetBtn = button({
        label: "Reset to defaults",
        variant: "ghost",
        onClick: () => {
          const fresh = configForm({ schema, config: defaultsOf(entry.id), widgetId: entry.id });
          form.el.replaceWith(fresh.el);
          Object.assign(form, fresh);
        },
      });
      async function save() {
        formErrors(null, { form: body });
        const { config: cfg, errors } = form.read();
        if (errors.length) {
          const e = errors[0];
          formErrors(
            { code: "VALIDATION_FAILED", path: e.path, message: e.message },
            { form: body },
          )?.focus();
          return;
        }
        const title = titleField.querySelector("input").value.trim();
        saveBtn.setAttribute("aria-busy", "true");
        if (add) {
          drawer.close();
          await createAndPlace(entry, cfg, title);
          return;
        }
        try {
          const ops = [
            { op: "set", path: "/spec/config", value: cfg },
            ...(title && title !== it.title ? [{ op: "set", path: "/spec/title", value: title }] : []),
          ];
          lastOwnCommit = Date.now();
          const res = await api.nodes.patch(it.node.uri, it.node.revision, ops, {
            reason: `Configure ${it.title}`,
          });
          if (res.status === "pending_approval") notice = heldNotice(res, "The configuration change", nav);
          ctx.toast({ title: "Configuration saved", body: it.title, tone: "success" });
          ctx.announce("Configuration saved");
          drawer.close();
          await load();
        } catch (err) {
          saveBtn.removeAttribute("aria-busy");
          const info = toErrorInfo(err);
          formErrors(
            { code: info.code, path: info.path, message: info.message ?? info.code },
            { form: body },
          )?.focus();
        }
      }
      drawer = ctx.openDrawer({
        title: `Configure ${it?.title ?? entry.title}`,
        width: "lg",
        body: scoped("pages", body),
        footer: h(
          "div",
          { class: "rp-form__actions" },
          resetBtn,
          button({ label: "Cancel", variant: "secondary", onClick: () => drawer.close() }),
          saveBtn,
        ),
      });
    }

    // ---- page-level actions ----
    async function personalize() {
      try {
        const out = await api.call("pages.personalize", { page: slug });
        ctx.toast({ title: "Personal copy created", tone: "success" });
        nav.go(`/pages/${out.page.slug}/edit`);
      } catch (e) {
        const info = toErrorInfo(e);
        if (info.details?.reason === "ALREADY_EXISTS") {
          ctx.toast({ title: "You already have a copy", body: "Opening it.", tone: "info" });
          nav.go(`/pages/${slug}.${ctx.me?.member?.handle ?? ""}/edit`);
        } else toastError(ctx.toast, e, "Could not copy the page");
      }
    }

    async function resetPersonal() {
      const base = resolve.spec.based_on?.replace(/^page:/, "") ?? resolve.personal_of?.slug;
      const yes = await ctx.confirm({
        title: "Reset to the shared default?",
        message: "Your personal copy and its widgets are deleted and the shared page is shown again.",
        confirmLabel: "Reset",
        tone: "danger",
      });
      if (!yes) return;
      try {
        await api.call("pages.reset", { page: base });
        ctx.toast({ title: "Page reset", tone: "success" });
        nav.go(`/pages/${base}/edit`);
      } catch (e) {
        toastError(ctx.toast, e, "Could not reset the page");
      }
    }

    // ---- realtime ----
    const onChanged = debounce(() => {
      if (Date.now() - lastOwnCommit < AUTO_RELOAD_QUIET_MS) return;
      if (dragging || grab) {
        stale = true;
        return;
      }
      load();
    }, 500);
    const offs = [];
    load({ first: true }).then(() => {
      if (!alive || !page) return;
      offs.push(rt.onNode(page.uri, onChanged), rt.onNode("Widget", onChanged));
    });
    return () => {
      alive = false;
      onChanged.cancel();
      for (const off of offs) off();
    };
  },
};
