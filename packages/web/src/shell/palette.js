// The command palette (#palette): commands ranked by a fuzzy score, plus live global search results.
// APG combobox, list autocomplete: focus stays in the input, `aria-activedescendant` names the active option.
// Enter runs the active option, Ctrl+Enter opens /search?q=, Escape closes, ">" limits to commands.
import { h, clear, uid } from "../ds/js/dom.js";
import { kbd } from "../ds/js/kbd.js";
import { toast } from "../ds/js/toast.js";
import * as api from "../core/api.js";
import * as router from "../core/router.js";
import { prefsStore, setTheme } from "../core/stores.js";
import { switchTo } from "../core/identity.js";
import { visibleNav } from "./nav.js";
import {
  loadPrincipals,
  targetOf,
  isCurrent,
  openIdentityDialog,
  synchronousPrincipals,
} from "./identity.js";
import {
  safeIcon,
  SEARCH_TYPES,
  SEARCH_ORDER,
  hitVisual,
  debounce,
  sequence,
  errorText,
  highlight,
} from "./kit.js";

/** How well `text` matches `q`: prefix, word prefix, substring, then in-order letters; 0 for no match. */
export const score = (text, q) => {
  const t = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!needle) return 1;
  if (t.startsWith(needle)) return 100 - Math.min(t.length, 40) / 10;
  const word = t.split(/[\s/·:-]+/).findIndex((w) => w.startsWith(needle));
  if (word >= 0) return 80 - word;
  const at = t.indexOf(needle);
  if (at >= 0) return 60 - Math.min(at, 30) / 10;
  let i = 0;
  for (const ch of t) if (ch === needle[i]) i += 1;
  return i === needle.length ? 20 : 0;
};

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export const createPalette = (dialog) => {
  const st = {
    q: "",
    options: [],
    active: 0,
    hits: [],
    searching: false,
    opener: null,
    principals: synchronousPrincipals(),
  };
  const seq = sequence();
  const id = uid("pal");

  // ---- structure, built once ----
  const input = h("input", {
    id: `${id}-in`,
    class: "palette__input",
    type: "text",
    role: "combobox",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: "Search people, products, orders, or type a command",
    "aria-label": "Search or run a command",
    "aria-expanded": "true",
    "aria-controls": `${id}-list`,
    "aria-autocomplete": "list",
  });
  const status = h("p", { class: "sr-only", role: "status" });
  const list = h("ul", {
    class: "palette__list",
    id: `${id}-list`,
    role: "listbox",
    "aria-label": "Results",
  });
  const hint = h(
    "p",
    { class: "palette__hint" },
    h("span", {}, kbd("Up"), " ", kbd("Down"), " move"),
    h("span", {}, kbd("Enter"), " open"),
    h("span", {}, kbd("Ctrl+Enter"), " all results"),
    h("span", {}, kbd(">"), " commands"),
  );
  const box = h(
    "div",
    { class: "palette__box" },
    h("div", { class: "palette__bar" }, safeIcon("search", "search"), input),
    status,
    list,
    hint,
  );
  dialog.replaceChildren(box);
  dialog.setAttribute("aria-label", "Command palette");

  // ---- commands ----

  const go = (path) => () => router.navigate(path);
  const commands = () => {
    const out = [];
    const nav = visibleNav();
    const has = (route) => nav.some((p) => p.route === route);
    for (const p of nav) {
      out.push({
        id: `go:${p.route}`,
        group: "Go to",
        label: p.nav.label,
        hint: p.route,
        icon: p.nav.icon,
        run: go(p.route),
      });
    }
    out.push({
      id: "go:/profile",
      group: "Go to",
      label: "My profile",
      hint: "/profile",
      icon: "user",
      run: go("/profile"),
    });
    const add = (route, label, target, ic, keywords = "") => {
      if (has(route))
        out.push({ id: `act:${target}`, group: "Actions", label, icon: ic, keywords, run: go(target) });
    };
    add("/messages", "New message", "/messages/new", "send", "compose write email");
    add("/tasks", "New task", "/tasks", "task", "add todo");
    add("/points", "Transfer points", "/points", "transfer", "send give");
    add("/promotions", "New promotion", "/promotions/new", "percent", "campaign offer");
    add("/automations", "New automation", "/automations/new", "workflow", "rule flow");
    add("/content", "New content", "/content/new", "document", "article write");
    out.push({
      id: "act:theme",
      group: "Actions",
      label: "Toggle theme",
      hint: "Light or dark",
      icon: "sun",
      keywords: "dark light appearance mode",
      run: () => {
        const t = prefsStore.get().theme;
        const dark = t === "dark" || (t === "auto" && prefersDark());
        setTheme(dark ? "light" : "dark");
      },
    });
    out.push({
      id: "act:read-all",
      group: "Actions",
      label: "Mark all notifications read",
      icon: "check",
      keywords: "clear bell inbox",
      run: async () => {
        try {
          const r = await api.call("notifications.read_all", {});
          toast({
            title: r.marked ? `${r.marked} notifications marked read` : "Nothing to mark read",
            tone: "success",
          });
        } catch (e) {
          toast({ title: "Could not mark all read", body: errorText(e), tone: "danger" });
        }
      },
    });
    out.push({
      id: "act:identity",
      group: "Identity",
      label: "Switch identity…",
      icon: "users",
      keywords: "user person login as",
      run: () => openIdentityDialog(),
    });
    for (const p of st.principals.filter((x) => x.featured && !isCurrent(x))) {
      out.push({
        id: `as:${targetOf(p)}`,
        group: "Identity",
        label: `Switch identity to ${p.display_name}`,
        icon: "user",
        keywords: `${p.roles.join(" ")} ${p.region ?? ""}`,
        run: () => switchTo(targetOf(p)),
      });
    }
    return out;
  };

  // ---- options ----

  const build = () => {
    const raw = st.q;
    const commandsOnly = raw.startsWith(">");
    const q = (commandsOnly ? raw.slice(1) : raw).trim();
    const all = commands();
    const ranked = all
      .map((c) => ({
        c,
        s: Math.max(score(c.label, q), score(c.keywords ?? "", q) * 0.6, score(c.hint ?? "", q) * 0.5),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    const shownCommands = q
      ? ranked.slice(0, 6)
      : ranked
          .filter((c) => c.group === "Go to")
          .slice(0, 8)
          .concat(ranked.filter((c) => c.group === "Actions").slice(0, 4));
    const options = [];
    if (shownCommands.length) options.push({ heading: q ? "Commands" : "Suggested" });
    for (const c of shownCommands) options.push({ kind: "command", command: c });
    if (!commandsOnly && q) {
      for (const type of SEARCH_ORDER) {
        const g = st.hits.find((x) => x.type === type);
        if (!g?.items.length) continue;
        options.push({ heading: SEARCH_TYPES[type].label, total: g.total });
        for (const hit of g.items) options.push({ kind: "hit", hit });
      }
    }
    st.options = options;
    st.q2 = q;
    const selectable = options.filter((o) => o.kind);
    st.active = Math.min(st.active, Math.max(0, selectable.length - 1));
    return { q, commandsOnly };
  };

  const paint = () => {
    const { q } = build();
    clear(list);
    let n = 0;
    for (const o of st.options) {
      if (o.heading) {
        list.append(
          h(
            "li",
            { class: "palette__group", role: "presentation" },
            o.heading,
            o.total > 5 ? h("span", { class: "palette__total u-tabular" }, ` ${o.total}`) : null,
          ),
        );
        continue;
      }
      const index = n;
      n += 1;
      const li = h("li", {
        class: "palette__opt",
        role: "option",
        id: `${id}-o-${index}`,
        "aria-selected": String(index === st.active),
        "data-index": String(index),
      });
      if (o.kind === "command") {
        li.append(
          h("span", { class: "palette__icon" }, safeIcon(o.command.icon, "command")),
          h(
            "span",
            { class: "palette__text" },
            h("span", { class: "palette__title" }, ...highlight(o.command.label, q)),
            o.command.hint ? h("span", { class: "palette__sub" }, o.command.hint) : null,
          ),
          h("span", { class: "palette__kind" }, o.command.group),
        );
      } else {
        li.append(
          hitVisual(o.hit, { size: "sm" }),
          h(
            "span",
            { class: "palette__text" },
            h("span", { class: "palette__title" }, ...highlight(o.hit.title, q)),
            o.hit.subtitle ? h("span", { class: "palette__sub" }, o.hit.subtitle) : null,
          ),
          h("span", { class: "palette__kind" }, SEARCH_TYPES[o.hit.type]?.one ?? o.hit.type),
        );
      }
      li.addEventListener("pointermove", () => {
        if (st.active !== index) {
          st.active = index;
          mark();
        }
      });
      li.addEventListener("click", () => choose(index));
      list.append(li);
    }
    if (n === 0) {
      list.append(
        h(
          "li",
          { class: "palette__empty", role: "presentation" },
          st.searching
            ? "Searching"
            : q
              ? `Nothing matches ‘${q}’. Press Ctrl+Enter to search everywhere.`
              : "Nothing to show.",
        ),
      );
    }
    status.textContent = st.searching ? "Searching" : `${n} results`;
    mark();
  };

  const mark = () => {
    const opts = [...list.querySelectorAll("[role=option]")];
    opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === st.active)));
    const cur = opts[st.active];
    if (cur) {
      input.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const selectable = () => st.options.filter((o) => o.kind);
  function choose(index) {
    const o = selectable()[index];
    if (!o) return;
    close();
    if (o.kind === "command") o.command.run();
    else router.navigate(o.hit.href);
  }

  // ---- search ----

  const search = debounce(async () => {
    const q = st.q2;
    const mine = seq.next();
    if (!q || st.q.startsWith(">")) {
      st.hits = [];
      st.searching = false;
      paint();
      return;
    }
    try {
      const out = await api.call("search.global", { q, limit: 4 });
      if (!seq.ok(mine)) return;
      st.hits = out.groups;
    } catch {
      if (!seq.ok(mine)) return;
      st.hits = [];
    }
    st.searching = false;
    paint();
  }, 180);

  input.addEventListener("input", () => {
    st.q = input.value;
    st.active = 0;
    const q = (st.q.startsWith(">") ? st.q.slice(1) : st.q).trim();
    st.searching = Boolean(q) && !st.q.startsWith(">");
    st.q2 = q;
    if (!st.searching) st.hits = [];
    paint();
    search();
  });

  input.addEventListener("keydown", (e) => {
    const count = selectable().length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (count) st.active = (st.active + 1) % count;
      mark();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (count) st.active = (st.active - 1 + count) % count;
      mark();
    } else if (e.key === "Home" && !input.value) {
      e.preventDefault();
      st.active = 0;
      mark();
    } else if (e.key === "End" && !input.value) {
      e.preventDefault();
      st.active = Math.max(0, count - 1);
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const q = st.q.replace(/^>/, "").trim();
        close();
        router.navigate(q ? router.href("/search", { q }) : "/search");
      } else choose(st.active);
    }
  });

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener("close", () => {
    const opener = st.opener;
    st.opener = null;
    if (opener && document.contains(opener) && typeof opener.focus === "function") opener.focus();
  });

  // ---- open and close ----

  function open() {
    if (dialog.open) return;
    st.opener = document.activeElement;
    st.q = "";
    st.q2 = "";
    st.hits = [];
    st.active = 0;
    st.searching = false;
    input.value = "";
    st.principals = synchronousPrincipals();
    loadPrincipals().then((items) => {
      st.principals = items;
      if (dialog.open && !st.q) paint();
    });
    paint();
    dialog.showModal();
    input.focus();
  }
  function close() {
    if (dialog.open) dialog.close();
  }

  return { open, close, toggle: () => (dialog.open ? close() : open()), isOpen: () => dialog.open };
};
