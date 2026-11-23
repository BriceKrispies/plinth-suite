import { principal } from "./identity.js";

export class ApiError extends Error {
  constructor(info) {
    super(`${info.code}: ${info.message}`);
    this.info = info;
  }
}

const call = async (path, init = {}) => {
  let body;
  try {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${principal.token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
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

/** Resolves to true when the change log's hash chain verifies, false when the server says it does not. */
export const verifyAudit = async () => {
  const data = await call("/audit/verify");
  return data?.ok !== false && data?.valid !== false && data?.verified !== false;
};
