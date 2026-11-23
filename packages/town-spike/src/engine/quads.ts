// Instanced screen-space quads in CSS px (1 world unit = 1 CSS px, y down), the primitive of every 2D layer:
// pane surfaces, rules, field chrome, raster runs and SDF glyphs (township.md S.1 interior P2 to P5).
//
// Capacity is fixed at creation. Replacing attribute objects after the first draw would force three to rebuild the
// render object, so overflow is clamped and counted instead (the harness reports `truncated`).

import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  OrthographicCamera,
} from "./three";

export class QuadInstances<K extends string> {
  readonly geometry = new InstancedBufferGeometry();
  readonly arrays: Record<K, Float32Array>;
  readonly attrs: Record<K, InstancedBufferAttribute>;
  count = 0;
  truncated = 0;

  constructor(
    layout: Record<K, number>,
    readonly capacity: number,
  ) {
    // Corners (0,0) (1,0) (0,1) (1,1) in the x/y of `position`.
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    this.geometry.setAttribute("position", new BufferAttribute(pos, 3));
    this.geometry.setIndex([0, 2, 1, 2, 3, 1]);
    const arrays = {} as Record<K, Float32Array>;
    const attrs = {} as Record<K, InstancedBufferAttribute>;
    for (const name of Object.keys(layout) as K[]) {
      const size = layout[name];
      const arr = new Float32Array(capacity * size);
      const attr = new InstancedBufferAttribute(arr, size);
      attr.setUsage(35048); // DynamicDrawUsage
      arrays[name] = arr;
      attrs[name] = attr;
      this.geometry.setAttribute(name, attr);
    }
    this.arrays = arrays;
    this.attrs = attrs;
    this.geometry.instanceCount = 0;
  }

  begin(): void {
    this.count = 0;
    this.truncated = 0;
  }

  /** Reserve one instance; returns its index or -1 when full. */
  next(): number {
    if (this.count >= this.capacity) {
      this.truncated++;
      return -1;
    }
    return this.count++;
  }

  set4(name: K, i: number, a: number, b: number, c: number, d: number): void {
    const arr = this.arrays[name];
    const o = i * 4;
    arr[o] = a;
    arr[o + 1] = b;
    arr[o + 2] = c;
    arr[o + 3] = d;
  }

  set4v(name: K, i: number, v: ArrayLike<number>): void {
    this.set4(name, i, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0);
  }

  commit(): void {
    for (const name of Object.keys(this.attrs) as K[]) {
      const attr = this.attrs[name];
      attr.clearUpdateRanges();
      if (this.count > 0) attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
    this.geometry.instanceCount = this.count;
  }
}

/** Orthographic camera whose world units are CSS px with y pointing down the screen (world y = -css y). */
export const makeCssCamera = (w: number, h: number): OrthographicCamera => {
  const cam = new OrthographicCamera(0, w, 0, -h, -100, 100);
  cam.position.set(0, 0, 10);
  cam.updateProjectionMatrix();
  return cam;
};

export const resizeCssCamera = (cam: OrthographicCamera, w: number, h: number): void => {
  cam.left = 0;
  cam.right = w;
  cam.top = 0;
  cam.bottom = -h;
  cam.updateProjectionMatrix();
};
