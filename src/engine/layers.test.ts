import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { ORDER, loadLayer, nextOf } from './layers';
import { samplePoints } from './sample';

describe('every world', () => {
  for (const id of ORDER) {
    it(`${id} builds, holds its target, and samples to finite points`, async () => {
      const layer = await loadLayer(id, { detail: 0.6, reducedMotion: false });
      expect(layer.id).toBe(id);
      let found = false;
      layer.root.traverse((o) => (found ||= o === layer.target.object));
      expect(found).toBe(true);

      layer.update(1.5, 1 / 60);
      const pts = new Float32Array(3000 * 3);
      samplePoints(layer.root, 3000, pts);
      expect(pts.every(Number.isFinite)).toBe(true);
      // Points stay inside the declared radius (with slack for antennas and gantries).
      let max = 0;
      for (let i = 0; i < pts.length; i += 3) max = Math.max(max, Math.hypot(pts[i], pts[i + 2]));
      expect(max).toBeLessThan(layer.radius * 1.6);

      const center = layer.target.object.getWorldPosition(new Vector3());
      expect(center.length()).toBeLessThan(layer.radius);
      expect(layer.view.minDistance).toBeLessThan(layer.view.distance);
      expect(layer.view.distance).toBeLessThan(layer.view.maxDistance);
    });
  }

  it('the last world leads back to the first', () => {
    expect(nextOf(ORDER[ORDER.length - 1])).toBe(ORDER[0]);
  });
});
