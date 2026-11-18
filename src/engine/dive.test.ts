import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Dive, type DiveHost } from './dive';
import { ORDER, loadLayer, nextOf, type Layer } from './layers';
import { Orbit } from './orbit';
import { Particles } from './particles';

const ctx = { detail: 0.5, reducedMotion: false };

function run(dive: Dive, orbit: Orbit, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    orbit.update(1 / 60);
    dive.update(1 / 60);
  }
}

describe('dive through the whole loop', () => {
  it('visits every world in order, rebasing to unit scale, and ends where it began', async () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const orbit = new Orbit(camera, false);
    const particles = new Particles(4000);
    particles.setCount(4000);
    scene.add(particles.object);

    const first = await loadLayer('table', ctx);
    scene.add(first.root);
    orbit.apply(first.view, true);
    let next: Layer | null = await loadLayer(nextOf('table'), ctx);
    const visited: string[] = [first.id];
    let pending: Promise<void> | null = null;

    const host: DiveHost = {
      scene,
      camera,
      orbit,
      particles,
      current: first,
      reducedMotion: false,
      next: () => next,
      arrived(layer) {
        visited.push(layer.id);
        next = null;
        pending = loadLayer(nextOf(layer.id), ctx).then((l) => void (next = l));
      },
    };
    const dive = new Dive(host);
    dive.intro();
    run(dive, orbit, 3);
    expect(dive.state).toBe('idle');

    for (let i = 0; i < ORDER.length; i++) {
      dive.start();
      run(dive, orbit, 6);
      expect(dive.state).toBe('idle');
      await pending;

      const cur = host.current;
      // Floating origin: the new world sits at the origin at scale 1 and the camera is back in its range.
      expect(cur.root.position.length()).toBe(0);
      expect(cur.root.scale.x).toBe(1);
      expect(cur.fade.value).toBe(1);
      expect(Number.isFinite(camera.position.x + camera.position.y + camera.position.z)).toBe(true);
      run(dive, orbit, 4); // let the camera settle on its goal
      const d = camera.position.distanceTo(orbit.now.target);
      expect(d).toBeGreaterThan(cur.view.minDistance * 0.9);
      expect(d).toBeLessThan(cur.view.maxDistance * 1.1);
      expect(orbit.now.target.distanceTo(new Vector3(0, cur.view.height, 0))).toBeLessThan(cur.radius);
      // Only the current world (plus the particle pool) is in the scene.
      expect(scene.children.length).toBe(2);
    }
    expect(visited).toEqual([...ORDER, ORDER[0]]);
  });
});

describe('target hit test', () => {
  it('forgives a cursor near the target and rejects one far from it', async () => {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const orbit = new Orbit(camera, false);
    const city = await loadLayer('city', ctx);
    orbit.apply(city.view, true);
    orbit.update(1 / 60);
    const host = { scene: new Scene(), camera, orbit, particles: new Particles(10), current: city, reducedMotion: false, next: () => null, arrived() {} };
    const dive = new Dive(host);
    camera.updateMatrixWorld();
    const c = city.target.object.getWorldPosition(new Vector3()).project(camera);
    expect(dive.hits(c.x, c.y)).toBe(true);
    expect(dive.hits(c.x + 0.05, c.y - 0.04)).toBe(true);
    expect(dive.hits(c.x + 0.6, c.y)).toBe(false);
  });
});
