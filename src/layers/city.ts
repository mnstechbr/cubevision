import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Object3D,
  PointsNodeMaterial,
  Sprite,
} from 'three/webgpu';
import { color, cos, float, fract, hash, instanceIndex, instancedBufferAttribute, length, max, mix, pow, sin, smoothstep, step, time, uv, vec3 } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, fillMaterial, horizon, lineMaterial, strokes, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

/*
 * [2] Inside the cube: a night metropolis seen from above and to the south.
 *
 * The camera arrives at +Z looking toward -Z: the river runs away from the viewer toward a wide bay,
 * the downtown skyline stands left of it, the port and the TV tower on the right, the park and the
 * stadium in front. The way in is hidden: an office tower in the far east, marked only by a faint
 * amber beam. Everything is on one street grid (CELL), so avenues, bridges and districts line up.
 */

const R = 18;
const TAU = Math.PI * 2;
/** Dense city (ellipse half-axes), the ring highway around it, and the suburbs that thin out beyond. */
const CA = 15.2;
const CB = 14;
const RA = 16.3;
const RB = 15;
const OA = 22;
const OB = 20;
/** Street grid: lines at X0 + CELL * i, Z0 + CELL * j (cell indices are offset by 4 from the dense core's). */
const X0 = -21;
const Z0 = -19.5;
const CELL = 1.5;
const NI = 28;
const NJ = 26;
const key = (i: number, j: number) => `${i + 4},${j + 4}`;
const AVE_X = [-7.5, 6];
const AVE_Z = [-4.5, 7.5];
const GAP = 0.3;
const AGAP = 0.56;
const RAIL_Z = 1.5;
/** The target office tower: grid cell (i, j) and its height. */
const TARGET_CELL = key(16, 3);
const TARGET_H = 5;
/** Stadium oval and park rectangle (west bank, foreground). */
const SX = -11.9;
const SZ = 4.2;
const SRX = 2.3;
const SRZ = 1.75;
const PARK = { x0: -9, x1: -3, z0: 3, z1: 13.5 };

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** River centre line and half width; it opens into a bay toward -Z. */
const riverX = (z: number) => 2 * Math.sin(0.17 * z + 0.4);
const riverHW = (z: number) => 1.7 + 4.5 * (1 - ss(-22, -11, z)) + Math.max(0, -z - 22) * 0.45;
const ellX = (z: number, a: number, b: number) => a * Math.sqrt(Math.max(0, 1 - (z / b) ** 2));
const inPark = (x: number, z: number) => x > PARK.x0 + 0.01 && x < PARK.x1 - 0.01 && z > PARK.z0 + 0.01 && z < PARK.z1 - 0.01;
const inStadium = (x: number, z: number, m: number) => ((x - SX) / (SRX + m)) ** 2 + ((z - SZ) / (SRZ + m)) ** 2 < 1;
const portXE = (z: number) => Math.min(7.2, ellX(z, CA, CB) - 0.5);
const inPort = (x: number, z: number) => z > -12.95 && z < -5.7 && x > riverX(z) + riverHW(z) + 0.3 && x < portXE(z) + 0.3;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
const attr = (a: Float32Array, n: 1 | 2 | 3 | 4): N =>
  instancedBufferAttribute(new InstancedBufferAttribute(a, n), (n === 1 ? 'float' : `vec${n}`) as 'vec4');
const pm = () => new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
const dotShape = () => float(1).sub(smoothstep(0.05, 0.5, length(uv().sub(0.5))));

function sprite(count: number, position: N, size: N, col: N, opacity: N) {
  const m = pm();
  m.positionNode = position;
  m.sizeNode = size;
  m.colorNode = col;
  m.opacityNode = opacity;
  const s = new Sprite(m);
  s.count = Math.max(1, count);
  s.frustumCulled = false;
  s.userData.noSample = true;
  return s;
}

