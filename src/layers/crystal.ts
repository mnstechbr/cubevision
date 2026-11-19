import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  LineBasicNodeMaterial,
  LineSegments,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PointsNodeMaterial,
  Sprite,
  Vector3,
} from 'three/webgpu';
import {
  color,
  cos,
  float,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  mix,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, fillMaterial, lineMaterial, strokes, targetMaterial, type Fade } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const TAU = Math.PI * 2;
const VIOLET = new Color(0xb89cff);
type V3 = [number, number, number];

// (height fraction, radius fraction): flat termination with stepped facets, then a pointed tip. Radius 0 is the apex.
const PROFILE: [number, number][] = [[0, 0], [0.07, 0.86], [0.15, 1], [0.7, 1], [0.78, 0.95], [0.85, 0.72], [0.93, 0.4], [1, 0]];
const radiusAt = (f: number) => {
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [y0, r0] = PROFILE[i];
    const [y1, r1] = PROFILE[i + 1];
    if (f <= y1) return r0 + ((r1 - r0) * (f - y0)) / (y1 - y0);
  }
  return 0;
};
const sm = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const rad = (deg: number) => (deg * Math.PI) / 180;

interface Cry {
  base: V3;
  r: number;
  h: number;
  sides: number;
  twist?: number;
}
interface Out {
  bold?: Lines; // silhouette edges
  thin?: Lines; // ring polygons, facet diagonals, striations
  tri?: number[]; // faces for the fresnel fill
  striae?: number; // rows of striations on the prism
}

/** A faceted crystal: prism with a stepped, zig-zag termination. Returns its rings (the last one is the tip). */
function crystal(o: Cry, out: Out, rand: () => number): V3[][] {
  const { sides: n } = o;
  const jr = Array.from({ length: n }, () => 1 + (rand() - 0.5) * 0.12);
  const ja = Array.from({ length: n }, () => (rand() - 0.5) * 0.12);
  const place = (x: number, y: number, z: number): V3 => [x + o.base[0], y + o.base[1], z + o.base[2]];
  const rings: V3[][] = PROFILE.map(([f, rf], k) => {
    const y = f * o.h;
    if (rf === 0) return [place(0, y, 0)];
    return Array.from({ length: n }, (_, s) => {
      let r = o.r * rf * (k >= 3 ? jr[s] : 1);
      if (k === 5) r *= s % 2 ? 0.88 : 1.08; // zig-zag step in the termination
      const a = (s / n) * TAU + (o.twist ?? 0) + (k >= 4 ? ja[s] : 0);
      return place(Math.cos(a) * r, y, Math.sin(a) * r);
    });
  });
  const tri = (a: V3, b: V3, c: V3) => out.tri?.push(...a, ...b, ...c);
  for (let k = 0; k < rings.length; k++) {
    const A = rings[k];
    if (A.length > 1) for (let s = 0; s < n; s++) out.thin?.seg(...A[s], ...A[(s + 1) % n]);
    const B = rings[k + 1];
    if (!B) continue;
    for (let s = 0; s < n; s++) {
      const s1 = (s + 1) % n;
      if (B.length === 1) {
        out.bold?.seg(...A[s], ...B[0]);
        tri(A[s], A[s1], B[0]);
      } else if (A.length === 1) {
        out.bold?.seg(...A[0], ...B[s]);
        tri(A[0], B[s1], B[s]);
      } else {
        (k >= 2 && k <= 6 ? out.bold : out.thin)?.seg(...A[s], ...B[s]);
        if (k >= 3) out.thin?.seg(...A[s], ...B[s1]);
        tri(A[s], A[s1], B[s]);
        tri(A[s1], B[s1], B[s]);
      }
    }
    // joint rings of the prism in bold
    if (k === 2 || k === 3) for (let s = 0; s < n; s++) out.bold?.seg(...A[s], ...A[(s + 1) % n]);
  }
  const rows = out.striae ?? 0;
  if (rows) {
    const A = rings[2];
    const B = rings[3];
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      for (let s = 0; s < n; s++) {
        const s1 = (s + 1) % n;
        const p = (v: number): V3 => [A[v][0] + (B[v][0] - A[v][0]) * t, A[v][1] + (B[v][1] - A[v][1]) * t, A[v][2] + (B[v][2] - A[v][2]) * t];
        out.thin?.seg(...p(s), ...p(s1));
      }
    }
  }
  return rings;
}

/** A small crystal for the clusters: hexagonal prism with a pyramid tip, along `dir`. */
function prism(L: Lines, tri: number[], base: V3, dir: V3, r: number, h: number, rand: () => number) {
  const ref: V3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = dir[1] * ref[2] - dir[2] * ref[1];
  let uy = dir[2] * ref[0] - dir[0] * ref[2];
  let uz = dir[0] * ref[1] - dir[1] * ref[0];
  const ul = Math.hypot(ux, uy, uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const wx = dir[1] * uz - dir[2] * uy;
  const wy = dir[2] * ux - dir[0] * uz;
  const wz = dir[0] * uy - dir[1] * ux;
  const at = (f: number, a: number, rr: number): V3 => [
    base[0] + dir[0] * h * f + (ux * Math.cos(a) + wx * Math.sin(a)) * rr,
    base[1] + dir[1] * h * f + (uy * Math.cos(a) + wy * Math.sin(a)) * rr,
    base[2] + dir[2] * h * f + (uz * Math.cos(a) + wz * Math.sin(a)) * rr,
  ];
  const tip: V3 = at(1, 0, r * 0.12);
  const shoulder = 0.7 + rand() * 0.08;
  const b: V3[] = [];
  const s: V3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + rand() * 0.2;
    b.push(at(0, a, r * (0.95 + rand() * 0.1)));
    s.push(at(shoulder, a, r * (0.9 + rand() * 0.12)));
  }
  for (let k = 0; k < 6; k++) {
    const k1 = (k + 1) % 6;
    L.seg(...b[k], ...s[k]).seg(...s[k], ...s[k1]).seg(...s[k], ...tip).seg(...b[k], ...b[k1]);
    tri.push(...b[k], ...b[k1], ...s[k1], ...b[k], ...s[k1], ...s[k], ...s[k], ...s[k1], ...tip);
  }
}

