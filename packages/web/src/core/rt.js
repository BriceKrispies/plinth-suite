// Realtime client: one socket, two subscriptions (CONTRACT 6.1). `s1` is the node change stream, `s2` the
// domain event stream. Reconnects with backoff 1, 2, 4, 8 s and resumes each stream from its last seq,
// kept in sessionStorage so a reload resumes too.
import { token, sessionId, markRevoked } from "./identity.js";

const BACKOFF_MS = [1000, 2000, 4000, 8000];

const keyFor = (sub) => `plinth-rt-${sub}`;
const loadSeq = (sub) => {
  try {
    const v = Number(sessionStorage.getItem(keyFor(sub)));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
};
const saveSeq = (sub, seq) => {
  try {
    sessionStorage.setItem(keyFor(sub), String(seq));
  } catch {
    /* resume then lasts for this page view */
  }
};

const typeHandlers = new Map(); // type | "*" -> Set<fn>
const changeHandlers = new Set(); // { predicate, handler }
const countHandlers = new Set();
const stateHandlers = new Set();
const revokedHandlers = new Set();
const presentHandlers = new Set();

let ws;
let attempt = 0;
let timer = 0;
let closed = false;
let started = false;
let hadConnection = false;
let state = "connecting";
const through = { s1: loadSeq("s1"), s2: loadSeq("s2") };

const setState = (next, info = {}) => {
  state = next;
  for (const fn of [...stateHandlers]) fn(next, info);
};

const safely = (fn, arg) => {
  try {
    fn(arg);
  } catch (e) {
    console.error(e);
  }
};

const deliverDomain = (items) => {
  for (const ev of items) {
    for (const fn of [...(typeHandlers.get(ev.type) ?? [])]) safely(fn, ev);
    for (const fn of [...(typeHandlers.get("*") ?? [])]) safely(fn, ev);
  }
};

const deliverChanges = (items) => {
  for (const item of items) {
    for (const { predicate, handler } of [...changeHandlers]) {
      let match = false;
      try {
        match = predicate(item);
      } catch (e) {
        console.error(e);
      }
      if (match) safely(handler, item);
    }
  }
};

const open = () => {
  if (!hadConnection) setState("connecting", { attempt });
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/rt`);
  const send = (frame) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(frame));
  ws.onopen = () => send({ t: "hello", protocol: 1, token: token(), client_id: sessionId() });
  ws.onmessage = (m) => {
    let f;
    try {
      f = JSON.parse(String(m.data));
    } catch {
      return;
    }
    switch (f.t) {
      case "welcome": {
        // First ever connection: start at the head so nothing replays. Reconnects resume from `through`.
        const s1 = through.s1 ?? (Number.isInteger(f.head_seq) ? f.head_seq : undefined);
        const s2 = through.s2 ?? (Number.isInteger(f.domain_head_seq) ? f.domain_head_seq : undefined);
        send({
          t: "subscribe",
          sub: "s1",
          stream: "changes",
          nodes: [],
          ...(s1 === undefined ? {} : { since_seq: s1 }),
        });
        send({ t: "subscribe", sub: "s2", stream: "domain", ...(s2 === undefined ? {} : { since_seq: s2 }) });
        break;
      }
      case "subscribed": {
        const seq = typeof f.through_seq === "number" ? f.through_seq : f.from_seq;
        if (typeof seq === "number" && (f.sub === "s1" || f.sub === "s2")) {
          through[f.sub] = seq;
          saveSeq(f.sub, seq);
        }
        if (f.sub === "s2") {
          const resumed = hadConnection;
          hadConnection = true;
          attempt = 0;
          setState("live", { resumed });
        }
        break;
      }
      case "events":
        if (typeof f.through === "number") {
          through.s1 = f.through;
          saveSeq("s1", f.through);
        }
        deliverChanges(f.items ?? []);
        break;
      case "domain":
        if (typeof f.through === "number") {
          through.s2 = f.through;
          saveSeq("s2", f.through);
        }
        deliverDomain(f.items ?? []);
        break;
      case "progress":
        if (f.sub === "s1" || f.sub === "s2") {
          through[f.sub] = f.through;
          saveSeq(f.sub, f.through);
        }
        break;
      case "present":
        for (const fn of [...presentHandlers]) safely(fn, f);
        break;
      case "counts":
        for (const fn of [...countHandlers]) safely(fn, f.counts);
        break;
      default:
        break;
    }
  };
  ws.onclose = (e) => {
    if (closed) return;
    if (e.code === 4401) {
      closed = true;
      markRevoked();
      for (const fn of [...revokedHandlers]) safely(fn);
      return;
    }
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    setState("offline", { attempt, retryInMs: wait });
    timer = setTimeout(open, wait);
  };
  ws.onerror = () => ws.close();
};

/** Open the socket (idempotent). */
export const connect = () => {
  if (started) return;
  started = true;
  closed = false;
  open();
};

/** Close the socket and stop reconnecting. */
export const disconnect = () => {
  closed = true;
  clearTimeout(timer);
  ws?.close();
};

/** Retry now instead of waiting for the backoff (the offline banner's button). */
export const retryNow = () => {
  if (state === "live" || closed) return;
  clearTimeout(timer);
  open();
};

const add = (set, item) => {
  set.add(item);
  return () => set.delete(item);
};

/** Domain events by type, or "*" for all. The handler receives the whole event: `{ seq, type, payload, ... }`. */
export const on = (type, handler) => {
  if (!typeHandlers.has(type)) typeHandlers.set(type, new Set());
  return add(typeHandlers.get(type), handler);
};

/** Change-stream items (`{ seq, node, rev, actor, surface, ... }`) accepted by `predicate`. */
export const onChange = (predicate, handler) => add(changeHandlers, { predicate, handler });

export const onCounts = (handler) => add(countHandlers, handler);

/** `"connecting" | "live" | "offline"`; the handler runs for each change, with `{ attempt, retryInMs, resumed }`. */
export const onState = (handler) => {
  handler(state, {});
  return add(stateHandlers, handler);
};

/** `ui.present` frames for this viewer: `{ node, target, focus, by, at }`. Not replayed after a reconnect. */
export const onPresent = (handler) => add(presentHandlers, handler);

export const onSessionRevoked = (handler) => add(revokedHandlers, handler);

export const getState = () => state;
