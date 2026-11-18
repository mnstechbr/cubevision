import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, LineSegments, Mesh, Vector3 } from 'three/webgpu';
import { Lines, layerBase, rng } from '../engine/build';
import { CYAN, ICE, fillMaterial, lineMaterial, targetMaterial } from '../engine/holo';
import type { LayerContext, Layer } from '../engine/layers';

const CUBE = 0.65; // half size
const CUBE_Y = 2.6;

/** [0]+[1] A dark workshop, a projection table, and a strange cube with a crack on its back. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const dim = (o: number) => lineMaterial(fade, CYAN, o);

  // Workshop floor: polar grid and a few silhouettes, barely there.
  const floor = new Lines();
  for (let r = 3; r <= 9; r += 1.5) floor.circle(0, 0, 0, r, 96);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    floor.seg(Math.cos(a) * 3, 0, Math.sin(a) * 3, Math.cos(a) * 9, 0, Math.sin(a) * 9);
  }
  const rand = rng(7);
  for (let i = 0; i < 5; i++) {
    const a = 2.2 + i * 0.55 + rand() * 0.2;
    const s = 0.5 + rand() * 0.6;
    floor.box(Math.cos(a) * 7, 0, Math.sin(a) * 7, s, s * (0.8 + rand()), s);
  }
  floor.box(4.5, 0, -6.5, 3.2, 0.95, 1.1).box(4.6, 0.95, -6.4, 0.6, 0.5, 0.4); // workbench
  root.add(new LineSegments(floor.geometry(), dim(0.14)));

  // Projection table.
  const table = new Lines();
  table.circle(0, 0, 0, 2.0, 64).circle(0, 0.75, 0, 2.6, 72).circle(0, 0.9, 0, 2.6, 72);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    table.seg(c * 2.0, 0, s * 2.0, c * 2.6, 0.75, s * 2.6).seg(c * 2.6, 0.75, s * 2.6, c * 2.6, 0.9, s * 2.6);
  }
  root.add(new LineSegments(table.geometry(), dim(0.38)));
  const top = new Mesh(new CircleGeometry(2.6, 64).rotateX(-Math.PI / 2).translate(0, 0.9, 0), fillMaterial(fade, CYAN, 0.08));
  top.userData.noSample = true;
  root.add(top);

  const emitter = new Lines();
  for (let r = 0.4; r <= 2.41; r += 0.4) emitter.circle(0, 0.91, 0, r, 64, false, 0, Math.PI * (1.2 + r * 0.3));
  const rings = new LineSegments(emitter.geometry(), dim(0.4));
  root.add(rings);

  const beam = new Lines();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    beam.seg(Math.cos(a) * 1.1, 0.92, Math.sin(a) * 1.1, Math.cos(a) * 0.8, 1.95, Math.sin(a) * 0.8);
  }
  root.add(new LineSegments(beam.geometry(), lineMaterial(fade, ICE, 0.12)));
  // Volumetric projection cone from the emitter up to the cube.
  const cone = new Mesh(new CylinderGeometry(0.75, 1.15, 1.05, 48, 1, true).translate(0, 1.44, 0), fillMaterial(fade, ICE, 0.28));
  cone.userData.noSample = true;
  root.add(cone);

  // The cube: nested shells, gridded faces.
  const cube = new Group();
  cube.position.y = CUBE_Y;
  root.add(cube);
  const shell = new Lines().box(-CUBE, -CUBE, -CUBE, CUBE * 2, CUBE * 2, CUBE * 2);
  cube.add(new LineSegments(shell.geometry(), lineMaterial(fade, ICE, 1.4)));
  const grid = new Lines();
  const steps = Math.round(4 + ctx.detail * 4);
  for (let i = 1; i < steps; i++) {
    const v = -CUBE + (i / steps) * CUBE * 2;
    for (const s of [-CUBE, CUBE]) {
      grid.seg(v, -CUBE, s, v, CUBE, s).seg(-CUBE, v, s, CUBE, v, s); // front/back
      grid.seg(s, -CUBE, v, s, CUBE, v).seg(s, v, -CUBE, s, v, CUBE); // sides
      grid.seg(v, s, -CUBE, v, s, CUBE).seg(-CUBE, s, v, CUBE, s, v); // top/bottom
    }
  }
  cube.add(new LineSegments(grid.geometry(), dim(0.3)));
  const fill = new Mesh(new BoxGeometry(CUBE * 2, CUBE * 2, CUBE * 2), fillMaterial(fade, CYAN, 0.3));
  fill.userData.noSample = true;
  cube.add(fill);

  const inner = new Group();
  cube.add(inner);
  const core = new Lines().box(-0.36, -0.36, -0.36, 0.72, 0.72, 0.72).box(-0.16, -0.16, -0.16, 0.32, 0.32, 0.32);
  inner.add(new LineSegments(core.geometry(), dim(0.7)));

  // The crack on the back face: the clue. Light leaks out of it sideways.
  const slit = new Group();
  slit.position.set(0, 0, -CUBE - 0.004);
  cube.add(slit);
  const crack = new Lines();
  const zig = [-0.42, -0.25, -0.1, 0.06, 0.2, 0.36, 0.46];
  for (let i = 0; i + 1 < zig.length; i++) {
    const x0 = (i % 2 ? 0.05 : -0.04) * (1 + i * 0.1);
    const x1 = ((i + 1) % 2 ? 0.05 : -0.04) * (1 + i * 0.1);
    crack.seg(x0, zig[i], 0, x1, zig[i + 1], 0);
  }
  crack.rect(-0.09, 0, -0.001, 0.09, 0.001);
  for (let i = 0; i < 9; i++) {
    const y = -0.38 + i * 0.095;
    const len = 0.25 + ((i * 37) % 7) * 0.06;
    crack.seg(0, y, 0, (i % 3) * 0.04 - 0.04, y * 1.15, -len);
  }
  const slitLines = new LineSegments(crack.geometry(), targetMaterial(fade, glow));
  slit.add(slitLines);

  const floating = new Vector3();
  return {
    id: 'table',
    root,
    fade,
    glow,
    radius: 9,
    view: { distance: 7.5, minDistance: 3.2, maxDistance: 14, pitch: 0.3, height: 2 },
    target: { object: slit, radius: 0.5, facing: new Vector3(0, 0, -1) },
    update(t) {
      floating.set(0, CUBE_Y + Math.sin(t * 0.9) * 0.06, 0);
      cube.position.copy(floating);
      // Rocks but never turns its back on its own: the crack has to be found.
      cube.rotation.y = Math.sin(t * 0.25) * 0.55;
      cube.rotation.x = Math.sin(t * 0.31) * 0.08;
      inner.rotation.set(t * 0.3, t * 0.45, 0);
      rings.rotation.y = t * 0.15;
    },
  };
}

