import { describe, expect, it } from 'vitest';
import { OneEuro } from './oneEuro';

describe('OneEuro', () => {
  it('smooths jitter on a still hand', () => {
    const f = new OneEuro();
    let maxDev = 0;
    for (let i = 0; i < 120; i++) {
      const noisy = 0.5 + (i % 2 ? 0.01 : -0.01);
      if (i > 20) maxDev = Math.max(maxDev, Math.abs(f.filter(noisy, i * 33) - 0.5));
      else f.filter(noisy, i * 33);
    }
    expect(maxDev).toBeLessThan(0.006);
  });

  it('follows a fast move without lagging far behind', () => {
    const f = new OneEuro();
    for (let i = 0; i < 10; i++) f.filter(0, i * 33);
    let v = 0;
    for (let i = 10; i < 25; i++) v = f.filter(0.8, i * 33);
    expect(v).toBeGreaterThan(0.75);
  });
});
