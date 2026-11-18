import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  LatheGeometry,
  LineSegments,
  Mesh,
  Object3D,
  PointsNodeMaterial,
  Sprite,
  Vector2,
} from 'three/webgpu';
import { color, float, instancedBufferAttribute, length, sin, smoothstep, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, edges, fillMaterial, lineMaterial, strokes, targetMaterial, type Fade, horizon } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const TAU = Math.PI * 2;
const PITCH = 0.5; // gear circular pitch: equal for every gear, so any two can mesh
const OPEN_C = Math.PI / 2; // the core opening faces +Z (angle PI/2 in the XZ plane)
const OPEN_HW = 0.62;
type V3 = [number, number, number];

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
      // any vector not parallel to the tangent
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

/** Circle arc around Y that leaves the front opening free. */
function arcRing(L: Lines, y: number, r: number, segs: number) {
  L.circle(0, y, 0, r, segs, false, OPEN_C + OPEN_HW, OPEN_C + TAU - OPEN_HW);
}

/** Gear in the XY plane: tooth profile with real flanks, rim, hub and lightening windows. */
function gearGeo(rp: number, n: number, ring: boolean) {
  const tip = rp + 0.1;
  const root = rp - 0.1;
  const step = TAU / n;
  const outline = new Lines();
  const det = new Lines();
  const P = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  const S = (L: Lines, A: [number, number], B: [number, number]) => L.seg(A[0], A[1], 0, B[0], B[1], 0);
  for (let i = 0; i < n; i++) {
    const a = i * step;
    const p0 = P(a - 0.3 * step, root);
    const p1 = P(a - 0.17 * step, tip);
    const p2 = P(a + 0.17 * step, tip);
    const p3 = P(a + 0.3 * step, root);
    const p4 = P(a + 0.7 * step, root);
    S(outline, p0, p1);
    S(outline, p1, p2);
    S(outline, p2, p3);
    S(outline, p3, p4);
    // chamfer line just inside the flank
    S(det, P(a - 0.3 * step, root * 0.94), P(a + 0.3 * step, root * 0.94));
  }
  const segs = Math.min(160, n * 2);
  if (ring) {
    for (const k of [0.97, 0.92, 0.86]) det.circle(0, 0, 0, root * k, segs, true);
    for (let i = 0; i < n; i++) S(det, P((i + 0.5) * step, root * 0.86), P((i + 0.5) * step, root * 0.92));
  } else {
    det.circle(0, 0, 0, root * 0.9, segs, true).circle(0, 0, 0, root * 0.82, segs, true);
    det.circle(0, 0, 0, root * 0.2, 24, true).circle(0, 0, 0, root * 0.09, 16, true);
    const k = Math.max(5, Math.min(10, Math.round(n / 5)));
    for (let i = 0; i < k; i++) {
      const c = ((i + 0.5) / k) * TAU;
      const hw = (TAU / k) * 0.5 - 0.1;
      det.circle(0, 0, 0, root * 0.3, 12, true, c - hw, c + hw).circle(0, 0, 0, root * 0.73, 20, true, c - hw, c + hw);
      S(det, P(c - hw, root * 0.3), P(c - hw, root * 0.73));
      S(det, P(c + hw, root * 0.3), P(c + hw, root * 0.73));
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

/** [4] On that table: a giant machine. Gears mesh and turn, plates drift apart and close again, and a core burns amber. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(99);
  const D = ctx.detail;
  const m = ctx.reducedMotion ? 0.3 : 1;

  const thick = new Lines(); // silhouettes (2-3 px)
  const pipeThick = new Lines(); // main pipe centre lines
  const frame = new Lines(); // structure + dense detail (ICE)
  const pipes = new Lines(); // pipes and cables (CYAN)
  const hw = OPEN_HW;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  // ---- Platform: degree scale, plating, circuit traces.
  thick.circle(0, 0, 0, 7.3, 120).circle(0, 0, 0, 7.0, 120).circle(0, 0, 0, 3.45, 80).circle(0, -0.3, 0, 7.3, 120);
  for (let r = 3.7; r <= 6.7; r += 0.3) frame.circle(0, 0, 0, r, 96);
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU;
    const l = i % 5 === 0 ? 0.3 : 0.14;
    frame.seg(Math.cos(a) * 7.0, 0, Math.sin(a) * 7.0, Math.cos(a) * (7.0 + l), 0, Math.sin(a) * (7.0 + l));
  }
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    frame.seg(Math.cos(a) * 3.45, 0, Math.sin(a) * 3.45, Math.cos(a) * 7.0, 0, Math.sin(a) * 7.0);
    frame.seg(Math.cos(a) * 7.3, 0, Math.sin(a) * 7.3, Math.cos(a) * 7.3, -0.3, Math.sin(a) * 7.3);
  }
  const traces = Math.round(40 * D);
  for (let t = 0; t < traces; t++) {
    let r = 3.9 + rand() * 2.6;
    let a = rand() * TAU;
    for (let k = 0; k < 7; k++) {
      if (k % 2 === 0) {
        const nr = Math.max(3.6, Math.min(6.8, r + (rand() - 0.5) * 1.2));
        frame.seg(Math.cos(a) * r, 0, Math.sin(a) * r, Math.cos(a) * nr, 0, Math.sin(a) * nr);
        r = nr;
      } else {
        const na = a + (rand() - 0.3) * 0.25;
        frame.circle(0, 0, 0, r, 5, false, a, na);
        a = na;
      }
    }
  }

  // ---- Drum: panel seams, ribs, flanges, hatch bands, bezel around the opening (front = +Z).
  for (let y = 0; y <= 6.001; y += 0.25) arcRing(frame, y, 3.1, 72);
  for (const y of [0, 0.5, 5.5, 6]) {
    const r = y === 0 || y === 6 ? 3.45 : 3.25;
    arcRing(thick, y, r, 72);
  }
  const ribN = Math.round(24 + 24 * D);
  for (let i = 0; i < ribN; i++) {
    const a = (i / ribN) * TAU;
    if (angDiff(a, OPEN_C) < hw) continue;
    const c = Math.cos(a) * 3.1;
    const s = Math.sin(a) * 3.1;
    (i % 3 === 0 ? thick : frame).seg(c, 0.5, s, c, 5.5, s);
  }
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j < 20; j++) {
      const a = ((j + (k % 2) * 0.5) / 20) * TAU;
      if (angDiff(a, OPEN_C) < hw) continue;
      frame.seg(Math.cos(a) * 3.14, k, Math.sin(a) * 3.14, Math.cos(a) * 3.14, k + 1, Math.sin(a) * 3.14);
    }
  }
  for (let j = 0; j < 96; j++) {
    const a = (j / 96) * TAU;
    const b = a + 0.05;
    if (angDiff(a, OPEN_C) < hw) continue;
    frame.seg(Math.cos(a) * 3.12, 0.5, Math.sin(a) * 3.12, Math.cos(b) * 3.12, 1.0, Math.sin(b) * 3.12);
    frame.seg(Math.cos(a) * 3.12, 5.0, Math.sin(a) * 3.12, Math.cos(b) * 3.12, 5.5, Math.sin(b) * 3.12);
    frame.seg(Math.cos(a) * 3.5, 0, Math.sin(a) * 3.5, Math.cos(a) * 3.5, 0.18, Math.sin(a) * 3.5);
  }
  for (const s of [-1, 1]) {
    const a = OPEN_C + s * hw;
    for (const r of [3.1, 3.4]) thick.seg(Math.cos(a) * r, 0.9, Math.sin(a) * r, Math.cos(a) * r, 5.1, Math.sin(a) * r);
    for (const y of [0.9, 5.1]) thick.seg(Math.cos(a) * 3.1, y, Math.sin(a) * 3.1, Math.cos(a) * 3.4, y, Math.sin(a) * 3.4);
  }
  for (const y of [0.9, 5.1]) thick.circle(0, y, 0, 3.4, 24, false, OPEN_C - hw, OPEN_C + hw);
  for (let i = 0; i <= 10; i++) {
    const a = OPEN_C - hw + (i / 10) * 2 * hw;
    frame.seg(Math.cos(a) * 3.1, 0.9, Math.sin(a) * 3.1, Math.cos(a) * 3.4, 0.9, Math.sin(a) * 3.4);
    frame.seg(Math.cos(a) * 3.1, 5.1, Math.sin(a) * 3.1, Math.cos(a) * 3.4, 5.1, Math.sin(a) * 3.4);
  }

  // ---- Reactor chamber (seen through the opening): inner wall, struts, conduits to the core.
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

  // ---- Gantries: lattice towers, a truss beam, hanging cable bundles.
  for (const s of [-1, 1]) {
    const x0 = s * 5;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) thick.seg(x0 + dx, 0, dz, x0 + dx, 7.6, dz);
    for (let y = 0; y < 7.6; y += 0.4) {
      frame.rect(x0 - 0.5, y, -0.5, x0 + 0.5, 0.5);
      frame.seg(x0 - 0.5, y, -0.5, x0 + 0.5, y + 0.4, -0.5).seg(x0 + 0.5, y, -0.5, x0 - 0.5, y + 0.4, -0.5);
      frame.seg(x0 - 0.5, y, 0.5, x0 + 0.5, y + 0.4, 0.5).seg(x0 + 0.5, y, 0.5, x0 - 0.5, y + 0.4, 0.5);
      frame.seg(x0 - 0.5, y, -0.5, x0 - 0.5, y + 0.4, 0.5).seg(x0 + 0.5, y, 0.5, x0 + 0.5, y + 0.4, -0.5);
    }
    thick.rect(x0 - 0.7, 7.6, -0.7, x0 + 0.7, 0.7).rect(x0 - 0.8, 0.0, -0.8, x0 + 0.8, 0.8);
    sweep(frame, lerp3([x0, 0.1, 0.9], [x0, 7.4, 0.9], 14), 0.09, 6, 2);
  }
  thick.box(-5.5, 7.6, -0.3, 11, 0.55, 0.6);
  for (let x = -5.5; x < 5.5; x += 0.55) {
    frame.seg(x, 7.6, -0.3, x + 0.55, 8.15, -0.3).seg(x + 0.55, 7.6, -0.3, x, 8.15, -0.3);
    frame.seg(x, 7.6, 0.3, x + 0.55, 8.15, 0.3).seg(x + 0.55, 7.6, 0.3, x, 8.15, 0.3);
  }
  const cable = (a: V3, b: V3, sag: number, strands: number, spread: number) => {
    for (let s = 0; s < strands; s++) {
      const ox = (rand() - 0.5) * spread;
      const oz = (rand() - 0.5) * spread;
      const pts: V3[] = [];
      for (let i = 0; i <= 28; i++) {
        const t = i / 28;
        pts.push([a[0] + (b[0] - a[0]) * t + ox, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t + oz]);
      }
      polyline(pipes, pts);
    }
  };
  const nS = Math.round(3 + 4 * D);
  for (const s of [-1, 1]) {
    cable([s * 5, 7.5, 0.5], [s * 1.2, 6.9, 0.3], 0.7, nS, 0.14);
    cable([s * 5, 6.2, -0.5], [s * 3.2, 4.4, -1.2], 0.5, nS, 0.12);
    cable([s * 5.4, 3.0, 0.2], [s * 3.3, 1.4, 1.2], 0.4, nS, 0.12);
  }
  cable([-5, 7.1, -0.7], [5, 7.1, -0.7], 1.4, nS + 2, 0.18);
  cable([-3.4, 0.6, -3.0], [3.4, 0.6, -3.0], 0.0, nS, 0.2);

  // ---- Pipes: helices around the drum, roof and wall runs, floor manifold.
  for (let p = 0; p < 3; p++) {
    const h: V3[] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU * 1.7 + p * 2.09;
      h.push([Math.cos(a) * 3.62, 0.4 + (i / 120) * 5.2, Math.sin(a) * 3.62]);
    }
    polyline(pipeThick, h);
    sweep(pipes, h.filter((_, i) => i % 3 === 0), 0.08, 6, 2);
  }
  const runs: V3[][] = [
    [[-5.6, 0.2, 2.0], [-6.0, 1.8, 1.6], [-5.2, 4.0, 1.0], [-3.9, 5.0, 0.8], [-3.2, 5.2, 0.6]],
    [[5.6, 0.2, 2.0], [6.0, 1.8, 1.6], [5.2, 4.0, 1.0], [3.9, 5.0, 0.8], [3.2, 5.2, 0.6]],
    [[-3.0, 0.2, -4.5], [-3.8, 2.5, -4.0], [-3.6, 5.0, -3.0], [-2.0, 6.3, -1.8]],
    [[3.0, 0.2, -4.5], [3.8, 2.5, -4.0], [3.6, 5.0, -3.0], [2.0, 6.3, -1.8]],
    [[-2.4, 6.5, 0.4], [-1.0, 7.7, 0.7], [1.0, 7.7, 0.7], [2.4, 6.5, 0.4]],
  ];
  for (const c of runs) {
    const path = spline(c, 10);
    polyline(pipeThick, path);
    sweep(pipes, path, 0.15, 8, 2);
  }
  const man = 12;
  for (let i = 0; i < man; i++) {
    const a = (i / man) * TAU + 0.26;
    sweep(pipes, lerp3([Math.cos(a) * 3.5, 0.2, Math.sin(a) * 3.5], [Math.cos(a) * 5.4, 0.2, Math.sin(a) * 5.4], 8), 0.1, 6, 1);
  }

  // ---- Piston housings and crank-slider rails (the moving parts are in the dynamic buffer below).
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

  root.add(strokes(thick.positions(), fade, ICE, 0.55, 2.2));
  root.add(strokes(pipeThick.positions(), fade, CYAN, 0.4, 1.6));
  root.add(new LineSegments(frame.geometry(), lineMaterial(fade, ICE, 0.17)));
  root.add(new LineSegments(pipes.geometry(), lineMaterial(fade, CYAN, 0.12)));
  const drum = new Mesh(new CylinderGeometry(3.1, 3.1, 6, 48, 1, true, hw, TAU - 2 * hw).translate(0, 3, 0), fillMaterial(fade, CYAN, 0.05));
  drum.userData.noSample = true;
  root.add(drum);

  // ---- Gear trains: pitch radius from tooth count, phases set so teeth interleave, speeds from tooth ratios.
  const anim: { obj: Object3D; w: number; th: number }[] = [];
  const train = (pos: V3, rot: V3, w0: number, spec: { r: number; phi?: number; ring?: boolean; thick?: boolean }[]) => {
    const g = new Group();
    g.position.set(...pos);
    g.rotation.set(...rot);
    root.add(g);
    let prev: { x: number; y: number; rp: number; n: number; w: number; th: number } | null = null;
    for (const s of spec) {
      const n = Math.max(8, Math.round((TAU * s.r) / PITCH));
      const rp = (n * PITCH) / TAU;
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
      const o = new Group();
      o.position.set(x, y, 0);
      if (s.thick) {
        o.add(strokes(geo.outline, fade, ICE, 0.6, 2.0));
        o.add(new LineSegments(geo.thin.geometry(), lineMaterial(fade, ICE, 0.25)));
      } else {
        for (let i = 0; i < geo.outline.length; i += 6) geo.thin.seg(geo.outline[i], geo.outline[i + 1], geo.outline[i + 2], geo.outline[i + 3], geo.outline[i + 4], geo.outline[i + 5]);
        o.add(new LineSegments(geo.thin.geometry(), lineMaterial(fade, ICE, 0.3)));
      }
      g.add(o);
      anim.push({ obj: o, w, th });
      prev = { x, y, rp, n, w, th };
    }
    return g;
  };
  train([-4.7, 3.6, 1.45], [0, 0, 0], 0.3, [{ r: 1.7, thick: true }, { r: 1.0, phi: 0.9 }, { r: 0.6, phi: 0.5 }]);
  train([4.6, 2.7, 1.45], [0, 0, 0], -0.22, [{ r: 1.9, thick: true }, { r: 1.2, phi: 1.9 }, { r: 0.7, phi: 0.4 }]);
  train([-4.3, 2.8, -1.9], [0, 0.4, 0], 0.4, [{ r: 1.3 }, { r: 0.8, phi: -0.6 }]);
  const top = train([0, 7.0, 0], [-Math.PI / 2, 0, 0], 0.12, [{ r: 2.4, thick: true }, { r: 0.8, phi: 0.5 }]);
  train([0, 0.22, 0], [-Math.PI / 2, 0, 0], 0.045, [{ r: 5.9, ring: true, thick: true }, { r: 0.9, phi: 1.0 }]);

  // ---- Exploded view: outer plates drift outward and come back.
  const plates: { obj: Object3D; dx: number; dy: number; dz: number; amp: number; phase: number }[] = [];
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
    const o = new LineSegments(L.geometry(), lineMaterial(fade, ICE, 0.28));
    root.add(o);
    plates.push({ obj: o, dx: Math.cos(c), dy: 0, dz: Math.sin(c), amp, phase });
    const anchor = new Object3D();
    anchor.position.set(Math.cos(c) * R, (y0 + y1) / 2, Math.sin(c) * R);
    o.add(anchor);
    return anchor;
  };
  const plateAnchor = addPlate(OPEN_C + 1.1, 0.8, 0.9, 3.3, 0.45, 0);
  addPlate(OPEN_C - 1.1, 0.8, 2.7, 5.1, 0.4, 1.7);
  addPlate(OPEN_C + 2.3, 1.0, 3.0, 5.4, 0.45, 3.1);
  addPlate(OPEN_C - 2.3, 1.0, 0.7, 3.0, 0.4, 4.4);
  addPlate(OPEN_C + Math.PI, 1.2, 1.2, 4.8, 0.5, 5.6);

  // ---- Dynamic buffer: pistons (rod + head) and crank-sliders (crank, connecting rod, slider, wheel spokes).
  const SEGS = 6 * 7 + mechs.length * 13;
  const dyn = new Float32Array(SEGS * 6);
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
  root.add(kin);

  // ---- The core: gimbal rings around an amber crystal; the crystal is the way in.
  const core = new Group();
  core.position.set(0, 3, 0);
  root.add(core);
  root.add(new LineSegments(coreSpokes.geometry(), lineMaterial(fade, AMBER, 0.08)));
  const ringsAnim: { g: Group; rx: number; ry: number; rz: number; x0: number; z0: number }[] = [];
  const addRing = (r: number, flat: boolean, rx: number, ry: number, rz: number, x0: number, z0: number) => {
    const g = new Group();
    core.add(g);
    const band = new Lines();
    const st = new Lines();
    st.circle(0, 0, 0, r, 72, !flat);
    band.circle(0, 0, 0, r - 0.07, 72, !flat).circle(0, 0, 0, r + 0.07, 72, !flat);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * TAU;
      const l = i % 6 === 0 ? 0.14 : 0.06;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (flat) band.seg(c * (r + 0.07), 0, s * (r + 0.07), c * (r + 0.07 + l), 0, s * (r + 0.07 + l));
      else band.seg(c * (r + 0.07), s * (r + 0.07), 0, c * (r + 0.07 + l), s * (r + 0.07 + l), 0);
    }
    g.add(strokes(st.positions(), fade, AMBER, 0.75, 2.4));
    g.add(new LineSegments(band.geometry(), lineMaterial(fade, AMBER, 0.3)));
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
  crystal.add(halo(fade, AMBER, 120, 0.2));

  // Anchors for the HUD callouts.
  const mk = (x: number, y: number, z: number, parent: Object3D = root) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const labels = [
    { object: mk(0, 0.4, 0, crystal), pt: 'ANOMALIA · SINAL FRACO', en: 'ANOMALY · FAINT SIGNAL' },
    { object: mk(1.9, 4.3, 0.6), pt: 'ANEL DO REATOR · 4,2 TW', en: 'REACTOR RING · 4.2 TW' },
    { object: mk(0, 0, 1.2, top), pt: 'ENGRENAGEM-MESTRA · 12 RPM', en: 'MASTER GEAR · 12 RPM' },
    { object: mk(Math.cos(0.52 + (TAU * 5) / 6) * PIST_R, 1.9, Math.sin(0.52 + (TAU * 5) / 6) * PIST_R), pt: 'BANCO DE PISTÕES · 06', en: 'PISTON BANK · 06' },
    { object: plateAnchor, pt: 'PLACA EXTERNA · DESACOPLADA', en: 'OUTER PLATE · DECOUPLED' },
  ];

  root.add(horizon(fade, 8));
  return {
    id: 'machine',
    exposure: 0.85,
    root,
    fade,
    glow,
    radius: 8,
    view: { distance: 10, minDistance: 4.5, maxDistance: 20, pitch: -0.04, height: 3.4 },
    target: { object: crystal, radius: 0.7 },
    labels,
    update(t) {
      for (const g of anim) g.obj.rotation.z = g.th + g.w * t * m;
      for (const p of plates) {
        const s = 0.5 + 0.5 * Math.sin(t * 0.4 * m + p.phase);
        const e = s * s * (3 - 2 * s) * p.amp;
        p.obj.position.set(p.dx * e, 0, p.dz * e);
      }
      for (const r of ringsAnim) r.g.rotation.set(r.x0 + t * r.rx * m, t * r.ry * m, r.z0 + t * r.rz * m);
      fillKin(t);
      kinAttr.needsUpdate = true;
      crystal.rotation.y = t * 0.5 * m;
    },
  };
}
