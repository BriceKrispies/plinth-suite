/**
 * Suite permissions, roles and commit rules (CONTRACT.md section 3). This file imports nothing but types so the
 * kernel `grant.ts` can extend its closed permission pattern from `SUITE_PERMISSIONS` without an import cycle.
 *
 * Every Suite permission is checked against the module resource `plinth://<ws>/suite/<module>`; role grants name the
 * prefix `plinth://<ws>/suite/`. A grant's `row_predicate` on a Suite permission is evaluated against the facts of
 * the member the action targets (`region`, `tier`, `handle`), so `region = 'EMEA'` scopes a regional manager.
 */
export const SUITE_PERMISSIONS = [
  "suite:use",
  "messages:use",
  "messages:broadcast",
  "notifications:use",
  "notifications:send",
  "points:use",
  "points:transfer",
  "points:award",
  "points:adjust",
  "points:view-all",
  "points:ledger",
  "store:shop",
  "store:orders",
  "store:approve",
  "store:refund",
  "store:inventory",
  "store:moderate",
  "badges:award",
  "badges:revoke",
  "promotions:simulate",
  "promotions:manage",
  "promotions:approve",
  "automation:manage",
  "content:author",
  "content:review",
  "content:publish",
  "people:view-private",
  "segments:preview",
  "tasks:use",
  "tasks:manage",
  "audit:view",
  "admin:members",
  "admin:roles",
  "admin:settings",
] as const;
export type SuitePermission = (typeof SUITE_PERMISSIONS)[number];

/** The module segment of the resource a Suite permission is checked on: `plinth://<ws>/suite/<module>`. */
export const SUITE_MODULES = [
  "me",
  "messages",
  "notifications",
  "points",
  "ledger",
  "store",
  "badges",
  "promotions",
  "automation",
  "content",
  "people",
  "segments",
  "tasks",
  "approvals",
  "audit",
  "admin",
  "search",
  "calendar",
  "home",
  "catalog",
  "pages",
] as const;
export type SuiteModule = (typeof SUITE_MODULES)[number];

/** Role node slugs seeded by the Suite. `agent` is not a Role node: it is the agent ceiling (see AGENT_SUITE_CEILING). */
export const SUITE_ROLES = [
  "member",
  "manager",
  "content-editor",
  "marketing-manager",
  "finance",
  "admin",
] as const;
export type SuiteRole = (typeof SUITE_ROLES)[number];

export interface RoleGrantTemplate {
  /** Grant node slug suffix: the Grant slug is `role-<role>-<suffix>`. */
  readonly suffix: string;
  readonly actions: ReadonlyArray<string>;
  /** `suite/` for module permissions, or a kernel resource prefix such as `Promotion/` (relative to `plinth://<ws>/`). */
  readonly resource: string;
  readonly owner_only?: boolean;
}

const KIND_READ = (kinds: ReadonlyArray<string>): ReadonlyArray<RoleGrantTemplate> =>
  kinds.map((k) => ({ suffix: `read-${k.toLowerCase()}`, actions: ["node:read"], resource: `${k}/` }));
const KIND_WRITE = (kinds: ReadonlyArray<string>): ReadonlyArray<RoleGrantTemplate> =>
  kinds.map((k) => ({
    suffix: `write-${k.toLowerCase()}`,
    actions: ["node:read", "node:write", "node:delete"],
    resource: `${k}/`,
  }));

/**
 * The seeded role grants. Each entry becomes one Grant node with `principal: "role:<role>"`. The Authorizer expands
 * role membership (Role node `spec.members`), and ANDs a member's `scope.region` into every predicate it inherits.
 */
