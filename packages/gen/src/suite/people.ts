import type { SuiteRole } from "@plinth/spec";

/**
 * The 40 members of the Suite seed (CONTRACT.md 11.2). The six named people keep their kernel subjects so the kernel
 * demo still works; their member handle is their name. The 34 generated members have subject `user:<handle>`.
 */
export type Region = "NA" | "EMEA" | "APAC" | "LATAM" | "ANZ";
export type Department = "operations" | "fulfilment" | "finance" | "marketing" | "technology" | "people";
export type TargetTier = "bronze" | "silver" | "gold" | "platinum";

export interface SeedMember {
  readonly index: number;
  readonly handle: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly title: string;
  readonly region: Region;
  readonly department: Department;
  readonly roles: ReadonlyArray<SuiteRole>;
  readonly scopeRegion?: Region;
  readonly tier: TargetTier;
  readonly named: boolean;
}

const NAMED: ReadonlyArray<Omit<SeedMember, "index" | "email" | "named">> = [
  {
    handle: "maya-ortiz",
    subject: "user:ops-lead",
    displayName: "Maya Ortiz",
    title: "Operations lead",
    region: "NA",
    department: "operations",
    roles: ["admin", "manager"],
    tier: "platinum",
  },
  {
    handle: "jonas-becker",
    subject: "user:emea-lead",
    displayName: "Jonas Becker",
    title: "Regional lead, EMEA",
    region: "EMEA",
    department: "operations",
    roles: ["manager"],
    scopeRegion: "EMEA",
    tier: "gold",
  },
  {
    handle: "priya-nair",
    subject: "user:finance-analyst",
    displayName: "Priya Nair",
    title: "Finance analyst",
    region: "APAC",
    department: "finance",
    roles: ["finance"],
    tier: "silver",
  },
  {
    handle: "tomas-alvarez",
    subject: "user:marketing-lead",
    displayName: "Tomás Alvarez",
    title: "Engagement marketing lead",
    region: "LATAM",
    department: "marketing",
    roles: ["marketing-manager"],
    tier: "gold",
  },
  {
    handle: "leah-okafor",
    subject: "user:content-editor",
    displayName: "Leah Okafor",
    title: "Internal communications editor",
    region: "EMEA",
    department: "people",
    roles: ["content-editor"],
    tier: "silver",
  },
  {
    handle: "samir-haddad",
    subject: "user:it-admin",
    displayName: "Samir Haddad",
    title: "Platform administrator",
    region: "EMEA",
    department: "technology",
    roles: ["admin"],
    tier: "bronze",
  },
];

const GENERATED: ReadonlyArray<readonly [string, Region, Department]> = [
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
];

const TITLES: Record<Department, string> = {
  operations: "Operations coordinator",
  fulfilment: "Fulfilment associate",
  finance: "Finance partner",
  marketing: "Marketing specialist",
  technology: "Platform engineer",
  people: "People partner",
};

const titleCase = (handle: string): string =>
  handle
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

/** Tier targets of the 34 generated members: 15 bronze, 10 silver, 6 gold, 3 platinum (16/12/8/4 with the named six). */
const GENERATED_TIERS: ReadonlyArray<TargetTier> = [
  ...Array<TargetTier>(15).fill("bronze"),
  ...Array<TargetTier>(10).fill("silver"),
  ...Array<TargetTier>(6).fill("gold"),
  ...Array<TargetTier>(3).fill("platinum"),
];

/** Deterministic, seed-independent assignment of tiers to generated members (a fixed stride permutation). */
const tierFor = (i: number): TargetTier => GENERATED_TIERS[(i * 13) % GENERATED_TIERS.length] ?? "bronze";

export const SEED_MEMBERS: ReadonlyArray<SeedMember> = [
  ...NAMED.map((m, i): SeedMember => ({
    ...m,
    index: i,
    email: `${m.handle}@northwind.example`,
    named: true,
  })),
  ...GENERATED.map(([handle, region, department], i): SeedMember => ({
    index: NAMED.length + i,
    handle,
    subject: `user:${handle}`,
    displayName: titleCase(handle),
    email: `${handle}@northwind.example`,
    title: TITLES[department],
    region,
    department,
    roles: [],
    tier: tierFor(i),
    named: false,
  })),
];

/** Every human is in `member`; the named roles come from NAMED_ROLE_MEMBERS in the spec. */
export const handleOfSubject = (subject: string): string | undefined =>
  SEED_MEMBERS.find((m) => m.subject === subject)?.handle;
