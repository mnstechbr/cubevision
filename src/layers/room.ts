import { CylinderGeometry, Group, LineSegments, Mesh } from 'three/webgpu';
import { Lines, layerBase, rng } from '../engine/build';
import { CYAN, ICE, fillMaterial, lineMaterial, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const W = 5; // half width (x)
const D = 4; // half depth (z)
const H = 3.2;

/** [3] Inside the building: a room, desks, the city outside, and another projection table. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(42);
  const room = new Lines();
  const detail = new Lines();

  // Shell: floor and ceiling grids, wall panels.
  room.rect(-W, 0, -D, W, D).rect(-W, H, -D, W, D);
  for (const [x, z] of [[-W, -D], [W, -D], [W, D], [-W, D]]) room.seg(x, 0, z, x, H, z);
  const tile = 1 / Math.max(0.5, ctx.detail);
  for (let x = -W + tile; x < W; x += tile) detail.seg(x, 0, -D, x, 0, D).seg(x, H, -D, x, H, D);
  for (let z = -D + tile; z < D; z += tile) detail.seg(-W, 0, z, W, 0, z).seg(-W, H, z, W, H, z);
  for (let x = -W + 1.25; x < W; x += 1.25) detail.seg(x, 0, D, x, H, D).seg(x, 0, -D, x, 0.9, -D);
  for (let z = -D + 1; z < D; z += 1) detail.seg(-W, 0, z, -W, H, z).seg(W, 0, z, W, H, z);
  detail.seg(-W, 0.9, D, W, 0.9, D).seg(-W, 2.6, D, W, 2.6, D);

  // Window wall (back, -z): tall panes and, outside, the city you came from.
  for (let x = -W; x <= W + 0.01; x += 1.25) room.seg(x, 0.9, -D, x, H, -D);
  room.seg(-W, 0.9, -D, W, 0.9, -D).seg(-W, 2.9, -D, W, 2.9, -D);
  for (let i = 0; i < 32; i++) {
    const x = -W * 1.3 + i * 0.41 + rand() * 0.1;
    const h = 0.4 + rand() * 1.8;
    const z = -D - 1.2 - rand() * 1.5;
    detail.box(x, 0.9 - 1.5, z, 0.3, h + 1.5, 0.3);
  }

  // Door on the right wall.
  room.seg(W, 0, 1.2, W, 2.2, 1.2).seg(W, 2.2, 1.2, W, 2.2, 2.2).seg(W, 2.2, 2.2, W, 0, 2.2);

  // Desks with monitors along the side walls, ceiling light strips.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -2.6 + i * 2;
      const x = side < 0 ? -W + 0.15 : W - 1.05;
      room.box(x, 0.72, z, 0.9, 0.05, 1.3);
      room.seg(x + 0.05, 0, z + 0.05, x + 0.05, 0.72, z + 0.05).seg(x + 0.85, 0, z + 1.25, x + 0.85, 0.72, z + 1.25);
      const mx = side < 0 ? x + 0.1 : x + 0.75;
      room.box(mx, 0.85, z + 0.3, 0.05, 0.45, 0.7);
      for (let k = 1; k < 4; k++) detail.seg(mx, 0.85 + k * 0.11, z + 0.35, mx, 0.85 + k * 0.11, z + 0.35 + 0.6 * rand());
    }
  }
  for (let x = -3; x <= 3; x += 2) room.rect(x - 0.6, H - 0.02, -0.15, x + 0.6, 0.15);

  root.add(new LineSegments(room.geometry(), lineMaterial(fade, ICE, 0.6)));
  root.add(new LineSegments(detail.geometry(), lineMaterial(fade, CYAN, 0.2)));

  // The second projection table, mirroring the first world.
  const table = new Lines();
  table.circle(0, 0, 0, 0.8, 48).circle(0, 0.7, 0, 1.1, 56).circle(0, 0.8, 0, 1.1, 56);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    table.seg(Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, Math.cos(a) * 1.1, 0.7, Math.sin(a) * 1.1);
  }
  for (let r = 0.25; r <= 1.0; r += 0.25) table.circle(0, 0.81, 0, r, 40);
  root.add(new LineSegments(table.geometry(), lineMaterial(fade, CYAN, 0.55)));
  const cone = new Mesh(new CylinderGeometry(0.28, 0.6, 0.55, 32, 1, true).translate(0, 1.08, 0), fillMaterial(fade, ICE, 0.25));
  cone.userData.noSample = true;
  root.add(cone);

  // On it, the hologram of a machine: a little gear, the clue to the next world.
  const holoMachine = new Group();
  holoMachine.position.set(0, 1.55, 0);
  root.add(holoMachine);
  const gear = new Lines();
  const teeth = 12;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / teeth / 2;
    const a2 = a0 + (Math.PI * 2) / teeth;
    const [r0, r1] = [0.3, 0.38];
    gear
      .seg(Math.cos(a0) * r0, Math.sin(a0) * r0, 0, Math.cos(a0) * r1, Math.sin(a0) * r1, 0)
      .seg(Math.cos(a0) * r1, Math.sin(a0) * r1, 0, Math.cos(a1) * r1, Math.sin(a1) * r1, 0)
      .seg(Math.cos(a1) * r1, Math.sin(a1) * r1, 0, Math.cos(a1) * r0, Math.sin(a1) * r0, 0)
      .seg(Math.cos(a1) * r0, Math.sin(a1) * r0, 0, Math.cos(a2) * r0, Math.sin(a2) * r0, 0);
  }
  gear.circle(0, 0, 0, 0.12, 24, true).circle(0, 0, 0, 0.05, 16, true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    gear.seg(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0);
  }
  const gearLines = new LineSegments(gear.geometry(), targetMaterial(fade, glow));
  holoMachine.add(gearLines);

  return {
    id: 'room',
    root,
    fade,
    glow,
    radius: 6.5,
    view: { distance: 9.5, minDistance: 3, maxDistance: 13, pitch: 0.42, height: 1.2 },
    target: { object: holoMachine, radius: 0.45 },
    update(t) {
      gearLines.rotation.z = t * 0.6;
      holoMachine.rotation.y = t * 0.35;
      holoMachine.position.y = 1.55 + Math.sin(t * 1.1) * 0.04;
    },
  };
}
