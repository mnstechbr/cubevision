import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  Object3D,
  PointsNodeMaterial,
  Sprite,
  Vector3,
} from 'three/webgpu';
import { color, float, hash, instanceIndex, instancedBufferAttribute, length, sin, smoothstep, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, fillMaterial, horizon, lineMaterial, strokes, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const TAU = Math.PI * 2;
// The workshop: x in [-W, W], z in [ZB, ZF], ceiling at H. The camera arrives at +z, looking at the table.
const W = 5.8;
const ZB = -7;
const ZF = 6.5;
const H = 3.8;
// The hero: projection table and the cube floating above it.
const CUBE = 0.5;
const CUBE_Y = 1.95;
const TR = 1.5;
const TOP = 0.92;
const ARM_X = 3.5;
const ARM_Z = -3.6;

/**
 * Draws into a `Lines` through a local frame: origin (x, y, z) and a turn around Y.
 * Local +z is "forward"; at angle 0 that is world +z (like `Lines.person`).
 */
class Pen {
  c = 1;
  s = 0;
  oy = 0;
  private ox = 0;
  private oz = 0;
  constructor(readonly l: Lines) {}
  at(x: number, y: number, z: number, ang = 0) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.c = Math.cos(ang);
    this.s = Math.sin(ang);
    return this;
  }
  X(x: number, z: number) {
    return this.ox + x * this.c + z * this.s;
  }
  Z(x: number, z: number) {
    return this.oz - x * this.s + z * this.c;
  }
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    this.l.seg(this.X(ax, az), this.oy + ay, this.Z(ax, az), this.X(bx, bz), this.oy + by, this.Z(bx, bz));
    return this;
  }
  path(pts: number[][], close = false) {
    for (let i = 0; i + 1 < pts.length; i++) this.seg(pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2]);
    if (close) this.seg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[pts.length - 1][2], pts[0][0], pts[0][1], pts[0][2]);
    return this;
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number) {
    const X = x + w;
    const Y = y + h;
    const Z = z + d;
    for (const yy of [y, Y]) this.seg(x, yy, z, X, yy, z).seg(X, yy, z, X, yy, Z).seg(X, yy, Z, x, yy, Z).seg(x, yy, Z, x, yy, z);
    return this.seg(x, y, z, x, Y, z).seg(X, y, z, X, Y, z).seg(X, y, Z, X, Y, Z).seg(x, y, Z, x, Y, Z);
  }
  /** Circle (or arc): 'h' horizontal, 'x' in the local XY plane, 'z' in the local ZY plane. */
  circ(cx: number, cy: number, cz: number, r: number, n = 16, plane: 'h' | 'x' | 'z' = 'h', a0 = 0, a1 = TAU) {
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const cs = Math.cos(a) * r;
      const sn = Math.sin(a) * r;
      const x = plane === 'z' ? cx : cx + cs;
      const y = plane === 'h' ? cy : cy + sn;
      const z = plane === 'h' ? cz + sn : plane === 'z' ? cz + cs : cz;
      if (i > 0) this.seg(px, py, pz, x, y, z);
      px = x;
      py = y;
      pz = z;
    }
    return this;
  }
  cyl(cx: number, y: number, cz: number, r: number, h: number, n = 12) {
    this.circ(cx, y, cz, r, n).circ(cx, y + h, cz, r, n);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      this.seg(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, cx + Math.cos(a) * r, y + h, cz + Math.sin(a) * r);
    }
    return this;
  }
}

type Map2 = (a: number, b: number) => [number, number, number];

// Hand tools drawn in a 2D frame (a along the tool, b across), placed in 3D by `m`.
const poly = (L: Lines, m: Map2, pts: number[][], close = false) => {
  for (let i = 0; i + 1 < pts.length; i++) L.seg(...m(pts[i][0], pts[i][1]), ...m(pts[i + 1][0], pts[i + 1][1]));
  if (close) L.seg(...m(pts[pts.length - 1][0], pts[pts.length - 1][1]), ...m(pts[0][0], pts[0][1]));
};
const disc = (L: Lines, m: Map2, a: number, b: number, r: number, n = 10) => {
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) pts.push([a + Math.cos((i / n) * TAU) * r, b + Math.sin((i / n) * TAU) * r]);
  poly(L, m, pts, true);
};
const TOOLS: ((L: Lines, m: Map2, len: number) => void)[] = [
  // open-end wrench
  (L, m, len) => {
    poly(L, m, [[0.04, 0.013], [len, 0.013], [len + 0.025, 0.036], [len + 0.07, 0.036], [len + 0.07, 0.014]]);
    poly(L, m, [[0.04, -0.013], [len, -0.013], [len + 0.025, -0.036], [len + 0.07, -0.036], [len + 0.07, -0.014]]);
    disc(L, m, 0, 0, 0.04);
  },
  // hammer
  (L, m, len) => {
    poly(L, m, [[0, 0.013], [len, 0.013], [len, -0.013], [0, -0.013]], true);
    poly(L, m, [[len - 0.03, 0.04], [len + 0.07, 0.04], [len + 0.07, -0.04], [len - 0.03, -0.04]], true);
    poly(L, m, [[len - 0.03, 0.025], [len - 0.1, 0.05]]);
  },
  // screwdriver
  (L, m, len) => {
    poly(L, m, [[0, 0.022], [0.12, 0.022], [0.12, -0.022], [0, -0.022]], true);
    poly(L, m, [[0.12, 0], [len, 0]]);
    poly(L, m, [[len, 0.008], [len + 0.025, 0], [len, -0.008]]);
  },
  // pliers
  (L, m, len) => {
    poly(L, m, [[0, 0.03], [len * 0.55, 0.01], [len, 0.025], [len, 0.006], [len * 0.7, -0.002]]);
    poly(L, m, [[0, -0.03], [len * 0.55, -0.01], [len, -0.025], [len, -0.006], [len * 0.7, 0.002]]);
    disc(L, m, len * 0.55, 0, 0.012, 6);
  },
  // tape measure
  (L, m, len) => {
    disc(L, m, len * 0.4, 0, 0.07, 14);
    disc(L, m, len * 0.4, 0, 0.035, 10);
    poly(L, m, [[len * 0.4 + 0.07, 0.02], [len * 0.4 + 0.12, 0.02]]);
  },
];

// Seven-segment glyphs: whiteboard "handwriting" for equations.
const SEG7 = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
function txt(p: Pen, s: string, x: number, y: number, h: number, z = 0.02) {
  const w = h * 0.5;
  for (const ch of s) {
    const d = '0123456789'.indexOf(ch);
    if (d >= 0) {
      const m = SEG7[d];
      const my = y + h / 2;
      if (m & 1) p.seg(x, y + h, z, x + w, y + h, z);
      if (m & 2) p.seg(x + w, y + h, z, x + w, my, z);
      if (m & 4) p.seg(x + w, my, z, x + w, y, z);
      if (m & 8) p.seg(x, y, z, x + w, y, z);
      if (m & 16) p.seg(x, y, z, x, my, z);
      if (m & 32) p.seg(x, my, z, x, y + h, z);
      if (m & 64) p.seg(x, my, z, x + w, my, z);
      x += w * 1.45;
    } else if (ch === '=') {
      p.seg(x, y + h * 0.36, z, x + w, y + h * 0.36, z).seg(x, y + h * 0.64, z, x + w, y + h * 0.64, z);
      x += w * 1.45;
    } else if (ch === '+') {
      p.seg(x, y + h / 2, z, x + w, y + h / 2, z).seg(x + w / 2, y + h * 0.25, z, x + w / 2, y + h * 0.75, z);
      x += w * 1.45;
    } else if (ch === 'x') {
      p.seg(x, y + h * 0.25, z, x + w, y + h * 0.75, z).seg(x, y + h * 0.75, z, x + w, y + h * 0.25, z);
      x += w * 1.45;
    } else if (ch === '/') {
      p.seg(x, y, z, x + w, y + h, z);
      x += w * 1.45;
    } else if (ch === '.') {
      p.seg(x, y, z, x + w * 0.1, y + w * 0.1, z);
      x += w * 0.5;
    } else x += w * 0.9;
  }
}

type Wall = 'back' | 'front' | 'left' | 'right';
interface Op {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  door?: boolean;
}
const SPAN: Record<Wall, [number, number]> = { back: [-W, W], front: [-W, W], left: [ZB, ZF], right: [ZB, ZF] };
const OPENINGS: Record<Wall, Op[]> = {
  back: [
    { u0: -4.4, u1: -2.6, v0: 1.55, v1: 3.2 },
    { u0: -1.1, u1: 1.1, v0: 1.25, v1: 3.35 },
    { u0: 2.6, u1: 4.4, v0: 1.55, v1: 3.2 },
  ],
  front: [
    { u0: -4.4, u1: -2.2, v0: 1.4, v1: 3.1 },
    { u0: 2.2, u1: 4.4, v0: 1.4, v1: 3.1 },
  ],
  left: [{ u0: -1.6, u1: 0.7, v0: 1.3, v1: 3.1 }],
  right: [
    { u0: -2.9, u1: -1.7, v0: 0, v1: 2.2, door: true },
    { u0: 0.3, u1: 2.5, v0: 1.3, v1: 3.1 },
  ],
};
const NRM: Record<Wall, [number, number]> = { back: [0, 1], front: [0, -1], left: [1, 0], right: [-1, 0] };
const WALLS: Wall[] = ['back', 'front', 'left', 'right'];

