import { Schema as S } from "effect";
import { OrderStatus, StockStatus } from "../events";
import { FulfilmentMethod, ProductSpec } from "../nodes";
import { AppliedPromotion, PromoEvaluation } from "../promotions";
import {
  Artwork,
  Cents,
  IdempotencyKey,
  PageQuery,
  PersonRef,
  Points,
  Region,
  Tier,
  Timestamp,
  UserText,
} from "../primitives";

/** Rewards store (CONTRACT.md module M4). */

export const CategoryView = S.Struct({
  slug: S.String,
  title: S.String,
  description: S.String,
  artwork: Artwork,
  product_count: S.Int,
  sort: S.Int,
}).annotations({ identifier: "CategoryView" });
export const CategoriesOut = S.Struct({ items: S.Array(CategoryView) });

export const ProductCard = S.Struct({
  slug: S.String,
  title: S.String,
  category: S.String,
  summary: S.String,
  price_points: Points,
  cash_price_cents: S.NullOr(Cents),
  artwork: Artwork,
  tags: S.Array(S.String),
  featured: S.Boolean,
  min_tier: S.NullOr(Tier),
  stock_status: StockStatus,
  on_hand: S.Int,
  rating: S.NullOr(S.Struct({ average: S.Number, count: S.Int })),
  in_wishlist: S.Boolean,
  in_cart_qty: S.Int,
  /** The viewer can afford it at list price and meets min_tier. */
  affordable: S.Boolean,
  locked_reason: S.NullOr(S.Literal("tier", "out_of_stock", "limit")),
  /** Best live discount percent from active promotions the viewer qualifies for (display only; checkout recomputes). */
  promo_percent: S.NullOr(S.Int),
}).annotations({ identifier: "ProductCard" });
export type ProductCard = typeof ProductCard.Type;

export const CatalogIn = S.Struct({
  category: S.optional(S.String),
  q: S.optional(S.String.pipe(S.maxLength(120))),
  tag: S.optional(S.String),
  min_points: S.optional(Points),
  max_points: S.optional(Points),
  in_stock: S.optional(S.Boolean),
  affordable: S.optional(S.Boolean),
  sort: S.optional(S.Literal("featured", "price_asc", "price_desc", "rating", "newest")),
  ...PageQuery,
}).annotations({ identifier: "CatalogIn" });

export const CatalogOut = S.Struct({
  items: S.Array(ProductCard),
  next_cursor: S.NullOr(S.String),
  total: S.Int,
  facets: S.Struct({
    categories: S.Array(S.Struct({ slug: S.String, title: S.String, count: S.Int })),
    tags: S.Array(S.Struct({ tag: S.String, count: S.Int })),
    price: S.Struct({ min: Points, max: Points }),
  }),
}).annotations({ identifier: "CatalogOut" });

export const ProductIn = S.Struct({ slug: S.String });
export const ReviewView = S.Struct({
  review_id: S.UUID,
  product: S.String,
  member: PersonRef,
  rating: S.Int.pipe(S.between(1, 5)),
  title: S.String,
  body: S.String,
  created_at: Timestamp,
  status: S.Literal("published", "hidden"),
  verified_order: S.Boolean,
}).annotations({ identifier: "ReviewView" });

export const ProductDetailOut = S.Struct({
  card: ProductCard,
  spec: ProductSpec,
  revision: S.Int,
  category: S.Struct({ slug: S.String, title: S.String }),
  rating_histogram: S.Array(S.Int).pipe(S.itemsCount(5)),
  reviews: S.Array(ReviewView),
  can_review: S.Boolean,
  member_purchased_qty: S.Int,
  related: S.Array(ProductCard),
  promotions: S.Array(S.Struct({ slug: S.String, title: S.String, headline: S.NullOr(S.String) })),
}).annotations({ identifier: "ProductDetailOut" });

export const ReviewsIn = S.Struct({ slug: S.String, ...PageQuery });
export const ReviewsOut = S.Struct({ items: S.Array(ReviewView), next_cursor: S.NullOr(S.String) });

