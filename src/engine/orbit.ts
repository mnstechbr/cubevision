import { MathUtils, Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { View } from './layers';

interface Pose {
  target: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
}

const PITCH_LIMIT = 1.25;

/**
 * Damped orbit camera. Input and the dive both write to `goal`;
 * the camera eases toward it every frame, so nothing ever snaps.
 */
export class Orbit {
  readonly now: Pose = { target: new Vector3(), yaw: 0, pitch: 0.35, distance: 10 };
  readonly goal: Pose = { target: new Vector3(), yaw: 0, pitch: 0.35, distance: 10 };
  minDistance = 1;
  maxDistance = 100;
  /** While locked (during a dive) user input is ignored. */
  locked = false;
  /** Camera follow speed (1/s). */
  stiffness = 6;
  private idle = 0;
  private spinYaw = 0;
  private spinPitch = 0;
  private lastNear = 0;

  constructor(
    private camera: PerspectiveCamera,
    private reducedMotion: boolean,
  ) {}

  apply(view: View, snap = false) {
    this.minDistance = view.minDistance;
    this.maxDistance = view.maxDistance;
    this.goal.target.set(0, view.height, 0);
    this.goal.pitch = view.pitch;
    this.goal.distance = view.distance;
    if (snap) copy(this.goal, this.now);
  }

  /** Keep turning at this speed (rad/s), slowing down on its own. */
  fling(vYaw: number, vPitch: number) {
    if (this.locked) return;
    const cap = 6;
    this.spinYaw = Math.max(-cap, Math.min(cap, vYaw));
    this.spinPitch = Math.max(-cap, Math.min(cap, vPitch)) * 0.5;
  }

  rotate(dYaw: number, dPitch: number) {
    if (this.locked) return;
    this.spinYaw = this.spinPitch = 0;
    this.goal.yaw -= dYaw;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.idle = 0;
  }

  zoom(factor: number) {
    if (this.locked) return;
    this.goal.distance = MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
    this.idle = 0;
  }

  /**
   * Floating origin: the world under the camera was moved by `offset`, scaled by `scale`
   * and turned by `yaw`; re-express the camera in the new (unit) frame so nothing moves on screen.
   */
  rebase(offset: Vector3, scale: number, yaw: number) {
    for (const p of [this.now, this.goal]) {
      p.target.sub(offset).divideScalar(scale).applyAxisAngle(UP, -yaw);
      p.distance /= scale;
      p.yaw -= yaw;
    }
  }

  update(dt: number) {
    const g = this.goal;
    const n = this.now;
    if (this.locked) this.spinYaw = this.spinPitch = 0;
    if (this.spinYaw || this.spinPitch) {
      g.yaw -= this.spinYaw * dt;
      g.pitch = MathUtils.clamp(g.pitch + this.spinPitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
      const decay = Math.exp(-dt * 1.8);
      this.spinYaw = Math.abs(this.spinYaw * decay) < 0.02 ? 0 : this.spinYaw * decay;
      this.spinPitch = Math.abs(this.spinPitch * decay) < 0.02 ? 0 : this.spinPitch * decay;
      this.idle = 0;
    }
    // Gentle drift after a few idle seconds keeps the hologram alive.
    this.idle += dt;
    if (!this.locked && !this.reducedMotion && this.idle > 5) g.yaw += dt * 0.06;
    const k = 1 - Math.exp(-dt * this.stiffness);
    n.target.lerp(g.target, k);
    n.yaw += (g.yaw - n.yaw) * k;
    n.pitch += (g.pitch - n.pitch) * k;
    // Distance eases in log space: zooming across scales feels uniform.
    n.distance = Math.exp(Math.log(n.distance) + (Math.log(g.distance) - Math.log(n.distance)) * k);

    const cp = Math.cos(n.pitch);
    this.camera.position.set(
      n.target.x + n.distance * cp * Math.sin(n.yaw),
      n.target.y + n.distance * Math.sin(n.pitch),
      n.target.z + n.distance * cp * Math.cos(n.yaw),
    );
    this.camera.lookAt(n.target);

    // Clip planes follow the camera distance so precision holds at every scale.
    const near = n.distance * 0.01;
    if (Math.abs(near - this.lastNear) > this.lastNear * 0.05) {
      this.lastNear = near;
      this.camera.near = near;
      this.camera.far = n.distance * 400;
      this.camera.updateProjectionMatrix();
    }
  }
}

const UP = new Vector3(0, 1, 0);

function copy(from: Pose, to: Pose) {
  to.target.copy(from.target);
  to.yaw = from.yaw;
  to.pitch = from.pitch;
  to.distance = from.distance;
}
