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

  /**
   * A person in wireframe, for human scale. Feet at (x, y, z), `h` tall (1.75 ≈ an adult when the
   * world's unit is a metre), facing `facing` radians around Y. Poses: standing, sitting, walking.
   */
  person(x: number, y: number, z: number, h = 1.75, facing = 0, pose: 'stand' | 'sit' | 'walk' = 'stand') {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    const u = h / 1.75;
    // Local (right, up, forward) in metres → world.
    const P = (r: number, up: number, f: number): [number, number, number] => [x + (r * c + f * s) * u, y + up * u, z + (-r * s + f * c) * u];
    const seg = (a: [number, number, number], b: [number, number, number]) => this.seg(...a, ...b);
    const sit = pose === 'sit';
    const hip = sit ? 0.48 : 0.95;
    const neck = hip + 0.58;
    const head = neck + 0.13;
    // Head (two rings) and body.
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2;
      const a1 = ((i + 1) / 10) * Math.PI * 2;
      seg(P(Math.cos(a0) * 0.1, head + Math.sin(a0) * 0.12, 0), P(Math.cos(a1) * 0.1, head + Math.sin(a1) * 0.12, 0));
      seg(P(0, head + Math.sin(a0) * 0.12, Math.cos(a0) * 0.1), P(0, head + Math.sin(a1) * 0.12, Math.cos(a1) * 0.1));
    }
    seg(P(0, neck, 0), P(0, hip, 0));
    seg(P(-0.2, neck - 0.05, 0), P(0.2, neck - 0.05, 0)); // shoulders
    seg(P(-0.13, hip, 0), P(0.13, hip, 0)); // hips
    const swing = pose === 'walk' ? 0.22 : 0;
    // Arms.
    for (const side of [-1, 1]) {
      const sh = P(side * 0.2, neck - 0.05, 0);
      const el = sit ? P(side * 0.24, neck - 0.32, 0.18) : P(side * 0.24, neck - 0.33, side * swing * 0.6);
      const hand = sit ? P(side * 0.2, neck - 0.4, 0.42) : P(side * 0.25, neck - 0.62, side * swing);
      seg(sh, el);
      seg(el, hand);
    }
    // Legs.
    for (const side of [-1, 1]) {
      const hp = P(side * 0.13, hip, 0);
      if (sit) {
        const knee = P(side * 0.14, hip, 0.45);
        seg(hp, knee);
        seg(knee, P(side * 0.14, 0, 0.48));
      } else {
        const knee = P(side * 0.13, hip * 0.5, -side * swing * 0.5);
        seg(hp, knee);
        seg(knee, P(side * 0.13, 0, -side * swing));
      }
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
