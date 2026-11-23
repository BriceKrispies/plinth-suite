import { widgetById, type WidgetSize } from "./widgets";

/**
 * The default pages (CONTRACT.md 5A, 12.11; UI-MAP.md section 2): every module page as a system Page with its default
 * Widget instances. The seed's `pages` step and the `site.restore` action both build nodes from this one table, so a
 * restored site is the seeded site. Widget instance slugs are `<page>.<widget id with dots as dashes>`, numbered when a
 * page uses one widget twice.
 */

export type Cfg = Record<string, unknown>;
export type Cell = readonly [x: number, y: number, w: number, h: number];

export interface Item {
  readonly widget: string;
  readonly config: Cfg;
  readonly size: WidgetSize;
  readonly at: Cell;
  /** Disambiguates two instances of one widget on a page. */
  readonly tag?: string;
}

export interface Nav {
  readonly section: "personal" | "engage" | "rewards" | "operate" | "insight" | "admin";
  readonly label: string;
  readonly icon: string;
  readonly count?: string;
  readonly permission?: string;
}

export interface PageDef {
  readonly slug: string;
  readonly title: string;
  readonly route: string;
  readonly kind: "module" | "home" | "profile";
  readonly description: string;
  readonly nav?: Nav;
  readonly items: ReadonlyArray<Item>;
}

const it = (widget: string, config: Cfg, size: WidgetSize, at: Cell, tag?: string): Item => ({
  widget,
  config,
  size,
  at,
  ...(tag !== undefined ? { tag } : {}),
});

const param = (name: string) => ({ param: name });
const ME = "$me";

const KPIS_HOME = ["points_issued_today", "points_redeemed_today", "orders_today", "active_members_7d"];
const KPIS_REPORTS = [
  "points_issued_today",
  "points_redeemed_today",
  "orders_today",
  "active_members_7d",
  "badges_awarded_7d",
  "members_total",
];
const OPEN = ["open", "in_progress", "blocked"];

