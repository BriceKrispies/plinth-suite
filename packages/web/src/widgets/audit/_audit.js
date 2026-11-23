// Shared by the audit widgets: hash display with copy, the undo flow (kernel POST /changes/:seq/undo) and the
// kernel revision diff (GET /diff). The runtime's `api` object does not expose `request`, so these call it directly.
import { h } from "../../ds/js/dom.js";
import { button } from "../../ds/js/button.js";
import { textField } from "../../ds/js/field.js";
import { idempotencyKey, request } from "../../core/api.js";
import { toastError } from "../reporting/_common.js";
import { toast } from "../../ds/js/toast.js";

export const shortHash = (hash) => (hash ? `${String(hash).slice(0, 12)}` : "");

/** A monospace hash (shortened) with a copy button that copies the full value. */
export const hashNode = (hash, { label = "hash" } = {}) => {
  if (!hash) return h("span", { class: "u-muted" }, "–");
  return h(
    "span",
    { class: "rp-hash" },
    h("code", { class: "u-mono", title: hash }, shortHash(hash)),
    button({
      label: `Copy full ${label}`,
      icon: "copy",
      iconOnly: true,
      size: "sm",
      variant: "ghost",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(hash);
          toast({ title: `Copied the ${label}`, tone: "success", timeout: 2500 });
        } catch {
          toast({ title: "Could not copy", body: "The browser refused clipboard access.", tone: "warning" });
        }
      },
    }),
  );
};

/**
 * Ask for a reason, then undo change `seq` as an inverse change. Resolves to the commit result, or null when the
 * user cancelled or the server refused (the refusal is toasted).
 */
export const undoChange = async ({ ctx, seq, subject }) => {
  const reason = textField({
    name: "/reason",
    label: "Reason (optional)",
    placeholder: "Why is this being undone?",
  });
  const answer = await ctx.openDialog({
    title: `Undo change #${seq}?`,
    size: "sm",
    body: h(
      "div",
      { class: "rp-form" },
      h("p", {}, `This writes a new change that reverses “${subject}”. The original stays in the log.`),
      reason,
    ),
    actions: [
      { label: "Cancel", value: false, variant: "secondary", autofocus: true },
      { label: "Undo change", value: true, variant: "danger" },
    ],
  });
  if (answer !== true) return null;
  try {
    const text = reason.querySelector("input")?.value.trim();
    return await request("POST", `/changes/${seq}/undo`, {
      body: { idempotency_key: idempotencyKey("undo"), ...(text ? { reason: text } : {}) },
    });
  } catch (e) {
    toastError(ctx.toast, e, "Could not undo that change");
    return null;
  }
};

/** Diff two revisions of a node: `{ ops, changed_paths, human_summary }`. `ref` is `<kind>:<slug>`. */
export const kernelDiff = (ref, a, b) =>
  request("GET", "/diff", { query: { a: `${ref}@${a}`, b: `${ref}@${b}` } });
