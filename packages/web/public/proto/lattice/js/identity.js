// Dev identities. Switching identity navigates (the token is fixed for the page's lifetime).
export const PRINCIPALS = [
  { id: 'ops-lead', token: 'dev-ops-lead', name: 'Maya Ortiz', role: 'Operations lead', initials: 'MO' },
  { id: 'emea-lead', token: 'dev-emea-lead', name: 'Jonas Becker', role: 'Regional lead, EMEA', initials: 'JB' },
  { id: 'finance-analyst', token: 'dev-finance-analyst', name: 'Priya Nair', role: 'Finance analyst', initials: 'PN' },
];

const requested = new URLSearchParams(location.search).get('as');
export const principal = PRINCIPALS.find((p) => p.id === requested) ?? PRINCIPALS[0];
export const token = () => principal.token;

/** Query-only link that keeps the identity. */
export const href = (params = {}) => {
  const q = new URLSearchParams(params);
  if (requested) q.set('as', requested);
  const text = q.toString();
  return text ? `?${text}` : location.pathname;
};
