// Rule builder (CondTree editor) and step list. DESIGN-SYSTEM 6.21.
import { h, uid, clear, announce } from "./dom.js";
import { button, iconButton } from "./button.js";
import { icon } from "./icons.js";
import { textField, numberField, selectField, dateTimeField, checkboxField, fieldset } from "./field.js";
import { combobox } from "./combobox.js";
import { number, points, dateTime } from "./format.js";

const OP_LABEL = {
  eq: "is",
  ne: "is not",
  lt: "is less than",
  lte: "is at most",
  gt: "is more than",
  gte: "is at least",
  in: "is one of",
  not_in: "is none of",
  contains: "includes",
  not_contains: "does not include",
  exists: "is set",
  not_exists: "is not set",
  between: "is between",
};
const JOIN_LABEL = {
  all: "All of the following are true",
  any: "Any of the following is true",
  not: "None of the following is true",
};
const NO_VALUE = new Set(["exists", "not_exists"]);
const LIST_OPS = new Set(["in", "not_in"]);

const localOf = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const isoOf = (local) => (local ? new Date(local).toISOString() : "");

let nid = 0;
const fromTree = (tree) => {
  if (tree && "all" in tree)
    return { id: ++nid, kind: "group", join: "all", children: tree.all.map(fromTree) };
  if (tree && "any" in tree)
    return { id: ++nid, kind: "group", join: "any", children: tree.any.map(fromTree) };
  if (tree && "not" in tree) return { id: ++nid, kind: "group", join: "not", children: [fromTree(tree.not)] };
  return { id: ++nid, kind: "cond", path: tree.field, op: tree.op, value: tree.value };
};

const nodeValid = (node, facts, maxDepth, depth) => {
  if (node.kind === "cond") {
    const fact = facts.find((f) => f.path === node.path);
    if (!fact || !fact.ops.includes(node.op)) return false;
    if (NO_VALUE.has(node.op)) return true;
    const v = node.value;
    if (node.op === "between")
      return (
        Array.isArray(v) &&
        v.length === 2 &&
        v.every((x) => x !== "" && x !== null && x !== undefined) &&
        v[0] <= v[1]
      );
    if (LIST_OPS.has(node.op) || fact.type === "string[]")
      return Array.isArray(v) ? v.length > 0 : v !== "" && v !== undefined && v !== null;
    return v !== "" && v !== undefined && v !== null && !(typeof v === "number" && Number.isNaN(v));
  }
  if (depth > maxDepth) return false;
  const n = node.children.length;
  if (node.join === "not" ? n !== 1 : n < 1 || n > 20) return false;
  return node.children.every((c) => nodeValid(c, facts, maxDepth, depth + 1));
};

const toTree = (node) => {
  if (node.kind === "cond") {
    const out = { field: node.path, op: node.op };
    if (!NO_VALUE.has(node.op)) out.value = node.value;
    return out;
  }
  if (node.join === "not") return { not: toTree(node.children[0]) };
  return { [node.join]: node.children.map(toTree) };
};

const quote = (fact, v) => {
  if (fact?.type === "timestamp") return dateTime(v);
  if (fact?.path?.includes("balance") || fact?.path?.includes("points"))
    return typeof v === "number" ? points(v) : String(v);
  return typeof v === "number" ? number(v) : String(v);
};

const phrase = (node, facts) => {
  if (node.kind === "cond") {
    const fact = facts.find((f) => f.path === node.path);
    const label = fact?.label ?? node.path;
    if (NO_VALUE.has(node.op)) return `${label.toLowerCase()} ${OP_LABEL[node.op]}`;
    const v = node.value;
    const text = Array.isArray(v)
      ? node.op === "between"
        ? v.map((x) => quote(fact, x)).join(" and ")
        : v.map((x) => quote(fact, x)).join(", ")
      : quote(fact, v);
    return `${label.toLowerCase()} ${OP_LABEL[node.op]} ${text}`;
  }
  const parts = node.children.map((c) =>
    c.kind === "group" && c.children.length > 1 ? `(${phrase(c, facts)})` : phrase(c, facts),
  );
  if (node.join === "not") return `not ${parts[0] ?? "…"}`;
  return parts.join(node.join === "all" ? " and " : " or ");
};

