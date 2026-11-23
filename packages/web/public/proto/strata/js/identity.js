import { search } from "./url.js";

/** Development identities. `?as=` picks the bearer token; the page fixes one for its lifetime. */
export const PRINCIPALS = Object.freeze([
  { id: "ops-lead", token: "dev-ops-lead", name: "Maya Ortiz", role: "Operations lead" },
  { id: "emea-lead", token: "dev-emea-lead", name: "Jonas Becker", role: "Regional lead, EMEA" },
  { id: "finance-analyst", token: "dev-finance-analyst", name: "Priya Nair", role: "Finance analyst" },
]);

export const principal = PRINCIPALS.find((p) => p.id === search().get("as")) ?? PRINCIPALS[0];

/** Switching identity reloads the page: every query is policy-filtered for the new principal. */
export const switchTo = (id) => {
  const q = search();
  q.set("as", id);
  q.delete("panel");
  location.search = q.toString();
};
