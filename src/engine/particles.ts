import { AdditiveBlending, InstancedBufferAttribute, PointsNodeMaterial, Sprite } from 'three/webgpu';
import {
  clamp,
  color,
  float,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  mix,
  normalize,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { AMBER, ICE } from './holo';

/**
 * One pooled particle system for every transition: allocated once at the max size,
 * re-targeted by rewriting two buffers. The morph itself runs entirely on the GPU.
 */
export class Particles {
  readonly object: Sprite;
  readonly from: Float32Array;
  readonly to: Float32Array;
  readonly max: number;
  /** 0 → particles at `from`, 1 → at `to` (each particle has its own delay). */
  readonly progress = uniform(0);
  readonly opacity = uniform(0);
  /** World-units of sideways drift at mid-flight. */
  readonly swirl = uniform(0);
  /** 0 = cyan/ice, 1 = amber (particles born from the target start warm). */
  readonly warmth = uniform(0);
  private fromAttr: InstancedBufferAttribute;
  private toAttr: InstancedBufferAttribute;

  constructor(max: number) {
    this.max = max;
    this.from = new Float32Array(max * 3);
    this.to = new Float32Array(max * 3);
    this.fromAttr = new InstancedBufferAttribute(this.from, 3);
    this.toAttr = new InstancedBufferAttribute(this.to, 3);

    const seed = hash(instanceIndex);
    const local = clamp(this.progress.sub(seed.mul(0.35)).div(0.65), 0, 1);
    const eased = smoothstep(0, 1, local);
    const dir = normalize(
      vec3(hash(instanceIndex.add(11)), hash(instanceIndex.add(23)), hash(instanceIndex.add(37))).sub(0.5),
    );
    const arc = sin(local.mul(Math.PI)).mul(this.swirl);
    const wobble = sin(time.mul(1.7).add(seed.mul(40))).mul(0.15).add(1);
    const pos = mix(instancedBufferAttribute(this.fromAttr), instancedBufferAttribute(this.toAttr), eased).add(
      dir.mul(arc).mul(wobble),
    );

    const mat = new PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: false,
    });
    mat.positionNode = pos;
    mat.sizeNode = float(1.4).add(seed.mul(1.4));
    const disc = smoothstep(0.5, 0.1, length(uv().sub(0.5)));
    mat.colorNode = mix(color(ICE), color(AMBER), this.warmth.mul(float(1).sub(eased)));
    mat.opacityNode = disc.mul(this.opacity).mul(float(0.25).add(seed.mul(0.5)));

    this.object = new Sprite(mat);
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
  }

  setCount(n: number) {
    this.object.count = Math.min(n, this.max);
  }

  get count() {
    return this.object.count;
  }

  /** Call after writing into `from`/`to`. */
  commit() {
    this.fromAttr.needsUpdate = true;
    this.toAttr.needsUpdate = true;
  }

  /** Continue from where particles landed: last `to` becomes the new `from`. */
  chain() {
    this.from.set(this.to);
  }
}
