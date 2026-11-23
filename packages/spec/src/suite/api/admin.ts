import { Schema as S } from "effect";
import { Department } from "../conditions";
import { RoleMember } from "../nodes";
import { SessionView } from "./me";
import {
  Handle,
  NodeLink,
  PageQuery,
  PersonRef,
  Region,
  Subject,
  Timestamp,
  UserText,
  HeldResult,
} from "../primitives";

/** Admin (CONTRACT.md module M13): members, sessions, roles, effective permissions. Grants use the kernel node API. */

export const AdminMemberRow = S.Struct({
  person: PersonRef,
  email: S.String,
  title: S.String,
  department: S.String,
  region: Region,
  roles: S.Array(S.Struct({ role: S.String, scope: S.NullOr(S.Struct({ region: Region })) })),
  status: S.Literal("active", "disabled"),
  last_active_at: S.NullOr(Timestamp),
  sessions_active: S.Int,
  joined_at: Timestamp,
}).annotations({ identifier: "AdminMemberRow" });

export const AdminMembersIn = S.Struct({
  q: S.optional(S.String.pipe(S.maxLength(80))),
  status: S.optional(S.Literal("active", "disabled")),
  role: S.optional(S.String),
  ...PageQuery,
});
export const AdminMembersOut = S.Struct({
  items: S.Array(AdminMemberRow),
  next_cursor: S.NullOr(S.String),
  total: S.Int,
});

export const MemberCreateIn = S.Struct({
  handle: Handle,
  display_name: UserText(80).pipe(S.minLength(1)),
  email: S.String.pipe(S.pattern(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/)),
  title: UserText(80),
  department: Department,
  region: Region,
  location: UserText(80),
}).annotations({ identifier: "MemberCreateIn" });
export const MemberCreateOut = S.Struct({
  person: PersonRef,
  account: S.String,
  preference_uri: S.String,
  /** Role membership is a Role node change held for approval; this is the held request adding the member to `member`. */
  role_change: HeldResult,
});

export const MemberStatusIn = S.Struct({
  handle: Handle,
  status: S.Literal("active", "disabled"),
  reason: UserText(280).pipe(S.minLength(1)),
});
export const MemberStatusOut = S.Struct({
  handle: Handle,
  status: S.Literal("active", "disabled"),
  sessions_revoked: S.Int,
});

export const AdminSessionsIn = S.Struct({
  member: S.optional(Handle),
  active_only: S.optional(S.Boolean),
  ...PageQuery,
});
export const AdminSessionsOut = S.Struct({
  items: S.Array(S.Struct({ ...SessionView.fields, person: PersonRef })),
  next_cursor: S.NullOr(S.String),
});
export const AdminSessionRevokeIn = S.Struct({ session_id: S.String });

export const EffectivePermission = S.Struct({
  permission: S.String,
  resource: S.String,
  row_predicate: S.NullOr(S.String),
  owner_only: S.Boolean,
  via: S.Union(
    S.Struct({ role: S.String, scope: S.NullOr(S.Struct({ region: Region })) }),
    S.Struct({ direct: S.Literal(true) }),
  ),
  grant: NodeLink,
}).annotations({ identifier: "EffectivePermission" });

export const RoleView = S.Struct({
  node: NodeLink,
  description: S.String,
  system: S.Boolean,
  members: S.Array(S.Struct({ person: PersonRef, scope: S.NullOr(S.Struct({ region: Region })) })),
  grants: S.Array(
    S.Struct({ grant: NodeLink, actions: S.Array(S.String), resource: S.String, owner_only: S.Boolean }),
  ),
  pending: S.Array(S.Struct({ approval_id: S.String, requested_by: PersonRef, summary: S.String })),
}).annotations({ identifier: "RoleView" });
export const RolesOut = S.Struct({ items: S.Array(RoleView) });

export const RoleMembersIn = S.Struct({
  slug: S.String,
  add: S.optional(S.Array(RoleMember).pipe(S.maxItems(50))),
  remove: S.optional(S.Array(Subject).pipe(S.maxItems(50))),
  base_revision: S.Int,
  reason: UserText(280).pipe(S.minLength(1)),
}).annotations({ identifier: "RoleMembersIn" });

export const PermissionsIn = S.Struct({ principal: S.optional(Subject) });
export const PermissionsOut = S.Struct({
  principal: PersonRef,
  ceiling: S.NullOr(S.Array(S.String)),
  delegator: S.NullOr(PersonRef),
  roles: S.Array(S.String),
  permissions: S.Array(EffectivePermission),
}).annotations({ identifier: "PermissionsOut" });

/** The role x permission matrix rendered on /admin/roles (computed from the role grants). */
export const MatrixOut = S.Struct({
  roles: S.Array(S.String),
  permissions: S.Array(S.String),
  /** cells[permission][role] = resource prefixes granted, empty when not granted. */
  cells: S.Record({ key: S.String, value: S.Record({ key: S.String, value: S.Array(S.String) }) }),
  agent_ceiling: S.Array(S.String),
}).annotations({ identifier: "MatrixOut" });
