import { token } from "./identity.js";

const BACKOFF_MS = [1000, 2000, 4000, 8000];

/**
 * Realtime client for /rt. Reconnects with backoff and resumes from the last seen sequence
 * number (since_seq) so no change is missed.
 *
 * handlers: { onState(state, info), onEvents(items), onHead(seq) }
 * state is "connecting" | "live" | "offline".
 * Returns a function that closes the connection.
 */
export const connectRealtime = ({ onState, onEvents, onHead }) => {
  let ws;
  let through;
  let attempt = 0;
  let timer;
  let closed = false;
  let hadConnection = false;

  const open = () => {
    if (!hadConnection) onState("connecting", { attempt });
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/rt`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", protocol: 1, token: token() }));
    ws.onmessage = (m) => {
      let f;
      try {
        f = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (f.t === "welcome") {
        const since = through !== undefined ? { since_seq: through } : {};
        ws.send(JSON.stringify({ t: "subscribe", sub: "s1", nodes: [], ...since }));
        if (typeof f.head_seq === "number") onHead?.(f.head_seq);
      } else if (f.t === "subscribed") {
        through = typeof f.through_seq === "number" ? f.through_seq : f.from_seq;
        const resumed = hadConnection;
        hadConnection = true;
        attempt = 0;
        onState("live", { through, resumed });
      } else if (f.t === "events") {
        through = f.through;
        onHead?.(f.through);
        onEvents(f.items ?? []);
      } else if (f.t === "progress") {
        through = f.through;
        onHead?.(f.through);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      onState("offline", { attempt, retryInMs: wait });
      timer = setTimeout(open, wait);
    };
    ws.onerror = () => ws.close();
  };

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    ws?.close();
  };
};
