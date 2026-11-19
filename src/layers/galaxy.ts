import { AdditiveBlending, Color, Group, InstancedBufferAttribute, LineSegments, Object3D, PointsNodeMaterial, Sprite } from 'three/webgpu';
import { abs, color, float, hash, instanceIndex, instancedBufferAttribute, length, min, sin, smoothstep, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, lineMaterial, strokes, targetMaterial, type Fade } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const R = 13;
const ARMS = 4;
const TAU = Math.PI * 2;
const PINK = new Color(0xf58cff);
const WARM = new Color(0xffd9a0);
const BLUE = new Color(0x9ae0ff);
const WHITE = new Color(0xffffff);
const VIOLET = new Color(0xa88cff);
const CORE_WARM = new Color(0xffe2b8);

/** Arm centre line (logarithmic spiral): the angle at radius r for a given arm. */
const armAngle = (arm: number, r: number) => arm * (TAU / ARMS) + Math.log(r) * 2.3;

/** A set of stars: positions, premultiplied colours and sizes, drawn as one instanced sprite. */
class StarSet {
  pos: number[] = [];
  col: number[] = [];
  size: number[] = [];
  add(x: number, y: number, z: number, c: Color, bright: number, size: number) {
    this.pos.push(x, y, z);
    this.col.push(c.r * bright, c.g * bright, c.b * bright);
    this.size.push(size);
  }
  sprite(fade: Fade) {
    const pos = new Float32Array(this.pos);
    const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
    mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3), 'vec3');
    const sz = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(this.size), 1), 'float') as unknown as ReturnType<typeof float>;
    mat.sizeNode = sz;
    mat.colorNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(this.col), 3), 'vec3');
    const d = uv().sub(0.5);
    const soft = smoothstep(0.5, 0.05, length(d));
    // diffraction spikes, only on the big stars
    const spike = smoothstep(0.03, 0, min(abs(d.x), abs(d.y))).mul(smoothstep(0.5, 0, length(d))).mul(smoothstep(3, 5.5, sz));
    const seed = hash(instanceIndex);
    const tw = sin(time.mul(seed.mul(1.2).add(0.4)).add(seed.mul(50))).mul(0.2).add(0.8);
    mat.opacityNode = soft.add(spike.mul(0.8)).mul(tw).mul(fade);
    const s = new Sprite(mat);
    s.count = pos.length / 3;
    s.frustumCulled = false;
    s.userData.points = pos;
    return s;
  }
}

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(TAU * rand());
}

function glow(fade: Fade, tint: Color, size: number, opacity: number, pulse = 0.1) {
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(3), 3), 'vec3');
  mat.sizeNode = float(size);
  mat.colorNode = color(tint);
  const s = smoothstep(0.5, 0, length(uv().sub(0.5)));
  mat.opacityNode = s.mul(s).mul(float(opacity)).mul(sin(time.mul(1.7)).mul(pulse).add(1)).mul(fade);
  const sp = new Sprite(mat);
  sp.count = 1;
  sp.frustumCulled = false;
  sp.userData.noSample = true;
  return sp;
}

