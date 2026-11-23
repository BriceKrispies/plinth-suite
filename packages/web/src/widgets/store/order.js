// store.order: one order with its lines, promotions, timeline and the transitions the server allows.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { emptyState, skeleton } from "../../ds/js/states.js";
import { disposer, reportLoadError } from "../points/_kit.js";
import { orderDetailView } from "./_order.js";

export default {
  id: "store.order",
  domain: "store",
  title: "Order",
  configSchema: schemaOf("store.order"),
  sizes: ["l", "xl", "full"],
  mount(el, { config, size, api, rt, bus, ctx }) {
    const life = disposer();
    const root = h("div", { class: `w-store w-store-order-widget w-store-order-widget--${size}` });
    el.append(root);
    if (!ctx.can("store:shop")) {
      root.append(emptyState({ icon: "lock", title: "Orders are not available for your role" }));
      return () => {};
    }
    let id = typeof config.order === "string" ? config.order : null;
    let order = null;
    let seqs = new Set();
    let seq = 0;

    const draw = ({ focus = false, arrivedSeqs } = {}) => {
      clear(root);
      root.append(
        orderDetailView({
          order,
          api,
          ctx,
          life,
          arrivedSeqs,
          backLabel: "Back",
          onUpdated: (res) => {
            if (res) {
              const before = seqs;
              order = res;
              seqs = new Set(res.events.map((e) => e.seq));
              draw({ arrivedSeqs: new Set([...seqs].filter((s) => !before.has(s))) });
            } else load({ silent: true });
          },
        }),
      );
      if (focus) root.querySelector("[data-focus]")?.focus();
    };

    const load = async ({ initial = false, silent = false } = {}) => {
      if (!id) {
        clear(root);
        root.append(
          emptyState({
            icon: "box",
            title: "No order selected",
            body: "Choose an order to see its details.",
          }),
        );
        return;
      }
      const mine = ++seq;
      if (!silent) {
        clear(root);
        root.append(skeleton({ lines: 5 }));
      }
      try {
        const o = await api.call("orders.get", { order_id: id });
        if (life.done || mine !== seq) return;
        const before = seqs;
        order = o;
        seqs = new Set(o.events.map((e) => e.seq));
        ctx.setState("ready");
        ctx.setTitle(`Order ${o.order_no}`);
        draw({
          focus: !silent && !initial,
          arrivedSeqs: silent ? new Set([...seqs].filter((s) => !before.has(s))) : undefined,
        });
      } catch (e) {
        if (life.done || mine !== seq) return;
        reportLoadError({
          ctx,
          host: root,
          error: e,
          retry: () => load({ initial: true }),
          initial: initial || !order,
        });
      }
    };

    life.add(
      rt.on("order.status_changed", (ev) => {
        if (ev.payload.order_id === id) load({ silent: true });
      }),
    );
    life.add(
      bus.subscribe("order.selected", (p) => {
        if (!p?.id || p.id === id) return;
        id = p.id;
        order = null;
        load();
      }),
    );
    const latest = bus.latest?.("order.selected");
    if (!id && latest?.id) id = latest.id;
    load({ initial: true });
    return life.dispose;
  },
};
