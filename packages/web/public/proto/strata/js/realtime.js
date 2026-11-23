/**
 * Realtime subscription to /rt for the whole workspace. Reconnects with backoff and resumes from the
 * last seq it saw (`since_seq`), so no change is missed across an outage.
 */
export function connect({ token, onState, onEvents }) {
  let socket;
  let through;
  let attempt = 0;
  let retry;
  let closed = false;

  const open = () => {
    onState(attempt === 0 ? "connecting" : "offline");
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/rt`);
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", protocol: 1, token }));
    ws.onmessage = (message) => {
      if (socket !== ws) return;
      let frame;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (frame.t === "welcome") {
        const since = through === undefined ? {} : { since_seq: through };
        ws.send(JSON.stringify({ t: "subscribe", sub: "s1", nodes: [], ...since }));
      } else if (frame.t === "subscribed") {
        through = typeof frame.through_seq === "number" ? frame.through_seq : frame.from_seq;
        attempt = 0;
        onState("live");
      } else if (frame.t === "events") {
        through = frame.through;
        onEvents(frame.items ?? []);
      } else if (frame.t === "progress") {
        through = frame.through;
      }
    };
    ws.onclose = () => {
      if (socket !== ws || closed) return;
      onState("offline");
      attempt += 1;
      retry = setTimeout(open, Math.min(500 * 2 ** (attempt - 1), 8000));
    };
    ws.onerror = () => ws.close();
  };

  const wake = () => {
    if (closed || socket?.readyState === WebSocket.OPEN) return;
    clearTimeout(retry);
    open();
  };
  window.addEventListener("online", wake);
  open();

  return {
    close() {
      closed = true;
      clearTimeout(retry);
      window.removeEventListener("online", wake);
      socket?.close();
    },
  };
}
