import { AdditiveBlending, Group, InstancedBufferAttribute, LineSegments, PointsNodeMaterial, Sprite } from 'three/webgpu';
import { float, hash, instanceIndex, instancedBufferAttribute, length, sin, smoothstep, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { CYAN, lineMaterial, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const R = 13;
const ARMS = 4;

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(Math.PI * 2 * rand());
}

/** [6] Inside the crystal: a galaxy. One of its stars is not a star. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(2026);
  const disc = new Group();
  disc.rotation.x = 0.18;
  root.add(disc);

  const n = Math.round(42000 * ctx.detail);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const core = i < n * 0.18;
    let x: number;
    let y: number;
    let z: number;
    if (core) {
      const r = Math.abs(gauss(rand)) * 1.4;
      const a = rand() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = gauss(rand) * 0.35 * Math.max(0.2, 1 - r / 2.5);
    } else {
      const t = Math.pow(rand(), 0.8);
      const r = 1.2 + t * (R - 1.5);
      const arm = (i % ARMS) * ((Math.PI * 2) / ARMS);
      const a = arm + Math.log(r) * 2.3 + gauss(rand) * (0.22 + 0.12 * t);
      const spread = gauss(rand) * 0.35 * (0.4 + t);
      x = Math.cos(a) * r + spread;
      z = Math.sin(a) * r + spread;
      y = gauss(rand) * 0.12;
    }
    pos.set([x, y, z], i * 3);
    // Warm white core, ice arms, cyan dust at the rim.
    const d = Math.min(1, Math.hypot(x, z) / R);
    col.set([1 - d * 0.75, 0.92 - d * 0.1, 0.85 + d * 0.15], i * 3);
  }

  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = instancedBufferAttribute(new InstancedBufferAttribute(pos, 3));
  const seed = hash(instanceIndex);
  mat.sizeNode = float(1.1).add(seed.mul(seed).mul(2.6));
  mat.colorNode = instancedBufferAttribute(new InstancedBufferAttribute(col, 3), 'vec3');
  mat.opacityNode = smoothstep(0.5, 0.05, length(uv().sub(0.5)))
    .mul(sin(time.mul(0.7).add(seed.mul(50))).mul(0.25).add(0.6))
    .mul(fade);
  const stars = new Sprite(mat);
  stars.count = n;
  stars.frustumCulled = false;
  stars.userData.points = pos;
  disc.add(stars);

  // Faint orbit guides.
  const guides = new Lines();
  for (let r = 3; r <= R; r += 2.5) guides.circle(0, 0, 0, r, 128);
  disc.add(new LineSegments(guides.geometry(), lineMaterial(fade, CYAN, 0.08)));

  // The odd star, out on an arm: a beacon with a reticle around it.
  const beacon = new Group();
  const a = 1 * ((Math.PI * 2) / ARMS) + Math.log(7) * 2.3;
  beacon.position.set(Math.cos(a) * 7, 0.05, Math.sin(a) * 7);
  disc.add(beacon);
  const reticle = new Lines()
    .circle(0, 0, 0, 0.32, 40, true)
    .circle(0, 0, 0, 0.18, 24, true)
    .circle(0, 0, 0, 0.32, 40)
    .seg(-0.5, 0, 0, -0.36, 0, 0)
    .seg(0.36, 0, 0, 0.5, 0, 0)
    .seg(0, -0.5, 0, 0, -0.36, 0)
    .seg(0, 0.36, 0, 0, 0.5, 0);
  const reticleObj = new LineSegments(reticle.geometry(), targetMaterial(fade, glow));
  beacon.add(reticleObj);

  return {
    id: 'galaxy',
    root,
    fade,
    glow,
    radius: R,
    view: { distance: 21, minDistance: 8, maxDistance: 30, pitch: 0.62, height: 0 },
    target: { object: beacon, radius: 0.55 },
    update(t, dt) {
      disc.rotation.y += dt * 0.025;
      reticleObj.rotation.y = t * 0.9;
    },
  };
}
