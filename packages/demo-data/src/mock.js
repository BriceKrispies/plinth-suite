// Demo mode runtime (no backend): serves `/api/...` from recordings of the seeded stack, simulates the common writes
// in a per-tab overlay, and stands in for the `/rt` realtime socket. Shared by Classic (packages/web) and Township
// (packages/town-spike); plain ES module, no dependencies.
//
// Recordings (written by scripts/demo-record.ts, published at `<base>demo-data/`):
//   manifest.json   { format, recorded_at, default_persona, personas, routes, empty, events }
//   shared.json     { responses: { <hash>: { s, j } } }          bodies used by two or more personas
//   <persona>.json  { persona, entries: [{ m, p, q, b, h }], responses: { <hash>: { s, j } }, events }
// `m` method, `p` path after /api, `q` canonical query string, `b` JSON body (or null), `h` response hash;
// `s` HTTP status, `j` the JSON envelope `{ ok, data | error }` as the API sent it.
//
// Lookup for a read: exact (method, path, query, body) -> the same action with a relaxed input (paging, cursor,
// limit and sort ignored; a cursor that was never recorded ends the list) -> the same lookup in the default persona
// -> an empty result shaped like the action's recorded output -> NOT_FOUND. Misses are logged once each.

const DEFAULT_PERSONA = "maya-ortiz";
const PAGING = new Set(["cursor", "limit", "sort", "page", "offset", "page_size", "order"]);
const OVERLAY_KEY = "plinth-demo:overlay:";
const SITE_KEY = "plinth-demo:site";
const SEQ_KEY = "plinth-demo:seq";
const BANNER_KEY = "plinth-demo:banner";

let state = null;

// ---------------------------------------------------------------- small helpers

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** JSON with object keys sorted at every depth; `idempotency_key` fields are dropped (random per intent). */
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => k !== "idempotency_key" && v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
};

const canonQuery = (q) => {
  const p = new URLSearchParams(q ?? "");
  return [...p.entries()]
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
};

const keyOf = (m, p, q, b) => `${m} ${p}?${canonQuery(q)} ${b === null || b === undefined ? "" : canon(b)}`;

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

const nowIso = () => new Date().toISOString();
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const readStore = (key, fallback) => {
  try {
    const v = sessionStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const writeStore = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the overlay lasts for this page view */
  }
};

const warned = new Set();
const missOnce = (what) => {
  if (warned.has(what)) return;
  warned.add(what);
  console.info(`[demo] no recording for ${what}`);
};

const personaFromUrl = () => {
  const as = new URLSearchParams(location.search).get("as");
  if (!as) return DEFAULT_PERSONA;
  return as.startsWith("dev-") ? as.replace(/^dev-(user-)?/, "") : as;
};

const titleCase = (handle) =>
  String(handle)
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

// ---------------------------------------------------------------- recordings

