import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  LineSegments,
  Mesh,
  Object3D,
  PointsNodeMaterial,
  Sprite,
} from 'three/webgpu';
import { color, cos, float, fract, hash, instanceIndex, instancedBufferAttribute, length, mix, pow, sin, smoothstep, time, uv, vec3, vec4 } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, fillMaterial, lineMaterial, strokes, targetMaterial, type Fade, horizon } from '../engine/holo';
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

interface Cry {
  base: V3;
  r: number;
  h: number;
  sides: number;
  rx?: number;
  rz?: number;
  twist?: number;
}
interface Out {
  bold?: Lines; // silhouette edges
  thin?: Lines; // ring polygons, facet diagonals, striations
  tri?: number[]; // faces for the fresnel fill
  striae?: number; // rows of striations on the prism
}

/** A faceted crystal: prism with a stepped, zig-zag termination. Returns the tip. */
function crystal(o: Cry, out: Out, rand: () => number): V3 {
  const { sides: n } = o;
  const jr = Array.from({ length: n }, () => 1 + (rand() - 0.5) * 0.12);
  const ja = Array.from({ length: n }, () => (rand() - 0.5) * 0.12);
  const rx = o.rx ?? 0;
  const rz = o.rz ?? 0;
  const place = (x: number, y: number, z: number): V3 => {
    // lean (about X, then Z), then move to the base
    const y1 = y * Math.cos(rx) - z * Math.sin(rx);
    const z1 = y * Math.sin(rx) + z * Math.cos(rx);
    const x2 = x * Math.cos(rz) - y1 * Math.sin(rz);
    const y2 = x * Math.sin(rz) + y1 * Math.cos(rz);
    return [x2 + o.base[0], y2 + o.base[1], z1 + o.base[2]];
  };
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
  return rings[rings.length - 1][0];
}

function meshOf(tri: number[]) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(tri, 3));
  g.computeVertexNormals();
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

