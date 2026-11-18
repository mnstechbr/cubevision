import type { Cursor } from '../ui';
import { OneEuro } from './oneEuro';
import type { Intents } from './pointer';

/** One detected hand: 21 landmarks as x,y,z triplets in image space (0..1), not mirrored. */
export interface HandFrame {
  label: string;
  landmarks: Float32Array;
}

// Calibrated on a real recording (test/fixtures/cubevision-maos.json, Logitech-class webcam at ~14 fps):
// - fingertip reach is cleanly bimodal: fist ≈ 0.6–0.75, open ≈ 1.3–1.45;
// - a "still" palm jitters ~1.3% of the image width per frame (p90 3%);
// - hand size jitters ±5% per frame, so it can't drive anything fine.
// A second recording (cubevision-maos-2.json, 90 s) shows the tracker losing the hand once the palm
// moves faster than ~0.5 image widths/s: fast moves can't be tracked, so slow ones must do a lot
// (high gain) and a fast flick that loses the hand keeps the world spinning (the throw).
const CLOSE_BELOW = 1.0;
const OPEN_ABOVE = 1.1;
const SLACK = 0.04; // the hand must move this far (image widths) before the world follows: kills jitter
const YAW_GAIN = 7; // rad per image width of fist travel: a slow drag turns a lot
const PITCH_GAIN = 3.5;
const ZOOM_GAIN = 4.5; // log-distance per image height of open-hand travel (up = in)
const HOLD_MS = 500; // a hand missing for less than this keeps its state: tracking gaps don't drop the grab
const REACQUIRE_MS = 120; // after a gap this long the tracker's first position can jump: start over from it
const STILL = 0.012; // a hand that just appeared acts only after it has stopped once (raising it isn't a gesture)
const MAX_STEP = 0.3; // rad per frame
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const THROW_MIN = 0.6; // rad/s: slower than this, letting go (or losing the hand) doesn't throw

/** Last hand's raw measurements, shown with ?debug to calibrate against a real camera. */
export const metrics = { text: '' };
/** For the on-screen zoom indicator: last zoom direction (1 in, -1 out) and when (tracker ms). */
export const zooming = { dir: 0, at: -Infinity };

/**
 * Is the hand at a comfortable distance? Wrist → middle knuckle, in image heights:
 * about 0.2 at arm's length on a typical webcam.
 */
export function handDistance(L: Float32Array, aspect: number): 'close' | 'far' | null {
  const size = Math.hypot((L[0] - L[27]) * aspect, L[1] - L[28]);
  return size > 0.34 ? 'close' : size < 0.08 ? 'far' : null;
}

/** How far the four fingertips reach past their middle joints, from the wrist (≈1.4 open, ≈0.7 fist). */
export function fingerReach(L: Float32Array) {
  const d = (i: number) => Math.hypot(L[i * 3] - L[0], L[i * 3 + 1] - L[1], L[i * 3 + 2] - L[2]);
  let r = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) r += d(tip) / Math.max(d(pip), 1e-4);
  return r / 4;
}

/**
 * Landmarks → intents, one hand:
 * - closed hand (grab) + drag, any direction: moves the map (turns the world with the hand);
 * - open hand moved up: move in; moved down: move out (sideways does nothing);
 *   moving in on the glowing spot in the reticle goes through it (the dive, handled by zoom);
 * - lower the hand out of view to rest.
 * The world only follows movement beyond a small slack around the hand, which removes the
 * webcam's jitter without hiding deliberate motion. Pure logic, unit-tested (also on a real recording).
 */
export class Gestures {
  private px = new OneEuro(0.6, 1);
  private py = new OneEuro(0.6, 1);
  private closed = false;
  private anchor: { x: number; y: number } | null = null;
  private lastSeen = -Infinity;
  private ready = false;
  private prev: { x: number; y: number } | null = null;
  private vYaw = 0;
  private vPitch = 0;
  private cursor: Cursor | null = null;

