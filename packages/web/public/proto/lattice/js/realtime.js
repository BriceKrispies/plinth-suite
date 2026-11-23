import { token } from './identity.js';

const BACKFILL = 14; // recent events replayed on first connect so the trace is not empty

/**
 * Workspace-wide realtime subscription. Reconnects with backoff and resumes from the last
 * `through` cursor via `since_seq`, so no change is missed. Events at or below the head seen at
 * first welcome are flagged `replayed`: they fill the trace but must never animate anything.
 */
export const connect = ({ onState, onEvents, onHead }) => {
  let ws;
  let through;
  let firstHead;
  let attempt = 0;
  let timer;
  let closed = false;

  const send = (frame) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame));

  const handle = (f) => {
    if (f.t === 'welcome') {
      firstHead ??= f.head_seq;
      onHead?.(f.head_seq);
      const since = through ?? Math.max(0, f.head_seq - BACKFILL);
      send({ t: 'subscribe', sub: 's1', nodes: [], since_seq: since });
    } else if (f.t === 'subscribed') {
      through = typeof f.through_seq === 'number' ? f.through_seq : f.from_seq;
      attempt = 0;
      onState('live');
    } else if (f.t === 'events') {
      through = f.through;
      const items = f.items.filter((e) => e.kind !== 'present');
      const replayed = items.filter((e) => e.seq <= firstHead);
      const live = items.filter((e) => e.seq > firstHead);
      if (replayed.length) onEvents(replayed, { replayed: true });
      if (live.length) onEvents(live, { replayed: false });
    } else if (f.t === 'progress') {
      through = f.through;
      onHead?.(f.through);
    }
  };

  const open = () => {
    onState(through === undefined ? 'connecting' : 'reconnecting');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/rt`);
    ws.onopen = () => send({ t: 'hello', protocol: 1, token: token() });
    ws.onmessage = (m) => {
      try {
        handle(JSON.parse(String(m.data)));
      } catch {
        /* malformed frame: ignore */
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (closed) return;
      onState('offline');
      attempt += 1;
      timer = setTimeout(open, Math.min(1000 * 2 ** (attempt - 1), 8000));
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