const loadJson = (name) => {
  state.files[name] ??= state
    .realFetch(`${state.dataUrl}${name}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return state.files[name];
};

/** Index of one persona's recording: exact keys and, per action, the recorded inputs. */
const indexPersona = (rec) => {
  const exact = new Map();
  const actions = new Map();
  for (const e of rec?.entries ?? []) {
    exact.set(keyOf(e.m, e.p, e.q, e.b), e.h);
    const m = /^\/suite\/actions\/([^/?]+)$/.exec(e.p);
    let name = null;
    let input = {};
    if (m && e.m === "POST") {
      name = decodeURIComponent(m[1]);
      input = isObj(e.b) && isObj(e.b.input) ? e.b.input : {};
    } else if (e.p.startsWith("/suite/")) {
      // a REST read (DELETE or a non-mutating POST): indexed under its action too, for the relaxed lookup
      const r = matchRoute(e.m, e.p);
      if (r && !r.mutating) {
        name = r.name;
        input = {
          ...Object.fromEntries(new URLSearchParams(e.q ?? "")),
          ...(isObj(e.b) ? e.b : {}),
          ...r.params,
        };
      }
    }
    if (name) {
      if (!actions.has(name)) actions.set(name, []);
      actions.get(name).push({ input, h: e.h });
    }
  }
  return { rec, exact, actions };
};

const personaIndex = (handle) => {
  state.indexes[handle] ??= loadJson(`${handle}.json`).then((rec) => (rec ? indexPersona(rec) : null));
  return state.indexes[handle];
};

const responseFor = async (idx, h) => {
  const own = idx?.rec?.responses?.[h];
  if (own) return own;
  const shared = await loadJson("shared.json");
  return shared?.responses?.[h] ?? null;
};

/** Same action, relaxed input: non-paging fields equal; an unrecorded cursor ends the list. */
const relaxed = (idx, action, input) => {
  const list = idx?.actions.get(action);
  if (!list?.length) return null;
  const strip = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o ?? {})) if (!PAGING.has(k)) out[k] = v;
    return canon(out);
  };
  const want = strip(input);
  const same = list.filter((c) => strip(c.input) === want);
  if (!same.length) return null;
  if (input?.cursor !== undefined && input?.cursor !== null) {
    const hit = same.find((c) => c.input.cursor === input.cursor);
    return hit ? { h: hit.h, endOfList: false } : { h: same[0].h, endOfList: true };
  }
  const score = (c) =>
    (c.input.cursor ? 1000 : 0) +
    (c.input.sort === input?.sort ? 0 : 100) +
    Math.min(99, Math.abs(Number(c.input.limit ?? 0) - Number(input?.limit ?? 0)));
  const best = [...same].sort((a, b) => score(a) - score(b))[0];
  return { h: best.h, endOfList: false };
};

/** An empty page shaped like a recorded one: arrays emptied, cursors null. */
const endPage = (data) => {
  if (!isObj(data)) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = [];
    if (k === "next_cursor" || k === "next") out[k] = null;
  }
  return out;
};

const unwrapData = (env) =>
  isObj(env?.data) && env.data.kind === "result" && "data" in env.data ? env.data.data : env?.data;
const rewrapData = (env, data) =>
  isObj(env?.data) && env.data.kind === "result" && "data" in env.data
    ? { ...env, data: { ...env.data, data } }
    : { ...env, data };

/** Find a recorded response: `{ s, j }` or null. */
const lookup = async (handle, req, ownPersona = false) => {
  const idx = await personaIndex(handle);
  if (idx) {
    const h = idx.exact.get(keyOf(req.m, req.p, req.q, req.b));
    if (h) return responseFor(idx, h);
    if (req.action) {
      const r = relaxed(idx, req.action, req.input);
      if (r) {
        const res = await responseFor(idx, r.h);
        if (res && r.endOfList && res.j?.ok)
          return { s: res.s, j: rewrapData(res.j, endPage(unwrapData(res.j))) };
        if (res) return res;
      }
      // Every recorded call of this action was refused for this persona: refuse this one too, rather than show
      // the default persona's (an admin's) data to someone without the permission.
      if (ownPersona) {
        const all = idx.actions.get(req.action) ?? [];
        if (all.length) {
          const first = await responseFor(idx, all[0].h);
          if (first?.s === 403 && all.every((c) => c.h === all[0].h)) return first;
        }
      }
    }
  }
  return null;
};

/** The recorded output of a read action for the current persona (default persona as a fallback), unwrapped. */
const readData = async (action, input = {}) => {
  const req = {
    m: "POST",
    p: `/suite/actions/${encodeURIComponent(action)}`,
    q: "",
    b: { input },
    action,
    input,
  };
  const res = (await lookup(state.persona, req, true)) ?? (await lookup(state.defaultPersona, req));
  return res?.j?.ok ? clone(unwrapData(res.j)) : null;
};

// ---------------------------------------------------------------- overlay (simulated writes, this tab only)

const freshOverlay = () => ({
  balanceDelta: 0,
  transferred: 0,
  statement: [],
  counts: {},
  countsSet: {},
  notifRead: [],
  notifAllRead: null,
  notifications: [],
  threads: {},
  replies: {},
  threadUnread: {},
  tasks: [],
  taskPatches: {},
  cart: {},
  wish: {},
  txnNo: 900000,
});

const ov = () => state.overlay;
const saveOverlay = () => writeStore(`${OVERLAY_KEY}${state.persona}`, state.overlay);
const saveSite = () => writeStore(SITE_KEY, state.site);

const bumpCount = (name, by) => {
  ov().counts[name] = (ov().counts[name] ?? 0) + by;
};

const baseMe = async () => {
  state.meBase ??= state.ready.then(() => readData("me.get", {}));
  return state.meBase;
};

const myRef = async () => {
  const me = await baseMe();
  return (
    me?.principal ?? {
      subject: `user:${state.persona}`,
      handle: state.persona,
      display_name: titleCase(state.persona),
      kind: "human",
      avatar: null,
    }
  );
};

const currentCounts = async () => {
  const me = await baseMe();
  const out = { ...(me?.counts ?? {}) };
  for (const [k, v] of Object.entries(ov().countsSet)) out[k] = v;
  for (const [k, v] of Object.entries(ov().counts)) out[k] = Math.max(0, (out[k] ?? 0) + v);
  if (Object.keys(ov().cart).length) out.cart_items = (await currentCart())?.item_count ?? out.cart_items;
  return out;
};

const currentBalance = async () => {
  const me = await baseMe();
  return typeof me?.balance === "number" ? me.balance + ov().balanceDelta : null;
};

/** People known from the recordings, by subject and by handle (for PersonRefs in synthesized rows). */
const personRef = async (subjectOrHandle) => {
  const principals = (await readData("dev.principals", {}))?.items ?? [];
  const key = String(subjectOrHandle ?? "");
  const handle = key.replace(/^user:/, "");
  const p = principals.find((x) => x.subject === key || x.handle === handle);
  if (p)
    return {
      subject: p.subject,
      handle: p.handle ?? null,
      display_name: p.display_name,
      kind: "human",
      avatar: p.avatar ?? null,
    };
  return {
    subject: key.includes(":") ? key : `user:${key}`,
    handle,
    display_name: titleCase(handle),
    kind: "human",
    avatar: null,
  };
};

const productIndex = () => {
  if (state.products) return state.products;
  const found = new Map();
  const walk = (v, depth) => {
    if (depth > 8) return;
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (isObj(v)) {
      if (typeof v.slug === "string" && typeof v.price_points === "number" && "stock_status" in v)
        if (!found.has(v.slug)) found.set(v.slug, v);
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  for (const idx of state.loadedIndexes)
    for (const r of Object.values(idx?.rec?.responses ?? {})) walk(r.j, 0);
  if (state.sharedRec) for (const r of Object.values(state.sharedRec.responses ?? {})) walk(r.j, 0);
  state.products = found;
  return found;
};

const currentCart = async () => {
  const base = (await readData("cart.get", {})) ?? {
    lines: [],
    item_count: 0,
    subtotal_points: 0,
    balance: 0,
    updated_at: null,
  };
  return applyCart(base);
};

const applyCart = async (cart) => {
  const wanted = ov().cart;
  if (!Object.keys(wanted).length) return cart;
  const lines = [...(cart.lines ?? [])];
  for (const [slug, qty] of Object.entries(wanted)) {
    const i = lines.findIndex((l) => l.product?.slug === slug);
    if (qty <= 0) {
      if (i >= 0) lines.splice(i, 1);
      continue;
    }
    const product = i >= 0 ? lines[i].product : productIndex().get(slug);
    if (!product) continue;
    const line = { product, qty, line_points: product.price_points * qty, issue: null };
    if (i >= 0) lines[i] = { ...lines[i], ...line };
    else lines.push(line);
  }
  const balance = await currentBalance();
  return {
    ...cart,
    lines,
    item_count: lines.reduce((n, l) => n + l.qty, 0),
    subtotal_points: lines.reduce((n, l) => n + l.line_points, 0),
    balance: balance ?? cart.balance,
    updated_at: nowIso(),
  };
};

/** Product cards anywhere in a response follow the overlay's cart and wishlist. */
const markProducts = (v, depth = 0) => {
  if (depth > 8) return;
  if (Array.isArray(v)) for (const x of v) markProducts(x, depth + 1);
  else if (isObj(v)) {
    if (typeof v.slug === "string" && "in_cart_qty" in v && v.slug in ov().cart)
      v.in_cart_qty = ov().cart[v.slug];
    if (typeof v.slug === "string" && "in_wishlist" in v && v.slug in ov().wish)
      v.in_wishlist = ov().wish[v.slug];
    for (const x of Object.values(v)) markProducts(x, depth + 1);
  }
};

const isMine = (input) => !input?.member || input.member === state.persona;

const threadSummary = (t) => {
  const extra = ov().replies[t.thread_id] ?? [];
  const unread = ov().threadUnread[t.thread_id] ?? 0;
  if (!extra.length && !unread) return t;
  const last = extra[extra.length - 1];
  return {
    ...t,
    ...(last
      ? {
          last_message_at: last.sent_at,
          last_sender: last.sender,
          preview: String(last.body).slice(0, 140),
          message_count: (t.message_count ?? 0) + extra.length,
        }
      : {}),
    unread_count: Math.max(0, (t.unread_count ?? 0) + unread),
  };
};

const notificationRead = (n) =>
  n.read_at === null && (ov().notifAllRead || ov().notifRead.includes(n.notification_id))
    ? { ...n, read_at: ov().notifAllRead ?? nowIso() }
    : n;

const taskWithPatch = (t) => {
  const p = ov().taskPatches[t.task_id];
  return p ? { ...t, ...p } : t;
};

/** Reads the overlay answers on its own (rows that exist only in this tab). */
const syntheticRead = async (action, input) => {
  if (action === "messages.thread" && ov().threads[input?.thread_id]) {
    const t = ov().threads[input.thread_id];
    return {
      thread: threadSummary(t.summary),
      participants: t.participants,
      messages: [...t.messages, ...(ov().replies[input.thread_id] ?? [])],
    };
  }
  if (action === "tasks.get") {
    const t = ov().tasks.find((x) => x.task_id === input?.task_id);
    if (t) return taskWithPatch(t);
  }
  if (action === "site.appearance.get" && state.site && !(await readData("site.appearance.get", {})))
    return { appearance: { ...state.site } };
  return undefined;
};

/** Apply the overlay to a recorded read. `data` is a clone and may be changed in place. */
const overlayRead = async (action, input, data) => {
  if (!isObj(data)) return data;
  const o = ov();
  switch (action) {
    case "me.get": {
      const balance = await currentBalance();
      if (balance !== null && typeof data.balance === "number") data.balance = balance;
      data.counts = { ...(data.counts ?? {}), ...(await currentCounts()) };
      break;
    }
    case "me.counts":
      Object.assign(data, await currentCounts());
      break;
    case "points.summary":
      if (isMine(input)) {
        data.balance = (data.balance ?? 0) + o.balanceDelta;
        if (typeof data.transfer_remaining_today === "number")
          data.transfer_remaining_today = Math.max(0, data.transfer_remaining_today - o.transferred);
        if (Array.isArray(data.recent))
          data.recent = [...o.statement, ...data.recent].slice(0, Math.max(5, data.recent.length));
      }
      break;
    case "points.statement":
      if (isMine(input) && !input?.cursor && Array.isArray(data.items)) {
        data.items = [...o.statement, ...data.items];
        if (typeof data.closing_balance === "number") data.closing_balance += o.balanceDelta;
        for (const l of o.statement) {
          if (l.amount > 0) data.credits = (data.credits ?? 0) + l.amount;
          else data.debits = (data.debits ?? 0) + l.amount;
        }
      }
      break;
    case "cart.get":
      return applyCart(data);
    case "wishlist.list": {
      let items = (data.items ?? []).filter((i) => o.wish[i.product?.slug] !== false);
      for (const [slug, on] of Object.entries(o.wish)) {
        if (!on || items.some((i) => i.product?.slug === slug)) continue;
        const product = productIndex().get(slug);
        if (product) items = [{ product: { ...product, in_wishlist: true }, added_at: nowIso() }, ...items];
      }
      data.items = items;
      break;
    }
    case "messages.list": {
      let items = (data.items ?? []).map(threadSummary);
      if (input?.folder === "sent" && !input?.cursor)
        items = [...Object.values(o.threads).map((t) => threadSummary(t.summary)), ...items];
      data.items = items;
      if (isObj(data.folder_counts))
        data.folder_counts.inbox_unread = Math.max(
          0,
          data.folder_counts.inbox_unread + Object.values(o.threadUnread).reduce((a, b) => a + b, 0),
        );
      break;
    }
    case "messages.thread": {
      const extra = o.replies[input?.thread_id] ?? [];
      if (extra.length) data.messages = [...(data.messages ?? []), ...extra];
      if (data.thread) data.thread = threadSummary(data.thread);
      break;
    }
    case "notifications.list": {
      let items = data.items ?? [];
      if (!input?.cursor) items = [...o.notifications, ...items];
      items = items.map(notificationRead);
      data.items = items;
      if (typeof data.unread_count === "number")
        data.unread_count = o.notifAllRead
          ? 0
          : ((await currentCounts()).notifications_unread ?? data.unread_count);
      break;
    }
    case "tasks.list": {
      let items = (data.items ?? []).map(taskWithPatch);
      if (!input?.cursor && o.tasks.length) items = [...o.tasks.map(taskWithPatch), ...items];
      data.items = items;
      break;
    }
    case "tasks.get":
      return taskWithPatch(data);
    case "site.appearance.get":
      if (state.site) data.appearance = { ...(data.appearance ?? {}), ...state.site };
      break;
    case "dev.principals":
      // Only the recorded people can be switched to in the demo.
      if (Array.isArray(data.items)) data.items = data.items.filter((p) => state.personas.includes(p.handle));
      break;
    default:
      break;
  }
  markProducts(data);
  return data;
};

// ---------------------------------------------------------------- simulated writes

const statementLine = async ({ type, amount, memo, counterparty = null }) => {
  ov().txnNo += 1;
  const balance = await currentBalance();
  return {
    txn_id: uuid(),
    txn_no: ov().txnNo,
    txn_type: type,
    occurred_at: nowIso(),
    memo,
    amount,
    balance_after: balance ?? 0,
    counterparty,
    ref: null,
    actor: await myRef(),
    reversed_by: null,
  };
};

const postPoints = async ({ type, amount, memo, counterparty }) => {
  ov().balanceDelta += amount;
  const line = await statementLine({ type, amount, memo, counterparty });
  ov().statement.unshift(line);
  saveOverlay();
  const balance = await currentBalance();
  emitDomain("points.posted", {
    txn_id: line.txn_id,
    txn_no: line.txn_no,
    txn_type: type,
    account: `member:${state.persona}`,
    member: state.persona,
    delta: amount,
    balance: balance ?? 0,
    lifetime: 0,
    memo,
  });
  return line;
};

const messageView = async (threadId, body, sender) => ({
  message_id: uuid(),
  thread_id: threadId,
  sender: sender ?? (await myRef()),
  on_behalf_of: null,
  body,
  mentions: [],
  sent_at: nowIso(),
  reply_to: null,
  attachments: [],
  read_by_me: true,
  read_by: [],
});

const WRITES = {
  "points.transfer": async (input) => {
    const amount = Math.abs(Number(input.points) || 0);
    const to = await personRef(input.to);
    ov().transferred += amount;
    const line = await postPoints({
      type: "transfer",
      amount: -amount,
      memo: input.memo ?? "",
      counterparty: to,
    });
    return {
      txn_id: line.txn_id,
      txn_no: line.txn_no,
      balance: (await currentBalance()) ?? 0,
      replayed: false,
    };
  },
  "messages.send": async (input) => {
    const me = await myRef();
    const threadId = uuid();
    const to = await Promise.all((input.to ?? []).map((r) => personRef(r)));
    const msg = await messageView(threadId, String(input.body ?? ""));
    ov().threads[threadId] = {
      summary: {
        thread_id: threadId,
        subject: String(input.subject ?? "(no subject)"),
        kind: "direct",
        last_message_at: msg.sent_at,
        last_sender: me,
        preview: msg.body.slice(0, 140),
        message_count: 1,
        unread_count: 0,
        participants: [me, ...to],
        participant_count: to.length + 1,
        starred: false,
        archived: false,
        muted: false,
        has_attachments: false,
        mentioned: false,
      },
      participants: [
        { person: me, role: "from", via_group: null },
        ...to.map((p) => ({ person: p, role: "to", via_group: null })),
      ],
      messages: [msg],
    };
    saveOverlay();
    emitDomain("message.sent", {
      thread_id: threadId,
      message_id: msg.message_id,
      subject: input.subject,
      recipient_count: to.length,
    });
    return { thread_id: threadId, message_id: msg.message_id, recipient_count: to.length, replayed: false };
  },
  "messages.reply": async (input) => {
    const msg = await messageView(input.thread_id, String(input.body ?? ""));
    (ov().replies[input.thread_id] ??= []).push(msg);
    saveOverlay();
    return { thread_id: input.thread_id, message_id: msg.message_id, recipient_count: 1, replayed: false };
  },
  "notifications.read": async (input) => {
    const ids = (input.ids ?? []).filter((id) => !ov().notifRead.includes(id));
    ov().notifRead.push(...ids);
    bumpCount("notifications_unread", -ids.length);
    saveOverlay();
    const unread = (await currentCounts()).notifications_unread ?? 0;
    emitDomain("notification.read", { ids: input.ids ?? [], unread_count: unread });
    emitCounts();
    return { marked: ids.length, unread_count: unread };
  },
  "notifications.read_all": async () => {
    const before = (await currentCounts()).notifications_unread ?? 0;
    ov().notifAllRead = nowIso();
    ov().countsSet.notifications_unread = 0;
    delete ov().counts.notifications_unread;
    saveOverlay();
    emitDomain("notification.read", { ids: null, unread_count: 0 });
    emitCounts();
    return { marked: before, unread_count: 0 };
  },
  "tasks.create": async (input) => {
    const me = await myRef();
    ov().txnNo += 1;
    const assignee = input.assignee ? await personRef(input.assignee) : null;
    const task = {
      task_id: uuid(),
      task_no: ov().txnNo % 100000,
      title: String(input.title ?? "New task"),
      status: "open",
      priority: input.priority ?? "normal",
      assignee,
      created_by: me,
      created_at: nowIso(),
      due_at: input.due_at ?? null,
      overdue: false,
      link: input.link ?? null,
      source: "manual",
      comment_count: 0,
      version: 1,
      description: String(input.description ?? ""),
      completed_at: null,
      run_id: null,
      comments: [],
      history: [{ at: nowIso(), actor: me, changed: ["created"] }],
    };
    ov().tasks.unshift(task);
    if (!assignee || assignee.handle === state.persona) bumpCount("tasks_open", 1);
    saveOverlay();
    emitCounts();
    return task;
  },
  "tasks.update": async (input) => {
    const patch = {};
    for (const k of ["title", "description", "status", "priority", "due_at"])
      if (input[k] !== undefined) patch[k] = input[k];
    if (input.assignee !== undefined)
      patch.assignee = input.assignee ? await personRef(input.assignee) : null;
    patch.version = (Number(input.version) || 0) + 1;
    if (patch.status === "done") patch.completed_at = nowIso();
    ov().taskPatches[input.task_id] = { ...(ov().taskPatches[input.task_id] ?? {}), ...patch };
    if (patch.status === "done" || patch.status === "cancelled") bumpCount("tasks_open", -1);
    saveOverlay();
    const own = ov().tasks.find((t) => t.task_id === input.task_id);
    const base = own ?? (await readData("tasks.get", { task_id: input.task_id }));
    return taskWithPatch(base ?? { task_id: input.task_id, comments: [], history: [] });
  },
  "cart.set_item": async (input) => {
    ov().cart[input.slug] = Math.max(0, Number(input.qty) || 0);
    saveOverlay();
    const cart = await currentCart();
    emitCounts();
    return cart;
  },
  "cart.clear": async () => {
    const cart = await currentCart();
    for (const l of cart.lines ?? []) ov().cart[l.product.slug] = 0;
    saveOverlay();
    emitCounts();
    return currentCart();
  },
  "wishlist.add": async (input) => {
    ov().wish[input.slug] = true;
    saveOverlay();
    return { product: input.slug, in_wishlist: true };
  },
  "wishlist.remove": async (input) => {
    ov().wish[input.slug] = false;
    saveOverlay();
    return { product: input.slug, in_wishlist: false };
  },
  "site.appearance.set": async (input) => {
    const recorded = (await readData("site.appearance.get", {}))?.appearance ?? {};
    const next = { ...recorded, ...(state.site ?? {}) };
    for (const k of ["look", "density", "experience"]) if (input[k] !== undefined) next[k] = input[k];
    state.site = next;
    saveSite();
    setTimeout(() => emitChange("Program", "rewards"), 60);
    return { appearance: { ...next } };
  },
};

/** A plausible success for writes the demo does not model. */
const genericWrite = (action, input) => ({
  status: "committed",
  replayed: false,
  ...(action ? { action } : {}),
  ...(isObj(input) ? input : {}),
});

const commitResult = (body) => {
  const seq = nextSeq("s1");
  return {
    status: "committed",
    replayed: false,
    commit_id: uuid(),
    change_seq: seq,
    nodes: (body?.changes ?? []).map((c) => ({
      uri: c.target,
      result_revision: (Number(c.base_revision) || 0) + 1,
      change_seq: seq,
    })),
  };
};

const showBanner = () => {
  if (readStore(BANNER_KEY, false)) return;
  writeStore(BANNER_KEY, true);
  try {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.textContent = "Demo: changes are kept in this tab only";
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:max(16px, env(safe-area-inset-bottom))",
      "transform:translateX(-50%)",
      "z-index:2147483000",
      "padding:10px 16px",
      "border-radius:999px",
      "background:#1f2328",
      "color:#fff",
      "font:500 14px/1.3 system-ui, sans-serif",
      "box-shadow:0 6px 24px rgba(0,0,0,.25)",
      "max-width:calc(100vw - 32px)",
      "text-align:center",
      "transition:opacity .4s",
    ].join(";");
    document.body.append(el);
    setTimeout(() => (el.style.opacity = "0"), 5200);
    setTimeout(() => el.remove(), 5800);
  } catch {
    /* no document body yet: skip the banner */
  }
};

// ---------------------------------------------------------------- request routing

const compiledRoutes = () => {
  state.compiled ??= Object.entries(state.manifest?.routes ?? {}).map(([name, r]) => {
    const names = [];
    const rx = new RegExp(
      `^${r.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([a-z_]+)/g, (_, n) => (names.push(n), "([^/]+)"))}$`,
    );
    return { name, method: r.method, mutating: Boolean(r.mutating), rx, names };
  });
  return state.compiled;
};

const matchRoute = (method, path) => {
  for (const r of compiledRoutes()) {
    if (r.method !== method) continue;
    const m = r.rx.exec(path);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { ...r, params };
  }
  return null;
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ok = (data) => json(200, { ok: true, data });

const notFound = (what) =>
  json(404, {
    ok: false,
    error: { code: "NOT_FOUND", message: `Not available in the demo (${what}).` },
  });

const handle = async (method, path, query, body) => {
  await state.ready;
  // which action is this?
  let action = null;
  let input = {};
  let mutating = method !== "GET";
  const invoke = /^\/suite\/actions\/([^/?]+)$/.exec(path);
  if (invoke && method === "POST") {
    action = decodeURIComponent(invoke[1]);
    input = isObj(body?.input) ? body.input : {};
    mutating = Boolean(state.manifest?.routes?.[action]?.mutating);
  } else if (path.startsWith("/suite/")) {
    const r = matchRoute(method, path);
    if (r) {
      action = r.name;
      mutating = r.mutating;
      input = {
        ...Object.fromEntries(new URLSearchParams(query)),
        ...(isObj(body) ? body : {}),
        ...r.params,
      };
    }
  } else if (method === "POST" && path === "/query") mutating = false;

  if (mutating) {
    showBanner();
    try {
      if (action && WRITES[action]) return ok(await WRITES[action](input));
      if (path === "/changes" && method === "POST") return ok(commitResult(body));
      return ok(genericWrite(action, input));
    } catch (e) {
      console.error("[demo] simulated write failed", e);
      return ok(genericWrite(action, input));
    }
  }

  if (action) {
    const synthetic = await syntheticRead(action, input);
    if (synthetic !== undefined) return ok(synthetic);
  }
  const req = { m: method, p: path, q: query, b: body, action, input };
  const res = (await lookup(state.persona, req, true)) ?? (await lookup(state.defaultPersona, req));
  if (res) {
    const env = clone(res.j);
    if (env?.ok && action) {
      const data = await overlayRead(action, input, unwrapData(env));
      return json(res.s ?? 200, rewrapData(env, data));
    }
    return json(res.s ?? 200, env);
  }
  const what = action ? `${action} ${canon(input)}` : `${method} ${path}${query ? `?${query}` : ""}`;
  missOnce(what);
  const empty = action ? state.manifest?.empty?.[action] : undefined;
  if (empty !== undefined) return ok(await overlayRead(action, input, clone(empty)));
  return notFound(action ?? path);
};

const parseBody = async (input, init) => {
  let raw = init?.body;
  if (raw === undefined && input instanceof Request) raw = await input.clone().text();
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    try {
      raw = await new Response(raw).text();
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const demoFetch = async (input, init) => {
  const href = input instanceof Request ? input.url : String(input);
  const url = new URL(href, location.href);
  const apiPrefix = url.pathname.startsWith("/api/")
    ? "/api"
    : url.pathname.startsWith(`${state.root}api/`)
      ? `${state.root}api`
      : null;
  if (url.origin !== location.origin || apiPrefix === null) return state.realFetch(input, init);
  const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const body = await parseBody(input, init);
  try {
    return await handle(method, url.pathname.slice(apiPrefix.length), url.search.slice(1), body);
  } catch (e) {
    console.error("[demo]", e);
    return json(500, { ok: false, error: { code: "DEMO_ERROR", message: String(e?.message ?? e) } });
  }
};

// ---------------------------------------------------------------- realtime stand-in

const sockets = new Set();

const nextSeq = (stream) => {
  const seqs = readStore(SEQ_KEY, { s1: 1_000_000, s2: 1_000_000 });
  seqs[stream] = (seqs[stream] ?? 1_000_000) + 1;
  writeStore(SEQ_KEY, seqs);
  return seqs[stream];
};
const headSeq = (stream) => readStore(SEQ_KEY, { s1: 1_000_000, s2: 1_000_000 })[stream] ?? 1_000_000;

const broadcast = (stream, frame) => {
  for (const s of sockets) for (const [sub, st] of s.subs) if (st === stream) s.push({ ...frame, sub });
};

function emitDomain(type, payload) {
  const prev = headSeq("s2");
  const seq = nextSeq("s2");
  broadcast("domain", {
    t: "domain",
    prev_through: prev,
    through: seq,
    items: [
      {
        seq,
        type,
        payload,
        occurred_at: nowIso(),
        actor: `user:${state.persona}`,
        on_behalf_of: null,
        surface: "demo",
        subject: null,
        cause: null,
      },
    ],
  });
}

function emitChange(kind, slug) {
  const prev = headSeq("s1");
  const seq = nextSeq("s1");
  broadcast("changes", {
    t: "events",
    prev_through: prev,
    through: seq,
    items: [
      {
        seq,
        node: `plinth://northwind/${kind}/${slug}`,
        rev: seq,
        actor: `user:${state.persona}`,
        surface: "demo",
      },
    ],
  });
}

