import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  LatheGeometry,
  LineBasicNodeMaterial,
  LineSegments,
  type Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PointsNodeMaterial,
  Sprite,
  Vector2,
  Vector3,
} from 'three/webgpu';
import { color, float, fract, hash, instanceIndex, instancedBufferAttribute, length, positionWorld, sin, smoothstep, time, uv, vec3 } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, edges, fillMaterial, lineMaterial, strokes, targetMaterial, type Fade } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const TAU = Math.PI * 2;
type V3 = [number, number, number];

// The machine is modelled at 1 : 1.7 and scaled up, so an engineer (1.8 m) is a speck next to it.
const S = 1.7;
const OPEN_C = 0; // the core window faces +X, away from the arrival view
const OPEN_HW = 0.6;
const WY0 = 0.9; // window bottom / top (machine units)
const WY1 = 5.1;
// The hangar (metres): half width, back wall, front wall, eaves, ridge.
const HX = 36;
const ZB = -36;
const ZF = 36;
const WALL = 20;
const RIDGE = 28;
const topY = (x: number) => WALL + (RIDGE - WALL) * (1 - Math.abs(x) / HX);
const rad = (deg: number) => (deg * Math.PI) / 180;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Rings around a path (parallel-transport frames) joined by longitudinal lines: a pipe or cable. */
function sweep(L: Lines, p: V3[], r: number, sides = 6, every = 1) {
  let ux = 0;
  let uy = 0;
  let uz = 0;
  let prev: V3[] | null = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(p.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    if (i === 0) {
      const ax = Math.abs(tx) < 0.7 ? 1 : 0;
      const ay = ax ? 0 : 1;
      ux = ty * 0 - tz * ay;
      uy = tz * ax - tx * 0;
      uz = tx * ay - ty * ax;
    } else {
      const d = ux * tx + uy * ty + uz * tz;
      ux -= tx * d;
      uy -= ty * d;
      uz -= tz * d;
    }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy;
    const vy = tz * ux - tx * uz;
    const vz = tx * uy - ty * ux;
    const ring: V3[] = [];
    for (let s = 0; s < sides; s++) {
      const c = Math.cos((s / sides) * TAU) * r;
      const sn = Math.sin((s / sides) * TAU) * r;
      ring.push([p[i][0] + ux * c + vx * sn, p[i][1] + uy * c + vy * sn, p[i][2] + uz * c + vz * sn]);
    }
    if (prev) for (let s = 0; s < sides; s++) L.seg(...prev[s], ...ring[s]);
    if (i % every === 0 || i === p.length - 1) for (let s = 0; s < sides; s++) L.seg(...ring[s], ...ring[(s + 1) % sides]);
    prev = ring;
  }
}

const lerp3 = (a: V3, b: V3, n: number): V3[] =>
  Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n] as V3);

/** Catmull-Rom through control points. */
function spline(c: V3[], per: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(0, i - 1)];
    const p1 = c[i];
    const p2 = c[i + 1];
    const p3 = c[Math.min(c.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (d: number) =>
        0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
      out.push([f(0), f(1), f(2)]);
    }
  }
  out.push(c[c.length - 1]);
  return out;
}

function polyline(L: Lines, p: V3[]) {
  for (let i = 0; i + 1 < p.length; i++) L.seg(...p[i], ...p[i + 1]);
}

const arc = (r: number, a0: number, a1: number, n: number): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });

/** Gear in the XY plane: tooth profile with real flanks, rim, hub and lightening windows. */
function gearGeo(rp: number, n: number, ring: boolean) {
  const tip = rp + 0.1;
  const root = rp - 0.1;
  const step = TAU / n;
  const outline = new Lines();
  const det = new Lines();
  const P = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  const Sg = (L: Lines, A: [number, number], B: [number, number]) => L.seg(A[0], A[1], 0, B[0], B[1], 0);
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const p0 = P(a - 0.3 * step, root);
    const p1 = P(a - 0.17 * step, tip);
    const p2 = P(a + 0.17 * step, tip);
    const p3 = P(a + 0.3 * step, root);
    const p4 = P(a + 0.7 * step, root);
    Sg(outline, p0, p1);
    Sg(outline, p1, p2);
    Sg(outline, p2, p3);
    Sg(outline, p3, p4);
    Sg(det, P(a - 0.3 * step, root * 0.94), P(a + 0.3 * step, root * 0.94));
  }
  const segs = Math.min(160, n * 2);
  if (ring) {
    for (const k of [0.97, 0.92, 0.86]) det.circle(0, 0, 0, root * k, segs, true);
    for (let i = 0; i < n; i++) Sg(det, P((i + 0.5) * step, root * 0.86), P((i + 0.5) * step, root * 0.92));
  } else {
    det.circle(0, 0, 0, root * 0.9, segs, true).circle(0, 0, 0, root * 0.82, segs, true);
    det.circle(0, 0, 0, root * 0.2, 24, true).circle(0, 0, 0, root * 0.09, 16, true);
    const k = Math.max(5, Math.min(10, Math.round(n / 5)));
    for (let i = 0; i < k; i++) {
      const c = ((i + 0.5) / k) * TAU;
      const hw = (TAU / k) * 0.5 - 0.1;
      det.circle(0, 0, 0, root * 0.3, 12, true, c - hw, c + hw).circle(0, 0, 0, root * 0.73, 20, true, c - hw, c + hw);
      Sg(det, P(c - hw, root * 0.3), P(c - hw, root * 0.73));
      Sg(det, P(c + hw, root * 0.3), P(c + hw, root * 0.73));
      const sp = (i / k) * TAU;
      det.circle(Math.cos(sp) * root * 0.26, Math.sin(sp) * root * 0.26, 0, root * 0.035, 8, true);
    }
  }
  return { outline: outline.positions(), thin: det };
}

/** One soft glow in screen space (instanced point of count 1, so it follows the object it is parented to). */
function halo(fade: Fade, tint: Color, size: number, opacity: number, pulse = 0.25) {
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(3), 3), 'vec3');
  mat.sizeNode = float(size);
  mat.colorNode = color(tint);
  const s = smoothstep(0.5, 0, length(uv().sub(0.5)));
  mat.opacityNode = s.mul(s).mul(float(opacity)).mul(sin(time.mul(2.1)).mul(pulse).add(1)).mul(fade);
  const sp = new Sprite(mat);
  sp.count = 1;
  sp.frustumCulled = false;
  sp.userData.noSample = true;
  return sp;
}

/** Many glows at fixed points (lamps). */
function glints(pos: Float32Array, fade: Fade, tint: Color, size: number, opacity: number) {
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3), 'vec3');
  mat.sizeNode = float(size);
  mat.colorNode = color(tint);
  const s = smoothstep(0.5, 0, length(uv().sub(0.5)));
  mat.opacityNode = s.mul(s).mul(float(opacity)).mul(sin(time.mul(1.3).add(hash(instanceIndex).mul(20))).mul(0.08).add(1)).mul(fade);
  const sp = new Sprite(mat);
  sp.count = pos.length / 3;
  sp.frustumCulled = false;
  sp.userData.noSample = true;
  return sp;
}

/** Soft volume of light (open frustum): it fades from `a` (dark) to `b` (bright) along a world axis. */
function beam(tris: number[], tint: Color, opacity: number, fade: Fade, axis: 'x' | 'y', a: number, b: number) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris, 3));
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  mat.colorNode = color(tint);
  const along = axis === 'x' ? positionWorld.x : positionWorld.y;
  mat.opacityNode = smoothstep(a, b, along).mul(opacity).mul(sin(time.mul(1.7)).mul(0.12).add(1)).mul(fade);
  const mesh = new Mesh(g, mat);
  mesh.userData.noSample = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Quad faces joining two 4-corner loops. */
function frustum(tris: number[], top: V3[], bot: V3[]) {
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tris.push(...top[i], ...top[j], ...bot[j], ...top[i], ...bot[j], ...bot[i]);
  }
}

/** Band of a revolved surface between two rings, wound counter-clockwise as seen from outside. */
function band(t: number[], r0: number, y0: number, r1: number, y1: number, a0: number, a1: number, n: number) {
  for (let i = 0; i < n; i++) {
    const u = a0 + ((a1 - a0) * i) / n;
    const v = a0 + ((a1 - a0) * (i + 1)) / n;
    t.push(Math.cos(u) * r0, y0, Math.sin(u) * r0, Math.cos(v) * r1, y1, Math.sin(v) * r1, Math.cos(v) * r0, y0, Math.sin(v) * r0);
    t.push(Math.cos(u) * r0, y0, Math.sin(u) * r0, Math.cos(u) * r1, y1, Math.sin(u) * r1, Math.cos(v) * r1, y1, Math.sin(v) * r1);
  }
}

