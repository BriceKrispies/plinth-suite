import { createHash } from "node:crypto";
import { Effect } from "effect";
import { principalId } from "@plinth/core";
import { NAMED_ROLE_MEMBERS, ROLE_GRANTS, SUITE_EXAMPLES, SUITE_ROLES, type SuiteRole } from "@plinth/spec";
import {
  ControlStore,
  ensureMemberAccount,
  ensureSystemAccounts,
  inTx,
  postAward,
  store,
} from "@plinth/engine";
import type { SeedCtx, SeedStep } from "../seed";
import { SEED_MEMBERS, type Region, type SeedMember } from "../people";

const DAY = 86_400_000;
/** A deterministic `ses_` id: 22 hex characters of sha256(handle|n). */
const sessionId = (handle: string, n: number): string =>
  `ses_${createHash("sha256").update(`${handle}|${n}`).digest("hex").slice(0, 22)}`;
const SESSION_LABELS: ReadonlyArray<string> = [
  "Chrome on Windows",
  "Safari on iOS",
  "Edge on Windows",
  "Chrome on macOS",
  "Firefox on Linux",
  "Safari on macOS",
  "Chrome on Android",
];
const CITIES: Record<Region, ReadonlyArray<string>> = {
  NA: ["Columbus, US", "Dallas, US", "Toronto, CA"],
  EMEA: ["Rotterdam, NL", "Leeds, UK", "Gdansk, PL"],
  APAC: ["Singapore, SG", "Osaka, JP", "Pune, IN"],
  LATAM: ["Bogota, CO", "Sao Paulo, BR", "Mexico City, MX"],
  ANZ: ["Auckland, NZ", "Brisbane, AU", "Perth, AU"],
};

const BIO_OPENERS: Record<SeedMember["department"], ReadonlyArray<string>> = {
  operations: [
    "Keeps the dock schedule honest and the trucks moving.",
    "Plans shifts, chases exceptions and loves a clean handover.",
    "Runs the morning stand-up and the evening wrap-up.",
  ],
  fulfilment: [
    "Picks, packs and ships. Proud of a zero-miss week.",
    "On the floor most days, known for the tidiest pallets on site.",
    "Quick on the scanner and quicker with a smile.",
  ],
  finance: [
    "Reconciles the ledger so the numbers always add up.",
    "Spreadsheets by day, trail running by weekend.",
    "Turns month-end into a calm affair.",
  ],
  marketing: [
    "Tells the Northwind story, one campaign at a time.",
    "Part writer, part analyst, full-time coffee drinker.",
    "Builds the offers everybody ends up talking about.",
  ],
  technology: [
    "Keeps the systems up and the dashboards green.",
    "Writes the glue code between the warehouse and the cloud.",
    "Happiest when an alert turns out to be nothing.",
  ],
  people: [
    "Looks after onboarding, wellbeing and the occasional cake.",
    "Believes good teams are built on small kindnesses.",
    "Runs the people calendar and the quiet-room rota.",
  ],
};
const BIO_CLOSERS: ReadonlyArray<string> = [
  "Ask me about the peak season playbook.",
  "Always up for a walk-and-talk.",
  "Fan of the Friday round-up.",
  "Collects the odd badge along the way.",
  "Currently saving points for something outdoorsy.",
  "Wellness club regular.",
];

/** A short plain-text bio, deterministic per member (members.bio is at most 500 characters). */
const bioFor = (m: SeedMember, rng: ReturnType<SeedCtx["rng"]>): string =>
  `${m.title}. ${rng.pick(BIO_OPENERS[m.department])} ${rng.pick(BIO_CLOSERS)}`;

/** The services that act in the Suite: engines and the scheduler act as these (CONTRACT.md 5, 9). */
const SERVICES = [
  ["service:automation", "Automation"],
  ["service:badges", "Badges"],
  ["service:store", "Store"],
  ["service:scheduler", "Scheduler"],
] as const;

