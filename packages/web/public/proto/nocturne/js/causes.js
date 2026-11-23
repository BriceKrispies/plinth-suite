export const CAUSE_MS = 6000;

const newest = (events) => events.reduce((a, b) => (b.seq > a.seq ? b : a));

/**
 * Animation honesty: decide which panels changed because of a realtime event, and which event.
 * Returns slug -> {seq, actor, surface, verb}. No events means no causes, so nothing animates.
 */
export const attributeCauses = (prevPanels, nextPanels, events) => {
  const out = new Map();
  if (events.length === 0) return out;
  const before = new Map(prevPanels.map((p) => [p.slug, p]));
  const latest = newest(events);
  for (const p of nextPanels) {
    const old = before.get(p.slug);
    const changed =
      !old ||
      old.node?.revision !== p.node?.revision ||
      old.result?.result_hash !== p.result?.result_hash ||
      old.error?.code !== p.error?.code;
    if (!changed) continue;
    const own = events.filter((e) => e.node === p.node?.uri);
    const cause = own.length > 0 ? newest(own) : latest;
    out.set(p.slug, { seq: cause.seq, actor: cause.actor, surface: cause.surface, verb: old ? "updated" : "added" });
  }
  return out;
};