function emitCounts() {
  void currentCounts().then((counts) => {
    for (const s of sockets) if ([...s.subs.values()].includes("domain")) s.push({ t: "counts", counts });
  });
}

class FakeRtSocket {
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.protocol = "";
    this.extensions = "";
    this.bufferedAmount = 0;
    this.binaryType = "blob";
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.subs = new Map();
    this.listeners = new Map();
    sockets.add(this);
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.fire("open", {});
    }, 40);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type, ev) {
    try {
      this[`on${type}`]?.(ev);
    } catch (e) {
      console.error(e);
    }
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try {
        fn(ev);
      } catch (e) {
        console.error(e);
      }
    }
  }
  push(frame) {
    if (this.readyState !== 1) return;
    setTimeout(() => this.fire("message", { data: JSON.stringify(frame) }), 0);
  }
  send(text) {
    let f;
    try {
      f = JSON.parse(String(text));
    } catch {
      return;
    }
    if (f.t === "hello")
      this.push({
        t: "welcome",
        session_id: f.client_id ?? uuid(),
        principal: `user:${state.persona}`,
        head_seq: headSeq("s1"),
        domain_head_seq: headSeq("s2"),
      });
    else if (f.t === "subscribe") {
      const stream = f.stream ?? "changes";
      const head = headSeq(stream === "domain" ? "s2" : "s1");
      const through = Math.max(head, Number(f.since_seq) || 0);
      this.subs.set(f.sub, stream);
      this.push({ t: "subscribed", sub: f.sub, mode: "snapshot", from_seq: through, through_seq: through });
      if (stream === "domain") {
        emitCounts();
        startLoop();
      }
    } else if (f.t === "unsubscribe") this.subs.delete(f.sub);
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    sockets.delete(this);
    setTimeout(() => this.fire("close", { code, reason, wasClean: true }), 0);
  }
}