/** [5] The machine's core: a crystal cluster. Something burns at its very center. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(5);
  const D = ctx.detail;
  const m = ctx.reducedMotion ? 0.3 : 1;

  // ---- Main crystal.
  const MAIN: Cry = { base: [0, -0.4, 0], r: 1.9, h: 6.6, sides: 9, twist: 0.2 };
  const SY = MAIN.base[1] + MAIN.h * 0.5; // the spark sits at the heart
  const bold = new Lines();
  const thin = new Lines();
  const tri: number[] = [];
  const tip = crystal(MAIN, { bold, thin, tri, striae: Math.round(18 + 22 * D) }, rand);
  // light rays escaping from the tip and the facets
  for (let i = 0; i < 20; i++) {
    const a = rand() * TAU;
    const e = 0.3 + rand() * 0.9;
    const l = 0.6 + rand() * 1.3;
    thin.seg(tip[0], tip[1] + 0.1, tip[2], tip[0] + Math.cos(a) * l * 0.8, tip[1] + 0.1 + e * l, tip[2] + Math.sin(a) * l * 0.8);
  }
  root.add(strokes(bold.positions(), fade, ICE, 0.9, 2.6));
  root.add(new LineSegments(thin.geometry(), lineMaterial(fade, ICE, 0.35)));
  const fill = new Mesh(meshOf(tri), fillMaterial(fade, ICE, 0.14));
  fill.userData.noSample = true;
  root.add(fill);

  // ---- Nested inner shells, each turning at its own pace, plus a refraction lattice.
  const shells: { o: Object3D; w: number }[] = [];
  for (let k = 1; k <= 3; k++) {
    const sc = 1 - k * 0.22;
    const L = new Lines();
    crystal(
      { base: [0, SY - MAIN.h * sc * 0.5, 0], r: MAIN.r * sc * 0.85, h: MAIN.h * sc, sides: 9 - k, twist: k * 0.5 },
      { bold: L, thin: L, striae: Math.round(6 + 6 * D) },
      rand,
    );
    const o = new LineSegments(L.geometry(), lineMaterial(fade, k === 2 ? VIOLET : ICE, 0.42 - k * 0.06));
    root.add(o);
    shells.push({ o, w: (k % 2 ? 1 : -1) * (0.12 + k * 0.06) });
  }
  const refr = new Lines();
  const H = MAIN.h;
  const by = MAIN.base[1];
  const levels = Math.round(8 + 6 * D);
  for (let j = 0; j < levels; j++) {
    const f = 0.18 + (0.5 * j) / levels;
    const y = by + f * H;
    const r = MAIN.r * 0.86;
    const nS = 9;
    const k = 4;
    for (let s = 0; s < nS; s++) {
      const a0 = (s / nS) * TAU + j * 0.11;
      const a1 = ((s + k) / nS) * TAU + j * 0.11;
      refr.seg(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
      const a2 = ((s + 2) / nS) * TAU + (j + 1) * 0.11;
      refr.seg(Math.cos(a0) * r * 0.6, y, Math.sin(a0) * r * 0.6, Math.cos(a2) * r * 0.9, y + (0.5 * H) / levels, Math.sin(a2) * r * 0.9);
      refr.seg(Math.cos(a0) * r * 0.3, y, Math.sin(a0) * r * 0.3, Math.cos(a1) * r * 0.6, y, Math.sin(a1) * r * 0.6);
    }
  }
  const refrObj = new LineSegments(refr.geometry(), lineMaterial(fade, CYAN, 0.11));
  root.add(refrObj);

  // ---- Internal fractures: jagged random walks on random planes, branching, kept inside the crystal.
  const frac = new Lines();
  const fracCenters: V3[] = [];
  const nF = Math.round(4 + 4 * D);
  for (let f = 0; f < nF; f++) {
    const c: V3 = [(rand() - 0.5) * 1.4, by + H * (0.22 + rand() * 0.5), (rand() - 0.5) * 1.4];
    fracCenters.push(c);
    let nx = rand() - 0.5;
    let ny = (rand() - 0.5) * 0.6;
    let nz = rand() - 0.5;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // u = n x up (falls back to n x right), v = n x u
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
  root.add(new LineSegments(frac.geometry(), lineMaterial(fade, ICE, 0.7)));

  // ---- Satellite crystals on a rocky base.
  const satBold = new Lines();
  const satThin = new Lines();
  const satTri: number[] = [];
  const nSat = Math.round(14 + 14 * D);
  let satTip: V3 = [0, 0, 0];
  for (let i = 0; i < nSat; i++) {
    const a = (i / nSat) * TAU * 2.3 + rand() * 0.5;
    const d = 2.3 + (i % 3) * 0.9 + rand() * 1.8;
    const s = 0.22 + Math.pow(rand(), 1.6) * 0.55;
    const lean = 0.15 + rand() * 0.55;
    const t = crystal(
      { base: [Math.cos(a) * d, -0.25 * s - rand() * 0.1, Math.sin(a) * d], r: s, h: s * (3 + rand() * 2.2), sides: 6 + (i % 3), rx: lean * Math.sin(a), rz: -lean * Math.cos(a), twist: rand() },
      { bold: satBold, thin: satThin, tri: satTri, striae: 6 },
      rand,
    );
    if (i === 3) satTip = t;
  }
  root.add(strokes(satBold.positions(), fade, ICE, 0.65, 1.8));
  root.add(new LineSegments(satThin.geometry(), lineMaterial(fade, ICE, 0.32)));
  const sat = new Mesh(meshOf(satTri), fillMaterial(fade, CYAN, 0.16));
  sat.userData.noSample = true;
  root.add(sat);

  // Rocky ground: wobbly terraces, cracks, and a crystalline lattice of facets.
  const ground = new Lines();
  const wob = (a: number, r: number) => r * (1 + 0.07 * Math.sin(a * 3 + r) + 0.04 * Math.sin(a * 7 + r * 2));
  for (let r = 1.6; r <= 7.2; r += 0.45) {
    let prev: V3 | null = null;
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      const rr = wob(a, r);
      const p: V3 = [Math.cos(a) * rr, -0.05 + 0.12 * Math.sin(a * 5 + r), Math.sin(a) * rr];
      if (prev) ground.seg(...prev, ...p);
      prev = p;
    }
  }
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * TAU + rand() * 0.04;
    let r = 1.7;
    let x = Math.cos(a) * r;
    let z = Math.sin(a) * r;
    for (let k = 0; k < 4 + (i % 4); k++) {
      r += 0.35 + rand() * 0.6;
      const a2 = a + (rand() - 0.5) * 0.12;
      const nx = Math.cos(a2) * wob(a2, r);
      const nz = Math.sin(a2) * wob(a2, r);
      ground.seg(x, -0.05, z, nx, -0.05, nz);
      x = nx;
      z = nz;
    }
  }
  root.add(new LineSegments(ground.geometry(), lineMaterial(fade, ICE, 0.22)));

  // ---- Lattice of light inside the crystal (also what the dive particles land on).
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
  const nL = lat.length / 3;
  const latNode = instancedBufferAttribute(new InstancedBufferAttribute(lat, 3), 'vec3') as unknown as ReturnType<typeof vec3>;
  const lattice = new Sprite(
    Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), {
      positionNode: latNode,
      sizeNode: float(1.2).add(hash(instanceIndex).mul(hash(instanceIndex)).mul(2.0)),
      colorNode: mix(color(ICE), color(VIOLET), hash(instanceIndex.add(7)).mul(0.6)),
      // a slow wave of light climbing the crystal
      opacityNode: smoothstep(0.5, 0.1, length(uv().sub(0.5)))
        .mul(sin(time.mul(1.4).sub(latNode.y.mul(1.7)).add(hash(instanceIndex).mul(6))).mul(0.3).add(0.4))
        .mul(0.9)
        .mul(fade),
    }),
  );
  lattice.count = nL;
  lattice.frustumCulled = false;
  lattice.userData.points = lat;
  const latGroup = new Group();
  latGroup.add(lattice);
  root.add(latGroup);

  // ---- Energy filaments spiralling in to the spark: strokes + braided strands + packets of light riding them.
  const F = 10;
  const R0 = 1.7;
  const TURNS = 1.4;
  const fil = (f: number, s: number, out: V3, off = 0): V3 => {
    const y0 = by + H * (0.12 + 0.76 * ((f * 0.618) % 1));
    const rad = Math.pow(1 - s, 1.3) * R0 * (0.7 + 0.3 * ((f * 0.37) % 1)) + 0.04;
    const ang = (f / F) * TAU + off + s * TURNS * TAU * (f % 2 ? -1 : 1);
    out[0] = Math.cos(ang) * rad;
    out[1] = y0 + (SY - y0) * s;
    out[2] = Math.sin(ang) * rad;
    return out;
  };
  const filGroup = new Group();
  root.add(filGroup);
  const fMain = new Lines();
  const fBraid = new Lines();
  const q0: V3 = [0, 0, 0];
  const q1: V3 = [0, 0, 0];
  const STEPS = 70;
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < STEPS; i++) {
      const s0 = i / STEPS;
      const s1 = (i + 1) / STEPS;
      fil(f, s0, q0);
      fil(f, s1, q1);
      fMain.seg(...q0, ...q1);
      for (const off of [-0.16, 0.16]) {
        const a = fil(f, s0, q0, off);
        const b = fil(f, s1, q1, off);
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
    const s = rand();
    pk.set([(f / F) * TAU, by + H * (0.12 + 0.76 * ((f * 0.618) % 1)), rand(), f % 2 ? -1 : 1], i * 4);
    pp.set(fil(f, s, tmp), i * 3);
  }
  const pa = instancedBufferAttribute(new InstancedBufferAttribute(pk, 4), 'vec4') as unknown as ReturnType<typeof vec4>;
  const ps = fract(time.mul(0.11).add(pa.z));
  const fvar = pa.x.div(TAU).mul(F); // recovers f (and its radius factor) in the shader
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

  // ---- Floating motes around the cluster.
  const nM = Math.round(900 * D);
  const mp = new Float32Array(nM * 3);
  for (let i = 0; i < nM; i++) {
    const a = rand() * TAU;
    const r = 1.2 + Math.pow(rand(), 0.7) * 5.5;
    mp.set([Math.cos(a) * r, rand() * 8.5, Math.sin(a) * r], i * 3);
  }
  const motes = new Sprite(
    Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), {
      positionNode: instancedBufferAttribute(new InstancedBufferAttribute(mp, 3), 'vec3'),
      sizeNode: float(1.1).add(hash(instanceIndex).mul(1.6)),
      colorNode: mix(color(ICE), color(VIOLET), hash(instanceIndex.add(3)).mul(0.5)),
      opacityNode: smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(0.8).add(hash(instanceIndex).mul(40))).mul(0.3).add(0.4)).mul(0.7).mul(fade),
    }),
  );
  motes.count = nM;
  motes.frustumCulled = false;
  motes.userData.points = mp;
  root.add(motes);

  // ---- The spark at the center: a tiny star, ringed. The galaxy is in there.
  const spark = new Group();
  spark.position.y = SY;
  root.add(spark);
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
  root.add(bigGlow);

  // ---- HUD anchors.
  const mk = (p: V3, parent: Object3D = root) => {
    const o = new Object3D();
    o.position.set(...p);
    parent.add(o);
    return o;
  };
  const filAnchor = fil(2, 0.08, [0, 0, 0]);
  const labels = [
    { object: spark, pt: 'ANOMALIA · SINAL FRACO', en: 'ANOMALY · FAINT SIGNAL' },
    { object: mk([0.2, tip[1] - 0.2, 0.1]), pt: 'FACE PRIMÁRIA · 9 EIXOS', en: 'PRIMARY FACET · 9-AXIS' },
    { object: mk(fracCenters[0]), pt: 'FRATURA INTERNA · 0,4 mm', en: 'INTERNAL FRACTURE · 0.4 mm' },
    { object: mk(filAnchor, filGroup), pt: 'FILAMENTO DE ENERGIA · 12 GW', en: 'ENERGY FILAMENT · 12 GW' },
    { object: mk(satTip), pt: 'CRISTAL SATÉLITE · SiO₂', en: 'SATELLITE CRYSTAL · SiO₂' },
  ];

  root.add(horizon(fade, 6));
  return {
    id: 'crystal',
    exposure: 0.42,
    root,
    fade,
    glow,
    radius: 6,
    view: { distance: 8.5, minDistance: 3.5, maxDistance: 17, pitch: 0.06, height: 2.6 },
    target: { object: spark, radius: 0.4 },
    labels,
    update(t) {
      for (const s of shells) s.o.rotation.y = t * s.w * m;
      refrObj.rotation.y = -t * 0.07 * m;
      latGroup.rotation.y = t * 0.04 * m;
      filGroup.rotation.y = t * 0.1 * m;
      sparkObj.rotation.set(t * 0.8 * m, t * 1.1 * m, 0);
      spark.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    },
  };
}
