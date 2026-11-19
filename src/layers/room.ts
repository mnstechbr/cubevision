import {
  AdditiveBlending,
  BufferAttribute,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  Object3D,
  PointsNodeMaterial,
  Sprite,
} from 'three/webgpu';
import { color, float, fract, hash, instanceIndex, instancedBufferAttribute, length, sin, smoothstep, step, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, fillMaterial, horizon, lineMaterial, strokes, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const TAU = Math.PI * 2;
// The executive floor: x in [-XL, XL], z in [ZB, ZF], ceiling at H. The camera arrives in the lobby (+z).
const XL = 14.5;
const ZB = -10;
const ZF = 10.5;
const H = 4;
const LOBBY = 3; // marble from here to the lobby wall
// Glass-walled rooms (x0, z0, x1, z1).
const MEET = { x0: 1.8, z0: -3, x1: 8, z1: 1.6 };
const LAB = { x0: 5.6, z0: ZB, x1: XL, z1: -5.6 };
const SERVER = { x0: 10.2, z0: 4.4, x1: XL, z1: 9.8 };
// The target: a projection table with a machine in holographic gears, in the lab.
const TX = 8.9;
const TZ = -7.9;
const HOLO_Y = 1.7;

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

// Block letters for the lobby sign: polylines in a unit box.
const GLYPH: Record<string, number[][][]> = {
  M: [[[0, 0], [0, 1], [0.5, 0.45], [1, 1], [1, 0]]],
  N: [[[0, 0], [0, 1], [1, 0], [1, 1]]],
  S: [[[1, 0.88], [0.7, 1], [0.2, 1], [0, 0.8], [0.15, 0.58], [0.85, 0.42], [1, 0.2], [0.8, 0], [0.3, 0], [0, 0.12]]],
  T: [[[0, 1], [1, 1]], [[0.5, 1], [0.5, 0]]],
  E: [[[1, 1], [0, 1], [0, 0], [1, 0]], [[0, 0.5], [0.8, 0.5]]],
  C: [[[1, 0.85], [0.7, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0], [0.7, 0], [1, 0.15]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]],
};

type Wall = 'back' | 'front' | 'left' | 'right';
interface Op {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  glass?: boolean;
}
const SPAN: Record<Wall, [number, number]> = { back: [-XL, XL], front: [-XL, XL], left: [ZB, ZF], right: [ZB, ZF] };
const ELEV = [-8.2, -5.8, -3.4];
const OPENINGS: Record<Wall, Op[]> = {
  back: [{ u0: -XL, u1: XL, v0: 0.1, v1: H - 0.1, glass: true }],
  left: [{ u0: ZB, u1: ZF, v0: 0.1, v1: H - 0.1, glass: true }],
  front: ELEV.map((c) => ({ u0: c - 0.65, u1: c + 0.65, v0: 0, v1: 2.5 })),
  right: [{ u0: -3.9, u1: -2.7, v0: 0, v1: 2.3 }],
};
const NRM: Record<Wall, [number, number]> = { back: [0, 1], front: [0, -1], left: [1, 0], right: [-1, 0] };

/** Point on a wall: `u` runs along it (world x or z), `v` is height, `off` pushes into the room. */
const wpt = (w: Wall, u: number, v: number, off = 0): [number, number, number] => {
  const [nx, nz] = NRM[w];
  const b: [number, number, number] = w === 'back' ? [u, v, ZB] : w === 'front' ? [u, v, ZF] : w === 'left' ? [-XL, v, u] : [XL, v, u];
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

// Each screen shows 6 bars, a 12-segment graph and 3 text rows (all rewritten in place every frame).
const SEGS = 6 + 12 + 3;
interface Mon {
  ox: number;
  oy: number;
  oz: number;
  ux: number;
  uz: number;
  w: number;
  h: number;
}

/** [3] Inside the building: an executive floor with a glass lab at the back, and a machine in its hologram. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(42);
  const k = ctx.detail;
  const thin = (o: number, tint = ICE) => lineMaterial(fade, tint, o);
  const lit = (l: Lines, o: number, tint = ICE) => root.add(new LineSegments(l.geometry(), thin(o, tint)));

  const frame = new Lines(); // thick structure
  const shell = new Lines(); // walls, mullions, ceiling
  const grid = new Lines(); // faint dense floor/ceiling tiles
  const prop = new Lines(); // furniture
  const people = new Lines();
  const lights = new Lines(); // ceiling panels
  const amber = new Lines(); // light leaking out of the lab
  const gl = new Lines(); // glass partitions (lighter than the structure)
  const pp = new Pen(prop);
  const pf = new Pen(frame);
  const mons: Mon[] = [];
  const leds: number[] = [];

  // ── Shell ───────────────────────────────────────────────────────────────────────────────
  frame.rect(-XL, 0, ZB, XL, ZF).rect(-XL, H, ZB, XL, ZF);
  for (const [x, z] of [[-XL, ZB], [XL, ZB], [XL, ZF], [-XL, ZF]]) frame.seg(x, 0, z, x, H, z);

  // Glass curtain walls (back and left): mullions, rails, a transom and glints.
  for (const w of ['back', 'left'] as Wall[]) {
    const [a0, a1] = SPAN[w];
    for (let u = a0; u <= a1 + 0.01; u += 1.45) wl(frame, w, u, 0.1, u, H - 0.1);
    for (const v of [0.1, H - 0.1]) wl(frame, w, a0, v, a1, v);
    wl(shell, w, a0, 2.5, a1, 2.5, 0.01);
    wl(shell, w, a0, 0.35, a1, 0.35, 0.01);
    for (let u = a0 + 0.2; u < a1 - 1.2; u += 1.45) {
      wl(grid, w, u, 0.5, u + 0.7, 2.4, 0.01);
      wl(grid, w, u + 0.1, 0.5, u + 0.8, 2.4, 0.01);
    }
  }
  // Solid walls (lobby wall with the elevators, the right wall): panel grooves, cornice.
  for (const w of ['front', 'right'] as Wall[]) {
    const [a0, a1] = SPAN[w];
    const ops = OPENINGS[w];
    for (const v of [0.12, 1.0, 2.6, H - 0.15]) {
      const blocks = ops.filter((o) => v > o.v0 - 0.02 && v < o.v1 + 0.02).map((o) => [o.u0 - 0.1, o.u1 + 0.1] as [number, number]);
      for (const [x, y] of free(a0, a1, blocks)) wl(grid, w, x, v, y, v, 0.01);
    }
    for (let u = a0 + 1.2; u < a1; u += 1.2) {
      const blocks = ops.filter((o) => u > o.u0 - 0.1 && u < o.u1 + 0.1).map((o) => [o.v0, o.v1 + 0.1] as [number, number]);
      for (const [x, y] of free(0.12, H - 0.15, blocks)) wl(grid, w, u, x, u, y, 0.01);
    }
  }
  // Elevators: frames, doors, floor indicators and call buttons.
  for (const c of ELEV) {
    wr(frame, 'front', c - 0.75, 0, c + 0.75, 2.62, 0.02);
    wr(frame, 'front', c - 0.65, 0, c + 0.65, 2.5);
    wr(shell, 'front', c - 0.6, 0.05, c - 0.02, 2.45, 0.03);
    wr(shell, 'front', c + 0.02, 0.05, c + 0.6, 2.45, 0.03);
    wr(shell, 'front', c - 0.3, 2.78, c + 0.3, 2.98, 0.02);
    const [lx, ly, lz] = wpt('front', c, 2.88, 0.04);
    leds.push(lx, ly, lz);
    wl(grid, 'front', c - 0.5, 1.2, c - 0.5, 1.5, 0.04);
    const [bx, by, bz] = wpt('front', c + 1.2, 1.15, 0.04);
    leds.push(bx, by, bz, bx, by + 0.12, bz);
  }
  wl(shell, 'front', ELEV[0] - 0.9, 3.15, ELEV[2] + 0.9, 3.15, 0.02);
  // Stairwell door in the right wall, with an exit sign.
  wr(frame, 'right', -3.9, 0, -2.7, 2.3);
  wr(shell, 'right', -3.8, 0.1, -2.8, 2.2, 0.03);
  wr(shell, 'right', -3.55, 1.25, -3.05, 1.95, 0.04);
  wl(shell, 'right', -3.75, 1.0, -3.2, 1.0, 0.05);
  wr(shell, 'right', -3.6, 2.45, -3.0, 2.65, 0.03);
  {
    const [x, y, z] = wpt('right', -3.3, 2.55, 0.05);
    leds.push(x, y, z);
  }

  // Columns (bold), and the floor: carpet in the office, marble in the lobby, a runner down the aisle.
  for (const x of [-12.5, -6.5]) for (const z of [-8.8, 2.3]) pf.at(x, 0, z).box(-0.25, 0, -0.25, 0.5, H, 0.5);
  for (let z = ZB; z <= LOBBY + 0.01; z += 0.6) grid.seg(-XL, 0, z, XL, 0, z);
  for (let x = -XL; x <= XL + 0.01; x += 0.6) grid.seg(x, 0, ZB, x, 0, LOBBY);
  for (let z = LOBBY; z <= ZF + 0.01; z += 1.2) shell.seg(-XL, 0, z, XL, 0, z);
  for (let x = -XL; x <= XL + 0.01; x += 1.2) shell.seg(x, 0, LOBBY, x, 0, ZF);
  shell.rect(-XL + 0.6, 0, LOBBY + 0.6, XL - 0.6, ZF - 0.6);
  shell.circle(0, 0.005, 7.2, 2.2, 48).circle(0, 0.005, 7.2, 1.7, 48);
  for (let i = 0; i < 16; i++) shell.seg(Math.cos((i / 16) * TAU) * 1.7, 0.005, 7.2 + Math.sin((i / 16) * TAU) * 1.7, Math.cos((i / 16) * TAU) * 2.2, 0.005, 7.2 + Math.sin((i / 16) * TAU) * 2.2);
  shell.seg(-1.0, 0.005, ZB + 0.3, -1.0, 0.005, LOBBY).seg(1.6, 0.005, ZB + 0.3, 1.6, 0.005, LOBBY);
  for (let z = ZB + 0.3; z < LOBBY; z += 0.5) shell.seg(-1.0, 0.005, z, 1.6, 0.005, z);

  // Ceiling: tile grid, light panels, air diffusers.
  for (let z = ZB; z <= ZF + 0.01; z += 0.6) grid.seg(-XL, H, z, XL, H, z);
  for (let x = -XL; x <= XL + 0.01; x += 0.6) grid.seg(x, H, ZB, x, H, ZF);
  for (let x = -13.2; x < XL - 0.5; x += 2.4) {
    for (let z = ZB + 0.9; z < ZF - 0.4; z += 1.8) {
      lights.rect(x - 0.6, H - 0.02, z - 0.3, x + 0.6, z + 0.3);
      lights.seg(x - 0.6, H - 0.02, z, x + 0.6, H - 0.02, z);
    }
  }
  for (let x = -12; x < XL; x += 4.8) for (const z of [ZB + 0.3, ZF - 0.3]) shell.rect(x - 0.2, H - 0.02, z - 0.2, x + 0.2, z + 0.2);

  // ── Glass rooms ─────────────────────────────────────────────────────────────────────────
  // A glass wall from (x0,z0) to (x1,z1): posts, rails, a frosted band; an optional door gap [t0,t1] (metres along it).
  const glass = (x0: number, z0: number, x1: number, z1: number, gap?: [number, number], hang?: [number, number]) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    const at = (t: number, y: number): [number, number, number] => [x0 + dx * t, y, z0 + dz * t];
    const n = Math.max(1, Math.round(len / 1.35));
    const top = 3.0;
    gl.seg(...at(0, top), ...at(len, top));
    const cuts = gap ? free(0, len, [gap]) : [[0, len] as [number, number]];
    for (const [a, b] of cuts) {
      gl.seg(...at(a, 0.04), ...at(b, 0.04));
      for (const y of [0.9, 1.5]) grid.seg(...at(a, y), ...at(b, y));
    }
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len;
      if (gap && t > gap[0] - 0.2 && t < gap[1] + 0.2) continue;
      gl.seg(...at(t, 0.04), ...at(t, top));
    }
    if (gap) {
      for (const t of gap) gl.seg(...at(t, 0.04), ...at(t, top));
      gl.seg(...at(gap[0], 2.3), ...at(gap[1], 2.3));
      // The door leaf stands ajar toward `hang` (the inward normal).
      const [nx, nz] = hang ?? [0, 0];
      const w = gap[1] - gap[0];
      const ex = x0 + dx * gap[0] + (dx * Math.cos(1.1) + nx * Math.sin(1.1)) * w;
      const ez = z0 + dz * gap[0] + (dz * Math.cos(1.1) + nz * Math.sin(1.1)) * w;
      const hx = x0 + dx * gap[0];
      const hz = z0 + dz * gap[0];
      prop.seg(hx, 0.04, hz, ex, 0.04, ez).seg(ex, 0.04, ez, ex, 2.25, ez).seg(ex, 2.25, ez, hx, 2.25, hz).seg(hx, 0.04, hz, hx, 2.25, hz);
      const a0 = Math.atan2(dz, dx);
      const a1 = Math.atan2(dz * Math.cos(1.1) + nz * Math.sin(1.1), dx * Math.cos(1.1) + nx * Math.sin(1.1));
      let pa = a0;
      for (let i = 1; i <= 8; i++) {
        let da = a1 - a0;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const a = a0 + (da * i) / 8;
        grid.seg(hx + Math.cos(pa) * w, 0.01, hz + Math.sin(pa) * w, hx + Math.cos(a) * w, 0.01, hz + Math.sin(a) * w);
        pa = a;
      }
    }
  };

  // Meeting room (open plan side, so it shows from the arrival view): glass on four sides, door toward the aisle.
  glass(MEET.x0, MEET.z1, MEET.x1, MEET.z1);
  glass(MEET.x1, MEET.z1, MEET.x1, MEET.z0);
  glass(MEET.x1, MEET.z0, MEET.x0, MEET.z0);
  glass(MEET.x0, MEET.z0, MEET.x0, MEET.z1, [1.2, 2.3], [1, 0]);
  // Lab: glass front (with a door) and glass left wall; the right wall and the back are the building's.
  glass(LAB.x0, LAB.z1, LAB.x1, LAB.z1, [2.0, 3.1], [0, 1]);
  glass(LAB.x0, LAB.z1, LAB.x0, LAB.z0);
  // Server room: glass front (door) and left wall.
  glass(SERVER.x0, SERVER.z0, SERVER.x1, SERVER.z0, [0.7, 1.8], [0, -1]);
  glass(SERVER.x0, SERVER.z0, SERVER.x0, SERVER.z1);

  // ── Furniture ───────────────────────────────────────────────────────────────────────────
  const chair = (x: number, z: number, ang: number) => {
    pp.at(x, 0, z, ang).circ(0, 0.46, 0, 0.23, 10).seg(0, 0.1, 0, 0, 0.46, 0);
    pp.path([[-0.2, 0.52, -0.24], [-0.2, 0.95, -0.27], [0.2, 0.95, -0.27], [0.2, 0.52, -0.24]], true);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      pp.seg(0, 0.1, 0, Math.cos(a) * 0.27, 0.06, Math.sin(a) * 0.27);
    }
    for (const sx of [-1, 1]) pp.seg(sx * 0.25, 0.64, -0.12, sx * 0.25, 0.64, 0.14);
  };
  const mon = (p: Pen, x: number, y: number, z: number, w: number, h: number) => {
    mons.push({ ox: p.X(x, z), oy: p.oy + y, oz: p.Z(x, z), ux: p.c, uz: -p.s, w, h });
  };

  // Open plan: two back-to-back benches of seven desks per side; the people face the camera or away from it.
  let desks = 0;
  for (const zc of [-6.2, -0.6]) {
    for (const face of [1, -1] as const) {
      const zp = zc - face * 1.15;
      const ang = face > 0 ? 0 : Math.PI;
      for (let i = 0; i < 7; i++) {
        const x = -12.5 + i * 1.7;
        for (const p of [pp, pf]) p.at(x, 0, zp, ang);
        pf.box(-0.8, 0.67, 0.28, 1.6, 0.03, 0.8).box(-0.3, 0.86, 0.82, 0.6, 0.34, 0.025);
        pp.seg(-0.76, 0, 0.32, -0.76, 0.67, 0.32).seg(0.76, 0, 0.32, 0.76, 0.67, 0.32).seg(-0.76, 0, 1.04, -0.76, 0.67, 1.04).seg(0.76, 0, 1.04, 0.76, 0.67, 1.04);
        pp.seg(-0.76, 0.32, 1.04, 0.76, 0.32, 1.04).seg(-0.76, 0.62, 1.04, 0.76, 0.62, 1.04);
        const sd = i % 2 ? 1 : -1;
        pp.box(sd * 0.42 - 0.2, 0.1, 0.4, 0.4, 0.57, 0.55).seg(sd * 0.42 - 0.2, 0.3, 0.95, sd * 0.42 + 0.2, 0.3, 0.95).seg(sd * 0.42 - 0.2, 0.48, 0.95, sd * 0.42 + 0.2, 0.48, 0.95);
        pp.seg(0, 0.7, 0.86, 0, 0.86, 0.86).box(-0.12, 0.7, 0.78, 0.24, 0.01, 0.16);
        pp.box(-0.2, 0.7, 0.5, 0.4, 0.012, 0.13).box(0.3, 0.7, 0.52, 0.05, 0.012, 0.08);
        if (i % 3 === 0) pp.cyl(-0.55, 0.7, 0.6, 0.035, 0.09, 8);
        if (i % 4 === 1) pp.box(0.45, 0.7, 0.4, 0.22, 0.012, 0.3);
        mon(pp, -0.27, 0.89, 0.8, 0.54, 0.28);
        chair(x + (rand() - 0.5) * 0.15, zp - face * 0.05, ang + (rand() - 0.5) * 0.7);
        if (rand() < 0.45) people.person(x, 0, zp - face * 0.05, 1.75 * (0.93 + rand() * 0.12), ang + (rand() - 0.5) * 0.3, 'sit');
        desks++;
      }
    }
    // Low divider down the middle of each bench.
    prop.seg(-13.4, 0.7, zc, -13.4, 1.05, zc).seg(-1.1, 0.7, zc, -1.1, 1.05, zc).seg(-13.4, 1.05, zc, -1.1, 1.05, zc);
  }

  // Plants: leafy stems in pots, here and there.
  const plant = (x: number, z: number, s = 1) => {
    pp.at(x, 0, z).cyl(0, 0, 0, 0.2 * s, 0.4 * s, 10).circ(0, 0.37 * s, 0, 0.17 * s, 8);
    const n = Math.round(8 + 8 * k);
    for (let i = 0; i < n; i++) {
      const az = rand() * TAU;
      const len = (0.5 + rand() * 0.55) * s;
      const ca = Math.cos(az);
      const sa = Math.sin(az);
      const y0 = 0.38 * s;
      const p1: [number, number, number] = [ca * 0.3 * len, y0 + len * 0.55, sa * 0.3 * len];
      const p2: [number, number, number] = [ca * 0.7 * len, y0 + len * 0.7, sa * 0.7 * len];
      const w = 0.07 * s;
      pp.path([[0, y0, 0], p1, p2]);
      pp.seg(...p1, p2[0] + sa * w, p2[1], p2[2] - ca * w).seg(...p1, p2[0] - sa * w, p2[1], p2[2] + ca * w);
      pp.seg(p1[0] + sa * w, p1[1], p1[2] - ca * w, p2[0], p2[1] - 0.05 * s, p2[2]).seg(p1[0] - sa * w, p1[1], p1[2] + ca * w, p2[0], p2[1] - 0.05 * s, p2[2]);
    }
  };
  for (const [x, z, s] of [
    [-13.6, -9.2, 1.4], [-13.6, -3.5, 1.2], [-13.6, 2.2, 1.3], [-13.6, 7.8, 1.4], [-9.4, -9.3, 1.1], [-2.8, -9.3, 1.3],
    [3.4, -9.3, 1.2], [-1.8, 2.6, 0.9], [2.2, 4.2, 1.2], [-11.2, 5.6, 1.2], [8.6, 3.4, 1.0], [0.4, -4.3, 0.8], [3.4, 9.9, 1.3], [-2, 9.8, 1.2],
  ] as number[][]) plant(x, z, s);

  // Reception: counter, desk, receptionist, the sign wall behind her.
  {
    const p = pp.at(-6.2, 0, 5.3);
    p.box(-2.1, 0, 0, 4.2, 1.05, 0.5).box(-2.1, 1.05, 0.0, 4.2, 0.03, 0.7);
    for (let i = 0; i <= 8; i++) p.seg(-2.1 + i * 0.525, 0.1, 0.5, -2.1 + i * 0.525, 1.0, 0.5);
    p.circ(0, 0.55, 0.51, 0.22, 20, 'x').circ(0, 0.55, 0.51, 0.14, 16, 'x');
    p.box(-1.9, 0.67, -0.9, 3.8, 0.03, 0.85).seg(-1.9, 0, -0.9, -1.9, 0.67, -0.9).seg(1.9, 0, -0.9, 1.9, 0.67, -0.9).seg(-1.9, 0, -0.1, -1.9, 0.67, -0.1).seg(1.9, 0, -0.1, 1.9, 0.67, -0.1);
    p.box(-0.3, 0.7, -0.55, 0.6, 0.34, 0.025).seg(0, 0.7, -0.5, 0, 0.8, -0.5);
    p.circ(1.1, 0.73, -0.5, 0.05, 8).seg(1.1, 0.73, -0.5, 1.1, 1.0, -0.5).circ(1.1, 1.0, -0.45, 0.07, 8, 'z');
    mon(p, -0.27, 0.74, -0.58, 0.54, 0.28);
    chair(-6.2, 4.1, 0.2);
    people.person(-6.2, 0, 4.1, 1.7, 0.2, 'sit');
    const s = pp.at(-6.2, 0, 3.3);
    s.box(-2.4, 0, -0.05, 4.8, 2.8, 0.1);
    pf.at(-6.2, 0, 3.3).box(-2.4, 0, -0.05, 4.8, 2.8, 0.1);
    const word = 'MNS TECH';
    const hgt = 0.55;
    const wd = 0.4;
    const gap = 0.16;
    let tw = -gap;
    for (const ch of word) tw += (ch === ' ' ? 0.3 : wd) + gap;
    let x = -tw / 2;
    for (const ch of word) {
      for (const line of GLYPH[ch] ?? []) {
        const pts = line.map(([u, v]) => [x + u * wd, 1.55 + v * hgt, 0.06]);
        pf.path(pts);
      }
      x += (ch === ' ' ? 0.3 : wd) + gap;
    }
    s.seg(-2.2, 1.35, 0.06, 2.2, 1.35, 0.06).seg(-2.2, 2.35, 0.06, 2.2, 2.35, 0.06);
    pp.at(-6.2, 0, 5.3);
    pp.seg(-2.3, 0, 0.8, -2.3, 1.2, 0.8).circ(-2.3, 1.4, 0.8, 0.2, 10, 'z');
  }

  // Lounge by the elevators' neighbour wall: sofas, a low table, armchairs.
  {
    const sofa = (x: number, z: number, ang: number, w: number) => {
      const p = pp.at(x, 0, z, ang);
      p.box(-w / 2, 0.1, -0.4, w, 0.35, 0.8).box(-w / 2, 0.45, -0.4, w, 0.5, 0.2).box(-w / 2 - 0.15, 0.1, -0.4, 0.15, 0.6, 0.8).box(w / 2, 0.1, -0.4, 0.15, 0.6, 0.8);
      for (let i = 1; i < Math.round(w / 0.7); i++) p.seg(-w / 2 + i * (w / Math.round(w / 0.7)), 0.45, -0.2, -w / 2 + i * (w / Math.round(w / 0.7)), 0.45, 0.4);
    };
    sofa(5.6, 10.0, Math.PI, 2.2);
    sofa(8.6, 8.4, -Math.PI / 2, 1.6);
    sofa(2.6, 8.4, Math.PI / 2, 1.6);
    pp.at(5.6, 0, 8.4).box(-0.7, 0.3, -0.4, 1.4, 0.04, 0.8).seg(-0.6, 0, -0.3, -0.6, 0.3, -0.3).seg(0.6, 0, -0.3, 0.6, 0.3, -0.3).seg(-0.6, 0, 0.3, -0.6, 0.3, 0.3).seg(0.6, 0, 0.3, 0.6, 0.3, 0.3);
    pp.cyl(0, 0.34, 0, 0.12, 0.05, 8).box(0.3, 0.34, 0.1, 0.25, 0.01, 0.2);
    people.person(5.0, 0, 9.75, 1.7, Math.PI, 'sit');
    people.person(6.2, 0, 9.75, 1.65, Math.PI + 0.3, 'sit');
  }

  // Meeting room: a long table, eight chairs, a screen on a stand, three people.
  {
    const cx = (MEET.x0 + MEET.x1) / 2;
    const cz = (MEET.z0 + MEET.z1) / 2;
    const t = pp.at(cx, 0, cz);
    t.box(-1.9, 0.67, -0.7, 3.8, 0.04, 1.4);
    pf.at(cx, 0, cz).box(-1.9, 0.67, -0.7, 3.8, 0.04, 1.4);
    for (const sx of [-1.5, 1.5]) t.seg(sx, 0, -0.55, sx, 0.67, -0.55).seg(sx, 0, 0.55, sx, 0.67, 0.55).seg(sx, 0.05, -0.55, sx, 0.05, 0.55);
    t.circ(0, 0.7, 0, 0.12, 8).box(-0.5, 0.71, 0.45, 0.3, 0.01, 0.2).box(0.6, 0.71, -0.55, 0.3, 0.01, 0.2);
    for (const sx of [-1.2, 0, 1.2]) {
      chair(cx + sx, cz - 1.05, 0);
      chair(cx + sx, cz + 1.05, Math.PI);
    }
    chair(cx - 2.25, cz, Math.PI / 2);
    chair(cx + 2.25, cz, -Math.PI / 2);
    people.person(cx - 2.25, 0, cz, 1.72, Math.PI / 2, 'sit');
    people.person(cx + 0.0, 0, cz + 1.05, 1.62, Math.PI, 'sit');
    people.person(cx + 2.9 - 0.5, 0, cz - 1.3, 1.78, -Math.PI / 2 - 0.5, 'stand');
    const tv = pp.at(MEET.x1 - 0.35, 0, cz, -Math.PI / 2);
    tv.box(-0.85, 0.95, 0, 1.7, 0.95, 0.06).seg(0, 0, 0.03, 0, 0.95, 0.03).seg(-0.4, 0, 0.03, 0.4, 0, 0.03).seg(-0.4, 0, 0.03, -0.3, 0.1, 0.03);
    pf.at(MEET.x1 - 0.35, 0, cz, -Math.PI / 2).box(-0.85, 0.95, 0, 1.7, 0.95, 0.06);
    mon(tv, -0.78, 1.0, 0.065, 1.56, 0.85);
    pp.at(MEET.x0 + 0.6, 0, MEET.z0 + 0.4, 0.4).box(-0.6, 0.9, 0, 1.2, 0.9, 0.04).seg(-0.55, 0.05, 0.02, -0.4, 0.9, 0.02).seg(0.55, 0.05, 0.02, 0.4, 0.9, 0.02);
    pp.path([[-0.4, 1.4, 0.05], [-0.2, 1.6, 0.05], [0, 1.35, 0.05], [0.25, 1.65, 0.05], [0.45, 1.4, 0.05]]);
    pp.circ(0.3, 1.1, 0.05, 0.12, 10, 'x');
    pf.at(MEET.x0 + 0.6, 0, MEET.z0 + 0.4, 0.4).box(-0.6, 0.9, 0, 1.2, 0.9, 0.04);
    for (let i = 0; i < 3; i++) lights.rect(cx - 1.2 + i * 1.2, H - 0.3, cz - 0.1, cx - 0.6 + i * 1.2, cz + 0.1);
  }

  // Server room: two rows of racks facing a cold aisle; LEDs blink in update's shader.
  {
    for (const row of [0, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = 5.4 + i * 0.75;
        const x0 = row ? 13.1 : 11.0;
        const front = row ? x0 : x0 + 0.9;
        const dir = row ? -1 : 1;
        pf.at(0, 0, 0).box(x0, 0, z - 0.3, 0.9, 2.1, 0.6);
        pp.at(0, 0, 0);
        for (let y = 0.15; y < 2.05; y += 0.1) pp.seg(front + dir * 0.0, y, z - 0.28, front + dir * 0.0, y, z + 0.28);
        for (let y = 0.2; y < 2.0; y += 0.1) {
          if (rand() < 0.75) leds.push(front - dir * 0.005 + dir * 0.0 + (row ? -0.01 : 0.01), y, z - 0.2);
          if (rand() < 0.5) leds.push(front + (row ? -0.01 : 0.01), y, z - 0.12);
        }
      }
    }
    pp.at(0, 0, 0).seg(11.9, 2.4, 5.0, 11.9, 2.4, 9.6).seg(13.1, 2.4, 5.0, 13.1, 2.4, 9.6).seg(12.5, 2.4, 5.0, 12.5, 2.4, 9.6);
    for (let z = 5.2; z < 9.6; z += 0.5) pp.seg(11.9, 2.4, z, 13.1, 2.4, z);
  }

  // Pantry against the right wall: counter, cabinets, a fridge, an island with stools, two people with coffee.
  {
    const p = pp.at(XL - 0.05, 0, 0.9, -Math.PI / 2);
    p.box(-2.3, 0, 0, 4.2, 0.92, 0.65).box(-2.3, 1.55, 0, 4.2, 0.85, 0.35).box(1.95, 0, 0, 0.8, 1.95, 0.7);
    for (let i = 1; i < 5; i++) p.seg(-2.3 + i * 0.84, 1.55, 0.35, -2.3 + i * 0.84, 2.4, 0.35).seg(-2.3 + i * 0.84, 0.05, 0.65, -2.3 + i * 0.84, 0.9, 0.65);
    p.box(-1.0, 0.92, 0.12, 0.6, 0.02, 0.4).path([[-0.3, 0.94, 0.2], [-0.3, 1.2, 0.2], [-0.45, 1.25, 0.28]]).seg(1.95, 1.2, 0.7, 1.95, 1.6, 0.7);
    p.box(-1.5, 0, 1.7, 3.0, 0.95, 0.6);
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      p.circ(x, 0.68, 2.55, 0.16, 10).seg(x, 0.68, 2.55, x, 0, 2.55);
      p.circ(x, 0.3, 2.55, 0.14, 8);
    }
    pf.at(XL - 0.05, 0, 0.9, -Math.PI / 2).box(-2.3, 0, 0, 4.2, 0.92, 0.65).box(-1.5, 0, 1.7, 3.0, 0.95, 0.6);
    people.person(12.0, 0, 0.1, 1.72, Math.PI / 2 + 0.2, 'stand');
    people.person(12.0, 0, 1.2, 1.64, Math.PI / 2 - 0.4, 'stand');
  }

  // Walkers, people at the windows.
  people.person(0.5, 0, 0.9, 1.75, 0.1, 'walk');
  people.person(0.7, 0, -5.8, 1.7, Math.PI + 0.1, 'walk');
  people.person(-2.9, 0, 6.6, 1.68, 1.4, 'walk');
  people.person(-6.4, 0, -9.0, 1.78, Math.PI, 'stand');
  people.person(-13.4, 0, 1.4, 1.65, -Math.PI / 2, 'stand');
  people.person(-13.4, 0, 2.3, 1.74, -Math.PI / 2 + 0.2, 'stand');

  // ── The lab ─────────────────────────────────────────────────────────────────────────────
  // Floor: a polished slab with a marked projection zone; benches against the right wall; a printer by the window.
  for (let x = LAB.x0; x <= LAB.x1 + 0.01; x += 1.0) grid.seg(x, 0.01, LAB.z0, x, 0.01, LAB.z1);
  for (let z = LAB.z0; z <= LAB.z1 + 0.01; z += 1.0) grid.seg(LAB.x0, 0.01, z, LAB.x1, 0.01, z);
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * TAU;
    shell.circle(TX, 0.015, TZ, 1.55, 4, false, a0, a0 + 0.17);
  }
  shell.circle(TX, 0.015, TZ, 1.7, 48);
  {
    const b = pp.at(XL - 0.4, 0, -7.7, -Math.PI / 2);
    b.box(-2.4, 0.7, 0, 4.8, 0.04, 0.7).box(-2.4, 0.15, 0.05, 4.8, 0.03, 0.6);
    for (const sx of [-2.35, -0.8, 0.8, 2.35]) b.seg(sx, 0, 0.05, sx, 0.7, 0.05).seg(sx, 0, 0.65, sx, 0.7, 0.65);
    pf.at(XL - 0.4, 0, -7.7, -Math.PI / 2).box(-2.4, 0.7, 0, 4.8, 0.04, 0.7);
    for (let i = 0; i < 3; i++) {
      const x = -1.7 + i * 1.4;
      b.box(x - 0.3, 0.74, 0.15, 0.6, 0.36, 0.025).seg(x, 0.74, 0.2, x, 0.8, 0.2).box(x - 0.1, 0.74, 0.1, 0.2, 0.01, 0.14);
      pf.at(XL - 0.4, 0, -7.7, -Math.PI / 2).box(x - 0.3, 0.74, 0.15, 0.6, 0.36, 0.025);
      mon(b, x - 0.27, 0.78, 0.17, 0.54, 0.28);
      b.box(x - 0.2, 0.74, 0.35, 0.4, 0.012, 0.13);
    }
    b.cyl(1.9, 0.74, 0.4, 0.07, 0.2, 8).cyl(2.1, 0.74, 0.5, 0.05, 0.14, 8).path([[-2.2, 0.74, 0.4], [-2.2, 1.05, 0.4], [-2.0, 1.1, 0.45]]);
    b.circ(-2.0, 1.1, 0.45, 0.05, 8, 'x');
    pp.at(XL - 0.35, 0, -9.3).box(-0.4, 0, -0.4, 0.8, 2.0, 0.8);
    for (let y = 0.2; y < 2.0; y += 0.2) pp.seg(-0.4, y, -0.4, -0.4, y, 0.4);
    pp.at(6.5, 0, -9.3).box(-0.5, 0.7, -0.4, 1.0, 0.04, 0.8).box(-0.4, 0.74, -0.3, 0.8, 0.7, 0.6).seg(-0.4, 0.74, 0.3, -0.4, 1.44, 0.3).seg(0.4, 0.74, 0.3, 0.4, 1.44, 0.3).seg(-0.45, 0, -0.35, -0.45, 0.7, -0.35).seg(0.45, 0, -0.35, 0.45, 0.7, -0.35).seg(-0.45, 0, 0.35, -0.45, 0.7, 0.35).seg(0.45, 0, 0.35, 0.45, 0.7, 0.35);
    pp.at(7.3, 0, -6.9, 0.5).box(-0.3, 0.9, 0, 0.6, 0.7, 0.04).seg(-0.2, 0, 0.02, -0.15, 0.9, 0.02).seg(0.2, 0, 0.02, 0.15, 0.9, 0.02);
    chair(11.8, -8.9, -1.5);
    people.person(11.4, 0, -6.9, 1.7, Math.atan2(TX - 11.4, TZ + 6.9), 'stand');
    for (let x = LAB.x0 + 0.5; x < LAB.x1 - 0.5; x += 2.0) lights.rect(x - 0.6, H - 0.02, -8.3, x + 0.6, -7.7);
  }
  // Hologram table: pedestal, rim, a turning dial; the beam and cone leading up to the machine.
  {
    const p = pp.at(TX, 0, TZ);
    p.circ(0, 0, 0, 0.7, 40).circ(0, 0.06, 0, 0.66, 40).circ(0, 0.55, 0, 0.3, 24).circ(0, 0.3, 0, 0.3, 24).circ(0, 0.78, 0, 0.85, 48).circ(0, 0.9, 0, 0.85, 48).circ(0, 0.9, 0, 0.7, 40);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      p.seg(Math.cos(a) * 0.66, 0.06, Math.sin(a) * 0.66, Math.cos(a) * 0.3, 0.3, Math.sin(a) * 0.3).seg(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3, Math.cos(a) * 0.85, 0.78, Math.sin(a) * 0.85);
      p.seg(Math.cos(a) * 0.85, 0.78, Math.sin(a) * 0.85, Math.cos(a) * 0.85, 0.9, Math.sin(a) * 0.85);
    }
    pf.at(TX, 0, TZ).circ(0, 0.9, 0, 0.85, 64).circ(0, 0.78, 0, 0.85, 64).circ(0, 0, 0, 0.7, 48);
  }

  // ── The amber clue: light spilling out of the lab ──────────────────────────────────────
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = 5.8 + t * 8.2;
    const z = LAB.z1 + 0.3 + ((i * 5) % 7) * 0.5;
    amber.seg(TX, HOLO_Y, TZ, x, 0.02, z);
  }
  // A cone of light across the floor from the door, and bands of it on the glass.
  {
    const dx0 = LAB.x0 + 2.0;
    const dx1 = LAB.x0 + 3.1;
    for (const z of [LAB.z1 + 0.4, LAB.z1 + 1.0, LAB.z1 + 1.7, LAB.z1 + 2.4]) {
      const s = (z - LAB.z1) / 2.4;
      amber.seg(dx0 - s * 1.5, 0.02, z, dx1 + s * 1.5, 0.02, z);
    }
    amber.seg(dx0, 0.02, LAB.z1, dx0 - 1.5, 0.02, LAB.z1 + 2.4).seg(dx1, 0.02, LAB.z1, dx1 + 1.5, 0.02, LAB.z1 + 2.4).seg((dx0 + dx1) / 2, 0.02, LAB.z1, (dx0 + dx1) / 2, 0.02, LAB.z1 + 2.4);
    for (let i = 0; i < 6; i++) amber.seg(LAB.x0 + 0.4 + i * 1.4, 1.0, LAB.z1, LAB.x0 + 0.4 + i * 1.4, 2.8, LAB.z1);
  }

  // ── Outside: the night skyline, only inside each window's cone of view ─────────────────
  const plain = (o: number, tint = CYAN) => {
    const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    m.colorNode = color(tint);
    m.opacityNode = float(o).mul(fade);
    return m;
  };
  const sky = new Lines();
  const city: number[] = [];
  const EYE = 2.2;
  for (const w of ['back', 'left'] as Wall[]) {
    const D = w === 'back' ? -ZB : XL;
    const [a0, a1] = SPAN[w];
    for (let band = 0; band < 5; band++) {
      const s = (D + 14 * Math.pow(1.7, band)) / D;
      const dist = D * s;
      const P = (u: number, y: number): [number, number, number] => (w === 'back' ? [u, y, -dist] : [-dist, y, u]);
      for (let u = a0 * s; u < a1 * s; ) {
        const bw = (0.5 + rand() * 1.1) * (0.6 + band * 0.45);
        if (rand() < 0.14) {
          u += bw;
          continue;
        }
        const vTop = 0.4 + Math.pow(rand(), 0.9) * 3.4;
        const yTop = EYE + (vTop - EYE) * s;
        const yLow = EYE + (0.05 - EYE) * s;
        const a = u;
        const b = u + bw;
        sky.seg(...P(a, yLow), ...P(a, yTop)).seg(...P(b, yLow), ...P(b, yTop)).seg(...P(a, yTop), ...P(b, yTop));
        const fl = 0.16 * s * (0.8 + band * 0.12);
        for (let y = yTop - fl; y > yLow; y -= fl) sky.seg(...P(a, y), ...P(b, y));
        if (rand() < 0.22) sky.seg(...P((a + b) / 2, yTop), ...P((a + b) / 2, yTop + (0.3 + rand() * 0.8) * s * 0.3));
        const cols = Math.max(2, Math.round(bw / (0.9 * (0.6 + band * 0.45))));
        for (let y = yTop - fl / 2; y > yLow; y -= fl) {
          for (let c = 0; c < cols; c++) {
            if (rand() > 0.33 * (0.35 + k * 0.65)) continue;
            const p = P(a + (c + 0.5) * (bw / cols), y);
            city.push(p[0], p[1], p[2]);
          }
        }
        u += bw + rand() * 0.8 * s * 0.12;
      }
    }
  }
  const skyline = new LineSegments(sky.geometry(), plain(0.3));
  skyline.userData.noSample = true;
  root.add(skyline);

  // ── The machine hologram: meshed gears (the target) ────────────────────────────────────
  const holoMachine = new Group();
  holoMachine.position.set(TX, HOLO_Y, TZ);
  holoMachine.scale.setScalar(1.3);
  root.add(holoMachine);
  const gearGeo = (teeth: number, r0: number, r1: number, th: number) => {
    const g = new Lines();
    const pitch = TAU / teeth;
    for (const z of [-th / 2, th / 2]) {
      for (let i = 0; i < teeth; i++) {
        const a = i * pitch;
        const pts = [
          [a, r0],
          [a + 0.12 * pitch, r1],
          [a + 0.38 * pitch, r1],
          [a + 0.5 * pitch, r0],
          [a + pitch, r0],
        ];
        for (let j = 0; j < 4; j++) {
          const [a0, rA] = pts[j];
          const [a1, rB] = pts[j + 1];
          g.seg(Math.cos(a0) * rA, Math.sin(a0) * rA, z, Math.cos(a1) * rB, Math.sin(a1) * rB, z);
        }
      }
      g.circle(0, 0, z, r0 * 0.5, 20, true).circle(0, 0, z, r0 * 0.18, 12, true);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        g.seg(Math.cos(a) * r0 * 0.18, Math.sin(a) * r0 * 0.18, z, Math.cos(a) * r0 * 0.5, Math.sin(a) * r0 * 0.5, z);
      }
    }
    for (let i = 0; i < teeth; i++) {
      for (const f of [0.12, 0.38]) {
        const a = (i + f) * pitch;
        g.seg(Math.cos(a) * r1, Math.sin(a) * r1, -th / 2, Math.cos(a) * r1, Math.sin(a) * r1, th / 2);
      }
    }
    g.seg(0, 0, -th * 1.6, 0, 0, th * 1.6);
    return new LineSegments(g.geometry(), targetMaterial(fade, glow));
  };
  const gear = [
    { n: 14, r0: 0.25, r1: 0.31, x: 0, y: 0, th: 0.07 },
    { n: 8, r0: 0.15, r1: 0.2, x: 0, y: 0, th: 0.07 },
    { n: 6, r0: 0.1, r1: 0.14, x: 0, y: 0, th: 0.07 },
  ].map((c) => ({ ...c, obj: gearGeo(c.n, c.r0, c.r1, c.th) }));
  const phiBC = 1.15;
  const pitchR = (c: (typeof gear)[number]) => (c.r0 + c.r1) / 2;
  gear[0].x = -0.36;
  gear[0].y = -0.04;
  gear[1].x = gear[0].x + pitchR(gear[0]) + pitchR(gear[1]);
  gear[1].y = gear[0].y;
  gear[2].x = gear[1].x + Math.cos(phiBC) * (pitchR(gear[1]) + pitchR(gear[2]));
  gear[2].y = gear[1].y + Math.sin(phiBC) * (pitchR(gear[1]) + pitchR(gear[2]));
  for (const c of gear) {
    c.obj.position.set(c.x, c.y, 0);
    holoMachine.add(c.obj);
  }
  const cage = new Lines().circle(0, 0, 0, 0.62, 56).circle(0, 0, 0, 0.62, 56, true).circle(0, -0.45, 0, 0.5, 40);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    cage.seg(Math.cos(a) * 0.5, -0.45, Math.sin(a) * 0.5, Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5);
  }
  holoMachine.add(new LineSegments(cage.geometry(), targetMaterial(fade, glow)));
  const orbit = new Group();
  const orbitL = new Lines().circle(0, 0, 0, 0.78, 72);
  for (let i = 0; i < 60; i++) {
    const a = (i * TAU) / 60;
    const r1 = i % 5 === 0 ? 0.86 : 0.82;
    orbitL.seg(Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  }
  orbit.add(new LineSegments(orbitL.geometry(), thin(0.5, ICE)));
  orbit.position.set(TX, HOLO_Y, TZ);
  orbit.scale.setScalar(1.3);
  orbit.rotation.x = 0.4;
  root.add(orbit);
  const cone = new Mesh(new CylinderGeometry(0.5, 0.78, 0.55, 40, 1, true).translate(TX, 1.18, TZ), fillMaterial(fade, ICE, 0.28));
  cone.userData.noSample = true;
  root.add(cone);
  const ringGeo = new Lines().circle(0, 0, 0, 1, 40).geometry();
  const ringMat = thin(0.7, ICE);
  const scanRings = [0, 1, 2].map(() => {
    const r = new LineSegments(ringGeo, ringMat);
    r.userData.noSample = true;
    root.add(r);
    return r;
  });
  const dial = new Group();
  dial.position.set(TX, 0.91, TZ);
  const dialL = new Lines().circle(0, 0, 0, 0.6, 40);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    dialL.seg(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6, Math.cos(a) * (i % 4 ? 0.64 : 0.7), 0, Math.sin(a) * (i % 4 ? 0.64 : 0.7));
  }
  dial.add(new LineSegments(dialL.geometry(), thin(0.7, ICE)));
  root.add(dial);

  // ── Monitors: animated data lines in one dynamic buffer ────────────────────────────────
  const screenBuf = new Float32Array(mons.length * SEGS * 6);
  const screenAttr = new BufferAttribute(screenBuf, 3);
  const screens = new LineSegments(new Lines().geometry(), thin(0.85, ICE));
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
      let pv = 0.75 + 0.15 * Math.sin(mi);
      for (let i = 0; i < 12; i++) {
        const u0 = m.w * (0.5 + (i / 12) * 0.45);
        const u1 = m.w * (0.5 + ((i + 1) / 12) * 0.45);
        const nv = 0.68 + 0.2 * Math.sin(t * 1.3 + (i + 1) * 0.8 + mi) * Math.sin(t * 0.4 + i * 0.3);
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

  // ── Light sprites ──────────────────────────────────────────────────────────────────────
  const attr3 = (a: Float32Array) => instancedBufferAttribute(new InstancedBufferAttribute(a, 3), 'vec3');
  const soft = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
  const sprite = (pos: number[] | Float32Array, build: (p: any) => Partial<PointsNodeMaterial>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const arr = pos instanceof Float32Array ? pos : new Float32Array(pos);
    const m = Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), build(attr3(arr)));
    const s = new Sprite(m);
    s.count = arr.length / 3;
    s.frustumCulled = false;
    root.add(s);
    return s;
  };
  sprite(city, (p) => ({
    positionNode: p,
    sizeNode: float(1.7).add(hash(instanceIndex).mul(1.5)),
    colorNode: color(ICE),
    opacityNode: soft.mul(sin(time.mul(0.4).add(hash(instanceIndex.add(3)).mul(60))).mul(0.15).add(0.55)).mul(fade),
  })).userData.noSample = true;
  const led = sprite(leds, (p) => ({
    positionNode: p,
    sizeNode: float(3),
    colorNode: color(CYAN),
    opacityNode: soft.mul(step(0.5, fract(time.mul(hash(instanceIndex).mul(1.5).add(0.4)).add(hash(instanceIndex.add(7)))))).mul(0.9).mul(fade),
  }));
  led.userData.points = new Float32Array(leds);
  sprite([TX, HOLO_Y, TZ], (p) => ({ positionNode: p, sizeNode: float(110), colorNode: color(AMBER), opacityNode: soft.mul(0.32).mul(fade) })).userData.noSample = true;
  const nMotes = Math.round(110 * k);
  const motes = new Float32Array(nMotes * 3);
  for (let i = 0; i < nMotes; i++) motes.set([(rand() - 0.5) * 2 * (XL - 1), rand() * H, ZB + rand() * (ZF - ZB)], i * 3);
  sprite(motes, (p) => ({
    positionNode: p.add(sin(time.mul(0.3).add(p.z.mul(3))).mul(0.12)),
    sizeNode: float(1.3).add(hash(instanceIndex).mul(1.2)),
    colorNode: color(ICE),
    opacityNode: soft.mul(0.4).mul(fade),
  })).userData.noSample = true;

  // ── Assemble ───────────────────────────────────────────────────────────────────────────
  root.add(strokes(frame.positions(), fade, ICE, 0.85, 2));
  root.add(strokes(gl.positions(), fade, ICE, 0.55, 1.6));
  lit(shell, 0.45, ICE);
  lit(grid, 0.16, CYAN);
  lit(prop, 0.55, ICE);
  lit(people, 0.85, ICE);
  lit(lights, 0.65, ICE);
  lit(amber, 0.3, AMBER);

  const anchor = (x: number, y: number, z: number, parent: Object3D = root) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const labels: NonNullable<Layer['labels']> = [
    { object: anchor(LAB.x0 + 0.2, 3.2, LAB.z1), pt: 'LABORATÓRIO · ACESSO RESTRITO', en: 'LAB · RESTRICTED ACCESS' },
    { object: anchor(MEET.x0 + 0.2, 3.1, MEET.z0 + 0.5), pt: 'SALA DE REUNIÃO · OCUPADA', en: 'MEETING ROOM · IN USE' },
    { object: anchor(12.5, 2.7, SERVER.z0), pt: 'SERVIDORES · CARGA 62%', en: 'SERVERS · LOAD 62%' },
    { object: anchor(-4, 3.1, ZB), pt: 'VISTA · SETOR 7', en: 'VIEW · SECTOR 7' },
    { object: anchor(0, 0.7, 0, holoMachine), pt: 'SINAL ÂMBAR · PROJEÇÃO', en: 'AMBER SIGNAL · PROJECTION' },
    { object: anchor(-5.8, 3.3, ZF), pt: 'ELEVADORES', en: 'ELEVATORS' },
  ];

  root.add(horizon(fade, 13.5, -1));
  return {
    id: 'room',
    root,
    fade,
    glow,
    labels,
    exposure: 0.55,
    caption: { pt: 'Um andar executivo, no alto do prédio. Algo brilha atrás do vidro.', en: 'An executive floor, high up in the building. Something glows behind the glass.' },
    radius: 13.5,
    view: { distance: 7.8, minDistance: 1.9, maxDistance: 9.5, pitch: 0.2, height: 1.1 },
    target: { object: holoMachine, radius: 0.8 },
    update(t) {
      holoMachine.rotation.y = t * 0.35;
      holoMachine.position.y = HOLO_Y + Math.sin(t * 1.1) * 0.04;
      orbit.position.y = holoMachine.position.y;
      orbit.rotation.y = -t * 0.25;
      // Gears mesh: each turns against its driver, phase-shifted so teeth meet gaps.
      const a = gear[0];
      const b = gear[1];
      const c = gear[2];
      const tA = t * 0.5;
      const tB = (-tA * a.n) / b.n + Math.PI;
      a.obj.rotation.z = tA;
      b.obj.rotation.z = tB;
      c.obj.rotation.z = (-tB * b.n) / c.n + Math.PI + phiBC * (1 + b.n / c.n);
      dial.rotation.y = -t * 0.35;
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.2 + i / 3) % 1;
        const r = scanRings[i];
        r.position.set(TX, 0.94 + q * 0.6, TZ);
        r.scale.setScalar(0.36 + q * 0.4);
      }
      drawScreens(t);
    },
  };
}
