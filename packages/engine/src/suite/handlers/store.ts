import { Effect, type Schema as S } from "effect";
import {
  SuiteStore,
  type Artwork,
  CategorySpec,
  type OrderStatus,
  type ProductSpec,
  type ProgramSpec,
  type Tier,
} from "@plinth/spec";
import { principalId } from "@plinth/core";
import { evalRowPredicate } from "@plinth/query";
import { ControlStore, store } from "../../control-store";
import type { StoreError } from "../../errors";
import { emitFrom, type EmitCtx } from "../domain-events";
import { approversFor } from "../approvals-core";
import { memberById, type MemberRow } from "../people";
import { newId } from "../ids";
import { createNotifications } from "../notify";
import {
  accountId,
  memberCode,
  postAdjustment,
  postPromotionBonus,
  postPurchase,
  postRefund,
  systemCode,
} from "../ledger";
import { TIER_RANK, loadProgram, nextCounter, orderNo } from "../program";
import { fileForApproval, type ActionCtx, type ActionHandler } from "../types";
import {
  chargePromotions,
  clip,
  decide,
  decideFor,
  decodeCursor,
  DAY_MS,
  encodeCursor,
  evaluatePromos,
  factsOf,
  forbiddenPerm,
  forbiddenRow,
  iso,
  loadPromoCandidates,
  memberWithFacts,
  needRef,
  nodesOfKind,
  nodeBySlug,
  pageLimit,
  personRefs,
  principalRefOf,
  productId,
  quoteHashOf,
  refuse,
  selfMember,
  unknownRef,
  type NodeRow,
} from "./engagement-shared";
import { mayTarget } from "../target";
import type { HandlerTable } from "./stub";

/**
 * Module `store` (CONTRACT.md 7.4 to 7.6, M4): catalogue, cart, wishlist, reviews, checkout, the order lifecycle and
 * inventory. Money moves only through the ledger functions; promotions are evaluated by the pure evaluator.
 */

type Out<T extends S.Schema.Any> = S.Schema.Type<T>;
type ProductNode = NodeRow<ProductSpec>;
type CategoryNode = NodeRow<S.Schema.Type<typeof CategorySpec>>;
type Card = Out<typeof SuiteStore.ProductCard>;
type CartOut = Out<typeof SuiteStore.CartOut>;
type QuoteOut = Out<typeof SuiteStore.QuoteOut>;
type OrderDetail = Out<typeof SuiteStore.OrderDetailOut>;
type Transition = Out<typeof SuiteStore.OrderTransition>;
type StockStatus = "in_stock" | "low" | "out";

const DEFAULT_ART: Artwork = { icon: "box", hue: 210, pattern: "solid" };
const ORDER_STATUSES: ReadonlyArray<OrderStatus> = [
  "placed",
  "approved",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];
const STORE = "store";

export const stockStatusOf = (onHand: number, threshold: number): StockStatus =>
  onHand <= 0 ? "out" : onHand <= threshold ? "low" : "in_stock";

// ---- catalogue loading ---------------------------------------------------------------------------------

interface Catalogue {
  readonly products: ReadonlyMap<string, ProductNode>;
  readonly categories: ReadonlyMap<string, CategoryNode>;
  readonly onHand: ReadonlyMap<string, number>;
}

const loadCatalogue = (ws: string): Effect.Effect<Catalogue, StoreError, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const products = yield* nodesOfKind<ProductSpec>(ws, "Product");
    const categories = yield* nodesOfKind<S.Schema.Type<typeof CategorySpec>>(ws, "Category");
    const inv = yield* store(
      sql<{ product_slug: string; on_hand: number }>`
        SELECT product_slug, on_hand FROM product_inventory WHERE workspace_id = ${ws}`,
    );
    return {
      products: new Map(products.map((p) => [p.slug, p] as const)),
      categories: new Map(categories.map((c) => [c.slug, c] as const)),
      onHand: new Map(inv.map((i) => [i.product_slug, i.on_hand] as const)),
    };
  });

const catSlug = (p: ProductNode): string => p.spec.category.replace(/^category:/, "");

/** A product is buyable and listed when active and its category is active. */
const isListed = (cat: Catalogue, p: ProductNode): boolean =>
  p.spec.status === "active" && cat.categories.get(catSlug(p))?.spec.status === "active";

/** Make sure the inventory row of a product exists (stock 0) and return its id. */
const ensureInventory = (ws: string, slug: string, now: Date) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const id = productId(ws, slug);
    yield* store(
      sql`INSERT INTO product_inventory (product_id, workspace_id, product_slug, on_hand, updated_at)
          VALUES (${id}, ${ws}, ${slug}, 0, ${now.toISOString()}::timestamptz) ON CONFLICT DO NOTHING`,
    );
    return id;
  });

interface Viewer {
  readonly member: MemberRow;
  readonly balance: number;
  readonly wishlist: ReadonlySet<string>;
  readonly cart: ReadonlyMap<string, number>;
  readonly purchased: ReadonlyMap<string, number>;
}

const memberBalance = (ws: string, handle: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ balance: string }>`
        SELECT balance::text AS balance FROM ledger_accounts WHERE account_id = ${accountId(ws, memberCode(handle))}`,
    );
    return Number(rows[0]?.balance ?? 0);
  });

const loadViewer = (ws: string, member: MemberRow) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const wish = yield* store(
      sql<{ product_slug: string }>`
        SELECT i.product_slug FROM wishlist_items w JOIN product_inventory i ON i.product_id = w.product_id
        WHERE w.member_id = ${member.id}`,
    );
    const cart = yield* store(
      sql<{ product_slug: string; qty: number }>`
        SELECT i.product_slug, ci.qty FROM carts c JOIN cart_items ci ON ci.cart_id = c.cart_id
        JOIN product_inventory i ON i.product_id = ci.product_id WHERE c.member_id = ${member.id}`,
    );
    const bought = yield* store(
      sql<{ product_slug: string; n: number }>`
        SELECT oi.product_slug, sum(oi.qty)::int AS n FROM store_order_items oi
        JOIN store_orders o ON o.order_id = oi.order_id
        WHERE o.member_id = ${member.id} AND o.status <> 'cancelled' AND NOT oi.free_item GROUP BY oi.product_slug`,
    );
    return {
      member,
      balance: yield* memberBalance(ws, member.handle),
      wishlist: new Set(wish.map((w) => w.product_slug)),
      cart: new Map(cart.map((c) => [c.product_slug, c.qty] as const)),
      purchased: new Map(bought.map((b) => [b.product_slug, b.n] as const)),
    } satisfies Viewer;
  });

const loadRatings = (ws: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ product_slug: string; avg: number; n: number }>`
        SELECT i.product_slug, avg(r.rating)::float AS avg, count(*)::int AS n FROM product_reviews r
        JOIN product_inventory i ON i.product_id = r.product_id
        WHERE r.workspace_id = ${ws} AND r.status = 'published' GROUP BY i.product_slug`,
    );
    return new Map(
      rows.map((r) => [r.product_slug, { average: Math.round(r.avg * 10) / 10, count: r.n }] as const),
    );
  });

type Ratings = Effect.Effect.Success<ReturnType<typeof loadRatings>>;

const lockedReason = (p: ProductNode, onHand: number, v: Viewer): Card["locked_reason"] => {
  const min = p.spec.min_tier;
  if (min && TIER_RANK[min] > TIER_RANK[v.member.tier as Tier]) return "tier";
  if (onHand <= 0) return "out_of_stock";
  const lim = p.spec.limit_per_member;
  if (lim !== undefined && (v.purchased.get(p.slug) ?? 0) >= lim) return "limit";
  return null;
};

const cardOf = (
  p: ProductNode,
  cat: Catalogue,
  v: Viewer,
  ratings: Ratings,
  promoPercent: number | null,
): Card => {
  const onHand = cat.onHand.get(p.slug) ?? 0;
  const min = p.spec.min_tier;
  const tierOk = !min || TIER_RANK[min] <= TIER_RANK[v.member.tier as Tier];
  return {
    slug: p.slug,
    title: p.title,
    category: catSlug(p),
    summary: p.spec.summary,
    price_points: p.spec.price_points,
    cash_price_cents: p.spec.cash_price_cents ?? null,
    artwork: p.spec.artwork,
    tags: [...p.spec.tags],
    featured: p.spec.featured,
    min_tier: min ?? null,
    stock_status: stockStatusOf(onHand, p.spec.low_stock_threshold),
    on_hand: onHand,
    rating: ratings.get(p.slug) ?? null,
    in_wishlist: v.wishlist.has(p.slug),
    in_cart_qty: v.cart.get(p.slug) ?? 0,
    affordable: p.spec.price_points <= v.balance && tierOk,
    locked_reason: lockedReason(p, onHand, v),
    promo_percent: promoPercent,
  };
};

/** Best live discount percent per product for the viewer (display only): evaluate a one-line purchase of each. */
const promoPercents = (ws: string, v: Viewer, now: Date, products: ReadonlyArray<ProductNode>) =>
  Effect.gen(function* () {
    const out = new Map<string, number>();
    if (products.length === 0) return out;
    const mf = yield* memberWithFacts(ws, v.member.id, now);
    const candidates = yield* loadPromoCandidates(ws, mf, now, { lock: false });
    if (candidates.length === 0) return out;
    for (const p of products) {
      const ev = evaluatePromos({
        now: now.toISOString() as never,
        mode: "live",
        member: mf.facts,
        context: {
          kind: "purchase",
          channel: "store",
          lines: [{ product: p.slug, category: catSlug(p), qty: 1, unit_points: p.spec.price_points }],
        },
        candidates: [...candidates],
      });
      if (ev.totals.kind === "purchase" && ev.totals.discount_points > 0)
        out.set(p.slug, Math.round((ev.totals.discount_points * 100) / p.spec.price_points));
    }
    return out;
  });

// ---- categories, catalogue, product -------------------------------------------------------------------

