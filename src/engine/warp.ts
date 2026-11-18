import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, LineBasicNodeMaterial, LineSegments } from 'three/webgpu';
import { attribute, color, float, fract, time, uniform, vec3 } from 'three/tsl';
import { ICE } from './holo';

/**
 * Light streaks rushing past the lens during a dive: the "falling into the next world" feel.
 * Lives in camera space (the engine copies the camera onto `object` each frame) and is
 * scaled by the orbit distance, so it reads the same at every scale. `amount` 0..1 drives it.
 */
export function createWarp(count = 500) {
  const pos: number[] = [];
  const seed: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.25 + Math.pow(Math.random(), 0.7) * 1.6; // keep the center clear
    const s = Math.random();
    for (const e of [0, 1]) {
      pos.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      seed.push(s);
      end.push(e);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('seed', new Float32BufferAttribute(seed, 1));
  geo.setAttribute('end', new Float32BufferAttribute(end, 1));

  const amount = uniform(0);
  const depth = 6;
  const s = attribute('seed', 'float');
  const z = fract(s.add(time.mul(0.9))).mul(-depth).add(0.2); // travels toward the camera
  const len = amount.mul(1.4).add(0.05);
  const p = attribute('position', 'vec3');
  const m = new LineBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending });
  m.positionNode = vec3(p.x, p.y, z.sub(attribute('end', 'float').mul(len)));
  m.colorNode = color(ICE);
  // Fade in from the far end, out right before the lens.
  m.opacityNode = amount.mul(z.negate().div(depth).oneMinus().mul(z.negate().min(1))).mul(float(0.5).add(s.mul(0.5)));

  const object = new Group();
  const lines = new LineSegments(geo, m);
  lines.frustumCulled = false;
  lines.renderOrder = 20;
  object.add(lines);
  object.visible = false;
  return { object, amount };
}
