import { describe, expect, it } from "vitest";
import { describeEvent } from "../src/suite/handlers/activity3";
import { decodeCursor, encodeCursor, limitOf, mentionHandles, pgArr } from "../src/suite/handlers/util3";
import { hoursCovered, isoWeekKey, isoWeekday } from "../../worker/src/engines/digests";
import { inQuietHours } from "../../worker/src/engines/maintenance";

// No database: the pure helpers of the communications and administration handlers and the digest and quiet-hour rules.

describe("handler helpers", () => {
  it("extracts @handle mentions once, and not from the middle of words or addresses", () => {
    expect(mentionHandles("Thanks @ben-carter and @ben-carter, cc @ana-silva!")).toEqual([
      "ben-carter",
      "ana-silva",
    ]);
    expect(mentionHandles("mail me at ben@example.com")).toEqual([]);
    expect(mentionHandles("(@maya-ortiz) and @x")).toEqual(["maya-ortiz"]);
  });

  it("round-trips opaque cursors and ignores garbage", () => {
    const c = encodeCursor(["2026-11-20T14:30:00.000000Z", 1, "42"]);
    expect(decodeCursor(c)).toEqual(["2026-11-20T14:30:00.000000Z", "1", "42"]);
    expect(decodeCursor("not-base64-json")).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(limitOf(undefined)).toBe(50);
    expect(limitOf(900)).toBe(200);
    expect(limitOf(0)).toBe(1);
  });

  it("quotes array literals for text[] and uuid[] parameters", () => {
    expect(pgArr(["a", 'b"c', "d\\e"])).toBe('{"a","b\\"c","d\\\\e"}');
    expect(pgArr([])).toBe("{}");
  });

  it("describes events with Plinth-authored sentences that never embed free text", () => {
    expect(
      describeEvent("points.posted", { delta: -1500, txn_type: "purchase", memo: "<script>" }),
    ).toMatchObject({
      summary: "Spent 1,500 points (purchase)",
      icon: "coins",
    });
    expect(describeEvent("tier.changed", { from: "silver", to: "gold" }).summary).toBe(
      "Moved from silver to gold",
    );
    const msg = describeEvent("message.sent", { thread_id: "t", recipient_count: 1, subject: "secret" });
    expect(msg.summary).toBe("Sent a message to 1 person");
    expect(msg.summary).not.toContain("secret");
    expect(
      describeEvent("order.placed", { order_no: "R-000123", order_id: "o", total_points: 4200 }).link,
    ).toBe("/store/orders/o");
  });
});

describe("digest timing", () => {
  it("numbers ISO weekdays and weeks", () => {
    expect(isoWeekday(new Date("2026-11-16T12:00:00Z"))).toBe(1);
    expect(isoWeekday(new Date("2026-11-22T12:00:00Z"))).toBe(7);
    expect(isoWeekKey(new Date("2026-11-20T08:00:00Z"))).toBe("2026-W47");
    expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekKey(new Date("2027-01-03T00:00:00Z"))).toBe("2026-W53");
  });

  it("covers the hour of the tick, or every hour a gap collapsed, capped at three days", () => {
    const bucket = new Date("2026-11-20T08:00:00Z");
    expect(hoursCovered(null, bucket).map((d) => d.toISOString())).toEqual(["2026-11-20T08:00:00.000Z"]);
    expect(hoursCovered(new Date("2026-11-20T07:00:00Z"), bucket)).toHaveLength(1);
    expect(hoursCovered(new Date("2026-11-20T05:00:00Z"), bucket).map((d) => d.getUTCHours())).toEqual([
      6, 7, 8,
    ]);
    expect(hoursCovered(new Date("2026-10-01T00:00:00Z"), bucket)).toHaveLength(72);
  });

  it("treats quiet hours as a window that may wrap midnight", () => {
    expect(inQuietHours(23, 21, 6)).toBe(true);
    expect(inQuietHours(3, 21, 6)).toBe(true);
    expect(inQuietHours(12, 21, 6)).toBe(false);
    expect(inQuietHours(9, 8, 17)).toBe(true);
    expect(inQuietHours(9, 8, 8)).toBe(false);
  });
});
