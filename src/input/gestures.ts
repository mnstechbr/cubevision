import type { Cursor } from '../ui';
import { OneEuro } from './oneEuro';
import type { Intents } from './pointer';

/** One detected hand: 21 landmarks as x,y,z triplets in image space (0..1), not mirrored. */
export interface HandFrame {
  label: string;
  landmarks: Float32Array;
}

interface Slot {
  px: OneEuro;
  py: OneEuro;
  closed: boolean;
  palm: { x: number; y: number } | null;
  /** Recent rotation speed while grabbing (rad/s), for the throw on release. */
  vYaw: number;
  vPitch: number;
  seen: number;
}

// Open/closed is read from how far the fingertips reach past their middle joints
// (from the wrist, in 3D). Open hand ≈ 1.3–1.5, fist ≈ 0.6–0.9. Hysteresis avoids flicker.
const CLOSE_BELOW = 1.0;
const OPEN_ABOVE = 1.15;
const YAW_GAIN = 4.5; // rad per image width of hand travel while grabbing
const PITCH_GAIN = 2.6;
const SPREAD = 0.18; // extra distance between fists (image widths) that opens the target
const TWIST_GAIN = 0.8;
const LOST_MS = 300; // a hand gone longer than this comes back fresh (no jumps, no throw)
// The central part of the camera image covers the whole screen: reaching the frame edges
// is tiring and tracking drops there.
const REACH = 0.12;
const reach = (v: number) => Math.min(1, Math.max(0, (v - REACH) / (1 - 2 * REACH)));
const toNdc = (p: { x: number; y: number }) => ({ x: reach(p.x) * 2 - 1, y: -(reach(p.y) * 2 - 1) });

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

/** How far the four fingertips reach past their middle joints (≈1.4 open, <1 fist). */
export function fingerReach(L: Float32Array) {
  const d = (i: number) => Math.hypot(L[i * 3] - L[0], L[i * 3 + 1] - L[1], L[i * 3 + 2] - L[2]);
  let r = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) r += d(tip) / Math.max(d(pip), 1e-4);
  return r / 4;
}

/**
 * Landmarks → intents, like handling a real hologram. Pure logic, unit-tested.
 * - Open hand: just shows where it is (and lights the target under it).
 * - Close the hand: you grab the world; it turns with your hand. Open: it keeps spinning a little.
 * - Both hands closed: move together to turn, twist to tilt, pull apart to zoom —
 *   or, if you grabbed the glowing spot, pull apart to tear it open and dive.
 */
export class Gestures {
  private slots = new Map<string, Slot>();
  private pair: { d0: number; dPrev: number; aPrev: number; mid: { x: number; y: number }; onTarget: boolean } | null = null;
  private lastT = 0;

  constructor(private intents: Intents) {}

