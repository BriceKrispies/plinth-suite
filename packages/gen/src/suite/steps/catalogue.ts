import { Effect } from "effect";
import { nodeId } from "@plinth/core";
import type { Artwork, ProductSpec } from "@plinth/spec";
import { ControlStore, store } from "@plinth/engine";
import type { SeedStep } from "../seed";

/**
 * Seed step `catalogue` (CONTRACT.md 11.3, 7.4): 6 Categories and 60 Products committed as `service:ingest` on the system
 * surface, with the inventory row of each product. The inventory starts with a buffer above the contract's stock rule
 * (`5 + (index * 13) % 40`, out = 0, low = 2) so that the 90-day order history never runs a product dry; the activity step
 * finishes with a stock count (`inventory.adjust`, reason `count_correction`) that lands every product on that rule.
 */

const DAY = 86_400_000;
export const STOCK_BUFFER = 40;

interface CategoryDef {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly icon: Artwork["icon"];
  readonly hue: number;
}

export const CATEGORIES: ReadonlyArray<CategoryDef> = [
  {
    slug: "apparel",
    title: "Apparel",
    description: "Northwind-branded clothing and accessories.",
    icon: "shirt",
    hue: 212,
  },
  {
    slug: "tech",
    title: "Tech",
    description: "Gadgets and gear for work and play.",
    icon: "laptop",
    hue: 250,
  },
  {
    slug: "home",
    title: "Home",
    description: "Things that make a home feel like one.",
    icon: "plant",
    hue: 140,
  },
  {
    slug: "experiences",
    title: "Experiences",
    description: "Days out and memories to keep.",
    icon: "mountain",
    hue: 30,
  },
  { slug: "wellness", title: "Wellness", description: "Move, rest and recover.", icon: "leaf", hue: 160 },
  {
    slug: "giving",
    title: "Giving",
    description: "Turn points into good in the world.",
    icon: "heart",
    hue: 350,
  },
];

type Fulfilment = ProductSpec["fulfilment"];

interface ProductDef {
  readonly category: string;
  readonly title: string;
  readonly price: number;
  readonly summary: string;
  readonly featured?: boolean;
  readonly fulfilment?: Fulfilment;
  readonly minTier?: "gold" | "platinum";
  readonly stock?: "out" | "low";
  readonly cashCents?: number;
  readonly limit?: number;
}

const P = (
  category: string,
  title: string,
  price: number,
  summary: string,
  o: Partial<ProductDef> = {},
): ProductDef => ({
  category,
  title,
  price,
  summary,
  ...o,
});

