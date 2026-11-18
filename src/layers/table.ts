import { BoxGeometry, CircleGeometry, CylinderGeometry, Group, LineSegments, Mesh, Object3D, Vector3 } from 'three/webgpu';
import { Lines, layerBase, rng } from '../engine/build';
import { CYAN, ICE, fillMaterial, lineMaterial, strokes, targetMaterial, horizon } from '../engine/holo';
import type { LayerContext, Layer } from '../engine/layers';

const CUBE = 0.65; // half size
const CUBE_Y = 2.6;
const TABLE_R = 2.6;
const TOP = 0.9;

const wave = (x: number, m: number, t: number) => 1.8 + Math.sin(x * (9 + m * 5) - t * (3 + m)) * 0.15 * Math.sin(t * 0.7 + x);

/** Places an empty anchor for a HUD callout. */
function anchor(parent: Object3D, x: number, y: number, z: number) {
  const o = new Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

/** [0]+[1] A dark workshop, a projection table, and a strange cube with a crack on its back. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(7);
  const thin = (o: number, tint = CYAN) => lineMaterial(fade, tint, o);

  // ── Workshop: barely-there silhouettes around a polar floor grid ─────────────────────────
  const floor = new Lines();
  for (let r = 3; r <= 9; r += 1) floor.circle(0, 0, 0, r, 128);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 2.9 : 4.5;
    floor.seg(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * 9, 0, Math.sin(a) * 9);
  }
  const room = new Lines();
  // Back wall with panels and a pegboard of tools.
  for (let x = -8; x <= 8; x += 1) room.seg(x, 0, -8.2, x, 4.2, -8.2);
  for (const y of [0.9, 2.4, 4.2]) room.seg(-8, y, -8.2, 8, y, -8.2);
  for (let i = 0; i < 26; i++) {
    const x = -7.4 + i * 0.55 + rand() * 0.1;
    const h = 0.25 + rand() * 0.5;
    room.seg(x, 3.0, -8.15, x, 3.0 - h, -8.15).seg(x - 0.06, 3.0 - h, -8.15, x + 0.06, 3.0 - h, -8.15);
  }
  // Workbench with clutter, crates, shelving, a robotic arm folded at rest.
  room.box(3.2, 0, -7.4, 3.6, 0.95, 1.2).box(3.4, 0.95, -7.2, 0.7, 0.35, 0.5).box(4.4, 0.95, -7.3, 0.4, 0.6, 0.4);
  room.box(5.2, 0.95, -7.3, 1.2, 0.08, 0.8);
  for (let i = 0; i < 6; i++) {
    const a = 2.1 + i * 0.42 + rand() * 0.2;
    const s = 0.5 + rand() * 0.6;
    const cx = Math.cos(a) * 7.2;
    const cz = Math.sin(a) * 7.2;
    room.box(cx, 0, cz, s, s * (0.7 + rand()), s);
    if (rand() > 0.5) room.box(cx + 0.1, s * 1.3, cz + 0.1, s * 0.6, s * 0.5, s * 0.6);
  }
  for (const y of [0, 0.8, 1.6, 2.4]) room.rect(-7.6, y, -6.6, -6.6, -3.2);
  for (const [x, z] of [[-7.6, -6.6], [-6.6, -6.6], [-7.6, -3.2], [-6.6, -3.2]]) room.seg(x, 0, z, x, 2.4, z);
  const arm: [number, number, number][] = [[6.5, 0, 2.5], [6.5, 0.6, 2.5], [6.0, 1.7, 2.2], [5.1, 2.0, 1.6], [4.7, 1.6, 1.3]];
  for (let i = 0; i + 1 < arm.length; i++) room.seg(...arm[i], ...arm[i + 1]);
  room.circle(6.5, 0, 2.5, 0.45, 24).circle(6.5, 0.6, 2.5, 0.25, 16);
  root.add(new LineSegments(floor.geometry(), thin(0.08)));
  root.add(new LineSegments(room.geometry(), thin(0.06, ICE)));

  // Monitors on the bench with live traces (animated in update).
  const scope = new Lines();
  for (let i = 0; i < 2; i++) scope.box(3.5 + i * 1.6, 1.4, -7.5, 1.3, 0.8, 0.04);
  root.add(new LineSegments(scope.geometry(), thin(0.16)));
  const TRACE = 48;
  const traceGeo = new Lines();
  for (let i = 0; i < TRACE * 2; i++) traceGeo.seg(0, 0, 0, 0, 0, 0);
  const trace = new LineSegments(traceGeo.geometry(), thin(0.3));
  trace.userData.noSample = true;
  root.add(trace);
  const traceArr = trace.geometry.attributes.position.array as Float32Array;

  // ── Projection table ────────────────────────────────────────────────────────────────────
  const rim = new Lines();
  rim.circle(0, 0, 0, 2.0, 96).circle(0, 0.75, 0, TABLE_R, 128).circle(0, TOP, 0, TABLE_R, 128).circle(0, TOP, 0, 2.35, 128);
  root.add(strokes(rim.positions(), fade, ICE, 0.75, 2));

  const body = new Lines();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    body.seg(c * 2.0, 0, s * 2.0, c * TABLE_R, 0.75, s * TABLE_R).seg(c * TABLE_R, 0.75, s * TABLE_R, c * TABLE_R, TOP, s * TABLE_R);
  }
  for (let y = 0.15; y < 0.75; y += 0.15) body.circle(0, y, 0, 2.0 + (y / 0.75) * 0.6, 96);
  // Dial ticks around the top rim.
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const r1 = i % 10 === 0 ? 2.12 : 2.25;
    body.seg(Math.cos(a) * r1, TOP + 0.005, Math.sin(a) * r1, Math.cos(a) * 2.33, TOP + 0.005, Math.sin(a) * 2.33);
  }
  root.add(new LineSegments(body.geometry(), thin(0.3)));
  const top = new Mesh(new CircleGeometry(TABLE_R, 96).rotateX(-Math.PI / 2).translate(0, TOP, 0), fillMaterial(fade, CYAN, 0.07));
  top.userData.noSample = true;
  root.add(top);

  // Emitter: segmented arcs on three rings turning at different speeds and directions.
  const rings: Group[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new Group();
    const arcs = new Lines();
    for (let r = 0.35 + k * 0.12; r < 2.0; r += 0.36) {
      const n = 3 + ((r * 10) | 0) % 4;
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * Math.PI * 2 + rand();
        arcs.circle(0, TOP + 0.01 + k * 0.004, 0, r, 20, false, a0, a0 + (Math.PI * 2) / n - 0.25 - rand() * 0.5);
      }
    }
    g.add(new LineSegments(arcs.geometry(), thin(0.45 - k * 0.1)));
    root.add(g);
    rings.push(g);
  }
  const scanner = new Group();
  scanner.add(new LineSegments(new Lines().seg(0, TOP + 0.02, 0, 2.3, TOP + 0.02, 0).seg(2.0, TOP + 0.02, -0.08, 2.0, TOP + 0.02, 0.08).geometry(), thin(0.8, ICE)));
  root.add(scanner);

  // Floating data ring and the projection beam.
  const halo = new Group();
  const haloLines = new Lines();
  for (let j = 0; j < 7; j++) {
    const a0 = (j / 7) * Math.PI * 2;
    haloLines.circle(0, 1.35, 0, 1.75, 24, false, a0, a0 + 0.6 + rand() * 0.25);
    haloLines.seg(Math.cos(a0) * 1.75, 1.35, Math.sin(a0) * 1.75, Math.cos(a0) * 1.9, 1.35, Math.sin(a0) * 1.9);
  }
  halo.add(new LineSegments(haloLines.geometry(), thin(0.35, ICE)));
  root.add(halo);
  const beam = new Lines();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    beam.seg(Math.cos(a) * 1.1, TOP + 0.02, Math.sin(a) * 1.1, Math.cos(a) * 0.78, 1.95, Math.sin(a) * 0.78);
  }
  root.add(new LineSegments(beam.geometry(), lineMaterial(fade, ICE, 0.1)));
  const cone = new Mesh(new CylinderGeometry(0.75, 1.15, 1.05, 48, 1, true).translate(0, 1.44, 0), fillMaterial(fade, ICE, 0.26));
  cone.userData.noSample = true;
  root.add(cone);

  // ── The cube ────────────────────────────────────────────────────────────────────────────
  const cube = new Group();
  cube.position.y = CUBE_Y;
  root.add(cube);
  cube.add(strokes(new Lines().box(-CUBE, -CUBE, -CUBE, CUBE * 2, CUBE * 2, CUBE * 2).positions(), fade, ICE, 1, 2.6));

  // Corner brackets, standing just off each corner.
  const brackets = new Lines();
  const B = CUBE + 0.07;
  const L = 0.16;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * B;
    const y = sy * B;
    const z = sz * B;
    brackets.seg(x, y, z, x - sx * L, y, z).seg(x, y, z, x, y - sy * L, z).seg(x, y, z, x, y, z - sz * L);
  }
  cube.add(strokes(brackets.positions(), fade, CYAN, 0.8, 1.6));

  // Circuit traces etched on every face (Manhattan paths with pads), denser with detail.
  const circuit = new Lines();
  const facePoint = (face: number, u: number, v: number): [number, number, number] => {
    const s = face % 2 ? CUBE : -CUBE;
    const a = u * CUBE;
    const b = v * CUBE;
    return face < 2 ? [a, b, s] : face < 4 ? [s, a, b] : [a, s, b];
  };
  const traces = Math.round(10 + ctx.detail * 14);
  for (let face = 0; face < 6; face++) {
    if (face === 0) continue; // the back face (-z) holds the crack
    for (let k = 0; k < traces; k++) {
      let u = rand() * 1.8 - 0.9;
      let v = rand() * 1.8 - 0.9;
      for (let step = 0; step < 4; step++) {
        const horizontal = (k + step) % 2 === 0;
        const nu = horizontal ? Math.max(-0.92, Math.min(0.92, u + (rand() - 0.5) * 0.9)) : u;
        const nv = horizontal ? v : Math.max(-0.92, Math.min(0.92, v + (rand() - 0.5) * 0.9));
        circuit.seg(...facePoint(face, u, v), ...facePoint(face, nu, nv));
        u = nu;
        v = nv;
      }
      const p = 0.03;
      circuit.seg(...facePoint(face, u - p, v - p), ...facePoint(face, u + p, v - p)).seg(...facePoint(face, u + p, v - p), ...facePoint(face, u + p, v + p));
      circuit.seg(...facePoint(face, u + p, v + p), ...facePoint(face, u - p, v + p)).seg(...facePoint(face, u - p, v + p), ...facePoint(face, u - p, v - p));
    }
  }
  cube.add(new LineSegments(circuit.geometry(), thin(0.32)));
  const fill = new Mesh(new BoxGeometry(CUBE * 2, CUBE * 2, CUBE * 2), fillMaterial(fade, CYAN, 0.28));
  fill.userData.noSample = true;
  cube.add(fill);

  // Inside: a gyroscope of rings around nested shells.
  const gyro = [0, 1, 2].map((k) => {
    const g = new Group();
    g.add(new LineSegments(new Lines().circle(0, 0, 0, 0.48 - k * 0.07, 64, true).geometry(), thin(0.55, ICE)));
    cube.add(g);
    return g;
  });
  const inner = new Group();
  cube.add(inner);
  inner.add(new LineSegments(new Lines().box(-0.3, -0.3, -0.3, 0.6, 0.6, 0.6).box(-0.13, -0.13, -0.13, 0.26, 0.26, 0.26).geometry(), thin(0.75, ICE)));

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
    // Hairline fractures branching off the main crack.
    crack.seg(x0, zig[i], 0, x0 + (i % 2 ? 0.14 : -0.14), zig[i] + 0.06, 0);
  }
  crack.rect(-0.09, 0, -0.001, 0.09, 0.001);
  for (let i = 0; i < 12; i++) {
    const y = -0.4 + i * 0.075;
    const len = 0.25 + ((i * 37) % 7) * 0.07;
    crack.seg(0, y, 0, (i % 3) * 0.05 - 0.05, y * 1.2, -len);
  }
  slit.add(new LineSegments(crack.geometry(), targetMaterial(fade, glow)));

  const labels = [
    { object: anchor(cube, CUBE, CUBE, CUBE), pt: 'ARTEFATO 0x01 · ORIGEM DESCONHECIDA', en: 'ARTIFACT 0x01 · UNKNOWN ORIGIN' },
    { object: anchor(inner, 0, 0.13, 0), pt: 'NÚCLEO · 3,7 THz', en: 'CORE · 3.7 THz' },
    { object: anchor(slit, 0, 0.3, 0), pt: 'ANOMALIA · FACE OCULTA', en: 'ANOMALY · HIDDEN FACE' },
    { object: anchor(root, TABLE_R, TOP, 0.4), pt: 'PROJETOR · CAMPO ESTÁVEL', en: 'PROJECTOR · FIELD STABLE' },
  ];

  const floating = new Vector3();
  root.add(horizon(fade, 9));
  return {
    id: 'table',
    root,
    fade,
    glow,
    labels,
    radius: 9,
    view: { distance: 5.2, minDistance: 2.6, maxDistance: 12, pitch: 0.12, height: 2.4 },
    target: { object: slit, radius: 0.5, facing: new Vector3(0, 0, -1) },
    update(t) {
      floating.set(0, CUBE_Y + Math.sin(t * 0.9) * 0.06, 0);
      cube.position.copy(floating);
      // Rocks but never turns its back on its own: the crack has to be found.
      cube.rotation.y = Math.sin(t * 0.25) * 0.55;
      cube.rotation.x = Math.sin(t * 0.31) * 0.08;
      inner.rotation.set(t * 0.3, t * 0.45, 0);
      gyro[0].rotation.set(t * 0.7, 0, 0);
      gyro[1].rotation.set(0, t * 0.9, Math.PI / 2);
      gyro[2].rotation.set(Math.PI / 2, t * -0.6, 0);
      rings[0].rotation.y = t * 0.12;
      rings[1].rotation.y = -t * 0.2;
      rings[2].rotation.y = t * 0.31;
      scanner.rotation.y = -t * 0.8;
      halo.rotation.y = t * 0.1;
      halo.position.y = Math.sin(t * 0.6) * 0.03;
      // Oscilloscope traces on the bench monitors.
      for (let m = 0; m < 2; m++) {
        for (let i = 0; i < TRACE; i++) {
          const o = (m * TRACE + i) * 6;
          const x0 = 3.55 + m * 1.6 + (i / TRACE) * 1.2;
          const x1 = 3.55 + m * 1.6 + ((i + 1) / TRACE) * 1.2;
          traceArr[o] = x0;
          traceArr[o + 1] = wave(x0, m, t);
          traceArr[o + 2] = -7.44;
          traceArr[o + 3] = x1;
          traceArr[o + 4] = wave(x1, m, t);
          traceArr[o + 5] = -7.44;
        }
      }
      trace.geometry.attributes.position.needsUpdate = true;
    },
  };
}
