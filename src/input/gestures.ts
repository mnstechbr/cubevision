import type { Cursor } from '../ui';
import { OneEuro } from './oneEuro';
import type { Intents } from './pointer';

/** One detected hand: 21 landmarks as x,y,z triplets in image space (0..1), not mirrored. */
export interface HandFrame {
  label: string;
  landmarks: Float32Array;
}

interface Slot {
  cx: OneEuro;
  cy: OneEuro;
  px: OneEuro;
  py: OneEuro;
  pinching: boolean;
  pinchAt: number;
  lastPalm: { x: number; y: number } | null;
  seen: number;
}

const PINCH_IN = 0.32; // thumb–index gap / hand size
const PINCH_OUT = 0.5; // hysteresis: harder to leave than to enter
const FIST = 0.85; // index tip / middle joint distance from the wrist; lenient so real pinches pass
const HOLD_DELAY = 150; // ms before a held pinch starts counting as "open it"
const HOLD_TIME = 900; // ms of held pinch to dive with one hand
const SPREAD = 0.15; // extra palm distance (image widths) for the two-hand dive
const YAW_GAIN = 4;
const PITCH_GAIN = 2.4;
// The central part of the camera image covers the whole screen: reaching the edges
// of the frame is tiring and tracking drops there.
const REACH = 0.15;
const reach = (v: number) => Math.min(1, Math.max(0, (v - REACH) / (1 - 2 * REACH)));

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
 * One hand: the hand only points (so aiming never moves the world); pinch on the target
 * and hold to dive; pinch elsewhere and drag to turn the world.
 * Two hands, both pinching: pulling apart zooms, or dives when the target is armed.
 */
export class Gestures {
  private slots = new Map<string, Slot>();
  private twoStart: number | null = null;
  private twoPrev = 0;

  constructor(
    private intents: Intents,
    private armed: () => boolean,
  ) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    const keys = new Set<string>();
    const reads = hands.slice(0, 2).map((h, i) => {
      // MediaPipe sometimes labels both hands the same; keep their filters apart.
      const key = keys.has(h.label) ? `${h.label}#${i}` : h.label;
      keys.add(key);
      return this.read(h, key, t);
    });
    for (const [key, s] of this.slots) {
      if (t - s.seen > 300) this.slots.delete(key);
    }
    const cursors: Cursor[] = reads.map((r) => ({ ...r.cursor, pinch: r.slot.pinching, progress: 0 }));

    // Two hands act together only when both pinch: an explicit "grab and pull".
    // Open hands or fists in view do nothing, and a hand leaving the frame can't cause a jump.
    if (reads.length === 2 && reads[0].slot.pinching && reads[1].slot.pinching) {
      const [a, b] = reads;
      const d = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
      if (this.twoStart === null) {
        this.twoStart = d;
        this.twoPrev = d;
      }
      if (this.armed()) {
        const progress = Math.max(0, (d - this.twoStart) / SPREAD);
        this.intents.expand(progress);
        for (const c of cursors) c.progress = Math.min(progress, 1);
      } else if (d > 0.02) {
        this.intents.zoom(Math.min(1.06, Math.max(0.94, this.twoPrev / d)));
      }
      this.twoPrev = d;
      for (const r of reads) r.slot.lastPalm = r.palm;
      return cursors;
    }
    this.twoStart = null;
    if (reads.length === 0) return cursors;

    // One hand does everything. With two in view, the one pinching leads.
    const li = Math.max(0, reads.findIndex((r) => r.slot.pinching));
    const { slot, cursor, palm, pinchStarted } = reads[li];
    this.intents.hover(cursor.x, cursor.y);
    if (pinchStarted) this.intents.select(cursor.x, cursor.y, 'arm');
    if (slot.pinching && this.armed()) {
      const progress = Math.max(0, (t - slot.pinchAt - HOLD_DELAY) / HOLD_TIME);
      this.intents.expand(progress);
      cursors[li].progress = Math.min(progress, 1);
    } else if (slot.pinching && slot.lastPalm) {
      // A grab (pinch off-target) turns the world.
      const dx = palm.x - slot.lastPalm.x;
      const dy = palm.y - slot.lastPalm.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0015) this.intents.rotate(dx * YAW_GAIN, dy * PITCH_GAIN);
    }
    for (const r of reads) r.slot.lastPalm = r.palm;
    return cursors;
  }

  private read(h: HandFrame, key: string, t: number) {
    const L = h.landmarks;
    const X = (i: number) => 1 - L[i * 3]; // mirror: the screen acts like a mirror
    const Y = (i: number) => L[i * 3 + 1];
    const dist = (i: number, j: number) => Math.hypot(X(i) - X(j), Y(i) - Y(j));

    let slot = this.slots.get(key);
    if (!slot) {
      slot = { cx: new OneEuro(), cy: new OneEuro(), px: new OneEuro(), py: new OneEuro(), pinching: false, pinchAt: 0, lastPalm: null, seen: t };
      this.slots.set(key, slot);
    }
    slot.seen = t;

    const size = Math.max(dist(0, 9), 1e-4);
    const gap = dist(4, 8) / size;
    // In a fist the thumb also lands on the index, but the index tip folds back into the
    // palm (clearly closer to the wrist than its middle joint). In a pinch it reaches forward.
    // Measured in 3D: a pinching index bends toward the camera, which a 2D view hides.
    const d3 = (i: number, j: number) => Math.hypot(L[i * 3] - L[j * 3], L[i * 3 + 1] - L[j * 3 + 1], L[i * 3 + 2] - L[j * 3 + 2]);
    const reachOut = d3(8, 0) / Math.max(d3(6, 0), 1e-4);
    const fist = reachOut < FIST;
    const wasPinching = slot.pinching;
    slot.pinching = !fist && (wasPinching ? gap < PINCH_OUT : gap < PINCH_IN);
    const pinchStarted = slot.pinching && !wasPinching;
    if (pinchStarted) slot.pinchAt = t;
    metrics.text = `gap ${gap.toFixed(2)} (pinch <${PINCH_IN}) · reach ${reachOut.toFixed(2)} (fist <${FIST}) · ${fist ? 'fist' : slot.pinching ? 'pinch' : 'open'}`;

    const cx = reach(slot.cx.filter((X(4) + X(8)) / 2, t));
    const cy = reach(slot.cy.filter((Y(4) + Y(8)) / 2, t));
    const palm = {
      x: slot.px.filter((X(0) + X(5) + X(9) + X(13) + X(17)) / 5, t),
      y: slot.py.filter((Y(0) + Y(5) + Y(9) + Y(13) + Y(17)) / 5, t),
    };
    return { slot, pinchStarted, palm, cursor: { x: cx * 2 - 1, y: -(cy * 2 - 1) } };
  }
}
