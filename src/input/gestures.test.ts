import { describe, expect, it, vi } from 'vitest';
import { Gestures, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** A plausible hand with its palm centered at (cx, cy) in image space; `pinch` touches thumb and index tips. */
function hand(cx: number, cy: number, pinch = false, label = 'Right'): HandFrame {
  const p: [number, number][] = Array.from({ length: 21 }, () => [cx, cy]);
  p[0] = [cx, cy + 0.12]; // wrist
  for (const [mcp, pip, tip, dx] of [[5, 6, 8, -0.04], [9, 10, 12, 0], [13, 14, 16, 0.03], [17, 18, 20, 0.06]]) {
    p[mcp] = [cx + dx, cy - 0.03];
    p[pip] = [cx + dx, cy - 0.08];
    p[tip] = [cx + dx, cy - 0.15];
  }
  p[4] = pinch ? [p[8][0], p[8][1]] : [cx - 0.14, cy - 0.04];
  const lm = new Float32Array(63);
  p.forEach(([x, y], i) => lm.set([x, y, 0], i * 3));
  return { label, landmarks: lm };
}

function setup(onTarget = () => false) {
  const intents: Intents = {
    rotate: vi.fn(),
    zoom: vi.fn(),
    hover: vi.fn(() => onTarget()),
    select: vi.fn(),
    activate: vi.fn(),
  };
  return { g: new Gestures(intents), intents };
}

const run = (g: Gestures, frames: (i: number) => HandFrame[], n: number) => {
  for (let i = 0; i < n; i++) g.update(frames(i), i * 33);
};

describe('Gestures', () => {
  it('moving the hand in the middle only points: it never turns the world', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.4 + i * 0.01, 0.5)], 15);
    expect(intents.hover).toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('holding the cursor near a screen edge turns the world that way', () => {
    const { g, intents } = setup();
    // Palm at the left of the camera image = right of the (mirrored) screen.
    run(g, () => [hand(0.1, 0.5)], 15);
    const yaws = vi.mocked(intents.rotate).mock.calls.map((c) => c[0]);
    expect(yaws.length).toBeGreaterThan(5);
    expect(yaws.every((v) => v > 0)).toBe(true);
  });

  it('resting on the target dives after about a second, once', () => {
    const { g, intents } = setup(() => true);
    run(g, () => [hand(0.5, 0.5)], 45); // ~1.5 s
    expect(intents.select).toHaveBeenCalledTimes(1);
  });

  it('passing over the target briefly does not dive', () => {
    let on = false;
    const { g, intents } = setup(() => on);
    run(g, (i) => {
      on = i % 20 < 8; // ~0.26 s on, ~0.4 s off
      return [hand(0.5, 0.5)];
    }, 90);
    expect(intents.select).not.toHaveBeenCalled();
  });

  it('pinch and drag turns the world (bonus when pinches read)', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.4 + i * 0.01, 0.5, true)], 12);
    expect(intents.rotate).toHaveBeenCalled();
  });

  it('a hand that leaves and comes back elsewhere does not cause a jump', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.45, 0.5, true)], 5);
    g.update([], 200);
    g.update([hand(0.55, 0.5, true)], 800); // back after 0.6 s, somewhere else
    g.update([hand(0.55, 0.5, true)], 833);
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('with two hands in view it keeps following the same one', () => {
    const { g } = setup();
    run(g, () => [hand(0.4, 0.5)], 5);
    // Order flips (as MediaPipe sometimes does): still the hand at 0.4.
    const cursors = g.update([hand(0.7, 0.5, false, 'Left'), hand(0.4, 0.5)], 200);
    const firstX = cursors[0].x;
    expect(Math.abs(firstX - (((1 - 0.4 - 0.15) / 0.7) * 2 - 1))).toBeLessThan(0.15);
    expect(cursors).toHaveLength(2);
  });
});

describe('handDistance', () => {
  it('coaches a hand that fills the frame or is tiny, and is quiet at arm length', () => {
    const at = (size: number) => {
      const L = new Float32Array(63);
      L.set([0.5, 0.5 + size, 0], 0); // wrist
      L.set([0.5, 0.5, 0], 27); // middle knuckle (landmark 9)
      return handDistance(L, 4 / 3);
    };
    expect(at(0.45)).toBe('close');
    expect(at(0.05)).toBe('far');
    expect(at(0.2)).toBeNull();
  });
});