export const ROLE_GRANTS: Readonly<Record<SuiteRole, ReadonlyArray<RoleGrantTemplate>>> = {
  member: [
    {
      suffix: "suite",
      resource: "suite/",
      actions: [
        "suite:use",
        "messages:use",
        "notifications:use",
        "points:use",
        "points:transfer",
        "store:shop",
        "tasks:use",
      ],
    },
    ...KIND_READ(["Product", "Category", "Badge", "Group", "Program"]),
    {
      suffix: "own-preference",
      actions: ["node:read", "node:write"],
      resource: "Preference/",
      owner_only: true,
    },
    ...KIND_READ(["Page", "Widget"]),
    {
      suffix: "own-page",
      actions: ["node:read", "node:write", "node:delete"],
      resource: "Page/",
      owner_only: true,
    },
    {
      suffix: "own-widget",
      actions: ["node:read", "node:write", "node:delete"],
      resource: "Widget/",
      owner_only: true,
    },
  ],
  manager: [
    {
      suffix: "suite",
      resource: "suite/",
      actions: [
        "points:award",
        "points:view-all",
        "store:orders",
        "store:approve",
        "badges:award",
        "notifications:send",
        "messages:broadcast",
        "tasks:manage",
        "segments:preview",
        "audit:view",
      ],
    },
    { suffix: "reports", actions: ["node:read", "query:run"], resource: "Source/" },
    { suffix: "boards", actions: ["node:read"], resource: "Dashboard/" },
    { suffix: "approve-suite", actions: ["approval:decide"], resource: "suite/" },
    ...KIND_READ(["Segment", "Promotion", "Content"]),
  ],
  "content-editor": [
    {
      suffix: "suite",
      resource: "suite/",
      actions: ["content:author", "content:publish", "segments:preview"],
    },
    ...KIND_WRITE(["Content"]),
    ...KIND_READ(["Segment", "Panel"]),
  ],
  "marketing-manager": [
    {
      suffix: "suite",
      resource: "suite/",
      actions: [
        "promotions:simulate",
        "promotions:manage",
        "automation:manage",
        "content:review",
        "content:publish",
        "segments:preview",
        "notifications:send",
        "messages:broadcast",
        "audit:view",
      ],
    },
    ...KIND_WRITE(["Promotion", "Segment", "Automation", "Group", "Content", "Page", "Widget"]),
    { suffix: "reports", actions: ["node:read", "query:run"], resource: "Source/" },
    { suffix: "boards", actions: ["node:read"], resource: "Dashboard/" },
  ],
  finance: [
    {
      suffix: "suite",
      resource: "suite/",
      actions: [
        "points:view-all",
        "points:adjust",
        "points:ledger",
        "store:refund",
        "store:approve",
        "promotions:simulate",
        "promotions:approve",
        "audit:view",
      ],
    },
    { suffix: "approve-suite", actions: ["approval:decide"], resource: "suite/" },
    { suffix: "approve-promotions", actions: ["approval:decide"], resource: "Promotion/" },
    { suffix: "approve-program", actions: ["approval:decide"], resource: "Program/" },
    { suffix: "reports", actions: ["node:read", "query:run"], resource: "Source/" },
    { suffix: "boards", actions: ["node:read"], resource: "Dashboard/" },
    ...KIND_READ(["Promotion", "Segment", "Automation"]),
  ],
  admin: [
    {
      suffix: "suite",
      resource: "suite/",
      actions: [
        "admin:members",
        "admin:roles",
        "admin:settings",
        "people:view-private",
        "audit:view",
        "store:inventory",
        "store:moderate",
        "store:orders",
        "badges:award",
        "badges:revoke",
        "tasks:manage",
        "segments:preview",
      ],
    },
    { suffix: "approve-suite", actions: ["approval:decide"], resource: "suite/" },
    { suffix: "approve-roles", actions: ["approval:decide"], resource: "Role/" },
    { suffix: "approve-program", actions: ["approval:decide"], resource: "Program/" },
    ...KIND_WRITE(["Product", "Category", "Badge", "Role", "Program", "Group", "Page", "Widget"]),
  ],
};

