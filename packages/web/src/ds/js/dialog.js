// APG Dialog (Modal) and Alert Dialog. DESIGN-SYSTEM 6.4.
import { h } from "./dom.js";
import { button } from "./button.js";
import { mountModal, modalHead, modalId, resolveBody } from "./_modal.js";

export const openDialog = ({ title, body, actions = [], size = "md", dismissable = true, role } = {}) =>
  new Promise((resolve) => {
    const id = modalId();
    const content = resolveBody(body);
    let handle;
    const foot = actions.length
      ? h(
          "footer",
          { class: "c-modal__foot" },
          ...actions.map((a) =>
            button({
              label: a.label,
              variant: a.variant ?? "secondary",
              onClick: () => handle.close(a.value),
            }),
          ),
        )
      : null;
    if (foot) {
      actions.forEach((a, i) => {
        if (a.autofocus) foot.children[i].setAttribute("data-autofocus", "");
      });
    }
    const dialog = h(
      "dialog",
      { class: `c-dialog c-dialog--${size}`, "aria-labelledby": `${id}-t`, role: role ?? null },
      modalHead(`${id}-t`, title, () => handle.close(null), dismissable),
      h("div", { class: "c-modal__body" }, content),
      foot,
    );
    handle = mountModal(dialog, { dismissable, cancelValue: null, onClosed: resolve });
  });

export const confirmDialog = async ({ title, message, confirmLabel = "Confirm", tone = "default" }) => {
  const danger = tone === "danger";
  const value = await openDialog({
    title,
    body: h("p", {}, message),
    size: "sm",
    role: danger ? "alertdialog" : null,
    actions: [
      { label: "Cancel", value: false, variant: "secondary", autofocus: true },
      { label: confirmLabel, value: true, variant: danger ? "danger" : "primary" },
    ],
  });
  return value === true;
};