export const PAGES: ReadonlyArray<PageDef> = [
  {
    slug: "home",
    title: "Home",
    route: "/",
    kind: "home",
    description: "Your day at Northwind: offers, balance, badges, messages, news, approvals and tasks.",
    nav: { section: "personal", label: "Home", icon: "home" },
    items: [
      it("promotions.active", { limit: 3 }, "full", [0, 0, 12, 3]),
      it("points.balance", { member: ME, show_tier: true, show_expiring: true }, "m", [0, 3, 4, 5]),
      it("badges.progress", { member: ME, limit: 3 }, "m", [4, 3, 4, 5]),
      it("messaging.unread", {}, "s", [8, 3, 4, 5]),
      it("content.feed", { layout: "cards", limit: 6 }, "xl", [0, 8, 8, 8]),
      it("notifications.feed", { filter: "unread", page_size: 8 }, "m", [8, 8, 4, 8]),
      it("approvals.inbox", { scope: "to_decide", page_size: 5 }, "m", [0, 16, 6, 5]),
      it("tasks.list", { scope: "mine", status: OPEN, page_size: 5 }, "m", [6, 16, 6, 5]),
      it("reporting.suite-kpis", { metrics: KPIS_HOME }, "xl", [0, 21, 12, 4]),
    ],
  },
  {
    slug: "messages",
    title: "Inbox",
    route: "/messages",
    kind: "module",
    description: "Message threads and the open conversation.",
    nav: {
      section: "personal",
      label: "Inbox",
      icon: "inbox",
      count: "messages_unread",
      permission: "messages:use",
    },
    items: [
      it("messaging.inbox", { folder: "inbox", open_in: "bus" }, "l", [0, 0, 5, 12]),
      it("messaging.thread", {}, "xl", [5, 0, 7, 12]),
    ],
  },
  {
    slug: "messages-thread",
    title: "Message thread",
    route: "/messages/t/:thread",
    kind: "module",
    description: "One message thread beside the inbox.",
    items: [
      it("messaging.inbox", { open_in: "bus" }, "l", [0, 0, 4, 12]),
      it("messaging.thread", { thread: param("thread") }, "xl", [4, 0, 8, 12]),
    ],
  },
  {
    slug: "messages-new",
    title: "New message",
    route: "/messages/new",
    kind: "module",
    description: "Compose a message.",
    items: [it("messaging.compose", {}, "xl", [2, 0, 8, 10])],
  },
  {
    slug: "notifications",
    title: "Notifications",
    route: "/notifications",
    kind: "module",
    description: "Everything that happened, newest first.",
    nav: { section: "personal", label: "Notifications", icon: "bell", count: "notifications_unread" },
    items: [it("notifications.feed", { filter: "all" }, "full", [0, 0, 12, 12])],
  },
  {
    slug: "tasks",
    title: "Tasks",
    route: "/tasks",
    kind: "module",
    description: "Your tasks on a board, with quick add.",
    nav: { section: "personal", label: "Tasks", icon: "task", count: "tasks_open", permission: "tasks:use" },
    items: [
      it("tasks.quick-add", {}, "m", [0, 0, 4, 4]),
      it("tasks.board", { scope: "mine" }, "full", [0, 4, 12, 12]),
    ],
  },
  {
    slug: "tasks-all",
    title: "All tasks",
    route: "/tasks/all",
    kind: "module",
    description: "Every task, for people who manage tasks.",
    items: [it("tasks.list", { scope: "all" }, "full", [0, 0, 12, 12])],
  },
  {
    slug: "approvals",
    title: "Approvals",
    route: "/approvals",
    kind: "module",
    description: "Held changes, held actions, high-value orders and content reviews.",
    nav: { section: "personal", label: "Approvals", icon: "check-circle", count: "approvals_pending" },
    items: [
      it("approvals.inbox", { scope: "to_decide" }, "full", [0, 0, 12, 12], "to-decide"),
      it("approvals.inbox", { scope: "requested", link_group: "mine" }, "xl", [0, 12, 8, 8], "requested"),
    ],
  },
  {
    slug: "points",
    title: "Points",
    route: "/points",
    kind: "module",
    description: "Balance, transfers, statement, expiry and tiers.",
    nav: { section: "rewards", label: "Points", icon: "coins", permission: "points:use" },
    items: [
      it("points.balance", { member: ME, show_tier: true, show_expiring: true }, "l", [0, 0, 6, 6]),
      it("points.transfer", {}, "m", [6, 0, 6, 6]),
      it("points.ledger", { member: ME }, "full", [0, 6, 12, 10]),
      it("points.expiry", { member: ME }, "m", [0, 16, 6, 5]),
      it("points.tiers", {}, "l", [6, 16, 6, 5]),
    ],
  },
  {
    slug: "points-award",
    title: "Award points",
    route: "/points/award",
    kind: "module",
    description: "Recognise a colleague with points.",
    nav: { section: "rewards", label: "Award points", icon: "award", permission: "points:award" },
    items: [
      it("points.award", {}, "l", [0, 0, 6, 8]),
      it("people.directory", { view: "table" }, "l", [6, 0, 6, 8]),
    ],
  },
  {
    slug: "store",
    title: "Store",
    route: "/store",
    kind: "module",
    description: "Offers, featured rewards and the full catalogue.",
    nav: { section: "rewards", label: "Store", icon: "store", count: "cart_items" },
    items: [
      it("promotions.active", { limit: 2 }, "full", [0, 0, 12, 3]),
      it("store.featured", { limit: 6 }, "full", [0, 3, 12, 5]),
      it("store.catalog", { show_filters: true, open_in: "page" }, "full", [0, 8, 12, 14]),
    ],
  },
  {
    slug: "store-category",
    title: "Store category",
    route: "/store/c/:category",
    kind: "module",
    description: "One store category: offers and the filtered catalogue.",
    items: [
      it("promotions.active", { limit: 1 }, "full", [0, 0, 12, 3]),
      it(
        "store.catalog",
        { category: param("category"), show_filters: true, open_in: "page" },
        "full",
        [0, 3, 12, 14],
      ),
    ],
  },
  {
    slug: "store-product",
    title: "Product",
    route: "/store/p/:product",
    kind: "module",
    description: "One product with the cart and more rewards beside it.",
    items: [
      it("store.product", { product: param("product") }, "xl", [0, 0, 8, 12]),
      it("store.cart", { compact: true }, "m", [8, 0, 4, 6]),
      it("store.featured", { limit: 4 }, "m", [8, 6, 4, 6]),
    ],
  },
  {
    slug: "store-cart",
    title: "Cart",
    route: "/store/cart",
    kind: "module",
    description: "Your cart, your balance and your wishlist.",
    items: [
      it("store.cart", {}, "xl", [0, 0, 8, 12]),
      it("points.balance", { member: ME }, "m", [8, 0, 4, 5]),
      it("store.wishlist", {}, "m", [8, 5, 4, 7]),
    ],
  },
  {
    slug: "store-orders",
    title: "My orders",
    route: "/store/orders",
    kind: "module",
    description: "Your orders.",
    items: [it("store.orders", { scope: "mine" }, "full", [0, 0, 12, 12])],
  },
  {
    slug: "store-order",
    title: "Order",
    route: "/store/orders/:order",
    kind: "module",
    description: "One order and its timeline.",
    items: [it("store.order", { order: param("order") }, "full", [0, 0, 12, 12])],
  },
  {
    slug: "store-wishlist",
    title: "Wishlist",
    route: "/store/wishlist",
    kind: "module",
    description: "Rewards you are saving for.",
    items: [it("store.wishlist", {}, "xl", [0, 0, 12, 10])],
  },
  {
    slug: "badges",
    title: "Badges",
    route: "/badges",
    kind: "module",
    description: "Your showcase, progress, recent awards and the full catalogue.",
    nav: { section: "rewards", label: "Badges", icon: "trophy" },
    items: [
      it("badges.showcase", { member: ME }, "m", [0, 0, 4, 5]),
      it("badges.progress", { member: ME, limit: 4 }, "m", [4, 0, 4, 5]),
      it("badges.recent", { limit: 8 }, "m", [8, 0, 4, 5]),
      it("badges.catalog", { member: ME, filter: "all" }, "full", [0, 5, 12, 12]),
    ],
  },
  {
    slug: "people",
    title: "People",
    route: "/people",
    kind: "module",
    description: "The member directory and groups.",
    nav: { section: "engage", label: "People", icon: "users" },
    items: [
      it("people.directory", { view: "grid" }, "full", [0, 0, 12, 12]),
      it("people.groups", {}, "m", [0, 12, 4, 6]),
    ],
  },
  {
    slug: "profile",
    title: "Profile",
    route: "/people/:handle",
    kind: "profile",
    description: "A member's profile: card, points, badges and activity.",
    items: [
      it("people.profile-card", { member: param("handle") }, "l", [0, 0, 6, 6]),
      it("points.balance", { member: param("handle"), show_tier: true }, "m", [6, 0, 3, 6]),
      it("badges.showcase", { member: param("handle") }, "m", [9, 0, 3, 6]),
      it("people.activity", { member: param("handle") }, "xl", [0, 6, 8, 10]),
      it("badges.progress", { member: param("handle") }, "m", [8, 6, 4, 10]),
    ],
  },
  {
    slug: "my-profile",
    title: "My profile",
    route: "/profile",
    kind: "profile",
    description: "Your own profile, activity and sessions.",
    items: [
      it("people.profile-card", { member: ME }, "l", [0, 0, 6, 6]),
      it("points.balance", { member: ME, show_tier: true, show_expiring: true }, "m", [6, 0, 3, 6]),
      it("badges.showcase", { member: ME }, "m", [9, 0, 3, 6]),
      it("people.activity", { member: ME }, "xl", [0, 6, 8, 10]),
      it("people.sessions", {}, "m", [8, 6, 4, 10]),
    ],
  },
  {
    slug: "group",
    title: "Group",
    route: "/groups/:group",
    kind: "module",
    description: "One group with its members and a compose box.",
    items: [
      it("people.group", { group: param("group") }, "xl", [0, 0, 8, 12]),
      it("messaging.compose", { collapsed: true }, "m", [8, 0, 4, 8]),
    ],
  },
  {
    slug: "search",
    title: "Search",
    route: "/search",
    kind: "module",
    description: "Search results across people, rewards, content and more.",
    items: [it("search.results", { q: param("q") }, "full", [0, 0, 12, 14])],
  },
  {
    slug: "news",
    title: "News",
    route: "/news",
    kind: "module",
    description: "Announcements and articles.",
    nav: { section: "engage", label: "News", icon: "article" },
    items: [it("content.feed", { layout: "list" }, "full", [0, 0, 12, 14])],
  },
  {
    slug: "read",
    title: "Read",
    route: "/read/:content",
    kind: "module",
    description: "One published item.",
    items: [it("content.reader", { content: param("content") }, "xl", [2, 0, 8, 14])],
  },
  {
    slug: "content",
    title: "Content",
    route: "/content",
    kind: "module",
    description: "Review queue, publishing calendar and every content item.",
    nav: {
      section: "engage",
      label: "Content",
      icon: "document",
      count: "content_reviews",
      permission: "content:author",
    },
    items: [
      it("content.review-queue", {}, "l", [0, 0, 6, 7]),
      it("calendar.agenda", { days: 14, types: ["content"] }, "l", [6, 0, 6, 7]),
      it("content.list", {}, "full", [0, 7, 12, 12]),
    ],
  },
  {
    slug: "content-new",
    title: "New content",
    route: "/content/new",
    kind: "module",
    description: "Write a new item.",
    items: [it("content.editor", { content: null }, "full", [0, 0, 12, 16])],
  },
  {
    slug: "content-edit",
    title: "Edit content",
    route: "/content/:content",
    kind: "module",
    description: "Edit one item with its history.",
    items: [
      it("content.editor", { content: param("content") }, "full", [0, 0, 12, 16]),
      it("audit.node-history", { node: param("content") }, "l", [0, 16, 6, 8]),
    ],
  },
  {
    slug: "promotions",
    title: "Promotions",
    route: "/promotions",
    kind: "module",
    description: "Performance, schedule and every promotion.",
    nav: { section: "engage", label: "Promotions", icon: "percent", permission: "promotions:simulate" },
    items: [
      it("promotions.performance", { promotion: null }, "l", [0, 0, 6, 6]),
      it("calendar.agenda", { days: 30, types: ["promotion"] }, "l", [6, 0, 6, 6]),
      it("promotions.list", {}, "full", [0, 6, 12, 12]),
    ],
  },
  {
    slug: "promotion-new",
    title: "New promotion",
    route: "/promotions/new",
    kind: "module",
    description: "Build a promotion.",
    items: [it("promotions.builder", { promotion: null }, "full", [0, 0, 12, 16])],
  },
  {
    slug: "promotion",
    title: "Promotion",
    route: "/promotions/:promotion",
    kind: "module",
    description: "One promotion: builder, simulator and performance.",
    items: [
      it("promotions.builder", { promotion: param("promotion") }, "full", [0, 0, 12, 16]),
      it("promotions.simulator", { promotion: param("promotion") }, "l", [0, 16, 6, 9]),
      it("promotions.performance", { promotion: param("promotion") }, "l", [6, 16, 6, 9]),
    ],
  },
  {
    slug: "automations",
    title: "Automations",
    route: "/automations",
    kind: "module",
    description: "Every automation and its recent runs.",
    nav: { section: "engage", label: "Automations", icon: "workflow", permission: "automation:manage" },
    items: [
      it("automation.list", {}, "full", [0, 0, 12, 10]),
      it("automation.runs", {}, "full", [0, 10, 12, 10]),
    ],
  },
  {
    slug: "automation-new",
    title: "New automation",
    route: "/automations/new",
    kind: "module",
    description: "Build an automation.",
    items: [it("automation.builder", { automation: null }, "full", [0, 0, 12, 16])],
  },
  {
    slug: "automation",
    title: "Automation",
    route: "/automations/:automation",
    kind: "module",
    description: "One automation: builder and runs.",
    items: [
      it("automation.builder", { automation: param("automation") }, "full", [0, 0, 12, 16]),
      it("automation.runs", { automation: param("automation") }, "full", [0, 16, 12, 10]),
    ],
  },
  {
    slug: "segments",
    title: "Segments",
    route: "/segments",
    kind: "module",
    description: "Saved segments and who is in them.",
    nav: { section: "engage", label: "Segments", icon: "segment", permission: "segments:preview" },
    items: [it("segments.list", {}, "l", [0, 0, 5, 12]), it("segments.members", {}, "xl", [5, 0, 7, 12])],
  },
  {
    slug: "segment-new",
    title: "New segment",
    route: "/segments/new",
    kind: "module",
    description: "Build a segment.",
    items: [it("segments.builder", { segment: null }, "full", [0, 0, 12, 14])],
  },
  {
    slug: "segment",
    title: "Segment",
    route: "/segments/:segment",
    kind: "module",
    description: "One segment: builder and members.",
    items: [
      it("segments.builder", { segment: param("segment") }, "full", [0, 0, 12, 14]),
      it("segments.members", { segment: param("segment") }, "l", [0, 14, 6, 8]),
    ],
  },
  {
    slug: "calendar",
    title: "Calendar",
    route: "/calendar",
    kind: "module",
    description: "Promotions, content schedules, automations, expiry and due dates.",
    nav: { section: "engage", label: "Calendar", icon: "calendar" },
    items: [
      it("calendar.month", {}, "full", [0, 0, 12, 14]),
      it("calendar.agenda", { days: 7 }, "m", [0, 14, 4, 8]),
    ],
  },
  {
    slug: "reports",
    title: "Reports",
    route: "/reports",
    kind: "module",
    description: "Programme KPIs and the programme overview board.",
    nav: { section: "insight", label: "Reports", icon: "chart", permission: "query:run" },
    items: [
      it("reporting.suite-kpis", { metrics: KPIS_REPORTS }, "full", [0, 0, 12, 4]),
      it("reporting.board", { dashboard: "programme-overview" }, "full", [0, 4, 12, 16]),
    ],
  },
  {
    slug: "report",
    title: "Report",
    route: "/reports/:dashboard",
    kind: "module",
    description:
      "A dashboard. The board widget takes a dashboard slug, not a route parameter, so this page shows the programme overview; the other Suite boards have their own pages.",
    items: [it("reporting.board", { dashboard: "programme-overview" }, "full", [0, 0, 12, 18])],
  },
  {
    slug: "report-store-performance",
    title: "Store performance",
    route: "/reports/store-performance",
    kind: "module",
    description: "Revenue, top products, order status and fulfilment time.",
    items: [it("reporting.board", { dashboard: "store-performance" }, "full", [0, 0, 12, 18])],
  },
  {
    slug: "report-engagement",
    title: "Engagement",
    route: "/reports/engagement",
    kind: "module",
    description: "Promotion cost, automation runs, message volume and content views.",
    items: [it("reporting.board", { dashboard: "engagement" }, "full", [0, 0, 12, 18])],
  },
  {
    slug: "audit",
    title: "Audit",
    route: "/audit",
    kind: "module",
    description: "Both hash chains and the merged timeline of changes and events.",
    nav: { section: "insight", label: "Audit", icon: "audit", permission: "audit:view" },
    items: [it("audit.verify", {}, "s", [0, 0, 3, 3]), it("audit.timeline", {}, "full", [0, 3, 12, 16])],
  },
  {
    slug: "store-manage",
    title: "Orders",
    route: "/store/manage",
    kind: "module",
    description: "Orders to approve and every order.",
    nav: {
      section: "operate",
      label: "Orders",
      icon: "box",
      count: "orders_attention",
      permission: "store:orders",
    },
    items: [
      it("store.orders", { scope: "all", requires_approval: true }, "xl", [0, 0, 8, 8], "approval"),
      it("approvals.inbox", { types: ["order"] }, "m", [8, 0, 4, 8]),
      it("store.orders", { scope: "all", link_group: "all" }, "full", [0, 8, 12, 12], "all"),
    ],
  },
  {
    slug: "store-inventory",
    title: "Inventory",
    route: "/store/inventory",
    kind: "module",
    description: "Stock levels and adjustments.",
    nav: { section: "operate", label: "Inventory", icon: "tag", permission: "store:inventory" },
    items: [it("store.inventory", {}, "full", [0, 0, 12, 12])],
  },
  {
    slug: "ledger",
    title: "Ledger",
    route: "/ledger",
    kind: "module",
    description: "Trial balance, points flow and every account.",
    nav: { section: "operate", label: "Ledger", icon: "wallet", permission: "points:ledger" },
    items: [
      it("points.trial-balance", {}, "l", [0, 0, 6, 6]),
      it("reporting.panel", { panel: "panel:suite-points-flow" }, "l", [6, 0, 6, 6]),
      it("points.accounts", {}, "full", [0, 6, 12, 14]),
    ],
  },
  {
    slug: "admin-members",
    title: "Members",
    route: "/admin",
    kind: "module",
    description: "Members, status and sessions.",
    nav: { section: "admin", label: "Members", icon: "user", permission: "admin:members" },
    items: [it("admin.members", {}, "full", [0, 0, 12, 14])],
  },
  {
    slug: "admin-roles",
    title: "Roles",
    route: "/admin/roles",
    kind: "module",
    description: "Roles, their members and the permission matrix.",
    nav: { section: "admin", label: "Roles", icon: "shield", permission: "admin:roles" },
    items: [it("admin.roles", {}, "full", [0, 0, 12, 10]), it("admin.matrix", {}, "full", [0, 10, 12, 12])],
  },
  {
    slug: "admin-grants",
    title: "Grants",
    route: "/admin/grants",
    kind: "module",
    description: "Access grants.",
    nav: { section: "admin", label: "Grants", icon: "key", permission: "admin:roles" },
    items: [it("admin.grants", {}, "full", [0, 0, 12, 14])],
  },
  {
    slug: "admin-program",
    title: "Programme",
    route: "/admin/program",
    kind: "module",
    description: "The Program policy: tiers, expiry, limits and defaults.",
    nav: { section: "admin", label: "Programme", icon: "sliders" },
    items: [it("admin.program", {}, "full", [0, 0, 12, 16])],
  },
  {
    slug: "settings",
    title: "Settings",
    route: "/settings",
    kind: "module",
    description: "Notification preferences, appearance, sessions and delivery log.",
    nav: { section: "admin", label: "Settings", icon: "settings" },
    items: [
      it("notifications.preferences", {}, "xl", [0, 0, 8, 12]),
      it("settings.appearance", {}, "m", [8, 0, 4, 6]),
      it("people.sessions", {}, "m", [8, 6, 4, 6]),
      it("notifications.deliveries", {}, "xl", [0, 12, 8, 8]),
    ],
  },
  {
    slug: "page-edit",
    title: "Edit page",
    route: "/pages/:page/edit",
    kind: "module",
    description: "The page editor.",
    items: [it("pages.editor", { page: param("page") }, "full", [0, 0, 12, 10])],
  },
];

