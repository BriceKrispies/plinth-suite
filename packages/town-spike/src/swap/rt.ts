// Realtime client for the town app: the same contract as packages/web/src/core/rt.js (CONTRACT 6.1). One socket to
// /rt on this origin, `hello` with the dev token and session id, then two subscriptions: `s1` the node change stream
// (the Program change that carries the site's experience) and `s2` the domain event stream. Reconnects with backoff
// 1, 2, 4, 8 s and resumes each stream from its last seq, kept in sessionStorage under the same keys as Classic.

import { sessionId, token } from "./identity";

const BACKOFF_MS = [1000, 2000, 4000, 8000];

export interface ChangeItem {
  readonly seq?: number;
  readonly node?: string;
  readonly [k: string]: unknown;
}
export interface DomainEvent {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}
export type RtState = "connecting" | "live" | "offline";

type Sub = "s1" | "s2";
const keyFor = (sub: Sub) => `plinth-rt-${sub}`;
const loadSeq = (sub: Sub): number | undefined => {
  try {
    const v = Number(sessionStorage.getItem(keyFor(sub)));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
};
const saveSeq = (sub: Sub, seq: number): void => {
  try {
    sessionStorage.setItem(keyFor(sub), String(seq));
  } catch {
    // resume then lasts for this page view
  }
};

const typeHandlers = new Map<string, Set<(ev: DomainEvent) => void>>();
const changeHandlers = new Set<{ predicate: (c: ChangeItem) => boolean; handler: (c: ChangeItem) => void }>();
const countHandlers = new Set<(counts: Record<string, number>) => void>();
const stateHandlers = new Set<(s: RtState, info: Record<string, unknown>) => void>();

let ws: WebSocket | null = null;
let attempt = 0;
let timer = 0;
let started = false;
let closed = false;
let hadConnection = false;
let state: RtState = "connecting";
const through: Record<Sub, number | undefined> = { s1: loadSeq("s1"), s2: loadSeq("s2") };

const setState = (next: RtState, info: Record<string, unknown> = {}) => {
  state = next;
  for (const fn of [...stateHandlers]) fn(next, info);
};

const safely = <T>(fn: (a: T) => void, arg: T) => {
  try {
    fn(arg);
  } catch (e) {
    console.error(e);
  }
};

const open = (): void => {
  if (!hadConnection) setState("connecting", { attempt });
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/rt`);
  ws = sock;
  const send = (frame: unknown) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(frame));
  sock.onopen = () => send({ t: "hello", protocol: 1, token: token(), client_id: sessionId() });
  sock.onmessage = (m) => {
    let f: Record<string, unknown>;
    try {
      f = JSON.parse(String(m.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (f["t"]) {
      case "welcome": {
        // First connection: start at the head so nothing replays. Reconnects resume from `through`.
        const s1 = through.s1 ?? (Number.isInteger(f["head_seq"]) ? (f["head_seq"] as number) : undefined);
        const s2 =
          through.s2 ??
          (Number.isInteger(f["domain_head_seq"]) ? (f["domain_head_seq"] as number) : undefined);
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
        const seq = typeof f["through_seq"] === "number" ? f["through_seq"] : f["from_seq"];
        const sub = f["sub"];
        if (typeof seq === "number" && (sub === "s1" || sub === "s2")) {
          through[sub] = seq;
          saveSeq(sub, seq);
        }
        if (sub === "s2") {
          const resumed = hadConnection;
          hadConnection = true;
          attempt = 0;
          setState("live", { resumed });
        }
        break;
      }
      case "events": {
        if (typeof f["through"] === "number") {
          through.s1 = f["through"];
          saveSeq("s1", f["through"]);
        }
        for (const item of (f["items"] as ChangeItem[] | undefined) ?? [])
          for (const { predicate, handler } of [...changeHandlers]) {
            let match = false;
            try {
              match = predicate(item);
            } catch (e) {
              console.error(e);
            }
            if (match) safely(handler, item);
          }
        break;
      }
      case "domain": {
        if (typeof f["through"] === "number") {
          through.s2 = f["through"];
          saveSeq("s2", f["through"]);
        }
        for (const ev of (f["items"] as DomainEvent[] | undefined) ?? []) {
          for (const fn of [...(typeHandlers.get(ev.type) ?? [])]) safely(fn, ev);
          for (const fn of [...(typeHandlers.get("*") ?? [])]) safely(fn, ev);
        }
        break;
      }
      case "progress": {
        const sub = f["sub"];
        if ((sub === "s1" || sub === "s2") && typeof f["through"] === "number") {
          through[sub] = f["through"];
          saveSeq(sub, f["through"]);
        }
        break;
      }
      case "counts":
        for (const fn of [...countHandlers]) safely(fn, (f["counts"] ?? {}) as Record<string, number>);
        break;
      default:
        break;
    }
  };
  sock.onclose = (e) => {
    if (closed) return;
    if (e.code === 4401) {
      closed = true;
      setState("offline", { revoked: true });
      return;
    }
    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 8000;
    attempt += 1;
    setState("offline", { attempt, retryInMs: wait });
    timer = window.setTimeout(open, wait);
  };
  sock.onerror = () => sock.close();
};

/** Open the socket (idempotent). */
export const connect = (): void => {
  if (started) return;
  started = true;
  closed = false;
  try {
    open();
  } catch (e) {
    console.error(e);
  }
};

export const retryNow = (): void => {
  if (state === "live" || closed) return;
  clearTimeout(timer);
  open();
};

const add = <T>(set: Set<T>, item: T) => {
  set.add(item);
  return () => set.delete(item);
};

export const on = (type: string, handler: (ev: DomainEvent) => void) => {
  let set = typeHandlers.get(type);
  if (!set) typeHandlers.set(type, (set = new Set()));
  return add(set, handler);
};

export const onChange = (predicate: (c: ChangeItem) => boolean, handler: (c: ChangeItem) => void) =>
  add(changeHandlers, { predicate, handler });

export const onCounts = (handler: (counts: Record<string, number>) => void) => add(countHandlers, handler);

export const onState = (handler: (s: RtState, info: Record<string, unknown>) => void) => {
  handler(state, {});
  return add(stateHandlers, handler);
};

export const getState = (): RtState => state;
export const isOpen = (): boolean => ws?.readyState === WebSocket.OPEN;
