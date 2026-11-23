/** splitmix64 and xoshiro256** over BigInt. Pure: every function returns new state. */
const M = 0xffffffffffffffffn;

export const splitmix64 = (x: bigint): { next: bigint; out: bigint } => {
  const s = (x + 0x9e3779b97f4a7c15n) & M;
  let z = s;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
  return { next: s, out: (z ^ (z >> 31n)) & M };
};

const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (64n - k))) & M;

/** A stateful xoshiro256** generator (state is local to one generation window). */
export class Xoshiro {
  private s: [bigint, bigint, bigint, bigint];

  constructor(seed: bigint) {
    let x = seed & M;
    const st: bigint[] = [];
    for (let i = 0; i < 4; i++) {
      const r = splitmix64(x);
      x = r.next;
      st.push(r.out);
    }
    this.s = [st[0] ?? 1n, st[1] ?? 2n, st[2] ?? 3n, st[3] ?? 4n];
  }

  next(): bigint {
    const [s0, s1, s2, s3] = this.s;
    const result = (rotl((s1 * 5n) & M, 7n) * 9n) & M;
    const t = (s1 << 17n) & M;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    const n1 = s1 ^ n2;
    const n0 = s0 ^ n3;
    this.s = [n0, n1, n2 ^ t, rotl(n3, 45n)];
    return result;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return Number(this.next() >> 11n) / 9007199254740992;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  normal(): number {
    const u = Math.max(this.float(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.float());
  }

  pick<T>(xs: ReadonlyArray<T>): T {
    return xs[this.int(xs.length)] as T;
  }

  weighted<T>(xs: ReadonlyArray<readonly [T, number]>): T {
    const total = xs.reduce((a, [, w]) => a + w, 0);
    let r = this.float() * total;
    for (const [v, w] of xs) {
      r -= w;
      if (r < 0) return v;
    }
    return (xs[xs.length - 1] as readonly [T, number])[0];
  }
}

/** Per-window stream: derived from the seed, a stream id and the window index by a splitmix64 chain. */
export const streamSeed = (seed: number, stream: string, index: number): bigint => {
  let x = BigInt(seed);
  for (const ch of stream) x = splitmix64(x ^ BigInt(ch.charCodeAt(0))).out;
  return splitmix64(x + BigInt(index)).out;
};
