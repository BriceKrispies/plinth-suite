import { Schema } from "effect";
import { Ref, Slug, Kind } from "./common";
import { Field, QueryAst } from "./query-ast";
import { GrantSpec } from "./grant";

/** Metadata block of the node envelope (spec 02 section 3.2). */
export const Metadata = Schema.Struct({
  id: Schema.optional(Schema.UUID),
  slug: Slug,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  labels: Schema.optional(
    Schema.Record({
      key: Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9_.-]{0,62}$/)),
      value: Schema.String.pipe(Schema.maxLength(253)),
    }),
  ),
});
export type Metadata = typeof Metadata.Type;

const envelope = <K extends string, S extends Schema.Schema.Any>(kind: K, spec: S) =>
  Schema.Struct({
    apiVersion: Schema.Literal("plinth/v1"),
    kind: Schema.Literal(kind),
    metadata: Metadata,
    spec,
  });

// ---- Dashboard (02 section 3.3.1) -----------------------------------------------------------

export const LayoutAt = Schema.Struct({
  x: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
  y: Schema.Int.pipe(Schema.greaterThanOrEqualTo(0)),
  w: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
  h: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
});
export type LayoutAt = typeof LayoutAt.Type;

export const LayoutItem = Schema.Struct({ panel: Ref, at: LayoutAt });
export type LayoutItem = typeof LayoutItem.Type;

export const ParameterDecl = Schema.Struct({
  type: Schema.Literal("string", "int", "float", "bool", "timestamp", "duration"),
  default: Schema.optional(Schema.Union(Schema.String, Schema.Number, Schema.Boolean)),
});

export const DashboardSpec = Schema.Struct({
  parameters: Schema.optional(Schema.Record({ key: Slug, value: ParameterDecl })),
  layout: Schema.Struct({
    columns: Schema.optional(Schema.Int.pipe(Schema.between(1, 24))),
    items: Schema.Array(LayoutItem),
  }),
  rules: Schema.optional(Schema.Array(Ref)),
}).annotations({ identifier: "DashboardSpec" });
export type DashboardSpec = typeof DashboardSpec.Type;

export const DashboardNode = envelope("Dashboard", DashboardSpec).annotations({ identifier: "Dashboard" });

// ---- Panel (02 section 3.3.2), visual types (P1) ---------------------------------------------

const Threshold = Schema.Struct({ value: Schema.Number, style: Schema.String });
const Unit = Schema.optional(Schema.String);

export const BarVisual = Schema.Struct({
  type: Schema.Literal("bar"),
  channels: Schema.Struct({ x: Field, y: Field, color: Schema.optional(Field) }),
  threshold: Schema.optional(Threshold),
  options: Schema.optional(Schema.Struct({ stacked: Schema.optional(Schema.Boolean), unit: Unit })),
}).annotations({ identifier: "BarVisual" });
export type BarVisual = typeof BarVisual.Type;

/** Time series: x is a time column, `series` splits one line per value. Brushing is session state (P3). */
export const LineVisual = Schema.Struct({
  type: Schema.Literal("line"),
  channels: Schema.Struct({ x: Field, y: Field, series: Schema.optional(Field) }),
  threshold: Schema.optional(Threshold),
  options: Schema.optional(
    Schema.Struct({
      unit: Unit,
      smooth: Schema.optional(Schema.Boolean),
      brush: Schema.optional(Schema.Boolean),
    }),
  ),
}).annotations({ identifier: "LineVisual" });
export type LineVisual = typeof LineVisual.Type;

export const AreaVisual = Schema.Struct({
  type: Schema.Literal("area"),
  channels: Schema.Struct({ x: Field, y: Field, series: Schema.optional(Field) }),
  threshold: Schema.optional(Threshold),
  options: Schema.optional(Schema.Struct({ stacked: Schema.optional(Schema.Boolean), unit: Unit })),
}).annotations({ identifier: "AreaVisual" });
export type AreaVisual = typeof AreaVisual.Type;

/** Cells above `threshold` carry a hatch in addition to colour; `domain` pins the colour scale. */
export const HeatmapVisual = Schema.Struct({
  type: Schema.Literal("heatmap"),
  channels: Schema.Struct({ x: Field, y: Field, value: Field }),
  threshold: Schema.optional(Threshold),
  options: Schema.optional(
    Schema.Struct({
      unit: Unit,
      domain: Schema.optional(Schema.Tuple(Schema.Number, Schema.Number)),
    }),
  ),
}).annotations({ identifier: "HeatmapVisual" });
export type HeatmapVisual = typeof HeatmapVisual.Type;

export const ScatterVisual = Schema.Struct({
  type: Schema.Literal("scatter"),
  channels: Schema.Struct({
    x: Field,
    y: Field,
    series: Schema.optional(Field),
    size: Schema.optional(Field),
  }),
  options: Schema.optional(Schema.Struct({ unit: Unit })),
}).annotations({ identifier: "ScatterVisual" });
export type ScatterVisual = typeof ScatterVisual.Type;