const poly = (L: Lines, p: number[][]) => {
  for (let i = 0; i + 1 < p.length; i++) L.seg(p[i][0], p[i][1], p[i][2], p[i + 1][0], p[i + 1][1], p[i + 1][2]);
};
const ell = (L: Lines, cx: number, y: number, cz: number, rx: number, rz: number, n = 64, a0 = 0, a1 = TAU) => {
  let px = 0;
  let pz = 0;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const x = cx + Math.cos(a) * rx;
    const z = cz + Math.sin(a) * rz;
    if (i > 0) L.seg(px, y, pz, x, y, z);
    px = x;
    pz = z;
  }
};
/** A ring standing in the XY (or ZY) plane. */
const vring = (L: Lines, cx: number, cy: number, cz: number, r: number, n: number, zy = false) => {
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const o = Math.cos(a) * r;
    const x = zy ? cx : cx + o;
    const z = zy ? cz + o : cz;
    const y = cy + Math.sin(a) * r;
    if (i > 0) L.seg(px, py, pz, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
};

export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(20261118);
  const D = Math.min(1, Math.max(0.45, ctx.detail));
  const mo = ctx.reducedMotion ? 0.3 : 1;
  /** Floor spacing; windows sit between the floor lines. */
  const G = 0.13 / Math.min(1, Math.max(0.6, D * 1.15));

  const ground = new Lines(); // faint: lot outlines, lane marks, paths
  const shells = new Lines(); // medium: building edges, port, stadium
  const facade = new Lines(); // faint dense: floors and mullions
  const winI = new Lines(); // lit windows (ice)
  const winA = new Lines(); // lit windows (amber)
  const treeL = new Lines(); // park and street trees
  const bridgeT = new Lines(); // bridge hangers, braces, piers
  const waterT = new Lines(); // flow lines on the river
  const far = new Lines(); // mountains and bay beyond the city (not sampled)
  const sil = new Lines(); // thick: skyline and structures
  const roadS = new Lines(); // thick: avenues and river banks
  const hwS = new Lines(); // thick: ring highway, viaduct, bridges
  const fillBoxes: number[] = [];
  const fillCyl: number[] = [];
  const lamps: number[] = []; // x, y, z, size, warm
  const beacons: number[] = [];
  const lamp = (x: number, y: number, z: number, size = 1.7, warm = 0.25) => lamps.push(x, y, z, size, warm);
  const beacon = (x: number, y: number, z: number) => beacons.push(x, y, z);
  const pickWin = () => (rand() < 0.3 ? winA : winI);

  // ---------- buildings ----------
  /** Lit window dashes on the four faces of a box. */
  const lit = (x: number, y: number, z: number, w: number, h: number, d: number, p: number) => {
    const rows = Math.floor(h / G);
    if (rows < 1) return;
    const cw = Math.max(1, Math.round(w / 0.19));
    const cd = Math.max(1, Math.round(d / 0.19));
    const hx = Math.min(0.045, (w / cw) * 0.28);
    const hz = Math.min(0.045, (d / cd) * 0.28);
    const q = p * (0.5 + D * 0.5);
    const e = 0.004;
    for (let r = 0; r < rows; r++) {
      const yy = y + (r + 0.5) * G;
      for (let c = 0; c < cw; c++) {
        const u = x + (w * (c + 0.5)) / cw;
        if (rand() < q) pickWin().seg(u - hx, yy, z + d + e, u + hx, yy, z + d + e);
        if (rand() < q) pickWin().seg(u - hx, yy, z - e, u + hx, yy, z - e);
      }
      for (let c = 0; c < cd; c++) {
        const v = z + (d * (c + 0.5)) / cd;
        if (rand() < q) pickWin().seg(x + w + e, yy, v - hz, x + w + e, yy, v + hz);
        if (rand() < q) pickWin().seg(x - e, yy, v - hz, x - e, yy, v + hz);
      }
    }
  };

  /** A box with its fill, floors, mullions and lit windows. */
  const slab = (x: number, y: number, z: number, w: number, h: number, d: number, o: { win?: number; floors?: boolean; mull?: boolean; sil?: boolean } = {}) => {
    const { win = 0.18, floors = true, mull = true } = o;
    const x1 = x + w;
    const z1 = z + d;
    const y1 = y + h;
    shells.box(x, y, z, w, h, d);
    fillBoxes.push(x, y, z, w, h, d);
    if (floors && h > 0.3) for (let yy = y + G; yy < y1 - 0.03; yy += G) facade.rect(x, yy, z, x1, z1);
    if (mull && h > 0.3) {
      const cw = Math.max(1, Math.round(w / 0.24));
      const cd = Math.max(1, Math.round(d / 0.24));
      for (let k = 1; k < cw; k++) {
        const u = x + (w * k) / cw;
        facade.seg(u, y, z, u, y1, z).seg(u, y, z1, u, y1, z1);
      }
      for (let k = 1; k < cd; k++) {
        const u = z + (d * k) / cd;
        facade.seg(x, y, u, x, y1, u).seg(x1, y, u, x1, y1, u);
      }
    }
    if (win > 0 && h > 0.2) lit(x, y, z, w, h, d, win);
    if (o.sil) {
      sil.seg(x, y, z, x, y1, z).seg(x1, y, z, x1, y1, z).seg(x, y, z1, x, y1, z1).seg(x1, y, z1, x1, y1, z1);
      sil.rect(x, y1, z, x1, z1);
    }
  };

  /** Gabled roof on a box top. */
  const gable = (x: number, y: number, z: number, w: number, d: number, rh: number) => {
    const cx = x + w / 2;
    const cz = z + d / 2;
    if (w >= d) {
      shells.seg(x, y + rh, cz, x + w, y + rh, cz);
      for (const xx of [x, x + w]) shells.seg(xx, y, z, xx, y + rh, cz).seg(xx, y, z + d, xx, y + rh, cz);
    } else {
      shells.seg(cx, y + rh, z, cx, y + rh, z + d);
      for (const zz of [z, z + d]) shells.seg(x, y, zz, cx, y + rh, zz).seg(x + w, y, zz, cx, y + rh, zz);
    }
  };

  /** A skyscraper on a lot: podium, 1 to 3 setbacks, one of several crowns. */
  const tower = (x0: number, z0: number, x1: number, z1: number, H: number) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const W = x1 - x0;
    const Dp = z1 - z0;
    const m = 0.03 + rand() * 0.1;
    let cw = W - 2 * m;
    let cd = Dp - 2 * m;
    const podium = Math.min(0.55, H * 0.14);
    slab(x0 + 0.03, 0, z0 + 0.03, W - 0.06, podium, Dp - 0.06, { win: 0.12, floors: false });
    const tiers = H > 6 ? 3 : H > 3.8 ? 2 : 1;
    const split = tiers === 3 ? [0.5, 0.82, 1] : tiers === 2 ? [0.62, 1] : [1];
    let y = podium;
    for (let t = 0; t < tiers; t++) {
      const top = podium + (H - podium) * split[t];
      slab(cx - cw / 2, y, cz - cd / 2, cw, top - y, cd, { sil: true });
      y = top;
      if (t < tiers - 1) {
        cw *= 0.7 + rand() * 0.18;
        cd *= 0.7 + rand() * 0.18;
      }
    }
    const roof = rand();
    if (roof < 0.3) {
      const hh = 0.5 + rand() * 1.1;
      sil.seg(cx, H, cz, cx, H + hh, cz);
      if (H > 4.2) beacon(cx, H + hh, cz);
    } else if (roof < 0.55) {
      const hh = Math.min(cw, cd) * 0.9;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) sil.seg(cx + (sx * cw) / 2, H, cz + (sz * cd) / 2, cx, H + hh, cz);
      sil.seg(cx, H + hh, cz, cx, H + hh + 0.45, cz);
      if (H > 4.2) beacon(cx, H + hh + 0.45, cz);
    } else if (roof < 0.8) {
      slab(cx - cw * 0.3, H, cz - cd * 0.3, cw * 0.6, 0.2, cd * 0.6, { win: 0, floors: false, mull: false });
      sil.seg(cx, H + 0.2, cz, cx, H + 0.9, cz);
      if (H > 4.2) beacon(cx, H + 0.9, cz);
    } else {
      shells.circle(cx, H + 0.01, cz, Math.min(cw, cd) * 0.3, 14);
      shells.seg(cx - 0.08, H, cz, cx + 0.08, H, cz).seg(cx, H, cz - 0.08, cx, H, cz + 0.08);
      if (H > 4.2) beacon(cx + cw * 0.3, H + 0.02, cz);
    }
  };

  /** A mid-rise block with rooftop clutter. */
  const mid = (x0: number, z0: number, x1: number, z1: number, H: number) => {
    const m = 0.04 + rand() * 0.08;
    const w = x1 - x0 - 2 * m;
    const d = z1 - z0 - 2 * m;
    slab(x0 + m, 0, z0 + m, w, H, d, { win: 0.2 });
    const r = rand();
    if (r < 0.4) slab(x0 + m + w * 0.2, H, z0 + m + d * 0.2, w * 0.3, 0.12, d * 0.3, { win: 0, floors: false, mull: false });
    else if (r < 0.6) {
      const cx = x0 + m + w * 0.7;
      const cz = z0 + m + d * 0.5;
      shells.circle(cx, H, cz, 0.1, 10).circle(cx, H + 0.16, cz, 0.1, 10).seg(cx + 0.1, H, cz, cx + 0.1, H + 0.16, cz).seg(cx - 0.1, H, cz, cx - 0.1, H + 0.16, cz);
    } else if (r < 0.75) shells.circle((x0 + x1) / 2, H + 0.01, (z0 + z1) / 2, Math.min(w, d) * 0.3, 14);
    if (H > 2.2 && rand() < 0.5) {
      shells.seg((x0 + x1) / 2, H, (z0 + z1) / 2, (x0 + x1) / 2, H + 0.5, (z0 + z1) / 2);
      beacon((x0 + x1) / 2, H + 0.5, (z0 + z1) / 2);
    }
  };

  /** Houses (2x2 lots, gabled) or a row of apartment slabs. */
  const lowBlock = (x0: number, z0: number, x1: number, z1: number, H: number) => {
    const r = rand();
    if (H < 0.62 && r < 0.8) {
      const gx = 0.05;
      const w = (x1 - x0 - gx * 3) / 2;
      const d = (z1 - z0 - gx * 3) / 2;
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          const hx = x0 + gx + a * (w + gx);
          const hz = z0 + gx + b * (d + gx);
          const h = 0.18 + rand() * 0.3;
          shells.box(hx, 0, hz, w, h, d);
          fillBoxes.push(hx, 0, hz, w, h, d);
          gable(hx, h, hz, w, d, 0.1 + rand() * 0.08);
          lit(hx, 0, hz, w, h, d, 0.3);
        }
    } else if (r < 0.55) {
      const h = Math.max(0.5, H * (0.8 + rand() * 0.5));
      const half = (x1 - x0 - 0.12) / 2;
      slab(x0 + 0.04, 0, z0 + 0.06, half - 0.02, h, z1 - z0 - 0.12, { win: 0.25 });
      slab(x0 + 0.08 + half, 0, z0 + 0.06, half - 0.02, h * (0.7 + rand() * 0.6), z1 - z0 - 0.12, { win: 0.25 });
    } else slab(x0 + 0.06, 0, z0 + 0.06, x1 - x0 - 0.12, Math.max(0.5, H), z1 - z0 - 0.12, { win: 0.25 });
  };

  /** Long low shed with a pitched roof. */
  const shed = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    shells.box(x0, 0, z0, x1 - x0, h, z1 - z0);
    fillBoxes.push(x0, 0, z0, x1 - x0, h, z1 - z0);
    gable(x0, h, z0, x1 - x0, z1 - z0, 0.09);
    const n = Math.max(1, Math.round((Math.max(x1 - x0, z1 - z0) - 0.2) / 0.3));
    for (let k = 1; k < n; k++) {
      const u = k / n;
      if (x1 - x0 >= z1 - z0) facade.seg(x0 + (x1 - x0) * u, 0, z1, x0 + (x1 - x0) * u, h, z1);
      else facade.seg(x1, 0, z0 + (z1 - z0) * u, x1, h, z0 + (z1 - z0) * u);
    }
  };

  const tank = (cx: number, cz: number, r: number, h: number) => {
    fillCyl.push(cx, 0, cz, r, r, h);
    shells.circle(cx, 0, cz, r, 18).circle(cx, h, cz, r, 18).circle(cx, h + 0.03, cz, r * 0.8, 14);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.4;
      shells.seg(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r, cx + Math.cos(a) * r, h, cz + Math.sin(a) * r);
    }
    for (let y = 0.12; y < h; y += 0.12) facade.circle(cx, y, cz, r, 14);
  };

  const stack = (cx: number, cz: number, h: number) => {
    const r = 0.07;
    sil.seg(cx - r, 0, cz, cx - r * 0.7, h, cz).seg(cx + r, 0, cz, cx + r * 0.7, h, cz);
    for (const f of [0.55, 0.7, 0.85, 1]) shells.circle(cx, h * f, cz, r * (1 - 0.3 * f), 8);
    beacon(cx, h + 0.03, cz);
  };

  const treeAt = (x: number, z: number, h: number) => {
    if (rand() < 0.6) {
      const r = h * 0.3;
      treeL.seg(x, 0, z, x, h * 0.55, z).circle(x, h * 0.78, z, r, 8);
      vring(treeL, x, h * 0.78, z, r, 8);
    } else {
      const r = h * 0.26;
      treeL.circle(x, h * 0.22, z, r, 7).circle(x, h * 0.5, z, r * 0.65, 6);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        treeL.seg(x + Math.cos(a) * r, h * 0.22, z + Math.sin(a) * r, x, h, z);
      }
    }
  };

  // ---------- landmarks ----------
  /** CENTRO: tapering tower with setbacks, a crown and a spire. */
  const centro = (x0: number, z0: number, x1: number, z1: number) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    slab(cx - 0.6, 0, cz - 0.6, 1.2, 0.5, 1.2, { win: 0.14, floors: false });
    const tiers = [
      [0.98, 0.5, 3.7],
      [0.8, 3.7, 6.7],
      [0.62, 6.7, 9.1],
      [0.4, 9.1, 10.5],
    ];
    for (const [w, ya, yb] of tiers) slab(cx - w / 2, ya, cz - w / 2, w, yb - ya, w, { sil: true, win: 0.2 });
    for (const [rr, yy] of [[0.25, 10.5], [0.18, 10.9], [0.12, 11.3]]) shells.circle(cx, yy, cz, rr, 12);
    sil.seg(cx, 10.5, cz, cx, 12.7, cz);
    beacon(cx, 12.7, cz);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sil.seg(cx + sx * 0.2, 10.5, cz + sz * 0.2, cx, 11.5, cz);
  };

  /** Twin towers joined by a sky bridge across the avenue. */
  const twins = (a: number[], b: number[]) => {
    for (const [x0, z0, x1, z1] of [a, b]) {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = Math.min(x1 - x0, z1 - z0) - 0.12;
      slab(cx - w / 2 - 0.03, 0, cz - w / 2 - 0.03, w + 0.06, 0.4, w + 0.06, { win: 0.1, floors: false });
      slab(cx - w / 2, 0.4, cz - w / 2, w, 6.8, w, { sil: true, win: 0.22 });
      slab(cx - w * 0.3, 7.2, cz - w * 0.3, w * 0.6, 0.7, w * 0.6, { sil: true, win: 0.2 });
      sil.seg(cx, 7.9, cz, cx, 9, cz);
      beacon(cx, 9, cz);
    }
    const xa = a[2] - 0.08;
    const xb = b[0] + 0.08;
    const zc = (a[1] + a[3]) / 2;
    for (const y of [5.15, 5.6]) sil.seg(xa, y, zc - 0.13, xb, y, zc - 0.13).seg(xa, y, zc + 0.13, xb, y, zc + 0.13);
    shells.box(xa, 5.15, zc - 0.13, xb - xa, 0.45, 0.26);
    for (let k = 0; k <= 4; k++) {
      const x = xa + ((xb - xa) * k) / 4;
      facade.seg(x, 5.15, zc - 0.13, x, 5.6, zc - 0.13).seg(x, 5.15, zc + 0.13, x, 5.6, zc + 0.13);
    }
  };

  /** Stepped art-deco tower with a pointed crown. */
  const deco = (x0: number, z0: number, x1: number, z1: number) => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w0 = Math.min(x1 - x0, z1 - z0) - 0.1;
    const steps = [
      [1, 0, 2.6],
      [0.82, 2.6, 4.4],
      [0.64, 4.4, 6],
      [0.46, 6, 7.3],
      [0.3, 7.3, 8.2],
    ];
    for (const [f, ya, yb] of steps) slab(cx - (w0 * f) / 2, ya, cz - (w0 * f) / 2, w0 * f, yb - ya, w0 * f, { sil: true, win: 0.2 });
    const wt = w0 * 0.3;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sil.seg(cx + (sx * wt) / 2, 8.2, cz + (sz * wt) / 2, cx, 9.2, cz);
    sil.seg(cx, 9.2, cz, cx, 10, cz);
    beacon(cx, 10, cz);
  };

  /** Round glass tower with a domed top. */
  const roundTower = (cx: number, cz: number, r: number, h: number) => {
    fillCyl.push(cx, 0, cz, r, r, h);
    for (let y = G; y < h; y += G) facade.circle(cx, y, cz, r, 14);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      (k % 2 ? facade : sil).seg(x, 0, z, x, h, z);
      for (let y = G * 0.5; y < h; y += G) {
        if (rand() < 0.18 * (0.5 + D * 0.5)) {
          const t = a + TAU / n / 2;
          const x2 = cx + Math.cos(t) * r * 1.004;
          const z2 = cz + Math.sin(t) * r * 1.004;
          const tx = -Math.sin(t) * 0.04;
          const tz = Math.cos(t) * 0.04;
          pickWin().seg(x2 - tx, y, z2 - tz, x2 + tx, y, z2 + tz);
        }
      }
    }
    sil.circle(cx, h, cz, r, 18);
    for (const zy of [false, true]) {
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        const o = Math.cos(a) * r;
        const x = zy ? cx : cx + o;
        const z = zy ? cz + o : cz;
        const y = h + Math.sin(a) * r * 0.5;
        if (i > 0) sil.seg(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
      }
      px = 0;
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        const o = -Math.cos(a) * r;
        const x = zy ? cx : cx + o;
        const z = zy ? cz + o : cz;
        const y = h + Math.sin(a) * r * 0.5;
        if (i > 0) sil.seg(px, py, pz, x, y, z);
        px = x;
        py = y;
        pz = z;
      }
    }
    sil.seg(cx, h + r * 0.5, cz, cx, h + r * 0.5 + 0.9, cz);
    beacon(cx, h + r * 0.5 + 0.9, cz);
  };

  /** TV tower: tripod base, shaft, two pods, antenna. */
  const tvTower = (cx: number, cz: number) => {
    const b = 0.5;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) sil.seg(cx + sx * b, 0, cz + sz * b, cx + sx * 0.09, 2.7, cz + sz * 0.09);
    shells.rect(cx - b, 0.01, cz - b, cx + b, cz + b);
    for (const y of [0.7, 1.4, 2.1]) {
      const k = b - ((b - 0.09) * y) / 2.7;
      shells.rect(cx - k, y, cz - k, cx + k, cz + k);
    }
    sil.seg(cx - 0.09, 2.7, cz, cx - 0.07, 5.5, cz).seg(cx + 0.09, 2.7, cz, cx + 0.07, 5.5, cz).seg(cx, 2.7, cz - 0.09, cx, 5.5, cz - 0.07).seg(cx, 2.7, cz + 0.09, cx, 5.5, cz + 0.07);
    for (let y = 2.8; y < 5.5; y += 0.3) facade.circle(cx, y, cz, 0.08, 8);
    const pod = (y: number, r: number) => {
      for (const dy of [-0.55, -0.3, 0, 0.3, 0.55]) shells.circle(cx, y + dy * r, cz, r * Math.sqrt(1 - dy * dy), 16);
      sil.circle(cx, y, cz, r, 20);
      vring(shells, cx, y, cz, r, 16);
      vring(shells, cx, y, cz, r, 16, true);
      fillCyl.push(cx, y - r * 0.4, cz, r * 0.95, r * 0.95, r * 0.8);
      lit(cx - r * 0.7, y - r * 0.3, cz - r * 0.7, r * 1.4, r * 0.6, r * 1.4, 0.5);
    };
    pod(5.9, 0.36);
    sil.seg(cx, 6.3, cz, cx, 7.8, cz);
    pod(8.1, 0.2);
    sil.seg(cx, 8.3, cz, cx, 10.6, cz);
    beacon(cx, 10.6, cz);
  };

  // ---------- districts: one pass over the street grid ----------
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= NI; i++) xs.push(X0 + CELL * i);
  for (let j = 0; j <= NJ; j++) zs.push(Z0 + CELL * j);
  const isAve = (v: number, list: number[]) => list.some((a) => Math.abs(a - v) < 1e-6);
  const gapOf = (v: number, list: number[]) => (isAve(v, list) ? AGAP : GAP);

  const special = new Map<string, (x0: number, z0: number, x1: number, z1: number) => void>();
  const cellBox = new Map<string, number[]>();
  const rt = (cx: number, cz: number, r: number, h: number) => () => roundTower(cx, cz, r, h);
  const CENTRO_CELL = key(6, 6);
  const TWIN_A = key(4, 8);
  const TWIN_B = key(5, 8);
  special.set(CENTRO_CELL, centro);
  special.set(key(6, 4), deco);
  special.set(key(4, 5), rt(-8.3, -5.3, 0.48, 7.4));
  special.set(key(14, 16), (x0, z0, x1, z1) => tvTower((x0 + x1) / 2, (z0 + z1) / 2));
  special.set(TWIN_A, () => undefined); // the twins are built after the pass, once both lots are known
  special.set(TWIN_B, () => undefined);
  const anchors = { centro: [0, 0, 0] };

  for (let i = 0; i < NI; i++)
    for (let j = 0; j < NJ; j++) {
      let x0 = xs[i] + gapOf(xs[i], AVE_X) / 2;
      let x1 = xs[i + 1] - gapOf(xs[i + 1], AVE_X) / 2;
      const z0 = zs[j] + gapOf(zs[j], AVE_Z) / 2;
      const z1 = zs[j + 1] - gapOf(zs[j + 1], AVE_Z) / 2;
      let cx = (x0 + x1) / 2;
      let cz = (z0 + z1) / 2;
      if ((cx / (OA - 0.4)) ** 2 + (cz / (OB - 0.4)) ** 2 > 1) continue;
      const q = Math.hypot(cx / CA, cz / CB);
      // suburbs: thinner and lower the farther from the ring; some lots become small groves
      const suburb = q > 1.03;
      if (suburb && rand() < ss(1.0, 1.55, q) * 0.85) {
        if (rand() < 0.3) for (let k = 0; k < 4; k++) treeAt(x0 + 0.2 + rand() * (x1 - x0 - 0.4), z0 + 0.2 + rand() * (z1 - z0 - 0.4), 0.3);
        continue;
      }
      // flush against the quay on either bank
      const rb = (z: number) => riverHW(z) + 0.4;
      if (cx < riverX(cz)) x1 = Math.min(x1, riverX(z0) - rb(z0), riverX(z1) - rb(z1));
      else x0 = Math.max(x0, riverX(z0) + rb(z0), riverX(z1) + rb(z1));
      if (x1 - x0 < 0.5) continue;
      cx = (x0 + x1) / 2;
      const ck = `${i},${j}`;
      if (ck === TARGET_CELL) {
        ground.rect(x0, 0.004, z0, x1, z1);
        continue;
      }
      if (inStadium(cx, cz, 0.35) || inPark(cx, cz) || inPort(cx, cz)) continue;
      ground.rect(x0, 0.004, z0, x1, z1);
      cellBox.set(ck, [x0, z0, x1, z1]);
      const sp = special.get(ck);
      if (sp) {
        sp(x0, z0, x1, z1);
        if (ck === CENTRO_CELL) anchors.centro = [cx, 13.4, cz];
        continue;
      }
      const dd = Math.hypot((cx + 5.8) * 0.85, cz + 3.8);
      const de = Math.hypot((cx - 6.6) * 0.9, (cz - 5.2) * 0.9);
      const core = 9.4 * Math.exp(-((dd / 4) ** 2)) + 4.4 * Math.exp(-((de / 2.8) ** 2));
      const industrial = cx > 7.4 && cz < 1;
      const bh = industrial ? 0.2 + rand() * 0.2 : suburb ? 0.2 + rand() * 0.3 : Math.max(0.32 + rand() * 0.5, core * (0.5 + rand() * 0.65));
      if (industrial) {
        const r = rand();
        if (r < 0.4) {
          shed(x0 + 0.06, z0 + 0.06, x1 - 0.06, (z0 + z1) / 2 - 0.03, bh + 0.05);
          shed(x0 + 0.06, (z0 + z1) / 2 + 0.03, x1 - 0.06, z1 - 0.06, bh);
        } else if (r < 0.62) {
          for (const [a, b] of [[0.28, 0.28], [0.72, 0.28], [0.5, 0.74]]) tank(x0 + (x1 - x0) * a, z0 + (z1 - z0) * b, 0.24, 0.3 + rand() * 0.18);
          ground.seg(x0 + 0.3, 0.1, z0 + 0.35, x1 - 0.3, 0.1, z0 + 0.35);
        } else if (r < 0.8) {
          shed(x0 + 0.08, z0 + 0.5, x1 - 0.08, z1 - 0.08, 0.35);
          stack(x0 + 0.3, z0 + 0.26, 1.9 + rand() * 0.6);
        } else lowBlock(x0, z0, x1, z1, bh);
      } else if (core > 1.5 && rand() < 0.06) {
        // plaza with a fountain and trees
        ground.circle(cx, 0.01, cz, 0.3, 20).circle(cx, 0.01, cz, 0.18, 14);
        for (let k = 0; k < 5; k++) treeAt(x0 + 0.15 + rand() * (x1 - x0 - 0.3), z0 + 0.15 + rand() * (z1 - z0 - 0.3), 0.3);
      } else if (bh >= 3) tower(x0, z0, x1, z1, bh);
      else if (bh >= 1.1) mid(x0, z0, x1, z1, bh);
      else lowBlock(x0, z0, x1, z1, bh);
    }
  // the twins sit on two cells; build them once both boxes are known
  twins(cellBox.get(TWIN_A)!, cellBox.get(TWIN_B)!);

  // ---------- roads: avenues, streets, lanes ----------
  const laneA: number[] = [];
  const laneB: number[] = [];
  const laneC: number[] = [];
  /** One-way lane from p0 to p1 with `n` cars. */
  const lane = (p0: number[], p1: number[], n: number, v: number, size = 2) => {
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.4 || n < 1) return;
    for (let k = 0; k < n; k++) {
      laneA.push(p0[0], p0[1], p0[2], len);
      laneB.push(dx / len, dz / len, ((v * (0.75 + rand() * 0.5)) / len) * mo, rand());
      laneC.push(dy / len, size, 0, 0);
    }
  };

  const blocked = (horiz: boolean, c: number, ave: boolean, u: number) => {
    const x = horiz ? u : c;
    const z = horiz ? c : u;
    if ((x / (OA - 0.3)) ** 2 + (z / (OB - 0.3)) ** 2 > 1) return true;
    const bridged = horiz && ave && (c === -4.5 || c === 7.5);
    if (Math.abs(x - riverX(z)) < riverHW(z) + (bridged ? 2.2 : 0.2)) return true;
    if (!ave && inStadium(x, z, 0.45)) return true;
    if (inPark(x, z) && !(horiz && ave)) return true;
    return inPort(x, z);
  };

  const road = (horiz: boolean, c: number, a: number, b: number, ave: boolean) => {
    const pt = (u: number, y = 0): number[] => (horiz ? [u, y, c] : [c, y, u]);
    if (ave) {
      const p = pt(a);
      const q = pt(b);
      roadS.seg(p[0], 0.01, p[2], q[0], 0.01, q[2]);
    } else {
      for (let u = a; u < b - 0.1; u += 0.36) {
        const p = pt(u);
        const q = pt(Math.min(b, u + 0.12));
        ground.seg(p[0], 0.01, p[2], q[0], 0.01, q[2]);
      }
    }
    // traffic and lamps only inside the ring road
    const half = horiz ? ellX(c, RA, RB) : ellX(c, RB, RA);
    const ia = Math.max(a, -half);
    const ib = Math.min(b, half);
    if (ib - ia < 0.5) return;
    const len = ib - ia;
    const offs = ave ? [-0.2, -0.1, 0.1, 0.2] : [-0.06, 0.06];
    for (const o of offs) {
      const dir = o > 0 ? 1 : -1;
      const s = dir > 0 ? ia : ib;
      const e = dir > 0 ? ib : ia;
      const p0 = horiz ? [s, 0.02, c + o] : [c + o, 0.02, s];
      const p1 = horiz ? [e, 0.02, c + o] : [c + o, 0.02, e];
      lane(p0, p1, Math.round(len * (ave ? 1 : 0.7) * D), ave ? 1.5 : 0.85, ave ? 2.3 : 2);
    }
    // street lamps along the kerb
    const step = ave ? 0.45 : 0.7;
    for (let u = ia + 0.2; u < ib - 0.1; u += step) {
      if (ave) for (const o of [-0.36, 0.36]) lamp(horiz ? u : c + o, 0.11, horiz ? c + o : u, 1.5, 0.35);
      else if (rand() < 0.95 * (0.4 + D * 0.6)) {
        const o = rand() < 0.5 ? -0.17 : 0.17;
        lamp(horiz ? u : c + o, 0.09, horiz ? c + o : u, 1.3, 0.3);
      }
    }
  };

  for (const horiz of [false, true]) {
    const lines = horiz ? zs : xs;
    const list = horiz ? AVE_Z : AVE_X;
    const lim = horiz ? OA : OB;
    for (const c of lines) {
      const ave = isAve(c, list);
      let start: number | null = null;
      for (let u = -lim; u <= lim + 1e-6; u += 0.2) {
        const bl = blocked(horiz, c, ave, u);
        if (!bl && start === null) start = u;
        if (start !== null && (bl || u + 0.2 > lim)) {
          const end = bl ? u - 0.2 : u;
          if (end - start > 0.7) road(horiz, c, start, end, ave);
          start = null;
        }
      }
    }
  }

  // ---------- river ----------
  const zr0 = -22;
  const zr1 = 20;
  for (const s of [-1, 1]) {
    const bank: number[][] = [];
    const quay: number[][] = [];
    for (let z = zr0; z <= zr1 + 1e-6; z += 0.4) {
      bank.push([riverX(z) + s * riverHW(z), 0, z]);
      quay.push([riverX(z) + s * (riverHW(z) + 0.38), 0.005, z]);
    }
    poly(roadS, bank);
    poly(ground, quay);
    for (let z = zr0; z < zr1; z += 0.7) lamp(riverX(z) + s * (riverHW(z) + 0.55), 0.1, z, 1.4, 0.3);
  }
  // flow lines in dashes, plus a far stretch that is not sampled
  for (let k = -6; k <= 6; k++) {
    const t = k / 6.6;
    let z = zr0 + rand() * 0.6;
    while (z < zr1) {
      const z2 = z + 0.4 + rand() * 0.4;
      const a = [riverX(z) + t * riverHW(z), 0.01, z];
      const b = [riverX((z + z2) / 2) + t * riverHW((z + z2) / 2), 0.01, (z + z2) / 2];
      const c = [riverX(z2) + t * riverHW(z2), 0.01, z2];
      poly(waterT, [a, b, c]);
      z = z2 + 0.25 + rand() * 0.35;
    }
  }
  for (const s of [-1, 1]) {
    const pts: number[][] = [];
    for (let z = zr0; z >= -52; z -= 0.8) pts.push([riverX(z) + s * riverHW(z), 0, z]);
    poly(far, pts);
    const pts2: number[][] = [];
    for (let z = zr1; z <= 27; z += 0.8) pts2.push([riverX(z) + s * riverHW(z), 0, z]);
    poly(far, pts2);
  }
  for (let z = -24; z > -52; z -= 1.5)
    for (let k = 0; k < 5 + (-z - 24) * 0.12; k++) {
      const t = (rand() * 2 - 1) * 0.92;
      const x = riverX(z) + t * riverHW(z);
      far.seg(x, 0.01, z, x + 0.6 + rand() * 1.4, 0.01, z);
    }
  // reflected skyline glitter and a bay lighthouse are sprites below

  // ---------- bridges ----------
  /** Deck height along a bridge: flat over the river, ramping to the street. */
  const ramped = (x: number, a: number, b: number, yD: number, len: number) => yD * Math.max(0, Math.min(1, (x - (a - len)) / (len * 0.85), (b + len - x) / (len * 0.85)));

  /** Lanes along a polyline deck, both ways. */
  const deckLanes = (p: number[][], offs: number[], v: number) => {
    for (let i = 0; i + 1 < p.length; i++)
      for (const o of offs) {
        const fwd = o > 0;
        const a = fwd ? p[i] : p[i + 1];
        const b = fwd ? p[i + 1] : p[i];
        lane([a[0], a[1] + 0.03, a[2] + o], [b[0], b[1] + 0.03, b[2] + o], Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.6 * D)), v, 2.2);
      }
  };

  // B1: suspension bridge (z = 7.5), seen in profile from the arrival view
  {
    const zc = 7.5;
    const rx = riverX(zc);
    const hw = riverHW(zc);
    const xA = rx - hw - 0.35;
    const xB = rx + hw + 0.35;
    const yD = 0.5;
    const hT = 3.5;
    const dz = 0.26;
    const deck: number[][] = [];
    for (let x = xA - 2.2; x <= xB + 2.2 + 1e-6; x += 0.2) deck.push([x, ramped(x, xA - 0.3, xB + 0.3, yD, 1.9), zc]);
    for (const s of [-1, 1]) {
      poly(hwS, deck.map((p) => [p[0], p[1], zc + s * dz]));
      poly(bridgeT, deck.map((p) => [p[0], p[1] + 0.1, zc + s * (dz + 0.02)]));
    }
    for (const p of deck) bridgeT.seg(p[0], p[1], zc - dz, p[0], p[1], zc + dz);
    deckLanes([xA - 2.2, xA - 0.3, xB + 0.3, xB + 2.2].map((x) => [x, ramped(x, xA - 0.3, xB + 0.3, yD, 1.9), zc]), [-0.1, 0.1], 1.4);
    const xm = (xA + xB) / 2;
    const half = (xB - xA) / 2;
    for (const x of [xA, xB]) {
      for (const s of [-1, 1]) hwS.seg(x, 0, zc + s * dz, x, hT, zc + s * dz);
      for (const y of [hT, hT * 0.72, hT * 0.42]) hwS.seg(x, y, zc - dz, x, y, zc + dz);
      bridgeT.seg(x, hT * 0.72, zc - dz, x, hT, zc + dz).seg(x, hT * 0.72, zc + dz, x, hT, zc - dz);
      beacon(x, hT + 0.1, zc - dz);
      beacon(x, hT + 0.1, zc + dz);
    }
    for (const s of [-1, 1]) {
      const zz = zc + s * dz;
      const cable: number[][] = [];
      for (let k = 0; k <= 30; k++) {
        const x = xA + ((xB - xA) * k) / 30;
        cable.push([x, 0.8 + (hT - 0.8) * ((x - xm) / half) ** 2, zz]);
      }
      poly(hwS, cable);
      for (let x = xA + 0.22; x < xB - 0.1; x += 0.22) bridgeT.seg(x, 0.8 + (hT - 0.8) * ((x - xm) / half) ** 2, zz, x, yD + 0.04, zz);
      for (const e of [-1, 1]) {
        const xt = e < 0 ? xA : xB;
        const xa = xt + e * 2;
        hwS.seg(xt, hT, zz, xa, 0.5, zz);
        for (let k = 1; k < 8; k++) {
          const x = xt + e * (k * 0.25);
          const y = hT + (0.5 - hT) * ((k * 0.25) / 2);
          bridgeT.seg(x, y, zz, x, ramped(x, xA - 0.3, xB + 0.3, yD, 1.9) + 0.04, zz);
        }
      }
    }
    for (let x = xA - 2; x <= xB + 2; x += 0.4) for (const s of [-1, 1]) lamp(x, ramped(x, xA - 0.3, xB + 0.3, yD, 1.9) + 0.14, zc + s * (dz + 0.04), 1.5, 0.2);
  }

  // B2: through-arch bridge (z = -4.5)
  {
    const zc = -4.5;
    const rx = riverX(zc);
    const hw = riverHW(zc);
    const xL = rx - hw - 0.1;
    const xR = rx + hw + 0.1;
    const yD = 0.4;
    const hA = 1.9;
    const dz = 0.25;
    const xm = (xL + xR) / 2;
    const half = (xR - xL) / 2;
    const deck: number[][] = [];
    for (let x = xL - 2; x <= xR + 2 + 1e-6; x += 0.2) deck.push([x, ramped(x, xL, xR, yD, 1.9), zc]);
    for (const s of [-1, 1]) {
      poly(hwS, deck.map((p) => [p[0], p[1], zc + s * dz]));
      const arch: number[][] = [];
      for (let k = 0; k <= 30; k++) {
        const x = xL + ((xR - xL) * k) / 30;
        arch.push([x, yD + hA * (1 - ((x - xm) / half) ** 2), zc + s * dz]);
      }
      poly(hwS, arch);
      for (let x = xL + 0.2; x < xR - 0.1; x += 0.2) bridgeT.seg(x, yD + hA * (1 - ((x - xm) / half) ** 2), zc + s * dz, x, yD, zc + s * dz);
    }
    for (let x = xL + 0.4; x < xR - 0.2; x += 0.4) {
      const y = yD + hA * (1 - ((x - xm) / half) ** 2);
      bridgeT.seg(x, y, zc - dz, x, y, zc + dz);
      const x2 = x + 0.4;
      const y2 = yD + hA * (1 - ((x2 - xm) / half) ** 2);
      if (x2 < xR - 0.2) bridgeT.seg(x, y, zc - dz, x2, y2, zc + dz);
    }
    for (const p of deck) bridgeT.seg(p[0], p[1], zc - dz, p[0], p[1], zc + dz);
    deckLanes([xL - 2, xL, xR, xR + 2].map((x) => [x, ramped(x, xL, xR, yD, 1.9), zc]), [-0.1, 0.1], 1.4);
    for (let x = xL - 2; x <= xR + 2; x += 0.4) for (const s of [-1, 1]) lamp(x, ramped(x, xL, xR, yD, 1.9) + 0.14, zc + s * (dz + 0.04), 1.5, 0.2);
  }

  // B3: cable-stayed ring-highway bridge over the bay mouth (far end), and a girder bridge at the near end
  const ringPt = (a: number, off = 0, y = 0.4): number[] => [(RA + off) * Math.cos(a), y, (RB + off) * Math.sin(a)];
  {
    let xp = -1.7;
    let zp = -ellX(xp, RB, RA);
    for (let k = 0; k < 6; k++) {
      xp = riverX(zp);
      zp = -RB * Math.sqrt(Math.max(0, 1 - (xp / RA) ** 2));
    }
    const dz = 0.3;
    for (const s of [-1, 1]) {
      hwS.seg(xp, 0, zp + s * dz, xp, 4, zp + s * dz);
      beacon(xp, 4.08, zp + s * dz);
    }
    for (const y of [4, 3.1, 2.2]) hwS.seg(xp, y, zp - dz, xp, y, zp + dz);
    for (let k = 1; k <= 6; k++) {
      const ya = 2.4 + k * 0.25;
      for (const e of [-1, 1]) {
        const xi = xp + e * k * 0.55;
        const zi = -RB * Math.sqrt(Math.max(0, 1 - (xi / RA) ** 2));
        for (const s of [-1, 1]) bridgeT.seg(xp, ya, zp + s * dz, xi, 0.42, zi + s * 0.17);
      }
    }
  }

  // ---------- ring highway ----------
  {
    const nR = 200;
    for (const off of [-0.17, 0.17]) {
      const pts: number[][] = [];
      for (let k = 0; k <= nR; k++) pts.push(ringPt((k / nR) * TAU, off));
      poly(hwS, pts);
    }
    for (let k = 0; k < nR; k += 2) {
      const p = ringPt((k / nR) * TAU);
      const q = ringPt(((k + 1) / nR) * TAU);
      ground.seg(p[0], 0.41, p[2], q[0], 0.41, q[2]);
    }
    // piers, lamps
    for (let a = 0; a < TAU; a += 0.065) {
      const p = ringPt(a);
      bridgeT.seg(p[0], 0, p[2], p[0], 0.36, p[2]);
      bridgeT.seg(p[0] - 0.14, 0.36, p[2], p[0] + 0.14, 0.36, p[2]);
      for (const off of [-0.2, 0.2]) {
        const q = ringPt(a, off);
        lamp(q[0], 0.5, q[2], 1.5, 0.3);
      }
    }
  }
  // interchange loops where the east and west avenue meets the ring
  for (const sx of [-1, 1]) {
    const ex = sx * ellX(7.5, RA, RB);
    for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) ground.circle(ex + ox * 0.85, 0.2, 7.5 + oz, 0.55, 18);
  }

  // ---------- rail viaduct (z = RAIL_Z) with a truss bridge and two stations ----------
  {
    const yV = 0.75;
    const L = 17.8;
    for (const o of [-0.12, 0.12]) hwS.seg(-L, yV, RAIL_Z + o, L, yV, RAIL_Z + o);
    for (const o of [-0.22, 0.22]) bridgeT.seg(-L, yV - 0.06, RAIL_Z + o, L, yV - 0.06, RAIL_Z + o);
    const rx = riverX(RAIL_Z);
    const hw = riverHW(RAIL_Z);
    const xa = rx - hw - 0.35;
    const xb = rx + hw + 0.35;
    for (let x = -L; x <= L; x += 0.5) if (x < xa - 0.2 || x > xb + 0.2) bridgeT.seg(x, yV - 0.06, RAIL_Z - 0.22, x, yV - 0.06, RAIL_Z + 0.22);
    for (let x = -16.8; x <= 16.8; x += 1.2) {
      if (x > xa - 0.3 && x < xb + 0.3) continue;
      bridgeT.seg(x, 0, RAIL_Z, x, yV - 0.08, RAIL_Z).seg(x, yV - 0.08, RAIL_Z - 0.22, x, yV - 0.08, RAIL_Z + 0.22);
    }
    // Pratt truss over the river
    const n = 10;
    const hT = 0.75;
    for (const s of [-1, 1]) {
      const zz = RAIL_Z + s * 0.27;
      hwS.seg(xa, yV, zz, xb, yV, zz).seg(xa, yV + hT, zz, xb, yV + hT, zz);
      for (let k = 0; k <= n; k++) {
        const x = xa + ((xb - xa) * k) / n;
        bridgeT.seg(x, yV, zz, x, yV + hT, zz);
        if (k < n) {
          const x2 = xa + ((xb - xa) * (k + 1)) / n;
          if (k < n / 2) bridgeT.seg(x, yV, zz, x2, yV + hT, zz);
          else bridgeT.seg(x, yV + hT, zz, x2, yV, zz);
        }
      }
    }
    for (let k = 0; k <= n; k++) {
      const x = xa + ((xb - xa) * k) / n;
      bridgeT.seg(x, yV + hT, RAIL_Z - 0.27, x, yV + hT, RAIL_Z + 0.27);
    }
    for (const x of [xa, xb]) bridgeT.seg(x, 0, RAIL_Z - 0.27, x, yV, RAIL_Z - 0.27).seg(x, 0, RAIL_Z + 0.27, x, yV, RAIL_Z + 0.27);
    // stations
    for (const sx of [-5.6, 7]) {
      shells.box(sx, yV - 0.02, RAIL_Z - 0.36, 1.6, 0.1, 0.72);
      shells.rect(sx - 0.05, yV + 0.45, RAIL_Z - 0.4, sx + 1.65, RAIL_Z + 0.4);
      for (const px of [sx + 0.05, sx + 1.55]) for (const pz of [-0.34, 0.34]) shells.seg(px, yV + 0.08, RAIL_Z + pz, px, yV + 0.45, RAIL_Z + pz);
      fillBoxes.push(sx - 0.05, yV + 0.43, RAIL_Z - 0.4, 1.7, 0.04, 0.8);
      for (let k = 0; k < 5; k++) lamp(sx + 0.2 + k * 0.3, yV + 0.4, RAIL_Z, 1.8, 0.6);
    }
  }

  // ---------- port: quay, container yard, cranes, a ship, warehouses ----------
  {
    const xq = (z: number) => riverX(z) + riverHW(z) + 0.3;
    const rails: number[][][] = [[], []];
    for (let z = -12.95; z <= -5.7; z += 0.4) {
      rails[0].push([xq(z) + 0.12, 0.01, z]);
      rails[1].push([xq(z) + 0.82, 0.01, z]);
    }
    for (const r of rails) poly(ground, r);
    // containers: rows along x, an aisle every fourth row
    for (let k = 0, z = -12.5; z < -6.1; z += 0.44, k++) {
      if (k % 4 === 3) continue;
      let x = xq(z) + 1.15;
      const xe = portXE(z) - 1.3;
      while (x < xe - 0.4) {
        const len = Math.min(xe - x, 0.7 + rand() * 0.9);
        const n = 1 + Math.floor(rand() * 4);
        const hh = n * 0.17;
        shells.box(x, 0, z - 0.16, len, hh, 0.32);
        fillBoxes.push(x, 0, z - 0.16, len, hh, 0.32);
        for (let l = 1; l < n; l++) facade.rect(x, l * 0.17, z - 0.16, x + len, z + 0.16);
        for (let u = 0.25; u < len - 0.05; u += 0.25) facade.seg(x + u, hh, z - 0.16, x + u, hh, z + 0.16);
        x += len + 0.18;
      }
    }
    // warehouses on the landward edge
    for (const zc of [-7.1, -9.3, -11.4]) {
      const xe = portXE(zc);
      shed(xe - 1.2, zc - 0.8, xe - 0.1, zc + 0.8, 0.3);
    }
    // gate office and floodlight masts
    shells.box(portXE(-6.2) - 1.6, 0, -6.1, 0.5, 0.45, 0.35);
    for (const [fx, fz] of [[3.3, -7.7], [3.6, -10.3], [2.8, -12.2]]) {
      sil.seg(fx, 0, fz, fx, 2.2, fz);
      lamp(fx, 2.25, fz, 9, 0.1);
      lamp(fx + 0.1, 2.2, fz, 5, 0.1);
    }
    // ship-to-shore cranes
    for (let k = 0; k < 6; k++) {
      const zc = -6.95 - k * 0.95;
      const x = xq(zc);
      const xw = x + 0.12;
      const xl = x + 0.82;
      const h1 = 1.35;
      const zw = 0.22;
      for (const xx of [xw, xl]) for (const s of [-1, 1]) sil.seg(xx, 0, zc + s * zw, xx, h1, zc + s * zw);
      for (const s of [-1, 1]) sil.seg(xw, h1, zc + s * zw, xl, h1, zc + s * zw);
      for (const xx of [xw, xl]) {
        sil.seg(xx, h1, zc - zw, xx, h1, zc + zw);
        shells.seg(xx, 0, zc - zw, xx, h1, zc + zw).seg(xx, 0, zc + zw, xx, h1, zc - zw);
      }
      shells.box(xl - 0.28, h1, zc - 0.17, 0.5, 0.28, 0.34);
      const y0 = h1 + 0.28;
      const raised = k % 3 === 1;
      const tipX = raised ? xw - 1.1 : xw - 2.1;
      const tipY = raised ? y0 + 1.15 : y0 + 0.05;
      const backX = xl + 0.62;
      const apex = [xl - 0.04, y0 + 0.95, zc];
      for (const s of [-1, 1]) {
        const zz = zc + s * 0.07;
        sil.seg(backX, y0, zz, xw + 0.05, y0, zz).seg(xw + 0.05, y0, zz, tipX, tipY, zz);
        sil.seg(backX, y0 + 0.1, zz, xw + 0.05, y0 + 0.1, zz).seg(xw + 0.05, y0 + 0.1, zz, tipX, tipY + 0.1, zz);
        sil.seg(xl, h1, zc + s * zw, apex[0], apex[1], zc);
      }
      sil.seg(apex[0], apex[1], zc, tipX, tipY + 0.1, zc).seg(apex[0], apex[1], zc, backX, y0 + 0.1, zc);
      const nb = 6;
      for (let q = 0; q <= nb; q++) {
        const u = q / nb;
        const bx = xw + 0.05 + (tipX - xw - 0.05) * u;
        const by = y0 + (tipY - y0) * u;
        facade.seg(bx, by, zc - 0.07, bx, by + 0.1, zc - 0.07).seg(bx, by, zc + 0.07, bx, by + 0.1, zc + 0.07).seg(bx, by + 0.05, zc - 0.07, bx, by + 0.05, zc + 0.07);
      }
      if (!raised) {
        const trx = xw - 0.9 - (k % 2) * 0.5;
        shells.box(trx - 0.05, y0 - 0.12, zc - 0.07, 0.1, 0.1, 0.14);
        shells.box(trx - 0.16, y0 - 0.52, zc - 0.07, 0.32, 0.18, 0.14);
        for (const dx of [-0.14, 0.14]) shells.seg(trx + dx, y0 - 0.34, zc, trx, y0 - 0.12, zc);
      }
      beacon(apex[0], apex[1] + 0.03, zc);
      beacon(tipX, tipY + 0.15, zc);
    }
    // a container ship alongside the quay, bow toward the bay
    {
      const zs0 = -8;
      const L = 3.5;
      const w = 0.32;
      const cxs = riverX(-9.7) + riverHW(-9.7) - w - 0.04;
      const hull = (y: number, f: number) => {
        const p: number[][] = [
          [cxs - w * f, y, zs0],
          [cxs + w * f, y, zs0],
          [cxs + w * f, y, zs0 - L * 0.7],
          [cxs, y, zs0 - L],
          [cxs - w * f, y, zs0 - L * 0.7],
          [cxs - w * f, y, zs0],
        ];
        poly(shells, p);
        return p;
      };
      const top = hull(0.2, 1);
      const bot = hull(0.02, 0.75);
      for (let q = 0; q < 5; q++) shells.seg(top[q][0], top[q][1], top[q][2], bot[q][0], bot[q][1], bot[q][2]);
      for (let u = 0.2; u < L * 0.7; u += 0.35) shells.seg(cxs - w, 0.2, zs0 - u, cxs - w * 0.75, 0.02, zs0 - u).seg(cxs + w, 0.2, zs0 - u, cxs + w * 0.75, 0.02, zs0 - u);
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 2; b++) {
          const h = (1 + Math.floor(rand() * 3)) * 0.14;
          const bx = cxs - w + 0.06 + b * (w - 0.04);
          const bz = zs0 - 0.75 - a * 0.7;
          shells.box(bx, 0.2, bz, w - 0.1, h, 0.62);
          fillBoxes.push(bx, 0.2, bz, w - 0.1, h, 0.62);
        }
      slab(cxs - w * 0.8, 0.2, zs0 - 0.5, w * 1.6, 0.65, 0.4, { win: 0.45, floors: false });
      slab(cxs - w * 0.3, 0.85, zs0 - 0.4, w * 0.6, 0.2, 0.2, { win: 0, floors: false, mull: false });
      sil.seg(cxs, 1.05, zs0 - 0.3, cxs, 1.35, zs0 - 0.3);
      beacon(cxs, 1.38, zs0 - 0.3);
      lamp(cxs, 0.24, zs0 - L, 2.4, 0.5);
    }
    shells.person(portXE(-6.5) - 2.1, 0, -6.4, 0.19, 1, 'walk');
    shells.person(portXE(-6.5) - 2, 0, -6.6, 0.19, 2.5, 'stand');
  }

  // ---------- stadium ----------
  {
    const ring = (s: number, y: number, n = 64) => ell(shells, SX, y, SZ, SRX * s, SRZ * s, n);
    for (const [s, y] of [[1, 0], [1, 0.58], [0.94, 0.5], [0.84, 0.4], [0.74, 0.28], [0.64, 0.14]]) ring(s, y);
    ell(sil, SX, 0.58, SZ, SRX, SRZ, 72);
    ell(sil, SX, 0.05, SZ, SRX, SRZ, 72);
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * TAU;
      shells.seg(SX + Math.cos(a) * SRX, 0, SZ + Math.sin(a) * SRZ, SX + Math.cos(a) * SRX, 0.58, SZ + Math.sin(a) * SRZ);
      facade.seg(SX + Math.cos(a) * SRX, 0.58, SZ + Math.sin(a) * SRZ, SX + Math.cos(a) * SRX * 0.64, 0.14, SZ + Math.sin(a) * SRZ * 0.64);
    }
    fillCyl.push(SX, 0, SZ, SRX, SRZ, 0.58);
    // roof truss ring
    ell(sil, SX, 0.95, SZ, SRX * 1.04, SRZ * 1.04, 72);
    ell(shells, SX, 0.85, SZ, SRX * 0.78, SRZ * 0.78, 56);
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * TAU;
      shells.seg(SX + Math.cos(a) * SRX * 1.04, 0.95, SZ + Math.sin(a) * SRZ * 1.04, SX + Math.cos(a) * SRX * 0.78, 0.85, SZ + Math.sin(a) * SRZ * 0.78);
      if (k % 4 === 0) shells.seg(SX + Math.cos(a) * SRX, 0.58, SZ + Math.sin(a) * SRZ, SX + Math.cos(a) * SRX * 1.04, 0.95, SZ + Math.sin(a) * SRZ * 1.04);
    }
    // pitch
    const pw = SRX * 0.46;
    const pd = SRZ * 0.42;
    ground.rect(SX - pw, 0.02, SZ - pd, SX + pw, SZ + pd);
    ground.seg(SX, 0.02, SZ - pd, SX, 0.02, SZ + pd).circle(SX, 0.02, SZ, 0.2, 20);
    for (const s of [-1, 1]) ground.rect(SX + s * pw, 0.02, SZ - 0.28, SX + s * (pw - 0.28), SZ + 0.28);
    // floodlight masts
    for (const [mx, mz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = SX + mx * SRX * 0.86;
      const z = SZ + mz * SRZ * 1.08;
      sil.seg(x, 0, z, x, 1.7, z);
      shells.rect(x - 0.12, 1.68, z - 0.04, x + 0.12, z + 0.04);
      lamp(x, 1.72, z, 11, 0.15);
      lamp(x - 0.08, 1.7, z, 5, 0.15);
      lamp(x + 0.08, 1.7, z, 5, 0.15);
    }
    // gate plaza and visitors
    ground.rect(SX - 0.6, 0.01, SZ + SRZ + 0.15, SX + 0.6, SZ + SRZ + 0.7);
    for (let k = 0; k < 4; k++) shells.person(SX - 0.45 + k * 0.3, 0, SZ + SRZ + 0.35 + (k % 2) * 0.12, 0.19, rand() * TAU, k % 2 ? 'walk' : 'stand');
  }

  // ---------- park ----------
  {
    const { x0, x1, z0, z1 } = PARK;
    ground.rect(x0 + 0.1, 0.006, z0 + 0.1, x1 - 0.1, z1 - 0.1);
    // mown stripes
    for (let z = z0 + 0.3; z < z1 - 0.2; z += 0.28) treeL.seg(x0 + 0.15, 0.003, z, x1 - 0.15, 0.003, z);
    // pond and island
    const px = -5.4;
    const pz = 9.7;
    for (const s of [1, 0.78, 0.56]) ell(waterT, px, 0.012, pz, 1.6 * s, 0.95 * s, 40);
    ell(ground, px, 0.02, pz, 1.7, 1.05, 40);
    ell(ground, px + 0.35, 0.03, pz - 0.1, 0.32, 0.2, 14);
    // paths that wind through
    const paths: [number, number, number, number][] = [
      [3.9, 0.5, 1.1, 0.6],
      [11.8, 0.6, 0.9, 2.1],
      [6.8, 0.4, 1.5, 3.4],
    ];
    const pathZ = (k: number, x: number) => paths[k][0] + paths[k][1] * Math.sin((x - x0) * paths[k][2] + paths[k][3]);
    const walkers: number[][] = [];
    paths.forEach((_, k) => {
      for (const o of [-0.06, 0.06]) {
        const pts: number[][] = [];
        for (let x = x0 + 0.1; x <= x1 - 0.1 + 1e-6; x += 0.2) pts.push([x, 0.012, pathZ(k, x) + o]);
        poly(ground, pts);
      }
      for (let x = x0 + 0.5; x < x1 - 0.4; x += 0.5) walkers.push([x, pathZ(k, x)]);
    });
    // bandstand
    ground.rect(-8.1, 0.01, 4.4, -7.4, 5.1);
    shells.box(-7.95, 0, 4.55, 0.4, 0.1, 0.4);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + 0.78;
      shells.seg(-7.75 + Math.cos(a) * 0.25, 0, 4.75 + Math.sin(a) * 0.25, -7.75 + Math.cos(a) * 0.25, 0.3, 4.75 + Math.sin(a) * 0.25);
      shells.seg(-7.75 + Math.cos(a) * 0.25, 0.3, 4.75 + Math.sin(a) * 0.25, -7.75, 0.5, 4.75);
    }
    // trees: denser at the edge, none in the pond or on the paths
    const nTrees = Math.round(250 * D);
    for (let k = 0; k < nTrees; k++) {
      const x = x0 + 0.25 + rand() * (x1 - x0 - 0.5);
      const z = z0 + 0.25 + rand() * (z1 - z0 - 0.5);
      if (((x - px) / 1.85) ** 2 + ((z - pz) / 1.2) ** 2 < 1) continue;
      if (paths.some((_, q) => Math.abs(pathZ(q, x) - z) < 0.18)) continue;
      if (x > -8.2 && x < -7.2 && z > 4.3 && z < 5.2) continue;
      treeAt(x, z, 0.28 + rand() * 0.22);
    }
    for (let x = x0 + 0.2; x < x1; x += 0.42) {
      treeAt(x, z1 - 0.28, 0.4);
      treeAt(x, z0 + 0.28, 0.4);
    }
    // people on the paths and by the water
    for (let k = 0; k < 12; k++) {
      const w = walkers[(k * 5 + 2) % walkers.length];
      shells.person(w[0], 0, w[1] + (k % 2 ? 0.1 : -0.1), 0.19, rand() * TAU, k % 3 ? 'walk' : 'stand');
    }
    shells.person(px + 1.9, 0, pz + 0.1, 0.19, 1.6, 'stand');
    shells.person(px + 1.95, 0, pz - 0.05, 0.19, 1.5, 'sit');
  }

  // ---------- mountains on the horizon (not sampled) ----------
  {
    for (let l = 0; l < 3; l++) {
      const r = 37 + l * 8;
      const amp = 3.8 + l * 1.5;
      const p = [rand() * TAU, rand() * TAU, rand() * TAU];
      const n = 300;
      const pts: number[][] = [];
      for (let k = 0; k <= n; k++) {
        const th = (k / n) * TAU;
        const ang = Math.abs(((th + Math.PI / 2 + Math.PI) % TAU) - Math.PI);
        const mask = ss(0.14, 0.9, ang);
        const noise = 0.5 + 0.5 * (0.55 * Math.sin(3 * th + p[0]) + 0.3 * Math.sin(7 * th + p[1]) + 0.15 * Math.sin(17 * th + p[2]));
        const y = amp * (0.35 + 0.65 * noise) * mask;
        pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
        if (k % 3 === 0 && y > 0.05) far.seg(Math.cos(th) * r, 0, Math.sin(th) * r, Math.cos(th) * r, y, Math.sin(th) * r);
      }
      poly(far, pts);
    }
  }

  // ---------- the target: an office tower in the far east, with a beam into the sky ----------
  const tCell = TARGET_CELL.split(',').map(Number);
  const tx = (xs[tCell[0]] + xs[tCell[0] + 1]) / 2;
  const tz = (zs[tCell[1]] + zs[tCell[1] + 1]) / 2;
  const H = TARGET_H;
  const door = new Group();
  door.position.set(tx, H / 2, tz);
  root.add(door);
  const ly = (y: number) => y - H / 2;
  {
    const shell = new Lines().box(-0.6, ly(0), -0.6, 1.2, 0.45, 1.2).box(-0.5, ly(0.45), -0.5, 1, 3.95, 1).box(-0.35, ly(4.4), -0.35, 0.7, 0.6, 0.7).seg(0, ly(5), 0, 0, ly(5.9), 0);
    for (const s of [-1, 1]) shell.seg(s * 0.35, ly(5), s * 0.35, 0, ly(5.45), 0).seg(s * 0.35, ly(5), -s * 0.35, 0, ly(5.45), 0);
    for (let k = 1; k < 4; k++) {
      const u = -0.5 + k * 0.25;
      shell.seg(u, ly(0.45), 0.5, u, ly(4.4), 0.5).seg(u, ly(0.45), -0.5, u, ly(4.4), -0.5).seg(0.5, ly(0.45), u, 0.5, ly(4.4), u).seg(-0.5, ly(0.45), u, -0.5, ly(4.4), u);
    }
    door.add(new LineSegments(shell.geometry(), targetMaterial(fade, glow)));
    const floors = new Lines();
    for (let y = 0.6; y < 4.4; y += 0.17) floors.rect(-0.5, ly(y), -0.5, 0.5, 0.5);
    door.add(new LineSegments(floors.geometry(), lineMaterial(fade, ICE, 0.4)));
    // the lit window, framed and mullioned, on every face so it is found from any side
    const win = new Lines();
    const face = (px: (u: number) => number[]) => {
      const P = (u: number, y: number) => {
        const q = px(u);
        return [q[0], ly(y), q[1]];
      };
      const seg = (a: number[], b: number[]) => win.seg(a[0], a[1], a[2], b[0], b[1], b[2]);
      seg(P(-0.22, 3), P(0.22, 3));
      seg(P(0.22, 3), P(0.22, 3.65));
      seg(P(0.22, 3.65), P(-0.22, 3.65));
      seg(P(-0.22, 3.65), P(-0.22, 3));
      seg(P(0, 3), P(0, 3.65));
      seg(P(-0.22, 3.32), P(0.22, 3.32));
      for (let k = 0; k < 8; k++) seg(P(-0.2, 3.04 + k * 0.075), P(0.2, 3.04 + k * 0.075));
      for (const y of [1.6, 2.2, 2.6]) {
        seg(P(-0.3, y), P(-0.12, y));
        seg(P(0.12, y), P(0.3, y));
      }
    };
    face((u) => [u, 0.512]);
    face((u) => [-u, -0.512]);
    face((u) => [0.512, -u]);
    face((u) => [-0.512, u]);
    door.add(new LineSegments(win.geometry(), targetMaterial(fade, glow)));
    const base = new Lines().circle(0, ly(0) + 0.01, 0, 0.95, 32).circle(0, ly(0) + 0.01, 0, 1.25, 40);
    door.add(new LineSegments(base.geometry(), targetMaterial(fade, glow)));
    const edges = new Lines();
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) edges.seg(sx * 0.5, ly(0.45), sz * 0.5, sx * 0.5, ly(4.4), sz * 0.5);
    edges.rect(-0.5, ly(4.4), -0.5, 0.5, 0.5).rect(-0.35, ly(5), -0.35, 0.35, 0.35).seg(0, ly(5), 0, 0, ly(5.9), 0);
    door.add(strokes(edges.positions(), fade, AMBER, 0.8, 2.2));
    fillBoxes.push(tx - 0.5, 0.45, tz - 0.5, 1, 3.95, 1);
  }
  const beam = new Group();
  beam.userData.noSample = true;
  root.add(beam);
  {
    const topY = 26;
    const core = new Lines().seg(tx, H + 0.9, tz, tx, topY, tz);
    const coreLine = strokes(core.positions(), fade, AMBER, 0.45, 1.6);
    coreLine.userData.noSample = true;
    beam.add(coreLine);
    const shellL = new Lines();
    for (let y = H + 1.2; y < topY - 2; y += 1.7) {
      const r = 0.38 - ((y - H) / (topY - H)) * 0.24;
      shellL.circle(tx, y, tz, r, 14);
    }
    const ring = new LineSegments(shellL.geometry(), lineMaterial(fade, AMBER, 0.4));
    ring.userData.noSample = true;
    beam.add(ring);
    const flare = new Lines().circle(tx, 0.012, tz, 1.7, 36).circle(tx, 0.012, tz, 2.3, 44).circle(tx, 0.012, tz, 3.1, 52);
    const fl = new LineSegments(flare.geometry(), targetMaterial(fade, glow));
    fl.userData.noSample = true;
    beam.add(fl);
    // pulses climbing the beam
    const n = 30;
    const pa = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) pa.set([k / n, (0.05 + rand() * 0.05) * mo + 0.01, rand(), 0], k * 4);
    const P = attr(pa, 4);
    const f = fract(P.x.add(time.mul(P.y)));
    const y = float(H + 0.9).add(f.mul(topY - H - 3));
    const a = P.z.mul(TAU);
    const rr = float(0.03).add(f.mul(0.04));
    const op = dotShape().mul(float(1).sub(f).pow(1.4)).mul(float(1).add(glow.mul(1.5))).mul(fade);
    beam.add(sprite(n, vec3(cos(a).mul(rr).add(tx), y, sin(a).mul(rr).add(tz)), float(4.5).sub(f.mul(2)), color(AMBER), op.mul(0.9)));
  }

  // ---------- assemble static geometry ----------
  const thin = (L: Lines, tint: typeof ICE, op: number, noSample = false) => {
    const o = new LineSegments(L.geometry(), lineMaterial(fade, tint, op));
    if (noSample) o.userData.noSample = true;
    root.add(o);
    return o;
  };
  thin(ground, CYAN, 0.22);
  thin(shells, ICE, 0.42);
  thin(facade, CYAN, 0.13);
  thin(winI, ICE, 0.72);
  thin(winA, AMBER, 0.62);
  thin(treeL, CYAN, 0.32);
  thin(bridgeT, ICE, 0.5);
  thin(waterT, CYAN, 0.28);
  thin(far, CYAN, 0.2, true);
  root.add(strokes(sil.positions(), fade, ICE, 0.85, 2));
  root.add(strokes(roadS.positions(), fade, CYAN, 0.6, 1.8));
  root.add(strokes(hwS.positions(), fade, ICE, 0.9, 2.4));

  // façade fills: boxes and cylinders, one instanced draw call each
  const m4 = new Matrix4();
  const boxFill = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), fillMaterial(fade, CYAN, 0.14), Math.max(1, fillBoxes.length / 6));
  for (let i = 0; i < fillBoxes.length; i += 6) boxFill.setMatrixAt(i / 6, m4.makeScale(fillBoxes[i + 3], fillBoxes[i + 4], fillBoxes[i + 5]).setPosition(fillBoxes[i], fillBoxes[i + 1], fillBoxes[i + 2]));
  boxFill.count = fillBoxes.length / 6;
  boxFill.frustumCulled = false;
  boxFill.userData.noSample = true;
  root.add(boxFill);
  const cylFill = new InstancedMesh(new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0), fillMaterial(fade, CYAN, 0.14), Math.max(1, fillCyl.length / 6));
  for (let i = 0; i < fillCyl.length; i += 6) cylFill.setMatrixAt(i / 6, m4.makeScale(fillCyl[i + 3], fillCyl[i + 5], fillCyl[i + 4]).setPosition(fillCyl[i], fillCyl[i + 1], fillCyl[i + 2]));
  cylFill.count = fillCyl.length / 6;
  cylFill.frustumCulled = false;
  cylFill.userData.noSample = true;
  root.add(cylFill);

  // ---------- light: street lamps, traffic, ring traffic, trains, boats, aircraft, beacons ----------
  const dot = dotShape();
  {
    // static lamps (position + size/warmth), one instanced sprite for the whole city
    const n = lamps.length / 5;
    const pos = new Float32Array(n * 3);
    const meta = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      pos.set([lamps[k * 5], lamps[k * 5 + 1], lamps[k * 5 + 2]], k * 3);
      meta.set([lamps[k * 5 + 3], lamps[k * 5 + 4]], k * 2);
    }
    const M = attr(meta, 2);
    const seed = hash(instanceIndex);
    root.add(sprite(n, attr(pos, 3), M.x, mix(color(ICE), color(AMBER), M.y), dot.mul(sin(time.mul(0.9).add(seed.mul(40))).mul(0.12).add(0.62)).mul(fade)));
  }
  {
    // traffic: every car is a point sliding along its lane; white heading toward the camera, amber away
    const n = laneA.length / 4;
    const A = attr(new Float32Array(laneA), 4);
    const B = attr(new Float32Array(laneB), 4);
    const C = attr(new Float32Array(laneC), 4);
    const f = fract(B.w.add(time.mul(B.z)));
    const along = f.mul(A.w);
    const seed = hash(instanceIndex);
    const op = dot.mul(0.9).mul(smoothstep(0, 0.06, f)).mul(float(1).sub(smoothstep(0.94, 1, f))).mul(fade);
    root.add(sprite(n, vec3(A.x.add(B.x.mul(along)), A.y.add(C.x.mul(along)), A.z.add(B.y.mul(along))), C.y.add(seed.mul(0.9)), mix(color(AMBER), color(ICE), step(0, B.x.add(B.y))), op));
  }
  {
    // ring highway: cars driving the ellipse
    const per = Math.max(6, Math.round(16 * D));
    const n = per * 4;
    const a = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const lane = k % 4;
      const dir = lane < 2 ? 1 : -1;
      const off = [-0.13, -0.05, 0.05, 0.13][lane];
      a.set([RA + off, RB + off, ((0.5 + rand() * 0.4) * dir * mo) / RA, rand() * TAU], k * 4);
    }
    const A = attr(a, 4);
    const ang: N = A.w.add(time.mul(A.z));
    const seed = hash(instanceIndex);
    const ex: N = cos(ang).mul(A.x);
    const ez: N = sin(ang).mul(A.y);
    root.add(sprite(n, vec3(ex, 0.46, ez), float(2.4).add(seed.mul(0.8)), mix(color(AMBER), color(ICE), step(0, A.z)), dot.mul(0.9).mul(fade)));
  }
  {
    // two trains on the viaduct, one each way: lit windows in a row
    const cars = 7;
    const items: number[] = [];
    const extra: number[] = [];
    for (const [dir, zt, phase, sp] of [[1, RAIL_Z - 0.12, 0.2, 2.1], [-1, RAIL_Z + 0.12, 0.65, 1.8]])
      for (let c = 0; c < cars; c++)
        for (let w = 0; w < 2; w++) {
          items.push(dir, zt, phase, (sp * mo) / 36);
          extra.push(c * 0.21 + w * 0.09, c === 0 && w === 0 ? 5.5 : 3.2, c === 0 ? 0.7 : 0.25, 0);
        }
    const A = attr(new Float32Array(items), 4);
    const B = attr(new Float32Array(extra), 4);
    const f = fract(A.z.add(time.mul(A.w)));
    const x = A.x.mul(f.mul(2).sub(1).mul(17.8)).sub(A.x.mul(B.x));
    const edgeFade = float(1).sub(smoothstep(14.5, 17.8, x.abs()));
    root.add(sprite(items.length / 4, vec3(x, 0.85, A.y), B.y, mix(color(ICE), color(AMBER), B.z), dot.mul(0.95).mul(edgeFade).mul(fade)));
  }
  {
    // boats and glitter on the river: z along the stream, x = centre line + offset * half width
    const rx = (z: N) => sin(z.mul(0.17).add(0.4)).mul(2);
    const hw = (z: N) => float(1.7).add(float(4.5).mul(float(1).sub(smoothstep(-22, -11, z)))).add(max(float(0), z.negate().sub(22)).mul(0.45));
    const stream = (n: number, mk: (k: number) => number[], size: (seed: N) => N, col: N, strength: N, y: number) => {
      const a = new Float32Array(n * 4);
      const b = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) {
        const m = mk(k);
        a.set([m[0], m[1], m[2] * mo, rand()], k * 4);
        b.set([m[3], 0, 0, 0], k * 4);
      }
      const A = attr(a, 4);
      const B = attr(b, 4);
      const f = fract(A.w.add(time.mul(A.z)));
      const z = mix(A.x, A.y, f);
      const seed = hash(instanceIndex);
      const op = dot.mul(strength).mul(smoothstep(0, 0.05, f)).mul(float(1).sub(smoothstep(0.95, 1, f))).mul(fade);
      return sprite(n, vec3(rx(z).add(B.x.mul(hw(z))), y, z), size(seed), col, op);
    };
    const nb = Math.round(10 * D) + 2;
    root.add(
      stream(
        nb,
        (k) => {
          const down = k % 2 === 0;
          return [down ? 18 : -34, down ? -34 : 18, (0.45 + rand() * 0.4) / 52, (rand() * 2 - 1) * 0.55];
        },
        () => float(4.2),
        mix(color(ICE), color(AMBER), step(0.5, hash(instanceIndex.add(7)))),
        float(0.95),
        0.06,
      ),
    );
    const ng = Math.round(200 * D);
    root.add(
      stream(
        ng,
        () => [18, -34, (0.04 + rand() * 0.09) / 52, (rand() * 2 - 1) * 0.95],
        (s: N) => float(1.1).add(s.mul(1.2)),
        color(CYAN),
        sin(time.mul(1.4).add(hash(instanceIndex.add(31)).mul(60))).mul(0.3).add(0.4),
        0.03,
      ),
    );
  }
  {
    // aircraft with navigation lights and a strobe, circling the city
    const planes = [
      [10, 14.5, 0.22, 0.4],
      [19, 17.5, -0.16, 2.4],
      [25, 12.5, 0.12, 4.3],
    ];
    const a = new Float32Array(planes.length * 3 * 4);
    const kk = new Float32Array(planes.length * 3);
    planes.forEach((p, i) => {
      for (let w = 0; w < 3; w++) {
        a.set([p[0], p[1], p[2] * mo, p[3]], (i * 3 + w) * 4);
        kk[i * 3 + w] = w;
      }
    });
    const A = attr(a, 4);
    const K = attr(kk, 1);
    const ang: N = A.w.add(time.mul(A.z));
    const off: N = K.sub(1).mul(0.22).mul(A.z.sign());
    const x: N = cos(ang).mul(A.x).sub(sin(ang).mul(off));
    const z: N = sin(ang).mul(A.x).add(cos(ang).mul(off));
    const strobe = smoothstep(0.82, 1, sin(time.mul(4.2).add(A.w.mul(7))));
    const mid = step(0.5, K).mul(float(1).sub(step(1.5, K)));
    const col = mix(mix(color(AMBER), color(ICE), step(0.5, K)), color(CYAN), step(1.5, K));
    root.add(sprite(planes.length * 3, vec3(x, A.y, z), float(4), col, dot.mul(mix(float(0.8), strobe, mid)).mul(fade)));
  }
  {
    // aircraft warning lights: slow blink
    const bp = new Float32Array(beacons);
    const s = sprite(bp.length / 3, attr(bp, 3), float(4.5), color(ICE), dot.mul(pow(sin(time.mul(2.1).add(hash(instanceIndex).mul(30))).mul(0.5).add(0.5), 3)).mul(fade));
    s.userData.noSample = false;
    s.userData.points = bp;
    root.add(s);
  }

  // ---------- horizon, labels ----------
  root.add(horizon(fade, R));

  const labels: NonNullable<Layer['labels']> = [];
  const pin = (x: number, y: number, z: number, pt: string, en: string) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    root.add(o);
    labels.push({ object: o, pt, en });
  };
  pin(tx, H + 2.4, tz, 'ANOMALIA · SINAL FRACO', 'ANOMALY · FAINT SIGNAL');
  pin(anchors.centro[0], anchors.centro[1], anchors.centro[2], 'CENTRO · 340 M', 'DOWNTOWN · 340 M');
  pin(3.4, 3.4, -9.4, 'PORTO · 6 GUINDASTES', 'PORT · 6 CRANES');
  pin(riverX(7.5), 4.1, 7.5, 'RIO · 5 PONTES', 'RIVER · 5 BRIDGES');
  pin(SX, 1.7, SZ, 'ESTÁDIO · 48 MIL', 'STADIUM · 48K');
  pin(-5.4, 1.1, 9.7, 'PARQUE CENTRAL', 'CENTRAL PARK');

  return {
    id: 'city',
    exposure: 0.5,
    root,
    fade,
    glow,
    radius: R,
    view: { distance: 28, minDistance: 4, maxDistance: 46, pitch: 0.22, height: 3 },
    target: { object: door, radius: 1.3 },
    caption: {
      pt: 'Dentro do cubo, uma metrópole inteira. Um sinal fraco, âmbar, sobe de algum lugar.',
      en: 'Inside the cube, a whole metropolis. A faint amber signal rises from somewhere.',
    },
    labels,
    update() {
      beam.visible = door.visible;
    },
  };
}