/** Depth-only mesh: hides what is behind it, so solid things read as solid (and hidden things stay hidden). */
function shell(tris: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tris, 3));
  const mesh = new Mesh(g, new MeshBasicNodeMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.userData.noSample = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Handrail along a path: posts, top and mid rails, toe board. */
function rail(L: Lines, p: V3[], h = 1.05, every = 2) {
  for (let i = 0; i < p.length; i++) {
    const [x, y, z] = p[i];
    if (i % every === 0 || i === p.length - 1) L.seg(x, y, z, x, y + h, z);
    if (i + 1 < p.length) {
      const [a, b, c] = p[i + 1];
      L.seg(x, y + h, z, a, b + h, c).seg(x, y + h * 0.5, z, a, b + h * 0.5, c).seg(x, y + 0.12, z, a, b + 0.12, c);
    }
  }
}

/** Grated walkway along a path in XZ: edges, rungs and an under-beam; returns both edges for the rails. */
function deck(L: Lines, c: [number, number][], y: number, w: number) {
  const left: V3[] = [];
  const right: V3[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)];
    const b = c[Math.min(c.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (-(b[1] - a[1]) / l) * (w / 2);
    const nz = ((b[0] - a[0]) / l) * (w / 2);
    left.push([c[i][0] + nx, y, c[i][1] + nz]);
    right.push([c[i][0] - nx, y, c[i][1] - nz]);
    L.seg(...left[i], ...right[i]);
  }
  for (let i = 0; i + 1 < left.length; i++) {
    L.seg(left[i][0], y - 0.4, left[i][2], left[i + 1][0], y - 0.4, left[i + 1][2]);
    L.seg(right[i][0], y - 0.4, right[i][2], right[i + 1][0], y - 0.4, right[i + 1][2]);
  }
  return { left, right };
}

/** Stairs from (x0,z0) at y0 up to (x1,z1) at y1: treads, stringers, both handrails. */
function stairs(L: Lines, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, w: number, steps: number) {
  const l = Math.hypot(x1 - x0, z1 - z0);
  const nx = (-(z1 - z0) / l) * (w / 2);
  const nz = ((x1 - x0) / l) * (w / 2);
  const lp: V3[] = [];
  const rp: V3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const y = y0 + (y1 - y0) * t;
    if (i > 0) L.seg(x + nx, y, z + nz, x - nx, y, z - nz);
    if (i < steps) {
      const yn = y0 + (y1 - y0) * ((i + 1) / steps);
      L.seg(x + nx, y, z + nz, x + nx, yn, z + nz).seg(x - nx, y, z - nz, x - nx, yn, z - nz);
      L.seg(x + nx, yn, z + nz, x - nx, yn, z - nz);
    }
    lp.push([x + nx, y, z + nz]);
    rp.push([x - nx, y, z - nz]);
  }
  for (const side of [lp, rp]) {
    polyline(L, side);
    L.seg(side[0][0], side[0][1] - 0.35, side[0][2], side[steps][0], side[steps][1] - 0.35, side[steps][2]);
    rail(L, side, 0.95, 2);
  }
}

/** Fixed ladder with a safety cage; (nx, nz) is the outward direction, the climber faces inward. */
function ladder(L: Lines, x: number, z: number, nx: number, nz: number, y0: number, y1: number) {
  const tx = -nz;
  const tz = nx;
  L.seg(x + tx * 0.26, y0, z + tz * 0.26, x + tx * 0.26, y1, z + tz * 0.26).seg(x - tx * 0.26, y0, z - tz * 0.26, x - tx * 0.26, y1, z - tz * 0.26);
  for (let y = y0 + 0.3; y < y1; y += 0.3) L.seg(x + tx * 0.26, y, z + tz * 0.26, x - tx * 0.26, y, z - tz * 0.26);
  for (let y = y0 + 2.2; y < y1 - 0.3; y += 0.9) {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI;
      const a1 = ((i + 1) / 8) * Math.PI;
      L.seg(
        x + (tx * Math.cos(a0) + nx * Math.sin(a0)) * 0.5, y, z + (tz * Math.cos(a0) + nz * Math.sin(a0)) * 0.5,
        x + (tx * Math.cos(a1) + nx * Math.sin(a1)) * 0.5, y, z + (tz * Math.cos(a1) + nz * Math.sin(a1)) * 0.5,
      );
    }
  }
  L.seg(x + nx * 0.5, y0 + 2.2, z + nz * 0.5, x + nx * 0.5, y1 - 0.3, z + nz * 0.5);
}

/** Scaffold tower: standards, ledgers, diagonal bracing and a boarded, railed top platform. */
function scaffold(L: Lines, cx: number, cz: number, w: number, d: number, h: number, rot = 0) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (x: number, z: number): [number, number] => [cx + x * c + z * s, cz - x * s + z * c];
  const co = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
  const lifts = Math.round(h / 2);
  const lh = h / lifts;
  for (const [x, z] of co) L.seg(x, 0, z, x, h + 1, z);
  for (let k = 0; k <= lifts; k++) {
    const y = k * lh;
    for (let i = 0; i < 4; i++) L.seg(co[i][0], y, co[i][1], co[(i + 1) % 4][0], y, co[(i + 1) % 4][1]);
    if (k < lifts) {
      for (let i = 0; i < 4; i++) {
        const A = co[(i + (k % 2)) % 4];
        const B = co[(i + 1 + (k % 2)) % 4];
        if (i % 2 === 0) L.seg(A[0], y, A[1], B[0], y + lh, B[1]);
        else L.seg(B[0], y, B[1], A[0], y + lh, A[1]);
      }
    }
  }
  for (let t = 0.25; t < w; t += 0.3) {
    const A = P(-w / 2 + t, -d / 2);
    const B = P(-w / 2 + t, d / 2);
    L.seg(A[0], h, A[1], B[0], h, B[1]);
  }
  for (let i = 0; i < 4; i++) {
    L.seg(co[i][0], h + 0.5, co[i][1], co[(i + 1) % 4][0], h + 0.5, co[(i + 1) % 4][1]);
    L.seg(co[i][0], h + 1, co[i][1], co[(i + 1) % 4][0], h + 1, co[(i + 1) % 4][1]);
  }
}

/** Rotated box (feet at y), optionally with cross slats like a shipping crate. */
function obox(L: Lines, cx: number, y: number, cz: number, w: number, h: number, d: number, rot = 0, slats = false) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const co = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
  for (let i = 0; i < 4; i++) {
    const a = co[i];
    const b = co[(i + 1) % 4];
    L.seg(a[0], y, a[1], b[0], y, b[1]).seg(a[0], y + h, a[1], b[0], y + h, b[1]).seg(a[0], y, a[1], a[0], y + h, a[1]);
    if (slats) L.seg(a[0], y, a[1], b[0], y + h, b[1]).seg(b[0], y, b[1], a[0], y + h, a[1]);
  }
}

/** Oil drum. */
function barrel(L: Lines, x: number, z: number, r = 0.3, h = 0.9) {
  for (const k of [0, 0.3, 0.7, 1]) L.circle(x, h * k, z, r, 10);
  for (let i = 0; i < 8; i++) {
    const c = x + Math.cos((i / 8) * TAU) * r;
    const s = z + Math.sin((i / 8) * TAU) * r;
    L.seg(c, 0, s, c, h, s);
  }
}

const vrectX = (L: Lines, x: number, y0: number, z0: number, y1: number, z1: number) =>
  L.seg(x, y0, z0, x, y0, z1).seg(x, y0, z1, x, y1, z1).seg(x, y1, z1, x, y1, z0).seg(x, y1, z0, x, y0, z0);
const vrectZ = (L: Lines, z: number, x0: number, y0: number, x1: number, y1: number) =>
  L.seg(x0, y0, z, x1, y0, z).seg(x1, y0, z, x1, y1, z).seg(x1, y1, z, x0, y1, z).seg(x0, y1, z, x0, y0, z);

/** Diagonal warning hatch inside a rectangle on a horizontal plane. */
function hatchRect(L: Lines, x0: number, z0: number, x1: number, z1: number, y: number, gap: number) {
  const w = x1 - x0;
  const h = z1 - z0;
  for (let t = -h; t < w; t += gap) {
    const s0 = Math.max(0, -t);
    const s1 = Math.min(h, w - t);
    if (s1 > s0) L.seg(x0 + t + s0, y, z0 + s0, x0 + t + s1, y, z0 + s1);
  }
}

/** Grated floor panel. */
function grating(L: Lines, x0: number, z0: number, x1: number, z1: number, step: number) {
  L.rect(x0, 0.02, z0, x1, z1);
  for (let x = x0 + step; x < x1; x += step) L.seg(x, 0.02, z0, x, 0.02, z1);
  for (let z = z0 + step; z < z1; z += step) L.seg(x0, 0.02, z, x1, 0.02, z);
}

