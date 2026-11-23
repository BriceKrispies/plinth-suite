import { JSONSchema, Schema } from "effect";
import * as S from "../src/index";

/** Writes JSON Schema for every public schema into packages/spec/generated (AC-FND-3, schema_no_drift). */
export const SCHEMAS: Record<string, Schema.Schema.AnyNoContext> = {
  Dashboard: S.DashboardNode,
  Panel: S.PanelNode,
  Source: S.SourceNode,
  Grant: S.GrantNode,
  QueryAst: S.QueryAst,
  ChangeOp: S.Op,
  ChangeSet: S.ChangeSet,
  CommitRequest: S.CommitRequest,
  CommitResult: S.CommitResult,
  Envelope: S.Envelope,
  ErrorBody: S.ErrorBody,
  QueryRunInput: S.QueryRunInput,
  QueryResult: S.QueryResult,
  "mcp.node.get": S.NodeGetInput,
  "mcp.node.preview": S.NodePreviewInput,
  "mcp.node.commit": S.NodeCommitInput,
  "mcp.source.list": S.SourceListInput,
  "mcp.schema.describe": S.SchemaDescribeInput,
  "mcp.node.search": S.NodeSearchInput,
  "mcp.node.delete": S.NodeDeleteInput,
  "mcp.node.undo": S.NodeUndoInput,
  "mcp.change.history": S.ChangeHistoryInput,
  "mcp.diff": S.DiffInput,
  "mcp.grant.check": S.GrantCheckInput,
  "mcp.ui.present": S.UiPresentInput,
  "mcp.change.status": S.ChangeStatusInput,
  "mcp.query.explain": S.QueryExplainInput,
  RtClientFrame: S.ClientFrame,
  RtServerFrame: S.ServerFrame,
  // Plinth Suite (docs/suite/CONTRACT.md)
  "suite.Product": S.ProductNode,
  "suite.Category": S.CategoryNode,
  "suite.Badge": S.BadgeNode,
  "suite.Promotion": S.PromotionNode,
  "suite.Automation": S.AutomationNode,
  "suite.Content": S.ContentNode,
  "suite.Segment": S.SegmentNode,
  "suite.Group": S.GroupNode,
  "suite.Role": S.RoleNode,
  "suite.Preference": S.PreferenceNode,
  "suite.Program": S.ProgramNode,
  "suite.Widget": S.WidgetNode,
  "suite.Page": S.PageNode,
  "suite.CondTree": S.CondTree,
  "suite.MemberFacts": S.MemberFacts,
  "suite.DomainEvent": S.DomainEvent,
  "suite.NavCounts": S.NavCounts,
  "suite.PromoEvalInput": S.PromoEvalInput,
  "suite.PromoEvaluation": S.PromoEvaluation,
  "suite.RunDetail": S.RunDetail,
  "suite.DryRunResult": S.DryRunResult,
  "suite.ActionInvokeIn": S.ActionInvokeIn,
  "suite.ActionInvokeOut": S.ActionInvokeOut,
  "suite.ActionsListOut": S.ActionsListOut,
  "mcp.action.list": S.ActionListInput,
  "mcp.action.invoke": S.ActionInvokeInput,
};

const NL = String.fromCharCode(10);

/** Every Suite action with its route, permission, agent policy and input/output JSON Schema, in registry order. */
const suiteActionsCatalogue = (): string =>
  JSON.stringify(
    S.ACTIONS.map((a) => ({
      name: a.name,
      module: a.module,
      method: a.method,
      path: a.path,
      permission: a.permission,
      mutating: a.mutating,
      agent: a.agent,
      summary: a.summary,
      reasons: a.reasons,
      events: a.events,
      input: JSONSchema.make(a.input),
      output: JSONSchema.make(a.output),
    })),
    null,
    2,
  ) + NL;

/** The Suite reporting Sources and the Postgres view each one reads. */
const suiteSources = (): string =>
  JSON.stringify(
    S.SUITE_SOURCES.map((x) => ({ view: x.view, source: x.body })),
    null,
    2,
  ) + NL;

/** The widget catalogue with each widget's config JSON Schema (also copied to the web client by schema-gen). */
export const suiteWidgets = (): string =>
  JSON.stringify(
    S.WIDGET_CATALOGUE.map((w) => ({
      id: w.id,
      domain: w.domain,
      title: w.title,
      description: w.description,
      pkg: w.pkg,
      sizes: w.sizes,
      default_size: w.default_size,
      grid: Object.fromEntries(w.sizes.map((z) => [z, S.SIZE_GRID[z]])),
      config_schema: JSONSchema.make(w.config),
      views: w.views,
      actions: w.actions,
      events: w.events,
      publishes: w.publishes,
      subscribes: w.subscribes,
      permission: w.permission,
    })),
    null,
    2,
  ) + NL;

export const renderAll = (): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(SCHEMAS).map(([name, schema]) => [
      `${name}.schema.json`,
      JSON.stringify(JSONSchema.make(schema), null, 2) + NL,
    ]),
  ),
  "suite.actions.json": suiteActionsCatalogue(),
  "suite.sources.json": suiteSources(),
  "suite.widgets.json": suiteWidgets(),
});
