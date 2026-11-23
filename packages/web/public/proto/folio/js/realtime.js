/**
 * Realtime socket. Subscribes to the whole workspace, replays a short backlog on first connect so the
 * ledger is never empty (flagged `backfill`, so nothing animates), and resumes with `since_seq` after
 * any drop so no change is missed.
 */
const BACKLOG = 8;
const RETRY_MS = [1000, 2000, 4000];

export const connect = ({ token, onState, onEvents }) => {
  let ws;
  let through;
  let ceiling = 0;
  let firstWelcome = true;
  let attempt = 0;
  let timer = 0;
  let closed = false;

  const send = (frame) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame));

  const open = () => {
    onState("connecting");
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rt`);
    ws.onopen = () => send({ t: "hello", protocol: 1, token: token() });
    ws.onmessage = (message) => {
      let frame;
      try { frame = JSON.parse(String(message.data)); } catch { return; }
      if (frame.t === "welcome") {
        let since = through;
        if (since === undefined && firstWelcome && Number.isInteger(frame.head_seq)) {
          ceiling = frame.head_seq;
          since = Math.max(0, frame.head_seq - BACKLOG);
        }
        firstWelcome = false;
        send({ t: "subscribe", sub: "s1", nodes: [], ...(since === undefined ? {} : { since_seq: since }) });
      } else if (frame.t === "subscribed") {
        through = typeof frame.through_seq === "number" ? frame.through_seq : frame.from_seq;
        attempt = 0;
        onState("live");
      } else if (frame.t === "events") {
        const gap = through !== undefined && typeof frame.prev_through === "number" && frame.prev_through > through;
        through = frame.through;
        const items = frame.items ?? [];
        const old = items.filter((e) => e.seq <= ceiling);
        const fresh = items.filter((e) => e.seq > ceiling);
        if (old.length) onEvents(old, { backfill: true, gap: false });
        if (fresh.length || gap) onEvents(fresh, { backfill: false, gap });
      } else if (frame.t === "progress") {
        through = frame.through;
      }
    };
    ws.onclose = () => {
      onState("offline");
      if (closed) return;
      timer = setTimeout(open, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
    };
  };

  const retryNow = () => {
    if (closed || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
    clearTimeout(timer);
    open();
  };
  addEventListener("online", retryNow);
  open();

  return {
    get through() { return through; },
    close() { closed = true; clearTimeout(timer); removeEventListener("online", retryNow); ws?.close(); },
  };
};
