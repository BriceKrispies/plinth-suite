// View transitions (DESIGN-SYSTEM 3.11): one wrapper for every animated DOM swap.
// `document.startViewTransition` when the browser has it and motion is allowed; otherwise the update runs at once.
// The update never loses to the animation: an update that throws still lets the page render, and the error is
// rethrown to the caller afterwards. A newer transition skips the one still running (its update has run by then).
const root = document.documentElement;

const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches || root.dataset.reducedMotion === "true";
  } catch {
    return false;
  }
};

/** True when a change would animate: the API exists and the viewer has not asked for reduced motion. */
export const supported = () => typeof document.startViewTransition === "function" && !reduced();

/** A valid, collision-resistant `<custom-ident>` for `view-transition-name`, from any string. */
export const vtName = (prefix, key) => {
  const raw = String(key);
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) hash = ((hash * 33) ^ raw.charCodeAt(i)) >>> 0;
  const slug = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
  return `${prefix}-${slug}-${hash.toString(36)}`;
};

let active = null;

/**
 * Run `update` inside a view transition of the given `kind` ("route", "look", "live" or "nav"; it becomes
 * `html[data-vt]` so transitions.css can style that kind). `setup()` runs before the old state is captured;
 * `cleanup()` after the transition ends; `reveal(transition)` once the pseudo-elements exist.
 * Resolves with the result of `update`; rejects with its error, after the page has been updated as far as it got.
 */
export const transition = async (update, { kind = "route", setup, cleanup, reveal } = {}) => {
  if (!supported()) return update();
  active?.skipTransition();
  let result;
  let error;
  let failed = false;
  root.dataset.vt = kind;
  let vt;
  try {
    setup?.();
    vt = document.startViewTransition(async () => {
      try {
        result = await update();
      } catch (e) {
        failed = true;
        error = e;
      }
    });
  } catch {
    // the browser refused to start one: do the work plainly
    if (!active) delete root.dataset.vt;
    cleanup?.();
    return update();
  }
  active = vt;
  vt.ready.then(() => reveal?.(vt)).catch(() => {});
  vt.finished
    .catch(() => {})
    .then(() => {
      if (active !== vt) return;
      active = null;
      delete root.dataset.vt;
      try {
        cleanup?.();
      } catch {
        /* nothing to undo */
      }
    });
  await vt.updateCallbackDone.catch(() => {});
  if (failed) throw error;
  return result;
};
