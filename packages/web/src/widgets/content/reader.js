// content.reader: one published item rendered from its blocks with reactions. Follows content.selected.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { lifecycle } from "../promotions/_kit.js";
import { mountReader } from "./_reader.js";

export default {
  id: "content.reader",
  domain: "content",
  title: "Article",
  configSchema: schemaOf("content.reader"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const host = h("div", { class: `wn wn-readerwidget wn-readerwidget--${size}` });
    el.append(host);
    const fixed = typeof config.content === "string" ? config.content : null;
    const reader = mountReader(host, { api, rt, ctx, life, nav, toc: size !== "l", idPrefix: "reader" });
    reader.load(fixed ?? bus.latest?.("content.selected")?.id ?? null);
    life.add(
      bus.subscribe("content.selected", ({ id }) => {
        if (!id || fixed || id === reader.current()) return;
        reader.load(id);
      }),
    );
    return () => life.dispose();
  },
};
