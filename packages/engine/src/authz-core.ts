/**
 * The pure core of the single authorization function (spec 03 sections 3 to 5). `authorize` is a deterministic
 * function of the request and a snapshot of the grant index: no I/O. The `Authorizer` service loads the snapshot.
 */
import { canonicalize, nodeId, sha256Hex } from "@plinth/core";
import { NODE_KINDS, SUITE_PERMISSIONS, type GrantSpec, type Kind } from "@plinth/spec";

export type DenyReason =
  | "principal_disabled"
  | "delegation_revoked"
  | "ceiling_denies"
  | "token_scope_denies"
  | "no_grant"
  | "explicit_deny"
  | "no_commit_rule"
  | "approval_required"
  | "sod_violation"
  | "grant_inspect_required"
  | "unknown_resource"
  | "not_permitted"
  | "replay_in_control"
  | "not_in_session";

export interface GrantRec {
  /** Node id of the Grant node. */
  readonly id: string;
  /** Sequence of the change that last wrote the grant; the newer of two grants on one resource supersedes. */
  readonly seq: number;
  readonly principal: string;
  readonly effect: "allow" | "deny";
  readonly actions: ReadonlyArray<string>;
  /** Canonical resource: a node URI with a UUID, or a URI prefix ending in `/`. */
  readonly resource: string;
  readonly rowPredicate: string | null;
  readonly columnMask: ReadonlyArray<string>;
  readonly expiresAt: string | null;
  readonly status: string;
  /** Matches only a node whose `spec.owner` is the effective principal (CONTRACT.md 3.4). */
  readonly ownerOnly?: boolean;
}

/** One Role membership of a subject, with the optional region scope that narrows every inherited grant. */
export interface RoleMembership {
  readonly role: string;
  readonly region: string | null;
}

export interface AuthzSnapshot {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly grants: ReadonlyArray<GrantRec>;
  readonly grantIndexVersion: number;
  readonly maskVersion: number;
  /** Subject -> the Roles it holds (from non-deleted Role nodes). Absent in kernel-only snapshots. */
  readonly roleMembers?: ReadonlyMap<string, ReadonlyArray<RoleMembership>>;
  /** Virtual or wall time at which expiry is evaluated. */
  readonly now: Date;
}

export interface AuthzSubject {
  readonly subject: string;
  readonly kind: "human" | "service" | "agent";
  readonly delegatorSubject: string | null;
  /** The agent ceiling (`principals.max_scope.permissions`). Null for non-agents. */
  readonly ceiling: ReadonlyArray<string> | null;
  /** Permissions the presented token was issued with; null means the token does not narrow. */
  readonly tokenScope: ReadonlyArray<string> | null;
}

export interface AuthzRequest {
  readonly principal: AuthzSubject;
  readonly action: string;
  /** Canonical node URI (UUID form). */
  readonly resource: string;
  /** For `query:run`: the Dashboard the query runs for, whose read grants (and predicates) apply. */
  readonly context?:
    { readonly dashboard?: string | undefined; readonly owner?: string | undefined } | undefined;
}

export interface Allow {
  readonly kind: "allow";
  /** Combined row predicate (allows OR'd, denies subtracted), or null for all rows. */
  readonly rowPredicate: string | null;
  readonly columnMask: ReadonlyArray<string>;
  readonly grantIds: ReadonlyArray<string>;
  readonly policyHash: string;
  readonly effectivePrincipal: string;
}
export interface Deny {
  readonly kind: "deny";
  readonly reason: DenyReason;
  readonly policy: string;
  readonly permission?: string;
}
export type Decision = Allow | Deny;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Normalise a grant resource: slug URIs and bare source names become UUID URIs; prefixes are kept. */
export const canonicalResource = (
  snap: Pick<AuthzSnapshot, "workspaceId" | "workspaceSlug">,
  r: string,
): string => {
  const base = `plinth://${snap.workspaceSlug}/`;
  if (!r.startsWith("plinth://")) {
    const km = /^([A-Za-z]+):([a-z][a-z0-9.-]*)$/.exec(r);
    const kind = km ? NODE_KINDS.find((k) => k.toLowerCase() === (km[1] ?? "").toLowerCase()) : undefined;
    if (km && kind) return `${base}${kind}/${nodeId(snap.workspaceId, kind, km[2] ?? "")}`;
    if (r.includes("/") || r.includes(":")) return r;
    return `${base}Source/${nodeId(snap.workspaceId, "Source", r)}`;
  }
  if (r.endsWith("/")) return r;
  const parts = r.slice("plinth://".length).split("/");
  const [ws, kind, last] = [parts[0], parts[1], parts[2]];
  if (ws === undefined || kind === undefined || last === undefined || parts.length !== 3) return r;
  if (UUID.test(last) || !(NODE_KINDS as ReadonlyArray<string>).includes(kind)) return r;
  return `plinth://${ws}/${kind}/${nodeId(snap.workspaceId, kind as Kind, last)}`;
};

