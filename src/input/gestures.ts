import type { Cursor } from '../ui';
import { OneEuro } from './oneEuro';
import type { Intents } from './pointer';

/** One detected hand: 21 landmarks as x,y,z triplets in image space (0..1), not mirrored. */
export interface HandFrame {
  label: string;
  landmarks: Float32Array;
}

const HOLD_MS = 350; // a hand missing for less than this is assumed still there: no flicker, no reset
const SETTLE_MS = 250; // a hand that just appeared doesn't act yet (raising it isn't a gesture)
const YAW_GAIN = 5; // rad per image width of palm travel: short movements are enough
const PITCH_GAIN = 3;
const DEADZONE = 0.002;
const ZOOM_POWER = 2.6; // camera distance follows hand size^-2.6: a little closer = a lot closer
const ZOOM_DEADZONE = 0.004; // relative size change per frame ignored (tracking noise)
const STILL_ZOOM = 0.012; // above this relative size change per frame, the palm drift isn't a turn

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

/** Apparent hand size: palm length plus palm width, so turning the hand changes it less. */
export function handSize(L: Float32Array) {
  const d = (i: number, j: number) => Math.hypot(L[i * 3] - L[j * 3], L[i * 3 + 1] - L[j * 3 + 1]);
  return d(0, 9) + d(5, 17);
}

/**
 * Landmarks → intents with one open hand, which is what a webcam tracks best.
 * - Move the palm: the world turns with it, like pushing a globe.
 * - Bring the hand closer to the camera: you move in. Pull it back: you move out.
 *   (Moving in on the glowing spot in the reticle goes through it: that's the dive, handled by zoom.)
 * - Lower the hand: rest. Raising it again picks up from where you are.
 * Pure logic, unit-tested.
 */
export class Gestures {
  private px = new OneEuro();
  private py = new OneEuro();
  private ps = new OneEuro(1, 0.5);
  private last: { x: number; y: number; s: number } | null = null;
  private lastSeen = -Infinity;
  private appeared = 0;
  private cursor: Cursor | null = null;

  constructor(private intents: Intents) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    if (hands.length === 0) {
      if (this.cursor && t - this.lastSeen < HOLD_MS) return [this.cursor];
      this.cursor = null;
      metrics.text = 'no hand';
      return [];
    }
    const L = hands[0].landmarks;
    if (t - this.lastSeen > HOLD_MS) {
      this.px.reset();
      this.py.reset();
      this.ps.reset();
      this.last = null;
      this.appeared = t;
    }
    this.lastSeen = t;

    let x = 0;
    let y = 0;
    for (const i of [0, 5, 9, 13, 17]) {
      x += 1 - L[i * 3]; // mirror: the screen acts like a mirror
      y += L[i * 3 + 1];
    }
    const now = { x: this.px.filter(x / 5, t), y: this.py.filter(y / 5, t), s: this.ps.filter(handSize(L), t) };

    let change = 0;
    if (this.last && t - this.appeared > SETTLE_MS) {
      change = now.s / this.last.s - 1;
      if (Math.abs(change) > ZOOM_DEADZONE) {
        this.intents.zoom(Math.min(1.08, Math.max(0.92, Math.pow(this.last.s / now.s, ZOOM_POWER))));
      }
      // While the hand moves toward or away from the camera, its drift isn't meant as a turn.
      const dx = now.x - this.last.x;
      const dy = now.y - this.last.y;
      if (Math.abs(change) < STILL_ZOOM && Math.abs(dx) + Math.abs(dy) > DEADZONE) {
        this.intents.rotate(dx * YAW_GAIN, dy * PITCH_GAIN);
      }
    }
    this.last = now;

    metrics.text = `palm ${now.x.toFixed(2)},${now.y.toFixed(2)} · size ${now.s.toFixed(3)} · ${change > ZOOM_DEADZONE ? 'IN' : change < -ZOOM_DEADZONE ? 'OUT' : 'steady'}`;
    this.cursor = { x: now.x * 2 - 1, y: -(now.y * 2 - 1), pinch: false, progress: 0 };
    return [this.cursor];
  }
}
