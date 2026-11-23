import { Effect } from "effect";
import { ControlStore, loadProgram, newId, store } from "@plinth/engine";
import type { TickHook } from "../hooks";
import { inQuietHours } from "./maintenance";

/**
 * Hourly digests (CONTRACT.md 12.3). At each member's `digest.hour_utc` (and weekday, for weekly digests) one
 * `notification_deliveries` row of channel `digest` is built per period (`2026-11-20` daily, `2026-W47` weekly) from the
 * member's notifications of that window whose type has `digest` on. The unique `(recipient, channel, digest_period)` makes the
 * hook idempotent: a replayed tick, or a window that a long gap collapsed into one tick, never produces a second digest.
 * A digest that falls inside the member's quiet hours is recorded as suppressed (`quiet_hours`).
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A collapsed gap is walked hour by hour, at most this many hours back. */
const MAX_CATCH_UP_HOURS = 72;

/** ISO weekday 1 (Monday) to 7 (Sunday). */
export const isoWeekday = (d: Date): number => ((d.getUTCDay() + 6) % 7) + 1;

/** `2026-W47`: the ISO 8601 week of a UTC instant. */
export const isoWeekKey = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - isoWeekday(t));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

interface Prefs {
  digest?: { frequency: "off" | "daily" | "weekly"; hour_utc: number; weekday?: number };
  notifications?: Record<string, { digest?: boolean }>;
  quiet_hours?: { start_hour: number; end_hour: number };
}

/** The hour starts a tick covers: after `previous` up to and including `bucket`. Pure. */
export const hoursCovered = (previous: Date | null, bucket: Date): ReadonlyArray<Date> => {
  const out: Date[] = [];
  const first = previous === null ? bucket.getTime() : previous.getTime() + HOUR;
  for (
    let t = Math.max(first, bucket.getTime() - (MAX_CATCH_UP_HOURS - 1) * HOUR);
    t <= bucket.getTime();
    t += HOUR
  )
    out.push(new Date(t));
  return out;
};

export const digestHourly: TickHook = (tick, ctx) =>
  Effect.gen(function* () {
    const { sql } = yield* ControlStore;
    const ws = ctx.workspaceId;
    const program = yield* store(loadProgram(ws));
    const members = yield* store(
      sql<{ member_id: string; handle: string; display_name: string; spec: Prefs | null }>`
        SELECT m.member_id, m.handle, p.display_name, n.body -> 'spec' AS spec
        FROM members m JOIN principals p ON p.principal_id = m.member_id
        LEFT JOIN nodes n ON n.workspace_id = m.workspace_id AND n.kind = 'Preference' AND n.slug = 'prefs.' || m.handle
                         AND n.deleted_at IS NULL
        WHERE m.workspace_id = ${ws} AND p.disabled_at IS NULL ORDER BY m.handle`,
    );
    const defaults = program.notification_defaults as unknown as Record<string, { digest: boolean }>;
    for (const at of hoursCovered(tick.previous, tick.bucket)) {
      for (const m of members) {
        const d = m.spec?.digest ?? program.digest_default;
        if (d.frequency === "off" || d.hour_utc !== at.getUTCHours()) continue;
        if (d.frequency === "weekly" && (d.weekday ?? 1) !== isoWeekday(at)) continue;
        const period = d.frequency === "daily" ? dayKey(at) : isoWeekKey(at);
        const from = new Date(at.getTime() - (d.frequency === "daily" ? DAY : 7 * DAY));
        const rows = yield* store(
          sql<{ notification_id: string; type: string; title: string }>`
            SELECT notification_id, type, title FROM notifications
            WHERE recipient_id = ${m.member_id} AND created_at > ${from.toISOString()}::timestamptz
              AND created_at <= ${at.toISOString()}::timestamptz ORDER BY created_at, notification_id`,
        );
        const included = rows.filter(
          (r) => (m.spec?.notifications?.[r.type]?.digest ?? defaults[r.type]?.digest) === true,
        );
        if (included.length === 0) continue;
        const counts = new Map<string, number>();
        for (const r of included) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
        const summary = [...counts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
          .join(", ");
        const q = m.spec?.quiet_hours;
        const quiet = q !== undefined && inQuietHours(at.getUTCHours(), q.start_hour, q.end_hour);
        yield* store(
          sql`INSERT INTO notification_deliveries (delivery_id, workspace_id, recipient_id, channel, status, suppressed_reason,
                                                    subject, body, notification_ids, digest_period, created_at, sent_at)
              VALUES (${newId()}, ${ws}, ${m.member_id}, 'digest', ${quiet ? "suppressed" : "sent"},
                      ${quiet ? "quiet_hours" : null},
                      ${`Your ${d.frequency} digest: ${included.length} update${included.length === 1 ? "" : "s"}`},
                      ${summary}, ${`{${included.map((r) => r.notification_id).join(",")}}`}::uuid[], ${period},
                      ${at.toISOString()}::timestamptz, ${quiet ? null : at.toISOString()}::timestamptz)
              ON CONFLICT (recipient_id, channel, digest_period) DO NOTHING`,
        );
      }
    }
  });
