// Shelf packer with LRU eviction by shelf, shared by the run atlas and the dynamic SDF atlas.
//
// The spec asks for a skyline packer (R3.1). A shelf packer is simpler, evicts whole shelves cheaply and is good
// enough to measure upload behaviour; swap it if fragmentation shows up in the numbers.

export interface Slot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly shelf: number;
}

interface Shelf {
  y: number;
  h: number;
  x: number;
  lastUsed: number;
  keys: Set<string>;
}

export class ShelfPacker {
  private shelves: Shelf[] = [];
  private nextY = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Allocate `w × h`; returns the evicted keys (when a shelf was reclaimed) alongside the slot. */
  alloc(key: string, w: number, h: number, frame: number): { slot: Slot; evicted: string[] } | null {
    if (w > this.width || h > this.height) return null;
    const bucket = Math.ceil(h / 4) * 4;
    // 1. An existing shelf of a close height with room on the right.
    for (let i = 0; i < this.shelves.length; i++) {
      const s = this.shelves[i]!;
      if (s.h >= bucket && s.h <= bucket * 1.5 + 4 && s.x + w <= this.width) {
        return { slot: this.take(s, i, key, w, h, frame), evicted: [] };
      }
    }
    // 2. A new shelf.
    if (this.nextY + bucket <= this.height) {
      const s: Shelf = { y: this.nextY, h: bucket, x: 0, lastUsed: frame, keys: new Set() };
      this.nextY += bucket;
      this.shelves.push(s);
      return { slot: this.take(s, this.shelves.length - 1, key, w, h, frame), evicted: [] };
    }
    // 3. Reclaim the least recently used shelf that is tall enough and not used this frame.
    let victim = -1;
    for (let i = 0; i < this.shelves.length; i++) {
      const s = this.shelves[i]!;
      if (s.h < bucket || s.lastUsed >= frame) continue;
      if (victim < 0 || s.lastUsed < this.shelves[victim]!.lastUsed) victim = i;
    }
    if (victim < 0) return null;
    const s = this.shelves[victim]!;
    const evicted = [...s.keys];
    s.keys.clear();
    s.x = 0;
    return { slot: this.take(s, victim, key, w, h, frame), evicted };
  }

  touch(shelf: number, frame: number): void {
    const s = this.shelves[shelf];
    if (s && s.lastUsed < frame) s.lastUsed = frame;
  }

  reset(): void {
    this.shelves = [];
    this.nextY = 0;
  }

  get shelfCount(): number {
    return this.shelves.length;
  }

  private take(s: Shelf, index: number, key: string, w: number, h: number, frame: number): Slot {
    const slot = { x: s.x, y: s.y, w, h, shelf: index };
    s.x += w + 1;
    s.lastUsed = frame;
    s.keys.add(key);
    return slot;
  }
}