/** Seeded role membership (CONTRACT.md section 11.2). Every human member is also in `member`. */
export const NAMED_ROLE_MEMBERS: ReadonlyArray<{
  readonly subject: string;
  readonly roles: ReadonlyArray<SuiteRole>;
  readonly scope?: { readonly region: string };
}> = [
  { subject: "user:ops-lead", roles: ["admin", "manager"] },
  { subject: "user:emea-lead", roles: ["manager"], scope: { region: "EMEA" } },
  { subject: "user:finance-analyst", roles: ["finance"] },
  { subject: "user:marketing-lead", roles: ["marketing-manager"] },
  { subject: "user:content-editor", roles: ["content-editor"] },
  { subject: "user:it-admin", roles: ["admin"] },
];

/**
 * Entries appended to the agent ceiling (`principals.max_scope.permissions` of `agent:claude-code`). The agent's
 * effective rights are this ceiling intersected with its delegator's grants (Maya Ortiz). Approval-held actions are
 * marked per action in the registry (`agent: "approval"`).
 */
export const AGENT_SUITE_CEILING = [
  "node:write:Promotion",
  "node:write:Automation",
  "node:write:Content",
  "node:write:Segment",
  "node:write:Product",
  "node:write:Category",
  "node:write:Badge",
  "node:write:Group",
  "node:write:Page",
  "node:write:Widget",
  "suite:use",
  "admin:settings",
  "messages:use",
  "notifications:use",
  "notifications:send",
  "points:use",
  "points:transfer",
  "points:award",
  "points:view-all",
  "store:shop",
  "store:orders",
  "badges:award",
  "promotions:simulate",
  "promotions:manage",
  "automation:manage",
  "content:author",
  "segments:preview",
  "tasks:use",
  "tasks:manage",
  "audit:view",
] as const;

/**
 * Commit rules the Suite adds to the closed table (kernel `rules.ts`). `applies` says who is classified by the row:
 * `agent` rows follow the existing agent-only discipline, `all` rows hold changes from every non-system principal
 * (as R-GRANT does). `approver` is the permission an approver needs in addition to `approval:decide` on the node.
 */
