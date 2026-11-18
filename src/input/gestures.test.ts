import { describe, expect, it, vi } from 'vitest';
import { Gestures, handDistance, handSize, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** An open hand with its palm at (cx, cy) in image space, `scale` times its normal size. */
function hand(cx: number, cy: number, scale = 1): HandFrame {
  const p: [number, number][] = Array.from({ length: 21 }, () => [cx, cy]);
  const s = (dx: number, dy: number): [number, number] => [cx + dx * scale, cy + dy * scale];
  p[0] = s(0, 0.12);
  for (const [mcp, pip, tip, dx] of [[5, 6, 8, -0.04], [9, 10, 12, 0], [13, 14, 16, 0.03], [17, 18, 20, 0.06]]) {
    p[mcp] = s(dx, -0.03);
    p[pip] = s(dx, -0.08);
    p[tip] = s(dx, -0.15);
  }
  p[4] = s(-0.1, -0.02);
  const lm = new Float32Array(63);
  p.forEach(([x, y], i) => lm.set([x, y, 0], i * 3));
  return { label: 'Right', landmarks: lm };
}

function setup(centered = () => false) {
  const intents: Intents = {
    rotate: vi.fn(),
    zoom: vi.fn(),
    hover: vi.fn(() => centered()),
    select: vi.fn(),
    activate: vi.fn(),
    fling: vi.fn(),
  };
  return { g: new Gestures(intents), intents };
}

const run = (g: Gestures, frames: (i: number) => HandFrame[], n: number, t0 = 0) => {
  for (let i = 0; i < n; i++) g.update(frames(i), t0 + i * 33);
};

describe('Gestures (one open hand)', () => {
  it('moving the open palm turns the world, after a short settle', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.7 - i * 0.01, 0.5)], 20);
    const yaws = vi.mocked(intents.rotate).mock.calls.map((c) => c[0]);
    expect(yaws.length).toBeGreaterThan(8);
    expect(yaws.every((y) => y > 0)).toBe(true); // to the right on screen, like dragging right
  });

  it('raising the hand into view does not jerk the world', () => {
    const { g, intents } = setup();
    run(g, (i) => [hand(0.5, 0.8 - i * 0.05)], 6); // 200 ms of the hand coming up
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('a brief tracking dropout keeps the hand (no flicker, no jump)', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.5, 0.5)], 15);
    expect(g.update([], 15 * 33)).toHaveLength(1); // still shown
    g.update([], 16 * 33);
    g.update([hand(0.5, 0.5)], 17 * 33);
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('bringing the hand closer moves in; pulling it back moves out', () => {
    const closer = setup();
    run(closer.g, () => [hand(0.5, 0.5)], 15);
    run(closer.g, (i) => [hand(0.5, 0.5, 1 + i * 0.02)], 15, 15 * 33);
    const inF = vi.mocked(closer.intents.zoom).mock.calls.map((c) => c[0]);
    expect(inF.length).toBeGreaterThan(5);
    expect(inF.every((f) => f < 1)).toBe(true);

    const back = setup();
    run(back.g, () => [hand(0.5, 0.5)], 15);
    run(back.g, (i) => [hand(0.5, 0.5, 1 - i * 0.015)], 15, 15 * 33);
    const outF = vi.mocked(back.intents.zoom).mock.calls.map((c) => c[0]);
    expect(outF.length).toBeGreaterThan(5);
    expect(outF.every((f) => f > 1)).toBe(true);
  });

  it('moving in does not also turn the world', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.5, 0.5)], 15);
    run(g, (i) => [hand(0.5, 0.5, 1 + i * 0.04)], 10, 15 * 33);
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('a steady hand does nothing', () => {
    const { g, intents } = setup();
    run(g, () => [hand(0.5, 0.5)], 60);
    expect(intents.rotate).not.toHaveBeenCalled();
    expect(intents.zoom).not.toHaveBeenCalled();
  });

  it('hand size grows when the hand comes closer', () => {
    expect(handSize(hand(0.5, 0.5, 1.3).landmarks)).toBeGreaterThan(handSize(hand(0.5, 0.5).landmarks) * 1.25);
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
