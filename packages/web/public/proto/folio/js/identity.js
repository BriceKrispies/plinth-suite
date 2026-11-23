/** Dev identities. `?as=` picks the bearer token; switching identity reloads the page. */

export const PRINCIPALS = [
  { id: "ops-lead", token: "dev-ops-lead", name: "Maya Ortiz", role: "Operations lead" },
  { id: "emea-lead", token: "dev-emea-lead", name: "Jonas Becker", role: "Regional lead, EMEA" },
  { id: "finance-analyst", token: "dev-finance-analyst", name: "Priya Nair", role: "Finance analyst" },
];

const asParam = new URLSearchParams(location.search).get("as");
export const principal = PRINCIPALS.find((p) => p.id === asParam) ?? PRINCIPALS[0];
export const token = () => principal.token;

export const initials = (name) =>
  name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

/** A same-page link that keeps the current identity. */
export const hrefFor = (params = {}) => {
  const q = new URLSearchParams(params);
  if (asParam) q.set("as", asParam);
  const s = q.toString();
  return s ? `?${s}` : "./";
};

export const switchTo = (id) => {
  const q = new URLSearchParams(location.search);
  q.set("as", id);
  location.search = q.toString();
};