/** The 60 products, in the order of the contract table. */
export const PRODUCTS: ReadonlyArray<ProductDef> = [
  P("apparel", "Fleece quarter-zip", 4200, "Midweight recycled fleece with the Northwind mark.", {
    featured: true,
  }),
  P("apparel", "Peak crew tee", 1200, "Soft cotton tee with the peak-season print."),
  P("apparel", "Rain shell jacket", 7800, "Packable waterproof shell for the loading dock."),
  P("apparel", "Merino beanie", 1500, "Warm merino knit in Northwind navy."),
  P("apparel", "Logo cap", 900, "Six-panel cap with an embroidered mark."),
  P("apparel", "Canvas tote", 800, "Heavy canvas tote for the daily carry."),
  P("apparel", "Thermal socks 3-pack", 700, "Three pairs of cushioned thermal socks."),
  P("apparel", "Soft-shell vest", 5600, "Windproof soft-shell vest for early shifts.", { stock: "low" }),
  P("apparel", "Hi-vis running top", 2400, "Reflective top for the evening run home."),
  P("apparel", "Embroidered hoodie", 3900, "Heavyweight hoodie with a stitched crest."),
  P("tech", "Wireless earbuds", 9500, "Compact earbuds with a charging case.", { featured: true }),
  P("tech", "Power bank 20k", 3200, "20,000 mAh power bank with two fast ports."),
  P("tech", "Smart mug", 6400, "Keeps coffee at your chosen temperature."),
  P("tech", "Mechanical keyboard", 11000, "Hot-swappable mechanical keyboard."),
  P("tech", "Desk lamp", 4800, "Dimmable LED lamp with a wireless charging base."),
  P("tech", "USB-C hub", 2900, "Seven-port hub for a tidy desk."),
  P("tech", "Noise-cancelling headphones", 22000, "Over-ear headphones with adaptive noise cancelling.", {
    minTier: "gold",
    cashCents: 2500,
  }),
  P("tech", "Fitness band", 7200, "Heart-rate and sleep tracking band.", { stock: "out" }),
  P("tech", "Portable speaker", 5500, "Rugged Bluetooth speaker with a 12-hour battery."),
  P("tech", "E-reader", 13500, "Glare-free e-reader with weeks of battery."),
  P("home", "Herb garden kit", 2200, "Grow basil, mint and chives on the sill."),
  P("home", "Pour-over coffee set", 3600, "Dripper, server and filters.", { featured: true }),
  P("home", "Weighted blanket", 8800, "A calm, heavy blanket for better sleep."),
  P("home", "Cast-iron skillet", 4400, "Pre-seasoned skillet that outlives us all."),
  P("home", "Cocktail kit", 3100, "Shaker, jigger and a recipe card set."),
  P("home", "Ceramic planter set", 1900, "Three glazed planters in graded sizes."),
  P("home", "Picnic blanket", 2600, "Water-resistant backing, folds to a satchel."),
  P("home", "Knife sharpener", 1700, "Two-stage sharpener for kitchen knives."),
  P("home", "Aroma diffuser", 2800, "Ultrasonic diffuser with a soft night light."),
  P("home", "Board game night box", 3300, "Three classic games and a snack tray."),
  P("experiences", "Cooking class for two", 14000, "An evening cooking class with a local chef.", {
    fulfilment: "pickup",
  }),
  P("experiences", "Hot-air balloon flight", 48000, "Sunrise balloon flight over the valley.", {
    fulfilment: "pickup",
    minTier: "platinum",
    cashCents: 15000,
  }),
  P("experiences", "Spa day", 18000, "A full day at a partner spa.", { fulfilment: "pickup" }),
  P("experiences", "Concert tickets pair", 16000, "Two tickets to a live show of your choice.", {
    fulfilment: "digital",
  }),
  P("experiences", "Climbing session", 6500, "Guided indoor climbing session.", { fulfilment: "pickup" }),
  P("experiences", "Wine tasting", 12000, "Guided tasting of six regional wines.", { fulfilment: "pickup" }),
  P("experiences", "Kayak tour", 9000, "Half-day guided kayak tour.", { fulfilment: "pickup" }),
  P("experiences", "Stargazing night", 7500, "An evening with telescopes and an astronomer.", {
    fulfilment: "pickup",
  }),
  P("experiences", "Museum annual pass", 8500, "A year of free entry to partner museums.", {
    fulfilment: "digital",
  }),
  P("experiences", "Weekend cabin", 60000, "Two nights in a woodland cabin.", {
    fulfilment: "pickup",
    minTier: "platinum",
    stock: "low",
    cashCents: 12000,
    limit: 2,
  }),
  P("wellness", "Yoga mat", 2500, "Non-slip 6 mm mat with a carry strap."),
  P("wellness", "Massage gun", 12500, "Quiet percussion massager, five heads.", { featured: true }),
  P("wellness", "Meditation app year", 4000, "A year of guided meditation.", { fulfilment: "digital" }),
  P("wellness", "Water bottle", 900, "Insulated steel bottle, 750 ml."),
  P("wellness", "Resistance bands", 1400, "Five bands, light to heavy."),
  P("wellness", "Foam roller", 1600, "Dense foam roller for recovery."),
  P("wellness", "Sleep mask set", 1100, "Contoured sleep mask and earplugs."),
  P("wellness", "Running belt", 1300, "Slim belt that holds a phone and keys."),
  P("wellness", "Bike tune-up voucher", 3500, "A full tune-up at a partner shop.", { fulfilment: "digital" }),
  P("wellness", "Nutrition consult", 6000, "A one-hour consult with a dietitian.", { fulfilment: "digital" }),
  P("giving", "Plant 10 trees", 1000, "Ten trees planted in your name.", {
    fulfilment: "donation",
    featured: true,
  }),
  P("giving", "Food bank meal pack", 1500, "Meals delivered to a regional food bank.", {
    fulfilment: "donation",
  }),
  P("giving", "School supplies kit", 2000, "A kit for a child starting school.", { fulfilment: "donation" }),
  P("giving", "Clean water pledge", 2500, "Clean water for a community for a year.", {
    fulfilment: "donation",
  }),
  P("giving", "Animal shelter day", 1800, "A day of care at a local shelter.", { fulfilment: "donation" }),
  P("giving", "Literacy book bundle", 1200, "Books for a community library.", { fulfilment: "donation" }),
  P("giving", "Coral reef restoration", 3000, "Coral fragments planted on a reef.", {
    fulfilment: "donation",
  }),
  P("giving", "Community garden plot", 2200, "A plot for a family in a community garden.", {
    fulfilment: "donation",
  }),
  P("giving", "Warm coats drive", 1600, "Coats for people facing a cold winter.", { fulfilment: "donation" }),
  P("giving", "Disaster relief pledge", 5000, "Emergency relief where it is needed most.", {
    fulfilment: "donation",
  }),
];

