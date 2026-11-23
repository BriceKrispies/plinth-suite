// The town as data: the Town Square and seven boroughs (spec 01 sections 1.4 and 1.5), each borough a list of
// districts, each district a row of buildings on lots. Pure data with no three.js, so the Plat (the landing tiles, the
// streets' links, the Directory, stub pages) can render before the GPU chunk loads; town/model.ts turns the same
// data into geometry. Only Rewards is built out (Points, Store, Badges); the other boroughs are one-band stubs.

export type BoroughId =
  "insight" | "admin" | "engage" | "rewards" | "square" | "personal" | "operate" | "newtown";

/** The procedural recipe that draws a building (town/model.ts RECIPES). */
export type RecipeId =
  | "bank"
  | "awardOffice"
  | "emporium"
  | "hallOfHonours"
  | "postOffice"
  | "bellTower"
  | "guildHall"
  | "gatehouse"
  | "fairground"
  | "gazettePress"
  | "works"
  | "clockTower"
  | "countingHouse"
  | "depotYard"
  | "stockroom"
  | "observatory"
  | "recordOffice"
  | "townHall"
  | "signalMast"
  | "lampStudio"
  | "fountainSquare"
  | "newTownPlots";

export interface BuildingDef {
  readonly id: string;
  readonly name: string; // plain name first, then the landmark (spec 01 rule 7)
  readonly route: string | null; // town route under /town, or null for scenery
  readonly lot: number; // lot width in model units
  readonly recipe: RecipeId;
  readonly hero?: boolean;
}

export interface DistrictDef {
  readonly id: string;
  readonly plaque: string; // "Points · Bank"
  readonly buildings: readonly BuildingDef[];
}

export interface BoroughDef {
  readonly id: BoroughId;
  readonly name: string;
  readonly glyph: string;
  readonly districts: readonly DistrictDef[];
  /** One sentence for the tile's description (screen readers) when there is no live data. */
  readonly blurb: string;
}

// ---------------------------------------------------------------- the boroughs (seed)

const b = (
  id: string,
  name: string,
  route: string | null,
  lot: number,
  recipe: RecipeId,
  hero = false,
): BuildingDef => ({ id, name, route, lot, recipe, hero });

export const BOROUGHS: readonly BoroughDef[] = [
  {
    id: "insight",
    name: "Insight",
    glyph: "◎",
    blurb: "Reports and audit.",
    districts: [
      {
        id: "insight-main",
        plaque: "Reports · Observatory",
        buildings: [
          b("observatory", "Reports · Observatory", "/reports", 15, "observatory"),
          b("record-office", "Audit · Record Office", "/audit", 13, "recordOffice"),
        ],
      },
    ],
  },
  {
    id: "admin",
    name: "Admin",
    glyph: "⚑",
    blurb: "Admin, search and settings.",
    districts: [
      {
        id: "admin-main",
        plaque: "Admin · Town Hall",
        buildings: [
          b("town-hall", "Admin · Town Hall", "/admin", 13, "townHall"),
          b("signal-mast", "Search · Signal Mast", "/search", 6, "signalMast"),
          b("lamp-studio", "Settings · Lamp Studio", "/settings", 9, "lampStudio"),
        ],
      },
    ],
  },
  {
    id: "engage",
    name: "Engage",
    glyph: "✎",
    blurb: "Promotions, content, automation and the calendar.",
    districts: [
      {
        id: "engage-main",
        plaque: "Engage · Fairground",
        buildings: [
          b("fairground", "Promotions · Fairground", "/promotions", 14, "fairground"),
          b("gazette-press", "Content · Gazette Press", "/content", 12, "gazettePress"),
          b("works", "Automation · The Works", "/automations", 13, "works"),
          b("clock-tower", "Calendar · Clock Tower", "/calendar", 7, "clockTower"),
        ],
      },
    ],
  },
  {
    id: "rewards",
    name: "Rewards",
    glyph: "$",
    blurb: "Points, the store and badges.",
    districts: [
      {
        id: "points",
        plaque: "Points · Bank",
        buildings: [
          b("bank", "Points · Bank", "/points", 26, "bank", true),
          b("award-office", "Points award · Award Office", "/points/award", 10, "awardOffice"),
        ],
      },
      {
        id: "store",
        plaque: "Store · Emporium",
        buildings: [b("emporium", "Store · Emporium", "/store", 25, "emporium")],
      },
      {
        id: "badges",
        plaque: "Badges · Hall of Honours",
        buildings: [b("hall-of-honours", "Badges · Hall of Honours", "/badges", 19, "hallOfHonours")],
      },
    ],
  },
  {
    id: "square",
    name: "Town Square",
    glyph: "▣",
    blurb: "Home.",
    districts: [
      {
        id: "square",
        plaque: "Town Square · Home",
        buildings: [b("square", "Town Square · Home", "/home", 34, "fountainSquare")],
      },
    ],
  },
  {
    id: "personal",
    name: "Personal",
    glyph: "✉",
    blurb: "Messages, notifications, tasks and approvals.",
    districts: [
      {
        id: "personal-main",
        plaque: "Messages · Post Office",
        buildings: [
          b("post-office", "Messages · Post Office", "/messages", 13, "postOffice"),
          b("bell-tower", "Notifications · Bell Tower", "/notifications", 6, "bellTower"),
          b("guild-hall", "Tasks · Guild Hall", "/tasks", 11, "guildHall"),
          b("gatehouse", "Approvals · Gatehouse", "/approvals", 13, "gatehouse"),
        ],
      },
    ],
  },
  {
    id: "operate",
    name: "Operate",
    glyph: "▦",
    blurb: "The ledger, store management and inventory.",
    districts: [
      {
        id: "operate-main",
        plaque: "Ledger · Counting House",
        buildings: [
          b("counting-house", "Ledger · Counting House", "/ledger", 10, "countingHouse"),
          b("depot-yard", "Store manage · Depot yard", "/store/manage", 15, "depotYard"),
          b("stockroom", "Inventory · Stockroom", "/store/inventory", 11, "stockroom"),
        ],
      },
    ],
  },
  {
    id: "newtown",
    name: "New Town",
    glyph: "✚",
    blurb: "Custom pages. None yet.",
    districts: [
      {
        id: "newtown-main",
        plaque: "New Town · plots",
        buildings: [b("plots", "New Town · open plots", null, 14, "newTownPlots")],
      },
    ],
  },
];

export const boroughById = (id: string): BoroughDef | undefined => BOROUGHS.find((x) => x.id === id);

/** The building whose town route is `path` (for stub interiors and the Directory). */
export const buildingByRoute = (path: string): { borough: BoroughDef; building: BuildingDef } | null => {
  for (const borough of BOROUGHS)
    for (const d of borough.districts)
      for (const building of d.buildings) if (building.route === path) return { borough, building };
  return null;
};

/** A district row's width in model units. */
export const rowWidth = (d: DistrictDef): number => d.buildings.reduce((s, x) => s + x.lot, 0);