/** Point on a wall: `u` runs along it (world x or z), `v` is height, `off` pushes into the room. */
const wpt = (w: Wall, u: number, v: number, off = 0): [number, number, number] => {
  const [nx, nz] = NRM[w];
  const b: [number, number, number] = w === 'back' ? [u, v, ZB] : w === 'front' ? [u, v, ZF] : w === 'left' ? [-W, v, u] : [W, v, u];
  return [b[0] + nx * off, b[1], b[2] + nz * off];
};
const wl = (L: Lines, w: Wall, u0: number, v0: number, u1: number, v1: number, off = 0) => L.seg(...wpt(w, u0, v0, off), ...wpt(w, u1, v1, off));
const wr = (L: Lines, w: Wall, u0: number, v0: number, u1: number, v1: number, off = 0) => {
  wl(L, w, u0, v0, u1, v0, off);
  wl(L, w, u1, v0, u1, v1, off);
  wl(L, w, u1, v1, u0, v1, off);
  wl(L, w, u0, v1, u0, v0, off);
};
const free = (a0: number, a1: number, blocks: [number, number][]) => {
  const out: [number, number][] = [];
  let cur = a0;
  for (const [b0, b1] of [...blocks].sort((p, q) => p[0] - q[0])) {
    if (b0 > cur) out.push([cur, Math.min(b0, a1)]);
    cur = Math.max(cur, b1);
  }
  if (cur < a1) out.push([cur, a1]);
  return out.filter(([x, y]) => y > x);
};
const inside = (ops: Op[], u: number, v: number, m: number) => ops.some((o) => u > o.u0 - m && u < o.u1 + m && v > o.v0 - m && v < o.v1 + m);
const blocksAt = (ops: Op[], v: number) => ops.filter((o) => v > o.v0 - 0.02 && v < o.v1 + 0.02).map((o) => [o.u0, o.u1] as [number, number]);

const FACES = 6;
interface Mon {
  ox: number;
  oy: number;
  oz: number;
  ux: number;
  uz: number;
  w: number;
  h: number;
}
const SEGS = 6 + 12 + 3; // bars + graph + text rows, per screen

