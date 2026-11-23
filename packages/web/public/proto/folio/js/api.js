import { token } from "./identity.js";

/** An `{ok:false}` envelope or a transport failure, with its code intact. */
export class ApiError extends Error {
  constructor(info) {
    super(`${info.code}: ${info.message}`);
    this.info = info;
  }
}

const call = async (path, init) => {
  let body;
  try {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    });
    body = await res.json();
  } catch (e) {
    throw new ApiError({ code: "UNREACHABLE", message: e instanceof Error ? e.message : String(e) });
  }
  if (!body.ok) throw new ApiError(body.error);
  return body.data;
};

export const toErrorInfo = (e) =>
  e instanceof ApiError ? e.info : { code: "ERROR", message: e instanceof Error ? e.message : String(e) };

export const findNode = async (kind, slug) =>
  (await call(`/nodes?kind=${kind}&slug=${encodeURIComponent(slug)}`)).items[0];

export const listNodes = async (kind) => (await call(`/nodes?kind=${kind}`)).items;

export const runQuery = (query, params) =>
  call("/query", {
    method: "POST",
    body: JSON.stringify({ query, ...(params && Object.keys(params).length > 0 ? { params } : {}) }),
  });

export const verifyAudit = () => call("/audit/verify");
