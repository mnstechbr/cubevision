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

describe('zooming through the target', () => {
  // Layout-independent: the camera is pointed straight at the target (on it) or well away (off it).
  async function at(onTarget: boolean) {
    const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const orbit = new Orbit(camera, false);
    const world = await loadLayer('city', ctx);
    orbit.apply(world.view, true);
    world.root.updateMatrixWorld(true);
    const t = world.target.object.getWorldPosition(new Vector3());
    if (onTarget) {
      orbit.goal.target.copy(t);
      orbit.now.target.copy(t);
    } else {
      // Look at a point on the far side of the world, with the target behind the camera.
      const away = t.clone().setY(0).normalize().multiplyScalar(-world.radius);
      orbit.goal.target.copy(away).setY(t.y);
      orbit.now.target.copy(orbit.goal.target);
      orbit.goal.yaw = orbit.now.yaw = Math.atan2(t.x, t.z); // camera on the target side, looking away from it
    }
    orbit.update(1 / 60);
    const host = { scene: new Scene(), camera, orbit, particles: new Particles(10), current: world, reducedMotion: false, next: () => null, arrived() {} };
    return { dive: new Dive(host), orbit };
  }
  const zoomIn = (dive: Dive, orbit: Orbit, frames = 300) => {
    for (let i = 0; i < frames && dive.state === 'idle'; i++) {
      dive.zoom(0.97, 0.3);
      dive.update(1 / 60);
      orbit.update(1 / 60);
    }
  };
  const pause = (dive: Dive, orbit: Orbit, s: number) => {
    for (let i = 0; i < s * 60; i++) {
      dive.update(1 / 60);
      orbit.update(1 / 60);
    }
  };

  it('moving in on the spot reaches the edge; keeping on for a moment goes through', async () => {
    const { dive, orbit } = await at(true);
    pause(dive, orbit, 2); // past the arrival grace
    zoomIn(dive, orbit, 300);
    expect(dive.state).toBe('focus');
  });

  it('a brief touch at the edge does not go through', async () => {
    const { dive, orbit } = await at(true);
    pause(dive, orbit, 2);
    // Move in only until the edge is reached…
    for (let i = 0; i < 600 && !dive.atEntry && dive.state === 'idle'; i++) {
      dive.zoom(0.97, 0.3);
      dive.update(1 / 60);
      orbit.update(1 / 60);
    }
    expect(dive.atEntry).toBe(true);
    // …then a few short taps (~0.33 s each) with pauses between them.
    for (let k = 0; k < 5 && dive.state === 'idle'; k++) {
      pause(dive, orbit, 0.5);
      zoomIn(dive, orbit, 20);
    }
    expect(dive.state).toBe('idle');
  });

  it('right after arriving, moving in cannot enter yet', async () => {
    const { dive, orbit } = await at(true);
    zoomIn(dive, orbit, 40);
    pause(dive, orbit, 0.4);
    zoomIn(dive, orbit, 20);
    expect(dive.state).toBe('idle');
  });

  it('moving in elsewhere just stops at the closest distance', async () => {
    const { dive, orbit } = await at(false);
    pause(dive, orbit, 2);
    zoomIn(dive, orbit);
    pause(dive, orbit, 0.5);
    zoomIn(dive, orbit, 30);
    expect(dive.state).toBe('idle');
    expect(dive.atEntry).toBe(false);
  });
});