/** [0]+[1] The inventor's workshop at night: a projection table, a strange cube, a crack on its back. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(7);
  const k = ctx.detail;
  const thin = (o: number, tint = CYAN) => lineMaterial(fade, tint, o);
  const lit = (l: Lines, o: number, tint = CYAN) => root.add(new LineSegments(l.geometry(), thin(o, tint)));

  const frame = new Lines(); // thick structure
  const shell = new Lines(); // walls, beams, windows
  const fine = new Lines(); // faint dense surfaces (planks, bricks)
  const prop = new Lines(); // furniture and tools
  const pp = new Pen(prop);
  const pf = new Pen(frame);
  const mons: Mon[] = [];

  // ── Shell ───────────────────────────────────────────────────────────────────────────────
  frame.rect(-W, 0, ZB, W, ZF).rect(-W, H, ZB, W, ZF);
  for (const [x, z] of [[-W, ZB], [W, ZB], [W, ZF], [-W, ZF]]) frame.seg(x, 0, z, x, H, z);
  shell.rect(-W + 0.05, 0.12, ZB + 0.05, W - 0.05, ZF - 0.05);

  const brick = 0.2 + (1 - k) * 0.14;
  for (const w of WALLS) {
    const [a0, a1] = SPAN[w];
    const ops = OPENINGS[w];
    // Wainscot: boards up to a rail, brick courses above, staggered joints.
    for (const v of [0.12, 1.1]) for (const [x, y] of free(a0, a1, blocksAt(ops, v))) wl(shell, w, x, v, y, v, 0.01);
    for (let u = a0 + 0.3; u < a1; u += 0.3) if (!inside(ops, u, 0.5, 0)) wl(fine, w, u, 0.12, u, 1.1, 0.01);
    let row = 0;
    for (let v = 1.1 + brick; v < H - 0.01; v += brick, row++) {
      for (const [x, y] of free(a0, a1, blocksAt(ops, v))) wl(fine, w, x, v, y, v, 0.01);
      for (let u = a0 + (row % 2 ? 0.55 : 0.3); u < a1; u += 0.5) if (!inside(ops, u, v - brick / 2, 0.02)) wl(fine, w, u, v - brick, u, v, 0.01);
    }
    // Windows: frame (thick), inner frame, mullions, sill and glints.
    for (const o of ops) {
      if (o.door) continue;
      wr(frame, w, o.u0, o.v0, o.u1, o.v1);
      wr(shell, w, o.u0 + 0.07, o.v0 + 0.07, o.u1 - 0.07, o.v1 - 0.07, 0.01);
      const um = (o.u0 + o.u1) / 2;
      const vm = o.v0 + (o.v1 - o.v0) * 0.62;
      wl(shell, w, um, o.v0, um, o.v1, 0.01);
      wl(shell, w, o.u0, vm, o.u1, vm, 0.01);
      wl(fine, w, o.u0 + 0.15, o.v0 + 0.15, o.u0 + 0.55, o.v1 - 0.15, 0.01);
      wl(fine, w, o.u0 + 0.25, o.v0 + 0.15, o.u0 + 0.65, o.v1 - 0.15, 0.01);
      wl(shell, w, o.u0 - 0.1, o.v0 - 0.04, o.u1 + 0.1, o.v0 - 0.04, 0.16);
      for (const u of [o.u0 - 0.1, o.u1 + 0.1]) shell.seg(...wpt(w, u, o.v0 - 0.04, 0), ...wpt(w, u, o.v0 - 0.04, 0.16));
    }
  }
  // Door in the right wall: frame, panels, glass, handle, exit sign.
  {
    const o = OPENINGS.right[0];
    const zc = (o.u0 + o.u1) / 2;
    wr(frame, 'right', o.u0, 0, o.u1, o.v1);
    wr(frame, 'right', o.u0 - 0.1, 0, o.u1 + 0.1, o.v1 + 0.12, 0.02);
    wr(shell, 'right', o.u0 + 0.1, 0.1, o.u1 - 0.1, 0.95, 0.03);
    wr(shell, 'right', o.u0 + 0.1, 1.05, o.u1 - 0.1, 2.1, 0.03);
    wr(shell, 'right', o.u0 + 0.25, 1.25, o.u1 - 0.25, 1.9, 0.04);
    wl(fine, 'right', zc, 1.25, zc, 1.9, 0.04);
    wl(fine, 'right', o.u0 + 0.25, 1.57, o.u1 - 0.25, 1.57, 0.04);
    const dp = new Pen(prop).at(W, 0, zc, -Math.PI / 2);
    dp.circ(-0.4, 1.0, 0.07, 0.04, 10, 'x').seg(-0.4, 1.0, 0.07, -0.4, 1.0, 0.13).seg(-0.4, 1.0, 0.13, -0.2, 1.0, 0.13);
    dp.box(-0.28, 2.42, 0, 0.56, 0.2, 0.06).seg(-0.2, 2.52, 0.065, 0.2, 2.52, 0.065).seg(0.1, 2.58, 0.065, 0.2, 2.52, 0.065).seg(0.1, 2.46, 0.065, 0.2, 2.52, 0.065);
    for (let i = 0; i < 4; i++) dp.seg(0.55, 1.5 + i * 0.12, 0.02, 0.55, 1.58 + i * 0.12, 0.02); // coat hooks row
    dp.box(0.5, 1.4, 0, 0.1, 0.5, 0.03);
  }

  // Floor: planks with staggered joints, and a rug under the table.
  for (let z = ZB; z <= ZF + 0.01; z += 0.45) fine.seg(-W, 0, z, W, 0, z);
  for (let i = 0, z = ZB; z < ZF; z += 0.45, i++) for (let x = -W + ((i * 0.9) % 2.1); x < W; x += 2.1) fine.seg(x, 0, z, x, 0, z + 0.45);
  prop.rect(-2.7, 0.01, -2.3, 2.7, 2.3).rect(-2.55, 0.01, -2.15, 2.55, 2.15).rect(-2.2, 0.01, -1.8, 2.2, 1.8);
  for (let i = -9; i <= 9; i++) {
    prop.seg(i * 0.28, 0.01, -2.3, i * 0.28, 0.01, -2.45).seg(i * 0.28, 0.01, 2.3, i * 0.28, 0.01, 2.45);
  }
  for (let i = 0; i < 4; i++) prop.seg(-2.2 + i * 1.47, 0.01, -1.8, -2.2 + i * 1.47 + 0.73, 0.01, 0).seg(-2.2 + i * 1.47 + 0.73, 0.01, 0, -2.2 + i * 1.47 + 1.47, 0.01, 1.8);

  // Ceiling: planks, cross beams with corbels, a pipe run and a cable tray.
  for (let x = -W + 0.4; x < W - 0.01; x += 0.4) fine.seg(x, H, ZB, x, H, ZF);
  for (const z of [-5.6, -3.2, -0.8, 1.6, 4.0]) {
    shell.box(-W, H - 0.34, z - 0.12, W * 2, 0.34, 0.24);
    for (const s of [-1, 1]) shell.seg(s * W, H - 0.34 - 0.55, z, s * (W - 0.55), H - 0.34, z).seg(s * W, H - 0.34 - 0.55, z - 0.12, s * W, H - 0.34, z - 0.12);
  }
  for (let z = ZB + 0.4; z < ZF; z += 0.9) pp.at(0, 0, 0).circ(-W + 0.14, 3.3, z, 0.09, 10, 'z');
  prop.seg(-W + 0.14, 3.39, ZB, -W + 0.14, 3.39, ZF).seg(-W + 0.14, 3.21, ZB, -W + 0.14, 3.21, ZF);
  for (let z = ZB + 1.2; z < ZF; z += 1.8) prop.seg(-W, 3.3, z, -W + 0.05, 3.3, z);
  prop.seg(-W + 0.14, 3.21, -4.6, -W + 0.14, 0.12, -4.6).seg(-W + 0.05, 3.21, -4.6, -W + 0.05, 0.12, -4.6);
  prop.rect(W - 0.5, H - 0.1, ZB, W - 0.2, ZF);
  for (let z = ZB + 0.3; z < ZF; z += 0.3) prop.seg(W - 0.5, H - 0.1, z, W - 0.2, H - 0.1, z);

  // ── Benches along the back wall ─────────────────────────────────────────────────────────
  const bench = (x0: number, x1: number) => {
    const d = 0.8;
    pp.at(0, 0, 0).box(x0, 0.86, ZB, x1 - x0, 0.06, d).box(x0, 0.2, ZB + 0.05, x1 - x0, 0.03, d - 0.1);
    for (let x = x0 + 0.05; x < x1; x += (x1 - x0 - 0.1) / 3) prop.seg(x, 0, ZB + d - 0.05, x, 0.86, ZB + d - 0.05).seg(x, 0, ZB + 0.05, x, 0.86, ZB + 0.05);
    for (const x of [x0 + 0.12, x1 - 1.0]) {
      pp.box(x, 0.23, ZB + 0.04, 0.9, 0.63, d - 0.08);
      for (let i = 0; i < 3; i++) {
        const y = 0.23 + i * 0.21;
        if (i) prop.seg(x, y, ZB + d - 0.04, x + 0.9, y, ZB + d - 0.04);
        prop.seg(x + 0.35, y + 0.1, ZB + d - 0.03, x + 0.55, y + 0.1, ZB + d - 0.03);
      }
    }
  };
  bench(-W, -0.9);
  bench(0.9, W);
  // Tool wall: pegboards at both ends of the back wall, hung with hand tools.
  const pegboard = (x0: number, x1: number) => {
    wr(frame, 'back', x0, 1.3, x1, 3.3);
    for (let v = 1.45; v < 3.3; v += 0.15) wl(fine, 'back', x0, v, x1, v, 0.01);
    for (let u = x0 + 0.15; u < x1; u += 0.15) wl(fine, 'back', u, 1.3, u, 3.3, 0.01);
    for (let u = x0 + 0.17, i = 0; u < x1 - 0.1; u += 0.27, i++) {
      for (const top of [3.2, 2.35]) {
        const len = 0.28 + rand() * 0.22;
        const x = u;
        TOOLS[Math.floor(rand() * TOOLS.length)](prop, (a, b) => [x + b, top - a, ZB + 0.03], len);
        if (i % 2) {
          const x2 = x + 0.1;
          prop.seg(x2, top + 0.04, ZB + 0.03, x2, top + 0.04, ZB + 0.08);
        }
      }
    }
  };
  pegboard(-W + 0.02, -4.55);
  pegboard(4.55, W - 0.02);

  // The big pieces get a bold outline so the room reads at a glance.
  pf.at(0, 0, 0).box(-W, 0.86, ZB, W - 0.9, 0.06, 0.8).box(0.9, 0.86, ZB, W - 0.9, 0.06, 0.8).box(-0.7, 0.1, -6.8, 1.0, 0.95, 0.6);
  pf.at(-W, 0, -5.1, Math.PI / 2).box(-1.25, 0, 0, 2.5, 2.1, 0.42);
  pf.at(W, 0, -4.9, -Math.PI / 2).box(-1.55, 0, 0, 3.1, 2.34, 0.46);
  pf.at(ARM_X, 0, ARM_Z).cyl(0, 0, 0, 0.3, 0.45, 16);

  // Left bench: soldering station, laptop, mug, oscilloscope, parts organiser.
  pp.at(0, 0, 0)
    .box(-5.15, 0.92, -6.75, 0.32, 0.1, 0.26)
    .circ(-5.0, 0.97, -6.49, 0.04, 12, 'x')
    .seg(-5.1, 1.0, -6.49, -5.1, 1.04, -6.49)
    .path([[-4.7, 0.92, -6.6], [-4.7, 0.98, -6.6], [-4.66, 1.0, -6.6], [-4.74, 1.02, -6.6], [-4.66, 1.04, -6.6], [-4.74, 1.06, -6.6], [-4.7, 1.08, -6.6]])
    .path([[-4.7, 1.04, -6.55], [-4.45, 0.98, -6.4], [-4.3, 0.945, -6.32]])
    .path([[-4.5, 0.99, -6.4], [-4.9, 0.93, -6.45], [-5.0, 0.99, -6.55]])
    .path([[-5.45, 0.92, -6.85], [-5.45, 1.3, -6.85], [-5.38, 1.52, -6.74], [-5.2, 1.6, -6.58]])
    .box(-5.3, 1.5, -6.66, 0.2, 0.1, 0.14)
    .path([[-4.2, 0.92, -6.8], [-4.2, 1.25, -6.8], [-4.34, 1.5, -6.62]])
    .circ(-4.35, 1.5, -6.55, 0.14, 14, 'x')
    .circ(-4.35, 1.5, -6.55, 0.1, 12, 'x')
    .box(-5.78, 0.92, -6.78, 0.5, 0.45, 0.3);
  for (let i = 1; i < 4; i++) pp.seg(-5.78, 0.92 + i * 0.1125, -6.48, -5.28, 0.92 + i * 0.1125, -6.48);
  for (let i = 1; i < 3; i++) pp.seg(-5.78 + i * 0.167, 0.92, -6.48, -5.78 + i * 0.167, 1.37, -6.48);
  pp.box(-3.57, 0.92, -6.62, 0.34, 0.02, 0.24)
    .path([[-3.57, 0.94, -6.62], [-3.57, 1.2, -6.7], [-3.23, 1.2, -6.7], [-3.23, 0.94, -6.62]])
    .seg(-3.55, 0.945, -6.5, -3.25, 0.945, -6.5)
    .seg(-3.55, 0.945, -6.45, -3.25, 0.945, -6.45)
    .seg(-3.5, 0.945, -6.4, -3.3, 0.945, -6.4)
    .cyl(-2.65, 0.92, -6.45, 0.04, 0.09, 10)
    .circ(-2.6, 0.965, -6.45, 0.028, 8, 'x', -Math.PI / 2, Math.PI / 2)
    .path([[-2.65, 1.03, -6.45], [-2.67, 1.08, -6.45], [-2.63, 1.13, -6.45], [-2.67, 1.18, -6.45]])
    .box(-2.0, 0.92, -6.8, 0.45, 0.3, 0.32);
  pp.seg(-1.95, 0.98, -6.48, -1.64, 0.98, -6.48).seg(-1.64, 0.98, -6.48, -1.64, 1.18, -6.48).seg(-1.64, 1.18, -6.48, -1.95, 1.18, -6.48).seg(-1.95, 1.18, -6.48, -1.95, 0.98, -6.48);
  for (let i = 0; i < 3; i++) pp.circ(-1.57 + i * 0.0, 1.14 - i * 0.07, -6.48, 0.025, 8, 'x');
  pp.path([[-1.5, 0.95, -6.45], [-1.2, 0.93, -6.3], [-1.0, 0.92, -6.2]]).path([[-1.55, 0.95, -6.45], [-1.3, 0.94, -6.2], [-1.1, 0.92, -6.05]]);

  // Right bench: tool chest, bench grinder, wrenches laid out, a vice with work clamped in it.
  pp.at(0, 0, 0)
    .box(1.2, 0.92, -6.75, 0.6, 0.22, 0.3)
    .seg(1.2, 1.04, -6.45, 1.8, 1.04, -6.45)
    .circ(1.5, 1.14, -6.45, 0.1, 10, 'x', 0, Math.PI)
    .box(2.1, 0.92, -6.7, 0.5, 0.1, 0.26)
    .cyl(2.35, 1.02, -6.57, 0.07, 0.2, 10)
    .circ(2.17, 1.12, -6.57, 0.1, 14, 'z')
    .circ(2.55, 1.12, -6.57, 0.08, 14, 'z')
    .circ(2.17, 1.12, -6.57, 0.13, 14, 'z', 0.3, 2.9)
    .box(3.5, 0.92, -6.45, 0.3, 0.08, 0.26)
    .box(3.5, 1.0, -6.45, 0.3, 0.11, 0.06)
    .box(3.5, 1.0, -6.31, 0.3, 0.11, 0.06)
    .seg(3.65, 1.05, -6.25, 3.65, 1.05, -6.0)
    .seg(3.5, 1.05, -6.0, 3.8, 1.05, -6.0)
    .circ(3.5, 1.05, -6.0, 0.015, 6, 'x')
    .circ(3.8, 1.05, -6.0, 0.015, 6, 'x')
    .seg(3.55, 1.07, -6.45, 3.55, 1.07, -6.2)
    .seg(3.75, 1.07, -6.45, 3.75, 1.07, -6.2)
    .cyl(3.65, 1.11, -6.4, 0.04, 0.12, 8);
  for (let i = 0; i < 3; i++) {
    const a = 0.2 + i * 0.5;
    TOOLS[0](prop, (u, v) => [4.3 + 0.2 * i + u * Math.cos(a) - v * Math.sin(a), 0.925, -6.4 + u * Math.sin(a) + v * Math.cos(a)], 0.22 + i * 0.04);
  }
  for (let i = 0; i < 4; i++) prop.circle(5.2, 0.93 + i * 0.012, -6.5, 0.13 - i * 0.015, 14);
  prop.box(4.3, 0.92, -6.75, 0.5, 0.06, 0.26).seg(4.3, 0.98, -6.62, 4.8, 0.98, -6.62);
  // Under the benches: crates and a bin.
  pp.at(0, 0, 0).box(-5.5, 0.03, -6.7, 0.7, 0.45, 0.5).box(2.6, 0.03, -6.7, 0.9, 0.5, 0.5).cyl(4.9, 0.03, -6.4, 0.22, 0.5, 12);
  // Centre of the back wall: a tall toolbox on casters and a stool.
  pp.at(0, 0, 0).box(-0.7, 0.1, -6.8, 1.0, 0.95, 0.6).seg(-0.7, 0.1 + 0.19, -6.2, 0.3, 0.1 + 0.19, -6.2);
  for (let i = 1; i < 5; i++) pp.seg(-0.7, 0.1 + i * 0.19, -6.2, 0.3, 0.1 + i * 0.19, -6.2).seg(-0.25, 0.1 + i * 0.19 - 0.09, -6.19, 0.0, 0.1 + i * 0.19 - 0.09, -6.19);
  for (const x of [-0.65, 0.25]) pp.circ(x, 0.05, -6.3, 0.05, 8, 'z');

  // ── Left wall: parts cabinet, drafting table ────────────────────────────────────────────
  {
    const c = new Pen(prop).at(-W, 0, -5.1, Math.PI / 2); // local x runs along the wall
    c.box(-1.25, 0, 0, 2.5, 2.1, 0.42);
    for (let i = 0; i <= 8; i++) c.seg(-1.25 + i * (2.5 / 8), 0.12, 0.425, -1.25 + i * (2.5 / 8), 2.0, 0.425);
    for (let j = 0; j <= 7; j++) c.seg(-1.25, 0.12 + j * 0.27, 0.425, 1.25, 0.12 + j * 0.27, 0.425);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 7; j++) c.seg(-1.25 + (i + 0.35) * 0.3125, 0.12 + (j + 0.55) * 0.27, 0.43, -1.25 + (i + 0.65) * 0.3125, 0.12 + (j + 0.55) * 0.27, 0.43);
    const d = new Pen(prop).at(-W + 0.05, 0, -0.45, Math.PI / 2); // under the left window
    d.path([[-0.8, 1.2, 0.1], [0.8, 1.2, 0.1], [0.8, 0.95, 0.85], [-0.8, 0.95, 0.85]], true);
    for (const x of [-0.75, 0.75]) d.seg(x, 0, 0.15, x, 1.2, 0.15).seg(x, 0, 0.8, x, 0.95, 0.8).seg(x, 0.5, 0.15, x, 0.5, 0.8);
    d.seg(-0.8, 1.05, 0.55, 0.8, 1.05, 0.55).path([[0.2, 1.1, 0.4], [0.6, 1.1, 0.4], [0.6, 1.12, 0.5], [0.2, 1.12, 0.5]], true);
    d.path([[-0.6, 1.15, 0.3], [-0.6, 1.62, 0.1], [-0.35, 1.8, 0.2]]).circ(-0.35, 1.78, 0.25, 0.1, 10, 'z');
    d.seg(-0.3, 1.2, 0.2, -0.3, 1.2, 0.8).seg(-0.28, 1.2, 0.2, -0.28, 1.2, 0.8);
  }
  // Round stool near the left bench and a workshop chair near the table.
  {
    const s = (x: number, z: number) => {
      pp.at(x, 0, z).circ(0, 0.66, 0, 0.19, 12).circ(0, 0.62, 0, 0.19, 12).circ(0, 0.25, 0, 0.2, 12);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.5;
        pp.seg(Math.cos(a) * 0.14, 0.62, Math.sin(a) * 0.14, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
      }
    };
    s(-3.3, -5.5);
    s(0.9, -5.6);
    pp.at(-2.3, 0, 1.7, 2.2).box(-0.22, 0.45, -0.22, 0.44, 0.04, 0.44);
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) pp.seg(x, 0, z, x, 0.45, z);
    pp.seg(-0.2, 0.49, -0.2, -0.2, 0.98, -0.2).seg(0.2, 0.49, -0.2, 0.2, 0.98, -0.2).seg(-0.2, 0.98, -0.2, 0.2, 0.98, -0.2);
    for (let i = 0; i < 3; i++) pp.seg(-0.2, 0.6 + i * 0.12, -0.2, 0.2, 0.6 + i * 0.12, -0.2);
    pp.seg(-0.2, 0.2, -0.2, 0.2, 0.2, -0.2).seg(-0.2, 0.2, 0.2, 0.2, 0.2, 0.2);
  }

  // ── Right wall: shelving full of parts ─────────────────────────────────────────────────
  {
    const s = new Pen(prop).at(W, 0, -4.9, -Math.PI / 2); // local x along the wall, z out into the room
    const levels = [0.05, 0.62, 1.18, 1.74, 2.3];
    for (const y of levels) s.box(-1.55, y, 0, 3.1, 0.035, 0.46);
    for (const x of [-1.55, -0.52, 0.52, 1.55]) s.seg(x, 0, 0.44, x, 2.34, 0.44).seg(x, 0, 0.02, x, 2.34, 0.02);
    for (let li = 0; li + 1 < levels.length; li++) {
      const y = levels[li] + 0.035;
      const top = levels[li + 1] - y - 0.04;
      for (let x = -1.45; x < 1.35; ) {
        const kind = Math.floor(rand() * 5);
        const hh = Math.min(top, 0.15 + rand() * 0.3);
        const ww = 0.14 + rand() * 0.2;
        if (kind <= 1) {
          s.box(x, y, 0.1, ww, hh, 0.3);
          s.seg(x + ww * 0.15, y + hh * 0.35, 0.405, x + ww * 0.85, y + hh * 0.35, 0.405).seg(x + ww * 0.15, y + hh * 0.7, 0.405, x + ww * 0.85, y + hh * 0.7, 0.405);
          if (kind === 1) s.seg(x, y, 0.4, x + ww, y + hh, 0.4);
        } else if (kind === 2) {
          const r = Math.min(ww, 0.2) / 2;
          s.cyl(x + r, y, 0.25, r, Math.min(top, 0.18 + rand() * 0.14), 10);
        } else if (kind === 3) {
          const r = Math.min(top / 2, 0.1 + rand() * 0.05);
          s.circ(x + r, y + r, 0.3, r, 12, 'x').circ(x + r, y + r, 0.3, r * 0.45, 8, 'x');
          for (let i = 0; i < 6; i++) s.seg(x + r, y + r, 0.3, x + r + Math.cos((i / 6) * TAU) * r, y + r + Math.sin((i / 6) * TAU) * r, 0.3);
          s.circ(x + r, y + r, 0.34, r, 12, 'x');
        } else {
          s.cyl(x + 0.07, y, 0.25, 0.07, 0.12, 8);
          s.cyl(x + 0.07, y + 0.12, 0.25, 0.03, 0.1, 6);
        }
        x += ww + 0.06 + rand() * 0.08;
      }
    }
  }

  // Crates and barrels in the front corners.
  pp.at(0, 0, 0);
  for (const [x, z, a, h] of [[4.5, 3.9, 0.15, 0.5], [3.7, 4.55, -0.2, 0.5], [4.3, 4.0, 0.5, 1.02]]) {
    pp.at(x, h > 0.9 ? 0 : 0, z, a).box(-0.35, h > 0.9 ? 0.5 : 0, -0.25, 0.7, 0.5, 0.5);
    for (let i = 0; i < 2; i++) {
      const y = (h > 0.9 ? 0.5 : 0) + 0.15 + i * 0.2;
      pp.seg(-0.35, y, 0.25, 0.35, y, 0.25).seg(0.35, y, -0.25, 0.35, y, 0.25);
    }
    pp.seg(-0.35, h > 0.9 ? 0.5 : 0, 0.25, 0.35, h > 0.9 ? 1.0 : 0.5, 0.25);
  }
  for (const [x, z] of [[-4.9, 4.2], [-4.3, 5.1]]) {
    pp.at(x, 0, z).cyl(0, 0, 0, 0.3, 0.85, 14);
    for (const y of [0.15, 0.42, 0.7]) pp.circ(0, y, 0, 0.31, 14);
  }
  pp.at(-4.9, 0, 4.2).circ(0, 0.85, 0, 0.2, 12);

  // Cables snaking across the floor from the table base (pairs of lines, a little loose).
  const cable = (x0: number, z0: number, x1: number, z1: number, amp: number, h1 = 0) => {
    const n = 26;
    let px = x0;
    let pz = z0;
    let py = 0.015;
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const off = Math.sin(t * Math.PI * 3.1 + x0) * amp * Math.sin(t * Math.PI);
      const x = x0 + dx * t + (-dz / len) * off;
      const z = z0 + dz * t + (dx / len) * off;
      const y = 0.015 + h1 * t * t * t;
      prop.seg(px, py, pz, x, y, z).seg(px + 0.018, py, pz, x + 0.018, y, z);
      px = x;
      pz = z;
      py = y;
    }
  };
  cable(-0.9, -1.1, -3.0, -6.0, 0.5);
  cable(0.8, -1.2, 2.3, -6.0, 0.4);
  cable(1.0, -0.8, 3.4, -3.6, 0.35);
  cable(-1.0, 0.9, -W + 0.1, 0.3, 0.5, 0.3);
  cable(0.5, 1.2, W - 0.1, -0.7, 0.6, 0.3);
  cable(-0.3, -1.2, -2.5, -3.0, 0.3);
  for (let i = 0; i < 5; i++) prop.circle(-2.6, 0.02 + i * 0.012, 3.4, 0.28 - i * 0.04, 16); // coiled extension cord
  for (let b = 0; b < 3; b++) {
    const z0 = -4.5 + b * 4;
    let px = -W + 0.3;
    let py = H - 0.34;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16;
      const x = -W + 0.3 + (2 * W - 0.6) * t;
      const y = H - 0.34 - Math.sin(t * Math.PI) * (0.35 + b * 0.1);
      prop.seg(px, py, z0, x, y, z0);
      px = x;
      py = y;
    }
  }

  // ── Whiteboard on a stand, turned toward the table ─────────────────────────────────────
  {
    const bpen = new Pen(prop).at(-3.7, 0, -3.2, 0.75);
    pf.at(-3.7, 0, -3.2, 0.75).box(-1.15, 0.92, -0.02, 2.3, 1.38, 0.04);
    const b = bpen;
    b.box(-1.0, 0.92, 0, 2.0, 0.04, 0.1);
    for (const x of [-0.95, 0.95]) {
      b.seg(x, 0.92, -0.02, x * 1.2, 0, -0.2).seg(x, 0.92, -0.02, x * 1.2, 0, 0.35);
      b.circ(x * 1.2, 0.05, -0.2, 0.05, 8, 'z').circ(x * 1.2, 0.05, 0.35, 0.05, 8, 'z');
    }
    b.seg(-1.14, 0.35, -0.2, 1.14, 0.35, -0.2);
    for (let i = 0; i < 3; i++) b.seg(-0.7 + i * 0.12, 0.96, 0.05, -0.62 + i * 0.12, 0.96, 0.05);
    // The cube, sketched: hexagon with a Y, a crack drawn on the far face and a question mark.
    const cx = -0.55;
    const cy = 1.78;
    const r = 0.3;
    const hx = (i: number) => [cx + Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * r, cy + Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * r];
    for (let i = 0; i < 6; i++) b.seg(hx(i)[0], hx(i)[1], 0.02, hx((i + 1) % 6)[0], hx((i + 1) % 6)[1], 0.02);
    for (const i of [0, 2, 4]) b.seg(cx, cy, 0.02, hx(i)[0], hx(i)[1], 0.02);
    b.path([[cx - 0.05, cy + 0.05, 0.02], [cx - 0.1, cy + 0.12, 0.02], [cx - 0.06, cy + 0.16, 0.02], [cx - 0.14, cy + 0.22, 0.02]]);
    b.circ(cx - 0.1, cy + 0.15, 0.02, 0.1, 12, 'x');
    b.path([[cx - 0.55, cy + 0.38, 0.02], [cx - 0.3, cy + 0.3, 0.02], [cx - 0.2, cy + 0.2, 0.02]]).path([[cx - 0.25, cy + 0.22, 0.02], [cx - 0.2, cy + 0.2, 0.02], [cx - 0.24, cy + 0.27, 0.02]]);
    b.circ(cx - 0.7, cy + 0.42, 0.02, 0.05, 8, 'x', Math.PI * 0.2, Math.PI * 1.6);
    b.seg(cx - 0.7, cy + 0.34, 0.02, cx - 0.7, cy + 0.32, 0.02);
    b.seg(cx - r, cy - r - 0.12, 0.02, cx + r, cy - r - 0.12, 0.02).seg(cx - r, cy - r - 0.16, 0.02, cx - r, cy - r - 0.08, 0.02).seg(cx + r, cy - r - 0.16, 0.02, cx + r, cy - r - 0.08, 0.02);
    txt(b, '0.65', cx - 0.12, cy - r - 0.3, 0.1);
    // Equations (seven-segment "handwriting"), a gyroscope, a graph, notes.
    txt(b, '9 x 9 x 9 = 729', 0.02, 2.12, 0.1);
    txt(b, '3.7 + 1.4 = 5.1', 0.02, 1.94, 0.1);
    txt(b, '7 / 3 = 2.33', 0.02, 1.76, 0.1);
    b.seg(0.02, 1.7, 0.02, 0.85, 1.7, 0.02);
    for (let i = 0; i < 3; i++) b.circ(0.55, 1.35, 0.02, 0.22 - i * 0.06, 20, i === 0 ? 'x' : 'z');
    b.seg(0.55, 1.1, 0.02, 0.55, 1.6, 0.02).seg(0.28, 1.35, 0.02, 0.82, 1.35, 0.02);
    b.circ(0.55, 1.35, 0.02, 0.3, 16, 'x', 0.4, 2.4).path([[0.35, 1.58, 0.02], [0.3, 1.62, 0.02], [0.37, 1.65, 0.02]]);
    b.seg(-1.0, 1.05, 0.02, -1.0, 1.4, 0.02).seg(-1.0, 1.05, 0.02, -0.35, 1.05, 0.02);
    for (let i = 0; i < 20; i++) b.seg(-1.0 + (i * 0.65) / 20, 1.2 + Math.sin(i * 0.6) * 0.08 + i * 0.006, 0.02, -1.0 + ((i + 1) * 0.65) / 20, 1.2 + Math.sin((i + 1) * 0.6) * 0.08 + (i + 1) * 0.006, 0.02);
    for (let i = 0; i < 3; i++) {
      const y = 2.08 - i * 0.07;
      for (let j = 0; j < 9; j++) {
        const x = -1.05 + j * 0.05;
        b.seg(x, y, 0.02, x + 0.03 + rand() * 0.015, y + (j % 2 ? 0.02 : -0.01), 0.02);
      }
    }
    for (let i = 0; i < 3; i++) {
      b.box(0.78 + (i % 2) * 0.12, 2.0 - i * 0.12, 0.02, 0.1, 0.1, 0.002);
      b.circ(0.83 + (i % 2) * 0.12, 2.12 - i * 0.12, 0.025, 0.012, 5, 'x');
    }
    b.seg(0.45, 2.28 - 0.02, 0.02, 0.75, 2.28 - 0.02, 0.02);
    // The robotic arm's work stand, in reach of the gripper.
    const jig = new Pen(prop).at(2.55, 0, -2.75, 0.4);
    jig.box(-0.35, 0.8, -0.3, 0.7, 0.05, 0.6).box(-0.12, 0.85, -0.1, 0.24, 0.1, 0.2);
    for (const [x, z] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) jig.seg(x, 0, z, x, 0.8, z);
    jig.seg(-0.3, 0.3, -0.25, 0.3, 0.3, 0.25).seg(0.3, 0.3, -0.25, -0.3, 0.3, 0.25);
  }

  // ── Robotic arm: base is static, the links turn in update() ─────────────────────────────
  pp.at(ARM_X, 0, ARM_Z).cyl(0, 0, 0, 0.3, 0.45, 16).box(-0.42, 0, -0.42, 0.84, 0.03, 0.84);
  for (const [x, z] of [[-0.36, -0.36], [0.36, -0.36], [0.36, 0.36], [-0.36, 0.36]]) pp.circ(x, 0.03, z, 0.03, 6);
  pp.circ(0, 0.45, 0, 0.22, 16).circ(0, 0.49, 0, 0.22, 16);
  const armMat = thin(0.8, ICE);
  const arm = new Group();
  arm.position.set(ARM_X, 0.49, ARM_Z);
  root.add(arm);
  const link = (len: number, w0: number, w1: number) => {
    const L = new Lines();
    for (const [y, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) L.seg(0, y * w0, z * w0, len, y * w1, z * w1);
    for (const x of [0.02, len]) {
      const w = x < 0.1 ? w0 : w1;
      L.seg(x, -w, -w, x, w, -w).seg(x, w, -w, x, w, w).seg(x, w, w, x, -w, w).seg(x, -w, w, x, -w, -w);
    }
    return L;
  };
  const joint = (L: Lines, x: number, r: number) => {
    for (const z of [-0.09, 0.09]) L.circle(x, 0, z, r, 14, true);
    L.seg(x, 0, -0.09, x, 0, 0.09);
  };
  arm.add(new LineSegments(new Lines().circle(0, 0.03, 0, 0.18, 14).seg(0, 0, 0, 0, 0.3, 0).geometry(), armMat)); // turntable (turns with yaw)
  const shoulder = new Group();
  shoulder.position.y = 0.45;
  arm.add(shoulder);
  const upperL = link(0.9, 0.075, 0.055);
  joint(upperL, 0, 0.12);
  shoulder.add(new LineSegments(upperL.geometry(), armMat));
  const elbow = new Group();
  elbow.position.x = 0.9;
  shoulder.add(elbow);
  const foreL = link(0.8, 0.055, 0.04);
  joint(foreL, 0, 0.09);
  elbow.add(new LineSegments(foreL.geometry(), armMat));
  const wrist = new Group();
  wrist.position.x = 0.8;
  elbow.add(wrist);
  const wristL = new Lines().box(0, -0.05, -0.05, 0.12, 0.1, 0.1).circle(0.12, 0, 0, 0.06, 10, true).box(0.12, -0.04, -0.04, 0.08, 0.08, 0.08);
  wristL.box(0.22, -0.045, -0.095, 0.1, 0.09, 0.02).box(0.22, -0.045, 0.075, 0.1, 0.09, 0.02);
  wrist.add(new LineSegments(wristL.geometry(), armMat));
  const held = new LineSegments(new Lines().box(0.25, -0.04, -0.04, 0.08, 0.08, 0.08).geometry(), thin(0.9, ICE));
  wrist.add(held);
  const elbowLabel = new Object3D();
  elbow.add(elbowLabel);
  // Arm control panel on a stand.
  pp.at(4.7, 0, -2.4, -0.9).box(-0.3, 1.0, -0.04, 0.6, 0.4, 0.08).seg(0, 0, 0, 0, 1.0, 0).seg(-0.2, 0, 0, 0.2, 0, 0).seg(0, 0.4, 0, -0.2, 0, 0).seg(0, 0.4, 0, 0.2, 0, 0).circ(0, 0.02, 0, 0.04, 6);

  // ── Monitors (rewritten every frame) ───────────────────────────────────────────────────
  const mon = (p: Pen, x: number, y: number, z: number, w: number, h: number) => {
    mons.push({ ox: p.X(x, z), oy: p.oy + y, oz: p.Z(x, z), ux: p.c, uz: -p.s, w, h });
  };
  mon(pp.at(0, 0, 0), -3.55, 0.97, -6.665, 0.3, 0.22); // laptop
  mon(pp.at(0, 0, 0), -1.93, 1.0, -6.475, 0.27, 0.16); // oscilloscope
  mon(pp.at(4.7, 0, -2.4, -0.9), -0.26, 1.03, 0.045, 0.52, 0.34); // arm panel
  mon(pp.at(0, 0, 0), 4.35, 1.0, -6.6, 0.4, 0.28); // right bench monitor
  pp.at(0, 0, 0).box(4.3, 0.98, -6.64, 0.5, 0.35, 0.05).seg(4.55, 0.92, -6.62, 4.55, 0.98, -6.62);
  const screenBuf = new Float32Array(mons.length * SEGS * 6);
  const screenAttr = new BufferAttribute(screenBuf, 3);
  const screens = new LineSegments(new Lines().geometry(), lineMaterial(fade, ICE, 0.9));
  screens.geometry.setAttribute('position', screenAttr);
  screens.frustumCulled = false;
  root.add(screens);
  let cur = 0;
  const put = (m: Mon, u0: number, v0: number, u1: number, v1: number) => {
    screenBuf[cur++] = m.ox + m.ux * u0;
    screenBuf[cur++] = m.oy + v0;
    screenBuf[cur++] = m.oz + m.uz * u0;
    screenBuf[cur++] = m.ox + m.ux * u1;
    screenBuf[cur++] = m.oy + v1;
    screenBuf[cur++] = m.oz + m.uz * u1;
  };
  const noise = (n: number) => {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  const drawScreens = (t: number) => {
    cur = 0;
    for (let mi = 0; mi < mons.length; mi++) {
      const m = mons[mi];
      for (let i = 0; i < 6; i++) {
        const u = m.w * (0.06 + i * 0.065);
        const h = (0.25 + 0.7 * (0.5 + 0.5 * Math.sin(t * (0.8 + i * 0.31) + mi * 1.7 + i))) * m.h * 0.6;
        put(m, u, m.h * 0.12, u, m.h * 0.12 + h);
      }
      let pv = 0.75;
      for (let i = 0; i < 12; i++) {
        const u0 = m.w * (0.5 + (i / 12) * 0.45);
        const u1 = m.w * (0.5 + ((i + 1) / 12) * 0.45);
        const nv = 0.62 + 0.2 * Math.sin(t * 1.9 + (i + 1) * 0.8 + mi) * Math.sin(t * 0.5 + i * 0.3);
        put(m, u0, m.h * pv, u1, m.h * nv);
        pv = nv;
      }
      for (let r = 0; r < 3; r++) {
        const len = 0.12 + 0.28 * noise(Math.floor(t * 1.5 + r * 3) + mi * 7 + r);
        put(m, m.w * 0.5, m.h * (0.12 + r * 0.1), m.w * (0.5 + len), m.h * (0.12 + r * 0.1));
      }
    }
    screenAttr.needsUpdate = true;
  };
  drawScreens(0);

  // ── Lamps: a big pendant over the table, bare bulbs over the benches ───────────────────
  const lamp = new Group();
  lamp.position.set(-2.4, H, -3.6); // over a bench, not over the cube
  root.add(lamp);
  const lampL = new Lines();
  for (let y = 0; y > -0.7; y -= 0.1) lampL.circle(0, y, 0, 0.012, 5, true).seg(0, y - 0.05, 0, 0, y - 0.1, 0);
  lampL.circle(0, -0.04, 0, 0.1, 10);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    lampL.seg(Math.cos(a) * 0.14, -0.78, Math.sin(a) * 0.14, Math.cos(a) * 0.52, -1.1, Math.sin(a) * 0.52);
  }
  for (const [y, r] of [[-0.78, 0.14], [-0.88, 0.25], [-0.98, 0.38], [-1.1, 0.52], [-1.13, 0.5]]) lampL.circle(0, y, 0, r, 24);
  lampL.circle(0, -1.0, 0, 0.07, 10, true).circle(0, -1.0, 0, 0.07, 10).seg(0, -0.7, 0, 0, -0.78, 0);
  lamp.add(new LineSegments(lampL.geometry(), thin(0.5, ICE)));
  const bulbs: number[] = [0, H - 1.05, 0];
  const hang = new Lines();
  const hp = new Pen(hang);
  for (const [x, z] of [[-3.3, -5.4], [3.3, -5.4], [3.5, -3.6], [-2.8, 3.2]]) {
    hp.at(0, 0, 0).seg(x, H, z, x, 2.78, z).cyl(x, 2.62, z, 0.04, 0.12, 8).circ(x, 2.55, z, 0.07, 10, 'x').circ(x, 2.55, z, 0.07, 10);
    bulbs.push(x, 2.55, z);
  }
  lit(hang, 0.45, ICE);

  // ── Outside: a night skyline beyond the windows (never sampled, never fogged away) ─────
  const plain = (o: number, tint = CYAN) => {
    const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    m.colorNode = color(tint);
    m.opacityNode = float(o).mul(fade);
    return m;
  };
  const sky = new Lines();
  const lights: number[] = [];
  // No occlusion in a wireframe world, so the city lives only inside each window's cone of view
  // (seen from the room's centre): towers behind the glass, never a cage around the walls.
  const EYE = 2.4;
  const wallDist: Record<Wall, number> = { back: -ZB, front: ZF, left: W, right: W };
  for (const w of WALLS) {
    for (const o of OPENINGS[w]) {
      if (o.door) continue;
      const D = wallDist[w];
      const n = Math.round(4 + k * 4);
      for (let i = 0; i < n; i++) {
        const s = (D + 7 + rand() * 38) / D; // how far behind the glass, as a scale from the centre
        const span = (o.u1 - o.u0) * s;
        const bw = span * (0.14 + rand() * 0.2);
        const uc = o.u0 * s + bw / 2 + rand() * (span - bw);
        const vTop = o.v0 + (o.v1 - o.v0) * (0.12 + rand() * 0.8);
        const yTop = EYE + (vTop - EYE) * s;
        const yLow = EYE + (o.v0 - 0.05 - EYE) * s;
        const dist = D * s;
        const P = (u: number, y: number): [number, number, number] => (w === 'back' ? [u, y, -dist] : w === 'front' ? [u, y, dist] : w === 'left' ? [-dist, y, u] : [dist, y, u]);
        const a = uc - bw / 2;
        const b = uc + bw / 2;
        sky.seg(...P(a, yLow), ...P(a, yTop)).seg(...P(b, yLow), ...P(b, yTop)).seg(...P(a, yTop), ...P(b, yTop));
        for (let y = yTop - 0.09 * s; y > yLow; y -= 0.14 * s) sky.seg(...P(a, y), ...P(b, y));
        if (rand() < 0.3) sky.seg(...P(uc, yTop), ...P(uc, yTop + 0.1 * s + rand() * 0.15 * s));
        const cols = Math.max(2, Math.round(bw / (0.12 * s)));
        for (let y = yTop - 0.07 * s; y > yLow; y -= 0.14 * s) {
          for (let c = 0; c < cols; c++) {
            if (rand() > 0.38) continue;
            const p = P(a + (c + 0.5) * (bw / cols), y);
            lights.push(p[0], p[1], p[2]);
          }
        }
      }
    }
  }
  const skyline = new LineSegments(sky.geometry(), plain(0.32));
  skyline.userData.noSample = true;
  root.add(skyline);

  // ── Light sprites: city windows, bulb glows, drifting dust ─────────────────────────────
  const attr3 = (a: Float32Array) => instancedBufferAttribute(new InstancedBufferAttribute(a, 3), 'vec3');
  const soft = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
  const sprite = (pos: number[] | Float32Array, build: (p: any) => Partial<PointsNodeMaterial>) => {
    const arr = pos instanceof Float32Array ? pos : new Float32Array(pos);
    const m = Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), build(attr3(arr)));
    const s = new Sprite(m);
    s.count = arr.length / 3;
    s.frustumCulled = false;
    root.add(s);
    return s;
  };
  sprite(lights, (p) => ({
    positionNode: p,
    sizeNode: float(1.8).add(hash(instanceIndex).mul(1.6)),
    colorNode: color(ICE),
    opacityNode: soft.mul(sin(time.mul(0.4).add(hash(instanceIndex.add(3)).mul(60))).mul(0.15).add(0.55)).mul(fade),
  })).userData.noSample = true;
  sprite(bulbs.slice(0, 3), (p) => ({ positionNode: p, sizeNode: float(150), colorNode: color(ICE), opacityNode: soft.mul(0.3).mul(fade) })).userData.noSample = true;
  sprite(bulbs.slice(3), (p) => ({ positionNode: p, sizeNode: float(46), colorNode: color(ICE), opacityNode: soft.mul(0.34).mul(fade) })).userData.noSample = true;
  const nMotes = Math.round(80 * k);
  const motes = new Float32Array(nMotes * 3);
  for (let i = 0; i < nMotes; i++) motes.set([(rand() - 0.5) * 8, rand() * H, (rand() - 0.5) * 8], i * 3);
  sprite(motes, (p) => ({
    positionNode: p.add(sin(time.mul(0.25).add(p.z.mul(3))).mul(0.1)),
    sizeNode: float(1.3).add(hash(instanceIndex).mul(1.2)),
    colorNode: color(ICE),
    opacityNode: soft.mul(0.4).mul(fade),
  })).userData.noSample = true;

  // ── Assemble the room ──────────────────────────────────────────────────────────────────
  root.add(strokes(frame.positions(), fade, ICE, 0.95, 2.1));
  // The room stays in the background: the cube on the table is the hero.
  lit(shell, 0.3, ICE);
  lit(fine, 0.07, CYAN);
  lit(prop, 0.36, ICE);

  // ── The hero: projection table ─────────────────────────────────────────────────────────
  const rim = new Lines();
  rim.circle(0, 0, 0, 1.0, 96).circle(0, 0.06, 0, 0.95, 96).circle(0, 0.78, 0, TR, 128).circle(0, TOP, 0, TR, 128).circle(0, TOP, 0, 1.35, 128);
  root.add(strokes(rim.positions(), fade, ICE, 0.8, 2.2));
  const body = new Lines();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (i % 2 === 0) body.seg(c * 0.95, 0.06, s * 0.95, c * 0.48, 0.2, s * 0.48).seg(c * 0.48, 0.2, s * 0.48, c * 0.48, 0.5, s * 0.48);
    body.seg(c * 0.48, 0.5, s * 0.48, c * TR, 0.78, s * TR).seg(c * TR, 0.78, s * TR, c * TR, TOP, s * TR);
  }
  for (const [y, r] of [[0.2, 0.48], [0.3, 0.48], [0.4, 0.48], [0.5, 0.48], [0.58, 0.8], [0.66, 1.1], [0.72, 1.3], [0.85, TR]]) body.circle(0, y, 0, r, 96);
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU;
    const r1 = i % 10 === 0 ? 1.22 : 1.3;
    body.seg(Math.cos(a) * r1, TOP + 0.005, Math.sin(a) * r1, Math.cos(a) * 1.345, TOP + 0.005, Math.sin(a) * 1.345);
  }
  lit(body, 0.32);
  const top = new Mesh(new CircleGeometry(TR, 96).rotateX(-Math.PI / 2).translate(0, TOP, 0), fillMaterial(fade, CYAN, 0.07));
  top.userData.noSample = true;
  root.add(top);

  // Emitter: segmented arcs on three rings turning at different speeds and directions.
  const rings: Group[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    const arcs = new Lines();
    for (let r = 0.2 + i * 0.07; r < 1.15; r += 0.21) {
      const n = 3 + ((r * 10) | 0) % 4;
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * TAU + rand();
        arcs.circle(0, TOP + 0.01 + i * 0.004, 0, r, 20, false, a0, a0 + TAU / n - 0.25 - rand() * 0.5);
      }
    }
    g.add(new LineSegments(arcs.geometry(), thin(0.45 - i * 0.1)));
    root.add(g);
    rings.push(g);
  }
  const scanner = new Group();
  scanner.add(new LineSegments(new Lines().seg(0, TOP + 0.02, 0, 1.33, TOP + 0.02, 0).seg(1.15, TOP + 0.02, -0.05, 1.15, TOP + 0.02, 0.05).geometry(), thin(0.8, ICE)));
  root.add(scanner);

  const halo = new Group();
  const haloLines = new Lines();
  for (let j = 0; j < 7; j++) {
    const a0 = (j / 7) * TAU;
    haloLines.circle(0, 1.2, 0, 1.0, 24, false, a0, a0 + 0.6 + rand() * 0.25);
    haloLines.seg(Math.cos(a0) * 1.0, 1.2, Math.sin(a0) * 1.0, Math.cos(a0) * 1.1, 1.2, Math.sin(a0) * 1.1);
  }
  halo.add(new LineSegments(haloLines.geometry(), thin(0.35, ICE)));
  root.add(halo);
  const beam = new Lines();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    beam.seg(Math.cos(a) * 0.64, TOP + 0.02, Math.sin(a) * 0.64, Math.cos(a) * 0.45, CUBE_Y - CUBE - 0.02, Math.sin(a) * 0.45);
  }
  lit(beam, 0.1, ICE);
  const cone = new Mesh(new CylinderGeometry(0.43, 0.66, 0.55, 48, 1, true).translate(0, TOP + 0.3, 0), fillMaterial(fade, ICE, 0.26));
  cone.userData.noSample = true;
  root.add(cone);

  // ── The cube ───────────────────────────────────────────────────────────────────────────
  const cube = new Group();
  cube.position.y = CUBE_Y;
  root.add(cube);
  cube.add(strokes(new Lines().box(-CUBE, -CUBE, -CUBE, CUBE * 2, CUBE * 2, CUBE * 2).positions(), fade, ICE, 1, 2.6));
  const brackets = new Lines();
  const B = CUBE + 0.06;
  const BL = 0.12;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * B;
    const y = sy * B;
    const z = sz * B;
    brackets.seg(x, y, z, x - sx * BL, y, z).seg(x, y, z, x, y - sy * BL, z).seg(x, y, z, x, y, z - sz * BL);
  }
  cube.add(strokes(brackets.positions(), fade, CYAN, 0.8, 1.6));

  // Circuit traces etched on every face but the back (Manhattan paths with pads).
  const circuit = new Lines();
  const facePoint = (face: number, u: number, v: number): [number, number, number] => {
    const s = face % 2 ? CUBE : -CUBE;
    const a = u * CUBE;
    const b = v * CUBE;
    return face < 2 ? [a, b, s] : face < 4 ? [s, a, b] : [a, s, b];
  };
  const traces = Math.round(8 + k * 12);
  for (let face = 1; face < FACES; face++) {
    for (let n = 0; n < traces; n++) {
      let u = rand() * 1.8 - 0.9;
      let v = rand() * 1.8 - 0.9;
      for (let step = 0; step < 4; step++) {
        const horizontal = (n + step) % 2 === 0;
        const nu = horizontal ? Math.max(-0.92, Math.min(0.92, u + (rand() - 0.5) * 0.9)) : u;
        const nv = horizontal ? v : Math.max(-0.92, Math.min(0.92, v + (rand() - 0.5) * 0.9));
        circuit.seg(...facePoint(face, u, v), ...facePoint(face, nu, nv));
        u = nu;
        v = nv;
      }
      const p = 0.03;
      circuit.seg(...facePoint(face, u - p, v - p), ...facePoint(face, u + p, v - p)).seg(...facePoint(face, u + p, v - p), ...facePoint(face, u + p, v + p));
      circuit.seg(...facePoint(face, u + p, v + p), ...facePoint(face, u - p, v + p)).seg(...facePoint(face, u - p, v + p), ...facePoint(face, u - p, v - p));
    }
  }
  cube.add(new LineSegments(circuit.geometry(), thin(0.32)));
  const fill = new Mesh(new BoxGeometry(CUBE * 2, CUBE * 2, CUBE * 2), fillMaterial(fade, CYAN, 0.28));
  fill.userData.noSample = true;
  cube.add(fill);

  const gyro = [0, 1, 2].map((i) => {
    const g = new Group();
    g.add(new LineSegments(new Lines().circle(0, 0, 0, 0.37 - i * 0.055, 64, true).geometry(), thin(0.55, ICE)));
    cube.add(g);
    return g;
  });
  const inner = new Group();
  cube.add(inner);
  inner.add(new LineSegments(new Lines().box(-0.23, -0.23, -0.23, 0.46, 0.46, 0.46).box(-0.1, -0.1, -0.1, 0.2, 0.2, 0.2).geometry(), thin(0.75, ICE)));

  // The crack on the back face: the clue (and the way in). Light leaks out sideways.
  const slit = new Group();
  slit.position.set(0, 0, -CUBE - 0.004);
  cube.add(slit);
  const crack = new Lines();
  const zig = [-0.42, -0.25, -0.1, 0.06, 0.2, 0.36, 0.46].map((y) => y * 0.77);
  for (let i = 0; i + 1 < zig.length; i++) {
    const x0 = (i % 2 ? 0.05 : -0.04) * (1 + i * 0.1) * 0.77;
    const x1 = ((i + 1) % 2 ? 0.05 : -0.04) * (1 + i * 0.1) * 0.77;
    crack.seg(x0, zig[i], 0, x1, zig[i + 1], 0);
    crack.seg(x0, zig[i], 0, x0 + (i % 2 ? 0.11 : -0.11), zig[i] + 0.05, 0);
  }
  crack.rect(-0.07, 0, -0.001, 0.07, 0.001);
  for (let i = 0; i < 12; i++) {
    const y = (-0.4 + i * 0.075) * 0.77;
    const len = (0.25 + ((i * 37) % 7) * 0.07) * 0.77;
    crack.seg(0, y, 0, ((i % 3) * 0.05 - 0.05) * 0.77, y * 1.2, -len);
  }
  slit.add(new LineSegments(crack.geometry(), targetMaterial(fade, glow)));
  // Light spilling past the back edges: rays fanning out left and right, visible from the front.
  const leak = new Lines();
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const y = -CUBE * 0.85 + (i / 8) * CUBE * 1.7;
      leak.seg(sx * CUBE, y, -CUBE + 0.02, sx * (CUBE + 0.5 + (i % 3) * 0.18), y * 1.25, -CUBE - 0.35 - (i % 2) * 0.2);
    }
    leak.seg(sx * CUBE, -CUBE, -CUBE, sx * CUBE, CUBE, -CUBE);
  }
  cube.add(new LineSegments(leak.geometry(), thin(0.6, AMBER)));

  const anchor = (parent: Object3D, x: number, y: number, z: number) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const labels: NonNullable<Layer['labels']> = [
    { object: anchor(cube, CUBE, CUBE, CUBE), pt: 'ARTEFATO 0x01 · ORIGEM DESCONHECIDA', en: 'ARTIFACT 0x01 · UNKNOWN ORIGIN' },
    { object: anchor(slit, -0.3, -0.1, 0), pt: 'ANOMALIA · FACE OCULTA', en: 'ANOMALY · HIDDEN FACE' },
    { object: anchor(root, -3.5, 2.4, -3.1), pt: 'QUADRO · ESBOÇOS DO ARTEFATO', en: 'WHITEBOARD · ARTIFACT SKETCHES' },
    { object: elbowLabel, pt: 'BRAÇO ROBÓTICO · BR-7', en: 'ROBOTIC ARM · BR-7' },
    { object: anchor(root, TR, TOP, 0.4), pt: 'PROJETOR · CAMPO ESTÁVEL', en: 'PROJECTOR · FIELD STABLE' },
  ];

  root.add(horizon(fade, 8, -10));
  return {
    id: 'table',
    root,
    fade,
    glow,
    labels,
    exposure: 0.8,
    caption: { pt: 'A oficina. Um artefato estranho flutua sobre a mesa.', en: 'The workshop. A strange artifact floats above the table.' },
    radius: 8,
    view: { distance: 5, minDistance: 1.7, maxDistance: 5.4, pitch: 0.15, height: 1.55 },
    target: { object: slit, radius: 0.36, facing: new Vector3(0, 0, -1) },
    update(t) {
      cube.position.y = CUBE_Y + Math.sin(t * 0.9) * 0.05;
      // Rocks but never turns its back on its own: the crack has to be found.
      cube.rotation.y = Math.sin(t * 0.25) * 0.55;
      cube.rotation.x = Math.sin(t * 0.31) * 0.08;
      inner.rotation.set(t * 0.3, t * 0.45, 0);
      gyro[0].rotation.set(t * 0.7, 0, 0);
      gyro[1].rotation.set(0, t * 0.9, Math.PI / 2);
      gyro[2].rotation.set(Math.PI / 2, t * -0.6, 0);
      rings[0].rotation.y = t * 0.12;
      rings[1].rotation.y = -t * 0.2;
      rings[2].rotation.y = t * 0.31;
      scanner.rotation.y = -t * 0.8;
      halo.rotation.y = t * 0.1;
      halo.position.y = Math.sin(t * 0.6) * 0.03;
      lamp.rotation.set(Math.sin(t * 0.5) * 0.012, 0, Math.sin(t * 0.37 + 1) * 0.012);
      // The arm sweeps over its work stand, bobbing at the elbow, the fingers closing now and then.
      arm.rotation.y = -2.34 + Math.sin(t * 0.35) * 0.4;
      shoulder.rotation.z = 0.95 + Math.sin(t * 0.5) * 0.14;
      elbow.rotation.z = -1.55 + Math.sin(t * 0.7 + 1) * 0.22;
      wrist.rotation.z = -0.9 + Math.sin(t * 0.9) * 0.15;
      wrist.rotation.x = Math.sin(t * 0.6) * 0.5;
      drawScreens(t);
    },
  };
}
