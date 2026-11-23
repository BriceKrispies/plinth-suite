// Request client (UI-MAP 3.2): the envelope, the errors, generated action routes and the kernel node API.
import { ACTION_ROUTES } from "./action-routes.js";
import { token, sessionId, markRevoked } from "./identity.js";

export class ApiError extends Error {
  constructor(info, status = 0) {
    super(info.message ?? "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = info.code ?? "ERROR";
    this.path = info.path ?? null;
    this.details = info.details ?? null;
    this.fix_hint = info.fix_hint ?? null;
    this.info = info;
  }
}

/** Normalise anything thrown into `{ code, message, path?, details? }`. */
export const toErrorInfo = (e) =>
  e instanceof ApiError ? e.info : { code: "ERROR", message: e instanceof Error ? e.message : String(e) };

const queryString = (query) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const text = q.toString();
  return text ? `?${text}` : "";
};

export const request = async (method, path, { query, body } = {}) => {
  let res;
  let parsed;
  try {
    res = await fetch(`/api${path}${queryString(query)}`, {
      method,
      headers: {
        authorization: `Bearer ${token()}`,
        "x-plinth-session": sessionId(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    parsed = await res.json();
  } catch (e) {
    throw new ApiError(
      { code: "UNREACHABLE", message: e instanceof Error ? e.message : String(e) },
      res?.status ?? 0,
    );
  }
  if (!parsed?.ok) {
    const info = parsed?.error ?? { code: "ERROR", message: "Request failed" };
    if (res.status === 401 && info.details?.reason === "SESSION_REVOKED") markRevoked();
    throw new ApiError(info, res.status);
  }
  return parsed.data;
};

/** Call a registry action by name; `:params` come from `input`, the rest is the query (GET, DELETE) or body. */
export const call = (actionName, input = {}) => {
  const route = ACTION_ROUTES[actionName];
  if (!route) throw new TypeError(`Unknown action "${actionName}"`);
  const rest = { ...input };
  const path = route.path.replace(/:([a-z_]+)/g, (_, name) => {
    const v = rest[name];
    delete rest[name];
    if (v === undefined || v === null) throw new TypeError(`Action ${actionName} needs "${name}"`);
    return encodeURIComponent(String(v));
  });
  // Reads go through the generic invoke route with a JSON body: a query string would turn numbers and
  // arrays into strings ("5", "a,b") that the action schemas rightly refuse. Same dispatcher, same checks.
  if (route.method === "GET") {
    return request("POST", `/suite/actions/${encodeURIComponent(actionName)}`, { body: { input } }).then(
      (out) => (out && typeof out === "object" && out.kind === "result" && "data" in out ? out.data : out),
    );
  }
  const readOnly = route.method === "DELETE";
  return request(route.method, path, readOnly ? { query: rest } : { body: rest });
};

/** `<prefix>:<16 random url-safe chars>`; one per user intent, never per retry. */
export const idempotencyKey = (prefix = "ui") => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}:${Array.from(bytes, (b) => alphabet[b % 64]).join("")}`;
};

// ---- kernel nodes ----

const PLINTH_NS = "6f0a7d2e-5b1c-4c1e-9d3a-7c2f4a1b8e90";
const WORKSPACE = "northwind";

const uuidv5 = async (namespace, name) => {
  const ns = Uint8Array.from(namespace.replace(/-/g, "").match(/../g), (b) => parseInt(b, 16));
  const nm = new TextEncoder().encode(name);
  const buf = new Uint8Array(ns.length + nm.length);
  buf.set(ns);
  buf.set(nm, ns.length);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-1", buf)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

const nodeUri = async (kind, slug) => {
  const ws = await uuidv5(PLINTH_NS, `workspace|${WORKSPACE}`);
  return `plinth://${WORKSPACE}/${kind}/${await uuidv5(PLINTH_NS, `${ws}|${kind}|${slug}`)}`;
};

const commit = (changes, { reason, idempotency_key } = {}) =>
  request("POST", "/changes", {
    body: {
      changes,
      ...(reason ? { reason } : {}),
      idempotency_key: idempotency_key ?? idempotencyKey("commit"),
    },
  });

/** Shallow structural diff of two node bodies into `{ path, before, after }` rows (JSON pointers). */
const diffBodies = (a, b, path = "") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(a) || !isObj(b)) return [{ path: path || "/", before: a, after: b }];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) =>
    diffBodies(a[k], b[k], `${path}/${k.replace(/~/g, "~0").replace(/\//g, "~1")}`),
  );
};

export const nodes = {
  /** One node by uri, id, or `kind:slug`. */
  get: (ref) => request("GET", `/nodes/${encodeURIComponent(ref)}`),
  list: async (kind) => (await request("GET", "/nodes", { query: { kind } })).items,
  commit,
  create: async (kind, slug, body, opts) =>
    commit(
      [{ target: await nodeUri(kind, slug), base_revision: null, ops: [{ op: "create", kind, slug, body }] }],
      opts,
    ),
  /** `ops` are change ops: { op: "set", path, value } | { op: "remove", path }. */
  patch: (uri, baseRevision, ops, opts) => commit([{ target: uri, base_revision: baseRevision, ops }], opts),
  remove: (uri, baseRevision, opts) =>
    commit([{ target: uri, base_revision: baseRevision, ops: [{ op: "delete" }] }], opts),
  history: async ({ uri, limit } = {}) => (await request("GET", "/history", { query: { uri, limit } })).items,
  /** Diff two node bodies (or two full node reads, which carry their body in `spec`). */
  diff: (a, b) => diffBodies(a?.spec ?? a?.body ?? a, b?.spec ?? b?.body ?? b),
};

/** Kernel query. `dashboard` makes the server apply the viewer's grant through that dashboard. */
export const query = (ast, { params, dashboard } = {}) =>
  request("POST", "/query", {
    body: {
      query: ast,
      ...(params && Object.keys(params).length > 0 ? { params } : {}),
      ...(dashboard ? { dashboard } : {}),
    },
  });
