// settings.appearance: theme, density and reduced motion (the Preference ui block). Changes preview on the whole
// app at once and are saved with Save; leaving the widget with unsaved changes puts the saved look back.
// A change saved elsewhere arrives through the change stream.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { statTile } from "../../ds/js/stat.js";
import { radioGroup, switchField } from "../../ds/js/field.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { prefsStore, setTheme } from "../../core/stores.js";
import { debounce, latest, region, toErrorInfo, isStale } from "../reporting/_common.js";

const THEMES = [
  { value: "auto", label: "Match my system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const DENSITIES = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const same = (a, b) =>
  a.theme === b.theme && a.density === b.density && a.reduced_motion === b.reduced_motion;

export default {
  id: "settings.appearance",
  domain: "settings",
  title: "Appearance",
  configSchema: schemaOf("settings.appearance"),
  sizes: catalogEntry("settings.appearance")?.sizes ?? [],
  mount(el, { size, api, rt, ctx }) {
    const stage = region("rp-appearance__stage");
    el.append(h("div", { class: `rp-app rp-appearance rp-appearance--${size}` }, stage.el));
    const next = latest();
    let alive = true;
    let saved = null; // the saved ui block
    let draft = null;
    let revision = null;
    let saving = false;

    const preview = (ui) =>
      prefsStore.update((p) => ({
        ...p,
        theme: ui.theme,
        density: ui.density,
        reduced_motion: ui.reduced_motion,
      }));

    async function load({ first = false, silent = false } = {}) {
      const ok = next();
      if (first) stage.loading({ lines: 4 });
      try {
        const out = await api.call("me.preferences.get");
        if (!ok() || !alive) return;
        const ui = out.preferences.ui;
        revision = out.revision;
        const wasClean = !draft || !saved || same(draft, saved);
        saved = ui;
        if (wasClean || !silent) {
          draft = { theme: ui.theme, density: ui.density, reduced_motion: ui.reduced_motion };
          preview(draft);
        }
        paint();
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (!saved) stage.error(e, () => load({ first: true }));
      }
    }

    const dirty = () => saved && draft && !same(draft, saved);

    async function save() {
      if (saving || !dirty()) return;
      saving = true;
      paint();
      try {
        const out = await api.call("me.preferences.update", {
          ui: { ...saved, ...draft },
          base_revision: revision,
        });
        saved = out.preferences.ui;
        revision = out.revision;
        setTheme(saved.theme);
        ctx.toast({ title: "Appearance saved", tone: "success", timeout: 3000 });
        ctx.announce("Appearance saved");
      } catch (e) {
        const info = toErrorInfo(e);
        ctx.toast({
          title: isStale(info) ? "Your preferences changed elsewhere" : "Could not save",
          body: isStale(info) ? "The latest values were loaded." : info.message,
          tone: "danger",
        });
        if (isStale(info)) {
          draft = null;
          await load({});
        }
      } finally {
        saving = false;
        if (alive) paint();
      }
    }

    function revert() {
      draft = { theme: saved.theme, density: saved.density, reduced_motion: saved.reduced_motion };
      preview(draft);
      paint();
    }

    function paint() {
      if (!saved || !draft) return;
      const theme = radioGroup({
        name: "theme",
        label: "Theme",
        value: draft.theme,
        options: THEMES,
        hint: "Takes effect on the whole app straight away.",
        onChange: (v) => ((draft.theme = v), preview(draft), paint()),
      });
      const density = radioGroup({
        name: "density",
        label: "Density",
        value: draft.density,
        options: DENSITIES,
        hint: "Compact tightens rows and controls to fit more on screen.",
        onChange: (v) => ((draft.density = v), preview(draft), paint()),
      });
      const motion = switchField({
        name: "reduced_motion",
        label: "Reduce motion",
        value: draft.reduced_motion,
        hint: "Turns off movement. Changes are still marked with a label and a rule.",
        onChange: (v) => ((draft.reduced_motion = v), preview(draft), paint()),
      });
      const d = dirty();
      const sample =
        size === "m"
          ? null
          : h(
              "section",
              { class: "rp-appearance__sample", "aria-label": "Preview" },
              h("h3", { class: "rp-detail__title" }, "Preview"),
              statTile({
                label: "Points this month",
                value: "12 450",
                unit: "pts",
                delta: "+8 %",
                good: "up",
              }),
              h(
                "div",
                { class: "rp-detail__pills" },
                pill({ label: "Active", tone: "success", icon: "check-circle" }),
                pill({ label: "Awaiting decision", tone: "warning", icon: "alert" }),
              ),
              h("p", { class: "u-muted" }, "Text, tables and forms follow the same theme and density."),
            );
      const form = h(
        "form",
        {
          class: "rp-form",
          "aria-label": "Appearance",
          novalidate: true,
          onsubmit: (e) => (e.preventDefault(), save()),
        },
        theme,
        density,
        motion,
        h(
          "div",
          { class: "rp-form__actions" },
          d
            ? h("span", { class: "rp-appearance__dirty" }, icon("info", { size: 16 }), "Unsaved changes")
            : null,
          button({ label: "Revert", variant: "ghost", disabled: !d || saving, onClick: revert }),
          button({
            label: "Save",
            icon: "check",
            variant: "primary",
            type: "submit",
            disabled: !d,
            busy: saving,
          }),
        ),
      );
      const focusId = document.activeElement?.closest?.(".c-field")?.dataset.fid;
      stage.show(h("div", { class: "rp-appearance__grid" }, form, sample));
      if (focusId)
        stage.el
          .querySelector(`[data-fid="${focusId}"] input:checked, [data-fid="${focusId}"] input`)
          ?.focus({ preventScroll: true });
    }

    const refresh = debounce(() => load({ silent: true }), 400);
    const offs = [rt.onNode("Preference", () => refresh())];
    load({ first: true });
    return () => {
      alive = false;
      refresh.cancel();
      if (saved && draft && !same(draft, saved)) preview(saved);
      for (const off of offs) off();
    };
  },
};
