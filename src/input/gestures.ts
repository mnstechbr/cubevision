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
const HOLD_DELAY = 150; // ms before a held pinch starts counting as "open it"
const HOLD_TIME = 900; // ms of held pinch to dive with one hand
const SPREAD = 0.22; // extra palm distance (image widths) for the two-hand dive
const YAW_GAIN = 4;
const PITCH_GAIN = 2.4;
// The central part of the camera image covers the whole screen: reaching the edges
// of the frame is tiring and tracking drops there.
const REACH = 0.15;
const reach = (v: number) => Math.min(1, Math.max(0, (v - REACH) / (1 - 2 * REACH)));

/**
 * Landmarks → intents. Pure logic (no DOM, no camera), so it is unit-tested.
 * One hand: the hand only points (so aiming never moves the world); pinch on the target
 * and hold to dive; pinch elsewhere and drag to turn the world.
 * Two hands: spreading zooms, or dives when the target is armed.
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
    const cursors: Cursor[] = [];
    const reads = hands.slice(0, 2).map((h) => this.read(h, t));

    for (const [label, s] of this.slots) {
      if (t - s.seen > 300) this.slots.delete(label);
    }

    if (reads.length === 2) {
      const [a, b] = reads;
      const d = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
      if (this.twoStart === null) {
        this.twoStart = d;
        this.twoPrev = d;
      }
      let progress = 0;
      if (this.armed()) {
        progress = Math.max(0, (d - this.twoStart) / SPREAD);
        this.intents.expand(progress);
      } else if (d > 0.02) {
        this.intents.zoom(this.twoPrev / d);
      }
      this.twoPrev = d;
      for (const r of reads) r.slot.lastPalm = r.palm;
      for (const r of reads) cursors.push({ ...r.cursor, pinch: r.slot.pinching, progress: Math.min(progress, 1) });
      return cursors;
    }
    this.twoStart = null;

    if (reads.length === 1) {
      const { slot, cursor, palm, pinchStarted } = reads[0];
      this.intents.hover(cursor.x, cursor.y);
      let progress = 0;
      if (pinchStarted) this.intents.select(cursor.x, cursor.y, 'arm');
      if (slot.pinching && this.armed()) {
        progress = Math.max(0, (t - slot.pinchAt - HOLD_DELAY) / HOLD_TIME);
        this.intents.expand(progress);
      } else if (slot.lastPalm && slot.pinching) {
        // A grab (pinch off-target) turns the world.
        const dx = palm.x - slot.lastPalm.x;
        const dy = palm.y - slot.lastPalm.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.0015) this.intents.rotate(dx * YAW_GAIN, dy * PITCH_GAIN);
      }
      slot.lastPalm = palm;
      cursors.push({ ...cursor, pinch: slot.pinching, progress: Math.min(progress, 1) });
    }
    return cursors;
  }

  private read(h: HandFrame, t: number) {
    const L = h.landmarks;
    const X = (i: number) => 1 - L[i * 3]; // mirror: the screen acts like a mirror
    const Y = (i: number) => L[i * 3 + 1];
    const dist = (i: number, j: number) => Math.hypot(X(i) - X(j), Y(i) - Y(j));

    let slot = this.slots.get(h.label);
    if (!slot) {
      slot = { cx: new OneEuro(), cy: new OneEuro(), px: new OneEuro(), py: new OneEuro(), pinching: false, pinchAt: 0, lastPalm: null, seen: t };
      this.slots.set(h.label, slot);
    }
    slot.seen = t;

    const size = Math.max(dist(0, 9), 1e-4);
    const gap = dist(4, 8) / size;
    const wasPinching = slot.pinching;
    slot.pinching = wasPinching ? gap < PINCH_OUT : gap < PINCH_IN;
    const pinchStarted = slot.pinching && !wasPinching;
    if (pinchStarted) slot.pinchAt = t;

    const cx = reach(slot.cx.filter((X(4) + X(8)) / 2, t));
    const cy = reach(slot.cy.filter((Y(4) + Y(8)) / 2, t));
    const palm = {
      x: slot.px.filter((X(0) + X(5) + X(9) + X(13) + X(17)) / 5, t),
      y: slot.py.filter((Y(0) + Y(5) + Y(9) + Y(13) + Y(17)) / 5, t),
    };
    return { slot, pinchStarted, palm, cursor: { x: cx * 2 - 1, y: -(cy * 2 - 1) } };
  }
}
