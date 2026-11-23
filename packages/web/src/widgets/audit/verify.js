// audit.verify: verifies both hash chains (the change log and the domain events) and shows their heads. Runs on
// load and on demand; a broken chain names the sequence number and the reason.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { icon } from "../../ds/js/icons.js";
import { pill } from "../../ds/js/pill.js";
import { number } from "../../ds/js/format.js";
import { catalogEntry, schemaOf } from "../../core/widgets.js";
import { latest, region, timeNode, toErrorInfo } from "../reporting/_common.js";
import { hashNode } from "./_audit.js";

export default {
  id: "audit.verify",
  domain: "audit",
  title: "Chain verification",
  configSchema: schemaOf("audit.verify"),
  sizes: catalogEntry("audit.verify")?.sizes ?? [],
  mount(el, { size, api, ctx }) {
    const compact = size === "s";
    const stage = region("rp-verify__stage");
    el.append(h("div", { class: `rp-verify rp-verify--${size}` }, stage.el));
    const next = latest();
    let alive = true;
    let result = null;

    const chainRow = (name, c) =>
      h(
        "div",
        { class: "rp-verify__chain", "data-ok": String(c.ok) },
        h(
          "div",
          { class: "rp-verify__head" },
          h("h3", { class: "rp-verify__name" }, name),
          c.ok
            ? pill({ label: "Verified", tone: "success", icon: "check-circle" })
            : pill({ label: "Broken", tone: "danger", icon: "alert" }),
        ),
        h(
          "dl",
          { class: "rp-kv" },
          h("dt", {}, "Entries checked"),
          h("dd", { class: "u-tabular" }, number(c.checked)),
          h("dt", {}, "Head"),
          h("dd", { class: "u-tabular" }, `#${number(c.head_seq)}`),
          h("dt", {}, "Head hash"),
          h("dd", {}, hashNode(c.head_hash)),
        ),
        c.ok
          ? null
          : h(
              "p",
              { class: "rp-notice", "data-tone": "danger" },
              icon("alert", { size: 16 }),
              `The chain breaks at entry #${c.error?.seq ?? "?"}: ${c.error?.reason ?? "the recorded hash does not match."}`,
            ),
      );

    const paint = (busy = false) => {
      const verifyBtn = button({
        label: busy ? "Verifying" : "Verify now",
        icon: "shield",
        variant: "secondary",
        size: "sm",
        busy,
        onClick: () => run(),
      });
      if (!result) return;
      const allOk = result.changes.ok && result.domain.ok;
      const summary = h(
        "div",
        { class: "rp-verify__summary" },
        allOk
          ? pill({
              label: compact ? "Both chains verified" : "Both hash chains verified",
              tone: "success",
              icon: "check-circle",
            })
          : pill({ label: "Verification failed", tone: "danger", icon: "alert" }),
        h("span", { class: "rp-verify__time" }, "Checked ", timeNode(result.verified_at)),
        verifyBtn,
      );
      if (compact) {
        stage.show(
          summary,
          h(
            "p",
            { class: "rp-verify__line u-tabular" },
            `Changes #${number(result.changes.head_seq)}, events #${number(result.domain.head_seq)}`,
          ),
        );
      } else {
        stage.show(summary, chainRow("Change log", result.changes), chainRow("Domain events", result.domain));
      }
    };

    async function run(first = false) {
      const ok = next();
      if (first) stage.loading({ lines: 3 });
      else paint(true);
      try {
        const out = await api.call("audit.verify");
        if (!ok() || !alive) return;
        result = out;
        paint(false);
        ctx.announce(
          out.changes.ok && out.domain.ok ? "Both chains verified" : "A chain failed verification",
        );
      } catch (e) {
        if (!ok() || !alive) return;
        if (toErrorInfo(e).code === "FORBIDDEN") ctx.setState("unavailable", { reason: "forbidden" });
        else if (result) {
          paint(false);
          ctx.toast({ title: "Could not verify", body: toErrorInfo(e).message, tone: "danger" });
        } else stage.error(e, () => run(true));
      }
    }

    run(true);
    return () => {
      alive = false;
    };
  },
};
