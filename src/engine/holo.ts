import {
  AdditiveBlending,
  BufferGeometry,
  Color,
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

export function lineMaterial(fade: Fade, tint: ColorRepresentation = CYAN, opacity = 0.9) {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  m.colorNode = color(new Color(tint));
  m.opacityNode = float(opacity).mul(scan).mul(flick).mul(sweep).mul(fade);
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
  m.opacityNode = mix(float(0.04), float(1), rim).mul(opacity).mul(scan).mul(sweep).mul(fade);
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