const patchWebSocket = () => {
  const Real = window.WebSocket;
  if (!Real || Real.__plinthDemo) return;
  function DemoWebSocket(url, protocols) {
    const u = new URL(String(url), location.href);
    if (/\/rt\/?$/.test(u.pathname)) return new FakeRtSocket(u.href);
    return protocols === undefined ? new Real(url) : new Real(url, protocols);
  }
  DemoWebSocket.prototype = Real.prototype;
  DemoWebSocket.CONNECTING = 0;
  DemoWebSocket.OPEN = 1;
  DemoWebSocket.CLOSING = 2;
  DemoWebSocket.CLOSED = 3;
  DemoWebSocket.__plinthDemo = true;
  window.WebSocket = DemoWebSocket;
};

// ---- the gentle loop: a points award, a new message, a notification, a recorded event, every 20 to 40 s

const AWARD_MEMOS = [
  "Peer recognition: smooth handover on the night shift",
  "Thanks for covering the Friday pick wave",
  "Great catch on the mislabelled pallet",
  "Helped a new starter through their first week",
  "Quarter-end close support",
];
const MESSAGE_BODIES = [
  "Quick one: can you take a look at this before stand-up tomorrow?",
  "Thanks, that worked. Shall we keep the same plan for next week?",
  "Numbers for the region are in. Happy to walk through them when you have a minute.",
  "Heads up: the new schedule is live. Shout if anything looks off.",
];
const NOTES = [
  {
    title: "Programme update",
    body: "Double points on recognition awards run until Sunday.",
    link: "/points",
  },
  {
    title: "New badges available",
    body: "Three new badges have been added to the catalogue.",
    link: "/badges",
  },
  { title: "Store restock", body: "Popular items are back in stock in the rewards store.", link: "/store" },
];

