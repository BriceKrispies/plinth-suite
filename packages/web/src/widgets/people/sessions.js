// people.sessions: your own browser and MCP sessions, with revoke.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { emptyState } from "../../ds/js/states.js";
import { pill } from "../../ds/js/pill.js";
import { toErrorInfo } from "../../core/api.js";
import { lifecycle, sequence, ago, when, errorText, plural, safeIcon, arrive } from "../../shell/kit.js";

const SURFACE = {
  ui: { label: "Browser", icon: "globe" },
  mcp: { label: "Agent (MCP)", icon: "workflow" },
  api: { label: "API", icon: "webhook" },
};

export default {
  id: "people.sessions",
  domain: "people",
  title: "Security sessions",
  configSchema: schemaOf("people.sessions"),
  sizes: ["m", "l"],
  mount(el, { size, api, rt, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const st = { items: [], loaded: false, busy: new Set(), showRevoked: false };
    const root = h("div", { class: "w-sess", "data-size": size });
    el.append(root);

    async function load({ live = false } = {}) {
      const mine = seq.next();
      try {
        const out = await api.call("me.sessions");
        if (!seq.ok(mine) || life.dead) return;
        const before = new Set(st.items.map((s) => s.session_id));
        st.items = out.items;
        ctx.setCount(out.items.filter((s) => !s.revoked_at).length);
        if (!st.loaded) {
          st.loaded = true;
          ctx.setState("ready");
        }
        paint(live ? out.items.filter((s) => !before.has(s.session_id)).map((s) => s.session_id) : []);
      } catch (e) {
        if (!seq.ok(mine) || life.dead || live) return;
        if (!st.loaded) ctx.setState("error", { error: toErrorInfo(e) });
      }
    }

    async function revoke(s) {
      const ok = await ctx.confirm({
        title: s.current ? "Sign out of this tab?" : "Revoke this session?",
        message: s.current
          ? "This tab will be signed out straight away. You will need to reload to start again."
          : `“${s.label}” will be signed out and its requests will stop working.`,
        confirmLabel: s.current ? "Sign out this tab" : "Revoke session",
        tone: "danger",
      });
      if (!ok || life.dead) return;
      st.busy.add(s.session_id);
      paint();
      try {
        const out = await api.call("me.sessions.revoke", { session_id: s.session_id });
        if (life.dead) return;
        const row = st.items.find((x) => x.session_id === s.session_id);
        if (row) row.revoked_at = out.revoked_at;
        ctx.announce("Session revoked");
        ctx.toast({ title: "Session revoked", body: s.label, tone: "success" });
      } catch (e) {
        if (life.dead) return;
        ctx.toast({ title: "Could not revoke the session", body: errorText(e), tone: "danger" });
      } finally {
        st.busy.delete(s.session_id);
        if (!life.dead) paint();
      }
    }

    async function revokeOthers() {
      const others = st.items.filter((s) => !s.current && !s.revoked_at);
      if (others.length === 0) return;
      const ok = await ctx.confirm({
        title: `Revoke ${plural(others.length, "other session")}?`,
        message: "Every session except this tab will be signed out.",
        confirmLabel: "Revoke all others",
        tone: "danger",
      });
      if (!ok || life.dead) return;
      let failed = 0;
      for (const s of others) {
        st.busy.add(s.session_id);
        paint();
        try {
          const out = await api.call("me.sessions.revoke", { session_id: s.session_id });
          const row = st.items.find((x) => x.session_id === s.session_id);
          if (row) row.revoked_at = out.revoked_at;
        } catch {
          failed += 1;
        } finally {
          st.busy.delete(s.session_id);
        }
        if (life.dead) return;
      }
      paint();
      if (failed) ctx.toast({ title: `${plural(failed, "session")} could not be revoked`, tone: "danger" });
      else ctx.toast({ title: `${plural(others.length, "session")} revoked`, tone: "success" });
    }

    const rowNode = (s, arrivedIds) => {
      const info = SURFACE[s.surface] ?? SURFACE.api;
      const revoked = Boolean(s.revoked_at);
      const li = h(
        "li",
        { class: `w-srow${revoked ? " w-srow--revoked" : ""}`, "data-id": s.session_id },
        h("span", { class: "w-srow__icon" }, safeIcon(info.icon, "globe")),
        h(
          "div",
          { class: "w-srow__text" },
          h(
            "span",
            { class: "w-srow__line" },
            h("strong", {}, s.label || info.label),
            s.current ? pill({ label: "This tab", tone: "info" }) : null,
            pill({ label: info.label }),
            revoked ? pill({ label: "Revoked", tone: "neutral" }) : null,
          ),
          h(
            "span",
            { class: "w-srow__sub" },
            `Started ${ago(s.created_at)} · last seen `,
            h("time", { datetime: s.last_seen_at, title: when(s.last_seen_at) }, ago(s.last_seen_at)),
            revoked ? ` · revoked ${ago(s.revoked_at)}` : "",
          ),
        ),
        revoked
          ? null
          : button({
              label: s.current ? "Sign out" : "Revoke",
              variant: "danger",
              size: "sm",
              busy: st.busy.has(s.session_id),
              onClick: () => revoke(s),
            }),
      );
      if (arrivedIds.includes(s.session_id)) arrive(li, life);
      return li;
    };

    function paint(arrivedIds = []) {
      clear(root);
      const active = st.items
        .filter((s) => !s.revoked_at)
        .sort(
          (a, b) => Number(b.current) - Number(a.current) || b.last_seen_at.localeCompare(a.last_seen_at),
        );
      const revoked = st.items
        .filter((s) => s.revoked_at)
        .sort((a, b) => b.revoked_at.localeCompare(a.revoked_at));
      if (st.items.length === 0) {
        root.append(
          emptyState({
            icon: "shield",
            title: "No sessions",
            body: "Browser tabs and agent connections are listed here.",
          }),
        );
        return;
      }
      const others = active.filter((s) => !s.current).length;
      root.append(
        h(
          "div",
          { class: "w-sess__head" },
          h("p", { class: "w-hint", role: "status" }, `${plural(active.length, "active session")}`),
          others
            ? button({
                label: "Revoke all others",
                icon: "logout",
                variant: "danger",
                size: "sm",
                onClick: revokeOthers,
              })
            : null,
        ),
        h(
          "ul",
          { class: "w-slist", "aria-label": "Active sessions" },
          ...active.map((s) => rowNode(s, arrivedIds)),
        ),
      );
      if (revoked.length) {
        const det = h(
          "details",
          { class: "w-sess__revoked" },
          h("summary", {}, `Revoked (${revoked.length})`),
          h(
            "ul",
            { class: "w-slist", "aria-label": "Revoked sessions" },
            ...revoked.map((s) => rowNode(s, [])),
          ),
        );
        det.open = st.showRevoked;
        det.addEventListener("toggle", () => (st.showRevoked = det.open));
        root.append(det);
      }
    }

    life.add(rt.on("session.revoked", () => load({ live: true })));
    life.interval(() => st.loaded && !root.contains(document.activeElement) && paint(), 60_000);

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
