// notifications.preferences: per type and channel matrix, digest schedule, quiet hours, muted conversations.
import { schemaOf } from "../../core/widgets.js";
import { h, clear, uid } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { selectField, switchField } from "../../ds/js/field.js";
import { pill } from "../../ds/js/pill.js";
import { toErrorInfo } from "../../core/api.js";
import { lifecycle, errorText, typeInfo, NOTIFICATION_TYPES, plural, safeIcon } from "../../shell/kit.js";

const CHANNELS = [
  ["in_app", "In-app"],
  ["email", "Email"],
  ["digest", "Digest"],
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hourLabel = (n) => `${String(n).padStart(2, "0")}:00 UTC`;
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: hourLabel(i) }));

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default {
  id: "notifications.preferences",
  domain: "notifications",
  title: "Notification preferences",
  configSchema: schemaOf("notifications.preferences"),
  sizes: ["l", "xl", "full"],
  mount(el, { size, api, rt, ctx }) {
    const life = lifecycle();
    const root = h("div", { class: "w-prefs", "data-size": size });
    el.append(root);

    let server = null; // { preferences, revision, defaults }
    let draft = null; // { notifications, digest, quiet_hours, muted_threads }
    let busy = false;
    let banner = null; // "conflict" | "elsewhere" | null
    let saveError = "";
    const groups = new Map();
    for (const [type, info] of Object.entries(NOTIFICATION_TYPES)) {
      if (!groups.has(info.group)) groups.set(info.group, []);
      groups.get(info.group).push(type);
    }

    const snapshot = (p) => ({
      notifications: clone(p.notifications),
      digest: clone(p.digest),
      quiet_hours: p.quiet_hours ? clone(p.quiet_hours) : null,
      muted_threads: [...(p.muted_threads ?? [])],
    });

    const changedTypes = () =>
      Object.keys(NOTIFICATION_TYPES).filter(
        (t) => !same(draft.notifications[t], server.preferences.notifications[t]),
      );
    const dirtyParts = () => {
      if (!draft) return [];
      const parts = [];
      const ct = changedTypes();
      if (ct.length) parts.push(`${plural(ct.length, "notification type")}`);
      if (!same(draft.digest, server.preferences.digest)) parts.push("digest schedule");
      if (!same(draft.quiet_hours, server.preferences.quiet_hours ?? null)) parts.push("quiet hours");
      if (!same(draft.muted_threads, server.preferences.muted_threads ?? []))
        parts.push("muted conversations");
      return parts;
    };

    // ---- loading ----

    const load = async ({ quiet = false } = {}) => {
      try {
        const out = await api.call("me.preferences.get");
        if (life.dead) return;
        server = out;
        draft = snapshot(out.preferences);
        banner = null;
        saveError = "";
        if (!quiet) ctx.setState("ready");
        paint();
      } catch (e) {
        if (life.dead) return;
        if (!quiet) ctx.setState("error", { error: toErrorInfo(e) });
        else ctx.toast({ title: "Could not reload preferences", body: errorText(e), tone: "danger" });
      }
    };

    // ---- saving ----

    const save = async () => {
      if (busy || dirtyParts().length === 0) return;
      busy = true;
      saveError = "";
      paintBar();
      const input = { base_revision: server.revision };
      const ct = changedTypes();
      if (ct.length) input.notifications = Object.fromEntries(ct.map((t) => [t, draft.notifications[t]]));
      if (!same(draft.digest, server.preferences.digest)) input.digest = draft.digest;
      if (!same(draft.quiet_hours, server.preferences.quiet_hours ?? null))
        input.quiet_hours = draft.quiet_hours;
      if (!same(draft.muted_threads, server.preferences.muted_threads ?? []))
        input.muted_threads = draft.muted_threads;
      try {
        const out = await api.call("me.preferences.update", input);
        if (life.dead) return;
        server = { ...server, preferences: out.preferences, revision: out.revision };
        draft = snapshot(out.preferences);
        banner = null;
        ctx.announce("Preferences saved");
        ctx.toast({ title: "Preferences saved", tone: "success" });
        paint();
      } catch (e) {
        if (life.dead) return;
        const info = toErrorInfo(e);
        if (info.code === "CONFLICT") banner = "conflict";
        else saveError = errorText(e);
        paint();
      } finally {
        busy = false;
        if (!life.dead) paintBar();
      }
    };

    // ---- painting ----

    const barHost = h("div", { class: "w-prefs__bar", role: "region", "aria-label": "Unsaved changes" });

    function paintBar() {
      clear(barHost);
      const parts = dirtyParts();
      barHost.hidden = parts.length === 0 && !saveError;
      if (barHost.hidden) return;
      barHost.append(
        h(
          "p",
          { class: "w-prefs__bartext", role: "status" },
          saveError
            ? h("span", { class: "w-hint--error" }, saveError)
            : `Unsaved changes: ${parts.join(", ")}`,
        ),
        button({
          label: "Discard",
          variant: "ghost",
          disabled: busy,
          onClick: () => {
            draft = snapshot(server.preferences);
            saveError = "";
            paint();
            ctx.announce("Changes discarded");
          },
        }),
        button({
          label: busy ? "Saving" : "Save changes",
          icon: "check",
          variant: "primary",
          busy,
          onClick: save,
        }),
      );
    }

    const setCell = (type, channel, value) => {
      draft.notifications[type][channel] = value;
      paintBar();
      paintSummary();
      paintRowState(type);
    };

    const rowRefs = new Map();
    const paintRowState = (type) => {
      const ref = rowRefs.get(type);
      if (!ref) return;
      const def = server.defaults.notifications[type];
      const isDefault = same(draft.notifications[type], def);
      ref.reset.hidden = isDefault;
      ref.mark.textContent = isDefault ? "" : "Changed from default";
      for (const [channel, box] of ref.boxes) box.checked = Boolean(draft.notifications[type][channel]);
    };

    const summaryEl = h("p", { class: "w-prefs__summary", role: "status" });
    function paintSummary() {
      const counts = { in_app: 0, email: 0, digest: 0 };
      for (const t of Object.keys(NOTIFICATION_TYPES))
        for (const [c] of CHANNELS) if (draft.notifications[t]?.[c]) counts[c] += 1;
      const total = Object.keys(NOTIFICATION_TYPES).length;
      const parts = [
        `${counts.in_app} of ${total} appear in the app`,
        `${counts.email} by email`,
        `${counts.digest} in the digest`,
      ];
      const quiet = draft.quiet_hours
        ? ` Email is held between ${hourLabel(draft.quiet_hours.start_hour)} and ${hourLabel(draft.quiet_hours.end_hour)}.`
        : "";
      const digest =
        draft.digest.frequency === "off"
          ? " The digest is off."
          : ` Digest ${draft.digest.frequency === "daily" ? "daily" : `every ${WEEKDAYS[(draft.digest.weekday ?? 1) - 1]}`} at ${hourLabel(draft.digest.hour_utc)}.`;
      summaryEl.textContent = `${parts.join(", ")}.${digest}${quiet}`;
    }

    const toggleColumn = (channel) => {
      const types = Object.keys(NOTIFICATION_TYPES);
      const allOn = types.every((t) => draft.notifications[t][channel]);
      for (const t of types) draft.notifications[t][channel] = !allOn;
      for (const t of types) paintRowState(t);
      paintBar();
      paintSummary();
      ctx.announce(
        `${CHANNELS.find(([c]) => c === channel)[1]} turned ${allOn ? "off" : "on"} for every type`,
      );
    };

    const matrix = () => {
      rowRefs.clear();
      const table = h(
        "table",
        { class: "w-prefs__table" },
        h("caption", { class: "sr-only" }, "Notification channels by type"),
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { scope: "col" }, "Type"),
            ...CHANNELS.map(([channel, label]) =>
              h(
                "th",
                { scope: "col", class: "w-prefs__chan" },
                h(
                  "button",
                  {
                    type: "button",
                    class: "w-linkbtn",
                    "aria-label": `Toggle ${label} for every type`,
                    onclick: () => toggleColumn(channel),
                  },
                  label,
                ),
              ),
            ),
            h("th", { scope: "col", class: "sr-only" }, "Reset"),
          ),
        ),
      );
      for (const [group, types] of groups) {
        const body = h(
          "tbody",
          {},
          h("tr", { class: "w-prefs__group" }, h("th", { scope: "rowgroup", colspan: 5 }, group)),
        );
        for (const type of types) {
          const info = typeInfo(type);
          const boxes = new Map();
          const mark = h("span", { class: "w-prefs__mark" });
          const reset = button({
            label: "Reset",
            variant: "ghost",
            size: "sm",
            title: `Reset ${info.label} to the default`,
            onClick: () => {
              draft.notifications[type] = clone(server.defaults.notifications[type]);
              paintRowState(type);
              paintBar();
              paintSummary();
              ctx.announce(`${info.label} reset to default`);
            },
          });
          reset.setAttribute("aria-label", `Reset ${info.label} to the default`);
          const cells = CHANNELS.map(([channel, label]) => {
            const id = uid("pf");
            const box = h("input", {
              type: "checkbox",
              id,
              class: "w-prefs__box",
              checked: draft.notifications[type][channel] ? true : null,
              "aria-label": `${label} for ${info.label}`,
            });
            box.addEventListener("change", () => setCell(type, channel, box.checked));
            boxes.set(channel, box);
            return h("td", { class: "w-prefs__cell", "data-label": label }, box);
          });
          rowRefs.set(type, { boxes, reset, mark });
          body.append(
            h(
              "tr",
              { class: "w-prefs__row" },
              h(
                "th",
                { scope: "row", class: "w-prefs__type" },
                h("span", { class: "w-prefs__icon" }, safeIcon(info.icon, "bell", { size: 16 })),
                h("span", {}, info.label),
                mark,
              ),
              ...cells,
              h("td", { class: "w-prefs__reset" }, reset),
            ),
          );
        }
        table.append(body);
      }
      return table;
    };

    const scheduleSection = () => {
      const freq = selectField({
        name: "/digest/frequency",
        label: "Digest",
        value: draft.digest.frequency,
        options: [
          { value: "off", label: "Off" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
        ],
        hint: "One email summarising what you did not read.",
        onChange: (v) => {
          draft.digest.frequency = v;
          if (v === "weekly" && !draft.digest.weekday) draft.digest.weekday = 1;
          if (v !== "weekly") delete draft.digest.weekday;
          paint();
        },
      });
      const hour = selectField({
        name: "/digest/hour_utc",
        label: "Send at",
        value: String(draft.digest.hour_utc),
        options: HOURS,
        disabled: draft.digest.frequency === "off",
        onChange: (v) => {
          draft.digest.hour_utc = Number(v);
          paintBar();
          paintSummary();
        },
      });
      const weekday = selectField({
        name: "/digest/weekday",
        label: "On",
        value: String(draft.digest.weekday ?? 1),
        options: WEEKDAYS.map((label, i) => ({ value: String(i + 1), label })),
        onChange: (v) => {
          draft.digest.weekday = Number(v);
          paintBar();
          paintSummary();
        },
      });
      return h(
        "section",
        { class: "w-prefs__section", "aria-labelledby": "pf-digest" },
        h("h3", { class: "w-prefs__h", id: "pf-digest" }, "Digest schedule"),
        h(
          "div",
          { class: "w-grid2 w-prefs__fields" },
          freq,
          hour,
          draft.digest.frequency === "weekly" ? weekday : null,
        ),
      );
    };

    const quietSection = () => {
      const on = Boolean(draft.quiet_hours);
      const toggle = switchField({
        name: "/quiet_hours",
        label: "Hold email during quiet hours",
        value: on,
        hint: "Emails that would arrive then are suppressed. In-app notifications still arrive.",
        onChange: (v) => {
          draft.quiet_hours = v ? { start_hour: 22, end_hour: 6 } : null;
          paint();
        },
      });
      const fields = on
        ? h(
            "div",
            { class: "w-grid2 w-prefs__fields" },
            selectField({
              name: "/quiet_hours/start_hour",
              label: "From",
              value: String(draft.quiet_hours.start_hour),
              options: HOURS,
              onChange: (v) => {
                draft.quiet_hours.start_hour = Number(v);
                paintBar();
                paintSummary();
              },
            }),
            selectField({
              name: "/quiet_hours/end_hour",
              label: "Until",
              value: String(draft.quiet_hours.end_hour),
              options: HOURS,
              onChange: (v) => {
                draft.quiet_hours.end_hour = Number(v);
                paintBar();
                paintSummary();
              },
            }),
          )
        : null;
      return h(
        "section",
        { class: "w-prefs__section", "aria-labelledby": "pf-quiet" },
        h("h3", { class: "w-prefs__h", id: "pf-quiet" }, "Quiet hours"),
        toggle,
        fields,
      );
    };

    const mutedSection = () => {
      const n = draft.muted_threads.length;
      return h(
        "section",
        { class: "w-prefs__section", "aria-labelledby": "pf-muted" },
        h("h3", { class: "w-prefs__h", id: "pf-muted" }, "Muted conversations"),
        h(
          "p",
          { class: "w-hint" },
          n
            ? `${plural(n, "conversation")} muted. They only notify you when you are mentioned.`
            : "No muted conversations. Mute one from its menu in the inbox.",
        ),
        n
          ? button({
              label: "Unmute all",
              icon: "eye",
              size: "sm",
              onClick: () => {
                draft.muted_threads = [];
                paint();
                ctx.announce("All conversations will be unmuted when you save");
              },
            })
          : null,
      );
    };

    function paint() {
      if (!draft) return;
      clear(root);
      const parts = [];
      if (banner) {
        parts.push(
          h(
            "div",
            { class: "w-banner", role: "alert" },
            safeIcon("alert", "alert", { size: 16 }),
            h(
              "span",
              {},
              banner === "conflict"
                ? "This changed while you were editing."
                : "These preferences were changed in another tab.",
            ),
            button({ label: "Reload", size: "sm", onClick: () => load({ quiet: true }) }),
          ),
        );
      }
      parts.push(
        h(
          "div",
          { class: "w-prefs__intro" },
          h("p", { class: "w-hint" }, "Choose how each kind of notification reaches you."),
          server.revision === null ? pill({ label: "Using programme defaults", tone: "info" }) : null,
        ),
        summaryEl,
        h("div", { class: "w-prefs__scroll" }, matrix()),
        h("div", { class: "w-prefs__sections" }, scheduleSection(), quietSection(), mutedSection()),
        barHost,
      );
      root.append(...parts);
      for (const t of Object.keys(NOTIFICATION_TYPES)) paintRowState(t);
      paintSummary();
      paintBar();
    }

    // Another tab changed the Preference node.
    life.add(
      rt.onNode("Preference", async () => {
        if (busy) return;
        try {
          const out = await api.call("me.preferences.get");
          if (life.dead || out.revision === server?.revision) return;
          if (dirtyParts().length === 0) {
            server = out;
            draft = snapshot(out.preferences);
            paint();
            ctx.announce("Preferences updated");
          } else {
            banner = "elsewhere";
            paint();
          }
        } catch {
          /* the next explicit action reports it */
        }
      }),
    );

    ctx.setState("loading");
    load();
    return () => life.dispose();
  },
};
