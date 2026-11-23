// `<p-people-picker>`: a form-associated multi-select over people and groups, a `<p-combobox>` whose options come
// from `api.call("messages.recipients", { q, limit })`. DESIGN-SYSTEM 6.3 and 6.29.
// Its form value is one entry per chosen Recipient string (`user:<handle>`, `group:<slug>`) under `name`.
import { PCombobox } from "./combobox.js";
import { define } from "./element-base.js";

/** A readable stand-in label for a Recipient string that has not been searched for yet. */
export const recipientLabel = (recipient) => {
  const [kind, id] = String(recipient).split(":");
  return kind === "group" ? `Group ${id}` : `@${id}`;
};

export class PPeoplePicker extends PCombobox {
  /** The API client: `{ call(op, input) }`. */
  api = null;
  /** `(values, known) => void`, called after every user change with the Recipient strings and the option map. */
  onRecipients = null;
  /** Every option the picker has been offered, keyed by Recipient string. */
  known = new Map();

  /** Always a multi-select. */
  get multiple() {
    return true;
  }
  set multiple(_v) {}

  /** At most this many recipients (default 50). */
  get max() {
    const raw = this.getAttribute("max");
    return raw === null ? 50 : Number(raw);
  }
  set max(v) {
    this.setAttribute("max", String(v));
  }

  render() {
    this.classList.add("w-picker");
    super.render();
  }

  async _runSearch(q) {
    if (!this.api) return [];
    const out = await this.api.call("messages.recipients", { q, limit: 12 });
    const items = [...out.items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "person" ? -1 : 1));
    return items.map((o) => {
      this.known.set(o.recipient, o);
      return {
        value: o.recipient,
        label: o.label,
        description: o.allowed
          ? o.description || (o.member_count ? `${o.member_count} members` : "")
          : `${o.description || "Group"} · closed to you`,
        avatar: o.avatar ?? undefined,
        icon: o.kind === "group" ? "group" : undefined,
        group: o.kind === "group" ? "Groups" : "People",
      };
    });
  }

  _notify() {
    this.onRecipients?.(this.recipients, this.known);
  }

  /** The chosen Recipient strings. */
  get recipients() {
    return this._selected.map((s) => s.value);
  }

  set recipients(list) {
    this.selection = list
      .slice(0, this.max)
      .map((r) => ({ value: r, label: this.known.get(r)?.label ?? recipientLabel(r) }));
  }
}
define("p-people-picker", PPeoplePicker);