const loopSteps = [
  async () => {
    const me = await baseMe();
    if (!me?.member) return;
    await postPoints({ type: "award", amount: pick([25, 40, 50, 75, 100]), memo: pick(AWARD_MEMOS) });
  },
  async () => {
    const list = await readData("messages.list", {});
    const others = (list?.items ?? []).filter(
      (t) => t.last_sender?.handle && t.last_sender.handle !== state.persona,
    );
    const thread = pick(others.length ? others : (list?.items ?? []));
    if (!thread) return;
    const from = others.length ? thread.last_sender : await personRef("jonas-becker");
    const msg = await messageView(thread.thread_id, pick(MESSAGE_BODIES), from);
    msg.read_by_me = false;
    (ov().replies[thread.thread_id] ??= []).push(msg);
    ov().threadUnread[thread.thread_id] = (ov().threadUnread[thread.thread_id] ?? 0) + 1;
    bumpCount("messages_unread", 1);
    saveOverlay();
    emitDomain("message.received", {
      thread_id: thread.thread_id,
      message_id: msg.message_id,
      subject: thread.subject,
      preview: msg.body.slice(0, 140),
      from,
      mentioned: false,
    });
    emitCounts();
  },
  async () => {
    const n = pick(NOTES);
    const note = {
      notification_id: uuid(),
      type: "system",
      title: n.title,
      body: n.body,
      link: n.link,
      actor: null,
      created_at: nowIso(),
      read_at: null,
      subject: null,
    };
    ov().notifications.unshift(note);
    if (ov().countsSet.notifications_unread !== undefined) ov().countsSet.notifications_unread += 1;
    else bumpCount("notifications_unread", 1);
    saveOverlay();
    emitDomain("notification.created", { notification: note });
    emitCounts();
  },
  async () => {
    const pool = [...(state.personaEvents ?? []), ...(state.manifest?.events ?? [])];
    const ev = pick(pool);
    if (ev?.type && ev.payload) emitDomain(ev.type, clone(ev.payload));
  },
];