/** Stalactite (dir = -1) or stalagmite (dir = +1): a lumpy cone. */
function spike(L: Lines, x: number, y: number, z: number, dir: number, r: number, len: number, rand: () => number) {
  const lx = (rand() - 0.5) * len * 0.12;
  const lz = (rand() - 0.5) * len * 0.12;
  const rings = 5;
  let prev: V3[] | null = null;
  for (let i = 0; i <= rings; i++) {
    const f = i / rings;
    const rr = r * Math.pow(1 - f, 0.85) * (0.9 + rand() * 0.2) + 0.02;
    const ring: V3[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + f * 0.4;
      ring.push([x + lx * f + Math.cos(a) * rr, y + dir * len * f, z + lz * f + Math.sin(a) * rr]);
    }
    if (i < rings) for (let k = 0; k < 6; k++) L.seg(...ring[k], ...ring[(k + 1) % 6]);
    if (prev) for (let k = 0; k < 6; k++) L.seg(...prev[k], ...ring[k]);
    prev = ring;
  }
}

function meshOf(tri: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
  return g;
}

function geoOf(pos: Float32Array) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

function halo(fade: Fade, tint: Color, size: number, opacity: number, pulse = 0.25) {
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(3), 3), 'vec3');
  mat.sizeNode = float(size);
  mat.colorNode = color(tint);
  const s = smoothstep(0.5, 0, length(uv().sub(0.5)));
  mat.opacityNode = s.mul(s).mul(float(opacity)).mul(sin(time.mul(2.3)).mul(pulse).add(1)).mul(fade);
  const sp = new Sprite(mat);
  sp.count = 1;
  sp.frustumCulled = false;
  sp.userData.noSample = true;
  return sp;
}

/** Soft volume of light (open mesh) whose brightness follows `along` from `a` (dark) to `b` (bright). */
function beam(tris: number[], tint: Color, opacity: number, fade: Fade, along: Parameters<typeof smoothstep>[2], a: number, b: number) {
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  mat.colorNode = color(tint);
  mat.opacityNode = smoothstep(a, b, along).mul(opacity).mul(sin(time.mul(1.3)).mul(0.1).add(1)).mul(fade);
  const mesh = new Mesh(geoOf(new Float32Array(tris)), mat);
  mesh.userData.noSample = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Depth-only mesh: hides what is behind it (the crystal's inside, the reflection under the ground). */
function shell(tris: number[]) {
  const mesh = new Mesh(geoOf(new Float32Array(tris)), new MeshBasicNodeMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.userData.noSample = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Static points with a slow drift in the shader (dust, motes). */
function motes(pos: Float32Array, fade: Fade, tint: Color, size: number, opacity: number, drift = 0.3) {
  const attr = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3), 'vec3') as unknown as ReturnType<typeof vec3>;
  const h = hash(instanceIndex);
  const k = h.mul(60);
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = attr.add(vec3(sin(time.mul(0.31).add(k)), sin(time.mul(0.23).add(k.mul(1.7))), cos(time.mul(0.27).add(k))).mul(drift));
  mat.sizeNode = float(size).add(hash(instanceIndex.add(1)).mul(size));
  mat.colorNode = mix(color(tint), color(ICE), hash(instanceIndex.add(3)).mul(0.5));
  mat.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(0.8).add(k)).mul(0.3).add(0.5)).mul(opacity).mul(fade);
  const sp = new Sprite(mat);
  sp.count = pos.length / 3;
  sp.frustumCulled = false;
  sp.userData.points = pos;
  return sp;
}

