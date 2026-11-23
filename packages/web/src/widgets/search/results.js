// search.results: grouped global search with type filters, recent searches and keyboard navigation.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { searchField } from "../../ds/js/field.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { pill } from "../../ds/js/pill.js";
import { replaceQuery } from "../../ds/js/tabs.js";
import { toErrorInfo } from "../../core/api.js";
import { current } from "../../core/router.js";
import {
  lifecycle,
  debounce,
  sequence,
  errorText,
  link,
  highlight,
  plural,
  safeIcon,
  SEARCH_TYPES,
  SEARCH_ORDER,
  hitVisual,
} from "../../shell/kit.js";

const RECENT_KEY = "plinth-recent-searches";
const readRecent = () => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
};
const writeRecent = (q) => {
  try {
    const next = [q, ...readRecent().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* recent searches are a convenience */
  }
};

export default {
  id: "search.results",
  domain: "search",
  title: "Search results",
  configSchema: schemaOf("search.results"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const allowed =
      Array.isArray(config.types) && config.types.length ? config.types.filter((t) => SEARCH_TYPES[t]) : null;
    const st = {
      q: typeof config.q === "string" ? config.q : "",
      only: null,
      groups: [],
      searched: false,
      busy: false,
      error: null,
    };
    const root = h("div", { class: "w-search", "data-size": size });
    el.append(root);

    const field = searchField({
      name: "q",
      label: "Search everything",
      value: st.q,
      placeholder: "People, products, orders, tasks, conversations",
      onInput: (v) => {
        st.q = v;
        st.only = null;
        debounced();
      },
    });
    field.classList.add("w-search__field");
    const input = field.querySelector("input");
    input.setAttribute("maxlength", "120");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        debounced.cancel();
        run({ commit: true });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        root.querySelector(".w-hit")?.focus();
      }
    });
    const chips = h("div", { class: "w-seg w-search__chips", role: "group", "aria-label": "Result types" });
    const status = h("p", { class: "w-summary", role: "status" });
    const results = h("div", { class: "w-search__results" });
    const bar = h("div", { class: "w-bar" }, h("div", { class: "w-bar__row" }, field), chips);
    root.append(bar, status, results);

    const debounced = debounce(() => run(), 250);
    life.add(debounced.cancel);

    // ---- searching ----

    async function run({ commit = false } = {}) {
      const q = st.q.trim();
      const mine = seq.next();
      if (!q) {
        st.groups = [];
        st.searched = false;
        st.error = null;
        syncUrl("");
        if (!st.loadedOnce) {
          st.loadedOnce = true;
          ctx.setState("ready");
        }
        paint();
        return;
      }
      st.busy = true;
      root.setAttribute("aria-busy", "true");
      status.textContent = "Searching";
      try {
        const types = st.only ? [st.only] : allowed;
        const out = await api.call("search.global", {
          q,
          ...(types ? { types } : {}),
          limit: st.only ? 20 : 8,
        });
        if (!seq.ok(mine) || life.dead) return;
        st.groups = out.groups;
        st.searched = true;
        st.error = null;
        if (commit) writeRecent(q);
        syncUrl(q);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        st.error = e;
        if (!st.loadedOnce) {
          st.loadedOnce = true;
          ctx.setState("error", { error: toErrorInfo(e) });
          return;
        }
      } finally {
        if (seq.ok(mine)) {
          st.busy = false;
          root.removeAttribute("aria-busy");
        }
      }
      if (!st.loadedOnce) {
        st.loadedOnce = true;
        ctx.setState("ready");
      }
      paint();
      const total = st.groups.reduce((n, g) => n + g.total, 0);
      ctx.setCount(total);
      ctx.announce(total ? `${plural(total, "result")} for ${q}` : `No results for ${q}`);
    }

    /** Keep the address in step with the box on the search page (no navigation, no new history entry). */
    function syncUrl(q) {
      if (!current().path.startsWith("/search")) return;
      replaceQuery("q", q || null);
    }

    // ---- painting ----

    function paintChips() {
      clear(chips);
      chips.hidden = !st.searched || (st.groups.length === 0 && !st.only);
      if (chips.hidden) return;
      const total = st.groups.reduce((n, g) => n + g.total, 0);
      const mk = (label, n, value) => {
        const b = h(
          "button",
          {
            type: "button",
            class: "c-button c-button--secondary c-button--sm w-seg__btn",
            "aria-pressed": String(st.only === value),
            onclick: () => {
              st.only = value;
              run();
            },
          },
          h("span", { class: "c-button__label" }, label),
          n !== null ? h("span", { class: "w-seg__count u-tabular" }, String(n)) : null,
        );
        return b;
      };
      if (st.only) chips.append(mk("All types", null, null));
      else chips.append(mk(`Everything`, total, null));
      const shown = st.only ? [st.only] : st.groups.map((g) => g.type);
      for (const type of SEARCH_ORDER.filter((t) => shown.includes(t))) {
        const g = st.groups.find((x) => x.type === type);
        chips.append(mk(SEARCH_TYPES[type].label, g ? g.total : null, type));
      }
    }

    function hitNode(hit, q) {
      const a = h(
        "a",
        {
          class: "w-hit",
          href: link(hit.href),
          onclick: () => writeRecent(st.q.trim()),
        },
        hitVisual(hit),
        h(
          "span",
          { class: "w-hit__text" },
          h("span", { class: "w-hit__title" }, ...highlight(hit.title, q)),
          hit.subtitle ? h("span", { class: "w-hit__sub" }, ...highlight(hit.subtitle, q)) : null,
        ),
        pill({ label: SEARCH_TYPES[hit.type]?.one ?? hit.type }),
      );
      return h("li", { class: "w-hitrow" }, a);
    }

    function paintRecent() {
      const recent = readRecent();
      if (recent.length === 0) return null;
      return h(
        "section",
        { class: "w-search__recent", "aria-label": "Recent searches" },
        h("h3", { class: "w-feed__daytitle" }, "Recent searches"),
        h(
          "ul",
          { class: "w-chips" },
          ...recent.map((r) =>
            h(
              "li",
              {},
              button({
                label: r,
                icon: "history",
                size: "sm",
                onClick: () => {
                  st.q = r;
                  input.value = r;
                  st.only = null;
                  run({ commit: true });
                },
              }),
            ),
          ),
        ),
      );
    }

    function paint() {
      paintChips();
      clear(results);
      const q = st.q.trim();
      if (!q) {
        status.textContent = "";
        results.append(
          emptyState({
            icon: "search",
            title: "Search the whole suite",
            body: "Find people, groups, products, badges, content, promotions, orders, tasks, conversations and dashboards.",
          }),
        );
        const recent = paintRecent();
        if (recent) results.append(recent);
        return;
      }
      if (st.error) {
        status.textContent = "";
        results.append(
          errorState({
            error: { ...toErrorInfo(st.error), message: errorText(st.error) },
            retry: () => run(),
          }),
        );
        return;
      }
      const groups = [...st.groups]
        .filter((g) => g.items.length)
        .sort((a, b) => SEARCH_ORDER.indexOf(a.type) - SEARCH_ORDER.indexOf(b.type));
      if (groups.length === 0) {
        status.textContent = "";
        results.append(
          emptyState({
            icon: "search",
            title: `No results for ‘${q}’`,
            body: "Check the spelling, try fewer words, or search by handle, order number or product name.",
            action: st.only
              ? button({ label: "Search all types", onClick: () => ((st.only = null), run()) })
              : null,
          }),
        );
        return;
      }
      const total = st.groups.reduce((n, g) => n + g.total, 0);
      status.textContent = `${plural(total, "result")} for ‘${q}’`;
      const wrap = h("div", { class: "w-search__groups" });
      for (const g of groups) {
        const meta = SEARCH_TYPES[g.type] ?? { label: g.type, icon: "search" };
        const id = uid("sg");
        const more = g.total > g.items.length && !st.only;
        wrap.append(
          h(
            "section",
            { class: "w-sgroup", "aria-labelledby": id },
            h(
              "h3",
              { class: "w-sgroup__title", id },
              safeIcon(meta.icon, "search", { size: 16 }),
              h("span", {}, meta.label),
              h("span", { class: "w-seg__count u-tabular" }, String(g.total)),
            ),
            h("ul", { class: "w-hits" }, ...g.items.map((hit) => hitNode(hit, q))),
            more
              ? button({
                  label: `Show all ${g.total}`,
                  icon: "chevron-right",
                  variant: "ghost",
                  size: "sm",
                  onClick: () => {
                    st.only = g.type;
                    run();
                  },
                })
              : null,
          ),
        );
      }
      results.append(wrap);
    }

    // ---- keyboard: arrows move between hits ----

    results.addEventListener("keydown", (e) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const hits = [...results.querySelectorAll(".w-hit")];
      const i = hits.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      if (e.key === "ArrowUp" && i === 0) return input.focus();
      const n =
        e.key === "Home" ? 0 : e.key === "End" ? hits.length - 1 : i + (e.key === "ArrowDown" ? 1 : -1);
      hits[Math.max(0, Math.min(hits.length - 1, n))]?.focus();
    });

    ctx.setState("loading");
    run();
    return () => life.dispose();
  },
};