const categories: ActionHandler<unknown, Out<typeof SuiteStore.CategoriesOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const cat = yield* loadCatalogue(ctx.principal.workspaceId);
      const counts = new Map<string, number>();
      for (const p of cat.products.values())
        if (isListed(cat, p)) counts.set(catSlug(p), (counts.get(catSlug(p)) ?? 0) + 1);
      return {
        items: [...cat.categories.values()]
          .filter((c) => c.spec.status === "active")
          .sort((a, b) => a.spec.sort - b.spec.sort || a.slug.localeCompare(b.slug))
          .map((c) => ({
            slug: c.slug,
            title: c.title,
            description: c.spec.description,
            artwork: c.spec.artwork,
            product_count: counts.get(c.slug) ?? 0,
            sort: c.spec.sort,
          })),
      };
    }),
};

const catalogue: ActionHandler<Out<typeof SuiteStore.CatalogIn>, Out<typeof SuiteStore.CatalogOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const cat = yield* loadCatalogue(ws);
      const me = yield* selfMember(ctx);
      const v = yield* loadViewer(ws, me);
      const ratings = yield* loadRatings(ws);
      const active = [...cat.products.values()].filter((p) => isListed(cat, p));
      const q = input.q?.trim().toLowerCase();
      const base = active.filter((p) => {
        if (input.tag && !p.spec.tags.includes(input.tag)) return false;
        if (input.min_points !== undefined && p.spec.price_points < input.min_points) return false;
        if (input.max_points !== undefined && p.spec.price_points > input.max_points) return false;
        if (input.in_stock && (cat.onHand.get(p.slug) ?? 0) <= 0) return false;
        if (q && !`${p.title} ${p.spec.summary} ${p.slug} ${p.spec.tags.join(" ")}`.toLowerCase().includes(q))
          return false;
        if (input.affordable) {
          const min = p.spec.min_tier;
          const tierOk = !min || TIER_RANK[min] <= TIER_RANK[me.tier as Tier];
          if (!(p.spec.price_points <= v.balance && tierOk)) return false;
        }
        return true;
      });
      const filtered = input.category ? base.filter((p) => catSlug(p) === input.category) : base;
      const catRank = (p: ProductNode) => cat.categories.get(catSlug(p))?.spec.sort ?? 0;
      const sort = input.sort ?? "featured";
      const sorted = [...filtered].sort((a, b) => {
        switch (sort) {
          case "price_asc":
            return a.spec.price_points - b.spec.price_points || a.slug.localeCompare(b.slug);
          case "price_desc":
            return b.spec.price_points - a.spec.price_points || a.slug.localeCompare(b.slug);
          case "rating": {
            const ra = ratings.get(a.slug);
            const rb = ratings.get(b.slug);
            return (
              (rb?.average ?? 0) - (ra?.average ?? 0) ||
              (rb?.count ?? 0) - (ra?.count ?? 0) ||
              a.slug.localeCompare(b.slug)
            );
          }
          case "newest":
            return b.createdSeq - a.createdSeq || a.slug.localeCompare(b.slug);
          default:
            return (
              Number(b.spec.featured) - Number(a.spec.featured) ||
              catRank(a) - catRank(b) ||
              a.title.localeCompare(b.title)
            );
        }
      });
      const limit = pageLimit(input.limit, 24);
      const offset = decodeCursor<{ o: number }>(input.cursor)?.o ?? 0;
      const page = sorted.slice(offset, offset + limit);
      const percents = yield* promoPercents(ws, v, ctx.now, page);
      const tagCounts = new Map<string, number>();
      for (const p of filtered) for (const t of p.spec.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      const catCounts = new Map<string, number>();
      for (const p of base) catCounts.set(catSlug(p), (catCounts.get(catSlug(p)) ?? 0) + 1);
      const prices = active.map((p) => p.spec.price_points);
      return {
        items: page.map((p) => cardOf(p, cat, v, ratings, percents.get(p.slug) ?? null)),
        next_cursor: offset + limit < sorted.length ? encodeCursor({ o: offset + limit }) : null,
        total: sorted.length,
        facets: {
          categories: [...cat.categories.values()]
            .filter((c) => c.spec.status === "active")
            .sort((a, b) => a.spec.sort - b.spec.sort)
            .map((c) => ({ slug: c.slug, title: c.title, count: catCounts.get(c.slug) ?? 0 })),
          tags: [...tagCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 24)
            .map(([tag, count]) => ({ tag, count })),
          price: {
            min: prices.length ? Math.min(...prices) : 0,
            max: prices.length ? Math.max(...prices) : 0,
          },
        },
      };
    }),
};

interface ReviewRow {
  review_id: string;
  product_slug: string;
  member_id: string;
  rating: number;
  title: string;
  body: string;
  status: "published" | "hidden";
  created_at: Date;
}

const reviewViews = (ws: string, rows: ReadonlyArray<ReviewRow>) =>
  Effect.gen(function* () {
    const refs = yield* personRefs(
      ws,
      rows.map((r) => r.member_id),
    );
    return rows.map((r) => ({
      review_id: r.review_id,
      product: r.product_slug,
      member: needRef(refs, r.member_id),
      rating: r.rating,
      title: r.title,
      body: r.body,
      created_at: iso(r.created_at),
      status: r.status,
      verified_order: true,
    })) as Array<Out<typeof SuiteStore.ReviewView>>;
  });

const REVIEW_COLS = `r.review_id, i.product_slug, r.member_id, r.rating, r.title, r.body, r.status, r.created_at`;

const canModerate = (ctx: ActionCtx) =>
  decide(ctx, "store:moderate", STORE).pipe(Effect.map((d) => d.kind === "allow"));

const reviewsOf = (ws: string, slug: string, includeHidden: boolean, limit: number, before?: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const params: unknown[] = [ws, slug];
    let where = "r.workspace_id = $1 AND i.product_slug = $2";
    if (!includeHidden) where += " AND r.status = 'published'";
    if (before) {
      params.push(before);
      where += ` AND (r.created_at, r.review_id) < (SELECT created_at, review_id FROM product_reviews WHERE review_id = $${params.length}::uuid)`;
    }
    return yield* store(
      sql.unsafe<ReviewRow>(
        `SELECT ${REVIEW_COLS} FROM product_reviews r JOIN product_inventory i ON i.product_id = r.product_id
         WHERE ${where} ORDER BY r.created_at DESC, r.review_id DESC LIMIT ${limit}`,
        params,
      ),
    );
  });

const needProduct = (cat: Catalogue, slug: string, path = "/slug") => {
  const p = cat.products.get(slug);
  return p && p.spec.status !== "draft"
    ? Effect.succeed(p)
    : Effect.fail(unknownRef(path, `no product '${slug}'`));
};

const product: ActionHandler<Out<typeof SuiteStore.ProductIn>, Out<typeof SuiteStore.ProductDetailOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const cat = yield* loadCatalogue(ws);
      const p = yield* needProduct(cat, input.slug);
      const me = yield* selfMember(ctx);
      const v = yield* loadViewer(ws, me);
      const ratings = yield* loadRatings(ws);
      const percents = yield* promoPercents(ws, v, ctx.now, [p]);
      const mod = yield* canModerate(ctx);
      const hist = yield* store(
        sql<{ rating: number; n: number }>`
          SELECT r.rating, count(*)::int AS n FROM product_reviews r JOIN product_inventory i ON i.product_id = r.product_id
          WHERE r.workspace_id = ${ws} AND i.product_slug = ${p.slug} AND r.status = 'published' GROUP BY r.rating`,
      );
      const histogram = [1, 2, 3, 4, 5].map((s) => hist.find((h) => h.rating === s)?.n ?? 0);
      const rows = yield* reviewsOf(ws, p.slug, mod, 10);
      const delivered = yield* store(
        sql<{ n: number }>`
          SELECT count(*)::int AS n FROM store_orders o JOIN store_order_items oi ON oi.order_id = o.order_id
          WHERE o.member_id = ${me.id} AND o.status = 'delivered' AND oi.product_slug = ${p.slug}`,
      );
      const reviewed = yield* store(
        sql<{ n: number }>`
          SELECT count(*)::int AS n FROM product_reviews WHERE member_id = ${me.id} AND product_id = ${productId(ws, p.slug)}`,
      );
      const c = cat.categories.get(catSlug(p));
      const related = [...cat.products.values()]
        .filter((x) => x.slug !== p.slug && catSlug(x) === catSlug(p) && isListed(cat, x))
        .sort((a, b) => Number(b.spec.featured) - Number(a.spec.featured) || a.slug.localeCompare(b.slug))
        .slice(0, 4);
      const promos = (yield* nodesOfKind<{
        status: string;
        banner?: { headline?: string };
        eligibility: { categories?: string[]; products?: string[] };
        effects: Array<{
          type: string;
          on?: string;
          product?: string;
          categories?: string[];
          products?: string[];
        }>;
      }>(ws, "Promotion")).filter((n) => {
        if (n.spec.status !== "active") return false;
        const el = n.spec.eligibility;
        if (el.products && !el.products.includes(`product:${p.slug}`)) return false;
        if (el.categories && !el.categories.includes(p.spec.category)) return false;
        return n.spec.effects.some((e) => {
          if (e.type === "store_discount") {
            const okP = !e.products || e.products.includes(`product:${p.slug}`);
            const okC = !e.categories || e.categories.includes(p.spec.category);
            return (e.products || e.categories ? okP && okC : true) && okP && okC;
          }
          if (e.type === "free_item") return true;
          return e.type === "bonus_points" && e.on === "purchase";
        });
      });
      return {
        card: cardOf(p, cat, v, ratings, percents.get(p.slug) ?? null),
        spec: p.spec,
        revision: p.revision,
        category: { slug: catSlug(p), title: c?.title ?? catSlug(p) },
        rating_histogram: histogram,
        reviews: yield* reviewViews(ws, rows),
        can_review: (delivered[0]?.n ?? 0) > 0 && (reviewed[0]?.n ?? 0) === 0,
        member_purchased_qty: v.purchased.get(p.slug) ?? 0,
        related: related.map((x) => cardOf(x, cat, v, ratings, null)),
        promotions: promos.map((n) => ({
          slug: n.slug,
          title: n.title,
          headline: n.spec.banner?.headline ?? null,
        })),
      } as Out<typeof SuiteStore.ProductDetailOut>;
    }),
};

