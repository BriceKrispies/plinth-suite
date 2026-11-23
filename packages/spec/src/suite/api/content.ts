import { Schema as S } from "effect";
import { ContentStatus, Reaction } from "../events";
import { ContentBlock, ContentSpec } from "../nodes";
import { Artwork, NodeLink, PageQuery, PersonRef, Timestamp, UserText } from "../primitives";

/** Content (CMS) (CONTRACT.md module M8). Content nodes are edited through POST /changes while in draft. */

export const ContentSummary = S.Struct({
  node: NodeLink,
  type: S.Literal("page", "article", "announcement"),
  status: ContentStatus,
  /** "scheduled" when approved with a future publish_at; "live" when published_revision is set and not archived. */
  display_status: S.Literal(
    "draft",
    "in_review",
    "approved",
    "scheduled",
    "published",
    "revising",
    "archived",
  ),
  summary: S.String,
  hero: Artwork,
  tags: S.Array(S.String),
  author: PersonRef,
  reviewers: S.Array(PersonRef),
  updated_at: Timestamp,
  publish_at: S.NullOr(Timestamp),
  published_revision: S.NullOr(S.Int),
  views: S.Int,
  reactions: S.Int,
}).annotations({ identifier: "ContentSummary" });

export const ContentListIn = S.Struct({
  status: S.optional(S.Array(ContentStatus)),
  type: S.optional(S.Literal("page", "article", "announcement")),
  tag: S.optional(S.String),
  author: S.optional(S.String),
  awaiting_my_review: S.optional(S.Boolean),
  q: S.optional(S.String.pipe(S.maxLength(120))),
  ...PageQuery,
});
export const ContentListOut = S.Struct({
  items: S.Array(ContentSummary),
  next_cursor: S.NullOr(S.String),
  status_counts: S.Record({ key: ContentStatus, value: S.Int }),
});

export const CONTENT_ACTIONS = [
  "submit",
  "approve",
  "request_changes",
  "publish",
  "schedule",
  "unschedule",
  "revise",
  "archive",
  "restore",
] as const;
export const ContentAction = S.Literal(...CONTENT_ACTIONS).annotations({ identifier: "ContentAction" });

export const ContentTransitionIn = S.Struct({
  slug: S.String,
  action: ContentAction,
  note: S.optional(UserText(500)),
  /** Required for schedule. */
  publish_at: S.optional(Timestamp),
  base_revision: S.Int,
}).annotations({ identifier: "ContentTransitionIn" });

export const FeedItem = S.Struct({
  slug: S.String,
  title: S.String,
  type: S.Literal("page", "article", "announcement"),
  summary: S.String,
  hero: Artwork,
  tags: S.Array(S.String),
  author: PersonRef,
  published_at: Timestamp,
  pinned: S.Boolean,
  views: S.Int,
  reactions: S.Record({ key: Reaction, value: S.Int }),
  my_reaction: S.NullOr(Reaction),
  seen: S.Boolean,
}).annotations({ identifier: "FeedItem" });
export const FeedIn = S.Struct({
  type: S.optional(S.Literal("page", "article", "announcement")),
  tag: S.optional(S.String),
  ...PageQuery,
});
export const FeedOut = S.Struct({ items: S.Array(FeedItem), next_cursor: S.NullOr(S.String) });

export const PublishedIn = S.Struct({ slug: S.String });
export const PublishedOut = S.Struct({
  item: FeedItem,
  revision: S.Int,
  blocks: S.Array(ContentBlock),
}).annotations({ identifier: "PublishedOut" });

export const EngageIn = S.Struct({
  slug: S.String,
  view: S.optional(S.Boolean),
  reaction: S.optional(S.NullOr(Reaction)),
});
export const EngageOut = S.Struct({
  views: S.Int,
  reactions: S.Record({ key: Reaction, value: S.Int }),
  my_reaction: S.NullOr(Reaction),
});

export const VersionsIn = S.Struct({ slug: S.String });
export const VersionView = S.Struct({
  revision: S.Int,
  change_seq: S.Int,
  actor: PersonRef,
  at: Timestamp,
  status: ContentStatus,
  paths: S.Array(S.String),
  reason: S.NullOr(S.String),
  published: S.Boolean,
}).annotations({ identifier: "VersionView" });
export const VersionsOut = S.Struct({
  items: S.Array(VersionView),
  head: S.Int,
  published_revision: S.NullOr(S.Int),
});

export const ContentDiffIn = S.Struct({ slug: S.String, from: S.Int, to: S.Int });
export const BlockDiff = S.Struct({
  index: S.Int,
  change: S.Literal("added", "removed", "modified", "moved", "unchanged"),
  before: S.NullOr(ContentBlock),
  after: S.NullOr(ContentBlock),
  from_index: S.NullOr(S.Int),
}).annotations({ identifier: "BlockDiff" });
export const ContentDiffOut = S.Struct({
  from: S.Int,
  to: S.Int,
  changed_paths: S.Array(S.String),
  human_summary: S.String,
  fields: S.Array(S.Struct({ path: S.String, before: S.Unknown, after: S.Unknown })),
  blocks: S.Array(BlockDiff),
}).annotations({ identifier: "ContentDiffOut" });

export const ContentPreviewIn = S.Struct({ slug: S.String, revision: S.optional(S.Int) });
export const ContentPreviewOut = S.Struct({ node: NodeLink, spec: ContentSpec, revision: S.Int });