export const ruleBuilder = ({ label, facts, value, onChange, maxDepth = 3 }) => {
  const firstFact = facts[0];
  const blank = () => ({
    id: ++nid,
    kind: "cond",
    path: firstFact.path,
    op: firstFact.ops[0],
    value: undefined,
  });
  let root = value ? fromTree(value) : { id: ++nid, kind: "group", join: "all", children: [blank()] };
  if (root.kind === "cond") root = { id: ++nid, kind: "group", join: "all", children: [root] };
  let lastValid = nodeValid(root, facts, maxDepth, 1) ? toTree(root) : null;

  const summary = h("p", { class: "c-rule__summary", "aria-live": "off" });
  const host = h("div", { class: "c-rule", role: "group", "aria-label": label });

  const changed = () => {
    if (nodeValid(root, facts, maxDepth, 1)) {
      lastValid = toTree(root);
      summary.textContent = `Members where ${phrase(root, facts)}`;
      summary.classList.remove("is-stale");
      onChange?.(lastValid);
    } else {
      summary.classList.add("is-stale");
      summary.textContent = lastValid
        ? "Complete every condition to apply this rule"
        : "Add a condition to build the rule";
    }
  };

  const focusRow = (id) => queueMicrotask(() => host.querySelector(`[data-node="${id}"] select`)?.focus());
  const rerender = (focusId) => {
    draw();
    if (focusId) focusRow(focusId);
    changed();
  };

  const select = (labelText, opts, current, onSel) => {
    const sel = h(
      "select",
      { class: "c-field__control c-rule__select", "aria-label": labelText },
      ...opts.map((o) =>
        h("option", { value: o.value, selected: o.value === current ? true : null }, o.label),
      ),
    );
    sel.addEventListener("change", () => onSel(sel.value));
    return sel;
  };

  const valueControl = (node, fact) => {
    const type = fact.type;
    const set = (v) => {
      node.value = v;
      changed();
    };
    const lbl = "Value";
    if (node.op === "between") {
      const cur = Array.isArray(node.value) ? node.value : ["", ""];
      const part = (i, name) => {
        const update = (v) => {
          const next = Array.isArray(node.value) ? [...node.value] : ["", ""];
          next[i] = v;
          set(next);
        };
        if (type === "timestamp")
          return dateTimeField({
            name: `${node.id}-${i}`,
            label: name,
            value: localOf(cur[i]),
            onInput: (v) => update(isoOf(v)),
          });
        return numberField({
          name: `${node.id}-${i}`,
          label: name,
          value: cur[i] === "" ? undefined : cur[i],
          step: type === "int" ? 1 : "any",
          onInput: (v) => update(v ?? ""),
        });
      };
      return h("div", { class: "c-rule__between" }, part(0, "From"), part(1, "To"));
    }
    if (type === "bool") {
      return selectField({
        name: `${node.id}`,
        label: lbl,
        value: node.value === undefined ? "" : String(node.value),
        options: [
          { value: "", label: "Choose" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        onChange: (v) => set(v === "" ? undefined : v === "true"),
      });
    }
    if (type === "enum" && LIST_OPS.has(node.op)) {
      return fieldset({
        legend: lbl,
        children: checkboxField({
          name: `${node.id}`,
          label: lbl,
          options: (fact.values ?? []).map((v) => ({ value: v, label: v })),
          value: node.value ?? [],
          onChange: (v) => set(v),
        }),
      });
    }
    if (type === "enum") {
      return selectField({
        name: `${node.id}`,
        label: lbl,
        value: node.value ?? "",
        options: [
          { value: "", label: "Choose" },
          ...(fact.values ?? []).map((v) => ({ value: v, label: v })),
        ],
        onChange: (v) => set(v === "" ? undefined : v),
      });
    }
    if (type === "timestamp")
      return dateTimeField({
        name: `${node.id}`,
        label: lbl,
        value: localOf(node.value),
        onInput: (v) => set(isoOf(v)),
      });
    if (type === "int" || type === "float")
      return numberField({
        name: `${node.id}`,
        label: lbl,
        value: node.value,
        step: type === "int" ? 1 : "any",
        onInput: (v) => set(v ?? ""),
      });
    if (type === "string[]" && fact.values) {
      return combobox({
        label: lbl,
        name: `${node.id}`,
        multiple: true,
        value: (Array.isArray(node.value) ? node.value : []).map((v) => ({ value: v, label: v })),
        search: async (q) =>
          fact.values
            .filter((v) => v.toLowerCase().includes(q.toLowerCase()))
            .map((v) => ({ value: v, label: v })),
        onChange: (items) => set(items.map((i) => i.value)),
      });
    }
    const list = LIST_OPS.has(node.op) || type === "string[]";
    return textField({
      name: `${node.id}`,
      label: lbl,
      value: Array.isArray(node.value) ? node.value.join(", ") : (node.value ?? ""),
      hint: list ? "Separate values with commas" : undefined,
      onInput: (v) =>
        set(
          list
            ? v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
            : v,
        ),
    });
  };

  const condRow = (node, parent) => {
    const fact = facts.find((f) => f.path === node.path) ?? firstFact;
    const row = h("div", { class: "c-rule__row", "data-node": node.id });
    row.append(
      select(
        "Fact",
        facts.map((f) => ({ value: f.path, label: f.label })),
        node.path,
        (p) => {
          const nf = facts.find((f) => f.path === p);
          node.path = p;
          node.op = nf.ops[0];
          node.value = undefined;
          announce(`Condition changed to ${nf.label}`);
          rerender(node.id);
        },
      ),
      select(
        "Operator",
        fact.ops.map((o) => ({ value: o, label: OP_LABEL[o] })),
        node.op,
        (o) => {
          node.op = o;
          node.value = undefined;
          rerender(node.id);
        },
      ),
      ...[
        NO_VALUE.has(node.op) ? null : h("div", { class: "c-rule__value" }, valueControl(node, fact)),
      ].filter(Boolean),
      iconButton({
        icon: "x",
        label: "Remove condition",
        size: "sm",
        onClick: () => {
          const i = parent.children.indexOf(node);
          parent.children.splice(i, 1);
          announce(`Condition removed, ${parent.children.length} in this group`);
          rerender(parent.children[i]?.id ?? parent.children[i - 1]?.id);
          if (!parent.children.length)
            host.querySelector(`[data-node="${parent.id}"] .c-rule__actions button`)?.focus();
        },
      }),
    );
    return row;
  };

  const groupNode = (node, parent, depth) => {
    const full = node.children.length >= 20;
    const notFull = node.join === "not" && node.children.length >= 1;
    const group = h("fieldset", {
      class: `c-rule__group${depth > 1 ? " c-rule__group--nested" : ""}`,
      "data-node": node.id,
    });
    group.append(
      h(
        "legend",
        { class: "c-rule__legend" },
        select(
          "Group join",
          Object.entries(JOIN_LABEL).map(([v, l]) => ({ value: v, label: l })),
          node.join,
          (j) => {
            node.join = j;
            if (j === "not" && node.children.length > 1) node.children.length = 1;
            rerender();
          },
        ),
      ),
    );
    const kids = h("div", { class: "c-rule__children" });
    if (node.children.length === 0)
      kids.append(
        h(
          "p",
          { class: "c-field__error" },
          icon("alert", { size: 16 }),
          "Add at least one condition or remove this group",
        ),
      );
    for (const c of node.children)
      kids.append(c.kind === "cond" ? condRow(c, node) : groupNode(c, node, depth + 1));
    group.append(kids);
    const add = (child) => {
      node.children.push(child);
      announce(
        `${child.kind === "cond" ? "Condition" : "Group"} added, ${node.children.length} in this group`,
      );
      rerender(child.kind === "cond" ? child.id : child.children[0]?.id);
    };
    const hint = notFull
      ? "Wrap this in an All or Any group to add more"
      : full
        ? "Up to 20 conditions in a group"
        : null;
    group.append(
      h(
        "div",
        { class: "c-rule__actions" },
        button({
          label: "Add condition",
          icon: "plus",
          size: "sm",
          disabled: full || notFull,
          onClick: () => add(blank()),
        }),
        depth < maxDepth
          ? button({
              label: "Add group",
              icon: "plus",
              size: "sm",
              disabled: full || notFull,
              onClick: () => add({ id: ++nid, kind: "group", join: "all", children: [blank()] }),
            })
          : null,
        parent
          ? button({
              label: "Remove group",
              icon: "trash",
              size: "sm",
              variant: "ghost",
              onClick: () => {
                parent.children.splice(parent.children.indexOf(node), 1);
                announce("Group removed");
                rerender();
              },
            })
          : null,
        hint ? h("span", { class: "c-field__hint" }, hint) : null,
      ),
    );
    return group;
  };

  function draw() {
    clear(host);
    host.append(groupNode(root, null, 1), summary);
  }
  draw();
  if (lastValid) summary.textContent = `Members where ${phrase(root, facts)}`;
  else changed();
  return host;
};

export const stepList = ({
  label,
  items,
  renderItem,
  onAdd,
  onRemove,
  onMove,
  addLabel = "Add step",
  max,
}) => {
  const list = h("ol", { class: "c-steps", "aria-label": label });
  const root = h("div", { class: "c-steps-wrap" }, list);
  const total = () => list.children.length;
  const move = (from, to, step) => {
    if (to < 0 || to >= items.length) return;
    onMove?.(from, to);
    announce(`Step ${from + 1} moved to position ${to + 1} of ${items.length}`);
    queueMicrotask(
      () =>
        root.querySelectorAll(".c-step")[to]?.querySelector(`[data-move="${step}"]`)?.focus() ??
        root.querySelectorAll(".c-step")[to]?.focus(),
    );
  };
  items.forEach((item, i) => {
    const li = h("li", { class: "c-step", tabindex: "-1", id: uid("step") });
    li.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && e.target === li) {
        e.preventDefault();
        move(i, i + (e.key === "ArrowUp" ? -1 : 1), "");
      }
    });
    const up = iconButton({
      icon: "chevron-up",
      label: "Move up",
      size: "sm",
      disabled: i === 0,
      onClick: () => move(i, i - 1, "up"),
    });
    const down = iconButton({
      icon: "chevron-down",
      label: "Move down",
      size: "sm",
      disabled: i === items.length - 1,
      onClick: () => move(i, i + 1, "down"),
    });
    up.dataset.move = "up";
    down.dataset.move = "down";
    li.append(
      h(
        "div",
        { class: "c-step__head" },
        h("span", { class: "c-step__num" }, `Step ${i + 1}`),
        h(
          "span",
          { class: "c-step__tools" },
          up,
          down,
          iconButton({ icon: "x", label: "Remove step", size: "sm", onClick: () => onRemove?.(i) }),
        ),
      ),
      h("div", { class: "c-step__body" }, renderItem(item, i)),
    );
    list.append(li);
  });
  const atMax = max !== undefined && total() >= max;
  root.append(
    h(
      "div",
      { class: "c-steps__add" },
      button({
        label: addLabel,
        icon: "plus",
        variant: "secondary",
        disabled: atMax,
        onClick: () => onAdd?.(),
      }),
      atMax ? h("span", { class: "c-field__hint" }, `Up to ${max} steps`) : null,
    ),
  );
  return root;
};
