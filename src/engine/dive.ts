import { MathUtils, Quaternion, Vector3, type PerspectiveCamera, type Scene } from 'three/webgpu';
import { disposeTree, type Layer } from './layers';
import type { Orbit } from './orbit';
import type { Particles } from './particles';
import { cloudPoints, samplePoints, vortexPoints } from './sample';

type State = 'idle' | 'intro' | 'focus' | 'dissolve' | 'wait' | 'reform' | 'reveal';

export interface DiveHost {
  scene: Scene;
  camera: PerspectiveCamera;
  orbit: Orbit;
  particles: Particles;
  current: Layer;
  reducedMotion: boolean;
  /** The preloaded next world, or null while it is still loading. */
  next(): Layer | null;
  /** Called once the new world is the current one, at unit scale. */
  arrived(layer: Layer, previous: Layer): void;
}

const smooth = (a: number, b: number, x: number) => MathUtils.smoothstep(x, a, b);
const UP = new Vector3(0, 1, 0);

/**
 * The dive: camera flies to the target → the target dissolves into particles →
 * the particles rebuild themselves as the next world, tiny inside the target →
 * the camera pushes in until it fills the screen → floating-origin reset.
 */
export class Dive {
  state: State = 'idle';
  private t = 0;
  private center = new Vector3();
  private radius = 1;
  private scale = 1;
  private yaw = 0;
  private incoming: Layer | null = null;
  private center2 = new Vector3();
  private edge = new Vector3();
  private quat = new Quaternion();
  private normal = new Vector3();
  private toCam = new Vector3();
  private T: { focus: number; dissolve: number; reform: number; intro: number };
  private onRevealHold: (() => void) | null = null;

  constructor(private host: DiveHost) {
    this.T = host.reducedMotion
      ? { focus: 1.2, dissolve: 1.4, reform: 2.4, intro: 2.4 }
      : { focus: 0.85, dissolve: 1.05, reform: 1.9, intro: 2.6 };
  }

  get busy() {
    return this.state !== 'idle';
  }

  /**
   * Is the cursor (NDC) on the current target? Measured on screen, with a minimum size,
   * so a small or far target is still easy to hit with a shaky hand.
   */
  hits(x: number, y: number, minReach = 0.1) {
    const { camera, current } = this.host;
    const target = current.target;
    camera.updateMatrixWorld();
    target.object.getWorldPosition(this.center2);
    if (target.facing) {
      target.object.getWorldQuaternion(this.quat);
      this.normal.copy(target.facing).applyQuaternion(this.quat);
      if (this.normal.dot(this.toCam.subVectors(camera.position, this.center2)) <= 0) return false;
    }
    // Screen radius: project a point one target-radius to the side of its center.
    this.edge.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(target.radius).add(this.center2).project(camera);
    this.center2.project(camera);
    if (this.center2.z > 1) return false; // behind the camera
    const a = camera.aspect;
    const radius = Math.hypot((this.edge.x - this.center2.x) * a, this.edge.y - this.center2.y);
    const reach = Math.max(radius * 1.6, minReach);
    return Math.hypot((x - this.center2.x) * a, y - this.center2.y) < reach;
  }

  /**
   * Zoom that knows about the target: moving in while it is in the reticle (within `aim` of the
   * screen center) heads for it and, once as close as the world allows, goes through: the dive.
   * Moving out drifts back to the world's own center.
   */
  zoom(f: number, aim: number) {
    if (this.busy) return;
    const { orbit, current } = this.host;
    if (f < 1 && this.hits(0, 0, aim)) {
      current.target.object.getWorldPosition(this.center);
      orbit.goal.target.lerp(this.center, Math.min(1, (1 - f) * 3));
      if (orbit.goal.distance <= orbit.minDistance * 1.02) return this.start();
    } else if (f > 1) {
      this.center.set(0, current.view.height, 0);
      orbit.goal.target.lerp(this.center, Math.min(1, (f - 1) * 2));
    }
    orbit.zoom(f);
  }

  start() {
    if (this.busy) return;
    this.state = 'focus';
    this.t = 0;
    this.host.orbit.locked = true;
    this.focusCamera(4.2);
  }

  /** Opening shot: the current world assembles itself out of a cloud of light. */
  intro() {
    const { current, particles, orbit } = this.host;
    current.fade.value = 0;
    // The light rises from just above the floor, inside the camera's view.
    this.center.set(0, current.view.height * 0.5, 0);
    const n = particles.count;
    cloudPoints(this.center, current.view.distance * 0.35, n, particles.from);
    samplePoints(current.root, n, particles.to);
    particles.commit();
    particles.progress.value = 0;
    particles.opacity.value = 0;
    particles.swirl.value = current.radius * 0.3;
    particles.warmth.value = 0;
    orbit.locked = true;
    this.state = 'intro';
    this.t = 0;
  }

  /**
   * The ending: the whole world turns into `points` (the signature), holds,
   * then rebuilds itself. `onHold` fires when the signature is fully formed.
   */
  reveal(points: Float32Array, onHold: () => void) {
    const { current, particles, orbit } = this.host;
    if (this.busy) return;
    samplePoints(current.root, particles.count, particles.from);
    particles.to.set(points.subarray(0, particles.count * 3));
    particles.commit();
    particles.progress.value = 0;
    particles.swirl.value = current.radius * 0.15;
    particles.warmth.value = 0;
    orbit.locked = true;
    this.onRevealHold = onHold;
    this.state = 'reveal';
    this.t = 0;
  }