const PATTERNS: ReadonlyArray<Artwork["pattern"]> = ["dots", "stripes", "rings", "grid", "waves", "solid"];

export const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The contract's stock for a product at its index, once the history is over. */
export const finalStock = (p: ProductDef, index: number): number =>
  p.stock === "out" ? 0 : p.stock === "low" ? 2 : 5 + ((index * 13) % 40);

const tagsOf = (p: ProductDef): string[] => {
  const tags = [p.category];
  if (p.fulfilment && p.fulfilment !== "ship") tags.push(p.fulfilment);
  if (p.featured) tags.push("featured");
  if (p.price <= 1500) tags.push("small-treat");
  if (p.price >= 10000) tags.push("big-ticket");
  return tags;
};

export const catalogueStep: SeedStep = {
  name: "catalogue",
  spec: "11.3, 7.4",
  run: (ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const cats = new Map(CATEGORIES.map((c) => [c.slug, c] as const));
      yield* ctx.commitNodes(
        CATEGORIES.map((c, i) =>
          ctx.create("Category", c.slug, {
            apiVersion: "plinth/v1",
            kind: "Category",
            metadata: { slug: c.slug, title: c.title },
            spec: {
              description: c.description,
              artwork: { icon: c.icon, hue: c.hue, pattern: PATTERNS[i % PATTERNS.length] },
              sort: (i + 1) * 10,
              status: "active",
            },
          }),
        ),
        "seed: categories",
      );
      yield* ctx.commitNodes(
        PRODUCTS.map((p, i) => {
          const c = cats.get(p.category) as CategoryDef;
          const slug = slugOf(p.title);
          const spec: ProductSpec = {
            category: `category:${p.category}`,
            summary: p.summary,
            description: `${p.summary} Part of the ${c.title.toLowerCase()} range of the Northwind Rewards store.`,
            price_points: p.price,
            ...(p.cashCents ? { cash_price_cents: p.cashCents } : {}),
            artwork: {
              icon: c.icon,
              hue: c.hue,
              pattern: PATTERNS[i % PATTERNS.length] as Artwork["pattern"],
            },
            tags: tagsOf(p),
            status: "active",
            featured: p.featured === true,
            fulfilment: p.fulfilment ?? (p.category === "giving" ? "donation" : "ship"),
            ...(p.minTier ? { min_tier: p.minTier } : {}),
            ...(p.limit ? { limit_per_member: p.limit } : {}),
            low_stock_threshold: 3,
          };
          return ctx.create("Product", slug, {
            apiVersion: "plinth/v1",
            kind: "Product",
            metadata: { slug, title: p.title },
            spec,
          });
        }),
        "seed: products",
      );
      // the inventory rows, with their opening movement before the history starts
      const start = new Date(ctx.demoNow.getTime() - 91 * DAY).toISOString();
      for (const [i, p] of PRODUCTS.entries()) {
        const slug = slugOf(p.title);
        const id = nodeId(ctx.workspaceId, "Product", slug);
        const onHand = finalStock(p, i) + STOCK_BUFFER;
        yield* store(
          sql`INSERT INTO product_inventory (product_id, workspace_id, product_slug, on_hand, updated_at)
              VALUES (${id}, ${ctx.workspaceId}, ${slug}, ${onHand}, ${start}::timestamptz)
              ON CONFLICT (product_id) DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = EXCLUDED.updated_at`,
        );
        yield* store(
          sql`INSERT INTO inventory_movements (workspace_id, product_id, delta, on_hand_after, reason, actor_id, occurred_at, note)
              VALUES (${ctx.workspaceId}, ${id}, ${onHand}, ${onHand}, 'initial', ${ctx.system.id}, ${start}::timestamptz,
                      'Opening stock')`,
        );
      }
    }),
};
