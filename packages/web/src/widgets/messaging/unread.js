// messaging.unread: the unread count and the latest three unread conversations.
import { schemaOf } from "../../core/widgets.js";
import { h, clear } from "../../ds/js/dom.js";
import { avatar } from "../../ds/js/avatar.js";
import { linkButton } from "../../ds/js/button.js";
import { emptyState } from "../../ds/js/states.js";
import { toErrorInfo } from "../../core/api.js";
import { lifecycle, debounce, sequence, ago, link, markArrived, plural, clip } from "../../shell/kit.js";

export default {
  id: "messaging.unread",
  domain: "messaging",
  title: "Unread messages",
  configSchema: schemaOf("messaging.unread"),
  sizes: ["s", "m"],
  mount(el, { size, api, rt, bus, nav, ctx }) {
    const life = lifecycle();
    const seq = sequence();
    const root = h("div", { class: "w-unread", "data-size": size });
    el.append(root);
    let shown = new Map();
    let loaded = false;

    const open = (t) => {
      bus.publish("thread.selected", { id: t.thread_id });
      nav.go(`/messages/t/${t.thread_id}`);
    };

    const paint = (count, items, arrivedIds = []) => {
      clear(root);
      const figure = h(
        "p",
        { class: "w-unread__figure" },
        h("span", { class: "w-unread__n u-tabular" }, String(count)),
        h("span", { class: "w-unread__label" }, count === 1 ? "unread conversation" : "unread conversations"),
      );
      if (size === "s") {
        root.append(
          figure,
          ...[
            items[0]
              ? h(
                  "p",
                  { class: "w-unread__latest" },
                  clip(`${items[0].last_sender.display_name}: ${items[0].subject}`, 60),
                )
              : null,
          ].filter(Boolean),
          linkButton({
            href: link("/messages"),
            label: "Open inbox",
            icon: "inbox",
            variant: count ? "primary" : "secondary",
            size: "sm",
          }),
        );
        return;
      }
      root.append(figure);
      if (items.length === 0) {
        root.append(
          emptyState({ icon: "check-circle", title: "All caught up", body: "No unread conversations." }),
        );
      } else {
        const list = h("ul", { class: "w-unread__list", "aria-label": "Latest unread conversations" });
        for (const t of items) {
          const li = h(
            "li",
            { class: "w-unread__item", "data-id": t.thread_id },
            h(
              "button",
              { type: "button", class: "w-unread__open", onclick: () => open(t) },
              avatar({ name: t.last_sender.display_name, avatar: t.last_sender.avatar, size: "md" }),
              h(
                "span",
                { class: "w-unread__text" },
                h("span", { class: "w-unread__subject" }, t.subject),
                h(
                  "span",
                  { class: "w-unread__preview" },
                  `${t.last_sender.display_name}: ${clip(t.preview, 90)}`,
                ),
              ),
              h("time", { class: "w-unread__time", datetime: t.last_message_at }, ago(t.last_message_at)),
            ),
          );
          if (arrivedIds.includes(t.thread_id)) markArrived(li, life, ".w-unread__text");
          list.append(li);
        }
        root.append(list);
      }
      root.append(
        h(
          "div",
          { class: "w-unread__foot" },
          linkButton({
            href: link("/messages"),
            label: count > items.length ? `All ${count} in inbox` : "Open inbox",
            icon: "inbox",
            size: "sm",
          }),
          linkButton({
            href: link("/messages/new"),
            label: "New message",
            icon: "plus",
            variant: "ghost",
            size: "sm",
          }),
        ),
      );
    };

    const load = async (live = false) => {
      const mine = seq.next();
      try {
        const out = await api.call("messages.list", { folder: "inbox", unread_only: true, limit: 3 });
        if (!seq.ok(mine) || life.dead) return;
        const arrivedIds = live
          ? out.items
              .filter((t) => !shown.has(t.thread_id) || shown.get(t.thread_id) !== t.last_message_at)
              .map((t) => t.thread_id)
          : [];
        shown = new Map(out.items.map((t) => [t.thread_id, t.last_message_at]));
        const count = out.folder_counts.inbox_unread;
        ctx.setCount(count);
        paint(count, out.items, arrivedIds);
        if (!loaded) {
          loaded = true;
          ctx.setState("ready");
        }
        if (live && arrivedIds.length) ctx.announce(`${plural(arrivedIds.length, "new message")}`);
      } catch (e) {
        if (!seq.ok(mine) || life.dead) return;
        if (!loaded) ctx.setState("error", { error: toErrorInfo(e) });
      }
    };
    const refresh = debounce(() => load(true), 250);
    life.add(refresh.cancel);
    life.add(rt.on("message.received", refresh));
    life.add(rt.on("message.state_changed", refresh));

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
