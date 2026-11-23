import { icon } from "./icons.js";
import { PElement, define, reflect, swapClass } from "./element-base.js";

const TONES = ["neutral", "info", "success", "warning", "danger", "signal"];
const isIcon = (n) => n.nodeType === 1 && n.hasAttribute("data-pill-icon");

/** `<p-pill tone icon>label</p-pill>`: the label is the element's own text; the icon is drawn from `icon`. */
export class PPill extends PElement {
  static observedAttributes = ["tone", "icon"];
  #tone = null;

  render() {
    const tone = TONES.includes(this.tone) ? this.tone : "neutral";
    this.classList.add("c-pill");
    this.#tone = swapClass(this, this.#tone, `c-pill--${tone}`);
    const old = [...this.childNodes].find(isIcon);
    const name = this.icon;
    if (old && old.getAttribute("name") === name) return;
    old?.remove();
    if (name) {
      const ic = icon(name, { size: 16 });
      ic.setAttribute("data-pill-icon", "");
      this.prepend(ic);
    }
  }

  get label() {
    return [...this.childNodes]
      .filter((n) => !isIcon(n))
      .map((n) => n.textContent)
      .join("");
  }

  set label(v) {
    for (const n of [...this.childNodes]) if (!isIcon(n)) n.remove();
    if (v === null || v === undefined || v === false) return;
    this.append(v instanceof Node ? v : document.createTextNode(String(v)));
  }
}
reflect(PPill, { tone: ["tone", "string", "neutral"], icon: ["icon", "string"] });
define("p-pill", PPill);

export const pill = ({ label, tone = "neutral", icon: ic } = {}) => {
  const el = document.createElement("p-pill");
  return el.configure({ tone, icon: ic ?? null, label });
};

const S = (label, tone) => ({ label, tone });
const VOCAB = {
  order: {
    placed: S("Placed", "info"),
    approved: S("Approved", "info"),
    fulfilled: S("Fulfilled", "info"),
    shipped: S("Shipped", "info"),
    delivered: S("Delivered", "success"),
    cancelled: S("Cancelled", "neutral"),
    refunded: S("Refunded", "warning"),
  },
  promotion: {
    draft: S("Draft", "neutral"),
    scheduled: S("Scheduled", "info"),
    active: S("Active", "success"),
    paused: S("Paused", "warning"),
    ended: S("Ended", "neutral"),
  },
  content: {
    draft: S("Draft", "neutral"),
    in_review: S("In review", "warning"),
    approved: S("Approved", "info"),
    published: S("Published", "success"),
    archived: S("Archived", "neutral"),
  },
  run: {
    queued: S("Queued", "neutral"),
    running: S("Running", "info"),
    succeeded: S("Succeeded", "success"),
    failed: S("Failed", "danger"),
    skipped: S("Skipped", "neutral"),
    cancelled: S("Cancelled", "neutral"),
  },
  step: {
    pending: S("Pending", "neutral"),
    running: S("Running", "info"),
    succeeded: S("Succeeded", "success"),
    failed: S("Failed", "danger"),
    skipped: S("Skipped", "neutral"),
  },
  task: {
    open: S("Open", "neutral"),
    in_progress: S("In progress", "info"),
    blocked: S("Blocked", "danger"),
    done: S("Done", "success"),
    cancelled: S("Cancelled", "neutral"),
  },
  approval: {
    pending_approval: S("Awaiting decision", "warning"),
    approved: S("Approved", "success"),
    rejected: S("Rejected", "danger"),
    withdrawn: S("Withdrawn", "neutral"),
    expired: S("Expired", "neutral"),
    stale: S("Stale", "neutral"),
    failed: S("Failed after approval", "danger"),
  },
  stock: {
    in_stock: S("In stock", "success"),
    low: S("Low stock", "warning"),
    out: S("Out of stock", "danger"),
  },
  tier: {
    bronze: S("Bronze", "neutral"),
    silver: S("Silver", "neutral"),
    gold: S("Gold", "neutral"),
    platinum: S("Platinum", "neutral"),
  },
};

/** Exposed for the styleguide, which draws every mapping row. */
export const STATUS_VOCABULARIES = VOCAB;

const TONE_ICON = {
  info: "info",
  success: "check-circle",
  warning: "alert",
  danger: "alert",
  signal: "bolt",
  neutral: null,
};

export const statusPill = (vocabulary, status) => {
  const entry = VOCAB[vocabulary]?.[status];
  if (!entry) throw new TypeError(`Unknown status "${status}" for vocabulary "${vocabulary}"`);
  const el = pill({
    label: entry.label,
    tone: entry.tone,
    icon: vocabulary === "tier" ? null : TONE_ICON[entry.tone],
  });
  el.classList.add(`c-pill--status-${vocabulary}`);
  if (vocabulary === "tier") el.classList.add(`c-pill--tier-${status}`);
  return el;
};
