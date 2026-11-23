/** Dev identities. `?as=` picks the bearer token; switching identity reloads the page. */
export const PRINCIPALS = [
  { id: "ops-lead", token: "dev-ops-lead", name: "Maya Ortiz", role: "Operations lead" },
  { id: "emea-lead", token: "dev-emea-lead", name: "Jonas Becker", role: "Regional lead, EMEA" },
  { id: "finance-analyst", token: "dev-finance-analyst", name: "Priya Nair", role: "Finance analyst" },
];

const requested = new URLSearchParams(location.search).get("as");
export const principal = PRINCIPALS.find((p) => p.id === requested) ?? PRINCIPALS[0];
export const token = () => principal.token;

/** Build a link that keeps the current identity. */
export const href = (extra = {}) => {
  const q = new URLSearchParams(extra);
  if (requested) q.set("as", requested);
  const text = q.toString();
  return text ? `?${text}` : location.pathname;
};

export const switchTo = (id) => {
  const q = new URLSearchParams(location.search);
  q.set("as", id);
  location.search = q.toString();
};