const reviews: ActionHandler<Out<typeof SuiteStore.ReviewsIn>, Out<typeof SuiteStore.ReviewsOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const cat = yield* loadCatalogue(ws);
      yield* needProduct(cat, input.slug);
      const mod = yield* canModerate(ctx);
      const limit = pageLimit(input.limit);
      const cur = decodeCursor<{ r: string }>(input.cursor);
      const rows = yield* reviewsOf(ws, input.slug, mod, limit + 1, cur?.r);
      const page = rows.slice(0, limit);
      return {
        items: yield* reviewViews(ws, page),
        next_cursor:
          rows.length > limit && page.length > 0
            ? encodeCursor({ r: page[page.length - 1]?.review_id })
            : null,
      };
    }),
};

const emitRating = (ctx: ActionCtx, slug: string, reviewId: string, rating: number, member: MemberRow) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const agg = yield* store(
      sql<{ avg: number | null; n: number }>`
        SELECT avg(r.rating)::float AS avg, count(*)::int AS n FROM product_reviews r
        WHERE r.workspace_id = ${ws} AND r.product_id = ${productId(ws, slug)} AND r.status = 'published'`,
    );
    yield* emitFrom(ctx, "review.created", {
      audience: ["*"],
      subject: { kind: "review", id: reviewId },
      member: principalRefOf(member),
      payload: {
        review_id: reviewId,
        product: slug,
        rating,
        average: Math.round((agg[0]?.avg ?? 0) * 10) / 10,
        count: agg[0]?.n ?? 0,
      },
    });
  });

const reviewCreate: ActionHandler<
  Out<typeof SuiteStore.ReviewCreateIn>,
  Out<typeof SuiteStore.ReviewView>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const cat = yield* loadCatalogue(ws);
      const p = yield* needProduct(cat, input.slug);
      const me = yield* selfMember(ctx);
      const pid = yield* ensureInventory(ws, p.slug, ctx.now);
      const existing = yield* store(
        sql<{ n: number }>`
          SELECT count(*)::int AS n FROM product_reviews WHERE product_id = ${pid} AND member_id = ${me.id}`,
      );
      if ((existing[0]?.n ?? 0) > 0)
        return yield* Effect.fail(refuse("CONFLICT", "ALREADY_EXISTS", "you already reviewed this product"));
      const order = yield* store(
        sql<{ order_id: string }>`
          SELECT o.order_id FROM store_orders o JOIN store_order_items oi ON oi.order_id = o.order_id
          WHERE o.member_id = ${me.id} AND o.status = 'delivered' AND oi.product_slug = ${p.slug}
          ORDER BY o.placed_at DESC LIMIT 1`,
      );
      if (!order[0])
        return yield* Effect.fail(
          refuse("RULE_REFUSED", "NOT_ELIGIBLE", "reviews need a delivered order containing this product"),
        );
      const id = newId();
      yield* store(
        sql`INSERT INTO product_reviews (review_id, workspace_id, product_id, member_id, order_id, rating, title, body, status, created_at)
            VALUES (${id}, ${ws}, ${pid}, ${me.id}, ${order[0].order_id}, ${input.rating}, ${clip(input.title, 120)},
                    ${clip(input.body, 2000)}, 'published', ${ctx.now.toISOString()}::timestamptz)`,
      );
      yield* emitRating(ctx, p.slug, id, input.rating, me);
      const rows = yield* store(
        sql.unsafe<ReviewRow>(
          `SELECT ${REVIEW_COLS} FROM product_reviews r JOIN product_inventory i ON i.product_id = r.product_id WHERE r.review_id = $1`,
          [id],
        ),
      );
      return (yield* reviewViews(ws, rows))[0] as Out<typeof SuiteStore.ReviewView>;
    }),
};

const reviewModerate: ActionHandler<
  Out<typeof SuiteStore.ReviewModerateIn>,
  Out<typeof SuiteStore.ReviewView>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const rows = yield* store(
        sql.unsafe<ReviewRow>(
          `SELECT ${REVIEW_COLS} FROM product_reviews r JOIN product_inventory i ON i.product_id = r.product_id
           WHERE r.workspace_id = $1 AND r.review_id = $2 FOR UPDATE OF r`,
          [ws, input.review_id],
        ),
      );
      const r = rows[0];
      if (!r) return yield* Effect.fail(unknownRef("/review_id", `no review '${input.review_id}'`));
      yield* store(
        sql`UPDATE product_reviews SET status = ${input.status}, moderated_by = ${ctx.principal.id},
                   moderated_at = ${ctx.now.toISOString()}::timestamptz WHERE review_id = ${r.review_id}`,
      );
      const author = yield* memberById(ws, r.member_id);
      yield* emitRating(ctx, r.product_slug, r.review_id, r.rating, author);
      return (yield* reviewViews(ws, [{ ...r, status: input.status }]))[0] as Out<
        typeof SuiteStore.ReviewView
      >;
    }),
};

// ---- cart ------------------------------------------------------------------------------------------------

interface CartRaw {
  readonly slug: string;
  readonly qty: number;
}

const cartRaw = (memberId: string) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ product_slug: string; qty: number }>`
        SELECT i.product_slug, ci.qty FROM carts c JOIN cart_items ci ON ci.cart_id = c.cart_id
        JOIN product_inventory i ON i.product_id = ci.product_id WHERE c.member_id = ${memberId}
        ORDER BY ci.added_at, i.product_slug`,
    );
    return rows.map((r): CartRaw => ({ slug: r.product_slug, qty: r.qty }));
  });

type LineIssue = "out_of_stock" | "insufficient_stock" | "retired" | "tier" | "limit";

const lineIssue = (cat: Catalogue, p: ProductNode | undefined, qty: number, v: Viewer): LineIssue | null => {
  if (!p || !isListed(cat, p)) return "retired";
  const min = p.spec.min_tier;
  if (min && TIER_RANK[min] > TIER_RANK[v.member.tier as Tier]) return "tier";
  const onHand = cat.onHand.get(p.slug) ?? 0;
  if (onHand <= 0) return "out_of_stock";
  if (qty > onHand) return "insufficient_stock";
  const lim = p.spec.limit_per_member;
  if (lim !== undefined && (v.purchased.get(p.slug) ?? 0) + qty > lim) return "limit";
  return null;
};

const cartView = (ws: string, member: MemberRow): Effect.Effect<CartOut, StoreError | never, ControlStore> =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const cat = yield* loadCatalogue(ws);
    const v = yield* loadViewer(ws, member);
    const ratings = yield* loadRatings(ws);
    const raw = yield* cartRaw(member.id);
    const upd = yield* store(
      sql<{ updated_at: Date }>`SELECT updated_at FROM carts WHERE member_id = ${member.id}`,
    );
    const lines = raw.flatMap((l) => {
      const p = cat.products.get(l.slug);
      if (!p) return [];
      return [
        {
          product: cardOf(p, cat, v, ratings, null),
          qty: l.qty,
          line_points: p.spec.price_points * l.qty,
          issue: lineIssue(cat, p, l.qty, v),
        },
      ];
    });
    return {
      lines,
      item_count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal_points: lines.reduce((s, l) => s + l.line_points, 0),
      balance: v.balance,
      updated_at: upd[0] ? iso(upd[0].updated_at) : null,
    } as CartOut;
  });

const emitCart = (ctx: ActionCtx, member: MemberRow, cart: CartOut) =>
  emitFrom(ctx, "cart.updated", {
    audience: [member.subject],
    member: principalRefOf(member),
    payload: { item_count: cart.item_count, subtotal_points: cart.subtotal_points },
  });

const cartGet: ActionHandler<unknown, CartOut> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const me = yield* selfMember(ctx);
      return yield* cartView(ctx.principal.workspaceId, me);
    }),
};

const cartSet: ActionHandler<Out<typeof SuiteStore.CartSetIn>, CartOut> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const cat = yield* loadCatalogue(ctx.principal.workspaceId);
      const p = yield* needProduct(cat, input.slug);
      return {
        effect:
          input.qty === 0
            ? `Remove ${p.slug} from the cart`
            : `Set ${p.slug} to quantity ${input.qty} in the cart`,
        facts: { product: p.slug, qty: input.qty, price_points: p.spec.price_points },
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const program = yield* loadProgram(ws);
      const cat = yield* loadCatalogue(ws);
      const p = yield* needProduct(cat, input.slug);
      const nowIso = ctx.now.toISOString();
      const cartRow = yield* store(
        sql<{ cart_id: string }>`
          INSERT INTO carts (cart_id, workspace_id, member_id, updated_at) VALUES (${newId()}, ${ws}, ${me.id}, ${nowIso}::timestamptz)
          ON CONFLICT (member_id) DO UPDATE SET updated_at = EXCLUDED.updated_at RETURNING cart_id`,
      );
      const cartId = cartRow[0]?.cart_id as string;
      const pid = productId(ws, p.slug);
      if (input.qty === 0) {
        yield* store(sql`DELETE FROM cart_items WHERE cart_id = ${cartId} AND product_id = ${pid}`);
      } else {
        const v = yield* loadViewer(ws, me);
        if (!isListed(cat, p))
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "NOT_ELIGIBLE", "this product is not on sale", {}, "/slug"),
          );
        const min = p.spec.min_tier;
        if (min && TIER_RANK[min] > TIER_RANK[me.tier as Tier])
          return yield* Effect.fail(
            refuse(
              "RULE_REFUSED",
              "NOT_ELIGIBLE",
              `this product needs tier ${min}`,
              { min_tier: min },
              "/slug",
            ),
          );
        if (input.qty > program.store.max_qty_per_line)
          return yield* Effect.fail(
            refuse(
              "RULE_REFUSED",
              "LIMIT_EXCEEDED",
              "above the quantity limit per line",
              {
                limit: program.store.max_qty_per_line,
                value: input.qty,
              },
              "/qty",
            ),
          );
        const onHand = cat.onHand.get(p.slug) ?? 0;
        if (input.qty > onHand)
          return yield* Effect.fail(
            refuse(
              "CONFLICT",
              "OUT_OF_STOCK",
              "not enough stock",
              { product: p.slug, on_hand: onHand, requested: input.qty },
              "/qty",
            ),
          );
        const lim = p.spec.limit_per_member;
        if (lim !== undefined && (v.purchased.get(p.slug) ?? 0) + input.qty > lim)
          return yield* Effect.fail(
            refuse(
              "RULE_REFUSED",
              "LIMIT_EXCEEDED",
              "above the per-member limit for this product",
              {
                limit: lim,
                value: (v.purchased.get(p.slug) ?? 0) + input.qty,
              },
              "/qty",
            ),
          );
        const has = v.cart.has(p.slug);
        if (!has && v.cart.size >= program.store.max_cart_lines)
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "LIMIT_EXCEEDED", "too many lines in the cart", {
              limit: program.store.max_cart_lines,
              value: v.cart.size + 1,
            }),
          );
        yield* ensureInventory(ws, p.slug, ctx.now);
        yield* store(
          sql`INSERT INTO cart_items (cart_id, product_id, qty, added_at) VALUES (${cartId}, ${pid}, ${input.qty}, ${nowIso}::timestamptz)
              ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = EXCLUDED.qty`,
        );
      }
      const out = yield* cartView(ws, me);
      yield* emitCart(ctx, me, out);
      return out;
    }),
};