export const SUITE_COMMIT_RULES: ReadonlyArray<{
  readonly id: string;
  readonly class: "auto" | "approval" | "refused";
  readonly applies: "agent" | "all" | "system";
  readonly approver?: string;
  readonly when: string;
}> = [
  {
    id: "R-PRODUCT-CREATE",
    class: "auto",
    applies: "agent",
    when: "create a Product with status draft, or any Category",
  },
  {
    id: "R-PRODUCT-EDIT",
    class: "auto",
    applies: "agent",
    when: "edit a Product without touching /spec/price_points, /spec/cash_price_cents or /spec/status",
  },
  {
    id: "R-PRODUCT-PRICE",
    class: "approval",
    applies: "agent",
    approver: "store:inventory",
    when: "edit price or status of a Product",
  },
  { id: "R-BADGE-CREATE", class: "auto", applies: "agent", when: "create a Badge with status draft" },
  {
    id: "R-BADGE-EDIT",
    class: "approval",
    applies: "agent",
    approver: "badges:award",
    when: "any edit of an existing Badge",
  },
  { id: "R-PROMO-CREATE", class: "auto", applies: "agent", when: "create a Promotion with status draft" },
  {
    id: "R-PROMO-EDIT",
    class: "auto",
    applies: "all",
    when: "edit a Promotion whose status is draft (status itself excluded)",
  },
  {
    id: "R-PROMO-ACTIVATE",
    class: "approval",
    applies: "all",
    approver: "promotions:approve",
    when: "promotions.transition to scheduled or active from draft, or an edit of eligibility/effects/budget/schedule while scheduled, active or paused",
  },
  {
    id: "R-PROMO-CONTROL",
    class: "auto",
    applies: "all",
    when: "promotions.transition to paused, ended, or active from paused (resume)",
  },
  {
    id: "R-PROMO-SCHEDULE",
    class: "auto",
    applies: "system",
    when: "the scheduler moves scheduled->active at starts_at or active/paused->ended at ends_at",
  },
  {
    id: "R-AUTOMATION-CREATE",
    class: "auto",
    applies: "agent",
    when: "create an Automation with enabled=false",
  },
  {
    id: "R-AUTOMATION-EDIT",
    class: "auto",
    applies: "agent",
    when: "edit an Automation that is disabled (enabled excluded)",
  },
  {
    id: "R-AUTOMATION-ENABLE",
    class: "approval",
    applies: "agent",
    approver: "automation:manage",
    when: "set enabled=true, or edit an enabled Automation",
  },
  {
    id: "R-AUTOMATION-EXTERNAL",
    class: "approval",
    applies: "all",
    approver: "admin:settings",
    when: "enable an Automation that has a webhook step (maps the kernel R-ACTION-EXTERNAL)",
  },
  {
    id: "R-CONTENT-CREATE",
    class: "auto",
    applies: "agent",
    when: "create a Content node with status draft",
  },
  {
    id: "R-CONTENT-EDIT",
    class: "auto",
    applies: "agent",
    when: "edit a Content node in status draft (status and published_revision excluded)",
  },
  {
    id: "R-CONTENT-STATUS",
    class: "auto",
    applies: "all",
    when: "content.transition commits a status change (only the action handler may change /spec/status or /spec/published_revision)",
  },
  { id: "R-SEGMENT", class: "auto", applies: "agent", when: "create or edit a Segment" },
  { id: "R-GROUP", class: "auto", applies: "agent", when: "create or edit a Group" },
  {
    id: "R-ROLE",
    class: "approval",
    applies: "all",
    approver: "admin:roles",
    when: "any change to a Role node (membership changes access)",
  },
  {
    id: "R-WIDGET",
    class: "auto",
    applies: "agent",
    when: "create or edit a Widget instance (its config is checked by the widget's config schema)",
  },
  {
    id: "R-PAGE",
    class: "auto",
    applies: "agent",
    when: "create a Page, or edit a non-system Page (layout, nav, description)",
  },
  {
    id: "R-PAGE-SYSTEM",
    class: "approval",
    applies: "agent",
    approver: "admin:settings",
    when: "edit or delete a system Page (the seeded module pages, home and profile)",
  },
  {
    id: "R-SITE",
    class: "auto",
    applies: "all",
    when: "a site.* action (clear, restore, page.put, widget.add, widget.remove, appearance.set) changes a Page, Widget or the Program appearance: the action's admin:settings check stands in for the node rules",
  },
  { id: "R-PREFERENCE", class: "auto", applies: "all", when: "the owner writes their own Preference node" },
  {
    id: "R-PROGRAM",
    class: "approval",
    applies: "all",
    approver: "admin:settings",
    when: "any change to the Program node",
  },
];

/** The actions that may write Page, Widget and Program nodes without the per-node rules (rule R-SITE). */
export const SITE_MANAGED_ACTIONS = [
  "site.clear",
  "site.restore",
  "site.page.put",
  "site.widget.add",
  "site.widget.remove",
  "site.appearance.set",
] as const;
export const SITE_MANAGED_KINDS = ["Page", "Widget", "Program"] as const;

/** The approver permission for kernel rules, generalising `checkApprover` (spec 03 section 7.2). */
export const APPROVER_PERMISSION: Readonly<Record<string, string>> = {
  "R-GRANT": "grant:write",
  "R-RULE-THRESHOLD": "node:write",
  "R-FORM-REBIND": "node:write",
  "R-DELETE-OTHER": "node:delete",
  "R-UNDO-FOREIGN": "node:write",
  "R-ACTION-EXTERNAL": "admin:settings",
  ...Object.fromEntries(
    SUITE_COMMIT_RULES.filter((r) => r.approver !== undefined).map((r) => [r.id, r.approver as string]),
  ),
};