export const resourceMatches = (pattern: string, resource: string): boolean =>
  pattern === resource || (pattern.endsWith("/") && resource.startsWith(pattern));

/** Build a snapshot record from a stored Grant node body. Undefined when the body is not a usable grant. */
export const grantFromBody = (
  snap: Pick<AuthzSnapshot, "workspaceId" | "workspaceSlug">,
  id: string,
  seq: number,
  spec: GrantSpec,
): GrantRec => ({
  id,
  seq,
  principal: spec.principal,
  effect: spec.effect ?? "allow",
  actions: spec.actions,
  resource: canonicalResource(snap, spec.resource),
  rowPredicate: spec.row_predicate ? spec.row_predicate.trim() : null,
  columnMask: spec.column_mask ?? [],
  expiresAt: spec.expires_at ?? null,
  status: spec.status ?? "active",
  ...(spec.owner_only === true ? { ownerOnly: true } : {}),
});

/** Does a ceiling (or token scope) list permit the action? Entries look like `query:run` or `node:write:Panel`. */
export const scopeAllows = (scope: ReadonlyArray<string>, action: string, kind?: string): boolean =>
  scope.includes(action) || (kind !== undefined && scope.includes(`${action}:${kind}`));

const normPred = (p: string): string => p.replace(/\s+/g, " ").trim();

export const policyHashOf = (
  snap: AuthzSnapshot,
  rowPredicate: string | null,
  columnMask: ReadonlyArray<string>,
): string =>
  "sha256:" +
  sha256Hex(
    canonicalize({
      workspace_predicate: snap.workspaceId,
      row_predicate: rowPredicate === null ? null : normPred(rowPredicate),
      column_mask_set: [...new Set(columnMask)].sort(),
      mask_version: snap.maskVersion,
      grant_index_version: snap.grantIndexVersion,
    }),
  );

const live = (g: GrantRec, now: Date): boolean =>
  g.status === "active" && (g.expiresAt === null || new Date(g.expiresAt).getTime() > now.getTime());

/** AND a region scope into a row predicate (CONTRACT.md 3.3). */
export const scopedPredicate = (pred: string | null, region: string): string =>
  pred === null || pred.trim() === ""
    ? `region = '${region}'`
    : `(${pred.replace(/s+/g, " ").trim()}) and region = '${region}'`;

/**
 * The candidate grants of a subject: grants naming the subject, plus grants naming `role:<r>` for each Role it holds,
 * with a member's region scope ANDed into the predicate. `owner_only` grants match only when `owner` is the subject.
 * A role grant's `principal` is rewritten to `<role>@<subject>[<region>]` so the "newest per principal" supersession
 * never collapses two roles' grants into one.
 */
export const grantsOf = (
  snap: AuthzSnapshot,
  subject: string,
  owner?: string | undefined,
): ReadonlyArray<GrantRec> => {
  const roles = snap.roleMembers?.get(subject) ?? [];
  const out: GrantRec[] = [];
  for (const g of snap.grants) {
    if (g.ownerOnly === true && owner !== subject) continue;
    if (g.principal === subject) {
      out.push(g);
      continue;
    }
    if (!g.principal.startsWith("role:")) continue;
    const slug = g.principal.slice("role:".length);
    for (const m of roles) {
      if (m.role !== slug) continue;
      out.push(
        m.region === null
          ? { ...g, principal: `${g.principal}@${subject}` }
          : {
              ...g,
              principal: `${g.principal}@${subject}[${m.region}]`,
              rowPredicate: scopedPredicate(g.rowPredicate, m.region),
            },
      );
    }
  }
  return out;
};

/** The kind named by a canonical node URI, if any. */
export const kindOfResource = (r: string): Kind | undefined => {
  const k = r.split("/")[3];
  return (NODE_KINDS as ReadonlyArray<string>).includes(k ?? "") ? (k as Kind) : undefined;
};

