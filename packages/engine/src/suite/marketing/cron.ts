/**
 * Five-field cron over the virtual clock in UTC (CONTRACT.md 2.2, `Cron`): minute hour day-of-month month day-of-week.
 * Day of week is ISO (Monday = 1 .. Sunday = 7); 0 is accepted as Sunday. Supports `*`, `a`, `a-b`, lists and `/step`.
 */

export interface CronSpec {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly dom: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly dow: ReadonlySet<number>;
  readonly domAny: boolean;
  readonly dowAny: boolean;
}

const field = (src: string, lo: number, hi: number, map?: (n: number) => number): Set<number> | undefined => {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return undefined;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return undefined;
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1]!.split("-");
      a = Number(x);
      b = y === undefined ? (m[2] ? hi : a) : Number(y);
    }
    if (a < lo || b > hi || a > b) return undefined;
    for (let v = a; v <= b; v += step) out.add(map ? map(v) : v);
  }
  return out.size > 0 ? out : undefined;
};

export const parseCron = (expr: string): CronSpec | undefined => {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return undefined;
  const minutes = field(f[0]!, 0, 59);
  const hours = field(f[1]!, 0, 23);
  const dom = field(f[2]!, 1, 31);
  const months = field(f[3]!, 1, 12);
  const dow = field(f[4]!, 0, 7, (n) => (n === 0 ? 7 : n));
  if (!minutes || !hours || !dom || !months || !dow) return undefined;
  return { minutes, hours, dom, months, dow, domAny: f[2] === "*", dowAny: f[4] === "*" };
};

const isoDow = (d: Date): number => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

const dayMatches = (c: CronSpec, d: Date): boolean => {
  if (!c.months.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.has(d.getUTCDate());
  const dowOk = c.dow.has(isoDow(d));
  if (!c.domAny && !c.dowAny) return domOk || dowOk;
  return domOk && dowOk;
};

/** Does the cron fire in the UTC minute containing `d`? */
export const cronMatches = (c: CronSpec, d: Date): boolean =>
  c.minutes.has(d.getUTCMinutes()) && c.hours.has(d.getUTCHours()) && dayMatches(c, d);

const startOfMinute = (d: Date): number => Math.floor(d.getTime() / 60_000) * 60_000;

/** Fire times strictly after `after`, at most `n`, looking at most `horizonDays` ahead. */
export const nextFires = (c: CronSpec, after: Date, n: number, horizonDays = 400): Date[] => {
  const out: Date[] = [];
  const from = startOfMinute(after) + 60_000;
  const day0 = Math.floor(from / 86_400_000);
  const hours = [...c.hours].sort((a, b) => a - b);
  const minutes = [...c.minutes].sort((a, b) => a - b);
  for (let day = day0; day < day0 + horizonDays && out.length < n; day++) {
    const d = new Date(day * 86_400_000);
    if (!dayMatches(c, d)) continue;
    for (const h of hours)
      for (const m of minutes) {
        const t = day * 86_400_000 + h * 3_600_000 + m * 60_000;
        if (t >= from && out.length < n) out.push(new Date(t));
      }
  }
  return out;
};

/** Fire times in `(after, through]`, at most `cap`. */
export const firesBetween = (c: CronSpec, after: Date, through: Date, cap = 200): Date[] => {
  const out: Date[] = [];
  for (const t of nextFires(
    c,
    after,
    cap,
    Math.ceil((through.getTime() - after.getTime()) / 86_400_000) + 2,
  )) {
    if (t.getTime() > through.getTime()) break;
    out.push(t);
  }
  return out;
};
