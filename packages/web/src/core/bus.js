// The page bus (UI-MAP 3.2): one per rendered page, scoped by link group. Widgets never import each other;
// they publish and subscribe to the catalogue's topics. Payloads are `{ id }`, `{ from, to }`, `{ key, value }`.

export const createBus = () => {
  const topics = new Map(); // `${group}\u0000${topic}` -> Set<fn>
  /** Last payload per topic and group, so a widget mounting later can pick up the current selection. */
  const last = new Map();
  const keyOf = (group, topic) => `${group}\u0000${topic}`;
  const scope = (linkGroup = "page") => ({
    publish(topic, payload) {
      last.set(keyOf(linkGroup, topic), payload);
      for (const fn of [...(topics.get(keyOf(linkGroup, topic)) ?? [])]) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
    subscribe(topic, handler) {
      const key = keyOf(linkGroup, topic);
      if (!topics.has(key)) topics.set(key, new Set());
      topics.get(key).add(handler);
      return () => topics.get(key)?.delete(handler);
    },
    /** The most recent payload on a topic in this group, or undefined. */
    latest: (topic) => last.get(keyOf(linkGroup, topic)),
  });
  return {
    scope,
    /** Drop every subscription (the page host calls this when the page is torn down). */
    dispose() {
      topics.clear();
      last.clear();
    },
  };
};
