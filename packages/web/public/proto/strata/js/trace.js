import { h } from "./dom.js";

const MAX_ITEMS = 40;

/** The tag comes from the transport (actor and surface), never from timing. */
export const tagOf = (e) => (e.surface === "mcp" ? "live" : e.surface === "driver" ? "replay" : e.surface === "ui" ? "ui" : e.surface);

export const actorLabel = (actor) => actor.replace(/^(user|service):/, "").replace(/^agent:/, "agent · ");

const kindOf = (uri) => /\/([A-Za-z]+)\/[^/]+$/.exec(uri)?.[1] ?? "Node";
export const shortId = (uri) => uri.slice(-8);

/**
 * The trace ribbon: recent change events, newest first, built as an instrument. New items are prepended so a
 * polite live region announces only the addition.
 */
export function createTrace(root) {
  const list = root.querySelector("[data-trace-list]");
  const empty = root.querySelector("[data-trace-empty]");
  const audit = root.querySelector("[data-trace-audit]");
  const seen = new Set();

  const trim = () => {
    while (list.children.length > MAX_ITEMS) list.lastElementChild.remove();
  };

  const beat = (e, titleOf) => {
    const tag = tagOf(e);
    const title = h("span", { class: "beat__title", dataset: { uri: e.node } }, titleOf(e.node));
    return h("li", { class: "beat", dataset: { tag } },
      h("span", { class: "beat__seq" }, h("span", { "aria-hidden": "true" }, "#"), String(e.seq)),
      h("span", { class: "beat__tag" }, tag === "live" ? h("span", { class: "beat__pulse", "aria-hidden": "true" }) : null, tag),
      h("p", { class: "beat__who" }, h("strong", null, actorLabel(e.actor)),
        e.rule_id.length ? h("span", { class: "beat__rule" }, e.rule_id.join(" ")) : null),
      h("p", { class: "beat__what" }, h("span", { class: "beat__kind" }, kindOf(e.node)), " ", title),
      h("p", { class: "beat__ops", title: e.ops_summary }, e.ops_summary));
  };

  return {
    /** Add events as they arrive from the socket; oldest first within the batch so the newest ends up on top. */
    add(events, titleOf) {
      const fresh = events.filter((e) => !seen.has(e.seq)).sort((a, b) => a.seq - b.seq);
      for (const e of fresh) {
        seen.add(e.seq);
        list.prepend(beat(e, titleOf));
      }
      if (fresh.length > 0) {
        empty.hidden = true;
        trim();
      }
    },
    /** A locally generated row (brush, parameter edit): session state, never a commit. */
    addSession(text) {
      empty.hidden = true;
      list.prepend(h("li", { class: "beat", dataset: { tag: "session" } },
        h("span", { class: "beat__seq" }, "—"),
        h("span", { class: "beat__tag" }, "session"),
        h("p", { class: "beat__who" }, h("strong", null, "this view")),
        h("p", { class: "beat__what" }, text)));
      trim();
    },
    retitle(titleOf) {
      for (const node of list.querySelectorAll(".beat__title")) node.textContent = titleOf(node.dataset.uri);
    },
    setAudit(state) {
      audit.dataset.state = state;
      audit.textContent =
        state === "ok" ? "Audit chain verified" : state === "bad" ? "Audit chain check failed" : "Audit chain unavailable";
    },
    show() {
      root.hidden = false;
    },
  };
}