/** [4] A giant reactor in a hangar. Its core burns amber behind a window on the far side. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(99);
  const D = ctx.detail;
  const m = ctx.reducedMotion ? 0.3 : 1;

  // ======================================================================== The machine
  const mach = new Group();
  mach.scale.setScalar(S);
  root.add(mach);

  const thick = new Lines(); // silhouettes (2-3 px)
  const pipeThick = new Lines(); // main pipe centre lines
  const frame = new Lines(); // structure + dense detail (ICE)
  const pipes = new Lines(); // pipes and cables (CYAN)
  const hw = OPEN_HW;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const inGap = (a: number) => angDiff(a, OPEN_C) < hw;
  /** Ring at height y; the window gap is only cut where the window is. */
  const hring = (L: Lines, y: number, r: number, segs: number) => {
    if (y > WY0 - 1e-3 && y < WY1 + 1e-3) L.circle(0, y, 0, r, segs, false, OPEN_C + hw, OPEN_C + TAU - hw);
    else L.circle(0, y, 0, r, segs);
  };
  /** Vertical line at angle a, with the window cut out when it falls inside the gap. */
  const vline = (L: Lines, a: number, r: number, y0: number, y1: number) => {
    const c = Math.cos(a) * r;
    const s = Math.sin(a) * r;
    if (!inGap(a)) L.seg(c, y0, s, c, y1, s);
    else {
      if (y0 < WY0) L.seg(c, y0, s, c, Math.min(y1, WY0), s);
      if (y1 > WY1) L.seg(c, Math.max(y0, WY1), s, c, y1, s);
    }
  };

  // ---- Plinth: bolted base flange and a grated ring of floor around it.
  thick.circle(0, 0, 0, 3.45, 80).circle(0, 0.18, 0, 3.4, 80).circle(0, 0, 0, 5.6, 120);
  for (let r = 3.7; r <= 5.5; r += 0.3) frame.circle(0, 0, 0, r, 96);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    frame.seg(Math.cos(a) * 3.45, 0, Math.sin(a) * 3.45, Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6);
  }
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU;
    const l = i % 5 === 0 ? 0.3 : 0.14;
    frame.seg(Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6, Math.cos(a) * (5.6 + l), 0, Math.sin(a) * (5.6 + l));
  }

  // ---- Drum: panel seams, ribs, flanges, hatch bands, bezel around the window.
  for (let y = 0; y <= 6.001; y += 0.25) hring(frame, y, 3.1, 72);
  for (const y of [0, 0.5, 5.5, 6]) hring(thick, y, y === 0 || y === 6 ? 3.45 : 3.25, 72);
  const ribN = Math.round(24 + 24 * D);
  for (let i = 0; i < ribN; i++) vline(i % 3 === 0 ? thick : frame, (i / ribN) * TAU, 3.1, 0.5, 5.5);
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j < 20; j++) vline(frame, ((j + (k % 2) * 0.5) / 20) * TAU, 3.14, k, k + 1);
  }
  for (let j = 0; j < 96; j++) {
    const a = (j / 96) * TAU;
    const b = a + 0.05;
    if (!inGap(a)) {
      frame.seg(Math.cos(a) * 3.12, 0.5, Math.sin(a) * 3.12, Math.cos(b) * 3.12, 1.0, Math.sin(b) * 3.12);
      frame.seg(Math.cos(a) * 3.12, 5.0, Math.sin(a) * 3.12, Math.cos(b) * 3.12, 5.5, Math.sin(b) * 3.12);
    }
    frame.seg(Math.cos(a) * 3.5, 0, Math.sin(a) * 3.5, Math.cos(a) * 3.5, 0.18, Math.sin(a) * 3.5);
  }
  for (const s of [-1, 1]) {
    const a = OPEN_C + s * hw;
    for (const r of [3.1, 3.4]) thick.seg(Math.cos(a) * r, WY0, Math.sin(a) * r, Math.cos(a) * r, WY1, Math.sin(a) * r);
    for (const y of [WY0, WY1]) thick.seg(Math.cos(a) * 3.1, y, Math.sin(a) * 3.1, Math.cos(a) * 3.4, y, Math.sin(a) * 3.4);
  }
  for (const y of [WY0, WY1]) thick.circle(0, y, 0, 3.4, 24, false, OPEN_C - hw, OPEN_C + hw);
  for (let i = 0; i <= 10; i++) {
    const a = OPEN_C - hw + (i / 10) * 2 * hw;
    frame.seg(Math.cos(a) * 3.1, WY0, Math.sin(a) * 3.1, Math.cos(a) * 3.4, WY0, Math.sin(a) * 3.4);
    frame.seg(Math.cos(a) * 3.1, WY1, Math.sin(a) * 3.1, Math.cos(a) * 3.4, WY1, Math.sin(a) * 3.4);
  }

  // ---- Reactor chamber (seen through the window): inner wall, struts, conduits to the core.
  for (let y = 1.0; y <= 5.001; y += 0.2) frame.circle(0, y, 0, 1.9, 64);
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    frame.seg(Math.cos(a) * 1.9, 1.0, Math.sin(a) * 1.9, Math.cos(a) * 1.9, 5.0, Math.sin(a) * 1.9);
  }
  for (const y of [1.0, 3.0, 5.0]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + (y === 3 ? 0.2 : 0);
      frame.seg(Math.cos(a) * 1.9, y, Math.sin(a) * 1.9, Math.cos(a) * 3.1, y, Math.sin(a) * 3.1);
    }
  }
  thick.circle(0, 1.0, 0, 1.9, 64).circle(0, 5.0, 0, 1.9, 64).circle(0, 1.0, 0, 2.2, 64).circle(0, 5.0, 0, 2.2, 64);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.39;
    sweep(pipes, lerp3([Math.cos(a) * 1.9, 3, Math.sin(a) * 1.9], [Math.cos(a) * 3.05, 3, Math.sin(a) * 3.05], 6), 0.07, 6, 1);
  }
  const coreSpokes = new Lines();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    coreSpokes.seg(Math.cos(a) * 0.6, 3, Math.sin(a) * 0.6, Math.cos(a) * 1.9, 3, Math.sin(a) * 1.9);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    coreSpokes.seg(Math.cos(a) * 0.5, 3.9, Math.sin(a) * 0.5, Math.cos(a) * 1.9, 5.0, Math.sin(a) * 1.9);
    coreSpokes.seg(Math.cos(a) * 0.5, 2.1, Math.sin(a) * 0.5, Math.cos(a) * 1.9, 1.0, Math.sin(a) * 1.9);
  }

  // ---- Dome and shaft above the drum.
  for (let i = 1; i <= 12; i++) {
    const u = (i / 13) * 1.25;
    frame.circle(0, 6 + Math.sin(u) * 0.9, 0, 3.4 * Math.cos(u), 56);
  }
  for (let j = 0; j < 28; j++) {
    const a = (j / 28) * TAU;
    for (let i = 0; i < 12; i++) {
      const u0 = (i / 13) * 1.25;
      const u1 = ((i + 1) / 13) * 1.25;
      frame.seg(Math.cos(a) * 3.4 * Math.cos(u0), 6 + Math.sin(u0) * 0.9, Math.sin(a) * 3.4 * Math.cos(u0), Math.cos(a) * 3.4 * Math.cos(u1), 6 + Math.sin(u1) * 0.9, Math.sin(a) * 3.4 * Math.cos(u1));
    }
  }
  thick.seg(0, 6.8, 0, 0, 7.0, 0);
  sweep(frame, lerp3([0, 6.85, 0], [0, 7.0, 0], 2), 0.12, 8, 1);

  // ---- Pipes: helices around the drum, wall and roof runs, floor manifold.
  for (let p = 0; p < 3; p++) {
    const h: V3[] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU * 1.7 + p * 2.09 + 1.6; // start behind the window so the window stays clear
      h.push([Math.cos(a) * 3.62, 0.4 + (i / 120) * 5.2, Math.sin(a) * 3.62]);
    }
    polyline(pipeThick, h);
    sweep(pipes, h.filter((_, i) => i % 3 === 0), 0.08, 6, 2);
  }
  const runs: V3[][] = [
    [[-5.6, 0.2, 2.0], [-6.0, 1.8, 1.6], [-5.2, 4.0, 1.0], [-3.9, 5.0, 0.8], [-3.2, 5.2, 0.6]],
    [[-3.0, 0.2, -4.5], [-3.8, 2.5, -4.0], [-3.6, 5.0, -3.0], [-2.0, 6.3, -1.8]],
    [[3.0, 0.2, -4.5], [3.8, 2.5, -4.0], [3.6, 5.0, -3.0], [2.0, 6.3, -1.8]],
    [[-2.4, 6.5, 0.4], [-1.0, 7.7, 0.7], [1.0, 7.7, 0.7], [2.4, 6.5, 0.4]],
  ];
  for (const c of runs) {
    const path = spline(c, 10);
    polyline(pipeThick, path);
    sweep(pipes, path, 0.15, 8, 2);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.26;
    if (inGap(a)) continue;
    sweep(pipes, lerp3([Math.cos(a) * 3.5, 0.2, Math.sin(a) * 3.5], [Math.cos(a) * 5.4, 0.2, Math.sin(a) * 5.4], 8), 0.1, 6, 1);
  }

  // ---- Dynamic parts: every gear and turbine rotor keeps its lines here, turned on the CPU (one buffer).
  interface Gear {
    M: Matrix4;
    gx: number;
    gy: number;
    th: number;
    w: number;
    base: Float32Array;
    o?: Object3D;
  }
  const gears: Gear[] = [];

  // ---- Turbines: a casing with an intake rotor (spinning blades) and a nozzle, plumbed into the drum.
  const turbine = (x0: number, y0: number, z0: number, R: number, len: number, w: number, ph: number) => {
    const g = new Group();
    g.position.set(x0, y0, z0);
    g.rotation.set(0, Math.PI / 2, 0); // the turbine's axis (local z) runs along +X
    g.updateMatrix();
    const v = new Vector3();
    const P = (x: number, y: number, z: number): V3 => {
      v.set(x, y, z).applyMatrix4(g.matrix);
      return [v.x, v.y, v.z];
    };
    const ringAt = (L: Lines, r: number, z: number, n = 28) => {
      for (let i = 0; i < n; i++) L.seg(...P(Math.cos((i / n) * TAU) * r, Math.sin((i / n) * TAU) * r, z), ...P(Math.cos(((i + 1) / n) * TAU) * r, Math.sin(((i + 1) / n) * TAU) * r, z));
    };
    for (const z of [0, 0.12 * len, 0.5 * len, 0.88 * len, len]) ringAt(z === 0 || z === len ? thick : frame, R, z);
    ringAt(frame, R * 1.12, 0.12 * len);
    ringAt(frame, R * 1.12, 0.88 * len);
    ringAt(frame, R * 0.8, len + 0.3);
    ringAt(thick, R * 0.55, len + 0.6);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      frame.seg(...P(Math.cos(a) * R, Math.sin(a) * R, 0), ...P(Math.cos(a) * R, Math.sin(a) * R, len));
      frame.seg(...P(Math.cos(a) * R, Math.sin(a) * R, len), ...P(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, len + 0.6));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      frame.seg(...P(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, 0.12 * len), ...P(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, 0.88 * len));
    }
    // the rotor at the intake: hub, 16 swept blades, a tip ring
    const rotor = new Lines();
    rotor.circle(0, 0, 0, R * 0.2, 16, true).circle(0, 0, 0, R * 0.9, 40, true);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const c0 = Math.cos(a);
      const s0 = Math.sin(a);
      const c1 = Math.cos(a + 0.5);
      const s1 = Math.sin(a + 0.5);
      rotor.seg(c0 * R * 0.2, s0 * R * 0.2, 0, c1 * R * 0.9, s1 * R * 0.9, 0);
      rotor.seg(Math.cos(a + 0.14) * R * 0.2, Math.sin(a + 0.14) * R * 0.2, 0, Math.cos(a + 0.58) * R * 0.9, Math.sin(a + 0.58) * R * 0.9, 0);
      rotor.seg(c1 * R * 0.9, s1 * R * 0.9, 0, Math.cos(a + 0.58) * R * 0.9, Math.sin(a + 0.58) * R * 0.9, 0);
    }
    gears.push({ M: g.matrix, gx: 0, gy: 0, th: ph, w, base: rotor.positions() });
    // plumbing from the nozzle to the drum
    const p0 = P(0, 0, len + 0.6);
    const toDrum = Math.sqrt(Math.max(0.1, 3.1 * 3.1 - p0[2] * p0[2]));
    sweep(pipes, lerp3(p0, [-toDrum, p0[1], p0[2]], 6), R * 0.28, 8, 1);
  };
  turbine(-7.4, 1.2, -1.9, 1.05, 2.3, 4.5, 0);
  turbine(-7.4, 1.2, -4.3, 1.05, 2.3, -3.9, 1.1);

  // ---- Piston housings and crank-slider rails (the moving parts are in the dynamic buffers below).
  const PIST_R = 4.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.52;
    sweep(frame, lerp3([Math.cos(a) * PIST_R, 0, Math.sin(a) * PIST_R], [Math.cos(a) * PIST_R, 1.5, Math.sin(a) * PIST_R], 6), 0.27, 8, 2);
    thick.circle(Math.cos(a) * PIST_R, 1.5, Math.sin(a) * PIST_R, 0.3, 16);
  }
  const mechs = [
    { x: -2.4, y: 1.0, z: 4.6, dir: -1, R: 0.45, L: 1.7, w: 1.6 },
    { x: 2.4, y: 1.0, z: 4.6, dir: 1, R: 0.45, L: 1.7, w: -1.3 },
    { x: 0, y: 0.7, z: 5.9, dir: 1, R: 0.35, L: 1.3, w: 2.0 },
  ];
  for (const k of mechs) {
    frame.circle(k.x, k.y, k.z, 0.8, 32, true).circle(k.x, k.y, k.z, 0.55, 24, true).circle(k.x, k.y, k.z, 0.12, 12, true);
    for (const dy of [-0.14, 0.14]) frame.seg(k.x, k.y + dy, k.z, k.x + k.dir * 2.9, k.y + dy, k.z);
    frame.seg(k.x + k.dir * 2.9, k.y - 0.3, k.z, k.x + k.dir * 2.9, k.y + 0.3, k.z).seg(k.x, 0, k.z, k.x, k.y - 0.8, k.z);
  }

  mach.add(strokes(thick.positions(), fade, ICE, 0.55, 2.2));
  mach.add(strokes(pipeThick.positions(), fade, CYAN, 0.4, 1.6));
  mach.add(new LineSegments(frame.geometry(), lineMaterial(fade, ICE, 0.17)));
  mach.add(new LineSegments(pipes.geometry(), lineMaterial(fade, CYAN, 0.12)));
  mach.add(new LineSegments(coreSpokes.geometry(), lineMaterial(fade, AMBER, 0.08)));

  // The drum's skin (window cut out) as a faint fill, and the same hull a hair smaller as a depth-only
  // mesh: nothing behind the drum shows through it, so the core is invisible until you see the window.
  const hullTris = (k: number) => {
    const t: number[] = [];
    band(t, 3.1 * k, 0, 3.1 * k, WY0, 0, TAU, 56);
    band(t, 3.1 * k, WY1, 3.1 * k, 6, 0, TAU, 56);
    band(t, 3.1 * k, WY0, 3.1 * k, WY1, OPEN_C + hw, OPEN_C + TAU - hw, 48);
    for (let i = 0; i < 10; i++) {
      const u0 = (i / 13) * 1.25;
      const u1 = ((i + 1) / 13) * 1.25;
      band(t, 3.4 * Math.cos(u0) * k, 6 + Math.sin(u0) * 0.9, 3.4 * Math.cos(u1) * k, 6 + Math.sin(u1) * 0.9, 0, TAU, 40);
    }
    band(t, 3.4 * Math.cos(0.96) * k, 6 + Math.sin(0.96) * 0.9, 0, 6.95, 0, TAU, 40); // cap
    return t;
  };
  const skin = new BufferGeometry();
  skin.setAttribute('position', new Float32BufferAttribute(hullTris(1), 3));
  skin.computeVertexNormals();
  const drumFill = new Mesh(skin, fillMaterial(fade, CYAN, 0.05));
  drumFill.userData.noSample = true;
  mach.add(drumFill);
  mach.add(shell(hullTris(0.965)));

  // ---- Gear trains: pitch radius from tooth count, phases set so teeth interleave, speeds from tooth ratios.
  // Every gear's thin lines live in ONE dynamic buffer (turned on the CPU); only the two big ones get a thick outline.
  const train = (pos: V3, rot: V3, w0: number, spec: { r: number; phi?: number; ring?: boolean; thick?: boolean }[]) => {
    const g = new Group();
    g.position.set(...pos);
    g.rotation.set(...rot);
    g.updateMatrix();
    mach.add(g);
    let prev: { x: number; y: number; rp: number; n: number; w: number; th: number } | null = null;
    for (const s of spec) {
      const n = Math.max(8, Math.round((TAU * s.r) / 0.5));
      const rp = (n * 0.5) / TAU;
      let x = 0;
      let y = 0;
      let w = w0;
      let th = 0;
      if (prev) {
        const phi = s.phi ?? 0;
        x = prev.x + Math.cos(phi) * (prev.rp + rp);
        y = prev.y + Math.sin(phi) * (prev.rp + rp);
        w = (-prev.w * prev.n) / n;
        th = phi + Math.PI + (Math.PI - prev.n * (prev.th - phi)) / n;
      }
      const geo = gearGeo(rp, n, !!s.ring);
      const gear: Gear = { M: g.matrix, gx: x, gy: y, th, w, base: new Float32Array(0) };
      if (s.thick) {
        const o = new Group();
        o.position.set(x, y, 0);
        o.add(strokes(geo.outline, fade, ICE, 0.6, 2.0));
        g.add(o);
        gear.o = o;
      } else {
        for (let i = 0; i < geo.outline.length; i += 6) geo.thin.seg(geo.outline[i], geo.outline[i + 1], geo.outline[i + 2], geo.outline[i + 3], geo.outline[i + 4], geo.outline[i + 5]);
      }
      gear.base = geo.thin.positions();
      gears.push(gear);
      prev = { x, y, rp, n, w, th };
    }
    return g;
  };
  train([-4.7, 3.6, 1.45], [0, 0, 0], 0.3, [{ r: 1.7, thick: true }, { r: 1.0, phi: 0.9 }, { r: 0.6, phi: 0.5 }]);
  train([3.2, 3.2, -3.9], [0, -0.5, 0], -0.22, [{ r: 1.9, thick: true }, { r: 1.2, phi: 1.9 }, { r: 0.7, phi: 0.4 }]);
  const top = train([0, 7.0, 0], [-Math.PI / 2, 0, 0], 0.12, [{ r: 2.4, thick: true }, { r: 0.8, phi: 0.5 }]);
  train([0, 0.22, 0], [-Math.PI / 2, 0, 0], 0.045, [{ r: 5.9, ring: true, thick: true }, { r: 0.9, phi: 1.0 }]);

  // ---- Exploded view: outer plates drift outward and come back (they share the same dynamic buffer).
  const plates: { base: Float32Array; dx: number; dz: number; amp: number; phase: number; anchor: Object3D; ax: number; ay: number; az: number }[] = [];
  const addPlate = (c: number, w: number, y0: number, y1: number, amp: number, phase: number) => {
    const L = new Lines();
    const R = 3.3;
    const t = 0.14;
    const segs = Math.max(8, Math.round(w * 14));
    for (const r of [R, R - t]) {
      L.circle(0, y0, 0, r, segs, false, c - w / 2, c + w / 2).circle(0, y1, 0, r, segs, false, c - w / 2, c + w / 2);
      for (const a of [c - w / 2, c + w / 2]) L.seg(Math.cos(a) * r, y0, Math.sin(a) * r, Math.cos(a) * r, y1, Math.sin(a) * r);
    }
    for (const a of [c - w / 2, c + w / 2]) for (const y of [y0, y1]) L.seg(Math.cos(a) * R, y, Math.sin(a) * R, Math.cos(a) * (R - t), y, Math.sin(a) * (R - t));
    const rows = Math.round((y1 - y0) / 0.4);
    for (let k = 1; k < rows; k++) L.circle(0, y0 + ((y1 - y0) * k) / rows, 0, R, segs, false, c - w / 2, c + w / 2);
    const cols = Math.round(w / 0.16);
    for (let k = 1; k < cols; k++) {
      const a = c - w / 2 + (w * k) / cols;
      L.seg(Math.cos(a) * R, y0, Math.sin(a) * R, Math.cos(a) * R, y1, Math.sin(a) * R);
    }
    const diag: V3[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = c - w / 2 + (w * i) / 14;
      diag.push([Math.cos(a) * (R + 0.02), y0 + ((y1 - y0) * i) / 14, Math.sin(a) * (R + 0.02)]);
    }
    polyline(L, diag);
    for (const a of [c - w * 0.42, c + w * 0.42]) for (const y of [y0 + 0.12, y1 - 0.12]) L.circle(Math.cos(a) * (R + 0.03), y, Math.sin(a) * (R + 0.03), 0.035, 6, true);
    const anchor = new Object3D();
    mach.add(anchor);
    const p = { base: L.positions(), dx: Math.cos(c), dz: Math.sin(c), amp, phase, anchor, ax: Math.cos(c) * R, ay: (y0 + y1) / 2, az: Math.sin(c) * R };
    plates.push(p);
    return p;
  };
  const plateMain = addPlate(OPEN_C + 1.1, 0.8, 0.9, 3.3, 0.45, 0);
  addPlate(OPEN_C - 1.1, 0.8, 2.7, 5.1, 0.4, 1.7);
  addPlate(OPEN_C + 2.3, 1.0, 3.0, 5.4, 0.45, 3.1);
  addPlate(OPEN_C - 2.3, 1.0, 0.7, 3.0, 0.4, 4.4);
  addPlate(OPEN_C + Math.PI, 1.2, 1.2, 4.8, 0.5, 5.6);

  let movLen = 0;
  for (const g of gears) movLen += g.base.length;
  for (const p of plates) movLen += p.base.length;
  const mov = new Float32Array(movLen);
  const movAttr = new BufferAttribute(mov, 3);
  movAttr.setUsage(DynamicDrawUsage);
  const movGeo = new BufferGeometry();
  movGeo.setAttribute('position', movAttr);
  const movObj = new LineSegments(movGeo, lineMaterial(fade, ICE, 0.3));
  movObj.frustumCulled = false;
  mach.add(movObj);

  // ---- Pistons (rod + head) and crank-sliders (crank, connecting rod, slider, wheel spokes).
  const dyn = new Float32Array((6 * 7 + mechs.length * 13) * 6);
  let ki = 0;
  const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    dyn[ki++] = ax;
    dyn[ki++] = ay;
    dyn[ki++] = az;
    dyn[ki++] = bx;
    dyn[ki++] = by;
    dyn[ki++] = bz;
  };
  const fillKin = (t: number) => {
    ki = 0;
    const ph = t * m * 2.0;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.52;
      const px = Math.cos(a) * PIST_R;
      const pz = Math.sin(a) * PIST_R;
      const h = 1.1 + 0.45 * Math.sin(ph + i * 2.09);
      put(px - 0.07, 0.2, pz, px - 0.07, h, pz);
      put(px + 0.07, 0.2, pz, px + 0.07, h, pz);
      put(px - 0.17, h, pz - 0.17, px + 0.17, h, pz - 0.17);
      put(px + 0.17, h, pz - 0.17, px + 0.17, h, pz + 0.17);
      put(px + 0.17, h, pz + 0.17, px - 0.17, h, pz + 0.17);
      put(px - 0.17, h, pz + 0.17, px - 0.17, h, pz - 0.17);
      put(px, h, pz, px, h + 0.35, pz);
    }
    for (const k of mechs) {
      const th = t * m * k.w;
      const pxx = k.x + Math.cos(th) * k.R;
      const pyy = k.y + Math.sin(th) * k.R;
      const dy = pyy - k.y;
      const sx = pxx + k.dir * Math.sqrt(k.L * k.L - dy * dy);
      put(k.x, k.y, k.z, pxx, pyy, k.z);
      put(pxx, pyy, k.z + 0.05, sx, k.y, k.z + 0.05);
      put(pxx, pyy, k.z - 0.05, sx, k.y, k.z - 0.05);
      put(sx - 0.24, k.y - 0.13, k.z, sx + 0.24, k.y - 0.13, k.z);
      put(sx + 0.24, k.y - 0.13, k.z, sx + 0.24, k.y + 0.13, k.z);
      put(sx + 0.24, k.y + 0.13, k.z, sx - 0.24, k.y + 0.13, k.z);
      put(sx - 0.24, k.y + 0.13, k.z, sx - 0.24, k.y - 0.13, k.z);
      put(pxx - 0.06, pyy, k.z, pxx + 0.06, pyy, k.z);
      put(pxx, pyy - 0.06, k.z, pxx, pyy + 0.06, k.z);
      for (let s = 0; s < 4; s++) {
        const a = th + (s * Math.PI) / 2;
        put(k.x + Math.cos(a) * 0.12, k.y + Math.sin(a) * 0.12, k.z, k.x + Math.cos(a) * 0.55, k.y + Math.sin(a) * 0.55, k.z);
      }
    }
  };
  fillKin(0);
  const kinAttr = new BufferAttribute(dyn, 3);
  kinAttr.setUsage(DynamicDrawUsage);
  const kinGeo = new BufferGeometry();
  kinGeo.setAttribute('position', kinAttr);
  const kin = new LineSegments(kinGeo, lineMaterial(fade, ICE, 0.5));
  kin.frustumCulled = false;
  mach.add(kin);

  // ---- The core: gimbal rings around an amber crystal; the crystal is the way in. It only answers from +X.
  const core = new Group();
  core.position.set(0, 3, 0);
  mach.add(core);
  const ringsAnim: { g: Group; rx: number; ry: number; rz: number; x0: number; z0: number }[] = [];
  const addRing = (r: number, flat: boolean, rx: number, ry: number, rz: number, x0: number, z0: number) => {
    const g = new Group();
    core.add(g);
    const bandL = new Lines();
    const st = new Lines();
    st.circle(0, 0, 0, r, 72, !flat);
    bandL.circle(0, 0, 0, r - 0.07, 72, !flat).circle(0, 0, 0, r + 0.07, 72, !flat);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * TAU;
      const l = i % 6 === 0 ? 0.14 : 0.06;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (flat) bandL.seg(c * (r + 0.07), 0, s * (r + 0.07), c * (r + 0.07 + l), 0, s * (r + 0.07 + l));
      else bandL.seg(c * (r + 0.07), s * (r + 0.07), 0, c * (r + 0.07 + l), s * (r + 0.07 + l), 0);
    }
    g.add(strokes(st.positions(), fade, AMBER, 0.75, 2.4));
    g.add(new LineSegments(bandL.geometry(), lineMaterial(fade, AMBER, 0.3)));
    ringsAnim.push({ g, rx, ry, rz, x0, z0 });
  };
  addRing(1.72, false, 0.25, 0.4, 0, 0, 0);
  addRing(1.42, true, 0.5, 0, 0.35, 0.3, 0);
  addRing(1.12, false, -0.6, -0.9, 0.5, 0, 0.4);

  const crystal = new Group();
  core.add(crystal);
  const gem = new LatheGeometry(
    [new Vector2(0.001, -1.05), new Vector2(0.28, -0.5), new Vector2(0.52, 0), new Vector2(0.4, 0.3), new Vector2(0.2, 0.55), new Vector2(0.001, 0.62)],
    8,
  );
  crystal.add(edges(gem, targetMaterial(fade, glow)));
  const inner = new Lines();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    inner.seg(0, -0.7, 0, Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3).seg(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3, 0, 0.45, 0);
  }
  crystal.add(new LineSegments(inner.geometry(), targetMaterial(fade, glow)));
  const gemFill = new Mesh(gem, fillMaterial(fade, AMBER, 0.2));
  gemFill.userData.noSample = true;
  crystal.add(gemFill);
  core.add(halo(fade, AMBER, 120, 0.2));

  // ======================================================================== The amber leak (the clue)
  // Light pours out of the +X window: a soft wedge, a lit fan on the floor, embers, a halo and a lit landing.
  const wx = 3.1 * S;
  const wy0 = WY0 * S;
  const wy1 = WY1 * S;
  const wz = 3.1 * Math.sin(OPEN_HW) * S;
  const wedge: number[] = [];
  frustum(wedge, [[wx, wy0, -wz], [wx, wy0, wz], [wx, wy1, wz], [wx, wy1, -wz]], [[HX - 1, 0, -16], [HX - 1, 0, 16], [HX - 1, 14, 16], [HX - 1, 14, -16]]);
  root.add(beam(wedge, AMBER, 0.11, fade, 'x', HX, wx));
  const spill = new Lines();
  const FX0 = wx + 0.6;
  const FX1 = HX - 1.5;
  const fz = (x: number) => wz + 0.2 + ((x - FX0) / (FX1 - FX0)) * 11;
  for (let i = -6; i <= 6; i++) spill.seg(FX0, 0.04, (i / 6) * (wz + 0.2), FX1, 0.04, (i / 6) * fz(FX1));
  for (let x = FX0; x <= FX1; x += 2.4) spill.seg(x, 0.04, -fz(x), x, 0.04, fz(x));
  spill.rect(7.3, 4.24, -3.1, 9.7, 3.1); // the landing, lit
  for (let x = 7.7; x < 9.7; x += 0.4) spill.seg(x, 4.24, -3.1, x, 4.24, 3.1);
  const spillMat = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  spillMat.colorNode = color(AMBER);
  spillMat.opacityNode = smoothstep(HX, wx, positionWorld.x).mul(sin(time.mul(1.4)).mul(0.15).add(0.7)).mul(0.14).mul(fade);
  const spillObj = new LineSegments(spill.geometry(), spillMat);
  spillObj.userData.noSample = true;
  root.add(spillObj);
  const hot = halo(fade, AMBER, 260, 0.3, 0.2);
  hot.position.set(wx + 0.4, 5.4, 0);
  root.add(hot);
  {
    // embers drifting out along the beam
    const h = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(1));
    const h3 = hash(instanceIndex.add(2));
    const s = fract(time.mul(0.045).add(h));
    const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
    mat.positionNode = vec3(float(wx).add(s.mul(HX - 3 - wx)), float(1).add(h3.mul(9)).add(s.mul(2.5)), h2.sub(0.5).mul(float(wz * 1.5).add(s.mul(20))));
    mat.sizeNode = float(1.3).add(h3.mul(1.8));
    mat.colorNode = color(AMBER);
    mat.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(2).add(h.mul(40))).mul(0.3).add(0.6)).mul(float(1).sub(s)).mul(0.9).mul(fade);
    const embers = new Sprite(mat);
    embers.count = Math.round(260 * D);
    embers.frustumCulled = false;
    embers.userData.noSample = true;
    root.add(embers);
  }

  // ======================================================================== The hangar
  const hall = new Lines(); // structure, thin (CYAN)
  const mark = new Lines(); // markings, windows, hatch (ICE)
  const bold = new Lines(); // columns, trusses, walkway edges (strokes)
  const props = new Lines(); // scaffolds, crates, carts, drums, the console (ICE, brighter)
  const people = new Lines();
  const lit = new Lines(); // the people at the window, lit amber

  // ---- Floor: slab joints, safety circle with warning hatch, lanes, bays, grating.
  hall.rect(-HX, 0, ZB, HX, ZF);
  for (let x = -HX + 6; x < HX - 0.1; x += 6) hall.seg(x, 0, ZB, x, 0, ZF);
  for (let z = ZB + 6; z < ZF - 0.1; z += 6) hall.seg(-HX, 0, z, HX, 0, z);
  mark.circle(0, 0.02, 0, 11.2, 120).circle(0, 0.02, 0, 11.7, 120);
  for (let i = 0; i < 100; i++) {
    const a = (i / 100) * TAU;
    mark.seg(Math.cos(a) * 11.2, 0.02, Math.sin(a) * 11.2, Math.cos(a + 0.06) * 11.7, 0.02, Math.sin(a + 0.06) * 11.7);
  }
  for (const sx of [-1, 1]) for (let z = ZB + 3; z < ZF - 3; z += 4) mark.seg(sx * 30, 0.02, z, sx * 30, 0.02, z + 2); // dashed lane lines
  mark.rect(-27, 0.02, -31, -18, -23).rect(16, 0.02, -29, 28, -13).rect(-9, 0.02, ZB + 1, 9, ZB + 6); // bays
  hatchRect(mark, 16, -29, 28, -27.6, 0.02, 0.7);
  hatchRect(mark, -27, -24.4, -18, -23, 0.02, 0.7);
  grating(mark, -26, -8, -15.5, 0.5, 0.45); // control station
  grating(mark, -4, -33.5, 4, -27, 0.45);
  for (let a = 0; a < 6; a++) mark.seg(-0.6, 0.02, 24 - a * 1.6, 0, 0.02, 25.2 - a * 1.6).seg(0.6, 0.02, 24 - a * 1.6, 0, 0.02, 25.2 - a * 1.6); // floor arrows

  // ---- Walls: columns, girts, cladding seams, clerestory windows.
  const seam = D < 0.7 ? 2.4 : 1.5;
  for (const sx of [-1, 1]) {
    const x = sx * HX;
    for (let z = ZB; z <= ZF + 0.01; z += 6) {
      bold.seg(x, 0, z, x, WALL, z);
      hall.box(Math.min(x, x - sx * 0.7), 0, z - 0.3, 0.7, WALL, 0.6);
    }
    for (const y of [1.2, 4, 8, 12, 16, WALL]) hall.seg(x, y, ZB, x, y, ZF);
    for (let z = ZB + seam; z < ZF; z += seam) hall.seg(x, 1.2, z, x, WALL, z);
    for (let z = ZB; z < ZF - 5; z += 6) {
      vrectX(mark, x, 14.2, z + 0.9, 18, z + 5.1);
      for (let k = 1; k < 4; k++) mark.seg(x, 14.2, z + 0.9 + k * 1.05, x, 18, z + 0.9 + k * 1.05);
      mark.seg(x, 16.1, z + 0.9, x, 16.1, z + 5.1);
    }
  }
  for (const z of [ZB, ZF]) {
    for (let x = -HX; x <= HX + 0.01; x += 6) {
      bold.seg(x, 0, z, x, WALL, z);
      hall.box(x - 0.3, 0, z === ZB ? z : z - 0.7, 0.6, WALL, 0.7);
    }
    for (const y of [1.2, 4, 8, 12, 16, WALL]) hall.seg(-HX, y, z, HX, y, z);
    for (let x = -HX + seam; x < HX; x += seam) hall.seg(x, 1.2, z, x, WALL, z);
  }
  bold.seg(-HX, WALL, ZB, HX, WALL, ZB).seg(-HX, WALL, ZF, HX, WALL, ZF).seg(-HX, WALL, ZB, -HX, WALL, ZF).seg(HX, WALL, ZB, HX, WALL, ZF);
  // back wall: hangar door, personnel door, high windows, extractor fans
  const zw = ZB + 0.05;
  vrectZ(mark, zw, -8, 0, 8, 11);
  vrectZ(mark, zw, -8.4, 0, 8.4, 11.4);
  for (let y = 0.6; y < 11; y += 0.6) mark.seg(-8, y, zw, 8, y, zw);
  mark.seg(0, 0, zw, 0, 11, zw);
  vrectZ(mark, zw, -24.6, 0, -23.2, 2.3);
  vrectZ(mark, zw, -24.3, 2.5, -23.5, 3.1);
  for (const x of [-24, 0, 24]) {
    vrectZ(mark, zw, x - 5, 13.6, x + 5, 17.6);
    for (let k = 1; k < 5; k++) mark.seg(x - 5 + k * 2, 13.6, zw, x - 5 + k * 2, 17.6, zw);
    mark.seg(x - 5, 15.6, zw, x + 5, 15.6, zw);
  }
  for (const x of [-28, 28]) {
    hall.circle(x, 10, ZB + 0.4, 2.4, 28, true).circle(x, 10, ZB + 0.4, 0.5, 10, true).circle(x, 10, ZB + 0.4, 1.4, 20, true);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      hall.seg(x + Math.cos(a) * 0.5, 10 + Math.sin(a) * 0.5, ZB + 0.4, x + Math.cos(a + 0.5) * 2.3, 10 + Math.sin(a + 0.5) * 2.3, ZB + 0.4);
    }
  }
  // front wall: roll-up door (behind the arrival camera)
  vrectZ(mark, ZF - 0.05, -7, 0, 7, 10);
  for (let y = 0.5; y < 10; y += 0.5) mark.seg(-7, y, ZF - 0.05, 7, y, ZF - 0.05);
  // side walls: pipe runs, a cable tray, cabinets
  for (const [y, r] of [[3.0, 0.22], [3.9, 0.14], [12.5, 0.2]] as [number, number][]) {
    const path: V3[] = [];
    for (let z = ZB + 1; z <= ZF - 1; z += 2) path.push([HX - 0.8, y, z]);
    sweep(hall, path, r, 6, 1);
  }
  for (let z = ZB + 1; z < ZF - 1; z += 0.7) hall.seg(-HX + 0.2, 10.4, z, -HX + 1.2, 10.4, z);
  hall.seg(-HX + 0.2, 10.4, ZB + 1, -HX + 0.2, 10.4, ZF - 1).seg(-HX + 1.2, 10.4, ZB + 1, -HX + 1.2, 10.4, ZF - 1);
  for (const sx of [-1, 1]) {
    const x = sx * HX;
    for (let z = ZB + 4; z < ZF - 4; z += 3) {
      const i = Math.round((z - ZB) / 3);
      if (sx > 0 ? i % 7 > 3 : i % 5 > 2) continue;
      hall.box(Math.min(x, x - sx * 1.2), 0, z, 1.2, 2.4, 1.6);
      vrectX(mark, x - sx * 1.2, 0.2, z + 0.15, 2.2, z + 1.45);
      mark.seg(x - sx * 1.2, 1.2, z + 0.8, x - sx * 1.2, 1.5, z + 0.8);
    }
  }

  // ---- Roof: trusses every 8 m, purlins, rafters, skylights with shafts of light, lamps hung below.
  const nodes = Array.from({ length: 13 }, (_, i) => -HX + i * 6);
  for (let k = 0; k <= 9; k++) {
    const z = ZB + k * 8;
    bold.seg(-HX, WALL, z, HX, WALL, z);
    for (let i = 0; i + 1 < nodes.length; i++) {
      bold.seg(nodes[i], topY(nodes[i]), z, nodes[i + 1], topY(nodes[i + 1]), z);
      for (const dz of [-0.3, 0.3]) hall.seg(nodes[i], topY(nodes[i]), z + dz, nodes[i + 1], topY(nodes[i + 1]), z + dz);
      const left = nodes[i] < 0;
      const bx = left ? nodes[i] : nodes[i + 1];
      const tx = left ? nodes[i + 1] : nodes[i];
      hall.seg(bx, WALL, z, tx, topY(tx), z);
    }
    for (const x of nodes) hall.seg(x, WALL, z, x, topY(x), z);
  }
  for (const x of nodes) hall.seg(x, topY(x), ZB, x, topY(x), ZF);
  for (let z = ZB; z < ZF - 0.1; z += 2) hall.seg(-HX, WALL, z, 0, RIDGE, z).seg(HX, WALL, z, 0, RIDGE, z);
  for (let k = 0; k < 9; k += 2) {
    const z0 = ZB + k * 8;
    for (const sx of [-1, 1]) hall.seg(sx * 12, topY(12), z0, sx * 24, topY(24), z0 + 8).seg(sx * 24, topY(24), z0, sx * 12, topY(12), z0 + 8);
  }
  const shafts: number[] = [];
  [0, 1, 2, 3].forEach((k, i) => {
    const sx = i % 2 ? 1 : -1;
    const x0 = sx * 16;
    const x1 = sx * 26;
    const za = ZB + k * 8 + 1.2;
    const zb = ZB + k * 8 + 6.8;
    const c: V3[] = [[x0, topY(x0) + 0.1, za], [x1, topY(x1) + 0.1, za], [x1, topY(x1) + 0.1, zb], [x0, topY(x0) + 0.1, zb]];
    for (let j = 0; j < 4; j++) mark.seg(...c[j], ...c[(j + 1) % 4]);
    for (let q = 1; q < 6; q++) {
      const x = x0 + ((x1 - x0) * q) / 6;
      mark.seg(x, topY(x) + 0.1, za, x, topY(x) + 0.1, zb);
    }
    const lean = 6;
    const floor: V3[] = c.map(([x, , z]) => [x + lean, 0.03, z] as V3);
    frustum(shafts, c, floor);
    for (let j = 0; j < 4; j++) {
      mark.seg(...floor[j], ...floor[(j + 1) % 4]);
      hall.seg(...c[j], ...floor[j]);
    }
    hatchRect(mark, Math.min(floor[0][0], floor[1][0]), za, Math.max(floor[0][0], floor[1][0]), zb, 0.03, 0.9);
  });
  root.add(beam(shafts, ICE, 0.075, fade, 'y', 0, 22));
  const lampPos: number[] = [];
  for (const x of [-24, -12, 0, 12, 24]) {
    for (let z = ZB + 8; z < ZF - 1; z += 12) {
      const y = 15.4;
      hall.seg(x, WALL, z, x, y + 1.2, z);
      hall.circle(x, y + 1.2, z, 0.3, 8).circle(x, y, z, 1.1, 14);
      for (let q = 0; q < 6; q++) {
        const a = (q / 6) * TAU;
        hall.seg(x + Math.cos(a) * 0.3, y + 1.2, z + Math.sin(a) * 0.3, x + Math.cos(a) * 1.1, y, z + Math.sin(a) * 1.1);
      }
      lampPos.push(x, y - 0.2, z);
    }
  }
  root.add(glints(new Float32Array(lampPos), fade, ICE, 70, 0.28));

  // ---- Catwalks: ring at two heights, a bridge to the core window, supports, stairs and ladders.
  const RC = 13.7; // ring centre line
  const RW = 1.8;
  const YA = 4.2;
  const YB = 9.3;
  const ringN = Math.round(110 * Math.max(0.6, D));
  const gapsA = [rad(-35), rad(200), rad(270)].map(norm);
  const gapsB = [rad(200), rad(270)];
  const ringRail = (r: number, y: number, from: number, to: number, gaps: number[], half: number) => {
    const cuts = [from, ...gaps.flatMap((g) => [g - half, g + half]).filter((g) => g > from && g < to).sort((a, b) => a - b), to];
    for (let i = 0; i + 1 < cuts.length; i += 2) {
      const pts = arc(r, cuts[i], cuts[i + 1], Math.max(2, Math.round(((cuts[i + 1] - cuts[i]) * r) / 0.9)));
      rail(hall, pts.map(([x, z]) => [x, y, z] as V3), 1.05, 2);
    }
  };
  const ringDeck = (y: number, from: number, to: number) => {
    const d = deck(hall, arc(RC, from, to, Math.round((ringN * (to - from)) / TAU)), y, RW);
    polyline(bold, d.left);
    polyline(bold, d.right);
  };
  ringDeck(YA, 0, TAU);
  ringDeck(YB, rad(40), rad(320));
  ringRail(RC + RW / 2, YA, 0, TAU, gapsA, 0.09);
  ringRail(RC - RW / 2, YA, rad(8), TAU - rad(8), [], 0);
  ringRail(RC + RW / 2, YB, rad(40), rad(320), gapsB, 0.09);
  ringRail(RC - RW / 2, YB, rad(40), rad(320), [], 0);
  for (let a = rad(15); a < TAU; a += rad(30)) {
    const inB = a > rad(40) && a < rad(320);
    const a2 = a + rad(30);
    for (const r of [RC - 0.8, RC + 0.8]) hall.seg(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * r, inB ? YB : YA, Math.sin(a) * r);
    hall.seg(Math.cos(a) * (RC - 0.8), YA - 0.4, Math.sin(a) * (RC - 0.8), Math.cos(a) * (RC + 0.8), YA - 0.4, Math.sin(a) * (RC + 0.8));
    hall.seg(Math.cos(a) * (RC + 0.8), 0.2, Math.sin(a) * (RC + 0.8), Math.cos(a2) * (RC + 0.8), YA - 0.4, Math.sin(a2) * (RC + 0.8));
    hall.seg(Math.cos(a2) * (RC + 0.8), 0.2, Math.sin(a2) * (RC + 0.8), Math.cos(a) * (RC + 0.8), YA - 0.4, Math.sin(a) * (RC + 0.8));
  }
  // bridge and landing in front of the window
  const brd = deck(hall, Array.from({ length: 11 }, (_, i) => [RC - RW / 2 - i * 0.3, 0] as [number, number]), YA, 2.6);
  polyline(bold, brd.left);
  polyline(bold, brd.right);
  rail(hall, brd.left, 1.05, 1);
  rail(hall, brd.right, 1.05, 1);
  hall.rect(6.9, YA, -3.2, 9.8, 3.2);
  for (let x = 7.2; x < 9.8; x += 0.3) hall.seg(x, YA, -3.2, x, YA, 3.2);
  bold.rect(6.9, YA, -3.2, 9.8, 3.2);
  rail(hall, [[9.8, YA, -3.2], [6.9, YA, -3.2], [6.9, YA, 3.2], [9.8, YA, 3.2]], 1.05, 1);
  for (const [x, z] of [[9.8, -3.2], [9.8, 3.2], [6.9, 3.2], [6.9, -3.2]]) hall.seg(x, 0, z, x, YA, z);
  hall.seg(7.2, YA - 0.4, -3.2, 7.2, 0, 0).seg(7.2, YA - 0.4, 3.2, 7.2, 0, 0);
  hatchRect(mark, 6.9, -3.2, 7.4, 3.2, YA + 0.02, 0.45);
  // stairs up from the floor (right, behind), two ladders up to the top level
  const sa = rad(-35);
  stairs(hall, Math.cos(sa) * 21.5, Math.sin(sa) * 21.5, Math.cos(sa) * (RC + RW / 2), Math.sin(sa) * (RC + RW / 2), 0, YA, 1.5, 17);
  hatchRect(mark, Math.cos(sa) * 21.5 - 1, Math.sin(sa) * 21.5 - 1, Math.cos(sa) * 21.5 + 1, Math.sin(sa) * 21.5 + 1, 0.03, 0.5);
  for (const a of [rad(200), rad(270)]) ladder(hall, Math.cos(a) * (RC + RW / 2 + 0.2), Math.sin(a) * (RC + RW / 2 + 0.2), Math.cos(a), Math.sin(a), YA, YB + 1.1);

  // ---- Overhead crane: runways on the side walls, a bridge that travels, a trolley, hook and load.
  const RX = HX - 2.5;
  for (const sx of [-1, 1]) {
    bold.seg(sx * RX, 16, ZB + 1, sx * RX, 16, ZF - 1);
    for (const dx of [-0.5, 0.5]) hall.seg(sx * (RX + dx), 16, ZB + 1, sx * (RX + dx), 16, ZF - 1).seg(sx * (RX + dx), 15.4, ZB + 1, sx * (RX + dx), 15.4, ZF - 1);
    for (let z = ZB; z <= ZF + 0.01; z += 6) hall.seg(sx * HX, 14.2, z, sx * (RX + 0.5), 15.4, z).seg(sx * HX, 16, z, sx * (RX + 0.5), 15.4, z);
  }
  const bridge = new Group();
  const bT = new Lines();
  const bB = new Lines();
  for (const gz of [-1.1, 1.1]) {
    bT.box(-RX, 16.9, gz - 0.45, 2 * RX, 1.3, 0.9);
    for (let x = -RX; x < RX - 0.1; x += 2.75) {
      const f = Math.round(x / 2.75) % 2;
      bT.seg(x, f ? 16.9 : 18.2, gz - 0.45, x + 2.75, f ? 18.2 : 16.9, gz - 0.45);
    }
    bB.seg(-RX, 16.9, gz, RX, 16.9, gz).seg(-RX, 18.2, gz, RX, 18.2, gz);
  }
  for (const sx of [-1, 1]) {
    bT.box(sx * RX - 0.6, 16, -1.8, 1.2, 0.9, 3.6);
    bB.seg(sx * RX, 16.45, -1.8, sx * RX, 16.45, 1.8);
  }
  bT.box(-RX + 5, 14.4, -1.1, 3.4, 2.5, 2.2); // operator's cab
  vrectZ(bT, 1.1, -RX + 5.4, 15.2, -RX + 7.6, 16.4);
  bridge.add(strokes(bB.positions(), fade, CYAN, 0.5, 1.8));
  bridge.add(new LineSegments(bT.geometry(), lineMaterial(fade, CYAN, 0.2)));
  const trolley = new Group();
  const tL = new Lines();
  tL.box(-1.5, 18.2, -1.5, 3, 0.9, 3);
  tL.circle(0, 18.65, 0, 0.7, 14, true);
  for (const dx of [-0.4, 0.4]) for (const dz of [-0.4, 0.4]) tL.seg(dx, 18.2, dz, dx, 13.4, dz);
  tL.box(-0.5, 12.5, -0.4, 1, 0.9, 0.8);
  tL.circle(0, 12.0, 0, 0.35, 12, true, Math.PI * 0.1, Math.PI * 1.7);
  for (const dx of [-1.4, 1.4]) for (const dz of [-0.8, 0.8]) tL.seg(0, 12.5, 0, dx, 10.6, dz);
  obox(tL, 0, 8.7, 0, 3.2, 1.9, 2.0, 0, true);
  for (let i = 1; i < 6; i++) tL.seg(-1.6 + i * 0.53, 8.7, -1, -1.6 + i * 0.53, 10.6, -1);
  trolley.add(new LineSegments(tL.geometry(), lineMaterial(fade, ICE, 0.32)));
  bridge.add(trolley);
  root.add(bridge);
  const hook = new Object3D();
  hook.position.set(0, 12.2, 0);
  trolley.add(hook);

  // ---- Scaffolding, crates, carts, drums, a control station, cables.
  scaffold(props, -23, -22, 3.2, 2, 10);
  scaffold(props, -6.5, -29.5, 2.4, 1.6, 6, 0.1);
  scaffold(props, 25.5, -6, 1.8, 3.2, 8);
  for (let i = 0; i < Math.round(8 * D); i++) {
    obox(props, 19 + (i % 3) * 3.2 + (rand() - 0.5) * 0.3, 0, -26 + Math.floor(i / 3) * 3, 2.8, 1.8 + (i % 2) * 0.4, 2.6, (rand() - 0.5) * 0.2, true);
  }
  obox(props, 22.5, 1.9, -23, 2.5, 1.5, 2.4, 0.15, true);
  for (let i = 0; i < 4; i++) obox(props, -22.5 + i * 1.5, 0, -28.2, 1.2, 0.15, 1.2); // pallets
  obox(props, -22.5, 0.15, -28.2, 1.0, 1.0, 1.0, 0.1, true);
  obox(props, -21, 0.15, -28.2, 1.0, 0.7, 1.0, -0.1, true);
  for (let i = 0; i < 7; i++) barrel(props, -28 + (i % 4) * 0.7, -15 + Math.floor(i / 4) * 0.7);
  for (const [x, z] of [[-17, -10], [19, 9], [13, -19]]) {
    obox(props, x, 0.3, z, 1.5, 0.9, 0.8, 0.3); // tool cart
    props.seg(x - 0.6, 0.9, z, x - 0.6, 1.6, z).seg(x - 0.6, 1.6, z, x - 1.0, 1.6, z + 0.2);
    for (const dx of [-0.6, 0.6]) props.circle(x + dx, 0.15, z + 0.35, 0.14, 8, true);
  }
  for (const [x, z] of [[-27, -6], [27, -32]]) {
    for (const dz of [-0.5, 0.5]) props.circle(x, 0.9, z + dz, 0.9, 16, true);
    props.circle(x, 0.9, z, 0.45, 12, true);
    for (let a = 0; a < 4; a++) props.seg(x + Math.cos(a * 1.57) * 0.9, 0.9 + Math.sin(a * 1.57) * 0.9, z - 0.5, x + Math.cos(a * 1.57) * 0.9, 0.9 + Math.sin(a * 1.57) * 0.9, z + 0.5);
  }
  obox(props, -22.8, 0, -4, 1.1, 1.0, 5.0); // console desk, three screens, a chair
  for (const dz of [-1.5, 0, 1.5]) {
    vrectX(mark, -22.7, 1.2, -4 + dz - 0.6, 2.1, -4 + dz + 0.6);
    mark.seg(-22.7, 1.65, -4 + dz - 0.6, -22.7, 1.65, -4 + dz + 0.6);
  }
  props.seg(-22.9, 1.0, -6.3, -22.9, 2.1, -6.3).seg(-22.9, 1.0, -1.7, -22.9, 2.1, -1.7);
  obox(props, -20.3, 0.42, -4, 0.5, 0.05, 0.5);
  props.seg(-20.55, 0.46, -4.25, -20.55, 0.95, -4.25).seg(-20.55, 0.46, -3.75, -20.55, 0.95, -3.75).seg(-20.3, 0, -4, -20.3, 0.42, -4);
  props.circle(-20.3, 0.05, -4, 0.3, 5);
  // cables on the floor: from the machine's flange out to the walls and the console
  const cableTo = (a: number, tx: number, tz: number, r: number) => {
    const c: V3[] = [[Math.cos(a) * 11, r, Math.sin(a) * 11]];
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      c.push([Math.cos(a) * 11 + (tx - Math.cos(a) * 11) * t + (rand() - 0.5) * 3, r, Math.sin(a) * 11 + (tz - Math.sin(a) * 11) * t + (rand() - 0.5) * 3]);
    }
    c.push([tx, r, tz]);
    sweep(hall, spline(c, 6), r, 6, 2);
  };
  cableTo(rad(190), -22, -4, 0.25);
  cableTo(rad(130), -24, 12, 0.3);
  cableTo(rad(-80), 4, -32, 0.3);
  cableTo(rad(-30), 27, -14, 0.25);
  cableTo(rad(-50), 20, -26, 0.22);

  // ---- People: the scale. Two at the window (lit), one per level, a walker, a console operator, a pair at a cart.
  lit.person(8.0, YA, -2.1, 1.85, -Math.PI / 2 - 0.15);
  lit.person(7.7, YA, 2.2, 1.8, -Math.PI / 2 + 0.25);
  const onRing = (deg: number, y: number, r: number, h: number, pose: 'stand' | 'walk' = 'stand') => {
    const a = rad(deg);
    people.person(Math.cos(a) * r, y, Math.sin(a) * r, h, Math.atan2(-Math.cos(a), -Math.sin(a)), pose);
  };
  onRing(250, YA, RC, 1.8);
  onRing(300, YA, RC + 0.4, 1.75, 'walk');
  onRing(180, YB, RC, 1.8);
  onRing(228, YB, RC - 0.2, 1.75);
  people.person(-20.3, 0, -4, 1.8, -Math.PI / 2, 'sit'); // at the console
  people.person(-21.5, 0, -19.8, 1.8, Math.PI); // at the scaffold's foot
  people.person(-17, 0, -11.2, 1.8, 0.6).person(-18.1, 0, -10.2, 1.7, -2.6); // pair at the tool cart
  people.person(-22.6, 10, -22.4, 1.8, 0.6); // up on the scaffold
  people.person(20.8, 0, -11.8, 1.8, 2.5);
  const walker = new Group();
  walker.add(strokes(new Lines().person(16.5, 0, 0, 1.8, Math.PI, 'walk').positions(), fade, ICE, 0.95, 2.0));
  root.add(walker);
  root.add(strokes(people.positions(), fade, ICE, 0.9, 2.0));
  root.add(strokes(lit.positions(), fade, AMBER, 0.85, 2.0));

  // ---- Dust hanging in the air of the hall.
  {
    const h = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(1));
    const h3 = hash(instanceIndex.add(2));
    const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
    mat.positionNode = vec3(fract(h.add(time.mul(0.0015))).sub(0.5).mul(2 * HX - 2), fract(h2.add(time.mul(0.006))).mul(WALL), fract(h3).sub(0.5).mul(ZF - ZB - 2).add((ZF + ZB) / 2));
    mat.sizeNode = float(1.1).add(h3.mul(1.2));
    mat.colorNode = color(ICE);
    mat.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(0.7).add(h.mul(40))).mul(0.3).add(0.45)).mul(0.5).mul(fade);
    const dust = new Sprite(mat);
    dust.count = Math.round(500 * D);
    dust.frustumCulled = false;
    dust.userData.noSample = true;
    root.add(dust);
  }

  root.add(strokes(bold.positions(), fade, CYAN, 0.42, 1.5));
  root.add(new LineSegments(hall.geometry(), lineMaterial(fade, CYAN, 0.14)));
  root.add(new LineSegments(mark.geometry(), lineMaterial(fade, ICE, 0.22)));
  root.add(new LineSegments(props.geometry(), lineMaterial(fade, ICE, 0.24)));

  // ======================================================================== Labels
  const mk = (x: number, y: number, z: number, parent: Object3D = root) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const labels = [
    { object: mk(wx + 0.4, 5.4, 0), pt: 'FUGA DE LUZ · SINAL FRACO', en: 'LIGHT LEAK · FAINT SIGNAL' },
    { object: mk(0, 12, 0), pt: 'REATOR PRINCIPAL · 4,2 TW', en: 'MAIN REACTOR · 4.2 TW' },
    { object: mk(0, 0, 1.2, top), pt: 'ENGRENAGEM-MESTRA · 12 RPM', en: 'MASTER GEAR · 12 RPM' },
    { object: mk(Math.cos(0.52 + (TAU * 5) / 6) * PIST_R, 1.9, Math.sin(0.52 + (TAU * 5) / 6) * PIST_R, mach), pt: 'BANCO DE PISTÕES · 06', en: 'PISTON BANK · 06' },
    { object: plateMain.anchor, pt: 'PLACA EXTERNA · DESACOPLADA', en: 'OUTER PLATE · DECOUPLED' },
    { object: hook, pt: 'PONTE ROLANTE · 40 t', en: 'OVERHEAD CRANE · 40 t' },
  ];

  return {
    id: 'machine',
    exposure: 0.7,
    root,
    fade,
    glow,
    radius: 33,
    view: { distance: 28, minDistance: 8.5, maxDistance: 31, pitch: 0.08, height: 3 * S },
    target: { object: core, radius: 1.3, facing: new Vector3(1, 0, 0) },
    caption: {
      pt: 'O hangar. A máquina pulsa; o núcleo fica escondido em algum lado.',
      en: 'The hangar. The machine pulses; its core hides somewhere around it.',
    },
    labels,
    update(t) {
      let o = 0;
      for (const g of gears) {
        const a = g.th + g.w * t * m;
        if (g.o) g.o.rotation.z = a;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const e = g.M.elements;
        const b = g.base;
        for (let i = 0; i < b.length; i += 3) {
          const lx = b[i] * c - b[i + 1] * s + g.gx;
          const ly = b[i] * s + b[i + 1] * c + g.gy;
          mov[o++] = e[0] * lx + e[4] * ly + e[12];
          mov[o++] = e[1] * lx + e[5] * ly + e[13];
          mov[o++] = e[2] * lx + e[6] * ly + e[14];
        }
      }
      for (const p of plates) {
        const s = 0.5 + 0.5 * Math.sin(t * 0.4 * m + p.phase);
        const e = s * s * (3 - 2 * s) * p.amp;
        const ox = p.dx * e;
        const oz = p.dz * e;
        for (let i = 0; i < p.base.length; i += 3) {
          mov[o++] = p.base[i] + ox;
          mov[o++] = p.base[i + 1];
          mov[o++] = p.base[i + 2] + oz;
        }
        p.anchor.position.set(p.ax + ox, p.ay, p.az + oz);
      }
      movAttr.needsUpdate = true;
      fillKin(t);
      kinAttr.needsUpdate = true;
      for (const r of ringsAnim) r.g.rotation.set(r.x0 + t * r.rx * m, t * r.ry * m, r.z0 + t * r.rz * m);
      crystal.rotation.y = t * 0.5 * m;
      bridge.position.z = -2 + 11 * Math.sin(t * 0.05 * m);
      trolley.position.x = 20.5 + 3.5 * Math.sin(t * 0.09 * m + 1.3);
      walker.rotation.y = (t * 0.9 * m) / 16.5;
      walker.position.y = Math.abs(Math.sin(t * 3.2 * m)) * 0.04;
    },
  };
}