export const ReviewCreateIn = S.Struct({
  slug: S.String,
  rating: S.Int.pipe(S.between(1, 5)),
  title: UserText(120).pipe(S.minLength(1)),
  body: UserText(2000),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ReviewCreateIn" });

export const ReviewModerateIn = S.Struct({
  review_id: S.UUID,
  status: S.Literal("published", "hidden"),
  reason: UserText(280),
});

export const CartLine = S.Struct({
  product: ProductCard,
  qty: S.Int.pipe(S.between(1, 10)),
  line_points: Points,
  issue: S.NullOr(S.Literal("out_of_stock", "insufficient_stock", "retired", "tier", "limit")),
}).annotations({ identifier: "CartLine" });

export const CartOut = S.Struct({
  lines: S.Array(CartLine),
  item_count: S.Int,
  subtotal_points: Points,
  balance: Points,
  updated_at: S.NullOr(Timestamp),
}).annotations({ identifier: "CartOut" });

export const CartSetIn = S.Struct({ slug: S.String, qty: S.Int.pipe(S.between(0, 10)) }).annotations({
  identifier: "CartSetIn",
});

export const QuoteLine = S.Struct({
  line: S.Int,
  product: S.String,
  title: S.String,
  qty: S.Int,
  unit_points: Points,
  discount_points: Points,
  line_points: Points,
  cash_cents: Cents,
  free_item: S.Boolean,
}).annotations({ identifier: "QuoteLine" });

export const QuoteOut = S.Struct({
  lines: S.Array(QuoteLine),
  subtotal_points: Points,
  discount_points: Points,
  total_points: Points,
  bonus_points: Points,
  cash_cents: Cents,
  balance: Points,
  balance_after: S.Int,
  requires_approval: S.Boolean,
  evaluation: PromoEvaluation,
  /** sha256 over the canonical quote; checkout.place refuses with PRICE_CHANGED when it no longer matches. */
  quote_hash: S.String.pipe(S.pattern(/^[0-9a-f]{64}$/)),
  blocking: S.Array(S.Struct({ line: S.Int, issue: S.String })),
}).annotations({ identifier: "QuoteOut" });

export const Delivery = S.Struct({
  method: FulfilmentMethod,
  address: S.optional(
    S.Struct({
      name: UserText(80),
      line1: UserText(120),
      line2: S.optional(UserText(120)),
      city: UserText(80),
      postal_code: UserText(20),
      country: S.String.pipe(S.pattern(/^[A-Z]{2}$/)),
    }),
  ),
  pickup_site: S.optional(S.String.pipe(S.maxLength(80))),
}).annotations({ identifier: "Delivery" });

export const CheckoutIn = S.Struct({
  quote_hash: S.String.pipe(S.pattern(/^[0-9a-f]{64}$/)),
  delivery: Delivery,
  notes: S.optional(UserText(500)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "CheckoutIn" });

export const OrderItemView = S.Struct({
  line: S.Int,
  product: S.String,
  title: S.String,
  artwork: Artwork,
  qty: S.Int,
  unit_points: Points,
  discount_points: Points,
  line_points: Points,
  cash_cents: Cents,
  free_item: S.Boolean,
}).annotations({ identifier: "OrderItemView" });

export const OrderEventView = S.Struct({
  seq: S.Int,
  from: S.NullOr(OrderStatus),
  to: OrderStatus,
  actor: PersonRef,
  at: Timestamp,
  note: S.NullOr(S.String),
}).annotations({ identifier: "OrderEventView" });

export const OrderSummary = S.Struct({
  order_id: S.UUID,
  order_no: S.String,
  member: PersonRef,
  region: Region,
  status: OrderStatus,
  requires_approval: S.Boolean,
  item_count: S.Int,
  total_points: Points,
  cash_cents: Cents,
  placed_at: Timestamp,
  updated_at: Timestamp,
  first_item: S.Struct({ title: S.String, artwork: Artwork }),
}).annotations({ identifier: "OrderSummary" });
export type OrderSummary = typeof OrderSummary.Type;

export const ORDER_TRANSITIONS = ["approve", "fulfil", "ship", "deliver", "cancel", "refund"] as const;
export const OrderTransition = S.Literal(...ORDER_TRANSITIONS).annotations({ identifier: "OrderTransition" });

export const OrderDetailOut = S.Struct({
  ...OrderSummary.fields,
  items: S.Array(OrderItemView),
  subtotal_points: Points,
  discount_points: Points,
  bonus_points: Points,
  promotions: S.Array(AppliedPromotion),
  delivery: Delivery,
  notes: S.NullOr(S.String),
  events: S.Array(OrderEventView),
  /** Null when promotions brought the total to 0 points (no purchase transaction is posted). */
  ledger_txn_id: S.NullOr(S.UUID),
  refund_txn_id: S.NullOr(S.UUID),
  bonus_txn_id: S.NullOr(S.UUID),
  /** Transitions the viewer may perform now. */
  allowed_transitions: S.Array(OrderTransition),
  cancel_deadline: S.NullOr(Timestamp),
  replayed: S.optional(S.Boolean),
}).annotations({ identifier: "OrderDetailOut" });

export const OrdersListIn = S.Struct({
  scope: S.optional(S.Literal("mine", "all")),
  status: S.optional(S.Array(OrderStatus)),
  member: S.optional(S.String),
  requires_approval: S.optional(S.Boolean),
  q: S.optional(S.String.pipe(S.maxLength(80))),
  ...PageQuery,
}).annotations({ identifier: "OrdersListIn" });
export const OrdersListOut = S.Struct({
  items: S.Array(OrderSummary),
  next_cursor: S.NullOr(S.String),
  status_counts: S.Record({ key: OrderStatus, value: S.Int }),
});

export const OrderIn = S.Struct({ order_id: S.UUID });
export const OrderTransitionIn = S.Struct({
  order_id: S.UUID,
  transition: OrderTransition,
  note: S.optional(UserText(280)),
  /** cancel/refund: return the items to stock (default true for cancel, false for refund). */
  restock: S.optional(S.Boolean),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "OrderTransitionIn" });

export const WishlistOut = S.Struct({
  items: S.Array(S.Struct({ product: ProductCard, added_at: Timestamp })),
});
export const WishlistIn = S.Struct({ slug: S.String });
export const WishlistChangeOut = S.Struct({ product: S.String, in_wishlist: S.Boolean });

export const InventoryRow = S.Struct({
  product: S.String,
  title: S.String,
  category: S.String,
  on_hand: S.Int,
  low_stock_threshold: S.Int,
  stock_status: StockStatus,
  sold_30d: S.Int,
  updated_at: Timestamp,
}).annotations({ identifier: "InventoryRow" });
export const InventoryListIn = S.Struct({ status: S.optional(StockStatus), ...PageQuery });
export const InventoryListOut = S.Struct({ items: S.Array(InventoryRow), next_cursor: S.NullOr(S.String) });
export const InventoryAdjustIn = S.Struct({
  slug: S.String,
  delta: S.Int.pipe(
    S.between(-100000, 100000),
    S.filter((n) => n !== 0, { message: () => "delta must not be 0" }),
  ),
  reason: S.Literal("restock", "damage", "count_correction", "return"),
  note: S.optional(UserText(280)),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "InventoryAdjustIn" });