/** KPI tile: `value` and `delta` read from the last row; `x`/`y` draw an optional sparkline. */
export const KpiVisual = Schema.Struct({
  type: Schema.Literal("kpi"),
  channels: Schema.Struct({
    value: Field,
    delta: Schema.optional(Field),
    x: Schema.optional(Field),
    y: Schema.optional(Field),
  }),
  threshold: Schema.optional(Threshold),
  options: Schema.optional(
    Schema.Struct({
      unit: Unit,
      /** Which direction of `delta` is good news. */
      good: Schema.optional(Schema.Literal("up", "down")),
    }),
  ),
}).annotations({ identifier: "KpiVisual" });
export type KpiVisual = typeof KpiVisual.Type;

export const TableVisual = Schema.Struct({
  type: Schema.Literal("table"),
  columns: Schema.Array(Field).pipe(Schema.minItems(1), Schema.maxItems(40)),
  options: Schema.optional(
    Schema.Struct({ page_size: Schema.optional(Schema.Int.pipe(Schema.between(1, 500))) }),
  ),
}).annotations({ identifier: "TableVisual" });
export type TableVisual = typeof TableVisual.Type;

export const Visual = Schema.Union(
  LineVisual,
  BarVisual,
  HeatmapVisual,
  KpiVisual,
  TableVisual,
  AreaVisual,
  ScatterVisual,
).annotations({ identifier: "Visual" });
export type Visual = typeof Visual.Type;

export const PanelSpec = Schema.Struct({
  query: Schema.Union(Ref, QueryAst),
  visual: Visual,
}).annotations({ identifier: "PanelSpec" });
export type PanelSpec = typeof PanelSpec.Type;

export const PanelNode = envelope("Panel", PanelSpec).annotations({ identifier: "Panel" });

// ---- Source (02 section 3.3.4) --------------------------------------------------------------

export const FieldType = Schema.String.pipe(
  Schema.pattern(/^(bool|int|float|string|timestamp|duration|enum\([a-z_]+\))$/),
  Schema.annotations({ identifier: "FieldType" }),
);

export const FieldDecl = Schema.Struct({
  name: Field,
  type: FieldType,
  nullable: Schema.Boolean,
  description: Schema.optional(Schema.String.pipe(Schema.maxLength(500))),
  masked: Schema.optional(Schema.Boolean),
  "x-untrusted": Schema.optional(Schema.Boolean),
});
export type FieldDecl = typeof FieldDecl.Type;

export const SourceSpec = Schema.Struct({
  kind: Schema.Literal("landed", "metadata"),
  domain: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32))),
  time_column: Field,
  primary_key: Schema.Array(Field).pipe(Schema.minItems(1)),
  fields: Schema.Array(FieldDecl).pipe(Schema.minItems(1)),
  partition: Schema.optional(
    Schema.Struct({ by: Schema.Array(Field), granularity: Schema.Literal("hour", "day") }),
  ),
  enums: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Array(Schema.String) })),
  shards: Schema.optional(Schema.Int.pipe(Schema.greaterThanOrEqualTo(1))),
}).annotations({ identifier: "SourceSpec" });
export type SourceSpec = typeof SourceSpec.Type;

export const SourceNode = envelope("Source", SourceSpec).annotations({ identifier: "Source" });

// ---- Grant (02 section 3.3.10) ----------------------------------------------------------------

export const GrantNode = envelope("Grant", GrantSpec).annotations({ identifier: "Grant" });

// ---- Union and per-kind lookup --------------------------------------------------------------

export const NodeBody = Schema.Union(DashboardNode, PanelNode, SourceNode, GrantNode).annotations({
  identifier: "NodeBody",
});
export type NodeBody = typeof NodeBody.Type;
export type DashboardBody = typeof DashboardNode.Type;
export type PanelBody = typeof PanelNode.Type;
export type SourceBody = typeof SourceNode.Type;
export type GrantBody = typeof GrantNode.Type;

/** Server view of a node (what `GET /nodes/:id` and `node.get` return). */
export const NodeView = Schema.Struct({
  uri: Schema.String,
  kind: Kind,
  slug: Schema.String,
  revision: Schema.Int,
  body_hash: Schema.String,
  body: Schema.Unknown,
  deleted: Schema.Boolean,
});
export type NodeView = typeof NodeView.Type;

export const bodySchemaFor = (kind: Kind) => {
  switch (kind) {
    case "Dashboard":
      return DashboardNode;
    case "Panel":
      return PanelNode;
    case "Source":
      return SourceNode;
    case "Grant":
      return GrantNode;
    default:
      return undefined;
  }
};
