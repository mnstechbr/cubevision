import { BufferGeometry, Float32BufferAttribute, Group } from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { Fade } from './holo';

/** Deterministic PRNG so every visit to a world looks the same. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Accumulates line segments into one buffer: a whole world's wireframe
 * becomes a single draw call instead of one per object.
 */
export class Lines {
  private p: number[] = [];

  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.p.push(ax, ay, az, bx, by, bz);
    return this;
  }

  /** Axis-aligned box from its min corner and size. */
  box(x: number, y: number, z: number, w: number, h: number, d: number) {
    const X = x + w;
    const Y = y + h;
    const Z = z + d;
    for (const yy of [y, Y]) this.rect(x, yy, z, X, Z);
    this.seg(x, y, z, x, Y, z).seg(X, y, z, X, Y, z).seg(x, y, Z, x, Y, Z).seg(X, y, Z, X, Y, Z);
    return this;
  }

  /** Horizontal rectangle at height y. */
  rect(x0: number, y: number, z0: number, x1: number, z1: number) {
    return this.seg(x0, y, z0, x1, y, z0).seg(x1, y, z0, x1, y, z1).seg(x1, y, z1, x0, y, z1).seg(x0, y, z1, x0, y, z0);
  }

  /** Circle in the XZ plane (or XY when `vertical`). */
  circle(cx: number, cy: number, cz: number, r: number, segments = 48, vertical = false, from = 0, to = Math.PI * 2) {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i <= segments; i++) {
      const a = from + ((to - from) * i) / segments;
      const x = cx + Math.cos(a) * r;
      const y = vertical ? cy + Math.sin(a) * r : cy;
      const z = vertical ? cz : cz + Math.sin(a) * r;
      if (i > 0) this.seg(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
    return this;
  }

  /** Raw segment pairs (for `strokes`); clears the builder. */
  positions() {
    const a = new Float32Array(this.p);
    this.p = [];
    return a;
  }

  geometry() {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    this.p = [];
    return g;
  }
}

/** The bits every layer needs: a root group plus its fade and glow uniforms. */
export function layerBase() {
  return { root: new Group(), fade: uniform(1) as Fade, glow: uniform(0) as Fade };
}
