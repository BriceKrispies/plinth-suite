// promotions.simulator: pick a promotion, a member and a sample cart or earn event; see what applies, what is
// rejected and why, the totals and the no-promotion baseline.
import { schemaOf } from "../../core/widgets.js";
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { combobox } from "../../ds/js/combobox.js";
import { numberField, selectField, switchField, dateTimeField, fieldset } from "../../ds/js/field.js";
import { pill } from "../../ds/js/pill.js";
import { dataTable } from "../../ds/js/table.js";
import { emptyState } from "../../ds/js/states.js";
import { points, signedPoints } from "../../ds/js/format.js";
import { icon } from "../../ds/js/icons.js";
import { lifecycle, listNodes, fromUtcInput, failToast, enumLabel, banner, segmented } from "./_kit.js";
import { REJECTION_LABEL, CHANNELS, CHANNEL_LABEL } from "./_promo.js";

const EARN_TYPES = ["award", "badge_reward", "automation", "content"];

export default {
  id: "promotions.simulator",
  domain: "promotions",
  title: "Simulator",
  configSchema: schemaOf("promotions.simulator"),
  sizes: ["l", "xl"],
  mount(el, { config, size, api, bus, ctx }) {
    const life = lifecycle();
    const meHandle = ctx.memberHandle("$me");
    const st = {
      promotion: config.promotion ?? null,
      promotionLabel: config.promotion ?? "",
      member: meHandle ? { value: meHandle, label: ctx.me?.member?.display_name ?? meHandle } : null,
      kind: "purchase",
      lines: [],
      base_points: 200,
      channel: "recognition",
      earn_type: "award",
      include_live: true,
      at: "",
      result: null,
      busy: false,
      error: null,
      view: "inputs",
    };
    const wide = size === "xl";
    let promos = null;

    const inputs = h("div", { class: "wp-sim__inputs" });
    const result = h("div", { class: "wp-sim__result", "aria-live": "polite" });
    const root = h("div", { class: `wp wp-sim wp-sim--${size}` });
    const views = segmented({
      label: "Simulator view",
      value: "inputs",
      options: [
        { value: "inputs", label: "Inputs" },
        { value: "result", label: "Result" },
      ],
      onChange: (v) => {
        st.view = v;
        layout();
      },
    });
    root.append(...(wide ? [] : [views]), inputs, result);
    el.append(root);

    const layout = () => {
      if (wide) return;
      inputs.hidden = st.view !== "inputs";
      result.hidden = st.view !== "result";
    };

    const loadPromos = async () => {
      if (!promos) promos = listNodes(api, "Promotion");
      return promos;
    };

    // ---- inputs ----
    const drawInputs = () => {
      const promoBox = combobox({
        label: "Promotion",
        name: "promotion",
        required: true,
        placeholder: "Choose a promotion",
        value: st.promotion ? { value: st.promotion, label: st.promotionLabel || st.promotion } : null,
        search: async (q) => {
          const all = await loadPromos();
          return all
            .filter((p) => `${p.title} ${p.slug}`.toLowerCase().includes(q.toLowerCase()))
            .map((p) => ({ value: p.slug, label: p.title, description: `${p.spec.status ?? ""}` }));
        },
        onChange: (o) => {
          st.promotion = o?.value ?? null;
          st.promotionLabel = o?.label ?? "";
        },
      });
      const memberBox = combobox({
        label: "Member",
        name: "member",
        required: true,
        placeholder: "Search people",
        value: st.member,
        search: async (q) => {
          const out = await api.call("people.directory", { q, limit: 8 });
          return out.items.map((m) => ({
            value: m.person.handle,
            label: m.person.display_name,
            description: `${m.title} · ${m.tier}`,
            avatar: m.person.avatar,
          }));
        },
        onChange: (o) => {
          st.member = o;
        },
      });
      const kind = segmented({
        label: "Event kind",
        value: st.kind,
        options: [
          { value: "purchase", label: "Store purchase" },
          { value: "earn", label: "Points earned" },
        ],
        onChange: (v) => {
          st.kind = v;
          drawInputs();
        },
      });
      const context = h("div", { class: "wp-sim__context" });
      if (st.kind === "purchase") context.append(...cartFields());
      else
        context.append(
          numberField({
            name: "base_points",
            label: "Base points earned",
            value: st.base_points,
            min: 1,
            step: 1,
            required: true,
            onInput: (v) => {
              st.base_points = v ?? 0;
            },
          }),
          selectField({
            name: "channel",
            label: "Channel",
            value: st.channel,
            options: CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
            onChange: (v) => {
              st.channel = v;
            },
          }),
          selectField({
            name: "earn_type",
            label: "Earn type",
            value: st.earn_type,
            options: EARN_TYPES.map((t) => ({ value: t, label: enumLabel(t) })),
            onChange: (v) => {
              st.earn_type = v;
            },
          }),
        );
      const run = button({
        label: st.busy ? "Simulating" : "Run simulation",
        icon: "play",
        variant: "primary",
        busy: st.busy,
        onClick: simulate,
      });
      inputs.replaceChildren(
        promoBox,
        memberBox,
        fieldset({ legend: "Sample event", children: [kind, context] }),
        h(
          "div",
          { class: "wp-sim__more" },
          switchField({
            name: "include_live",
            label: "Also evaluate every live promotion (shows stacking)",
            value: st.include_live,
            onChange: (v) => {
              st.include_live = v;
            },
          }),
          dateTimeField({
            name: "at",
            label: "As of (UTC, optional)",
            value: st.at,
            hint: "Leave empty for the current virtual time.",
            onInput: (v) => {
              st.at = v;
            },
          }),
        ),
        ...[
          st.error
            ? banner({ tone: "danger", title: "Could not simulate.", body: st.error, role: "alert" })
            : null,
        ].filter(Boolean),
        h("div", { class: "wk-actions" }, run),
      );
    };

    const cartFields = () => {
      const search = combobox({
        label: "Add a product to the cart",
        name: "product",
        placeholder: "Search the catalogue",
        search: async (q) => {
          const out = await api.call("store.catalog", { q, limit: 8 });
          return out.items.map((p) => ({
            value: p.slug,
            label: p.title,
            description: `${points(p.price_points)} · ${p.category}`,
            icon: "gift",
            _p: p,
          }));
        },
        onChange: (o) => {
          if (!o) return;
          const p = o._p;
          const existing = st.lines.find((l) => l.product === p.slug);
          if (existing) existing.qty = Math.min(10, existing.qty + 1);
          else
            st.lines.push({
              product: p.slug,
              category: p.category,
              qty: 1,
              unit_points: p.price_points,
              title: p.title,
            });
          drawInputs();
        },
      });
      const lines = st.lines.length
        ? h(
            "ul",
            { class: "wp-sim__lines", role: "list" },
            ...st.lines.map((l, i) =>
              h(
                "li",
                { class: "wp-sim__line" },
                h(
                  "span",
                  { class: "wp-sim__line-title" },
                  l.title,
                  h("span", { class: "u-muted" }, ` ${points(l.unit_points)} each`),
                ),
                numberField({
                  name: `/lines/${i}/qty`,
                  label: `Quantity of ${l.title}`,
                  value: l.qty,
                  min: 1,
                  max: 10,
                  step: 1,
                  onInput: (v) => {
                    l.qty = Math.max(1, Math.min(10, Math.round(v ?? 1)));
                  },
                }),
                button({
                  label: `Remove ${l.title}`,
                  icon: "x",
                  iconOnly: true,
                  variant: "ghost",
                  size: "sm",
                  onClick: () => {
                    st.lines.splice(i, 1);
                    drawInputs();
                  },
                }),
              ),
            ),
          )
        : h("p", { class: "u-muted" }, "The cart is empty. Add at least one product.");
      return [search, lines];
    };

    // ---- run ----
    const simulate = async () => {
      st.error = null;
      if (!st.promotion) st.error = "Choose a promotion first.";
      else if (!st.member) st.error = "Choose a member first.";
      else if (st.kind === "purchase" && st.lines.length === 0) st.error = "Add a product to the cart.";
      else if (st.kind === "earn" && !(st.base_points > 0)) st.error = "Base points must be above zero.";
      if (st.error) {
        drawInputs();
        return;
      }
      const context =
        st.kind === "purchase"
          ? {
              kind: "purchase",
              channel: "store",
              lines: st.lines.map((l) => ({
                product: l.product,
                category: l.category,
                qty: l.qty,
                unit_points: l.unit_points,
              })),
            }
          : {
              kind: "earn",
              channel: st.channel,
              base_points: Math.round(st.base_points),
              earn_type: st.earn_type,
            };
      st.busy = true;
      drawInputs();
      try {
        const out = await api.call("promotions.simulate", {
          promotion: `promotion:${st.promotion}`,
          member: st.member.value,
          context,
          include_live: st.include_live,
          ...(st.at ? { at: fromUtcInput(st.at) } : {}),
        });
        if (life.dead) return;
        st.result = { ...out, kind: st.kind, slug: st.promotion };
        st.busy = false;
        drawInputs();
        drawResult();
        st.view = "result";
        views.setValue("result");
        layout();
        ctx.announce("Simulation finished");
      } catch (e) {
        if (life.dead) return;
        st.busy = false;
        st.error = e.message;
        drawInputs();
        failToast(ctx, e, "Simulation failed");
      }
    };

    // ---- result ----
    const compareRows = (r) => {
      const ev = r.evaluation.totals;
      const base = r.baseline.totals;
      if (ev.kind === "purchase")
        return [
          ["Subtotal", base.subtotal_points, ev.subtotal_points],
          ["Discount", 0, ev.discount_points],
          ["Bonus points", base.bonus_points, ev.bonus_points],
          ["You pay", base.total_points, ev.total_points],
        ];
      return [
        ["Base points", base.base_points, ev.base_points],
        ["Bonus points", base.bonus_points, ev.bonus_points],
        ["Final points", base.final_points, ev.final_points],
      ];
    };

    function drawResult() {
      const r = st.result;
      result.replaceChildren();
      if (!r) {
        result.append(
          emptyState({
            icon: "target",
            title: "Nothing simulated yet",
            body: "Choose a promotion and a member, describe a purchase or an earn event, then run the simulation.",
          }),
        );
        return;
      }
      const ev = r.evaluation;
      const mine = ev.applied.find((a) => a.slug === r.slug);
      const myRejection = ev.rejected.find((x) => x.slug === r.slug);
      const myAdvisory = ev.advisories.find((x) => x.slug === r.slug);
      const verdict = mine
        ? banner({
            tone: "success",
            title: "This promotion applies.",
            body: `It costs the programme ${points(mine.cost_points)}.`,
          })
        : banner({
            tone: "warning",
            title: "This promotion does not apply.",
            body: myRejection
              ? `${REJECTION_LABEL[myRejection.reason] ?? myRejection.reason}. ${myRejection.detail}`
              : "It was not selected.",
          });
      result.append(
        h(
          "div",
          { class: "wp-sim__head" },
          h("span", {}, `${r.member.handle} · ${enumLabel(r.member.tier)} · ${r.member.region}`),
          h("span", { class: "u-muted" }, `as of ${r.at.slice(0, 16).replace("T", " ")} UTC`),
        ),
        verdict,
        ...[
          myAdvisory
            ? banner({
                tone: "info",
                title: "Advisory.",
                body: `${REJECTION_LABEL[myAdvisory.reason] ?? myAdvisory.reason}: ${myAdvisory.detail}`,
              })
            : null,
        ].filter(Boolean),
        h(
          "section",
          { class: "wp-sim__totals", "aria-label": "Totals" },
          h("h3", { class: "wk-caps" }, "Totals"),
          dataTable({
            caption: "Totals with and without promotions",
            density: "compact",
            columns: [
              { key: "k", label: "Line", render: (x) => x[0] },
              { key: "b", label: "Without", align: "end", render: (x) => points(x[1]) },
              { key: "e", label: "With", align: "end", render: (x) => points(x[2]) },
              {
                key: "d",
                label: "Change",
                align: "end",
                render: (x) => (x[2] - x[1] === 0 ? "–" : signedPoints(x[2] - x[1])),
              },
            ],
            rows: compareRows(r),
            rowKey: (x) => x[0],
          }),
          h(
            "p",
            { class: "wp-sim__delta" },
            ev.delta_points === 0
              ? "No change for the member."
              : `Member impact ${signedPoints(ev.delta_points)}`,
            ` · programme cost ${points(ev.cost_points)}`,
          ),
          ev.totals.kind === "purchase" && ev.totals.free_items.length
            ? h(
                "p",
                {},
                `Free items: ${ev.totals.free_items.map((f) => `${f.product} (worth ${points(f.unit_points)})`).join(", ")}`,
              )
            : null,
        ),
        h(
          "section",
          { "aria-label": "Applied promotions" },
          h("h3", { class: "wk-caps" }, `Applied (${ev.applied.length})`),
          ev.applied.length
            ? h(
                "ul",
                { class: "wp-sim__list", role: "list" },
                ...ev.applied.map((a) =>
                  h(
                    "li",
                    { class: `wp-sim__item${a.slug === r.slug ? " is-focus" : ""}` },
                    h("strong", {}, a.title),
                    h(
                      "span",
                      { class: "u-muted" },
                      ` revision ${a.revision} · cost ${points(a.cost_points)}`,
                    ),
                    h(
                      "ul",
                      { class: "wp-sim__effects" },
                      ...a.effects.map((e) =>
                        h(
                          "li",
                          {},
                          pill({ label: enumLabel(e.type), tone: "info" }),
                          ` benefit ${points(e.benefit_points)}`,
                          e.lines?.length
                            ? h(
                                "span",
                                { class: "u-muted" },
                                ` (${e.lines.map((l) => `${l.product}: ${points(l.points)}`).join(", ")})`,
                              )
                            : null,
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : h("p", { class: "u-muted" }, "No promotion applied."),
        ),
        ...[
          ev.rejected.length
            ? h(
                "section",
                { "aria-label": "Rejected promotions" },
                h("h3", { class: "wk-caps" }, `Rejected (${ev.rejected.length})`),
                h(
                  "ul",
                  { class: "wp-sim__list", role: "list" },
                  ...ev.rejected.map((x) =>
                    h(
                      "li",
                      { class: `wp-sim__item${x.slug === r.slug ? " is-focus" : ""}` },
                      h("strong", {}, x.slug),
                      ` ${REJECTION_LABEL[x.reason] ?? x.reason}`,
                      x.detail ? h("span", { class: "u-muted" }, ` — ${x.detail}`) : null,
                    ),
                  ),
                ),
              )
            : null,
        ].filter(Boolean),
        h(
          "div",
          { class: "wk-actions" },
          button({
            label: "Edit inputs",
            icon: "edit",
            onClick: () => {
              st.view = "inputs";
              views.setValue("inputs");
              layout();
            },
          }),
        ),
      );
    }

    drawInputs();
    drawResult();
    layout();

    life.add(
      bus.subscribe("promotion.selected", async ({ id }) => {
        if (!id) return;
        st.promotion = id;
        st.promotionLabel = id;
        try {
          st.promotionLabel = (await loadPromos()).find((p) => p.slug === id)?.title ?? id;
        } catch {
          /* the picker still works with the slug */
        }
        if (life.dead) return;
        drawInputs();
        if (st.result && st.member) simulate();
      }),
    );
    life.add(
      bus.subscribe("member.selected", async ({ id }) => {
        if (!id) return;
        st.member = { value: id, label: id };
        try {
          const out = await api.call("people.directory", { q: id, limit: 5 });
          const m = out.items.find((x) => x.person.handle === id);
          if (m) st.member = { value: id, label: m.person.display_name };
        } catch {
          /* keep the handle as the label */
        }
        if (life.dead) return;
        drawInputs();
      }),
    );
    // seed the label for a configured promotion
    if (st.promotion)
      loadPromos()
        .then((all) => {
          if (life.dead) return;
          st.promotionLabel = all.find((p) => p.slug === st.promotion)?.title ?? st.promotion;
          drawInputs();
        })
        .catch(() => {});

    return () => life.dispose();
  },
};