/** [5] Inside the core: a crystal cavern. The light comes from inside the biggest crystal, through a crack. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(5);
  const D = ctx.detail;
  const m = ctx.reducedMotion ? 0.3 : 1;

  // ======================================================================== Terrain
  // Smooth 3D noise: a sum of waves (built per world, so every visit looks the same).
  const nr = rng(77);
  const waves = Array.from({ length: 9 }, () => {
    const f = 0.05 + nr() * 0.4;
    const a = nr() * TAU;
    const b = Math.acos(2 * nr() - 1);
    return { kx: f * Math.sin(b) * Math.cos(a), ky: f * Math.cos(b), kz: f * Math.sin(b) * Math.sin(a), ph: nr() * TAU, a: 1 / (1 + f * 4) };
  });
  const wsum = waves.reduce((s, w) => s + w.a, 0);
  const noise = (x: number, y: number, z: number) => {
    let s = 0;
    for (const w of waves) s += w.a * Math.sin(w.kx * x + w.ky * y + w.kz * z + w.ph);
    return (s / wsum) * 1.7;
  };
  const WL = -0.55; // water level
  const EX_DEG = 196; // where the explorer stands, and the stepping stones that lead to him
  const WALL_R = 34;
  const baseF = (r: number) => (r < 7.5 ? 0 : r < 10.5 ? -1.8 * sm((r - 7.5) / 3) : r < 13.5 ? -1.8 : r < 17.5 ? -1.8 + 2.0 * sm((r - 13.5) / 4) : 0.2 + (r - 17.5) * 0.4);
  const ampF = (r: number) => (r < 8 ? 0.1 : r < 17 ? 0.25 : 0.9 + (r - 17) * 0.05);
  const floorY = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    return baseF(r + 2.4 * noise(x * 0.11, 3, z * 0.11)) + noise(x * 0.5, 0, z * 0.5) * ampF(r); // the shores wander
  };
  const ceilY = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    return 25.5 - 6.5 * (r / WALL_R) * (r / WALL_R) + noise(x * 0.5 + 50, 7, z * 0.5) * 2;
  };
  const wallPt = (th: number, t: number): { p: V3; n: V3 } => {
    const x0 = Math.cos(th) * WALL_R;
    const z0 = Math.sin(th) * WALL_R;
    const y0 = floorY(x0, z0);
    const y = y0 + (ceilY(x0, z0) - y0) * t;
    const r = WALL_R + 2.7 * noise(x0 * 0.35, y * 0.22, z0 * 0.35);
    const n: V3 = [-Math.cos(th), 0.12, -Math.sin(th)];
    const nl = Math.hypot(...n);
    return { p: [Math.cos(th) * r, y, Math.sin(th) * r], n: [n[0] / nl, n[1] / nl, n[2] / nl] };
  };

  const rock = new Lines(); // rock surfaces, stalactites, stalagmites (one draw call)
  const bright = new Lines(); // brighter thin details: light cones, pools, crystal edges of the spill
  const edge = new Lines(); // strokes: ceiling cracks, columns
  const shore = new Lines(); // strokes: the two shorelines
  const STEP = D < 0.7 ? 2.4 : 1.8;
  const NG = Math.ceil(72 / STEP);
  type Vtx = V3 | null;
  const grid = (h: (x: number, z: number) => number, R: number) => {
    const G: Vtx[][] = [];
    for (let i = 0; i <= NG; i++) {
      const col: Vtx[] = [];
      for (let j = 0; j <= NG; j++) {
        const x = -36 + i * STEP + (rand() - 0.5) * STEP * 0.55;
        const z = -36 + j * STEP + (rand() - 0.5) * STEP * 0.55;
        col.push(Math.hypot(x, z) < R ? [x, h(x, z) + (rand() - 0.5) * 0.3, z] : null);
      }
      G.push(col);
    }
    return G;
  };
  const meshLines = (L: Lines, G: Vtx[][]) => {
    for (let i = 0; i < NG; i++) {
      for (let j = 0; j < NG; j++) {
        const a = G[i][j];
        if (!a) continue;
        const b = G[i + 1][j];
        const c = G[i][j + 1];
        const d = G[i + 1][j + 1];
        if (b) L.seg(...a, ...b);
        if (c) L.seg(...a, ...c);
        if (d && (i + j) % 2 === 0) L.seg(...a, ...d);
      }
    }
  };
  const floorG = grid(floorY, WALL_R + 0.5);
  meshLines(rock, floorG);
  meshLines(rock, grid(ceilY, WALL_R - 1));
  // the floor again as a depth-only surface, except the lake, so the reflection only shows in the water
  const ground: number[] = [];
  for (let i = 0; i < NG; i++) {
    for (let j = 0; j < NG; j++) {
      const a = floorG[i][j];
      const b = floorG[i + 1][j];
      const c = floorG[i + 1][j + 1];
      const d = floorG[i][j + 1];
      if (!a || !b || !c || !d) continue;
      if ((a[1] + b[1] + c[1] + d[1]) / 4 < WL - 0.25) continue;
      const q = (v: V3): V3 => [v[0], v[1] - 0.1, v[2]];
      ground.push(...q(a), ...q(d), ...q(b), ...q(b), ...q(d), ...q(c));
    }
  }
  // walls: a ring of jittered rows
  const NT = Math.round(150 * Math.max(0.6, D));
  const NV = 14;
  const W: V3[][] = [];
  for (let i = 0; i <= NT; i++) {
    const col: V3[] = [];
    for (let j = 0; j <= NV; j++) {
      const th = ((i % NT) / NT) * TAU + (rand() - 0.5) * (TAU / NT) * 0.5;
      const w = wallPt(th, Math.min(1, Math.max(0, j / NV + (rand() - 0.5) * 0.04)));
      col.push(w.p);
    }
    W.push(col);
  }
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j <= NV; j++) {
      rock.seg(...W[i][j], ...W[i + 1][j]);
      if (j < NV) {
        rock.seg(...W[i][j], ...W[i][j + 1]);
        if ((i + j) % 2 === 0) rock.seg(...W[i][j], ...W[i + 1][j + 1]);
      }
    }
  }

  // stalactites, stalagmites, a few columns
  const nSp = Math.round(60 * D);
  for (let i = 0; i < nSp; i++) {
    const a = rand() * TAU;
    const r = 4 + Math.sqrt(rand()) * 28;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const len = 2 + Math.pow(rand(), 2) * 7.5;
    spike(rock, x, ceilY(x, z) + 0.3, z, -1, 0.4 + len * 0.13, len, rand);
  }
  for (let i = 0; i < nSp * 0.8; i++) {
    const a = rand() * TAU;
    const r = 16 + Math.sqrt(rand()) * 17;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const len = 1.5 + Math.pow(rand(), 2) * 5.5;
    spike(rock, x, floorY(x, z) - 0.2, z, 1, 0.4 + len * 0.16, len, rand);
  }
  for (const [deg, r] of [[62, 27], [150, 29], [238, 26], [322, 28]]) {
    const x = Math.cos(rad(deg)) * r;
    const z = Math.sin(rad(deg)) * r;
    const y0 = floorY(x, z);
    const y1 = ceilY(x, z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const pts: V3[] = [];
      for (let i = 0; i <= 12; i++) {
        const f = i / 12;
        const rr = 1.3 * (1 + 0.45 * Math.cos(f * Math.PI * 2) * 0.5 + 0.2 * Math.sin(f * 17 + deg));
        pts.push([x + Math.cos(a) * rr, y0 + (y1 - y0) * f, z + Math.sin(a) * rr]);
      }
      for (let i = 0; i < 12; i++) (k % 4 === 0 ? edge : rock).seg(...pts[i], ...pts[i + 1]);
    }
    for (let i = 0; i <= 12; i++) {
      const f = i / 12;
      const rr = 1.3 * (1 + 0.45 * Math.cos(f * Math.PI * 2) * 0.5 + 0.2 * Math.sin(f * 17 + deg));
      rock.circle(x, y0 + (y1 - y0) * f, z, rr, 8);
    }
  }

  // ======================================================================== The lake
  const water = new Lines();
  const rin: number[] = [];
  const rout: number[] = [];
  const NW = 120;
  for (let i = 0; i < NW; i++) {
    const a = (i / NW) * TAU;
    let r = 7;
    while (r < 20 && floorY(Math.cos(a) * r, Math.sin(a) * r) > WL) r += 0.1;
    rin.push(r);
    while (r < 24 && floorY(Math.cos(a) * r, Math.sin(a) * r) < WL) r += 0.1;
    rout.push(r);
  }
  for (const f of [0, 0.12, 0.26, 0.4, 0.55, 0.7, 0.84, 1]) {
    for (let i = 0; i < NW; i++) {
      const j = (i + 1) % NW;
      const a0 = (i / NW) * TAU;
      const a1 = (j / NW) * TAU;
      const r0 = rin[i] + (rout[i] - rin[i]) * f;
      const r1 = rin[j] + (rout[j] - rin[j]) * f;
      (f === 0 || f === 1 ? shore : water).seg(Math.cos(a0) * r0, WL, Math.sin(a0) * r0, Math.cos(a1) * r1, WL, Math.sin(a1) * r1);
    }
  }
  for (let i = 0; i < Math.round(70 * D); i++) {
    const k = Math.floor(rand() * NW);
    const f = 0.08 + rand() * 0.84;
    const r = rin[k] + (rout[k] - rin[k]) * f;
    const a = (k / NW) * TAU;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const l = 0.6 + rand() * 1.4;
    water.seg(x - l, WL, z, x + l, WL, z + (rand() - 0.5) * 0.4);
  }
  // stepping stones from the shore to the island
  const ST = rad(EX_DEG);
  for (let i = 0; i < 7; i++) {
    const a = ST + Math.sin(i * 1.3) * 0.08;
    const r = 15.2 - i * 1.15;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    bright.circle(x, WL + 0.12, z, 0.65, 6).circle(x, WL + 0.12, z, 0.4, 6);
  }

  // ======================================================================== The big crystal
  const K = 2;
  const MAIN: Cry = { base: [0, -0.4, 0], r: 1.9, h: 6.6, sides: 9, twist: 0.2 };
  const SY = MAIN.base[1] + MAIN.h * 0.5; // the spark sits at the heart
  const by = MAIN.base[1];
  const H = MAIN.h;
  const big = new Group();
  big.position.set(0, 0.8, 0); // so the foot of the crystal stands on y = 0
  big.scale.setScalar(K);
  root.add(big);
  const bold = new Lines();
  const thin = new Lines();
  const tri: number[] = [];
  const rings = crystal(MAIN, { bold, thin, tri, striae: Math.round(18 + 22 * D) }, rand);
  const tip = rings[rings.length - 1][0];
  for (let i = 0; i < 20; i++) {
    const a = rand() * TAU;
    const e = 0.3 + rand() * 0.9;
    const l = 0.6 + rand() * 1.3;
    thin.seg(tip[0], tip[1] + 0.1, tip[2], tip[0] + Math.cos(a) * l * 0.8, tip[1] + 0.1 + e * l, tip[2] + Math.sin(a) * l * 0.8);
  }
  const boldPos = bold.positions();
  const thinPos = thin.positions();
  big.add(strokes(boldPos, fade, ICE, 0.9, 2.6));
  big.add(new LineSegments(geoOf(thinPos), lineMaterial(fade, ICE, 0.35)));
  const fill = new Mesh(meshOf(tri), fillMaterial(fade, ICE, 0.14));
  fill.userData.noSample = true;
  big.add(fill);

  // The crack: one facet of the prism has a jagged gap, wide enough to see the spark through.
  const n = MAIN.sides;
  const SC = n - 1; // the facet that faces +X (slightly toward -Z)
  const thC = ((SC + 0.5) / n) * TAU + (MAIN.twist ?? 0);
  const faceDir: V3 = [Math.cos(thC), 0, Math.sin(thC)];
  const CR0 = 0.22; // the crack spans this part of the prism band (0 = bottom, 1 = top)
  const CR1 = 0.86;
  const J = 18;
  const crackU = (t: number) => 0.5 + 0.07 * Math.sin(t * 11);
  const crackW = (t: number) => (t <= CR0 || t >= CR1 ? 0 : 0.26 * Math.pow(Math.sin((Math.PI * (t - CR0)) / (CR1 - CR0)), 0.7) * (0.78 + 0.22 * Math.sin(t * 37)));
  const SHR = 0.965; // the hidden hull sits a hair inside the visible edges
  const shr = (p: V3): V3 => [MAIN.base[0] + (p[0] - MAIN.base[0]) * SHR, p[1], MAIN.base[2] + (p[2] - MAIN.base[2]) * SHR];
  const hull: number[] = [];
  const hullTri = (a: V3, b: V3, c: V3) => {
    // wind it so the front face looks outward
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const ox = (a[0] + b[0] + c[0]) / 3 - MAIN.base[0];
    const oz = (a[2] + b[2] + c[2]) / 3 - MAIN.base[2];
    if (nx * ox + nz * oz < 0) hull.push(...a, ...c, ...b);
    else hull.push(...a, ...b, ...c);
  };
  const crackEdge = new Lines();
  const crackPts: V3[] = [];
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k].map(shr);
    const B = rings[k + 1].map(shr);
    for (let s = 0; s < n; s++) {
      const s1 = (s + 1) % n;
      if (B.length === 1) hullTri(A[s], A[s1], B[0]);
      else if (A.length === 1) hullTri(A[0], B[s1], B[s]);
      else if (k === 2 && s === SC) {
        const P = (u: number, t: number): V3 => [
          (A[s][0] + (A[s1][0] - A[s][0]) * u) * (1 - t) + (B[s][0] + (B[s1][0] - B[s][0]) * u) * t,
          (A[s][1] + (A[s1][1] - A[s][1]) * u) * (1 - t) + (B[s][1] + (B[s1][1] - B[s][1]) * u) * t,
          (A[s][2] + (A[s1][2] - A[s][2]) * u) * (1 - t) + (B[s][2] + (B[s1][2] - B[s][2]) * u) * t,
        ];
        for (let j = 0; j < J; j++) {
          const t0 = j / J;
          const t1 = (j + 1) / J;
          const l0 = crackU(t0) - crackW(t0);
          const l1 = crackU(t1) - crackW(t1);
          const r0 = crackU(t0) + crackW(t0);
          const r1 = crackU(t1) + crackW(t1);
          hullTri(P(0, t0), P(l0, t0), P(l1, t1));
          hullTri(P(0, t0), P(l1, t1), P(0, t1));
          hullTri(P(r0, t0), P(1, t0), P(1, t1));
          hullTri(P(r0, t0), P(1, t1), P(r1, t1));
        }
      } else {
        hullTri(A[s], A[s1], B[s]);
        hullTri(A[s1], B[s1], B[s]);
      }
    }
  }
  {
    // the jagged edges, drawn on the real (un-shrunk) face
    const A = rings[2];
    const B = rings[3];
    const P = (u: number, t: number): V3 => [
      (A[SC][0] + (A[(SC + 1) % n][0] - A[SC][0]) * u) * (1 - t) + (B[SC][0] + (B[(SC + 1) % n][0] - B[SC][0]) * u) * t,
      (A[SC][1] + (A[(SC + 1) % n][1] - A[SC][1]) * u) * (1 - t) + (B[SC][1] + (B[(SC + 1) % n][1] - B[SC][1]) * u) * t,
      (A[SC][2] + (A[(SC + 1) % n][2] - A[SC][2]) * u) * (1 - t) + (B[SC][2] + (B[(SC + 1) % n][2] - B[SC][2]) * u) * t,
    ];
    for (const sd of [-1, 1]) {
      let prev: V3 | null = null;
      for (let j = 0; j <= J; j++) {
        const t = j / J;
        if (t < CR0 - 1 / J || t > CR1 + 1 / J) continue;
        const p = P(crackU(t) + sd * crackW(t), t);
        if (prev) crackEdge.seg(...prev, ...p);
        prev = p;
      }
    }
    crackPts.push(P(0.5, 0.636));
  }
  big.add(shell(hull)); // (in the crystal's own units, so it lives inside the scaled group)
  big.add(strokes(crackEdge.positions(), fade, AMBER, 0.85, 2.4));

  // Nested inner shells, each turning at its own pace, plus a refraction lattice (all hidden but through the crack).
  const shellsL = new Lines();
  for (let k = 1; k <= 3; k++) {
    const sc = 1 - k * 0.22;
    crystal(
      { base: [0, SY - MAIN.h * sc * 0.5, 0], r: MAIN.r * sc * 0.85, h: MAIN.h * sc, sides: 9 - k, twist: k * 0.5 },
      { bold: shellsL, thin: shellsL, striae: Math.round(6 + 6 * D) },
      rand,
    );
  }
  const shells = new LineSegments(shellsL.geometry(), lineMaterial(fade, VIOLET, 0.3));
  big.add(shells);
  const refr = new Lines();
  const levels = Math.round(8 + 6 * D);
  for (let j = 0; j < levels; j++) {
    const f = 0.18 + (0.5 * j) / levels;
    const y = by + f * H;
    const r = MAIN.r * 0.86;
    const nS = 9;
    for (let s = 0; s < nS; s++) {
      const a0 = (s / nS) * TAU + j * 0.11;
      const a1 = ((s + 4) / nS) * TAU + j * 0.11;
      refr.seg(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
      const a2 = ((s + 2) / nS) * TAU + (j + 1) * 0.11;
      refr.seg(Math.cos(a0) * r * 0.6, y, Math.sin(a0) * r * 0.6, Math.cos(a2) * r * 0.9, y + (0.5 * H) / levels, Math.sin(a2) * r * 0.9);
      refr.seg(Math.cos(a0) * r * 0.3, y, Math.sin(a0) * r * 0.3, Math.cos(a1) * r * 0.6, y, Math.sin(a1) * r * 0.6);
    }
  }
  const refrObj = new LineSegments(refr.geometry(), lineMaterial(fade, CYAN, 0.14));
  big.add(refrObj);

  // Internal fractures: jagged random walks on random planes, branching, kept inside the crystal.
  const frac = new Lines();
  const nF = Math.round(4 + 4 * D);
  for (let f = 0; f < nF; f++) {
    const c: V3 = [(rand() - 0.5) * 1.4, by + H * (0.22 + rand() * 0.5), (rand() - 0.5) * 1.4];
    let nx = rand() - 0.5;
    let ny = (rand() - 0.5) * 0.6;
    let nz = rand() - 0.5;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let ux = ny * 0 - nz * 1;
    let uy = nz * 0 - nx * 0;
    let uz = nx * 1 - ny * 0;
    if (Math.hypot(ux, uy, uz) < 0.2) [ux, uy, uz] = [0, -nz, ny];
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const inside = (x: number, y: number, z: number) => {
      const fy = (y - by) / H;
      return fy > 0.16 && fy < 0.88 && Math.hypot(x, z) < radiusAt(fy) * MAIN.r * 0.82;
    };
    const walk = (x: number, y: number, z: number, ang: number, steps: number, depth: number) => {
      for (let i = 0; i < steps; i++) {
        ang += (rand() - 0.5) * 1.1;
        const st = 0.12 + rand() * 0.22;
        const c0 = Math.cos(ang) * st;
        const s0 = Math.sin(ang) * st;
        const X = x + ux * c0 + vx * s0;
        const Y = y + uy * c0 + vy * s0;
        const Z = z + uz * c0 + vz * s0;
        if (!inside(X, Y, Z)) return;
        frac.seg(x, y, z, X, Y, Z);
        x = X;
        y = Y;
        z = Z;
        if (depth < 2 && rand() < 0.14) walk(x, y, z, ang + (rand() < 0.5 ? 0.8 : -0.8), 5 + Math.floor(rand() * 8), depth + 1);
      }
    };
    walk(c[0], c[1], c[2], rand() * TAU, 16, 0);
    walk(c[0], c[1], c[2], rand() * TAU, 16, 0);
  }
  big.add(new LineSegments(frac.geometry(), lineMaterial(fade, ICE, 0.7)));

  // Lattice of light inside the crystal (also what the dive particles land on).
  const step = 0.36 / Math.cbrt(D);
  const lp: number[] = [];
  for (let y = by + H * 0.16; y < by + H * 0.9; y += step) {
    const rr = radiusAt((y - by) / H) * MAIN.r * 0.9;
    for (let x = -rr; x <= rr; x += step) {
      for (let z = -rr; z <= rr; z += step) {
        if (Math.hypot(x, z) < rr) lp.push(x + (rand() - 0.5) * step * 0.3, y + (rand() - 0.5) * step * 0.3, z + (rand() - 0.5) * step * 0.3);
      }
    }
  }
  const nHeart = Math.round(300 * D);
  for (let i = 0; i < nHeart; i++) {
    const rr = Math.pow(rand(), 1.6) * 0.9;
    const a = rand() * TAU;
    lp.push(Math.cos(a) * rr, SY + (rand() - 0.5) * rr * 1.6, Math.sin(a) * rr);
  }
  const lat = new Float32Array(lp);
  const latNode = instancedBufferAttribute(new InstancedBufferAttribute(lat, 3), 'vec3') as unknown as ReturnType<typeof vec3>;
  const lattice = new Sprite(
    Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), {
      positionNode: latNode,
      sizeNode: float(1.2).add(hash(instanceIndex).mul(hash(instanceIndex)).mul(2.0)),
      colorNode: mix(color(ICE), color(VIOLET), hash(instanceIndex.add(7)).mul(0.6)),
      opacityNode: smoothstep(0.5, 0.1, length(uv().sub(0.5)))
        .mul(sin(time.mul(1.4).sub(latNode.y.mul(1.7)).add(hash(instanceIndex).mul(6))).mul(0.3).add(0.4))
        .mul(0.9)
        .mul(fade),
    }),
  );
  lattice.count = lat.length / 3;
  lattice.frustumCulled = false;
  lattice.userData.points = lat;
  const latGroup = new Group();
  latGroup.add(lattice);
  big.add(latGroup);

  // Energy filaments spiralling in to the spark: strokes + braided strands + packets of light riding them.
  const F = 10;
  const R0 = 1.5;
  const TURNS = 1.4;
  const fil = (f: number, s: number, out: V3, off = 0): V3 => {
    const y0 = by + H * (0.12 + 0.66 * ((f * 0.618) % 1));
    const rr = Math.pow(1 - s, 1.3) * R0 * (0.7 + 0.3 * ((f * 0.37) % 1)) + 0.04;
    const ang = (f / F) * TAU + off + s * TURNS * TAU * (f % 2 ? -1 : 1);
    out[0] = Math.cos(ang) * rr;
    out[1] = y0 + (SY - y0) * s;
    out[2] = Math.sin(ang) * rr;
    return out;
  };
  const filGroup = new Group();
  big.add(filGroup);
  const fMain = new Lines();
  const fBraid = new Lines();
  const q0: V3 = [0, 0, 0];
  const q1: V3 = [0, 0, 0];
  const STEPS = 70;
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < STEPS; i++) {
      fil(f, i / STEPS, q0);
      fil(f, (i + 1) / STEPS, q1);
      fMain.seg(...q0, ...q1);
      for (const off of [-0.16, 0.16]) {
        const a = fil(f, i / STEPS, q0, off);
        const b = fil(f, (i + 1) / STEPS, q1, off);
        fBraid.seg(...a, ...b);
      }
    }
  }
  filGroup.add(strokes(fMain.positions(), fade, AMBER, 0.4, 1.8));
  filGroup.add(new LineSegments(fBraid.geometry(), lineMaterial(fade, AMBER, 0.28)));
  const nP = Math.round(36 * F * D);
  const pk = new Float32Array(nP * 4);
  const pp = new Float32Array(nP * 3);
  const tmp: V3 = [0, 0, 0];
  for (let i = 0; i < nP; i++) {
    const f = i % F;
    pk.set([(f / F) * TAU, by + H * (0.12 + 0.66 * ((f * 0.618) % 1)), rand(), f % 2 ? -1 : 1], i * 4);
    pp.set(fil(f, rand(), tmp), i * 3);
  }
  const pa = instancedBufferAttribute(new InstancedBufferAttribute(pk, 4), 'vec4') as unknown as ReturnType<typeof vec4>;
  const ps = fract(time.mul(0.11).add(pa.z));
  const fvar = pa.x.div(TAU).mul(F);
  const prad = pow(float(1).sub(ps), 1.3).mul(R0).mul(float(0.7).add(fract(fvar.mul(0.37)).mul(0.3))).add(0.04);
  const pang = pa.x.add(ps.mul(TURNS * TAU).mul(pa.w));
  const packets = new Sprite(
    Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), {
      positionNode: vec3(cos(pang).mul(prad), mix(pa.y, float(SY), ps), sin(pang).mul(prad)),
      sizeNode: float(2).add(ps.mul(3.5)),
      colorNode: mix(color(AMBER), color(ICE), ps.mul(ps)),
      opacityNode: smoothstep(0, 0.1, ps).mul(0.9).mul(fade),
    }),
  );
  packets.count = nP;
  packets.frustumCulled = false;
  packets.userData.points = pp;
  filGroup.add(packets);

  // The spark at the center: a tiny star, ringed. The galaxy is in there.
  const spark = new Group();
  spark.position.y = SY;
  big.add(spark);
  const sl = new Lines().circle(0, 0, 0, 0.24, 32, true).circle(0, 0, 0, 0.24, 32).circle(0, 0, 0, 0.17, 24, true, 0, TAU);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const l = i % 2 ? 0.34 : 0.5;
    sl.seg(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0, Math.cos(a) * l, Math.sin(a) * l, 0);
    sl.seg(0, Math.sin(a) * 0.28, Math.cos(a) * 0.28, 0, Math.sin(a) * l, Math.cos(a) * l);
  }
  const sparkObj = new LineSegments(sl.geometry(), targetMaterial(fade, glow));
  spark.add(sparkObj);
  spark.add(halo(fade, AMBER, 120, 0.55, 0.3));
  spark.add(halo(fade, ICE, 30, 0.9, 0.15));
  const bigGlow = halo(fade, VIOLET, 520, 0.035, 0.1);
  bigGlow.position.set(0, SY, 0);
  big.add(bigGlow);

  // Its reflection in the lake (the floor hides it everywhere but in the water).
  const both = new Float32Array(boldPos.length + thinPos.length);
  both.set(boldPos, 0);
  both.set(thinPos, boldPos.length);
  const mirror = new LineSegments(geoOf(both), lineMaterial(fade, ICE, 0.16));
  mirror.scale.set(K, -K, K);
  mirror.position.set(0, 2 * WL - 0.8, 0);
  root.add(mirror);
  root.add(shell(ground));

  // ======================================================================== Where the light leaks out
  const crack: V3 = [crackPts[0][0] * K, 0.8 + crackPts[0][1] * K, crackPts[0][2] * K];
  const dx = faceDir[0];
  const dz = faceDir[2];
  const px = -dz;
  const pz = dx;
  const spillTris: number[] = [];
  {
    const near = (u: number, y: number): V3 => [crack[0] + dx * 0.3 + px * u, y, crack[2] + dz * 0.3 + pz * u];
    const far = (u: number, y: number): V3 => [crack[0] + dx * 26 + px * u, y, crack[2] + dz * 26 + pz * u];
    const loop = (f: (u: number, y: number) => V3, w: number, y0: number, y1: number): V3[] => [f(-w, y0), f(w, y0), f(w, y1), f(-w, y1)];
    const a = loop(near, 0.7, crack[1] - 2.4, crack[1] + 2.4);
    const b = loop(far, 11, 0, 15);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      spillTris.push(...a[i], ...a[j], ...b[j], ...a[i], ...b[j], ...b[i]);
    }
  }
  const along = positionWorld.x.sub(crack[0]).mul(dx).add(positionWorld.z.sub(crack[2]).mul(dz));
  root.add(beam(spillTris, AMBER, 0.06, fade, along, 26, 1));
  const fan = new Lines();
  const fy = (x: number, z: number) => Math.max(floorY(x, z), WL) + 0.06;
  const fanW = (s: number) => 0.9 + s * 0.42;
  const fanPt = (s: number, u: number): V3 => {
    const x = crack[0] + dx * s + px * u * fanW(s);
    const z = crack[2] + dz * s + pz * u * fanW(s);
    return [x, fy(x, z), z];
  };
  for (let i = -5; i <= 5; i++) {
    let prev = fanPt(1.2, i / 5);
    for (let s = 2.4; s <= 24; s += 1.2) {
      const p = fanPt(s, i / 5);
      fan.seg(...prev, ...p);
      prev = p;
    }
  }
  for (let s = 2.4; s <= 24; s += 2.4) {
    let prev = fanPt(s, -1);
    for (let i = -6; i <= 6; i++) {
      const p = fanPt(s, i / 6);
      fan.seg(...prev, ...p);
      prev = p;
    }
  }
  const fanMat = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  fanMat.colorNode = color(AMBER);
  fanMat.opacityNode = smoothstep(26, 1, along).mul(sin(time.mul(1.4)).mul(0.15).add(0.7)).mul(0.2).mul(fade);
  const fanObj = new LineSegments(fan.geometry(), fanMat);
  fanObj.userData.noSample = true;
  root.add(fanObj);
  const hot = halo(fade, AMBER, 240, 0.32, 0.2);
  hot.position.set(crack[0] + dx * 0.5, crack[1], crack[2] + dz * 0.5);
  root.add(hot);
  {
    // embers drifting out of the crack along the beam
    const h = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(1));
    const h3 = hash(instanceIndex.add(2));
    const s = fract(time.mul(0.05).add(h));
    const d = float(0.6).add(s.mul(22));
    const lat = h2.sub(0.5).mul(float(1.2).add(s.mul(14)));
    const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
    mat.positionNode = vec3(
      float(crack[0]).add(d.mul(dx)).add(lat.mul(px)),
      float(crack[1]).add(h3.sub(0.5).mul(5)).sub(s.mul(crack[1] * 0.6)),
      float(crack[2]).add(d.mul(dz)).add(lat.mul(pz)),
    );
    mat.sizeNode = float(1.3).add(h3.mul(1.8));
    mat.colorNode = color(AMBER);
    mat.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(2).add(h.mul(40))).mul(0.3).add(0.6)).mul(float(1).sub(s)).mul(0.9).mul(fade);
    const embers = new Sprite(mat);
    embers.count = Math.round(220 * D);
    embers.frustumCulled = false;
    embers.userData.noSample = true;
    root.add(embers);
  }

  // ======================================================================== Shafts of light from the ceiling
  const shaftTris: number[] = [];
  const shafts: [number, number][] = [[-20, -14], [12, -20], [2, -28], [22, -6], [-24, -4]];
  const shaftTops: Object3D[] = [];
  for (const [cx, cz] of shafts) {
    const yT = ceilY(cx, cz) + 0.4;
    const bx = cx + 5;
    const yB = Math.max(floorY(bx, cz), WL) + 0.06;
    const top: V3[] = [];
    const bot: V3[] = [];
    const N = 12;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * TAU;
      top.push([cx + Math.cos(a) * 0.9, yT, cz + Math.sin(a) * 0.9]);
      bot.push([bx + Math.cos(a) * 3.4, yB, cz + Math.sin(a) * 3.4]);
    }
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      shaftTris.push(...top[k], ...top[k1], ...bot[k1], ...top[k], ...bot[k1], ...bot[k]);
      if (k % 2 === 0) bright.seg(...top[k], ...bot[k]);
    }
    for (const r of [1, 2.2, 3.4]) bright.circle(bx, yB, cz, r, 24);
    // the crack in the ceiling: a jagged line with a few branches
    let x = cx - 2.4;
    let z = cz;
    let y = yT - 0.35;
    for (let i = 0; i < 12; i++) {
      const nx = x + 0.4 + rand() * 0.3;
      const nz = z + (rand() - 0.5) * 0.9;
      const ny = y + (rand() - 0.5) * 0.4;
      edge.seg(x, y, z, nx, ny, nz);
      if (rand() < 0.3) edge.seg(nx, ny, nz, nx + rand() * 0.8, ny + (rand() - 0.5) * 0.4, nz + (rand() - 0.5) * 1.6);
      x = nx;
      y = ny;
      z = nz;
    }
    const o = new Object3D();
    o.position.set(cx, yT, cz);
    root.add(o);
    shaftTops.push(o);
  }
  root.add(beam(shaftTris, ICE, 0.085, fade, positionWorld.y, 0, 24));
  // dust hanging in the shafts and in the cave
  const sm1 = new Float32Array(Math.round(420 * D) * 3);
  for (let i = 0; i < sm1.length / 3; i++) {
    const [cx, cz] = shafts[i % shafts.length];
    const f = rand();
    const yT = ceilY(cx, cz);
    const yB = Math.max(floorY(cx + 5, cz), WL);
    const rr = (0.9 + (3.4 - 0.9) * f) * Math.sqrt(rand());
    const a = rand() * TAU;
    sm1.set([cx + 5 * f + Math.cos(a) * rr, yT + (yB - yT) * f, cz + Math.sin(a) * rr], i * 3);
  }
  root.add(motes(sm1, fade, ICE, 1.4, 0.9, 0.25));
  const sm2 = new Float32Array(Math.round(1000 * D) * 3);
  for (let i = 0; i < sm2.length / 3; i++) {
    const a = rand() * TAU;
    const r = 2 + Math.sqrt(rand()) * 30;
    sm2.set([Math.cos(a) * r, 0.5 + rand() * 22, Math.sin(a) * r], i * 3);
  }
  root.add(motes(sm2, fade, VIOLET, 1.0, 0.55, 0.5));

  // ======================================================================== Crystal clusters
  const cl: [Lines, number[]][] = [
    [new Lines(), []],
    [new Lines(), []],
  ];
  let clusterTip: V3 = [0, 0, 0];
  const exA = rad(EX_DEG); // the explorer's side of the island stays clear
  const cluster = (p: V3, nrm: V3, count: number, scale: number, group: number) => {
    const [L, T] = cl[group];
    for (let i = 0; i < count; i++) {
      const j: V3 = [nrm[0] + (rand() - 0.5) * 1.0, nrm[1] + (rand() - 0.5) * 1.0, nrm[2] + (rand() - 0.5) * 1.0];
      const jl = Math.hypot(...j);
      const dir: V3 = [j[0] / jl, j[1] / jl, j[2] / jl];
      const h = scale * (2.5 + rand() * 5.5) * (i === 0 ? 1.3 : 1);
      const r = h * (0.07 + rand() * 0.07);
      const base: V3 = [p[0] + (rand() - 0.5) * scale * 1.2, p[1] + (rand() - 0.5) * scale * 0.4, p[2] + (rand() - 0.5) * scale * 1.2];
      prism(L, T, base, dir, r, h, rand);
      if (i === 0 && group === 0) clusterTip = [base[0] + dir[0] * h, base[1] + dir[1] * h, base[2] + dir[2] * h];
    }
  };
  let ci = 0;
  const grp = () => (ci++ % 4 === 0 ? 1 : 0);
  const nFloor = Math.round(18 * D);
  for (let i = 0; i < nFloor; i++) {
    const a = rand() * TAU;
    const r = 17 + rand() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    cluster([x, floorY(x, z), z], [0, 1, 0], 3 + Math.floor(rand() * 4), 0.55 + rand() * 0.6, grp());
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    if (Math.abs(Math.atan2(Math.sin(a - exA), Math.cos(a - exA))) < 0.45) continue;
    cluster([Math.cos(a) * 6.4, 0, Math.sin(a) * 6.4], [0, 1, 0], 4, 0.5 + rand() * 0.2, grp());
  }
  const nWall = Math.round(28 * D);
  for (let i = 0; i < nWall; i++) {
    const w = wallPt(rand() * TAU, 0.2 + rand() * 0.65);
    cluster(w.p, w.n, 3 + Math.floor(rand() * 4), 0.8 + rand() * 0.6, grp());
  }
  const nCeil = Math.round(10 * D);
  for (let i = 0; i < nCeil; i++) {
    const a = rand() * TAU;
    const r = 8 + rand() * 24;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    cluster([x, ceilY(x, z) + 0.2, z], [0, -1, 0], 3 + Math.floor(rand() * 3), 0.6 + rand() * 0.5, grp());
  }
  const cl0 = cl[0];
  const cl1 = cl[1];
  root.add(new LineSegments(cl0[0].geometry(), lineMaterial(fade, ICE, 0.42)));
  root.add(new LineSegments(cl1[0].geometry(), lineMaterial(fade, VIOLET, 0.42)));
  const f0 = new Mesh(meshOf(cl0[1]), fillMaterial(fade, ICE, 0.14));
  f0.userData.noSample = true;
  root.add(f0);
  const f1 = new Mesh(meshOf(cl1[1]), fillMaterial(fade, VIOLET, 0.16));
  f1.userData.noSample = true;
  root.add(f1);

  // ======================================================================== The explorer, with a lamp
  const exX = Math.cos(rad(EX_DEG)) * 6.2;
  const exZ = Math.sin(rad(EX_DEG)) * 6.2;
  const exF = Math.atan2(-exX, -exZ) + 0.25;
  const person = new Lines().person(exX, 0, exZ, 1.75, exF, 'walk');
  root.add(strokes(person.positions(), fade, ICE, 0.95, 2.2));
  const hand: V3 = [exX + 0.25 * Math.cos(exF) + 0.5 * Math.sin(exF), 1.05, exZ - 0.25 * Math.sin(exF) + 0.5 * Math.cos(exF)];
  for (let i = 0; i < 9; i++) {
    const a = exF + (i / 8 - 0.5) * 0.9;
    bright.seg(...hand, hand[0] + Math.sin(a) * 4.5, 0.05, hand[2] + Math.cos(a) * 4.5);
  }
  const lamp = halo(fade, ICE, 46, 0.8, 0.05);
  lamp.position.set(...hand);
  root.add(lamp);
  const head = new Object3D();
  head.position.set(exX, 1.9, exZ);
  root.add(head);

  root.add(strokes(edge.positions(), fade, ICE, 0.6, 1.8));
  root.add(strokes(shore.positions(), fade, CYAN, 0.35, 1.5));
  root.add(new LineSegments(rock.geometry(), lineMaterial(fade, CYAN, 0.3)));
  root.add(new LineSegments(water.geometry(), lineMaterial(fade, CYAN, 0.34)));
  root.add(new LineSegments(bright.geometry(), lineMaterial(fade, ICE, 0.3)));

  // ======================================================================== Labels
  const mk = (p: V3, parent: Object3D = root) => {
    const o = new Object3D();
    o.position.set(...p);
    parent.add(o);
    return o;
  };
  const labels = [
    { object: mk([crack[0] + dx * 0.6, crack[1], crack[2] + dz * 0.6]), pt: 'FENDA LUMINOSA · SINAL FRACO', en: 'GLOWING CRACK · FAINT SIGNAL' },
    { object: mk([0.2, tip[1] - 0.2, 0.1], big), pt: 'CRISTAL PRIMÁRIO · 13 m', en: 'PRIMARY CRYSTAL · 13 m' },
    { object: mk([Math.cos(rad(30)) * 11.5, WL, Math.sin(rad(30)) * 11.5]), pt: 'LAGO SUBTERRÂNEO', en: 'UNDERGROUND LAKE' },
    { object: shaftTops[1], pt: 'FENDA DE LUZ · TETO', en: 'LIGHT SHAFT · CEILING CRACK' },
    { object: head, pt: 'EXPLORADOR · 1,75 m', en: 'EXPLORER · 1.75 m' },
    { object: mk(clusterTip), pt: 'AGRUPAMENTO · SiO₂', en: 'CRYSTAL CLUSTER · SiO₂' },
  ];

  return {
    id: 'crystal',
    exposure: 0.5,
    root,
    fade,
    glow,
    radius: 32,
    view: { distance: 24, minDistance: 8, maxDistance: 29, pitch: 0.1, height: 0.8 + K * SY },
    target: { object: spark, radius: 0.8, facing: new Vector3(faceDir[0], 0, faceDir[2]) },
    caption: {
      pt: 'Dentro do núcleo, uma caverna de cristal. A luz vem de dentro de um deles.',
      en: 'Inside the core, a crystal cavern. The light comes from inside one of them.',
    },
    labels,
    update(t) {
      shells.rotation.y = t * 0.2 * m;
      refrObj.rotation.y = -t * 0.07 * m;
      latGroup.rotation.y = t * 0.04 * m;
      filGroup.rotation.y = t * 0.1 * m;
      sparkObj.rotation.set(t * 0.8 * m, t * 1.1 * m, 0);
      spark.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    },
  };
}
