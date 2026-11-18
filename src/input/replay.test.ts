import { describe, expect, it } from 'vitest';
import first from '../../test/fixtures/cubevision-maos.json';
import second from '../../test/fixtures/cubevision-maos-2.json';
import { Gestures, fingerReach, type HandFrame } from './gestures';
import type { Intents } from './pointer';

// A real 48 s recording from the owner's webcam (numbers only, no images):
// the hand moves around (often as a fist), tracking drops ~26% of frames, and after a drop the
// first position found can jump up to ~30% of the image width.
type Rec = { frames: { t: number; hands: { label: string; lm: number[] }[] }[] };

function replay(frames: Rec['frames']) {
  const t0 = frames[0].t;
  const calls: { t: number; kind: 'rotate' | 'zoom' | 'fling'; v: number; open: boolean; afterGap: boolean }[] = [];
  let now = 0;
  let openNow = false;
  let afterGap = false;
  let lastT = -Infinity;
  const intents: Intents = {
    rotate: (y) => void calls.push({ t: now, kind: 'rotate', v: y, open: openNow, afterGap }),
    zoom: (f) => void calls.push({ t: now, kind: 'zoom', v: Math.log(f), open: openNow, afterGap }),
    hover: () => false,
    select: () => {},
    activate: () => {},
    fling: (y) => void calls.push({ t: now, kind: 'fling', v: y, open: openNow, afterGap }),
  };
  const g = new Gestures(intents);
  for (const f of frames) {
    now = (f.t - t0) / 1000;
    const hands: HandFrame[] = f.hands.map((h) => ({ label: h.label, landmarks: Float32Array.from(h.lm) }));
    openNow = hands.length > 0 && fingerReach(hands[0].landmarks) > 1.25;
    afterGap = hands.length > 0 && f.t - lastT > 120;
    if (hands.length) lastT = f.t;
    g.update(hands, f.t);
  }
  return calls;
}

for (const [name, rec] of [['first (48 s)', first], ['second (90 s)', second]] as const) {
  describe(`replay of a real webcam recording: ${name}`, () => {
    const calls = replay((rec as Rec).frames);
    const moves = calls.filter((c) => c.kind !== 'fling');

    it('a clearly open hand never turns the map (it only zooms)', () => {
      expect(calls.filter((c) => c.open && c.kind === 'rotate')).toHaveLength(0);
    });

    it('the jump when tracking finds the hand again is not taken as movement', () => {
      expect(moves.filter((c) => c.afterGap)).toHaveLength(0);
    });

    it('no single frame makes the world lurch', () => {
      expect(Math.max(...moves.map((c) => Math.abs(c.v)))).toBeLessThan(0.35);
    });

    it('deliberate movement does turn and zoom the world', () => {
      expect(moves.reduce((s, c) => s + Math.abs(c.v), 0)).toBeGreaterThan(1);
    });
  });
}

it('fast drags that lose the hand keep the world spinning (second recording has several)', () => {
  expect(replay((second as Rec).frames).filter((c) => c.kind === 'fling').length).toBeGreaterThan(0);
});