const cartClear: ActionHandler<unknown, CartOut> = {
  preview: () => Effect.succeed({ effect: "Empty the cart", facts: {} }),
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      yield* store(
        sql`DELETE FROM cart_items WHERE cart_id IN (SELECT cart_id FROM carts WHERE member_id = ${me.id})`,
      );
      yield* store(
        sql`UPDATE carts SET updated_at = ${ctx.now.toISOString()}::timestamptz WHERE member_id = ${me.id}`,
      );
      const out = yield* cartView(ws, me);
      yield* emitCart(ctx, me, out);
      return out;
    }),
};

// ---- wishlist --------------------------------------------------------------------------------------------

const wishlistList: ActionHandler<unknown, Out<typeof SuiteStore.WishlistOut>> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const cat = yield* loadCatalogue(ws);
      const v = yield* loadViewer(ws, me);
      const ratings = yield* loadRatings(ws);
      const rows = yield* store(
        sql<{ product_slug: string; added_at: Date }>`
          SELECT i.product_slug, w.added_at FROM wishlist_items w JOIN product_inventory i ON i.product_id = w.product_id
          WHERE w.member_id = ${me.id} ORDER BY w.added_at DESC, i.product_slug`,
      );
      return {
        items: rows.flatMap((r) => {
          const p = cat.products.get(r.product_slug);
          return p && p.spec.status !== "draft"
            ? [{ product: cardOf(p, cat, v, ratings, null), added_at: iso(r.added_at) }]
            : [];
        }),
      };
    }),
};

const wishlistSet = (
  on: boolean,
): ActionHandler<Out<typeof SuiteStore.WishlistIn>, Out<typeof SuiteStore.WishlistChangeOut>> => ({
  preview: (input) =>
    Effect.succeed({
      effect: on ? `Add ${input.slug} to the wishlist` : `Remove ${input.slug} from the wishlist`,
      facts: { product: input.slug },
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const cat = yield* loadCatalogue(ws);
      const p = yield* needProduct(cat, input.slug);
      const pid = yield* ensureInventory(ws, p.slug, ctx.now);
      let changed: boolean;
      if (on) {
        const r = yield* store(
          sql<{ product_id: string }>`
            INSERT INTO wishlist_items (workspace_id, member_id, product_id, added_at)
            VALUES (${ws}, ${me.id}, ${pid}, ${ctx.now.toISOString()}::timestamptz) ON CONFLICT DO NOTHING RETURNING product_id`,
        );
        changed = r.length > 0;
      } else {
        const r = yield* store(
          sql<{ product_id: string }>`
            DELETE FROM wishlist_items WHERE member_id = ${me.id} AND product_id = ${pid} RETURNING product_id`,
        );
        changed = r.length > 0;
      }
      if (changed)
        yield* emitFrom(ctx, "wishlist.changed", {
          audience: [me.subject],
          member: principalRefOf(me),
          payload: { product: p.slug, in_wishlist: on },
        });
      return { product: p.slug, in_wishlist: on };
    }),
});

// ---- inventory -------------------------------------------------------------------------------------------

const emitStock = (ctx: EmitCtx, slug: string, onHand: number, threshold: number) =>
  emitFrom(ctx, "stock.changed", {
    audience: ["*"],
    subject: { kind: "product", id: slug },
    payload: { product: slug, on_hand: onHand, stock_status: stockStatusOf(onHand, threshold) },
  });

/** Move stock of one product (inside the caller's transaction), log the movement and announce it. */
const moveStock = (
  ctx: ActionCtx,
  p: ProductNode,
  delta: number,
  reason: "restock" | "damage" | "count_correction" | "return" | "order" | "cancel" | "refund",
  opts: { orderId?: string; note?: string; actorCtx?: EmitCtx } = {},
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const pid = yield* ensureInventory(ws, p.slug, ctx.now);
    const rows = yield* store(
      sql<{ on_hand: number }>`SELECT on_hand FROM product_inventory WHERE product_id = ${pid} FOR UPDATE`,
    );
    const cur = rows[0]?.on_hand ?? 0;
    if (cur + delta < 0)
      return yield* Effect.fail(
        refuse("CONFLICT", "OUT_OF_STOCK", "stock cannot go below zero", {
          product: p.slug,
          on_hand: cur,
          requested: -delta,
        }),
      );
    const next = cur + delta;
    yield* store(
      sql`UPDATE product_inventory SET on_hand = ${next}, updated_at = ${ctx.now.toISOString()}::timestamptz WHERE product_id = ${pid}`,
    );
    if (delta !== 0)
      yield* store(
        sql`INSERT INTO inventory_movements (workspace_id, product_id, delta, on_hand_after, reason, order_id, actor_id, occurred_at, note)
            VALUES (${ws}, ${pid}, ${delta}, ${next}, ${reason}, ${opts.orderId ?? null}, ${(opts.actorCtx ?? ctx).principal.id},
                    ${ctx.now.toISOString()}::timestamptz, ${opts.note ?? null})`,
      );
    yield* emitStock(opts.actorCtx ?? ctx, p.slug, next, p.spec.low_stock_threshold);
    return next;
  });

const sold30 = (ws: string, now: Date) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql<{ product_slug: string; n: string }>`
        SELECT i.product_slug, coalesce(-sum(m.delta) FILTER (WHERE m.reason = 'order'), 0)::text AS n
        FROM inventory_movements m JOIN product_inventory i ON i.product_id = m.product_id
        WHERE m.workspace_id = ${ws} AND m.occurred_at > ${new Date(now.getTime() - 30 * DAY_MS).toISOString()}::timestamptz
          AND m.occurred_at <= ${now.toISOString()}::timestamptz GROUP BY i.product_slug`,
    );
    return new Map(rows.map((r) => [r.product_slug, Number(r.n)] as const));
  });

const inventoryRow = (
  p: ProductNode,
  cat: Catalogue,
  sold: ReadonlyMap<string, number>,
  updated: Date | string,
) => ({
  product: p.slug,
  title: p.title,
  category: catSlug(p),
  on_hand: cat.onHand.get(p.slug) ?? 0,
  low_stock_threshold: p.spec.low_stock_threshold,
  stock_status: stockStatusOf(cat.onHand.get(p.slug) ?? 0, p.spec.low_stock_threshold),
  sold_30d: sold.get(p.slug) ?? 0,
  updated_at: iso(updated),
});

const inventoryList: ActionHandler<
  Out<typeof SuiteStore.InventoryListIn>,
  Out<typeof SuiteStore.InventoryListOut>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const cat = yield* loadCatalogue(ws);
      const sold = yield* sold30(ws, ctx.now);
      const upd = yield* store(
        sql<{ product_slug: string; updated_at: Date }>`
          SELECT product_slug, updated_at FROM product_inventory WHERE workspace_id = ${ws}`,
      );
      const updBy = new Map(upd.map((u) => [u.product_slug, u.updated_at] as const));
      const rows = [...cat.products.values()]
        .filter((p) => p.spec.status !== "draft")
        .map((p) => inventoryRow(p, cat, sold, updBy.get(p.slug) ?? ctx.now))
        .filter((r) => !input.status || r.stock_status === input.status)
        .sort((a, b) => a.title.localeCompare(b.title));
      const limit = pageLimit(input.limit);
      const offset = decodeCursor<{ o: number }>(input.cursor)?.o ?? 0;
      return {
        items: rows.slice(offset, offset + limit),
        next_cursor: offset + limit < rows.length ? encodeCursor({ o: offset + limit }) : null,
      };
    }),
};

const inventoryAdjust: ActionHandler<
  Out<typeof SuiteStore.InventoryAdjustIn>,
  Out<typeof SuiteStore.InventoryRow>
> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const cat0 = yield* loadCatalogue(ws);
      const p = yield* needProduct(cat0, input.slug);
      yield* moveStock(ctx, p, input.delta, input.reason, input.note ? { note: clip(input.note, 280) } : {});
      const cat = yield* loadCatalogue(ws);
      const sold = yield* sold30(ws, ctx.now);
      return inventoryRow(p, cat, sold, ctx.now);
    }),
};

// ---- quote -----------------------------------------------------------------------------------------------

interface QuoteLineSrc {
  readonly slug: string;
  readonly node: ProductNode | undefined;
  readonly qty: number;
}

/**
 * Price the cart (CONTRACT 7.5 up to step 4). `lock` takes `FOR UPDATE` on the promotion usage rows (checkout); a quote
 * reads without locks. Fails `CART_EMPTY` on an empty cart.
 */
