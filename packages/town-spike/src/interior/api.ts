// API client for the spike: the same envelope and dev identity as packages/web (core/api.js, core/identity.js).
// Reads go through POST /api/suite/actions/<name> with { input }; the transfer is POST /api/suite/points/transfers.

import { token } from "../swap/identity";

export interface PersonRef {
  readonly handle: string | null;
  readonly display_name: string;
  readonly kind: "human" | "agent" | "service";
}

export interface StatementLine {
  readonly txn_id: string;
  readonly txn_no: number;
  readonly txn_type: string;
  readonly occurred_at: string;
  readonly memo: string;
  readonly amount: number;
  readonly balance_after: number;
  readonly counterparty: PersonRef | { system: string } | null;
  readonly ref: { kind: string; label?: string } | null;
}

export interface StatementPage {
  readonly items: StatementLine[];
  readonly next_cursor: string | null;
  readonly opening_balance: number;
  readonly closing_balance: number;
  readonly credits: number;
  readonly debits: number;
}

export interface PointsSummary {
  readonly balance: number;
  readonly transfer_remaining_today: number;
}

export interface MemberCard {
  readonly person: PersonRef;
  readonly region: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly path: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, body: unknown, method = "POST"): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await res.json()) as {
    ok: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; path?: string };
  };
  if (!parsed.ok) {
    const e = parsed.error ?? {};
    throw new ApiError(e.message ?? "Request failed", e.code ?? "ERROR", e.path ?? null, res.status);
  }
  return parsed.data as T;
};

/** Call a read action through the generic invoke route. */
export const action = async <T>(name: string, input: Record<string, unknown> = {}): Promise<T> => {
  const out = await request<{ kind?: string; data?: unknown }>(`/suite/actions/${encodeURIComponent(name)}`, {
    input,
  });
  return (out && typeof out === "object" && out.kind === "result" && "data" in out ? out.data : out) as T;
};

/** Every statement line for the viewer, newest first, in pages of 200. */
export const fetchStatement = async (): Promise<{ lines: StatementLine[]; first: StatementPage | null }> => {
  const lines: StatementLine[] = [];
  let cursor: string | null = null;
  let first: StatementPage | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page: StatementPage = await action<StatementPage>("points.statement", {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    first ??= page;
    lines.push(...page.items);
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return { lines, first };
};

export interface Me {
  readonly principal: PersonRef;
  readonly member: { readonly handle: string; readonly display_name: string } | null;
  readonly roles?: { readonly role: string; readonly title: string }[];
  readonly permissions: string[];
  readonly balance: number | null;
  readonly tier: {
    readonly tier: string;
    readonly next_tier: string | null;
    readonly progress: number;
  } | null;
  readonly counts: Record<string, number>;
}

export const fetchMe = (): Promise<Me> => action<Me>("me.get", {});

export interface SiteAppearance {
  readonly look?: string;
  readonly density?: string;
  readonly experience?: "classic" | "town";
}

/** The site default (UI-MAP 8.5 rule 1): `site.appearance.get` through the generic action route. */
export const fetchAppearance = async (): Promise<SiteAppearance> => {
  const out = await action<{ appearance: SiteAppearance }>("site.appearance.get", {});
  return out.appearance ?? {};
};

export const fetchSummary = (): Promise<PointsSummary> => action<PointsSummary>("points.summary", {});

export const fetchPeople = async (): Promise<MemberCard[]> => {
  const out = await action<{ items: MemberCard[] }>("people.directory", { limit: 200, sort: "name" });
  return out.items;
};

/** Not called by the measurement script: the spike only types into the form and reviews. */
export const sendTransfer = (input: {
  to: string;
  points: number;
  memo: string;
  idempotency_key: string;
}): Promise<{ txn_no: number; balance: number; replayed: boolean }> =>
  request("/suite/points/transfers", input);

export const idempotencyKey = (prefix: string): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}:${Array.from(bytes, (b) => alphabet[b % 64]).join("")}`;
};

export const counterpartyText = (cp: StatementLine["counterparty"]): string => {
  if (!cp) return "";
  if ("display_name" in cp) return cp.display_name;
  if ("system" in cp) return `System: ${cp.system}`;
  return "";
};
