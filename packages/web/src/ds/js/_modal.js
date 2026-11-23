// Shared plumbing for the tier-4 native dialogs (dialog, drawer, sheet): mount in #app-drawers, open modally,
// return focus to the opener on close, and honour Escape through the native cancel event.
import { h, uid } from "./dom.js";
import { iconButton } from "./button.js";

/**
 * Open `dialog` modally. Returns { close(value), element }. `onClosed(value)` runs after removal.
 * `cancelValue` is what Escape resolves with. `initialFocus` is an element to focus first.
 */
export const mountModal = (
  dialog,
  { dismissable = true, cancelValue = null, onClosed, initialFocus } = {},
) => {
  const opener = document.activeElement;
  let result = cancelValue;
  let finished = false;
  (document.getElementById("app-drawers") ?? document.body).append(dialog);
  dialog.addEventListener("cancel", (e) => {
    if (!dismissable) {
      e.preventDefault();
      return;
    }
    result = cancelValue;
  });
  dialog.addEventListener("close", () => {
    if (finished) return;
    finished = true;
    dialog.remove();
    if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    onClosed?.(result);
  });
  dialog.showModal();
  const first =
    initialFocus ??
    dialog.querySelector("[data-autofocus]") ??
    dialog.querySelector(
      ".c-modal__body :is(a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1']))",
    ) ??
    dialog.querySelector(".c-modal__close");
  first?.focus();
  return {
    element: dialog,
    close: (value = cancelValue) => {
      result = value;
      if (dialog.open) dialog.close();
      else if (!finished) dialog.dispatchEvent(new Event("close"));
    },
  };
};

/** The standard head (title and close button) shared by dialog, drawer and sheet. */
export const modalHead = (titleId, title, onClose, dismissable = true) => {
  const close = dismissable ? iconButton({ icon: "x", label: "Close", onClick: onClose }) : null;
  close?.classList.add("c-modal__close");
  return h(
    "header",
    { class: "c-modal__head" },
    h("h2", { class: "c-modal__title", id: titleId }, title),
    close,
  );
};

export const modalId = () => uid("modal");

export const resolveBody = (body) => (typeof body === "function" ? body() : body);
