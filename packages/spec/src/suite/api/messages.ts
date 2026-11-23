import { Schema as S } from "effect";
import {
  Artwork,
  Avatar,
  IdempotencyKey,
  PageQuery,
  PersonRef,
  Recipient,
  Timestamp,
  UserText,
} from "../primitives";

/** Message center (CONTRACT.md module M1). Bodies are plain text with `@handle` mentions; never HTML. */

export const FOLDERS = ["inbox", "sent", "starred", "archived"] as const;
export const Folder = S.Literal(...FOLDERS).annotations({ identifier: "Folder" });

export const AttachmentMeta = S.Struct({
  file_name: S.String.pipe(S.minLength(1), S.maxLength(200)),
  media_type: S.String.pipe(S.pattern(/^[a-z]+\/[a-z0-9.+-]+$/)),
  size_bytes: S.Int.pipe(S.between(1, 50_000_000)),
  sha256: S.String.pipe(S.pattern(/^[0-9a-f]{64}$/)),
}).annotations({
  identifier: "AttachmentMeta",
  description: "Metadata only; file contents are never stored",
});

export const AttachmentView = S.Struct({ attachment_id: S.UUID, ...AttachmentMeta.fields });

export const ThreadParticipant = S.Struct({
  person: PersonRef,
  role: S.Literal("from", "to", "cc"),
  via_group: S.NullOr(S.String),
}).annotations({ identifier: "ThreadParticipant" });

export const ThreadSummary = S.Struct({
  thread_id: S.UUID,
  subject: S.String,
  kind: S.Literal("direct", "group", "broadcast", "system"),
  last_message_at: Timestamp,
  last_sender: PersonRef,
  /** First 140 characters of the newest message visible to the viewer. */
  preview: S.String,
  message_count: S.Int,
  unread_count: S.Int,
  participants: S.Array(PersonRef),
  participant_count: S.Int,
  starred: S.Boolean,
  archived: S.Boolean,
  muted: S.Boolean,
  has_attachments: S.Boolean,
  mentioned: S.Boolean,
}).annotations({ identifier: "ThreadSummary" });
export type ThreadSummary = typeof ThreadSummary.Type;

export const MessageView = S.Struct({
  message_id: S.UUID,
  thread_id: S.UUID,
  sender: PersonRef,
  /** Set when an agent or automation sent it for someone. */
  on_behalf_of: S.NullOr(PersonRef),
  body: S.String,
  mentions: S.Array(PersonRef),
  sent_at: Timestamp,
  reply_to: S.NullOr(S.UUID),
  attachments: S.Array(AttachmentView),
  read_by_me: S.Boolean,
  /** Recipients who have read it (for the sender's own messages only; empty otherwise). */
  read_by: S.Array(S.Struct({ person: PersonRef, read_at: Timestamp })),
}).annotations({ identifier: "MessageView" });
export type MessageView = typeof MessageView.Type;

export const MessagesListIn = S.Struct({
  folder: S.optional(Folder),
  q: S.optional(S.String.pipe(S.maxLength(200))),
  unread_only: S.optional(S.Boolean),
  ...PageQuery,
}).annotations({ identifier: "MessagesListIn" });

export const MessagesListOut = S.Struct({
  items: S.Array(ThreadSummary),
  next_cursor: S.NullOr(S.String),
  folder_counts: S.Struct({ inbox_unread: S.Int, starred: S.Int, archived: S.Int }),
}).annotations({ identifier: "MessagesListOut" });

export const ThreadIn = S.Struct({ thread_id: S.UUID });
export const ThreadOut = S.Struct({
  thread: ThreadSummary,
  participants: S.Array(ThreadParticipant),
  messages: S.Array(MessageView),
}).annotations({ identifier: "ThreadOut" });

export const SendIn = S.Struct({
  to: S.Array(Recipient).pipe(S.minItems(1), S.maxItems(50)),
  cc: S.optional(S.Array(Recipient).pipe(S.maxItems(50))),
  subject: UserText(140).pipe(S.minLength(1)),
  body: UserText(10000).pipe(S.minLength(1)),
  attachments: S.optional(S.Array(AttachmentMeta).pipe(S.maxItems(10))),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "SendIn" });

export const SendOut = S.Struct({
  thread_id: S.UUID,
  message_id: S.UUID,
  recipient_count: S.Int,
  replayed: S.Boolean,
}).annotations({ identifier: "SendOut" });

export const ReplyIn = S.Struct({
  thread_id: S.UUID,
  body: UserText(10000).pipe(S.minLength(1)),
  reply_to: S.optional(S.UUID),
  attachments: S.optional(S.Array(AttachmentMeta).pipe(S.maxItems(10))),
  add_recipients: S.optional(S.Array(Recipient).pipe(S.maxItems(20))),
  idempotency_key: IdempotencyKey,
}).annotations({ identifier: "ReplyIn" });

export const ThreadStateFields = {
  read: S.optional(S.Boolean),
  starred: S.optional(S.Boolean),
  archived: S.optional(S.Boolean),
  muted: S.optional(S.Boolean),
};
export const ThreadStateIn = S.Struct({ thread_id: S.UUID, ...ThreadStateFields }).annotations({
  identifier: "ThreadStateIn",
});
export const BulkStateIn = S.Struct({
  thread_ids: S.Array(S.UUID).pipe(S.minItems(1), S.maxItems(100)),
  ...ThreadStateFields,
}).annotations({ identifier: "BulkStateIn" });
export const ThreadStateOut = S.Struct({
  threads: S.Array(
    S.Struct({
      thread_id: S.UUID,
      unread_count: S.Int,
      starred: S.Boolean,
      archived: S.Boolean,
      muted: S.Boolean,
    }),
  ),
}).annotations({ identifier: "ThreadStateOut" });

export const RecipientsIn = S.Struct({
  q: S.String.pipe(S.maxLength(80)),
  limit: S.optional(S.Int.pipe(S.between(1, 25))),
});
export const RecipientOption = S.Struct({
  recipient: Recipient,
  kind: S.Literal("person", "group"),
  label: S.String,
  description: S.String,
  avatar: S.NullOr(Avatar),
  artwork: S.NullOr(Artwork),
  member_count: S.NullOr(S.Int),
  /** False when the viewer may not address this group (closed posting) or would need messages:broadcast. */
  allowed: S.Boolean,
}).annotations({ identifier: "RecipientOption" });
export const RecipientsOut = S.Struct({ items: S.Array(RecipientOption) });
