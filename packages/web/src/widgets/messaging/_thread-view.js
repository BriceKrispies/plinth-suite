// The conversation view shared by messaging.thread and messaging.inbox (when it opens threads inside itself).
// One instance shows one thread at a time: header with actions, the messages, and a sticky reply box.
import { h, clear } from "../../ds/js/dom.js";
import { button, iconButton } from "../../ds/js/button.js";
import { pill } from "../../ds/js/pill.js";
import { emptyState, errorState } from "../../ds/js/states.js";
import { textArea, formErrors } from "../../ds/js/field.js";
import { inlineText } from "../../ds/js/richtext.js";
import { menuButton } from "../../ds/js/menu.js";
import { avatarStack } from "../../ds/js/avatar.js";
import { toErrorInfo } from "../../core/api.js";
import {
  ago,
  when,
  safeIcon,
  errorText,
  arrive,
  newPill,
  fmtBytes,
  link,
  charCounter,
  attachMentions,
  attachmentPicker,
  recipientPicker,
  markThreadOpen,
  personLine,
  plural,
  myHandle,
} from "../../shell/kit.js";

const KIND = {
  direct: "Direct",
  group: "Group",
  broadcast: "Broadcast",
  system: "System",
};

export const createThreadView = ({
  api,
  rt,
  ctx,
  life,
  publish,
  onBack,
  emptyBody,
  allowAddPeople = true,
  listenSent = false,
}) => {
  const root = h("div", { class: "w-thread" });
  const drafts = new Map();
  let threadId = null;
  let data = null;
  let seen = new Set();
  let loadSeq = 0;
  let replyTo = null;
  let intentKey = null;
  let busy = false;
  let releaseOpen = () => {};
  let picker = null;
  let attach = null;
  let mentions = null;
  let skipAutoRead = false;

  const people = () => {
    const map = new Map();
    for (const p of data?.participants ?? []) if (p.person.handle) map.set(p.person.handle, p.person);
    for (const m of data?.messages ?? []) if (m.sender.handle) map.set(m.sender.handle, m.sender);
    return [...map.values()];
  };

  // ---- states ----

  const showEmpty = () => {
    releaseOpen();
    releaseOpen = () => {};
    threadId = null;
    data = null;
    clear(root);
    root.append(
      emptyState({
        icon: "inbox",
        title: "No conversation selected",
        body: emptyBody ?? "Pick a conversation from your inbox to read it here.",
        action: null,
      }),
    );
  };

  const showError = (e) => {
    clear(root);
    const info = toErrorInfo(e);
    root.append(
      errorState({
        error: { ...info, message: errorText(e) },
        retry: () => load({ force: true }),
      }),
    );
  };

  // ---- loading ----

  const load = async ({ force = false, live = false } = {}) => {
    const id = threadId;
    if (!id) return showEmpty();
    const mine = ++loadSeq;
    if (!live) {
      clear(root);
      root.append(h("p", { class: "c-state c-state--loading", role: "status" }, "Loading conversation"));
    }
    let out;
    try {
      out = await api.call("messages.thread", { thread_id: id });
    } catch (e) {
      if (mine !== loadSeq || life.dead) return;
      if (live) return;
      return showError(e);
    }
    if (mine !== loadSeq || life.dead) return;
    const fresh = out.messages.filter((m) => !seen.has(m.message_id)).map((m) => m.message_id);
    const first = !data || data.thread.thread_id !== id || force;
    data = out;
    const arrived = first ? [] : fresh;
    seen = new Set(out.messages.map((m) => m.message_id));
    paint({ arrived, first });
    if (!skipAutoRead && out.messages.some((m) => !m.read_by_me)) {
      api.call("messages.state", { thread_id: id, read: true }).catch(() => {});
    }
    if (arrived.length && live) {
      const last = out.messages.find((m) => m.message_id === arrived[arrived.length - 1]);
      if (last && last.sender.handle !== myHandle())
        ctx.announce(`New message from ${last.sender.display_name}`);
    }
  };

  const open = (id, opts = {}) => {
    if (id === threadId && !opts.force) return;
    if (threadId && mentions) drafts.set(threadId, root.querySelector("textarea")?.value ?? "");
    releaseOpen();
    threadId = id ?? null;
    replyTo = null;
    intentKey = null;
    skipAutoRead = false;
    data = null;
    seen = new Set();
    if (!threadId) return showEmpty();
    releaseOpen = markThreadOpen(threadId);
    load({ force: true });
  };

  // ---- thread state changes (optimistic) ----

  const setState = async (patch, doneText) => {
    if (!data) return;
    const before = { ...data.thread };
    Object.assign(data.thread, patch);
    paintHead();
    try {
      await api.call("messages.state", { thread_id: threadId, ...patch });
      if (doneText) ctx.announce(doneText);
    } catch (e) {
      if (life.dead) return;
      data.thread = before;
      paintHead();
      ctx.toast({ title: "Could not update the conversation", body: errorText(e), tone: "danger" });
    }
  };

  // ---- header ----

  const head = h("header", { class: "w-thread__head" });
  const headHost = () => root.querySelector(".w-thread__head") ?? head;

  const participantPanel = () => {
    const rows = data.participants.map((p) =>
      h(
        "li",
        { class: "w-parts__row" },
        publish
          ? h(
              "button",
              {
                type: "button",
                class: "w-parts__pick",
                disabled: p.person.handle ? null : true,
                "aria-label": `Select ${p.person.display_name}`,
                onclick: () => {
                  publish("member.selected", { id: p.person.handle });
                  ctx.announce(`${p.person.display_name} selected`);
                },
              },
              personLine(p.person, { href: false }),
            )
          : personLine(p.person, { href: false }),
        h(
          "span",
          { class: "w-parts__role" },
          p.role === "from" ? "From" : p.role === "to" ? "To" : "Cc",
          p.via_group ? ` · via ${p.via_group}` : "",
        ),
        p.person.handle
          ? h("a", { class: "w-parts__link", href: link(`/people/${p.person.handle}`) }, "Profile")
          : null,
      ),
    );
    return h("ul", { class: "w-parts" }, ...rows);
  };

  const paintHead = () => {
    const t = data.thread;
    const el = headHost();
    clear(el);
    const actions = [
      iconButton({
        icon: "star",
        label: t.starred ? "Remove star" : "Star conversation",
        pressed: t.starred,
        onClick: () => setState({ starred: !t.starred }, t.starred ? "Star removed" : "Starred"),
      }),
      menuButton({
        label: "Conversation actions",
        icon: "more",
        iconOnly: true,
        variant: "ghost",
        items: [
          {
            label: t.archived ? "Move to inbox" : "Archive",
            icon: "archive",
            onSelect: async () => {
              await setState({ archived: !t.archived }, t.archived ? "Moved to inbox" : "Archived");
              if (!t.archived) onBack?.();
            },
          },
          {
            label: t.muted ? "Unmute notifications" : "Mute notifications",
            icon: t.muted ? "bell" : "eye-off",
            onSelect: () => setState({ muted: !t.muted }, t.muted ? "Unmuted" : "Muted"),
          },
          {
            label: "Mark unread",
            icon: "inbox",
            onSelect: async () => {
              skipAutoRead = true;
              await setState({ read: false }, "Marked unread");
              onBack?.();
            },
          },
        ],
      }),
    ];
    if (onBack) {
      const back = button({
        label: "Back",
        icon: "chevron-left",
        variant: "ghost",
        size: "sm",
        onClick: onBack,
      });
      back.classList.add("w-thread__back");
      el.append(back);
    }
    el.append(
      h(
        "div",
        { class: "w-thread__title" },
        h("h3", { class: "w-thread__subject" }, t.subject),
        h(
          "p",
          { class: "w-thread__meta" },
          pill({ label: KIND[t.kind] ?? t.kind }),
          t.muted ? pill({ label: "Muted", icon: "eye-off" }) : null,
          h("span", {}, plural(t.message_count, "message")),
        ),
      ),
      h("div", { class: "w-thread__actions" }, ...actions),
    );
    const parts = h(
      "details",
      { class: "w-thread__people" },
      h(
        "summary",
        {},
        avatarStack(data.participants.map((p) => p.person)),
        h("span", {}, plural(data.participants.length, "participant")),
      ),
      participantPanel(),
    );
    el.append(parts);
  };

  // ---- messages ----

  const messageNode = (m, arrivedIds) => {
    const mine = m.sender.handle && m.sender.handle === myHandle();
    const quoted = m.reply_to ? data.messages.find((x) => x.message_id === m.reply_to) : null;
    const known = new Set(people().map((p) => p.handle));
    const li = h(
      "li",
      {
        class: `w-msg${mine ? " w-msg--mine" : ""}${m.read_by_me ? "" : " w-msg--unread"}`,
        id: `msg-${m.message_id}`,
        "data-id": m.message_id,
      },
      h(
        "div",
        { class: "w-msg__head" },
        personLine(m.sender, {
          sub: m.on_behalf_of ? `for ${m.on_behalf_of.display_name}` : undefined,
        }),
        h("time", { class: "w-msg__time", datetime: m.sent_at, title: when(m.sent_at) }, ago(m.sent_at)),
      ),
      quoted
        ? h(
            "blockquote",
            { class: "w-msg__quote" },
            h("strong", {}, quoted.sender.display_name),
            " ",
            quoted.body.length > 120 ? `${quoted.body.slice(0, 119)}…` : quoted.body,
          )
        : null,
      h(
        "p",
        { class: "w-msg__body" },
        inlineText(m.body, { mentions: (handle) => (known.has(handle) ? link(`/people/${handle}`) : null) }),
      ),
      m.attachments.length
        ? h(
            "ul",
            { class: "w-msg__files", "aria-label": "Attachments" },
            ...m.attachments.map((a) =>
              h(
                "li",
                { class: "w-msg__file", title: `${a.media_type}, sha256 ${a.sha256.slice(0, 12)}` },
                safeIcon("attachment", "link", { size: 16 }),
                h("span", {}, a.file_name),
                h("span", { class: "w-msg__filesize u-tabular" }, fmtBytes(a.size_bytes)),
              ),
            ),
          )
        : null,
      h(
        "div",
        { class: "w-msg__foot" },
        button({
          label: "Reply",
          icon: "reply",
          variant: "ghost",
          size: "sm",
          onClick: () => startReply(m),
        }),
        mine
          ? h(
              "span",
              { class: "w-msg__receipts" },
              safeIcon("check", "check", { size: 16 }),
              m.read_by.length
                ? `Read by ${m.read_by
                    .slice(0, 3)
                    .map((r) => r.person.display_name)
                    .join(", ")}${m.read_by.length > 3 ? ` and ${m.read_by.length - 3} more` : ""}`
                : "Delivered",
            )
          : null,
      ),
    );
    if (arrivedIds.includes(m.message_id)) {
      arrive(li, life);
      li.querySelector(".w-msg__head")?.append(newPill());
    }
    return li;
  };

  const paintMessages = (arrivedIds) => {
    const list = root.querySelector(".w-msgs");
    clear(list);
    for (const m of data.messages) list.append(messageNode(m, arrivedIds));
  };

  // ---- reply form ----

  const startReply = (m) => {
    replyTo = m;
    paintQuote();
    root.querySelector(".w-reply textarea")?.focus();
  };

  const paintQuote = () => {
    const host = root.querySelector(".w-reply__to");
    if (!host) return;
    clear(host);
    host.hidden = !replyTo;
    if (!replyTo) return;
    host.append(
      safeIcon("reply", "reply", { size: 16 }),
      h("span", {}, `Replying to ${replyTo.sender.display_name}`),
      iconButton({
        icon: "x",
        label: "Cancel reply",
        size: "sm",
        onClick: () => {
          replyTo = null;
          paintQuote();
        },
      }),
    );
  };

  const buildReply = () => {
    picker = null;
    attach = attachmentPicker({ max: 10 });
    const field = textArea({
      name: "/body",
      label: "Reply",
      rows: 3,
      placeholder: "Write a reply. Type @ to mention someone.",
      required: true,
      value: drafts.get(threadId) ?? "",
    });
    const ta = field.querySelector("textarea");
    const counter = charCounter(10000);
    counter.update(ta.value.length);
    mentions = attachMentions(ta, people);
    ta.addEventListener("input", () => {
      counter.update(ta.value.length);
      drafts.set(threadId, ta.value);
    });
    const extra = h("div", { class: "w-reply__extra", hidden: true });
    const toggle = h(
      "button",
      {
        type: "button",
        class: "w-linkbtn",
        "aria-expanded": "false",
        onclick: () => {
          const on = extra.hidden;
          extra.hidden = !on;
          toggle.setAttribute("aria-expanded", String(on));
          if (on && !picker) {
            picker = recipientPicker({
              api,
              label: "Add people to this conversation",
              name: "/add_recipients",
              max: 20,
            });
            extra.append(picker.el);
          }
        },
      },
      "Add people",
    );
    const status = h("p", { class: "w-hint", role: "status" });
    const send = button({ label: "Send reply", icon: "send", variant: "primary", type: "submit" });
    const form = h(
      "form",
      { class: "w-reply c-form", novalidate: true },
      h("p", { class: "w-reply__to", hidden: true }),
      h("div", { class: "w-mention-host" }, field, mentions.list),
      counter,
      attach.el,
      allowAddPeople ? h("div", { class: "w-reply__tools" }, toggle) : null,
      allowAddPeople ? extra : null,
      h(
        "div",
        { class: "w-reply__foot" },
        status,
        h("span", { class: "w-hint" }, "Ctrl+Enter to send"),
        send,
      ),
    );
    form.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      formErrors(null, { form });
      status.textContent = "";
      status.classList.remove("w-hint--error");
      const body = ta.value.trim();
      if (!body) {
        formErrors({ code: "VALIDATION_FAILED", path: "/body", message: "Write a reply first" }, { form });
        ta.focus();
        return;
      }
      if (body.length > 10000) {
        formErrors(
          { code: "VALIDATION_FAILED", path: "/body", message: "Replies can be up to 10 000 characters" },
          { form },
        );
        return;
      }
      busy = true;
      send.setAttribute("aria-busy", "true");
      intentKey ??= api.idempotencyKey("reply");
      const input = {
        thread_id: threadId,
        body,
        idempotency_key: intentKey,
      };
      if (replyTo) input.reply_to = replyTo.message_id;
      if (attach.get().length) input.attachments = attach.get();
      const addList = picker?.value() ?? [];
      if (addList.length) input.add_recipients = addList;
      try {
        await api.call("messages.reply", input);
        intentKey = null;
        drafts.delete(threadId);
        replyTo = null;
        ctx.announce("Reply sent");
        await load({ live: true });
        ta.value = "";
        counter.update(0);
        attach.reset();
        picker?.set([]);
        paintQuote();
        const list = root.querySelector(".w-msgs");
        list?.lastElementChild?.scrollIntoView({ block: "nearest" });
      } catch (err) {
        const info = toErrorInfo(err);
        if (info.path) formErrors({ ...info, message: errorText(err) }, { form });
        else status.textContent = errorText(err);
        status.classList.add("w-hint--error");
      } finally {
        busy = false;
        send.removeAttribute("aria-busy");
      }
    });
    return form;
  };

  const paint = ({ arrived = [], first = false } = {}) => {
    if (!data) return;
    const keepDraft = !first && root.querySelector(".w-reply") ? root.querySelector(".w-reply") : null;
    if (keepDraft) {
      // Live update: keep the reply form and its draft; redraw the head and messages only.
      paintHead();
      paintMessages(arrived);
      return;
    }
    clear(root);
    root.append(head, h("ol", { class: "w-msgs", "aria-label": "Messages" }), buildReply());
    paintHead();
    paintMessages([]);
    paintQuote();
    const firstUnread = data.messages.find((m) => !m.read_by_me);
    const target = firstUnread ?? data.messages[data.messages.length - 1];
    if (target)
      root.querySelector(`#msg-${CSS.escape(target.message_id)}`)?.scrollIntoView({ block: "nearest" });
  };

  // ---- realtime ----

  life.add(
    rt.on("message.received", (ev) => {
      if (ev.payload.thread_id !== threadId) return;
      load({ live: true });
    }),
  );
  if (listenSent) {
    life.add(
      rt.on("message.sent", (ev) => {
        if (ev.payload.thread_id !== threadId || busy) return;
        load({ live: true });
      }),
    );
  }
  life.add(
    rt.on("message.state_changed", (ev) => {
      if (!data || !ev.payload.thread_ids.includes(threadId)) return;
      const p = ev.payload;
      for (const k of ["starred", "archived", "muted"]) if (typeof p[k] === "boolean") data.thread[k] = p[k];
      paintHead();
    }),
  );
  life.add(() => {
    releaseOpen();
    mentions?.destroy();
  });

  showEmpty();
  return {
    el: root,
    open,
    id: () => threadId,
    reload: () => load({ live: true }),
    clear: showEmpty,
  };
};
