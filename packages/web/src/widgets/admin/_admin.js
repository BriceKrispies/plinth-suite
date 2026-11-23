// Shared by the admin widgets: vocabularies, the notice shown for a held change, and a person-by-subject field.
import { h } from "../../ds/js/dom.js";
import { icon } from "../../ds/js/icons.js";

export const REGIONS = ["NA", "EMEA", "APAC", "LATAM", "ANZ"];
export const DEPARTMENTS = ["operations", "fulfilment", "finance", "marketing", "technology", "people"];
export const SUBJECT = /^(user|agent|service):[a-z0-9][a-z0-9._-]*$/;
export const HANDLE = /^[a-z][a-z0-9-]{1,39}$/;

export const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

/**
 * The outcome of a change that may have been held for approval (`{ status, approval_id?, rule_id?, change_seq? }`).
 * A held change is not an error: it is shown as a notice with the way to the approvals page.
 */
export const heldNotice = (result, what, nav) => {
  const held = result?.status === "pending_approval";
  const rules = result?.rule_id?.length ? ` (${result.rule_id.join(", ")})` : "";
  return h(
    "div",
    { class: "rp-notice", "data-tone": held ? "warning" : "success", role: "status" },
    icon(held ? "clock" : "check-circle", { size: 16 }),
    h(
      "p",
      {},
      held
        ? `${what} is held for approval${rules}. It takes effect when a second person approves it. `
        : `${what} was committed. `,
      held ? h("a", { href: nav.href("/approvals") }, "Open approvals") : null,
    ),
  );
};
