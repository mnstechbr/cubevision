import { describe, expect, it, vi } from 'vitest';
import { Gestures, handDistance, type HandFrame } from './gestures';
import type { Intents } from './pointer';

/** A plausible hand centered at (cx, cy) in image space; `pinch` touches thumb and index tips. */
function hand(label: string, cx: number, cy: number, pinch = false, fist = false): HandFrame {
  const p: [number, number][] = Array.from({ length: 21 }, () => [cx, cy]);
  p[0] = [cx, cy + 0.15]; // wrist
  for (const [mcp, pip, tip, dx] of [[5, 6, 8, -0.04], [9, 10, 12, 0], [13, 14, 16, 0.03], [17, 18, 20, 0.06]]) {
    p[mcp] = [cx + dx, cy];
    p[pip] = [cx + dx, cy - 0.05];
    p[tip] = fist ? [cx + dx, cy] : [cx + dx, cy - 0.12];
  }
  p[4] = pinch || fist ? [p[8][0], p[8][1]] : [cx - 0.12, cy - 0.02];
  const lm = new Float32Array(63);
  p.forEach(([x, y], i) => lm.set([x, y, 0], i * 3));
  return { label, landmarks: lm };
}

function setup(armed = false) {
  const intents: Intents = {
    rotate: vi.fn(),
    zoom: vi.fn(),
    hover: vi.fn(),
    select: vi.fn(),
    expand: vi.fn(),
    activate: vi.fn(),
  };
  const state = { armed };
  return { g: new Gestures(intents, () => state.armed), intents, state };
}

describe('Gestures', () => {
  it('an open hand only points: aiming never turns the world', () => {
    const { g, intents } = setup();
    for (let i = 0; i < 10; i++) g.update([hand('Right', 0.3 + i * 0.03, 0.5)], i * 33);
    expect(intents.hover).toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
    expect(intents.select).not.toHaveBeenCalled();
  });

  it('pinch and drag off-target turns the world', () => {
    const { g, intents } = setup();
    g.update([hand('Right', 0.3, 0.5)], 0);
    for (let i = 1; i < 10; i++) g.update([hand('Right', 0.3 + i * 0.03, 0.5, true)], i * 33);
    expect(intents.rotate).toHaveBeenCalled();
  });

  it('a pinch asks to arm the target under the cursor, once', () => {
    const { g, intents } = setup();
    g.update([hand('Right', 0.5, 0.5)], 0);
    for (let i = 1; i < 5; i++) g.update([hand('Right', 0.5, 0.5, true)], i * 33);
    expect(intents.select).toHaveBeenCalledTimes(1);
    expect(vi.mocked(intents.select).mock.calls[0][2]).toBe('arm');
  });

  it('holding the pinch on an armed target fills up to a dive', () => {
    const { g, intents, state } = setup();
    g.update([hand('Right', 0.5, 0.5)], 0);
    g.update([hand('Right', 0.5, 0.5, true)], 33);
    state.armed = true;
    for (let t = 66; t < 2200; t += 33) g.update([hand('Right', 0.5, 0.5, true)], t);
    const amounts = vi.mocked(intents.expand).mock.calls.map((c) => c[0]);
    expect(Math.max(...amounts)).toBeGreaterThanOrEqual(1);
  });

  it('two pinching hands pulled apart dive when armed, zoom when not', () => {
    const apart = (g: ReturnType<typeof setup>['g'], pinch: boolean) => {
      for (let i = 0; i < 12; i++) g.update([hand('Left', 0.4 - i * 0.02, 0.5, pinch), hand('Right', 0.6 + i * 0.02, 0.5, pinch)], i * 33);
    };
    const armed = setup(true);
    apart(armed.g, true);
    expect(Math.max(...vi.mocked(armed.intents.expand).mock.calls.map((c) => c[0]))).toBeGreaterThanOrEqual(1);

    const free = setup(false);
    apart(free.g, true);
    expect(vi.mocked(free.intents.zoom).mock.calls.some((c) => c[0] < 1)).toBe(true);
    expect(free.intents.expand).not.toHaveBeenCalled();
  });

  it('two open hands moving around do nothing to the camera', () => {
    const { g, intents } = setup(false);
    for (let i = 0; i < 12; i++) g.update([hand('Left', 0.4 - i * 0.02, 0.5), hand('Right', 0.6 + i * 0.02, 0.5)], i * 33);
    expect(intents.zoom).not.toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('a real pinch counts: index bent toward the camera, other fingers curled', () => {
    const { g, intents } = setup(false);
    g.update([hand('Right', 0.5, 0.5)], 0);
    const pinch = hand('Right', 0.5, 0.5, true);
    const L = pinch.landmarks;
    for (const [tip] of [[12], [16], [20]]) L[tip * 3 + 1] = 0.5; // middle, ring, pinky curled
    L.set([0.46, 0.46, -0.08], 8 * 3); // index tip forward, near its middle joint in 2D
    L.set([0.46, 0.46, -0.08], 4 * 3); // thumb tip on it
    for (let i = 1; i < 5; i++) g.update([pinch], i * 33);
    expect(intents.select).toHaveBeenCalledTimes(1);
  });

  it('a fist is not a pinch', () => {
    const { g, intents } = setup(false);
    g.update([hand('Right', 0.5, 0.5)], 0);
    for (let i = 1; i < 6; i++) g.update([hand('Right', 0.5 + i * 0.03, 0.5, false, true)], i * 33);
    expect(intents.select).not.toHaveBeenCalled();
    expect(intents.rotate).not.toHaveBeenCalled();
  });

  it('two hands with the same label still get two separate cursors', () => {
    const { g } = setup(false);
    let cursors = g.update([hand('Right', 0.3, 0.5), hand('Right', 0.7, 0.5)], 0);
    for (let i = 1; i < 5; i++) cursors = g.update([hand('Right', 0.3, 0.5), hand('Right', 0.7, 0.5)], i * 33);
    expect(Math.abs(cursors[0].x - cursors[1].x)).toBeGreaterThan(0.5);
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
