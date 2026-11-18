import { describe, expect, it, vi } from 'vitest';
import { Gestures, fingerReach, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** A hand with its palm at (cx, cy) in image space; `fist` folds the four fingers. */
function hand(cx: number, cy: number, fist = false): HandFrame {
  const p: [number, number][] = Array.from({ length: 21 }, () => [cx, cy]);
  p[0] = [cx, cy + 0.12];
  for (const [mcp, pip, tip, dx] of [[5, 6, 8, -0.04], [9, 10, 12, 0], [13, 14, 16, 0.03], [17, 18, 20, 0.06]]) {
    p[mcp] = [cx + dx, cy - 0.03];
    p[pip] = [cx + dx, cy - 0.08];
    p[tip] = fist ? [cx + dx, cy] : [cx + dx, cy - 0.15];
  }
  p[4] = [cx - 0.1, cy - 0.02];
  const lm = new Float32Array(63);
  p.forEach(([x, y], i) => lm.set([x, y, 0], i * 3));
  return { label: 'Right', landmarks: lm };
}

function setup() {
  const intents: Intents = {
    rotate: vi.fn(),
    zoom: vi.fn(),
    hover: vi.fn(() => false),
    select: vi.fn(),
    activate: vi.fn(),
    fling: vi.fn(),
  };
  return { g: new Gestures(intents), intents };
}

const run = (g: Gestures, frames: (i: number) => HandFrame[], n: number, t0 = 0) => {
  for (let i = 0; i < n; i++) g.update(frames(i), t0 + i * 70); // ~14 fps, like the real tracker
};

describe('Gestures (grab with one hand)', () => {
  it('tells an open hand from a fist', () => {
    expect(fingerReach(hand(0.5, 0.5).landmarks)).toBeGreaterThan(1.2);
    expect(fingerReach(hand(0.5, 0.5, true).landmarks)).toBeLessThan(0.9);
  });

  it('a fist dragged in any direction moves the map, and never zooms', () => {
    const side = setup();
    run(side.g, (i) => [hand(0.7 - i * 0.02, 0.5, true)], 20); // to the right on the (mirrored) screen
    const yaws = vi.mocked(side.intents.rotate).mock.calls.map((c) => c[0]);
    expect(yaws.length).toBeGreaterThan(5);
    expect(yaws.every((y) => y > 0)).toBe(true);

    const up = setup();
    run(up.g, (i) => [hand(0.5, 0.7 - i * 0.02, true)], 20);
    const pitches = vi.mocked(up.intents.rotate).mock.calls.map((c) => c[1]);
    expect(pitches.length).toBeGreaterThan(5);
    expect(pitches.every((p) => p < 0)).toBe(true); // up: like dragging the map up
    expect(side.intents.zoom).not.toHaveBeenCalled();
    expect(up.intents.zoom).not.toHaveBeenCalled();
  });

  it('an open hand moved up moves in, down moves out, and never turns the map', () => {
    const up = setup();
    run(up.g, (i) => [hand(0.5, 0.7 - i * 0.02)], 20);
    const inF = vi.mocked(up.intents.zoom).mock.calls.map((c) => c[0]);
    expect(inF.length).toBeGreaterThan(5);
    expect(inF.every((f) => f < 1)).toBe(true);

    const down = setup();
    run(down.g, (i) => [hand(0.5, 0.3 + i * 0.02)], 20);
    expect(vi.mocked(down.intents.zoom).mock.calls.every((c) => c[0] > 1)).toBe(true);

    const side = setup();
    run(side.g, (i) => [hand(0.3 + i * 0.02, 0.5)], 20);
    expect(side.intents.zoom).not.toHaveBeenCalled();
    expect(up.intents.rotate).not.toHaveBeenCalled();
    expect(side.intents.rotate).not.toHaveBeenCalled();
  });

  it('a shaky hand that stays put does nothing, open or closed', () => {
    for (const fist of [true, false]) {
      const { g, intents } = setup();
      run(g, (i) => [hand(0.5 + (i % 2 ? 0.015 : -0.015), 0.5 + (i % 3 ? 0.01 : -0.01), fist)], 40);
      expect(intents.rotate).not.toHaveBeenCalled();
      expect(intents.zoom).not.toHaveBeenCalled();
    }
  });

  it('a short tracking gap keeps the grab, and the jump when the hand is found again is ignored', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.5, 0.5, true)], 10);
    g.update([], 10 * 70);
    g.update([], 11 * 70);
    const cursors = g.update([hand(0.75, 0.5, true)], 14 * 70); // found again 25% away
    expect(cursors[0].pinch).toBe(true); // still grabbing
    g.update([hand(0.75, 0.5, true)], 15 * 70);
    expect(intents.rotate).not.toHaveBeenCalled();
  });
});

describe('handDistance', () => {
  it('coaches a hand that fills the frame or is tiny, and is quiet at arm length', () => {
    const at = (size: number) => {
      const L = new Float32Array(63);
      L.set([0.5, 0.5 + size, 0], 0); // wrist
      L.set([0.5, 0.5, 0], 27); // middle knuckle (landmark 9)
      return handDistance(L, 16 / 9);
    };
    expect(at(0.45)).toBe('close');
    expect(at(0.05)).toBe('far');
    expect(at(0.2)).toBeNull();
  });
});