const computeQuote = (
  ws: string,
  member: MemberRow,
  now: Date,
  program: ProgramSpec,
  opts: { readonly lock: boolean },
) =>
  Effect.gen(function* () {
    const cat = yield* loadCatalogue(ws);
    const v = yield* loadViewer(ws, member);
    const raw = yield* cartRaw(member.id);
    if (raw.length === 0)
      return yield* Effect.fail(refuse("VALIDATION_FAILED", "CART_EMPTY", "the cart is empty"));
    const src: QuoteLineSrc[] = raw.map((l) => ({
      slug: l.slug,
      node: cat.products.get(l.slug),
      qty: l.qty,
    }));
    const priced = src.filter((l): l is QuoteLineSrc & { node: ProductNode } => l.node !== undefined);
    const mf = yield* memberWithFacts(ws, member.id, now);
    const candidates = yield* loadPromoCandidates(ws, mf, now, { lock: opts.lock });
    const evaluation = evaluatePromos({
      now: now.toISOString() as never,
      mode: "live",
      member: mf.facts,
      context: {
        kind: "purchase",
        channel: "store",
        lines: priced.map((l) => ({
          product: l.slug,
          category: catSlug(l.node),
          qty: l.qty,
          unit_points: l.node.spec.price_points,
        })),
      },
      candidates: [...candidates],
    });
    const t = evaluation.totals;
    const totals =
      t.kind === "purchase"
        ? t
        : {
            kind: "purchase" as const,
            subtotal_points: 0,
            discount_points: 0,
            total_points: 0,
            bonus_points: 0,
            free_items: [],
          };
    const discountByLine = new Map<number, number>();
    for (const a of evaluation.applied)
      for (const e of a.effects)
        if (e.type === "store_discount")
          for (const l of e.lines ?? [])
            discountByLine.set(l.line, (discountByLine.get(l.line) ?? 0) + l.points);
    const lines: Array<Out<typeof SuiteStore.QuoteLine>> = priced.map((l, i) => {
      const d = discountByLine.get(i) ?? 0;
      return {
        line: i,
        product: l.slug,
        title: l.node.title,
        qty: l.qty,
        unit_points: l.node.spec.price_points,
        discount_points: d,
        line_points: l.node.spec.price_points * l.qty - d,
        cash_cents: (l.node.spec.cash_price_cents ?? 0) * l.qty,
        free_item: false,
      };
    });
    for (const f of totals.free_items) {
      const slug = f.product.replace(/^product:/, "");
      lines.push({
        line: lines.length,
        product: slug,
        title: cat.products.get(slug)?.title ?? slug,
        qty: 1,
        unit_points: f.unit_points,
        discount_points: f.unit_points,
        line_points: 0,
        cash_cents: 0,
        free_item: true,
      });
    }
    const cash = lines.reduce((s, l) => s + l.cash_cents, 0);
    const requiresApproval = totals.total_points >= program.store.high_value_threshold_points;
    const blocking = src.flatMap((l, i) => {
      const issue = lineIssue(cat, l.node, l.qty, v);
      return issue ? [{ line: i, issue }] : [];
    });
    const quote: QuoteOut = {
      lines,
      subtotal_points: totals.subtotal_points,
      discount_points: totals.discount_points,
      total_points: totals.total_points,
      bonus_points: totals.bonus_points,
      cash_cents: cash,
      balance: v.balance,
      balance_after: v.balance - totals.total_points,
      requires_approval: requiresApproval,
      evaluation,
      quote_hash: quoteHashOf({
        lines,
        total_points: totals.total_points,
        cash_cents: cash,
        applied: evaluation.applied,
      }),
      blocking,
    };
    return { quote, cat, src, evaluation };
  });

const quoteHandler: ActionHandler<unknown, QuoteOut> = {
  run: (_i, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const program = yield* loadProgram(ws);
      return (yield* computeQuote(ws, me, ctx.now, program, { lock: false })).quote;
    }),
};

// ---- orders: loading and views -----------------------------------------------------------------------------

interface OrderRow {
  order_id: string;
  order_no: string;
  member_id: string;
  handle: string;
  subject: string;
  department: string;
  region: string;
  tier: string;
  status: OrderStatus;
  requires_approval: boolean;
  subtotal_points: string;
  discount_points: string;
  total_points: string;
  bonus_points: string;
  cash_cents: string;
  promotions: unknown;
  delivery: { method: string } & Record<string, unknown>;
  notes: string | null;
  ledger_txn_id: string | null;
  refund_txn_id: string | null;
  bonus_txn_id: string | null;
  placed_at: Date;
  updated_at: Date;
}

const ORDER_SELECT = `
  SELECT o.order_id, o.order_no, o.member_id, m.handle, p.subject, m.department, o.region, o.tier, o.status,
         o.requires_approval, o.subtotal_points::text AS subtotal_points, o.discount_points::text AS discount_points,
         o.total_points::text AS total_points, o.bonus_points::text AS bonus_points, o.cash_cents::text AS cash_cents,
         o.promotions, o.delivery, o.notes, o.ledger_txn_id, o.refund_txn_id, o.bonus_txn_id, o.placed_at, o.updated_at
  FROM store_orders o JOIN members m ON m.member_id = o.member_id JOIN principals p ON p.principal_id = o.member_id`;

const loadOrder = (ws: string, orderId: string, lock = false) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const rows = yield* store(
      sql.unsafe<OrderRow>(
        `${ORDER_SELECT} WHERE o.workspace_id = $1 AND o.order_id = $2${lock ? " FOR UPDATE OF o" : ""}`,
        [ws, orderId],
      ),
    );
    const o = rows[0];
    if (!o) return yield* Effect.fail(unknownRef("/order_id", `no order '${orderId}'`));
    return o;
  });

const orderFacts = (o: OrderRow) => ({
  handle: o.handle,
  region: o.region,
  tier: o.tier,
  department: o.department,
});

type Dec = { kind: "allow"; rowPredicate: string | null } | { kind: "deny" };
interface Perms {
  readonly me: MemberRow;
  readonly orders: Dec;
  readonly approve: Dec;
  readonly refund: Dec;
  readonly agent: boolean;
}

const loadPerms = (ctx: ActionCtx) =>
  Effect.gen(function* () {
    const me = yield* selfMember(ctx);
    const who = ctx.approvedBy ?? ctx.principal;
    const orders = yield* decideFor(ctx, who, "store:orders", STORE);
    const approve = yield* decideFor(ctx, who, "store:approve", STORE);
    const refund = yield* decideFor(ctx, who, "store:refund", STORE);
    return { me, orders, approve, refund, agent: ctx.principal.kind === "agent" } as Perms;
  });

const reaches = (d: Dec, facts: ReturnType<typeof orderFacts>): boolean =>
  d.kind === "allow" && evalRowPredicate(d.rowPredicate, { ...facts });

/** The transitions the state machine allows from a state, ignoring who asks. */
const stateAllows = (o: Pick<OrderRow, "status" | "requires_approval" | "delivery">): Transition[] => {
  const ship = String(o.delivery.method) === "ship";
  switch (o.status) {
    case "placed":
      return o.requires_approval ? ["approve", "cancel"] : ["cancel"];
    case "approved":
      return ["fulfil", "cancel"];
    case "fulfilled":
      return ship ? ["ship"] : ["deliver"];
    case "shipped":
      return ["deliver", "refund"];
    case "delivered":
      return ["refund"];
    default:
      return [];
  }
};

const targetOf: Record<Transition, OrderStatus> = {
  approve: "approved",
  fulfil: "fulfilled",
  ship: "shipped",
  deliver: "delivered",
  cancel: "cancelled",
  refund: "refunded",
};

const cancelDeadline = (o: OrderRow, program: ProgramSpec): Date | null =>
  o.status === "placed" || o.status === "approved"
    ? new Date(new Date(o.placed_at).getTime() + program.store.cancel_window_minutes * 60_000)
    : null;

/** Transitions the viewer may perform now. */
const allowedFor = (o: OrderRow, p: Perms, program: ProgramSpec, now: Date): Transition[] => {
  const facts = orderFacts(o);
  const owner = o.member_id === p.me.id;
  const staff = reaches(p.orders, facts);
  const deadline = cancelDeadline(o, program);
  return stateAllows(o).filter((t) => {
    switch (t) {
      case "approve":
        return !owner && reaches(p.approve, facts);
      case "fulfil":
      case "ship":
      case "deliver":
        return staff;
      case "cancel":
        return (
          (owner && deadline !== null && now.getTime() <= deadline.getTime()) ||
          staff ||
          (o.status === "placed" && o.requires_approval && !owner && reaches(p.approve, facts))
        );
      case "refund":
        return reaches(p.refund, facts) || (p.agent && staff);
    }
  });
};

const artworkOf = (cat: Catalogue, slug: string): Artwork =>
  cat.products.get(slug)?.spec.artwork ?? DEFAULT_ART;

const summaries = (ws: string, rows: ReadonlyArray<OrderRow>, cat: Catalogue) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ids = rows.map((r) => r.order_id);
    const items =
      ids.length === 0
        ? []
        : yield* store(
            sql<{ order_id: string; line: number; product_slug: string; title: string; qty: number }>`
              SELECT order_id, line, product_slug, title, qty FROM store_order_items WHERE order_id IN ${sql.in(ids)}
              ORDER BY order_id, line`,
          );
    const refs = yield* personRefs(
      ws,
      rows.map((r) => r.member_id),
    );
    return rows.map((o) => {
      const mine = items.filter((i) => i.order_id === o.order_id);
      const first = mine[0];
      return {
        order_id: o.order_id,
        order_no: o.order_no,
        member: needRef(refs, o.member_id),
        region: o.region,
        status: o.status,
        requires_approval: o.requires_approval,
        item_count: mine.reduce((s, i) => s + i.qty, 0),
        total_points: Number(o.total_points),
        cash_cents: Number(o.cash_cents),
        placed_at: iso(o.placed_at),
        updated_at: iso(o.updated_at),
        first_item: {
          title: first?.title ?? "",
          artwork: first ? artworkOf(cat, first.product_slug) : DEFAULT_ART,
        },
      } as Out<typeof SuiteStore.OrderSummary>;
    });
  });