  constructor(private intents: Intents) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    if (hands.length === 0) {
      // Lost mid-drag (usually because the drag was fast): the world keeps the spin.
      if (this.closed) this.throw();
      if (this.cursor && t - this.lastSeen < HOLD_MS) return [this.cursor];
      this.cursor = null;
      this.closed = false;
      this.anchor = null;
      metrics.text = 'no hand';
      return [];
    }
    const L = hands[0].landmarks;
    const gap = t - this.lastSeen;
    if (gap > HOLD_MS) {
      this.closed = false;
      this.anchor = null;
      this.ready = false;
      this.prev = null;
    }
    if (gap > REACQUIRE_MS) {
      this.px.reset();
      this.py.reset();
    }
    this.lastSeen = t;

    let x = 0;
    let y = 0;
    for (const i of [0, 5, 9, 13, 17]) {
      x += 1 - L[i * 3]; // mirror: the screen acts like a mirror
      y += L[i * 3 + 1];
    }
    const palm = { x: this.px.filter(x / 5, t), y: this.py.filter(y / 5, t) };

    const step = this.prev ? Math.hypot(palm.x - this.prev.x, palm.y - this.prev.y) : 1;
    this.prev = palm;
    if (!this.ready && step < STILL) this.ready = true;

    const reach = fingerReach(L);
    const was = this.closed;
    this.closed = was ? reach < OPEN_ABOVE : reach < CLOSE_BELOW;
    if (was && !this.closed) this.throw(); // let go
    // Each pose has its own starting point: switching pose (or the hand being re-found) starts over.
    if (this.closed !== was || gap > REACQUIRE_MS || !this.anchor) this.anchor = { ...palm };

    if (this.ready) {
      // Rubber band: the anchor trails the hand by SLACK; only that trailing motion counts.
      const ox = palm.x - this.anchor.x;
      const oy = palm.y - this.anchor.y;
      const d = Math.hypot(ox, oy);
      if (d > SLACK) {
        const k = 1 - SLACK / d;
        const mx = ox * k;
        const my = oy * k;
        this.anchor.x += mx;
        this.anchor.y += my;
        if (this.closed) {
          // Grab: the map follows the hand (capped per frame so a tracker hiccup can't jerk it).
          this.intents.rotate(clamp(mx * YAW_GAIN, MAX_STEP), clamp(my * PITCH_GAIN, MAX_STEP));
          const dts = Math.max(0.03, Math.min(gap, 200) / 1000);
          this.vYaw += ((mx * YAW_GAIN) / dts - this.vYaw) * 0.5;
          this.vPitch += ((my * PITCH_GAIN) / dts - this.vPitch) * 0.5;
        } else if (Math.abs(my) > Math.abs(mx)) {
          const f = Math.exp(clamp(my * ZOOM_GAIN, MAX_STEP)); // open hand up (y↓) = in, down = out
          this.intents.zoom(f);
          zooming.dir = f < 1 ? 1 : -1;
          zooming.at = t;
        }
      }
    }

    if (this.closed && this.anchor && Math.hypot(palm.x - this.anchor.x, palm.y - this.anchor.y) <= SLACK) {
      this.vYaw *= 0.6; // holding still: nothing to throw
      this.vPitch *= 0.6;
    }

    metrics.text = `reach ${reach.toFixed(2)} (fist <${CLOSE_BELOW}) · ${this.closed ? 'GRAB (move)' : 'OPEN (zoom)'} · palm ${palm.x.toFixed(2)},${palm.y.toFixed(2)}`;
    this.cursor = { x: palm.x * 2 - 1, y: -(palm.y * 2 - 1), pinch: this.closed, progress: 0 };
    return [this.cursor];
  }

  private throw() {
    if (Math.hypot(this.vYaw, this.vPitch) > THROW_MIN) this.intents.fling(this.vYaw, this.vPitch);
    this.vYaw = 0;
    this.vPitch = 0;
  }
}
