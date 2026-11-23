// A single-channel (R8) atlas page: CPU copy plus a three DataTexture.
//
// three r187 finding: `Texture.updateRanges` is honoured only by the classic WebGLRenderer. Neither WebGPURenderer
// backend uploads a sub-rectangle, so every change re-uploads the whole page. The spike keeps one upload per frame at
// most (`flush`) and counts the uploads so the harness can report them.

import { DataTexture, LinearFilter, NearestFilter, RedFormat, UnsignedByteType } from "../engine/three";
import { ShelfPacker } from "./packer";

export class R8Atlas {
  readonly data: Uint8Array;
  readonly texture: DataTexture;
  readonly packer: ShelfPacker;
  private dirty = false;
  uploads = 0;
  uploadedBytes = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    filter: "nearest" | "linear",
    name: string,
  ) {
    this.data = new Uint8Array(width * height);
    this.texture = new DataTexture(this.data, width, height, RedFormat, UnsignedByteType);
    this.texture.name = name;
    const f = filter === "nearest" ? NearestFilter : LinearFilter;
    this.texture.magFilter = f;
    this.texture.minFilter = f;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
    this.packer = new ShelfPacker(width, height);
  }

  /** Copy a `w × h` block (row-major, one byte per texel) into the atlas at (x, y). */
  write(
    x: number,
    y: number,
    w: number,
    h: number,
    src: ArrayLike<number>,
    stride = w,
    channel = 0,
    step = 1,
  ): void {
    const d = this.data;
    for (let row = 0; row < h; row++) {
      const dst = (y + row) * this.width + x;
      const s = row * stride * step + channel;
      for (let col = 0; col < w; col++) d[dst + col] = src[s + col * step] ?? 0;
    }
    this.dirty = true;
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    for (let row = 0; row < h; row++)
      this.data.fill(0, (y + row) * this.width + x, (y + row) * this.width + x + w);
    this.dirty = true;
  }

  flush(): boolean {
    if (!this.dirty) return false;
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.uploads++;
    this.uploadedBytes += this.data.byteLength;
    return true;
  }
}