/** The widget instance slug of an item on a page. */
export const widgetSlug = (page: PageDef, item: Item): string =>
  `${page.slug}.${item.widget.replace(".", "-")}${item.tag ? `-${item.tag}` : ""}`;

export const widgetBody = (page: PageDef, item: Item) => {
  const def = widgetById(item.widget);
  const slug = widgetSlug(page, item);
  return {
    apiVersion: "plinth/v1" as const,
    kind: "Widget" as const,
    metadata: { slug, title: `${page.title}: ${def?.title ?? item.widget}`.slice(0, 120) },
    spec: { widget: item.widget, config: item.config },
  };
};

export const pageBody = (page: PageDef, order: number) => ({
  apiVersion: "plinth/v1" as const,
  kind: "Page" as const,
  metadata: { slug: page.slug, title: page.title },
  spec: {
    kind: page.kind,
    description: page.description,
    route: page.route,
    system: true,
    ...(page.nav ? { nav: { ...page.nav, order } } : {}),
    layout: {
      columns: 12 as const,
      items: page.items.map((i) => ({
        item: `widget:${widgetSlug(page, i)}`,
        at: { x: i.at[0], y: i.at[1], w: i.at[2], h: i.at[3] },
        size: i.size,
      })),
    },
  },
});

/** Nav order of each default page: 10, 20, ... within its section, following table order. */
export const defaultNavOrders = (): ReadonlyMap<string, number> => {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const p of PAGES) {
    const section = p.nav?.section ?? "";
    const n = (seen.get(section) ?? 0) + 10;
    if (p.nav) seen.set(section, n);
    out.set(p.slug, n);
  }
  return out;
};