export const servicePrincipals: SeedStep = {
  name: "service-principals",
  spec: "5, 9, 12.4",
  run: (ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      for (const [subject, name] of SERVICES)
        yield* store(
          sql`INSERT INTO principals (principal_id, workspace_id, kind, subject, display_name)
              VALUES (${principalId(ctx.workspaceId, subject)}, ${ctx.workspaceId}, 'service', ${subject}, ${name})
              ON CONFLICT DO NOTHING`,
        );
    }),
};

/** Members, their principals, ledger accounts and sessions (CONTRACT.md 11.2). */
export const members: SeedStep = {
  name: "members",
  spec: "11.2, 7.1",
  run: (ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const rng = ctx.rng("members");
      const bioRng = ctx.rng("members-bio");
      const sessRng = ctx.rng("members-sessions");
      yield* inTx(ensureSystemAccounts(ctx.workspaceId, new Date(ctx.demoNow.getTime() - 3 * 365 * DAY)));
      for (const m of SEED_MEMBERS) {
        const id = principalId(ctx.workspaceId, m.subject);
        // spread over the 3 years before the demo date
        const joined = new Date(ctx.demoNow.getTime() - (30 + ((m.index * 97) % 1000)) * DAY);
        yield* store(
          sql`INSERT INTO principals (principal_id, workspace_id, kind, subject, display_name)
              VALUES (${id}, ${ctx.workspaceId}, 'human', ${m.subject}, ${m.displayName}) ON CONFLICT DO NOTHING`,
        );
        yield* store(
          sql`INSERT INTO members (member_id, workspace_id, handle, email, title, department, region, location, bio, avatar_hue,
                                   showcase, joined_at, last_active_at)
              VALUES (${id}, ${ctx.workspaceId}, ${m.handle}, ${m.email}, ${m.title}, ${m.department}, ${m.region},
                      ${rng.pick(CITIES[m.region])}, ${bioFor(m, bioRng)}, ${(m.index * 47) % 360}, '{}', ${joined.toISOString()}::timestamptz,
                      ${new Date(ctx.demoNow.getTime() - rng.int(6) * 3_600_000).toISOString()}::timestamptz)
              ON CONFLICT DO NOTHING`,
        );
        yield* ensureMemberAccount(ctx.workspaceId, { id, handle: m.handle }, joined);
        // 1 to 3 seeded sessions with distinct, plausible labels; the named six get one current-looking
        // "Chrome on Windows". Drawn from a separate stream so the other member columns keep their values.
        const n = m.named ? 1 : 1 + sessRng.int(3);
        const first = m.named ? 0 : sessRng.int(SESSION_LABELS.length);
        for (let i = 0; i < n; i++)
          yield* store(
            sql`INSERT INTO member_sessions (session_id, workspace_id, principal_id, surface, label)
                VALUES (${sessionId(m.handle, i)}, ${ctx.workspaceId}, ${id}, 'ui',
                        ${SESSION_LABELS[(first + i) % SESSION_LABELS.length]})
                ON CONFLICT DO NOTHING`,
          );
      }
    }),
};

/** The singleton Program policy (node `program:rewards`). */
export const program: SeedStep = {
  name: "program",
  spec: "2.2 Program, 7.3",
  run: (ctx) =>
    ctx
      .commitNodes([ctx.create("Program", "rewards", SUITE_EXAMPLES.Program)], "seed: program")
      .pipe(Effect.asVoid),
};

const ROLE_TITLES: Record<SuiteRole, string> = {
  member: "Member",
  manager: "Manager",
  "content-editor": "Content editor",
  "marketing-manager": "Marketing manager",
  finance: "Finance",
  admin: "Administrator",
};

