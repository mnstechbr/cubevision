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
const CLOSE_BELOW = 1.0;
const OPEN_ABOVE = 1.1;
const SLACK = 0.04; // the hand must move this far (image widths) before the world follows: kills jitter
const YAW_GAIN = 4; // rad per image width of fist travel
const ZOOM_GAIN = 3; // log-distance per image height of fist travel (up = in)
const HOLD_MS = 500; // a hand missing for less than this keeps its state: tracking gaps don't drop the grab
const REACQUIRE_MS = 120; // after a gap this long the tracker's first position can jump: start over from it
const SETTLE_MS = 200; // a hand that just appeared doesn't act yet

/** Last hand's raw measurements, shown with ?debug to calibrate against a real camera. */
export const metrics = { text: '' };

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
 * - open hand: rest (just a cursor), nothing moves;
 * - close it to grab: drag sideways to turn the world, drag up to move in, down to move out;
 *   moving in on the glowing spot in the reticle goes through it (the dive, handled by zoom);
 * - open it to let go.
 * The world only follows movement beyond a small slack around the hand, which removes the
 * webcam's jitter without hiding deliberate motion. Pure logic, unit-tested (also on a real recording).
 */
export class Gestures {
  private px = new OneEuro(0.6, 1);
  private py = new OneEuro(0.6, 1);
  private closed = false;
  private anchor: { x: number; y: number } | null = null;
  private lastSeen = -Infinity;
  private appeared = 0;
  private cursor: Cursor | null = null;

  constructor(private intents: Intents) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    if (hands.length === 0) {
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
      this.appeared = t;
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

    const reach = fingerReach(L);
    const was = this.closed;
    this.closed = was ? reach < OPEN_ABOVE : reach < CLOSE_BELOW;
    if ((this.closed && !was) || (this.closed && gap > REACQUIRE_MS)) this.anchor = { ...palm }; // grab (or re-found): start from here
    if (!this.closed) this.anchor = null;

    if (this.closed && this.anchor && t - this.appeared > SETTLE_MS) {
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
        if (Math.abs(mx) > Math.abs(my) * 0.5) this.intents.rotate(mx * YAW_GAIN, 0);
        if (Math.abs(my) > Math.abs(mx) * 0.5) this.intents.zoom(Math.exp(my * ZOOM_GAIN)); // up (y↓) = in
      }
    }

    metrics.text = `reach ${reach.toFixed(2)} (fist <${CLOSE_BELOW}) · ${this.closed ? 'GRAB' : 'open'} · palm ${palm.x.toFixed(2)},${palm.y.toFixed(2)}`;
    this.cursor = { x: palm.x * 2 - 1, y: -(palm.y * 2 - 1), pinch: this.closed, progress: 0 };
    return [this.cursor];
  }
}