  update(dt: number) {
    const { current, particles } = this.host;
    if (this.state === 'idle') return;
    this.t += dt;
    const T = this.T;

    switch (this.state) {
      case 'intro': {
        const p = Math.min(this.t / T.intro, 1);
        particles.progress.value = p;
        particles.opacity.value = smooth(0, 0.15, p) * (1 - smooth(0.8, 1, p));
        current.fade.value = smooth(0.55, 1, p);
        if (p >= 1) this.settle();
        return;
      }

      case 'reveal': {
        // 0–1.8 s form, hold until 7 s, 7–9 s rebuild the world.
        const t = this.t;
        if (t < 7) {
          const p = Math.min(t / 1.8, 1);
          particles.progress.value = p;
          particles.opacity.value = smooth(0, 0.3, p) * 1.4;
          current.fade.value = 1 - 0.85 * smooth(0, 1, p);
          if (p >= 1 && this.onRevealHold) {
            this.onRevealHold();
            this.onRevealHold = null;
          }
          return;
        }
        if (particles.progress.value >= 1 && t - dt < 7) {
          particles.chain();
          samplePoints(current.root, particles.count, particles.to);
          particles.commit();
          particles.progress.value = 0;
        }
        const p = Math.min((t - 7) / 2, 1);
        particles.progress.value = p;
        particles.opacity.value = 1.4 * (1 - smooth(0.6, 1, p));
        current.fade.value = 0.15 + 0.85 * smooth(0.3, 1, p);
        if (p >= 1) this.settle();
        return;
      }

      case 'focus':
        current.glow.value = Math.max(current.glow.value, smooth(0, T.focus, this.t));
        if (this.t >= T.focus) this.beginDissolve();
        return;

      case 'dissolve': {
        const p = Math.min(this.t / T.dissolve, 1);
        particles.progress.value = p;
        particles.opacity.value = smooth(0, 0.1, p);
        current.fade.value = 1 - 0.8 * smooth(0, 1, p);
        if (p >= 1) this.state = 'wait';
        return;
      }

      case 'wait': {
        const next = this.host.next();
        if (next) this.beginReform(next);
        return;
      }

      case 'reform': {
        const next = this.incoming!;
        const p = Math.min(this.t / T.reform, 1);
        particles.progress.value = p;
        particles.opacity.value = 1 - smooth(0.72, 1, p);
        current.fade.value = 0.2 * (1 - smooth(0, 0.55, p));
        next.fade.value = smooth(0.4, 1, p);
        if (p >= 1) this.finish(next);
        return;
      }
    }
  }

  private focusCamera(distanceInRadii: number) {
    const { current, orbit } = this.host;
    current.target.object.getWorldPosition(this.center);
    this.radius = current.target.radius;
    orbit.goal.target.copy(this.center);
    orbit.goal.distance = this.radius * distanceInRadii;
    orbit.goal.pitch = MathUtils.clamp(orbit.goal.pitch, -0.6, 0.6);
  }

  private beginDissolve() {
    const { current, particles, orbit } = this.host;
    const n = particles.count;
    samplePoints(current.target.object, n, particles.from);
    this.toCam.subVectors(this.host.camera.position, this.center).normalize();
    vortexPoints(this.center, this.toCam, this.radius * 1.4, n, particles.to);
    particles.commit();
    particles.progress.value = 0;
    particles.swirl.value = this.radius * 0.5;
    particles.warmth.value = 1;
    current.target.object.visible = false;
    orbit.goal.distance = this.radius * 3.2;
    this.state = 'dissolve';
    this.t = 0;
  }

  private beginReform(next: Layer) {
    const { scene, particles, orbit } = this.host;
    this.incoming = next;
    // The next world appears inside the target, small enough to fit in it,
    // turned so its front faces the camera.
    this.scale = (this.radius * 0.9) / next.radius;
    this.yaw = orbit.now.yaw;
    next.root.scale.setScalar(this.scale);
    next.root.rotation.set(0, this.yaw, 0);
    next.root.position.copy(this.center).addScaledVector(UP, -next.view.height * this.scale);
    next.fade.value = 0;
    scene.add(next.root);

    particles.chain();
    samplePoints(next.root, particles.count, particles.to);
    particles.commit();
    particles.progress.value = 0;
    particles.swirl.value = this.radius * 0.45;
    particles.warmth.value = 0;

    orbit.stiffness = 2.6;
    orbit.goal.target.copy(this.center);
    orbit.goal.distance = next.view.distance * this.scale;
    orbit.goal.pitch = next.view.pitch;
    this.state = 'reform';
    this.t = 0;
  }

  private finish(next: Layer) {
    const { scene, orbit, particles } = this.host;
    const previous = this.host.current;
    const offset = next.root.position.clone();
    next.root.position.set(0, 0, 0);
    next.root.scale.setScalar(1);
    next.root.rotation.set(0, 0, 0);
    orbit.rebase(offset, this.scale, this.yaw);
    scene.remove(previous.root);
    disposeTree(previous.root);
    particles.opacity.value = 0;
    next.fade.value = 1;
    this.incoming = null;
    this.host.current = next;
    orbit.minDistance = next.view.minDistance;
    orbit.maxDistance = next.view.maxDistance;
    this.settle();
    this.host.arrived(next, previous);
  }

  private settle() {
    const { orbit, particles, current } = this.host;
    particles.opacity.value = 0;
    current.fade.value = 1;
    current.glow.value = 0;
    orbit.stiffness = 6;
    orbit.locked = false;
    this.state = 'idle';
  }
}
