// Bottom sheet on every width. DESIGN-SYSTEM 6.6.
import { h } from "./dom.js";
import { mountModal, modalHead, modalId, resolveBody } from "./_modal.js";

export const openSheet = ({ title, body, footer, onClose } = {}) => {
  const id = modalId();
  let handle;
  const dialog = h(
    "dialog",
    { class: "c-sheet", "aria-labelledby": `${id}-t` },
    h("span", { class: "c-sheet__grab", "aria-hidden": "true" }),
    modalHead(`${id}-t`, title, () => handle.close()),
    h("div", { class: "c-modal__body" }, resolveBody(body)),
    footer ? h("footer", { class: "c-modal__foot" }, resolveBody(footer)) : null,
  );
  handle = mountModal(dialog, { onClosed: () => onClose?.() });
  return { close: () => handle.close(), element: dialog };
};
