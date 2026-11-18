import { describe, expect, it, vi } from 'vitest';
import { Gestures, fingerReach, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** A plausible hand with its palm centered at (cx, cy) in image space. `fist` folds the four fingers. */
function hand(cx: number, cy: number, fist = false, label = 'Right'): HandFrame {
  const p: [number, number][] = Array.from({ length: 21 }, () => [cx, cy]);
  p[0] = [cx, cy + 0.12]; // wrist
  for (const [mcp, pip, tip, dx] of [[5, 6, 8, -0.04], [9, 10, 12, 0], [13, 14, 16, 0.03], [17, 18, 20, 0.06]]) {
    p[mcp] = [cx + dx, cy - 0.03];
    p[pip] = [cx + dx, cy - 0.08];
    p[tip] = fist ? [cx + dx, cy] : [cx + dx, cy - 0.15];
  }
  p[4] = [cx - 0.1, cy - 0.02];
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
    pull: vi.fn(),
    fling: vi.fn(),
  };
  return { g: new Gestures(intents), intents };
}

const run = (g: Gestures, frames: (i: number) => HandFrame[], n: number, t0 = 0) => {
  for (let i = 0; i < n; i++) g.update(frames(i), t0 + i * 33);
};

describe('Gestures', () => {
  it('reads open hands and fists apart', () => {
    expect(fingerReach(hand(0.5, 0.5).landmarks)).toBeGreaterThan(1.2);
    expect(fingerReach(hand(0.5, 0.5, true).landmarks)).toBeLessThan(0.9);
  });

  it('an open hand only points: it never turns the world', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.3 + i * 0.02, 0.5)], 15);
    expect(intents.hover).toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('a closed hand grabs: moving it turns the world, opening it throws the spin', () => {
    const { g, intents } = setup();
    // Image x going down = moving to the right on the (mirrored) screen, like dragging right.
    run(g, (i) => [hand(0.7 - i * 0.02, 0.5, true)], 12);
    const yaws = vi.mocked(intents.rotate).mock.calls.map((c) => c[0]);
    expect(yaws.length).toBeGreaterThan(5);
    expect(yaws.every((y) => y > 0)).toBe(true);
    g.update([hand(0.46, 0.5)], 12 * 33); // open
    expect(intents.fling).toHaveBeenCalledTimes(1);
    expect(vi.mocked(intents.fling).mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('two open hands do nothing to the camera', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.4 - i * 0.02, 0.5, false, 'Left'), hand(0.6 + i * 0.02, 0.5)], 12);
    expect(intents.zoom).not.toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
    expect(intents.activate).not.toHaveBeenCalled();
  });

  it('two fists pulled apart away from the target zoom, and never dive', () => {
    const { g, intents } = setup(() => false);
    run(g, (i) => [hand(0.4 - i * 0.02, 0.5, true, 'Left'), hand(0.6 + i * 0.02, 0.5, true)], 12);
    expect(vi.mocked(intents.zoom).mock.calls.some((c) => c[0] < 1)).toBe(true);
    expect(intents.activate).not.toHaveBeenCalled();
  });

  it('two fists grabbing the glowing spot and pulling apart tear it open and dive, once', () => {
    const { g, intents } = setup(() => true);
    run(g, (i) => [hand(0.42 - i * 0.015, 0.5, true, 'Left'), hand(0.58 + i * 0.015, 0.5, true)], 20);
    const pulls = vi.mocked(intents.pull).mock.calls.map((c) => c[0]);
    expect(Math.max(...pulls)).toBe(1);
    expect(intents.activate).toHaveBeenCalledTimes(1);
  });

  it('a hand that leaves and comes back elsewhere does not jump or throw', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.45, 0.5, true)], 5);
    g.update([], 200);
    g.update([hand(0.6, 0.5, true)], 800);
    g.update([hand(0.6, 0.5, true)], 833);
    expect(intents.rotate).not.toHaveBeenCalled();
    expect(intents.fling).not.toHaveBeenCalled();
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
