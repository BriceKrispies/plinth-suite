import { describeNode } from "./board.js";
import { h, icon } from "./dom.js";
import { clock } from "./format.js";

const MAX_ITEMS = 40;

const KIND = {
  live: { label: "Live", icon: "live" },
  replay: { label: "Replay", icon: "replay" },
  ui: { label: "UI", icon: "ui" },
};

/** live: an agent change over MCP; replay: driver playback; everything else is a human at the UI. */
export const classify = (event) => (event.surface === "mcp" ? "live" : event.surface === "driver" ? "replay" : "ui");

/**
 * The trace ribbon: newest change first, one instrument cell per event. Backfilled events (history
 * seeded on connect) are drawn without the arrival highlight; only events pushed live get it.
 */
export const createTrace = ({ list, headOutput, titles }) => {
  const seen = new Set();
  const empty = list.parentElement.querySelector(".trace-empty");

  const cellFor = (event) => {
    const type = classify(event);
    const node = describeNode(event.node, titles());
    const rules = event.rule_id ?? [];
    return h(
      "li",
      { class: "trace-cell", "data-type": type, "data-new": event.backfill ? null : "" },
      h("p", { class: "trace-seq" }, h("span", { class: "trace-seq-label" }, "seq"), h("span", { class: "trace-seq-num" }, String(event.seq))),
      h(
        "div",
        { class: "trace-main" },
        h("p", { class: "trace-line" }, h("span", { class: "tag", "data-type": type }, icon(KIND[type].icon), KIND[type].label), h("span", { class: "trace-actor" }, event.actor), event.on_behalf_of ? h("span", { class: "trace-behalf" }, `for ${event.on_behalf_of}`) : null),
        h("p", { class: "trace-what" }, h("span", { class: "trace-node-kind" }, node.kind), h("span", { class: "trace-node-title" }, node.title)),
        h("p", { class: "trace-ops" }, event.ops_summary),
        rules.length ? h("p", { class: "trace-rules" }, rules.map((r) => h("code", { class: "rule" }, r))) : null,
      ),
      h("time", { class: "trace-time", datetime: new Date().toISOString() }, event.backfill ? "earlier" : clock(Date.now())),
    );
  };

  return {
    add(events) {
      const fresh = events.filter((e) => !seen.has(e.seq)).sort((a, b) => a.seq - b.seq);
      for (const event of fresh) {
        seen.add(event.seq);
        list.prepend(cellFor(event));
        if (empty) empty.hidden = true;
      }
      while (list.children.length > MAX_ITEMS) list.lastElementChild.remove();
    },
    setHead(seq) {
      headOutput.textContent = String(seq);
    },
  };
};
