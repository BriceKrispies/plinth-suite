/** Session state lives in the URL: nothing here is a document change and nothing is stored. */
export const search = () => new URLSearchParams(location.search);

export const patchSearch = (patch) => {
  const q = search();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) q.delete(key);
    else q.set(key, value);
  }
  const text = q.toString();
  history.replaceState(null, "", `${location.pathname}${text ? `?${text}` : ""}`);
};

/** A link to another page of this prototype that keeps the chosen identity. */
export const pageHref = (extra = {}) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) q.set(key, value);
  const as = search().get("as");
  if (as) q.set("as", as);
  const text = q.toString();
  return `index.html${text ? `?${text}` : ""}`;
};
