// Dev identity. The principal is fixed for the lifetime of the page; switching navigates with ?as=<handle>.
// Every seeded human has the dev token `dev-user-<handle>` (CONTRACT 1.1, K8).

const title = (handle) =>
  handle
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

const named = (handle, name, roles, region, department) => ({
  handle,
  name,
  roles,
  region,
  department,
  featured: true,
});
const plain = (handle, region, department) => ({
  handle,
  name: title(handle),
  roles: [],
  region,
  department,
  featured: false,
});

/** The seeded people (CONTRACT 11.2). The shell's switcher prefers `dev.principals` from the server. */
export const DEV_PEOPLE = [
  named("maya-ortiz", "Maya Ortiz", ["admin", "manager"], "NA", "operations"),
  named("jonas-becker", "Jonas Becker", ["manager"], "EMEA", "operations"),
  named("priya-nair", "Priya Nair", ["finance"], "APAC", "finance"),
  named("tomas-alvarez", "Tomás Alvarez", ["marketing-manager"], "LATAM", "marketing"),
  named("leah-okafor", "Leah Okafor", ["content-editor"], "EMEA", "people"),
  named("samir-haddad", "Samir Haddad", ["admin"], "EMEA", "technology"),
  ...[
    ["ana-silva", "NA", "fulfilment"],
    ["ben-carter", "NA", "fulfilment"],
    ["chloe-nguyen", "NA", "operations"],
    ["david-kim", "NA", "technology"],
    ["emma-brooks", "NA", "fulfilment"],
    ["frank-moore", "NA", "operations"],
    ["grace-lee", "NA", "people"],
    ["henry-walsh", "NA", "fulfilment"],
    ["isla-reed", "NA", "marketing"],
    ["jakob-meyer", "EMEA", "fulfilment"],
    ["lena-fischer", "EMEA", "operations"],
    ["marco-rossi", "EMEA", "fulfilment"],
    ["nadia-haddad", "EMEA", "finance"],
    ["oliver-hughes", "EMEA", "fulfilment"],
    ["paula-novak", "EMEA", "operations"],
    ["quentin-dubois", "EMEA", "technology"],
    ["rina-tanaka", "APAC", "fulfilment"],
    ["sanjay-patel", "APAC", "operations"],
    ["tara-wong", "APAC", "fulfilment"],
    ["umar-rahman", "APAC", "fulfilment"],
    ["vivian-chen", "APAC", "marketing"],
    ["wei-zhang", "APAC", "technology"],
    ["yuki-sato", "APAC", "operations"],
    ["zoe-castillo", "LATAM", "fulfilment"],
    ["andres-mejia", "LATAM", "operations"],
    ["bianca-souza", "LATAM", "fulfilment"],
    ["carlos-ruiz", "LATAM", "people"],
    ["diana-flores", "LATAM", "fulfilment"],
    ["ethan-clarke", "ANZ", "fulfilment"],
    ["fiona-walker", "ANZ", "operations"],
    ["george-tane", "ANZ", "fulfilment"],
    ["hannah-scott", "ANZ", "finance"],
    ["ivan-petrov", "ANZ", "technology"],
    ["jade-morgan", "ANZ", "fulfilment"],
  ].map(([handle, region, department]) => plain(handle, region, department)),
];

export const DEFAULT_HANDLE = "maya-ortiz";

const resolve = () => {
  const as = new URLSearchParams(location.search).get("as");
  if (!as) return { handle: DEFAULT_HANDLE, token: `dev-user-${DEFAULT_HANDLE}` };
  // A full dev token (dev-ops-lead, dev-user-ana-silva) is accepted as given.
  if (as.startsWith("dev-")) return { handle: as.replace(/^dev-(user-)?/, ""), token: as };
  return { handle: as, token: `dev-user-${as}` };
};

export const principal = resolve();
export const token = () => principal.token;

/**
 * One id per browser profile and person, kept in localStorage under the person's handle (a session belongs to the
 * principal that first used it, so the id must not follow a switch of person): `ses_<22 url-safe chars>`. Reloads and
 * new tabs reuse it, so a browser shows up as one session rather than one per page view.
 */
export const sessionId = () => {
  const key = `plinth-session:${principal.handle}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  } catch {
    /* storage unavailable: the id lasts for this page view */
  }
  if (!sessionId.cached) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    const bytes = crypto.getRandomValues(new Uint8Array(22));
    sessionId.cached = `ses_${Array.from(bytes, (b) => alphabet[b % 64]).join("")}`;
    try {
      localStorage.setItem(key, sessionId.cached);
    } catch {
      /* ignore */
    }
  }
  return sessionId.cached;
};

/** Reload as another person, keeping the current path. */
export const switchTo = (handle) => {
  const url = new URL(location.href);
  url.searchParams.set("as", handle);
  location.assign(url.toString());
};

// ---- session revoked: one place both the api client and the socket report to ----
const revokedHandlers = new Set();
let revoked = false;
export const onRevoked = (fn) => {
  revokedHandlers.add(fn);
  if (revoked) fn();
  return () => revokedHandlers.delete(fn);
};
export const markRevoked = () => {
  if (revoked) return;
  revoked = true;
  for (const fn of revokedHandlers) fn();
};