const orderDetail = (ctx: ActionCtx, o: OrderRow, perms: Perms) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.principal.workspaceId;
    const program = yield* loadProgram(ws);
    const cat = yield* loadCatalogue(ws);
    const items = yield* store(
      sql<{
        line: number;
        product_slug: string;
        title: string;
        qty: number;
        unit_points: string;
        discount_points: string;
        line_points: string;
        cash_cents: string;
        free_item: boolean;
      }>`
        SELECT line, product_slug, title, qty, unit_points::text AS unit_points, discount_points::text AS discount_points,
               line_points::text AS line_points, cash_cents::text AS cash_cents, free_item
        FROM store_order_items WHERE order_id = ${o.order_id} ORDER BY line`,
    );
    const events = yield* store(
      sql<{
        seq: number;
        from_status: OrderStatus | null;
        to_status: OrderStatus;
        actor_id: string;
        occurred_at: Date;
        note: string | null;
      }>`
        SELECT seq, from_status, to_status, actor_id, occurred_at, note FROM store_order_events
        WHERE order_id = ${o.order_id} ORDER BY seq`,
    );
    const refs = yield* personRefs(ws, [o.member_id, ...events.map((e) => e.actor_id)]);
    const [summary] = yield* summaries(ws, [o], cat);
    const deadline = cancelDeadline(o, program);
    return {
      ...(summary as Out<typeof SuiteStore.OrderSummary>),
      items: items.map((i) => ({
        line: i.line,
        product: i.product_slug,
        title: i.title,
        artwork: artworkOf(cat, i.product_slug),
        qty: i.qty,
        unit_points: Number(i.unit_points),
        discount_points: Number(i.discount_points),
        line_points: Number(i.line_points),
        cash_cents: Number(i.cash_cents),
        free_item: i.free_item,
      })),
      subtotal_points: Number(o.subtotal_points),
      discount_points: Number(o.discount_points),
      bonus_points: Number(o.bonus_points),
      promotions: o.promotions as OrderDetail["promotions"],
      delivery: o.delivery as OrderDetail["delivery"],
      notes: o.notes,
      events: events.map((e) => ({
        seq: e.seq,
        from: e.from_status,
        to: e.to_status,
        actor: needRef(refs, e.actor_id),
        at: iso(e.occurred_at),
        note: e.note,
      })),
      ledger_txn_id: o.ledger_txn_id,
      refund_txn_id: o.refund_txn_id,
      bonus_txn_id: o.bonus_txn_id,
      allowed_transitions: allowedFor(o, perms, program, ctx.now),
      cancel_deadline: deadline ? deadline.toISOString() : null,
    } as OrderDetail;
  });

/** May the caller see this order? The owner, or staff whose grant reaches the member. */
const mayView = (o: OrderRow, p: Perms): boolean =>
  o.member_id === p.me.id || reaches(p.orders, orderFacts(o)) || reaches(p.approve, orderFacts(o));

// ---- checkout --------------------------------------------------------------------------------------------

const serviceStoreCtx = (ctx: ActionCtx): EmitCtx => ({
  principal: {
    id: principalId(ctx.principal.workspaceId, "service:store"),
    subject: "service:store",
    workspaceId: ctx.principal.workspaceId,
  },
  surface: ctx.surface,
  sessionId: ctx.sessionId,
  now: ctx.now,
});

const STATUS_NOTE: Record<OrderStatus, string> = {
  placed: "was placed",
  approved: "was approved",
  fulfilled: "is being prepared",
  shipped: "is on its way",
  delivered: "was delivered",
  cancelled: "was cancelled",
  refunded: "was refunded",
};

/** Move an order to a new status: row, timeline, `order.status_changed` and the member's `order_status` notification. */
const appendStatus = (
  emit: EmitCtx,
  o: OrderRow,
  to: OrderStatus,
  note: string | null,
  behalfId: string | null,
) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    yield* store(
      sql`UPDATE store_orders SET status = ${to}, updated_at = ${emit.now.toISOString()}::timestamptz, version = version + 1
          WHERE order_id = ${o.order_id}`,
    );
    const seqRow = yield* store(
      sql<{
        n: number;
      }>`SELECT coalesce(max(seq), 0) + 1 AS n FROM store_order_events WHERE order_id = ${o.order_id}`,
    );
    yield* store(
      sql`INSERT INTO store_order_events (order_id, seq, from_status, to_status, actor_id, on_behalf_of, occurred_at, note)
          VALUES (${o.order_id}, ${seqRow[0]?.n ?? 1}, ${o.status}, ${to}, ${emit.principal.id}, ${behalfId},
                  ${emit.now.toISOString()}::timestamptz, ${note})`,
    );
    const seq = yield* emitFrom(emit, "order.status_changed", {
      audience: [o.subject, "role:manager", "role:admin"],
      subject: { kind: "order", id: o.order_id },
      member: { id: o.member_id, subject: o.subject },
      payload: { order_id: o.order_id, order_no: o.order_no, member: o.handle, from: o.status, to, note },
    });
    yield* createNotifications(emit, {
      recipients: [{ id: o.member_id, subject: o.subject }],
      type: "order_status",
      title: `Order ${o.order_no} ${STATUS_NOTE[to]}`,
      body: note ? clip(note, 500) : `Your order ${o.order_no} ${STATUS_NOTE[to]}.`,
      link: `/store/orders/${o.order_id}`,
      actorId: emit.principal.id,
      subject: { kind: "order", id: o.order_id },
      sourceEventSeq: seq,
      dedupeKey: `${seq}:order_status`,
    });
    return seq;
  });

const checkDelivery = (d: Out<typeof SuiteStore.Delivery>) =>
  d.method === "ship" && !d.address
    ? Effect.fail(
        refuse(
          "VALIDATION_FAILED",
          "VALIDATION_FAILED",
          "a shipped order needs a delivery address",
          {},
          "/delivery/address",
        ),
      )
    : Effect.void;

const lockAccounts = (ws: string, codes: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ids = [...new Set(codes.map((c) => accountId(ws, c)))].sort();
    yield* store(
      sql`SELECT account_id FROM ledger_accounts WHERE account_id IN ${sql.in(ids)} ORDER BY account_id FOR UPDATE`,
    );
  });

const lockInventory = (ws: string, slugs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ids = [...new Set(slugs.map((s) => productId(ws, s)))].sort();
    if (ids.length === 0) return new Map<string, number>();
    const rows = yield* store(
      sql<{ product_slug: string; on_hand: number }>`
        SELECT product_slug, on_hand FROM product_inventory WHERE product_id IN ${sql.in(ids)} ORDER BY product_id FOR UPDATE`,
    );
    return new Map(rows.map((r) => [r.product_slug, r.on_hand] as const));
  });

const checkoutPreview = (ctx: ActionCtx) =>
  Effect.gen(function* () {
    const ws = ctx.principal.workspaceId;
    const me = yield* selfMember(ctx);
    const program = yield* loadProgram(ws);
    const q = (yield* computeQuote(ws, me, ctx.now, program, { lock: false })).quote;
    return {
      effect: `Place an order of ${q.total_points} points`,
      facts: {
        total_points: q.total_points,
        subtotal_points: q.subtotal_points,
        discount_points: q.discount_points,
        balance_after: q.balance_after,
        requires_approval: q.requires_approval,
        lines: q.lines.length,
        blocking: q.blocking.length,
      },
      decision: "approval" as const,
      approverPermission: "store:approve",
    };
  });