  update(hands: HandFrame[], t: number): Cursor[] {
    const dt = Math.max(1, Math.min(t - this.lastT, 100));
    this.lastT = t;
    const keys = new Set<string>();
    const reads = hands.slice(0, 2).map((h, i) => {
      // MediaPipe sometimes labels both hands the same; keep their state apart.
      const key = keys.has(h.label) ? `${h.label}#${i}` : h.label;
      keys.add(key);
      return this.read(h, key, t);
    });
    for (const [key, s] of this.slots) if (t - s.seen > LOST_MS) this.slots.delete(key);

    const cursors: Cursor[] = reads.map((r) => ({ ...toNdc(r.palm), pinch: r.slot.closed, progress: 0 }));
    const closed = reads.filter((r) => r.slot.closed);

    if (closed.length === 2) {
      const [a, b] = closed;
      const d = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y);
      const ang = Math.atan2(b.palm.y - a.palm.y, b.palm.x - a.palm.x);
      const mid = { x: (a.palm.x + b.palm.x) / 2, y: (a.palm.y + b.palm.y) / 2 };
      if (!this.pair) {
        const m = toNdc(mid);
        const ca = cursors[reads.indexOf(a)];
        const cb = cursors[reads.indexOf(b)];
        const onTarget = this.intents.hover(m.x, m.y) || this.intents.hover(ca.x, ca.y) || this.intents.hover(cb.x, cb.y);
        this.pair = { d0: d, dPrev: d, aPrev: ang, mid, onTarget };
      }
      const p = this.pair;
      if (p.onTarget) {
        const amount = Math.max(0, (d - p.d0) / SPREAD);
        this.intents.pull(Math.min(amount, 1));
        for (const c of cursors) c.progress = Math.min(amount, 1);
        if (amount >= 1) {
          this.intents.activate();
          p.onTarget = false; // one dive per grab
          this.intents.pull(0);
        }
      } else {
        if (d > 0.03) this.intents.zoom(Math.min(1.06, Math.max(0.94, p.dPrev / d)));
        let twist = ang - p.aPrev;
        if (twist > Math.PI) twist -= Math.PI * 2;
        if (twist < -Math.PI) twist += Math.PI * 2;
        this.turn(mid.x - p.mid.x, mid.y - p.mid.y + twist * TWIST_GAIN * 0.4, null, dt);
      }
      p.dPrev = d;
      p.aPrev = ang;
      p.mid = mid;
      return cursors;
    }
    if (this.pair) {
      if (this.pair.onTarget) this.intents.pull(0);
      this.pair = null;
    }

    if (closed.length === 1) {
      const r = closed[0];
      if (r.prev) this.turn(r.palm.x - r.prev.x, r.palm.y - r.prev.y, r.slot, dt);
    }
    for (const r of reads) {
      if (!r.slot.closed && r.released && r.slot.palm) {
        // Let go: the world keeps the spin you gave it.
        this.intents.fling(r.slot.vYaw, r.slot.vPitch);
        r.slot.vYaw = r.slot.vPitch = 0;
      }
    }
    // An open hand points: light up the target under it.
    const pointer = reads.find((r) => !r.slot.closed);
    if (pointer) {
      const c = toNdc(pointer.palm);
      this.intents.hover(c.x, c.y);
    }
    return cursors;
  }

  private turn(dx: number, dy: number, slot: Slot | null, dt: number) {
    if (Math.abs(dx) + Math.abs(dy) < 0.0008) {
      if (slot) {
        slot.vYaw *= 0.8;
        slot.vPitch *= 0.8;
      }
      return;
    }
    const yaw = dx * YAW_GAIN;
    const pitch = dy * PITCH_GAIN;
    this.intents.rotate(yaw, pitch);
    if (slot) {
      // Smoothed speed so the throw follows the last part of the movement.
      slot.vYaw += ((yaw * 1000) / dt - slot.vYaw) * 0.4;
      slot.vPitch += ((pitch * 1000) / dt - slot.vPitch) * 0.4;
    }
  }

  private read(h: HandFrame, key: string, t: number) {
    const L = h.landmarks;
    let slot = this.slots.get(key);
    if (!slot || t - slot.seen > LOST_MS) {
      slot = { px: new OneEuro(), py: new OneEuro(), closed: false, palm: null, vYaw: 0, vPitch: 0, seen: t };
      this.slots.set(key, slot);
    }
    slot.seen = t;

    let x = 0;
    let y = 0;
    for (const i of [0, 5, 9, 13, 17]) {
      x += 1 - L[i * 3]; // mirror: the screen acts like a mirror
      y += L[i * 3 + 1];
    }
    const palm = { x: slot.px.filter(x / 5, t), y: slot.py.filter(y / 5, t) };

    const fr = fingerReach(L);
    const was = slot.closed;
    slot.closed = was ? fr < OPEN_ABOVE : fr < CLOSE_BELOW;
    const released = was && !slot.closed;
    const prev = slot.palm;
    slot.palm = palm;
    metrics.text = `hands ${this.slots.size} · reach ${fr.toFixed(2)} (fist <${CLOSE_BELOW}, open >${OPEN_ABOVE}) · ${slot.closed ? 'GRAB' : 'open'}`;
    return { slot, palm, prev, released };
  }
}
