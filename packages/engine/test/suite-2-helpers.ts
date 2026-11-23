import { buildCatalog } from "../src/suite/handlers/catalog";

/** The static builder catalogue, for tests that need no database. */
export const catalogHandlersForTest = () => buildCatalog();
