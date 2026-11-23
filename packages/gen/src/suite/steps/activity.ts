import { Effect } from "effect";
import type { SeedStep } from "../seed";
import { activityComms } from "./activity-comms";
import { activityEngagement } from "./activity-engagement";
import { activityMarketing } from "./activity-marketing";

export { activityComms };

/**
 * Seed step `activity` (CONTRACT.md 11.8): the 90-day history replayed through the real action handlers at each
 * command's virtual timestamp, draining the engines after each command. Each domain group contributes its part:
 * engagement (awards, orders, transfers, expiry, reviews, manual badges), marketing and content, and communications
 * (messages, notifications, tasks, preference and profile edits, the held role change, badge showcases). The
 * communications part runs after the awards so showcases have badges to show.
 */
export const activityStep: SeedStep = {
  name: "activity",
  spec: "11.8",
  run: (ctx) =>
    Effect.gen(function* () {
      yield* activityEngagement(ctx);
      yield* activityMarketing(ctx);
      yield* activityComms(ctx);
    }),
};