const checkoutPlace: ActionHandler<Out<typeof SuiteStore.CheckoutIn>, OrderDetail> = {
  preview: (_i, ctx) => checkoutPreview(ctx),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const me = yield* selfMember(ctx);
      const program = yield* loadProgram(ws);
      yield* checkDelivery(input.delivery);

      // 1. lock the cart row and validate its lines
      const cart = yield* store(
        sql<{ cart_id: string }>`SELECT cart_id FROM carts WHERE member_id = ${me.id} FOR UPDATE`,
      );
      if (!cart[0]) return yield* Effect.fail(refuse("VALIDATION_FAILED", "CART_EMPTY", "the cart is empty"));
      const raw = yield* cartRaw(me.id);
      if (raw.length === 0)
        return yield* Effect.fail(refuse("VALIDATION_FAILED", "CART_EMPTY", "the cart is empty"));
      if (raw.length > program.store.max_cart_lines)
        return yield* Effect.fail(
          refuse("RULE_REFUSED", "LIMIT_EXCEEDED", "too many lines in the cart", {
            limit: program.store.max_cart_lines,
            value: raw.length,
          }),
        );
      const cat0 = yield* loadCatalogue(ws);
      const v0 = yield* loadViewer(ws, me);
      for (const l of raw) {
        const p = cat0.products.get(l.slug);
        if (l.qty > program.store.max_qty_per_line)
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "LIMIT_EXCEEDED", "above the quantity limit per line", {
              limit: program.store.max_qty_per_line,
              value: l.qty,
            }),
          );
        if (!p || !isListed(cat0, p))
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "NOT_ELIGIBLE", `${l.slug} is no longer on sale`, { product: l.slug }),
          );
        const min = p.spec.min_tier;
        if (min && TIER_RANK[min] > TIER_RANK[me.tier as Tier])
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "NOT_ELIGIBLE", `${l.slug} needs tier ${min}`, {
              product: l.slug,
              min_tier: min,
            }),
          );
        const lim = p.spec.limit_per_member;
        if (lim !== undefined && (v0.purchased.get(l.slug) ?? 0) + l.qty > lim)
          return yield* Effect.fail(
            refuse("RULE_REFUSED", "LIMIT_EXCEEDED", `above the per-member limit for ${l.slug}`, {
              limit: lim,
              value: (v0.purchased.get(l.slug) ?? 0) + l.qty,
              product: l.slug,
            }),
          );
      }

      // 2. locks: accounts, then inventory rows; promotion usage rows are locked by the evaluation below
      yield* lockAccounts(ws, [memberCode(me.handle), systemCode("redemption"), systemCode("promotions")]);
      yield* lockInventory(
        ws,
        raw.map((l) => l.slug),
      );

      // 3 and 4. evaluate against the locked usage and compare the hash
      const q = yield* computeQuote(ws, me, ctx.now, program, { lock: true });
      if (q.quote.quote_hash !== input.quote_hash) {
        const budget = q.evaluation.rejected.find((r) => r.reason === "budget");
        return yield* Effect.fail(
          budget
            ? refuse("CONFLICT", "BUDGET_EXHAUSTED", "a promotion in your quote has no budget left", {
                promotion: budget.slug,
                quote: q.quote,
              })
            : refuse("CONFLICT", "PRICE_CHANGED", "the price changed since your quote", { quote: q.quote }),
        );
      }
      const quote = q.quote;

      // 5. stock including free items, then points
      const demand = new Map<string, number>();
      for (const l of quote.lines) demand.set(l.product, (demand.get(l.product) ?? 0) + l.qty);
      const onHand = yield* lockInventory(ws, [...demand.keys()]);
      for (const [slug, want] of demand) {
        const have = onHand.get(slug) ?? 0;
        if (want > have)
          return yield* Effect.fail(
            refuse("CONFLICT", "OUT_OF_STOCK", `not enough stock of ${slug}`, {
              product: slug,
              on_hand: have,
              requested: want,
            }),
          );
      }
      const balance = yield* memberBalance(ws, me.handle);
      if (quote.total_points > balance)
        return yield* Effect.fail(
          refuse("CONFLICT", "INSUFFICIENT_POINTS", "not enough points", {
            balance,
            required: quote.total_points,
          }),
        );

      // 6 and 7. order number, the purchase posting (the order row needs its transaction id), the order and its lines
      const orderId = newId();
      const no = orderNo(yield* nextCounter(ws, "order"));
      const purchase =
        quote.total_points > 0
          ? yield* postPurchase(ctx, {
              handle: me.handle,
              total: quote.total_points,
              memo: `Order ${no}`,
              key: `order:${orderId}`,
              orderId,
            })
          : undefined;
      const nowIso = ctx.now.toISOString();
      yield* store(
        sql`INSERT INTO store_orders (order_id, workspace_id, order_no, member_id, region, tier, status, requires_approval,
                                       subtotal_points, discount_points, total_points, bonus_points, cash_cents, promotions,
                                       delivery, notes, quote_hash, ledger_txn_id, placed_at, updated_at)
            VALUES (${orderId}, ${ws}, ${no}, ${me.id}, ${me.region}, ${me.tier}, 'placed', ${quote.requires_approval},
                    ${quote.subtotal_points}, ${quote.discount_points}, ${quote.total_points}, ${quote.bonus_points},
                    ${quote.cash_cents}, ${JSON.stringify(quote.evaluation.applied)}::jsonb, ${JSON.stringify(input.delivery)}::jsonb,
                    ${input.notes ?? null}, ${Buffer.from(quote.quote_hash, "hex")}, ${purchase?.txn_id ?? null},
                    ${nowIso}::timestamptz, ${nowIso}::timestamptz)`,
      );
      for (const l of quote.lines) {
        const p = q.cat.products.get(l.product);
        yield* store(
          sql`INSERT INTO store_order_items (order_id, line, product_id, product_slug, title, category_slug, qty, unit_points,
                                              discount_points, line_points, cash_cents, free_item)
              VALUES (${orderId}, ${l.line}, ${productId(ws, l.product)}, ${l.product}, ${l.title}, ${p ? catSlug(p) : "unknown"},
                      ${l.qty}, ${l.unit_points}, ${l.discount_points}, ${l.line_points}, ${l.cash_cents}, ${l.free_item})`,
        );
      }
      yield* store(
        sql`INSERT INTO store_order_events (order_id, seq, from_status, to_status, actor_id, on_behalf_of, occurred_at, note)
            VALUES (${orderId}, 1, NULL, 'placed', ${ctx.principal.id}, ${ctx.onBehalfOf?.id ?? null}, ${nowIso}::timestamptz, NULL)`,
      );

      // 8. inventory
      for (const [slug, qty] of demand) {
        const p = q.cat.products.get(slug);
        if (p) yield* moveStock(ctx, p, -qty, "order", { orderId });
      }

      // 9. promotion redemptions and budget alerts
      if (quote.evaluation.applied.length > 0)
        yield* chargePromotions(ctx, {
          member: me,
          evaluation: quote.evaluation,
          context: "purchase",
          ref: { kind: "order", id: orderId },
        });

      // events and the approval request or the automatic approval
      const placed = yield* loadOrder(ws, orderId);
      yield* emitFrom(ctx, "order.placed", {
        audience: [me.subject, "role:manager", "role:admin"],
        subject: { kind: "order", id: orderId },
        member: principalRefOf(me),
        payload: {
          order_id: orderId,
          order_no: no,
          member: needRef(yield* personRefs(ws, [me.id]), me.id),
          total_points: quote.total_points,
          item_count: quote.lines.reduce((s, l) => s + l.qty, 0),
          requires_approval: quote.requires_approval,
        },
      });
      if (quote.requires_approval) {
        const approvers = yield* approversFor(ws, ctx.principal.workspaceSlug, "store:approve", [
          me.id,
          ...(ctx.onBehalfOf ? [ctx.onBehalfOf.id] : []),
        ]);
        const seq = yield* emitFrom(ctx, "approval.requested", {
          audience: approvers.length > 0 ? approvers.map((a) => a.subject) : ["role:manager", "role:finance"],
          subject: { kind: "order", id: orderId },
          member: principalRefOf(me),
          payload: {
            approval_type: "order",
            id: orderId,
            title: `Order ${no} needs approval`,
            requested_by: me.subject,
          },
        });
        yield* createNotifications(ctx, {
          recipients: approvers,
          type: "approval_request",
          title: "Order needs approval",
          body: `Order ${no} of ${quote.total_points} points is waiting for approval.`,
          link: "/store/manage",
          actorId: me.id,
          subject: { kind: "order", id: orderId },
          sourceEventSeq: seq,
          dedupeKey: `${seq}:approval_request`,
        });
        yield* createNotifications(ctx, {
          recipients: [principalRefOf(me)],
          type: "order_status",
          title: `Order ${no} was placed`,
          body: `Order ${no} is waiting for approval.`,
          link: `/store/orders/${orderId}`,
          actorId: me.id,
          subject: { kind: "order", id: orderId },
          sourceEventSeq: seq,
          dedupeKey: `${seq}:order_status:placed`,
        });
      } else {
        yield* appendStatus(serviceStoreCtx(ctx), placed, "approved", null, null);
      }

      // 11. clear the cart
      yield* store(sql`DELETE FROM cart_items WHERE cart_id = ${cart[0].cart_id}`);
      yield* store(
        sql`UPDATE carts SET updated_at = ${nowIso}::timestamptz WHERE cart_id = ${cart[0].cart_id}`,
      );
      yield* emitFrom(ctx, "cart.updated", {
        audience: [me.subject],
        member: principalRefOf(me),
        payload: { item_count: 0, subtotal_points: 0 },
      });
      const perms = yield* loadPerms(ctx);
      return yield* orderDetail(ctx, yield* loadOrder(ws, orderId), perms);
    }),
};

// ---- orders: list, get, transition -------------------------------------------------------------------------

