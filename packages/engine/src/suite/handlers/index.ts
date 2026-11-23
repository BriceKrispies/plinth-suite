import type { ActionHandler } from "../types";
import { meHandlers } from "./me";
import { messagesHandlers } from "./messages";
import { notificationsHandlers } from "./notifications";
import { pointsHandlers } from "./points";
import { ledgerHandlers } from "./ledger";
import { storeHandlers } from "./store";
import { badgesHandlers } from "./badges";
import { promotionsHandlers } from "./promotions";
import { automationHandlers } from "./automation";
import { contentHandlers } from "./content";
import { peopleHandlers } from "./people";
import { segmentsHandlers } from "./segments";
import { tasksHandlers } from "./tasks";
import { approvalsHandlers } from "./approvals";
import { auditHandlers } from "./audit";
import { adminHandlers } from "./admin";
import { pagesHandlers } from "./pages";
import { siteHandlers } from "./site";
import { homeHandlers } from "./home";
import { searchHandlers } from "./search";
import { calendarHandlers } from "./calendar";
import { catalogHandlers } from "./catalog";

/**
 * The handler registry: action name -> implementation, one file per registry module. The dispatcher looks every action
 * up here, so adding a domain's behaviour never touches the dispatcher, the routes or the MCP tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyHandler = ActionHandler<any, any>;

export const HANDLERS: Readonly<Record<string, AnyHandler>> = {
  ...meHandlers,
  ...messagesHandlers,
  ...notificationsHandlers,
  ...pointsHandlers,
  ...ledgerHandlers,
  ...storeHandlers,
  ...badgesHandlers,
  ...promotionsHandlers,
  ...automationHandlers,
  ...contentHandlers,
  ...peopleHandlers,
  ...segmentsHandlers,
  ...tasksHandlers,
  ...approvalsHandlers,
  ...auditHandlers,
  ...adminHandlers,
  ...pagesHandlers,
  ...siteHandlers,
  ...homeHandlers,
  ...searchHandlers,
  ...calendarHandlers,
  ...catalogHandlers,
};

export const HANDLER_MODULES: ReadonlyArray<string> = [
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
  "pages",
  "home",
  "search",
  "calendar",
  "catalog",
];