let loopTimer = 0;
let loopStep = 0;
function startLoop() {
  if (loopTimer) return;
  const schedule = () => {
    loopTimer = setTimeout(
      async () => {
        try {
          if (sockets.size) await loopSteps[loopStep++ % loopSteps.length]();
        } catch (e) {
          console.error("[demo] live loop", e);
        }
        schedule();
      },
      20_000 + Math.random() * 20_000,
    );
  };
  schedule();
}

// ---------------------------------------------------------------- entry

/**
 * Install demo mode: patch `fetch` for `/api/` and `WebSocket` for `/rt`. `base` is the Classic app's base path
 * (the recordings live at `<base>demo-data/`). Resolves once the manifest and this persona's recording are loaded.
 */
export const installDemo = ({ base = "/", dataUrl, persona } = {}) => {
  if (state) return state.ready;
  const root = base.endsWith("/") ? base : `${base}/`;
  const realFetch = window.fetch.bind(window);
  state = {
    root,
    dataUrl: dataUrl ?? `${root}demo-data/`,
    realFetch,
    files: {},
    indexes: {},
    loadedIndexes: [],
    persona: persona ?? personaFromUrl(),
    defaultPersona: DEFAULT_PERSONA,
    personas: [],
    manifest: null,
    sharedRec: null,
    overlay: null,
    site: readStore(SITE_KEY, null),
    meBase: undefined,
    products: null,
    compiled: null,
    personaEvents: [],
    ready: null,
  };
  window.fetch = demoFetch;
  patchWebSocket();
  state.ready = (async () => {
    const manifest = await loadJson("manifest.json");
    state.manifest = manifest;
    state.defaultPersona = manifest?.default_persona ?? DEFAULT_PERSONA;
    state.personas = (manifest?.personas ?? []).map((p) => p.handle ?? p);
    if (state.personas.length && !state.personas.includes(state.persona))
      state.persona = state.defaultPersona;
    state.overlay = { ...freshOverlay(), ...readStore(`${OVERLAY_KEY}${state.persona}`, {}) };
    const [own, shared] = await Promise.all([personaIndex(state.persona), loadJson("shared.json")]);
    state.sharedRec = shared;
    if (own) state.loadedIndexes.push(own);
    state.personaEvents = own?.rec?.events ?? [];
    if (state.persona !== state.defaultPersona)
      void personaIndex(state.defaultPersona).then((d) => d && state.loadedIndexes.push(d));
  })().catch((e) => console.error("[demo] could not load the recordings", e));
  return state.ready;
};

/** True once `installDemo` ran in this page. */
export const isDemo = () => state !== null;