/** [6] Inside the crystal: a galaxy. One of its stars is not a star. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow: hover } = layerBase();
  const rand = rng(2026);
  const D = ctx.detail;
  const m = ctx.reducedMotion ? 0.3 : 1;
  const N = Math.round(80000 * D);

  const disc = new Group();
  disc.rotation.x = 0.18;
  root.add(disc);
  const armsG = new Group(); // arms, dust, nebulae, clusters, beacon
  const bulgeG = new Group(); // bulge turns a little faster than the disc
  const haloG = new Group();
  disc.add(armsG, bulgeG, haloG);

  // The odd star sits on arm 1 at r = 7: keep the stars clear of it.
  const bA = armAngle(1, 7);
  const bx = Math.cos(bA) * 7;
  const bz = Math.sin(bA) * 7;

  const armStar = (set: StarSet) => {
    for (;;) {
      const t = Math.pow(rand(), 0.8);
      const r = 1.2 + t * (R - 1.5);
      const sigma = 0.2 + 0.12 * t;
      const g = gauss(rand) * sigma;
      // dust lane: the leading edge of each arm is mostly empty
      if (g > -0.36 * (0.6 + t) && g < -0.12 && rand() < 0.88) continue;
      const a = armAngle(Math.floor(rand() * ARMS), r) + g;
      const spread = gauss(rand) * 0.22 * (0.4 + t);
      const x = Math.cos(a) * r + spread;
      const z = Math.sin(a) * r + spread * 0.7;
      if (Math.hypot(x - bx, z - bz) < 0.45) continue;
      const y = gauss(rand) * 0.1 * (1 - t * 0.5);
      const pick = rand();
      let c: Color = BLUE;
      if (pick > 0.92) c = WARM;
      else if (pick > 0.8 || (g > 0 && g < sigma * 0.9 && pick > 0.7)) c = PINK;
      else if (pick > 0.6) c = WHITE;
      const d = Math.min(1, r / R);
      const b = (0.3 + 0.7 * Math.pow(rand(), 1.4)) * (1 - d * 0.35);
      set.add(x, y, z, c, b, 1 + Math.pow(rand(), 6) * 7);
      return;
    }
  };

  // ---- Arms + inter-arm disc.
  const arms = new StarSet();
  const nArms = Math.round(N * 0.56);
  for (let i = 0; i < nArms; i++) armStar(arms);
  const nInter = Math.round(N * 0.17);
  for (let i = 0; i < nInter; i++) {
    const r = Math.min(R - 0.3, 1.6 + -Math.log(1 - rand() * 0.95) * 3.6);
    const a = rand() * TAU;
    arms.add(Math.cos(a) * r, gauss(rand) * 0.08, Math.sin(a) * r, rand() < 0.3 ? WARM : BLUE, 0.15 + 0.35 * rand(), 0.9 + rand() * 0.8);
  }
  armsG.add(arms.sprite(fade));

  // ---- Bulge and bar.
  const bulge = new StarSet();
  const nBulge = Math.round(N * 0.19);
  for (let i = 0; i < nBulge; i++) {
    let r = Math.abs(gauss(rand)) * 1.25;
    r = r * (0.6 + 0.4 * Math.min(1, r / 1.2));
    const a = rand() * TAU;
    let x = Math.cos(a) * r;
    let z = Math.sin(a) * r;
    if (i % 3 === 0) {
      // bar: stretched along a tilted axis
      const bx2 = x * 1.7;
      const bz2 = z * 0.55;
      x = bx2 * Math.cos(0.5) - bz2 * Math.sin(0.5);
      z = bx2 * Math.sin(0.5) + bz2 * Math.cos(0.5);
    }
    const y = gauss(rand) * 0.45 * Math.max(0.25, 1 - Math.hypot(x, z) / 3);
    const c = rand() < 0.35 ? WHITE : WARM;
    bulge.add(x, y, z, c, (0.18 + 0.6 * Math.pow(rand(), 1.3)) * (1 - Math.min(0.5, Math.hypot(x, z) / 6)), 0.9 + Math.pow(rand(), 4) * 3);
  }
  bulgeG.add(bulge.sprite(fade));
  for (const [s, o] of [[420, 0.07], [210, 0.12], [80, 0.28]] as const) bulgeG.add(glow(fade, CORE_WARM, s, o, 0.06));

  // ---- Halo: sparse, dim, round.
  const hs = new StarSet();
  const nHalo = Math.round(N * 0.035);
  for (let i = 0; i < nHalo; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * TAU;
    const r = 1.5 + Math.abs(gauss(rand)) * 4.5;
    const s = Math.sqrt(1 - u * u);
    hs.add(Math.cos(th) * s * r, u * r * 0.7, Math.sin(th) * s * r, WARM, 0.12 + 0.25 * rand(), 0.9 + rand() * 0.7);
  }
  haloG.add(hs.sprite(fade));

  // ---- Star clusters: open ones along the arms, two globular ones above and below the plane.
  const cl = new StarSet();
  const clusters: { x: number; y: number; z: number; s: number; n: number; arm: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const r = 4.5 + i * 1.15;
    const g = (rand() - 0.5) * 0.2;
    const a = armAngle(i % ARMS, r) + g;
    clusters.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, s: 0.25 + rand() * 0.2, n: 160 + Math.floor(rand() * 120), arm: i % ARMS });
  }
  clusters.push({ x: 5.2, y: 2.6, z: -2.4, s: 0.3, n: 420, arm: -1 }, { x: -4.4, y: -2.2, z: 3.8, s: 0.26, n: 360, arm: -1 });
  for (const c of clusters) {
    const n = Math.round(c.n * Math.max(0.4, D));
    for (let k = 0; k < n; k++) {
      const rr = c.s * Math.pow(Math.abs(gauss(rand)), 1.1);
      const u = rand() * 2 - 1;
      const th = rand() * TAU;
      const sn = Math.sqrt(1 - u * u);
      cl.add(c.x + Math.cos(th) * sn * rr, c.y + u * rr, c.z + Math.sin(th) * sn * rr, c.arm < 0 ? WARM : rand() < 0.5 ? WHITE : BLUE, 0.4 + 0.6 * Math.pow(rand(), 1.5), 1.1 + Math.pow(rand(), 3) * 2.8);
    }
  }
  armsG.add(cl.sprite(fade));

  // ---- Nebulae: big, very soft sprites, pink/violet and cyan, hugging the dust lanes.
  const neb = new StarSet();
  const nClouds = Math.round(18 * Math.max(0.6, D));
  const per = Math.round(34 * Math.max(0.5, D));
  const tints = [PINK, VIOLET, CYAN, new Color(0xffa8d0)];
  for (let c = 0; c < nClouds; c++) {
    const r = 3.2 + rand() * 9;
    const a = armAngle(c % ARMS, r) + (rand() - 0.2) * 0.35;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const tint = tints[c % tints.length];
    const sig = 0.5 + rand() * 0.7;
    for (let k = 0; k < per; k++) neb.add(cx + gauss(rand) * sig, gauss(rand) * 0.15, cz + gauss(rand) * sig, tint, 0.006 + rand() * 0.012, 70 + rand() * 150);
  }
  for (let k = 0; k < 24; k++) neb.add(gauss(rand) * 1.4, gauss(rand) * 0.2, gauss(rand) * 1.4, WARM, 0.006 + rand() * 0.008, 140 + rand() * 160);
  const nebMat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  nebMat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(neb.pos), 3), 'vec3');
  nebMat.sizeNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(neb.size), 1), 'float');
  nebMat.colorNode = instancedBufferAttribute(new InstancedBufferAttribute(new Float32Array(neb.col), 3), 'vec3');
  const ns = smoothstep(0.5, 0, length(uv().sub(0.5)));
  nebMat.opacityNode = ns.mul(ns).mul(sin(time.mul(0.25).add(hash(instanceIndex).mul(30))).mul(0.15).add(0.85)).mul(fade);
  const nebula = new Sprite(nebMat);
  nebula.count = neb.pos.length / 3;
  nebula.frustumCulled = false;
  armsG.add(nebula);

  // ---- Hologram guides: orbit rings with a degree scale, arm centre lines, polar spokes, an outer stroke ring.
  const guides = new Lines();
  for (let r = 2.5; r <= R; r += 2.5) guides.circle(0, 0, 0, r, 128);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    guides.seg(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5, Math.cos(a) * R, 0, Math.sin(a) * R);
  }
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU;
    const l = i % 5 === 0 ? 0.4 : 0.18;
    guides.seg(Math.cos(a) * (R + 0.6), 0, Math.sin(a) * (R + 0.6), Math.cos(a) * (R + 0.6 + l), 0, Math.sin(a) * (R + 0.6 + l));
  }
  for (let arm = 0; arm < ARMS; arm++) {
    let px = 0;
    let pz = 0;
    for (let i = 0; i <= 90; i++) {
      const r = 1.2 + (i / 90) * (R - 1.5);
      const a = armAngle(arm, r);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (i > 0) guides.seg(px, 0, pz, x, 0, z);
      px = x;
      pz = z;
    }
  }
  armsG.add(new LineSegments(guides.geometry(), lineMaterial(fade, CYAN, 0.09)));
  armsG.add(strokes(new Lines().circle(0, 0, 0, R + 0.6, 160).circle(0, 0, 0, R + 0.5, 160).positions(), fade, CYAN, 0.28, 1.6));

  // ---- The odd star: a beacon with a reticle. Amber, pulsing, clearly not a star.
  const beacon = new Group();
  beacon.position.set(bx, 0.05, bz);
  armsG.add(beacon);
  const reticle = new Lines().circle(0, 0, 0, 0.32, 40, true).circle(0, 0, 0, 0.18, 24, true).circle(0, 0, 0, 0.32, 40);
  for (const [a, b] of [[-0.62, -0.38], [0.38, 0.62]]) reticle.seg(a, 0, 0, b, 0, 0).seg(0, a, 0, 0, b, 0).seg(0, 0, a, 0, 0, b);
  reticle.seg(0, 0.7, 0, 0, 1.7, 0).seg(0, -0.7, 0, 0, -1.7, 0);
  const reticleObj = new LineSegments(reticle.geometry(), targetMaterial(fade, hover));
  beacon.add(reticleObj);
  const brackets = new Lines();
  for (let k = 0; k < 4; k++) {
    const a = (k * TAU) / 4 + 0.3;
    brackets.circle(0, 0, 0, 0.5, 8, false, a, a + 0.9);
  }
  const bracketObj = new LineSegments(brackets.geometry(), targetMaterial(fade, hover));
  beacon.add(bracketObj);
  beacon.add(glow(fade, AMBER, 110, 0.5, 0.45));
  beacon.add(glow(fade, new Color(0xfff0d0), 26, 1, 0.3));

  // ---- HUD anchors.
  const mk = (x: number, y: number, z: number, parent: Object3D) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const arm0 = armAngle(0, 10);
  const lane = armAngle(2, 5.5) - 0.24;
  const labels = [
    { object: beacon, pt: 'ANOMALIA · SINAL FRACO', en: 'ANOMALY · FAINT SIGNAL' },
    { object: mk(0, 0.7, 0, bulgeG), pt: 'BULBO GALÁCTICO · 10⁹ ESTRELAS', en: 'GALACTIC BULGE · 10⁹ STARS' },
    { object: mk(Math.cos(arm0) * 10, 0, Math.sin(arm0) * 10, armsG), pt: 'BRAÇO ESPIRAL · Σ-1', en: 'SPIRAL ARM · Σ-1' },
    { object: mk(clusters[2].x, 0.3, clusters[2].z, armsG), pt: 'AGLOMERADO ABERTO · 2.100 EST.', en: 'OPEN CLUSTER · 2,100 STARS' },
    { object: mk(Math.cos(lane) * 5.5, 0, Math.sin(lane) * 5.5, armsG), pt: 'FAIXA DE POEIRA · OPACA', en: 'DUST LANE · OPAQUE' },
  ];

  return {
    id: 'galaxy',
    caption: { pt: 'Dentro do cristal, uma galáxia. Uma das estrelas não é uma estrela.', en: 'Inside the crystal, a galaxy. One of the stars is not a star.' },
    root,
    fade,
    glow: hover,
    radius: R,
    view: { distance: 25, minDistance: 8, maxDistance: 34, pitch: 0.62, height: 0 },
    target: { object: beacon, radius: 0.55 },
    labels,
    update(t) {
      armsG.rotation.y = t * 0.025 * m;
      bulgeG.rotation.y = t * 0.045 * m;
      haloG.rotation.y = t * 0.012 * m;
      reticleObj.rotation.y = t * 0.9 * m;
      bracketObj.rotation.y = -t * 0.6 * m;
      bracketObj.rotation.x = Math.sin(t * 0.5) * 0.4;
    },
  };
}
