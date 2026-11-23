// Widget id -> lazy module loader. Files are found with `import.meta.glob`, so a widget module that has not
// landed yet is simply absent (its loader is null) and the runtime shows the "Widget not built yet" placeholder.
// Convention: `<domain>.<name>` lives at `src/widgets/<domain>/<name>.js`.
import { WIDGET_CATALOGUE } from "./widget-schemas.js";

const found = import.meta.glob("../widgets/*/*.js");

export const WIDGET_IDS = WIDGET_CATALOGUE.map((w) => w.id);

/** `{ [id]: (() => Promise<{ default: WidgetModule }>) | null }` for all catalogue widgets. */
export const WIDGET_MANIFEST = Object.fromEntries(
  WIDGET_IDS.map((id) => {
    const [domain, ...rest] = id.split(".");
    return [id, found[`../widgets/${domain}/${rest.join(".")}.js`] ?? null];
  }),
);

/** The page a widget opens as, for the frame's "Open as page" menu item. */
export const WIDGET_ROUTES = {
  "messaging.inbox": "/messages",
  "notifications.feed": "/notifications",
  "tasks.board": "/tasks",
  "tasks.list": "/tasks/all",
  "approvals.inbox": "/approvals",
  "points.balance": "/points",
  "points.ledger": "/points",
  "store.catalog": "/store",
  "store.cart": "/store/cart",
  "store.orders": "/store/orders",
  "store.wishlist": "/store/wishlist",
  "badges.catalog": "/badges",
  "people.directory": "/people",
  "content.feed": "/news",
  "content.list": "/content",
  "promotions.list": "/promotions",
  "automation.list": "/automations",
  "segments.list": "/segments",
  "calendar.month": "/calendar",
  "reporting.board": "/reports",
  "audit.timeline": "/audit",
};
