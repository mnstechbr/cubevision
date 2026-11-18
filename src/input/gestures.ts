import type { Cursor } from '../ui';
import { OneEuro } from './oneEuro';
import type { Intents } from './pointer';

/** One detected hand: 21 landmarks as x,y,z triplets in image space (0..1), not mirrored. */
export interface HandFrame {
  label: string;
  landmarks: Float32Array;
}

const DWELL = 1100; // ms resting on the target to dive
const EDGE = 0.6; // NDC beyond which the cursor turns the world
const EDGE_YAW = 1.5; // rad/s at the very edge
const EDGE_PITCH = 0.7;
const PINCH_IN = 0.32; // thumb–index gap / hand size
const PINCH_OUT = 0.5; // hysteresis: harder to leave than to enter
const YAW_GAIN = 4;
const PITCH_GAIN = 2.4;
const LOST_MS = 300; // after this gap a returning hand starts fresh (no jump)
// The central part of the camera image covers the whole screen: reaching the edges
// of the frame is tiring and tracking drops there.
const REACH = 0.15;
const reach = (v: number) => Math.min(1, Math.max(0, (v - REACH) / (1 - 2 * REACH)));
const edge = (v: number) => Math.sign(v) * Math.max(0, (Math.abs(v) - EDGE) / (1 - EDGE));

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

/**
 * Landmarks → intents. Pure logic (no DOM, no camera), so it is unit-tested.
 * Built to work with nothing but a visible hand, because finger poses are what
 * a webcam reads worst:
 * - the palm moves the cursor (it never turns the world by itself);
 * - the cursor near a screen edge turns the world that way;
 * - resting the cursor on the glowing spot dives;
 * - a pinch, when it reads, is a bonus: pinch and drag also turns.
 * With two hands in view it follows the one nearest the cursor.
 */
export class Gestures {
  private cx = new OneEuro();
  private cy = new OneEuro();
  private pinching = false;
  private last: { x: number; y: number } | null = null; // filtered palm, image space
  private seenAt = -Infinity;
  private dwell = 0;

  constructor(private intents: Intents) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    const dt = Math.min(t - this.seenAt, 100);
    if (hands.length === 0) {
      this.dwell = 0;
      metrics.text = 'no hand';
      return [];
    }
    if (t - this.seenAt > LOST_MS) {
      this.cx.reset();
      this.cy.reset();
      this.last = null;
      this.pinching = false;
    }
    this.seenAt = t;

    const palms = hands.map((h) => palmOf(h.landmarks));
    let pick = 0;
    if (this.last && palms.length > 1) {
      const d = (p: { x: number; y: number }) => Math.hypot(p.x - this.last!.x, p.y - this.last!.y);
      pick = d(palms[1]) < d(palms[0]) ? 1 : 0;
    }
    const L = hands[pick].landmarks;
    const palm = { x: this.cx.filter(palms[pick].x, t), y: this.cy.filter(palms[pick].y, t) };
    const x = reach(palm.x) * 2 - 1;
    const y = -(reach(palm.y) * 2 - 1);

    // Pinch (bonus): thumb and index tips together, relative to hand size.
    const dist = (i: number, j: number) => Math.hypot(L[i * 3] - L[j * 3], L[i * 3 + 1] - L[j * 3 + 1]);
    const gap = dist(4, 8) / Math.max(dist(0, 9), 1e-4);
    this.pinching = this.pinching ? gap < PINCH_OUT : gap < PINCH_IN;

    const onTarget = this.intents.hover(x, y);
    if (onTarget) {
      this.dwell += dt;
      if (this.dwell >= DWELL) {
        this.dwell = 0;
        this.intents.select(x, y);
      }
    } else {
      this.dwell = Math.max(0, this.dwell - dt * 2); // brief slips off the target are forgiven
    }

    if (this.pinching && this.last) {
      const dx = palm.x - this.last.x;
      const dy = palm.y - this.last.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0015) this.intents.rotate(dx * YAW_GAIN, dy * PITCH_GAIN);
    } else if (!onTarget) {
      const ex = edge(x);
      const ey = edge(y);
      if (ex || ey) this.intents.rotate((ex * EDGE_YAW * dt) / 1000, (-ey * EDGE_PITCH * dt) / 1000);
    }
    this.last = palm;

    metrics.text = `hands ${hands.length} · cursor ${x.toFixed(2)},${y.toFixed(2)} · gap ${gap.toFixed(2)}${this.pinching ? ' pinch' : ''}${onTarget ? ` · on target ${Math.round((this.dwell / DWELL) * 100)}%` : ''}`;
    const cursors: Cursor[] = [{ x, y, pinch: this.pinching, progress: this.dwell / DWELL }];
    // Show the other hand too, so people see it is tracked (it just doesn't act).
    if (palms.length > 1) {
      const o = palms[1 - pick];
      cursors.push({ x: reach(o.x) * 2 - 1, y: -(reach(o.y) * 2 - 1), pinch: false, progress: 0 });
    }
    return cursors;
  }
}

/** Palm center, mirrored (the screen acts like a mirror): steadier than any fingertip. */
function palmOf(L: Float32Array) {
  let x = 0;
  let y = 0;
  for (const i of [0, 5, 9, 13, 17]) {
    x += 1 - L[i * 3];
    y += L[i * 3 + 1];
  }
  return { x: x / 5, y: y / 5 };
}
