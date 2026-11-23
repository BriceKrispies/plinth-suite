import { schemaOf } from "../../core/widgets.js";
import { lifecycle } from "../../shell/kit.js";
import { createThreadView } from "./_thread-view.js";

export default {
  id: "messaging.thread",
  domain: "messaging",
  title: "Conversation",
  configSchema: schemaOf("messaging.thread"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, api, rt, bus, ctx }) {
    const life = lifecycle();
    const view = createThreadView({
      api,
      rt,
      ctx,
      life,
      publish: (topic, payload) => bus.publish(topic, payload),
      emptyBody: "Select a conversation in the inbox, or open one from a notification.",
    });
    el.append(view.el);
    const bound = typeof config.thread === "string" ? config.thread : null;
    view.open(bound ?? bus.latest?.("thread.selected")?.id ?? null);
    life.add(
      bus.subscribe("thread.selected", (payload) => {
        if (payload?.id) view.open(payload.id);
      }),
    );
    return () => life.dispose();
  },
};
