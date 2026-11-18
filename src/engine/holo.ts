import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
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
  time,
  uniform,
} from 'three/tsl';

/** Shared knobs. `flicker` goes to 0 under prefers-reduced-motion. */
export const holo = {
  flicker: uniform(1),
};

export const CYAN = new Color(0x3fe8ff);
export const ICE = new Color(0xb8f6ff);
export const AMBER = new Color(0xffa63d);

const makeFade = () => uniform(1);
export type Fade = ReturnType<typeof makeFade>;

// Moving scan bands + a tiny electrical flicker: the "projected light" feel.
const scan = sin(positionWorld.y.mul(26).sub(time.mul(2.4))).mul(0.18).add(0.82);
const flick = sin(time.mul(41)).mul(sin(time.mul(7.3))).mul(0.07).mul(holo.flicker).add(1);

export function lineMaterial(fade: Fade, tint: ColorRepresentation = CYAN, opacity = 0.9) {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  m.colorNode = color(new Color(tint));
  m.opacityNode = float(opacity).mul(scan).mul(flick).mul(fade);
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
  m.opacityNode = mix(float(0.04), float(1), rim).mul(opacity).mul(scan).mul(fade);
  return m;
}

/** The dive spot: warm, slowly breathing; `glow` (0..1) rises on hover/arm. */
export function targetMaterial(fade: Fade, glow: Fade) {
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const breathe = sin(time.mul(2.2)).mul(0.5).add(0.5);
  m.colorNode = color(AMBER);
  m.opacityNode = float(0.35).add(breathe.mul(0.25)).add(glow.mul(0.9)).mul(flick).mul(fade);
  return m;
}

export function edges(geometry: BufferGeometry, material: LineBasicNodeMaterial, thresholdDeg = 1) {
  return new LineSegments(new EdgesGeometry(geometry, thresholdDeg), material);
}
