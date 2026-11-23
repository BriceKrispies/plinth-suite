// Dev identities. The principal is fixed for the lifetime of the page; switching navigates.
export const PRINCIPALS = [
  { id: "ops-lead", token: "dev-ops-lead", name: "Maya Ortiz", role: "Operations lead" },
  { id: "emea-lead", token: "dev-emea-lead", name: "Jonas Becker", role: "Regional lead, EMEA" },
  { id: "finance-analyst", token: "dev-finance-analyst", name: "Priya Nair", role: "Finance analyst" },
];

const resolve = () => {
  const as = new URLSearchParams(location.search).get("as");
  return PRINCIPALS.find((p) => p.id === as) ?? PRINCIPALS[0];
};

export const principal = resolve();
export const token = () => principal.token;

/** Build a page URL that keeps the chosen identity. */
export const href = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) q.set(k, v);
  const as = new URLSearchParams(location.search).get("as");
  if (as) q.set("as", as);
  const text = q.toString();
  return `${location.pathname}${text ? `?${text}` : ""}`;
};
