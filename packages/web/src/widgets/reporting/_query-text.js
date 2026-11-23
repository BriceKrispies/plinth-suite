// Plain-language renderings of a query AST: a one-line summary for empty states and a multi-line listing for
// the inspector.
const fmtValue = (v) => (Array.isArray(v) ? `[${v.map(fmtValue).join(", ")}]` : JSON.stringify(v));

/** One-line summary for empty states. */
export const summarizeQuery = (q) => {
  if (!q) return "no query";
  const parts = [`from ${q.from}`];
  if (q.where?.length)
    parts.push(
      `where ${q.where.map((p) => `${p.field} ${p.op}${p.value === undefined ? "" : ` ${fmtValue(p.value)}`}`).join(" and ")}`,
    );
  if (q.group?.length) parts.push(`group by ${q.group.join(", ")}`);
  if (q.aggregate) parts.push(`aggregate ${Object.keys(q.aggregate).join(", ")}`);
  if (q.limit) parts.push(`limit ${q.limit}`);
  return parts.join(" · ");
};

/** Multi-line, human-readable rendering of a query AST for the inspector. */
export const formatQuery = (q) => {
  if (!q) return "No query.";
  const lines = [`from       ${q.from}`];
  for (const [i, p] of (q.where ?? []).entries()) {
    lines.push(
      `${i === 0 ? "where     " : "  and     "} ${p.field} ${p.op}${p.value === undefined ? "" : ` ${fmtValue(p.value)}`}`,
    );
  }
  for (const [name, expr] of Object.entries(q.derive ?? {})) lines.push(`derive     ${name} = ${expr}`);
  if (q.group?.length) lines.push(`group by   ${q.group.join(", ")}`);
  for (const [name, expr] of Object.entries(q.aggregate ?? {}))
    lines.push(`aggregate  ${name} = ${typeof expr === "string" ? expr : JSON.stringify(expr)}`);
  if (q.select?.length) lines.push(`select     ${q.select.join(", ")}`);
  if (q.order?.length) lines.push(`order by   ${q.order.map((o) => `${o.field} ${o.dir}`).join(", ")}`);
  if (q.limit) lines.push(`limit      ${q.limit}`);
  return lines.join("\n");
};