export const authorize = (req: AuthzRequest, snap: AuthzSnapshot): Decision => {
  const p = req.principal;
  let effective = p.subject;
  const kind = kindOfResource(req.resource);
  if (p.kind === "agent") {
    if (!p.delegatorSubject) return { kind: "deny", reason: "delegation_revoked", policy: "principal" };
    if (!p.ceiling || !scopeAllows(p.ceiling, req.action, kind))
      return {
        kind: "deny",
        reason: "ceiling_denies",
        policy: `ceiling:${p.subject}`,
        permission: req.action,
      };
    if (p.tokenScope && !scopeAllows(p.tokenScope, req.action, kind))
      return {
        kind: "deny",
        reason: "token_scope_denies",
        policy: `token:${p.subject}`,
        permission: req.action,
      };
    effective = p.delegatorSubject;
  }
  const mine = grantsOf(snap, effective, req.context?.owner).filter((g) => live(g, snap.now));
  const dash = req.action === "query:run" ? req.context?.dashboard : undefined;
  type Cand = { readonly g: GrantRec; readonly via: "direct" | "dashboard" };
  const cands: Cand[] = [];
  for (const g of mine) {
    if (g.actions.includes(req.action) && resourceMatches(g.resource, req.resource))
      cands.push({ g, via: "direct" });
    else if (dash && g.actions.includes("node:read") && resourceMatches(g.resource, dash))
      cands.push({ g, via: "dashboard" });
  }
  const denies = cands.filter((c) => c.g.effect === "deny");
  const wholeDeny = denies.find((c) => c.g.rowPredicate === null);
  if (wholeDeny) return { kind: "deny", reason: "explicit_deny", policy: wholeDeny.g.id };
  // The newest allow per (principal, resource, route) supersedes older ones.
  const newest = new Map<string, Cand>();
  for (const c of cands.filter((x) => x.g.effect === "allow")) {
    const key = `${c.g.principal}|${c.g.resource}|${c.via}`;
    const cur = newest.get(key);
    if (!cur || c.g.seq > cur.g.seq) newest.set(key, c);
  }
  const allows = [...newest.values()].sort((a, b) => a.g.seq - b.g.seq);
  if (allows.length === 0)
    return { kind: "deny", reason: "no_grant", policy: "grants", permission: req.action };
  const preds = allows.map((a) => a.g.rowPredicate);
  const allowPred = preds.some((x) => x === null)
    ? null
    : preds.map((x) => `(${normPred(x ?? "")})`).join(" or ");
  const denyParts = denies.map((d) => `not (${normPred(d.g.rowPredicate ?? "")})`);
  const rowPredicate =
    denyParts.length === 0
      ? allowPred
      : [...(allowPred === null ? [] : [`(${allowPred})`]), ...denyParts].join(" and ");
  const columnMask = [...new Set([...allows, ...denies].flatMap((c) => c.g.columnMask))].sort();
  return {
    kind: "allow",
    rowPredicate,
    columnMask,
    grantIds: [...allows, ...denies].map((c) => c.g.id),
    policyHash: policyHashOf(snap, rowPredicate, columnMask),
    effectivePrincipal: effective,
  };
};

export interface HeldChangeFacts {
  readonly requesterSubject: string;
  readonly requesterKind: "human" | "service" | "agent";
  readonly onBehalfOfSubject: string | null;
  /** Canonical resource the held Grant names (the approver needs permissions here). */
  readonly resource: string;
  /** The permission the approver needs besides `approval:decide` (APPROVER_PERMISSION, K4). Default `grant:write`. */
  readonly approverPermission?: string | undefined;
}

/** Separation of duties for approvals (spec 03 section 7.2). Checks 1-3 run before permissions. */
export const checkApprover = (
  approver: AuthzSubject,
  held: HeldChangeFacts,
  snap: AuthzSnapshot,
): Deny | undefined => {
  const sod = (policy: string): Deny => ({ kind: "deny", reason: "sod_violation", policy });
  if (approver.kind !== "human") return sod("sod:approver_not_human");
  if (approver.subject === held.requesterSubject) return sod("sod:requester");
  if (approver.subject === held.onBehalfOfSubject) return sod("sod:on_behalf_of");
  const perm = held.approverPermission ?? "grant:write";
  // A Suite permission is granted on the module prefix, not on the held node, so it is checked on suite/approvals.
  const suiteRes = `plinth://${snap.workspaceSlug}/suite/approvals`;
  const isSuite = (SUITE_PERMISSIONS as ReadonlyArray<string>).includes(perm);
  const decide = authorize({ principal: approver, action: "approval:decide", resource: held.resource }, snap);
  if (decide.kind === "deny") {
    // Suite changes: approval:decide on suite/ covers any Suite-ruled node (the approver permission is the real gate).
    const viaSuite = isSuite
      ? authorize({ principal: approver, action: "approval:decide", resource: suiteRes }, snap)
      : decide;
    if (viaSuite.kind === "deny")
      return { kind: "deny", reason: decide.reason, policy: decide.policy, permission: "approval:decide" };
  }
  const second = authorize(
    { principal: approver, action: perm, resource: isSuite ? suiteRes : held.resource },
    snap,
  );
  if (second.kind === "deny")
    return { kind: "deny", reason: second.reason, policy: second.policy, permission: perm };
  return undefined;
};