/** Role nodes (membership from NAMED_ROLE_MEMBERS plus every human in `member`) and the seeded role Grants (3.3). */
export const roles: SeedStep = {
  name: "roles",
  spec: "3.3, 3.6, 11.2",
  run: (ctx) =>
    Effect.gen(function* () {
      const membersOf = (role: SuiteRole): Array<{ subject: string; scope?: { region: Region } }> =>
        role === "member"
          ? SEED_MEMBERS.map((m) => ({ subject: m.subject }))
          : NAMED_ROLE_MEMBERS.filter((n) => n.roles.includes(role)).map((n) => ({
              subject: n.subject,
              ...(n.scope ? { scope: { region: n.scope.region as Region } } : {}),
            }));
      yield* ctx.commitNodes(
        SUITE_ROLES.map((r) =>
          ctx.create("Role", r, {
            apiVersion: "plinth/v1",
            kind: "Role",
            metadata: { slug: r, title: ROLE_TITLES[r] },
            spec: {
              description: `${ROLE_TITLES[r]} role of Northwind Rewards.`,
              members: membersOf(r),
              system: true,
            },
          }),
        ),
        "seed: roles",
      );
      const grants = SUITE_ROLES.flatMap((r) =>
        ROLE_GRANTS[r].map((t) => {
          const slug = `role-${r}-${t.suffix}`;
          return ctx.create("Grant", slug, {
            apiVersion: "plinth/v1",
            kind: "Grant",
            metadata: { slug, title: slug },
            spec: {
              principal: `role:${r}`,
              effect: "allow",
              actions: [...t.actions],
              resource: `plinth://${ctx.workspaceSlug}/${t.resource}`,
              status: "active",
              ...(t.owner_only ? { owner_only: true } : {}),
            },
          });
        }),
      );
      yield* ctx.commitNodes(grants, "seed: role grants");
    }),
};

/** One Preference node per member, from the Program defaults, slug `prefs.<handle>`. */
export const preferences: SeedStep = {
  name: "preferences",
  spec: "2.2 Preference",
  run: (ctx) =>
    ctx
      .commitNodes(
        SEED_MEMBERS.map((m) =>
          ctx.create("Preference", `prefs.${m.handle}`, {
            ...SUITE_EXAMPLES.Preference,
            metadata: { slug: `prefs.${m.handle}`, title: `Preferences of ${m.displayName}` },
            spec: { ...SUITE_EXAMPLES.Preference.spec, owner: m.subject },
          }),
        ),
        "seed: preferences",
      )
      .pipe(Effect.asVoid),
};

const group = (
  ctx: Parameters<SeedStep["run"]>[0],
  slug: string,
  title: string,
  type: "team" | "region" | "interest" | "distribution",
  members: ReadonlyArray<SeedMember>,
  managers: ReadonlyArray<string>,
  hue: number,
  openPosting: boolean,
) =>
  ctx.create("Group", slug, {
    apiVersion: "plinth/v1",
    kind: "Group",
    metadata: { slug, title },
    spec: {
      description: `${title} at Northwind.`,
      type,
      members: members.map((m) => m.subject),
      managers,
      open_posting: openPosting,
      artwork: { icon: type === "region" ? "globe" : "group", hue, pattern: "dots" },
    },
  });

/** Groups: all-staff, five region groups, peak-crew (12) and wellness-club (9). */
export const groups: SeedStep = {
  name: "groups",
  spec: "11.2",
  run: (ctx) =>
    Effect.gen(function* () {
      const rng = ctx.rng("groups");
      const lead = (r: Region) => (r === "EMEA" ? "user:emea-lead" : "user:ops-lead");
      const regions: ReadonlyArray<Region> = ["NA", "EMEA", "APAC", "LATAM", "ANZ"];
      const pool = SEED_MEMBERS.filter((m) => m.department === "fulfilment" || m.department === "operations");
      const pick = (n: number, from: ReadonlyArray<SeedMember>) => {
        const left = [...from];
        const out: SeedMember[] = [];
        while (out.length < n && left.length > 0)
          out.push(left.splice(rng.int(left.length), 1)[0] as SeedMember);
        return out.sort((a, b) => a.index - b.index);
      };
      yield* ctx.commitNodes(
        [
          group(
            ctx,
            "all-staff",
            "All staff",
            "distribution",
            SEED_MEMBERS,
            ["user:ops-lead", "user:content-editor"],
            210,
            false,
          ),
          ...regions.map((r, i) =>
            group(
              ctx,
              `${r.toLowerCase()}-ops`,
              `${r} operations`,
              "region",
              SEED_MEMBERS.filter((m) => m.region === r),
              [lead(r)],
              30 + i * 60,
              true,
            ),
          ),
          group(ctx, "peak-crew", "Peak crew", "interest", pick(12, pool), ["user:ops-lead"], 12, true),
          group(
            ctx,
            "wellness-club",
            "Wellness club",
            "interest",
            pick(9, SEED_MEMBERS),
            ["user:ops-lead"],
            150,
            true,
          ),
        ],
        "seed: groups",
      );
    }),
};