const ordersList: ActionHandler<Out<typeof SuiteStore.OrdersListIn>, Out<typeof SuiteStore.OrdersListOut>> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const perms = yield* loadPerms(ctx);
      const all = input.scope === "all";
      if (all && perms.orders.kind !== "allow" && perms.approve.kind !== "allow")
        return yield* Effect.fail(forbiddenPerm("store:orders"));
      const params: unknown[] = [ws];
      let where = "o.workspace_id = $1";
      if (!all) {
        params.push(perms.me.id);
        where += ` AND o.member_id = $${params.length}`;
      }
      if (input.member) {
        params.push(input.member);
        where += ` AND m.handle = $${params.length}`;
      }
      if (input.requires_approval !== undefined) {
        params.push(input.requires_approval);
        where += ` AND o.requires_approval = $${params.length}`;
      }
      if (input.q && input.q.trim() !== "") {
        params.push(
          `%${input.q
            .trim()
            .toLowerCase()
            .replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
        );
        const n = params.length;
        where += ` AND (lower(o.order_no) LIKE $${n} OR lower(m.handle) LIKE $${n} OR lower(p.display_name) LIKE $${n}
                       OR EXISTS (SELECT 1 FROM store_order_items i WHERE i.order_id = o.order_id AND lower(i.title) LIKE $${n}))`;
      }
      const rows = yield* store(
        sql.unsafe<OrderRow>(
          `${ORDER_SELECT} WHERE ${where} ORDER BY o.placed_at DESC, o.order_id DESC`,
          params,
        ),
      );
      // the row predicate of the grant filters whole-scope listings
      const scoped = all
        ? rows.filter((o) => reaches(perms.orders, orderFacts(o)) || reaches(perms.approve, orderFacts(o)))
        : rows;
      const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
      for (const o of scoped) counts[o.status] += 1;
      const wanted = input.status && input.status.length > 0 ? new Set<string>(input.status) : undefined;
      const filtered = wanted ? scoped.filter((o) => wanted.has(o.status)) : scoped;
      const limit = pageLimit(input.limit);
      const cur = decodeCursor<{ i: number }>(input.cursor)?.i ?? 0;
      const page = filtered.slice(cur, cur + limit);
      const cat = yield* loadCatalogue(ws);
      return {
        items: yield* summaries(ws, page, cat),
        next_cursor: cur + limit < filtered.length ? encodeCursor({ i: cur + limit }) : null,
        status_counts: counts,
      } as Out<typeof SuiteStore.OrdersListOut>;
    }),
};

const ordersGet: ActionHandler<Out<typeof SuiteStore.OrderIn>, OrderDetail> = {
  run: (input, ctx) =>
    Effect.gen(function* () {
      const ws = ctx.principal.workspaceId;
      const perms = yield* loadPerms(ctx);
      const o = yield* loadOrder(ws, input.order_id);
      // an order of someone else is never confirmed to exist
      if (!mayView(o, perms))
        return yield* Effect.fail(unknownRef("/order_id", `no order '${input.order_id}'`));
      return yield* orderDetail(ctx, o, perms);
    }),
};

const refundNeedsApproval = (ctx: ActionCtx, t: Transition) =>
  t === "refund" && ctx.principal.kind === "agent" && ctx.approvalId === undefined;

const transitionHandler: ActionHandler<Out<typeof SuiteStore.OrderTransitionIn>, OrderDetail> = {
  preview: (input, ctx) =>
    Effect.gen(function* () {
      const o = yield* loadOrder(ctx.principal.workspaceId, input.order_id);
      const held = refundNeedsApproval(ctx, input.transition);
      return {
        effect: `${input.transition} order ${o.order_no}`,
        facts: {
          order: o.order_no,
          from: o.status,
          to: targetOf[input.transition],
          allowed_by_state: stateAllows(o).includes(input.transition),
          total_points: Number(o.total_points),
        },
        ...(held ? { decision: "approval" as const, approverPermission: "store:refund" } : {}),
      };
    }),
  run: (input, ctx) =>
    Effect.gen(function* () {
      const { sql } = yield* ControlStore;
      const ws = ctx.principal.workspaceId;
      const t = input.transition;
      const perms = yield* loadPerms(ctx);
      const program = yield* loadProgram(ws);
      const o = yield* loadOrder(ws, input.order_id, true);
      const facts = orderFacts(o);
      const owner = o.member_id === perms.me.id;
      // a member never learns about the orders of others
      if (!mayView(o, perms))
        return yield* Effect.fail(unknownRef("/order_id", `no order '${input.order_id}'`));

      const need = (d: Dec, perm: string) =>
        d.kind !== "allow"
          ? Effect.fail(forbiddenPerm(perm))
          : reaches(d, facts)
            ? Effect.void
            : Effect.fail(forbiddenRow());
      switch (t) {
        case "approve":
          yield* need(perms.approve, "store:approve");
          if (owner)
            return yield* Effect.fail(
              refuse("RULE_REFUSED", "SELF_ACTION", "you cannot approve your own order"),
            );
          break;
        case "fulfil":
        case "ship":
        case "deliver":
          yield* need(perms.orders, "store:orders");
          break;
        case "cancel": {
          const deadline = cancelDeadline(o, program);
          const withinWindow = owner && deadline !== null && ctx.now.getTime() <= deadline.getTime();
          const staff = reaches(perms.orders, facts);
          const approver =
            o.status === "placed" && o.requires_approval && !owner && reaches(perms.approve, facts);
          if (!withinWindow && !staff && !approver) {
            if (owner && stateAllows(o).includes("cancel"))
              return yield* Effect.fail(
                refuse("RULE_REFUSED", "NOT_ELIGIBLE", "the cancellation window of this order has passed", {
                  cancel_deadline: deadline?.toISOString() ?? null,
                }),
              );
            return yield* Effect.fail(forbiddenPerm("store:orders"));
          }
          break;
        }
        case "refund":
          if (!ctx.approvedBy && !refundNeedsApproval(ctx, t)) yield* need(perms.refund, "store:refund");
          break;
      }

      // the state machine
      const allowed = stateAllows(o);
      if (!allowed.includes(t))
        return yield* Effect.fail(
          refuse("CONFLICT", "INVALID_TRANSITION", `cannot ${t} an order that is ${o.status}`, {
            from: o.status,
            to: targetOf[t],
            allowed,
          }),
        );
      if (refundNeedsApproval(ctx, t))
        return fileForApproval(
          "store:refund",
          `Refund order ${o.order_no} of ${o.total_points} points to ${o.handle}`,
        );

      const note = input.note ? clip(input.note, 280) : null;
      const behalf = ctx.onBehalfOf?.id ?? null;
      const cat = yield* loadCatalogue(ws);
      const restock = (reason: "cancel" | "refund") =>
        Effect.gen(function* () {
          const items = yield* store(
            sql<{ product_slug: string; qty: number }>`
              SELECT product_slug, sum(qty)::int AS qty FROM store_order_items WHERE order_id = ${o.order_id}
              GROUP BY product_slug ORDER BY product_slug`,
          );
          for (const i of items) {
            const p = cat.products.get(i.product_slug);
            if (p) yield* moveStock(ctx, p, i.qty, reason, { orderId: o.order_id });
          }
        });

      if (t === "approve") {
        yield* appendStatus(ctx, o, "approved", note, behalf);
        yield* emitFrom(ctx, "approval.decided", {
          audience: [o.subject, "role:manager", "role:finance"],
          subject: { kind: "order", id: o.order_id },
          member: { id: o.member_id, subject: o.subject },
          payload: {
            approval_type: "order",
            id: o.order_id,
            decision: "approve",
            by: ctx.principal.subject,
            status: "approved",
          },
        });
      } else if (t === "fulfil" || t === "ship") {
        yield* appendStatus(ctx, o, t === "fulfil" ? "fulfilled" : "shipped", note, behalf);
      } else if (t === "deliver") {
        yield* appendStatus(ctx, o, "delivered", note, behalf);
        const bonus = Number(o.bonus_points);
        if (bonus > 0 && o.bonus_txn_id === null) {
          const b = yield* postPromotionBonus(ctx, {
            handle: o.handle,
            points: bonus,
            memo: `Order ${o.order_no} bonus`,
            key: `order-bonus:${o.order_id}`,
            ref: { kind: "order", id: o.order_id },
          });
          yield* store(
            sql`UPDATE store_orders SET bonus_txn_id = ${b.txn_id} WHERE order_id = ${o.order_id}`,
          );
          if (!b.replayed)
            yield* createNotifications(ctx, {
              recipients: [{ id: o.member_id, subject: o.subject }],
              type: "points_awarded",
              title: `You received ${bonus} bonus points`,
              body: `Promotion bonus for order ${o.order_no}.`,
              link: "/points",
              actorId: ctx.principal.id,
              subject: { kind: "txn", id: b.txn_id },
              sourceEventSeq: b.event_seq,
              dedupeKey: `${b.event_seq}:points_awarded:bonus`,
            });
        }
      } else if (t === "cancel") {
        if (o.ledger_txn_id) {
          const r = yield* postRefund(ctx, {
            handle: o.handle,
            total: Number(o.total_points),
            memo: `Order ${o.order_no} cancelled`,
            key: `refund:${o.order_id}`,
            orderId: o.order_id,
            purchaseTxnId: o.ledger_txn_id,
          });
          yield* store(
            sql`UPDATE store_orders SET refund_txn_id = ${r.txn_id} WHERE order_id = ${o.order_id}`,
          );
        }
        if (input.restock !== false) yield* restock("cancel");
        const rev = yield* store(
          sql<{ promotion_id: string; cost: string }>`
            UPDATE promotion_redemptions SET reversed_at = ${ctx.now.toISOString()}::timestamptz
            WHERE ref_kind = 'order' AND ref_id = ${o.order_id} AND reversed_at IS NULL
            RETURNING promotion_id, cost_points::text AS cost`,
        );
        const byPromo = new Map<string, number>();
        for (const r of rev) byPromo.set(r.promotion_id, (byPromo.get(r.promotion_id) ?? 0) + Number(r.cost));
        for (const [pid, cost] of [...byPromo].sort((a, b) => a[0].localeCompare(b[0])))
          yield* store(
            sql`UPDATE promotion_usage SET cost_points = greatest(0, cost_points - ${cost}), redemptions = greatest(0, redemptions - 1)
                WHERE promotion_id = ${pid}`,
          );
        yield* appendStatus(ctx, o, "cancelled", note, behalf);
        if (o.status === "placed" && o.requires_approval && !owner)
          yield* emitFrom(ctx, "approval.decided", {
            audience: [o.subject, "role:manager", "role:finance"],
            subject: { kind: "order", id: o.order_id },
            member: { id: o.member_id, subject: o.subject },
            payload: {
              approval_type: "order",
              id: o.order_id,
              decision: "reject",
              by: ctx.principal.subject,
              status: "rejected",
            },
          });
      } else {
        // refund of a shipped or delivered order
        if (o.ledger_txn_id) {
          const r = yield* postRefund(ctx, {
            handle: o.handle,
            total: Number(o.total_points),
            memo: `Order ${o.order_no} refunded`,
            key: `refund:${o.order_id}`,
            orderId: o.order_id,
            purchaseTxnId: o.ledger_txn_id,
          });
          yield* store(
            sql`UPDATE store_orders SET refund_txn_id = ${r.txn_id} WHERE order_id = ${o.order_id}`,
          );
        }
        if (input.restock === true) yield* restock("refund");
        if (o.bonus_txn_id !== null && Number(o.bonus_points) > 0) {
          const bal = yield* memberBalance(ws, o.handle);
          const back = Math.min(Number(o.bonus_points), bal);
          if (back > 0)
            yield* postAdjustment(ctx, {
              handle: o.handle,
              delta: -back,
              memo: `Order ${o.order_no} bonus reversed on refund`,
              key: `refund-bonus:${o.order_id}`,
              ref: { kind: "order", id: o.order_id },
            });
        }
        yield* appendStatus(ctx, o, "refunded", note, behalf);
      }
      return yield* orderDetail(ctx, yield* loadOrder(ws, o.order_id), perms);
    }),
};

export const storeHandlers = {
  "store.categories": categories,
  "store.catalog": catalogue,
  "store.product": product,
  "store.reviews": reviews,
  "store.review_create": reviewCreate,
  "store.review_moderate": reviewModerate,
  "cart.get": cartGet,
  "cart.set_item": cartSet,
  "cart.clear": cartClear,
  "checkout.quote": quoteHandler,
  "checkout.place": checkoutPlace,
  "wishlist.list": wishlistList,
  "wishlist.add": wishlistSet(true),
  "wishlist.remove": wishlistSet(false),
  "orders.list": ordersList,
  "orders.get": ordersGet,
  "orders.transition": transitionHandler,
  "inventory.list": inventoryList,
  "inventory.adjust": inventoryAdjust,
} satisfies HandlerTable;
