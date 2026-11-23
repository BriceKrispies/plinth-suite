import { token } from "./identity.js";

const BACKFILL = 24; // how many recent changes the trace is seeded with on first connect
const MAX_DELAY = 8000;

/**
 * Realtime client. Resumes with `since_seq` after a drop so no change is missed. Events at or below the
 * head sequence seen on first connect are flagged `backfill`: they seed the trace but never animate.
 */
export const connect = ({ onState, onEvents, onHead }) => {
  let ws;
  let through;
  let firstHead;
  let attempt = 0;
  let closed = false;
  let timer;

  const send = (frame) => ws?.send(JSON.stringify(frame));

  const open = () => {
    onState("connecting", attempt);
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rt`);
    ws.onopen = () => send({ t: "hello", protocol: 1, token: token() });
    ws.onmessage = (message) => {
      let frame;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (frame.t === "welcome") {
        if (firstHead === undefined) firstHead = frame.head_seq ?? 0;
        onHead(frame.head_seq ?? 0);
        const since = through ?? Math.max(0, firstHead - BACKFILL);
        send({ t: "subscribe", sub: "s1", nodes: [], since_seq: since });
      } else if (frame.t === "subscribed") {
        through = typeof frame.through_seq === "number" ? frame.through_seq : frame.from_seq;
        attempt = 0;
        onState("live", 0);
      } else if (frame.t === "events") {
        through = frame.through;
        onHead(frame.through);
        onEvents(frame.items.map((item) => ({ ...item, backfill: item.seq <= firstHead })));
      } else if (frame.t === "progress") {
        through = frame.through;
        onHead(frame.through);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      attempt += 1;
      onState("offline", attempt);
      timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), MAX_DELAY));
    };
  };

  open();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
};
