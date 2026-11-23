/**
 * Plinth Suite node kinds (docs/suite/CONTRACT.md section 2.1). Configuration-like objects live in the audited change
 * log as Nodes. This file has no imports, so the kernel's `common.ts` can append these kinds to `NODE_KINDS` without
 * an import cycle. A reference to one of these nodes is `<lowercased kind>:<slug>`, for example `category:apparel`.
 */
export const SUITE_NODE_KINDS = [
  "Product",
  "Category",
  "Badge",
  "Promotion",
  "Automation",
  "Content",
  "Segment",
  "Group",
  "Role",
  "Preference",
  "Program",
  "Widget",
  "Page",
] as const;
export type SuiteKind = (typeof SUITE_NODE_KINDS)[number];
