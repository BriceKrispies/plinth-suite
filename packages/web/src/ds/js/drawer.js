// Side drawer; below 40rem the same markup renders as a bottom sheet by CSS. DESIGN-SYSTEM 6.5.
import { h } from "./dom.js";
import { mountModal, modalHead, modalId, resolveBody } from "./_modal.js";

export const SHEET_BREAKPOINT = "40rem";

export const openDrawer = ({ title, body, footer, side = "end", width = "md", onClose } = {}) => {
  const id = modalId();
  let handle;
  const dialog = h(
    "dialog",
    { class: `c-drawer c-drawer--${side} c-drawer--${width}`, "aria-labelledby": `${id}-t` },
    modalHead(`${id}-t`, title, () => handle.close()),
    h("div", { class: "c-modal__body" }, resolveBody(body)),
    footer ? h("footer", { class: "c-modal__foot" }, resolveBody(footer)) : null,
  );
  handle = mountModal(dialog, { onClosed: () => onClose?.() });
  return { close: () => handle.close(), element: dialog };
};
