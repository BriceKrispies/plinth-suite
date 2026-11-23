// Dev identity, as packages/web/src/core/identity.js: the principal comes from ?as= and is fixed for the page; the
// token is `dev-user-<handle>` (a full `dev-...` token is accepted as given); the session id is per browser profile
// and person, under the same localStorage key Classic uses, so both apps show up as one session.

const DEFAULT_HANDLE = "maya-ortiz";

const resolve = (): { handle: string; token: string } => {
  const as = new URLSearchParams(location.search).get("as");
  if (!as) return { handle: DEFAULT_HANDLE, token: `dev-user-${DEFAULT_HANDLE}` };
  if (as.startsWith("dev-")) return { handle: as.replace(/^dev-(user-)?/, ""), token: as };
  return { handle: as, token: `dev-user-${as}` };
};

export const principal = resolve();
export const token = (): string => principal.token;

let cached: string | null = null;
export const sessionId = (): string => {
  const key = `plinth-session:${principal.handle}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
  } catch {
    // storage unavailable: the id lasts for this page view
  }
  if (!cached) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    const bytes = crypto.getRandomValues(new Uint8Array(22));
    cached = `ses_${Array.from(bytes, (b) => alphabet[b % 64]).join("")}`;
    try {
      localStorage.setItem(key, cached);
    } catch {
      // ignore
    }
  }
  return cached;
};
