import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  PointsNodeMaterial,
  Sprite,
  DoubleSide,
  EdgesGeometry,
  Line2NodeMaterial,
  LineBasicNodeMaterial,
  LineSegments,
  MeshBasicNodeMaterial,
  type ColorRepresentation,
} from 'three/webgpu';
import {
  abs,
  color,
  dot,
  float,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  mix,
  normalize,
  normalView,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
} from 'three/tsl';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/**
 * Shared knobs. `flicker` goes to 0 under prefers-reduced-motion.
 * `sweepY`/`sweepWidth`: a band of brighter light that the engine moves through the world (world Y).
 */
export const holo = {
  flicker: uniform(1),
  sweepY: uniform(-1000),
  sweepWidth: uniform(0.4),
  /** Depth fog (view-space distance). The engine ties it to the camera distance, so it scales. */
  fogNear: uniform(1e6),
  fogFar: uniform(2e6),
};

export const CYAN = new Color(0x3fe8ff);
export const ICE = new Color(0xb8f6ff);
export const AMBER = new Color(0xffa63d);

const makeFade = () => uniform(1);
export type Fade = ReturnType<typeof makeFade>;

// Moving scan bands + a tiny electrical flicker: the "projected light" feel.
const scan = sin(positionWorld.y.mul(26).sub(time.mul(2.4))).mul(0.18).add(0.82);
const flick = sin(time.mul(41)).mul(sin(time.mul(7.3))).mul(0.07).mul(holo.flicker).add(1);
const sweep = smoothstep(holo.sweepWidth, float(0), abs(positionWorld.y.sub(holo.sweepY))).mul(2.2).add(1);
// Far things sink into the dark: worlds lose their edges and gain depth.
const fog = float(1).sub(smoothstep(holo.fogNear, holo.fogFar, positionView.z.negate()));

export function lineMaterial(fade: Fade, tint: ColorRepresentation = CYAN, opacity = 0.9) {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  m.colorNode = color(new Color(tint));
  m.opacityNode = float(opacity).mul(scan).mul(flick).mul(sweep).mul(fog).mul(fade);
  return m;
}

/** Faint translucent faces with a fresnel rim, so volumes read as solid light. */
export function fillMaterial(fade: Fade, tint: ColorRepresentation = CYAN, opacity = 0.22) {
  const m = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const facing = abs(dot(normalView, normalize(positionView.negate())));
  const rim = pow(float(1).sub(facing), 2.2);
  m.colorNode = color(new Color(tint));
  m.opacityNode = mix(float(0.04), float(1), rim).mul(opacity).mul(scan).mul(sweep).mul(fog).mul(fade);
  return m;
}

/** The dive spot: warm, slowly breathing; `glow` (0..1) rises on hover/arm. */
export function targetMaterial(fade: Fade, glow: Fade) {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const breathe = sin(time.mul(2.2)).mul(0.5).add(0.5);
  m.colorNode = color(AMBER);
  // Bright enough to stand out in the densest world (exposure dims everything before bloom).
  m.opacityNode = float(0.7).add(breathe.mul(0.45)).add(glow.mul(1.2)).mul(flick).mul(fade);
  return m;
}

export function edges(geometry: BufferGeometry, material: LineBasicNodeMaterial, thresholdDeg = 1) {
  return new LineSegments(new EdgesGeometry(geometry, thresholdDeg), material);
}

/**
 * Thick glowing strokes (screen-space width in px) for silhouettes and main structure.
 * Use them for the few lines that define a shape; keep dense detail as thin `lineMaterial` lines.
 * `positions` are segment pairs (as from `Lines.positions()`), in the object's local space.
 */
export function strokes(positions: Float32Array, fade: Fade, tint: ColorRepresentation = ICE, opacity = 1, width = 2.4) {
  const m = new Line2NodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, linewidth: width });
  m.colorNode = color(new Color(tint));
  m.opacityNode = float(opacity).mul(flick).mul(fade);
  const line = new LineSegments2(new LineSegmentsGeometry().setPositions(positions), m);
  line.userData.segments = positions; // what the particle sampler reads
  return line;
}

/**
 * The world doesn't end at its edge: a floor grid that runs out to the horizon (and into the
 * fog) plus a dome of faint stars. Neither is sampled by the dive particles.
 */
export function horizon(fade: Fade, radius: number, y = 0) {
  const g = new Group();
  const pos: number[] = [];
  const ring = (r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      pos.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  };
  for (let k = 1; k <= 10; k++) ring(radius * (1 + k * 0.6), 160);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    pos.push(Math.cos(a) * radius * 1.4, y, Math.sin(a) * radius * 1.4, Math.cos(a) * radius * 7, y, Math.sin(a) * radius * 7);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const grid = new LineSegments(geo, lineMaterial(fade, CYAN, 0.12));
  grid.userData.noSample = true;
  g.add(grid);

  const n = 1400;
  const stars = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 0.95 + 0.05; // upper hemisphere only
    const a = Math.random() * Math.PI * 2;
    const r = radius * (9 + Math.random() * 3);
    const s = Math.sqrt(1 - u * u);
    stars.set([Math.cos(a) * s * r, y + u * r * 0.6, Math.sin(a) * s * r], i * 3);
  }
  const m = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  m.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(stars, 3));
  const seed = hash(instanceIndex);
  m.sizeNode = float(1).add(seed.mul(seed).mul(2));
  m.colorNode = color(ICE);
  m.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(sin(time.mul(0.6).add(seed.mul(40))).mul(0.25).add(0.45)).mul(fade);
  const sky = new Sprite(m);
  sky.count = n;
  sky.frustumCulled = false;
  sky.userData.noSample = true;
  g.add(sky);
  return g;
}