const LIFETIME: Record<SeedMember["tier"], readonly [number, number]> = {
  bronze: [300, 4200],
  silver: [5200, 17000],
  gold: [21000, 45000],
  platinum: [52000, 90000],
};

/**
 * Opening balances: each member's account receives one `award` sized to their target tier (CONTRACT.md 11.2: the
 * generator sizes award history per member to hit the target tier). The activity steps add the history on top and
 * spend from these balances. Posted with the ledger helper because the `points.award` handler is a domain step.
 */
export const openingBalances: SeedStep = {
  name: "opening-balances",
  spec: "7.2, 11.2",
  run: (ctx) =>
    Effect.gen(function* () {
      const rng = ctx.rng("opening-balances");
      const at = new Date(ctx.demoNow.getTime() - 90 * DAY);
      for (const m of SEED_MEMBERS) {
        const [lo, hi] = LIFETIME[m.tier];
        const base = lo + rng.int(hi - lo);
        yield* inTx(
          postAward(ctx.emitCtx(at), {
            handle: m.handle,
            base,
            memo: "Opening balance",
            key: `seed:opening:${m.handle}`,
            ref: { kind: "seed", id: m.handle },
          }),
        );
      }
    }),
};

const RARITY_RANK: Record<string, number> = { legendary: 4, epic: 3, rare: 2, uncommon: 1, common: 0 };

/**
 * Badge showcases (`me.profile.update`, through the real handler): about two members in three pin their rarest held
 * badges. Must run after the awards of the activity step; it only reads `badge_awards`, so running it earlier is harmless
 * (nothing is pinned yet).
 */
export const profileShowcase = (ctx: SeedCtx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rng = ctx.rng("showcase");
    const held = yield* store(
      sql<{ handle: string; subject: string; slug: string; rarity: string; awarded_at: string }>`
        SELECT m.handle, p.subject, b.badge_slug AS slug, coalesce(n.body -> 'spec' ->> 'rarity', 'common') AS rarity,
               b.awarded_at::text AS awarded_at
        FROM badge_awards b JOIN members m ON m.member_id = b.member_id JOIN principals p ON p.principal_id = b.member_id
        LEFT JOIN nodes n ON n.workspace_id = b.workspace_id AND n.kind = 'Badge' AND n.slug = b.badge_slug AND n.deleted_at IS NULL
        WHERE b.workspace_id = ${ctx.workspaceId} AND b.revoked_at IS NULL ORDER BY m.handle, b.awarded_at DESC`,
    );
    for (const m of SEED_MEMBERS) {
      const mine = held.filter((h) => h.handle === m.handle);
      if (mine.length === 0 || rng.int(3) === 0) continue;
      const pick = [...mine]
        .sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0))
        .slice(0, 3)
        .map((h) => h.slug);
      const who = yield* ctx.principal(m.subject);
      yield* ctx.act(
        who,
        "me.profile.update",
        { showcase: pick },
        { at: new Date(ctx.demoNow.getTime() - (1 + rng.int(20)) * 3_600_000) },
      );
    }
  });
