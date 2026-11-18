import { AdditiveBlending, PointsNodeMaterial, Sprite } from 'three/webgpu';
import { cameraPosition, color, float, fract, hash, instanceIndex, length, sin, smoothstep, time, uniform, uv, vec3 } from 'three/tsl';
import { ICE } from './holo';

/**
 * Motes of light hanging in the air around the camera. They live in camera space,
 * scaled by the orbit distance, so they look the same in every world at every scale.
 */
export function createDust(count: number) {
  const scale = uniform(10);
  const opacity = uniform(1);
  const base = vec3(hash(instanceIndex), hash(instanceIndex.add(1)), hash(instanceIndex.add(2)));
  const drift = vec3(0.004, 0.009, 0.003).mul(time);
  const cell = fract(base.add(drift)).sub(0.5);
  const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false });
  mat.positionNode = cameraPosition.add(cell.mul(scale).mul(2.2));
  mat.sizeNode = float(1.2).add(hash(instanceIndex.add(3)).mul(1.4));
  const twinkle = sin(time.mul(0.8).add(hash(instanceIndex.add(4)).mul(30))).mul(0.5).add(0.5);
  // Fade motes right next to the lens and at the edge of the box (no popping when they wrap).
  const edge = smoothstep(0.5, 0.35, length(cell));
  mat.colorNode = color(ICE);
  mat.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5))).mul(twinkle).mul(edge).mul(0.22).mul(opacity);
  const sprite = new Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  return { object: sprite, scale, opacity };
}
