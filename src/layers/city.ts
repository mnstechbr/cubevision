import { BoxGeometry, Group, InstancedMesh, LineSegments, Matrix4 } from 'three/webgpu';
import { Lines, layerBase, rng } from '../engine/build';
import { CYAN, ICE, fillMaterial, lineMaterial, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

const R = 11;
const CELL = 2.3;
const TARGET_AT = { x: 1, z: 3 }; // block holding the building you can enter

/** [2] Inside the cube: a whole city in wireframe. One building has a lit window. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(1337);
  const shells = new Lines();
  const floors = new Lines();
  const ground = new Lines();
  const lots: { x: number; z: number; w: number; d: number; h: number }[] = [];
  const floorGap = 0.2 / Math.max(0.5, ctx.detail);
  let target: (typeof lots)[number] | null = null;

  for (let bx = -5; bx <= 4; bx++) {
    for (let bz = -5; bz <= 4; bz++) {
      const cx = bx * CELL;
      const cz = bz * CELL;
      if (Math.hypot(cx + CELL / 2, cz + CELL / 2) > R - 1) continue;
      ground.rect(cx, 0, cz, cx + CELL - 0.35, cz + CELL - 0.35);
      if (rand() < 0.08 && !(bx === TARGET_AT.x && bz === TARGET_AT.z)) continue; // plaza
      for (let lx = 0; lx < 2; lx++) {
        for (let lz = 0; lz < 2; lz++) {
          const w = 0.8 + rand() * 0.12;
          const d = 0.8 + rand() * 0.12;
          const x = cx + 0.06 + lx * 0.98;
          const z = cz + 0.06 + lz * 0.98;
          const dist = Math.hypot(x, z) / R;
          let h = 0.25 + Math.pow(rand(), 2.2) * 4.2 * Math.pow(Math.max(0, 1 - dist), 1.6) + rand() * 0.3;
          const isTarget = bx === TARGET_AT.x && bz === TARGET_AT.z && lx === 0 && lz === 1;
          if (isTarget) h = 2.4;
          const lot = { x, z, w, d, h };
          if (isTarget) {
            target = lot;
            continue;
          }
          lots.push(lot);
          shells.box(x, 0, z, w, h, d);
          if (h > 0.7) for (let y = floorGap; y < h - 0.05; y += floorGap) floors.rect(x, y, z, x + w, z + d);
          if (h > 2.6) shells.seg(x + w / 2, h, z + d / 2, x + w / 2, h + 0.5 + rand() * 0.6, z + d / 2); // antenna
        }
      }
    }
  }
  ground.circle(0, 0, 0, R, 128).circle(0, 0, 0, R + 0.4, 128);

  root.add(new LineSegments(ground.geometry(), lineMaterial(fade, CYAN, 0.16)));
  root.add(new LineSegments(shells.geometry(), lineMaterial(fade, ICE, 0.55)));
  root.add(new LineSegments(floors.geometry(), lineMaterial(fade, CYAN, 0.22)));

  // Every façade as one instanced draw call.
  const fills = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), fillMaterial(fade, CYAN, 0.18), lots.length);
  const m = new Matrix4();
  lots.forEach((l, i) => fills.setMatrixAt(i, m.makeScale(l.w, l.h, l.d).setPosition(l.x, 0, l.z)));
  fills.userData.noSample = true;
  root.add(fills);

  // The building you can enter: warm outline, one lit window on its face.
  const t = target!;
  const door = new Group();
  door.position.set(t.x + t.w / 2, t.h / 2, t.z + t.d / 2);
  root.add(door);
  const outline = new Lines().box(-t.w / 2, -t.h / 2, -t.d / 2, t.w, t.h, t.d);
  for (let y = -t.h / 2 + 0.2; y < t.h / 2; y += 0.2) outline.rect(-t.w / 2, y, -t.d / 2, t.w / 2, t.d / 2);
  door.add(new LineSegments(outline.geometry(), lineMaterial(fade, ICE, 0.45)));
  const windowLines = new LineSegments(
    new Lines()
      .seg(-0.16, 0.12, t.d / 2 + 0.01, 0.16, 0.12, t.d / 2 + 0.01)
      .seg(0.16, 0.12, t.d / 2 + 0.01, 0.16, 0.4, t.d / 2 + 0.01)
      .seg(0.16, 0.4, t.d / 2 + 0.01, -0.16, 0.4, t.d / 2 + 0.01)
      .seg(-0.16, 0.4, t.d / 2 + 0.01, -0.16, 0.12, t.d / 2 + 0.01)
      .seg(0, 0.12, t.d / 2 + 0.01, 0, 0.4, t.d / 2 + 0.01)
      .geometry(),
    targetMaterial(fade, glow),
  );
  door.add(windowLines);
  const shellOfTarget = new LineSegments(new Lines().box(-t.w / 2, -t.h / 2, -t.d / 2, t.w, t.h, t.d).geometry(), targetMaterial(fade, glow));
  door.add(shellOfTarget);

  return {
    id: 'city',
    root,
    fade,
    glow,
    radius: R,
    view: { distance: 17, minDistance: 6, maxDistance: 26, pitch: 0.55, height: 0.8 },
    target: { object: door, radius: 1.2 },
    update() {},
  };
}
