import {
  AdditiveBlending,
  BufferAttribute,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  LineSegments,
  Mesh,
  Object3D,
  PointsNodeMaterial,
  Sprite,
} from "three/webgpu";
import {
  color,
  float,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  sin,
  smoothstep,
  step,
  time,
  uv,
  vec3,
} from "three/tsl";
import { Lines, layerBase, rng } from "../engine/build";
import {
  CYAN,
  ICE,
  fillMaterial,
  lineMaterial,
  strokes,
  targetMaterial,
} from "../engine/holo";
import type { Layer, LayerContext } from "../engine/layers";

const W = 5; // half width (x)
const D = 4; // half depth (z)
const H = 3.2;
const TAU = Math.PI * 2;

// Each screen shows 8 bars, a 14-segment graph and 4 text rows (all rewritten in place every frame).
const SEGS = 8 + 14 + 4;
interface Mon {
  ox: number;
  oy: number;
  oz: number;
  ux: number;
  uz: number;
  w: number;
  h: number;
}

/** [3] Inside the building: a room, desks, the city outside, and another projection table. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(42);
  const detailK = Math.max(0.5, ctx.detail);
  const frame = new Lines(); // thick
  const room = new Lines(); // medium
  const fine = new Lines(); // faint dense
  const lights = new Lines();
  const sky = new Lines();
  const mons: Mon[] = [];

  const wallX = (
    x: number,
    z0: number,
    z1: number,
    y0: number,
    y1: number,
    l: Lines = room,
  ) =>
    l
      .seg(x, y0, z0, x, y0, z1)
      .seg(x, y0, z1, x, y1, z1)
      .seg(x, y1, z1, x, y1, z0)
      .seg(x, y1, z0, x, y0, z0);
  const wallZ = (
    z: number,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    l: Lines = room,
  ) =>
    l
      .seg(x0, y0, z, x1, y0, z)
      .seg(x1, y0, z, x1, y1, z)
      .seg(x1, y1, z, x0, y1, z)
      .seg(x0, y1, z, x0, y0, z);

  // ---------- shell ----------
  frame.rect(-W, 0, -D, W, D).rect(-W, H, -D, W, D);
  for (const [x, z] of [
    [-W, -D],
    [W, -D],
    [W, D],
    [-W, D],
  ])
    frame.seg(x, 0, z, x, H, z);
  room.rect(-W + 0.06, 0.12, -D + 0.06, W - 0.06, D - 0.06); // baseboard line
  const tile = 0.5 / detailK;
  for (let x = -W + tile; x < W - 0.01; x += tile)
    fine.seg(x, 0, -D, x, 0, D).seg(x, H, -D, x, H, D);
  for (let z = -D + tile; z < D - 0.01; z += tile)
    fine.seg(-W, 0, z, W, 0, z).seg(-W, H, z, W, H, z);
  // floor: a darker inset tile pattern near the walls, plus a glowing path from door to table
  room.rect(-W + 0.8, 0, -D + 0.8, W - 0.8, D - 0.8);

  // wall panels: tall insets between grooves on the side and front walls, with a top cornice
  for (let z = -D + 0.5; z < D - 0.4; z += 1) {
    for (const x of [-W, W]) {
      wallX(x, z + 0.06, z + 0.94, 0.95, 2.75, fine);
      fine.seg(x, 0, z, x, H, z);
    }
  }
  for (let x = -W + 0.5; x < W - 0.4; x += 1) {
    wallZ(D, x + 0.06, x + 0.94, 0.95, 2.75, fine);
    fine.seg(x, 0, D, x, H, D);
  }
  room
    .seg(-W, 2.9, D, W, 2.9, D)
    .seg(-W, 0.95, D, W, 0.95, D)
    .seg(-W, 2.9, -D, -W, 2.9, D)
    .seg(W, 2.9, -D, W, 2.9, D)
    .seg(-W, 0.95, -D, -W, 0.95, D)
    .seg(W, 0.95, -D, W, 0.95, D);

  // ---------- window wall (back, -z): glass, mullions, and the city outside ----------
  for (let x = -W; x <= W + 0.01; x += 1.25) frame.seg(x, 0, -D, x, H, -D);
  frame.seg(-W, 0.9, -D, W, 0.9, -D).seg(-W, 2.9, -D, W, 2.9, -D);
  for (let x = -W + 0.625; x < W; x += 1.25) fine.seg(x, 0.9, -D, x, 2.9, -D);
  for (let y = 1.2; y < 2.9; y += 0.3) fine.seg(-W, y, -D, W, y, -D);
  // reflections: diagonal glints across the panes
  for (let x = -W + 0.2; x < W - 1; x += 1.25)
    fine
      .seg(x, 1.0, -D, x + 0.7, 2.8, -D)
      .seg(x + 0.08, 1.0, -D, x + 0.78, 2.8, -D);

  const outside = (
    x: number,
    w: number,
    h: number,
    d: number,
    z: number,
    l: Lines,
    lit: boolean,
  ) => {
    if (Math.hypot(x + w / 2, z) > 9.8 || Math.hypot(x, z - d) > 9.8) return;
    const y0 = -0.7;
    l.box(x, y0, z - d, w, h - y0, d);
    for (let y = y0 + 0.2; y < h - 0.05; y += 0.2)
      l.rect(x, y, z - d, x + w, z);
    if (lit)
      for (let i = 0; i < 3; i++) {
        const y = y0 + 0.3 + rand() * (h - y0 - 0.5);
        const xx = x + rand() * (w - 0.15);
        sky.seg(xx, y, z, xx + 0.1, y, z);
      }
  };
  const bigSpire = { x: 1.4, z: -D - 3.2 };
  for (let layer = 0; layer < 3; layer++) {
    const z = -D - 0.9 - layer * 1.3;
    const k = 1 + layer * 0.35;
    for (let x = -6.2; x < 6.2;) {
      const w = (0.35 + rand() * 0.45) * (1 + layer * 0.15);
      const d = 0.3 + rand() * 0.3;
      const h = (0.5 + Math.pow(rand(), 1.6) * 2.2) * k;
      outside(x, w, h, d, z, layer === 0 ? room : sky, layer < 2);
      if (rand() < 0.2)
        sky.seg(
          x + w / 2,
          h,
          z - d / 2,
          x + w / 2,
          h + 0.3 + rand() * 0.4,
          z - d / 2,
        );
      x += w + 0.08 + rand() * 0.2;
    }
  }
  // landmark spire (the one from the city), a dome, and a large holographic ring in the sky
  sky
    .seg(bigSpire.x, -0.7, bigSpire.z, bigSpire.x, 4.6, bigSpire.z)
    .circle(bigSpire.x, 3.4, bigSpire.z, 0.3, 24)
    .circle(bigSpire.x, 3.55, bigSpire.z, 0.24, 24);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.78;
    sky.seg(
      bigSpire.x + Math.cos(a) * 0.35,
      -0.7,
      bigSpire.z + Math.sin(a) * 0.35,
      bigSpire.x,
      3.4,
      bigSpire.z,
    );
  }
  for (let r = 0.2; r < 0.7; r += 0.17)
    sky.circle(-3.2, -0.7 + r * 0.3, -D - 2.4, r, 20);
  sky
    .circle(-3.2, -0.2, -D - 2.4, 0.7, 20)
    .seg(-3.9, -0.7, -D - 2.4, -3.9, -0.2, -D - 2.4)
    .seg(-2.5, -0.7, -D - 2.4, -2.5, -0.2, -D - 2.4);
  sky
    .circle(-2.8, 2.7, -D - 5, 1.1, 64, true)
    .circle(-2.8, 2.7, -D - 5, 0.9, 64, true)
    .circle(-2.8, 2.7, -D - 5, 1.1, 64, true, 0, 1);
  // horizon, a river of ground and an elevated road with pylons
  sky.seg(-6.5, -0.7, -D - 0.4, 6.5, -0.7, -D - 0.4);
  sky
    .seg(-6.5, 0.1, -D - 0.55, 6.5, 0.1, -D - 0.55)
    .seg(-6.5, 0.1, -D - 0.8, 6.5, 0.1, -D - 0.8);
  for (let x = -6.2; x < 6.4; x += 0.8)
    sky.seg(x, -0.7, -D - 0.7, x, 0.1, -D - 0.7);

  // ---------- door (right wall) ----------
  wallX(W, 1.0, 2.2, 0, 2.25, frame);
  wallX(W, 1.12, 2.08, 0.06, 2.15, room);
  room
    .seg(W, 0.06, 1.6, W, 2.15, 1.6)
    .circle(W, 1.1, 1.9, 0.05, 10, false)
    .seg(W, 1.1, 1.9, W - 0.05, 1.1, 1.9);
  wallX(W - 0.01, 0.82, 0.96, 1.0, 1.35, room); // access pad
  for (let k = 0; k < 4; k++)
    fine.seg(W - 0.01, 1.05 + k * 0.08, 0.86, W - 0.01, 1.05 + k * 0.08, 0.92);
  lights.seg(W, 2.45, 1.2, W, 2.45, 2.0).seg(W, 2.5, 1.2, W, 2.5, 2.0);

  // ---------- ceiling light strips and cable trays ----------
  for (const x of [-3.2, 0, 3.2]) {
    for (const z of [-2.6, 0, 2.6]) {
      lights.rect(x - 0.9, H - 0.03, z - 0.09, x + 0.9, z + 0.09);
      for (let i = -3; i <= 3; i++)
        lights.seg(
          x - 0.9,
          H - 0.03,
          z + i * 0.025,
          x + 0.9,
          H - 0.03,
          z + i * 0.025,
        );
    }
  }
  for (const x of [-4.6, 4.6]) {
    room
      .seg(x, H - 0.25, -D, x, H - 0.25, D)
      .seg(x + 0.2, H - 0.25, -D, x + 0.2, H - 0.25, D);
    for (let z = -D + 0.2; z < D; z += 0.3)
      fine
        .seg(x, H - 0.25, z, x + 0.2, H - 0.25, z)
        .seg(x, H - 0.25, z, x, H, z);
  }
  // cables hanging between ceiling hooks
  for (let k = 0; k < 6; k++) {
    const z0 = -D + 0.5 + k * 1.4;
    for (let s = 0; s < 14; s++) {
      const a = s / 14;
      const b = (s + 1) / 14;
      const sag = (q: number) => Math.sin(q * Math.PI) * 0.18;
      room.seg(
        -4.6 + 9.2 * a,
        H - 0.25 - sag(a),
        z0,
        -4.6 + 9.2 * b,
        H - 0.25 - sag(b),
        z0,
      );
    }
  }

  // ---------- desks, chairs and monitors ----------
  const monitor = (
    ox: number,
    oz: number,
    ux: number,
    uz: number,
    w: number,
    h: number,
    oy: number,
  ) => {
    mons.push({ ox, oy, oz, ux, uz, w, h });
    const p = (u: number, v: number): [number, number, number] => [
      ox + ux * u,
      oy + v,
      oz + uz * u,
    ];
    const q: [number, number][] = [
      [-0.03, -0.03],
      [w + 0.03, -0.03],
      [w + 0.03, h + 0.03],
      [-0.03, h + 0.03],
    ];
    for (let i = 0; i < 4; i++) {
      const a = p(q[i][0], q[i][1]);
      const b = p(q[(i + 1) % 4][0], q[(i + 1) % 4][1]);
      frame.seg(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  };
  const chair = (x: number, z: number) => {
    room.circle(x, 0.46, z, 0.2, 16).seg(x, 0.1, z, x, 0.46, z);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      room.seg(
        x,
        0.08,
        z,
        x + Math.cos(a) * 0.22,
        0.05,
        z + Math.sin(a) * 0.22,
      );
    }
    fine.circle(x, 0.12, z, 0.1, 10);
  };
  const desk = (
    x: number,
    z0: number,
    wd: number,
    len: number,
    side: number,
  ) => {
    frame.box(x, 0.72, z0, wd, 0.05, len);
    for (const [px, pz] of [
      [x + 0.04, z0 + 0.04],
      [x + wd - 0.04, z0 + 0.04],
      [x + 0.04, z0 + len - 0.04],
      [x + wd - 0.04, z0 + len - 0.04],
    ])
      room.seg(px, 0, pz, px, 0.72, pz);
    // drawer unit with drawer lines
    const dz = side < 0 ? z0 + len - 0.45 : z0 + 0.05;
    room.box(x + 0.08, 0.1, dz, wd - 0.16, 0.62, 0.4);
    for (let k = 1; k < 4; k++)
      fine.seg(
        x + 0.08,
        0.1 + k * 0.155,
        dz,
        x + wd - 0.08,
        0.1 + k * 0.155,
        dz,
      );
    // desk clutter: keyboard, mug, notebook
    fine.box(
      x + (side < 0 ? 0.45 : 0.15),
      0.77,
      z0 + len / 2 - 0.2,
      0.25,
      0.015,
      0.4,
    );
    fine
      .circle(x + wd / 2, 0.82, z0 + 0.2, 0.035, 8)
      .circle(x + wd / 2, 0.77, z0 + 0.2, 0.035, 8);
    fine.rect(
      x + wd * 0.4,
      0.775,
      z0 + len - 0.35,
      x + wd * 0.4 + 0.2,
      z0 + len - 0.1,
    );
    const mx = side < 0 ? x + 0.12 : x + wd - 0.12;
    for (let m = 0; m < 2; m++) {
      const mz = z0 + 0.1 + m * (len / 2 - 0.05);
      monitor(mx, mz, 0, 1, len / 2 - 0.15, 0.36, 0.88);
      room
        .seg(mx, 0.77, mz + len / 4 - 0.075, mx, 0.88, mz + len / 4 - 0.075)
        .seg(mx, 0.77, mz + len / 4 - 0.17, mx, 0.77, mz + len / 4 + 0.02);
    }
    chair(side < 0 ? x + wd + 0.35 : x - 0.35, z0 + len / 2);
  };
  for (const z0 of [-3.7, -1.7, 0.3]) desk(-W + 0.1, z0, 0.9, 1.6, -1);
  for (const z0 of [-3.7, -1.7]) desk(W - 1.0, z0, 0.9, 1.6, 1);

  // ---------- front wall: wall display, shelves and a server rack ----------
  monitor(1.4, D - 0.04, 1, 0, 3, 1.4, 1.1);
  for (let k = 0; k < 4; k++)
    room.seg(
      1.4 + (3 * k) / 3,
      2.52,
      D - 0.04,
      1.4 + (3 * k) / 3,
      2.7,
      D - 0.04,
    ); // mounting rails
  for (const y of [0.45, 1.05, 1.65, 2.25]) {
    room.box(-3.3, y, D - 0.4, 2.3, 0.03, 0.4);
    let x = -3.25;
    while (x < -1.1) {
      const w = 0.03 + rand() * 0.05;
      const h = 0.15 + rand() * 0.28;
      if (rand() < 0.88)
        fine
          .seg(x, y + 0.03, D - 0.12, x, y + 0.03 + h, D - 0.12)
          .seg(x + w, y + 0.03, D - 0.12, x + w, y + 0.03 + h, D - 0.12)
          .seg(x, y + 0.03 + h, D - 0.12, x + w, y + 0.03 + h, D - 0.12);
      x += w + 0.015;
    }
  }
  for (const x of [-3.3, -1.0])
    room
      .seg(x, 0, D - 0.4, x, 2.4, D - 0.4)
      .seg(x, 0, D - 0.02, x, 2.4, D - 0.02);
  room.box(-4.7, 0, D - 0.85, 1.0, 2.3, 0.8);
  const leds: number[] = [];
  for (let y = 0.1; y < 2.25; y += 0.075) {
    fine.seg(-4.7, y, D - 0.85, -3.7, y, D - 0.85);
    if (rand() < 0.55)
      fine.seg(
        -4.6,
        y + 0.03,
        D - 0.855,
        -4.6 + 0.2 + rand() * 0.4,
        y + 0.03,
        D - 0.855,
      );
    for (let c = 0; c < 3; c++)
      if (rand() < 0.7) leds.push(-4.0 + c * 0.1, y + 0.035, D - 0.86);
  }
  for (let x = -4.7; x <= -3.7; x += 0.2)
    room.seg(x, 0, D - 0.85, x, 2.3, D - 0.85);

  // ---------- cables on the floor ----------
  const cable = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    bend: number,
  ) => {
    let px = ax;
    let pz = az;
    const nx = -(bz - az);
    const nz = bx - ax;
    for (let s = 1; s <= 16; s++) {
      const q = s / 16;
      const off = Math.sin(q * Math.PI) * bend;
      const x = ax + (bx - ax) * q + nx * off;
      const z = az + (bz - az) * q + nz * off;
      room.seg(px, 0.015, pz, x, 0.015, z);
      px = x;
      pz = z;
    }
  };
  for (let k = 0; k < 3; k++) {
    cable(-1.0, 0.1 * k, -W + 1.2, -2.5 + 2 * k + 0.1 * k, 0.1 + k * 0.04);
    cable(1.0, -0.1 * k, W - 1.4, -3 + 2 * k, -0.1 - k * 0.04);
  }
  cable(0.3, 1.0, -2.2, D - 0.7, 0.07);
  cable(-0.3, 1.0, -4.2, D - 0.9, -0.05);
  cable(0.5, 0.9, 2.6, D - 0.2, 0.06);

  // ---------- the projection table ----------
  const table = new Lines();
  const tableThick = new Lines();
  table
    .circle(0, 0, 0, 0.8, 48)
    .circle(0, 0.64, 0, 0.9, 48)
    .circle(0, 0.66, 0, 1.12, 64)
    .circle(0, 0.69, 0, 1.12, 64);
  tableThick
    .circle(0, 0.72, 0, 1.1, 96)
    .circle(0, 0.8, 0, 1.1, 96)
    .circle(0, 0, 0, 0.8, 64)
    .circle(0, 0.81, 0, 0.32, 48);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    table.seg(
      Math.cos(a) * 0.8,
      0,
      Math.sin(a) * 0.8,
      Math.cos(a) * 0.9,
      0.64,
      Math.sin(a) * 0.9,
    );
    table.seg(
      Math.cos(a) * 1.1,
      0.72,
      Math.sin(a) * 1.1,
      Math.cos(a) * 1.1,
      0.8,
      Math.sin(a) * 1.1,
    );
  }
  for (let r = 0.45; r <= 1.0; r += 0.18) table.circle(0, 0.81, 0, r, 56);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    table.seg(
      Math.cos(a) * 0.32,
      0.81,
      Math.sin(a) * 0.32,
      Math.cos(a) * 1.05,
      0.81,
      Math.sin(a) * 1.05,
    );
  }
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU;
    const r = i % 6 === 0 ? 0.95 : 1.0;
    table.seg(
      Math.cos(a) * r,
      0.81,
      Math.sin(a) * r,
      Math.cos(a) * 1.07,
      0.81,
      Math.sin(a) * 1.07,
    );
  }
  // emitter column and vertical beam lines up the cone
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    table.seg(
      Math.cos(a) * 0.28,
      0.82,
      Math.sin(a) * 0.28,
      Math.cos(a) * 0.62,
      1.44,
      Math.sin(a) * 0.62,
    );
  }
  table.circle(0, 1.44, 0, 0.62, 48).circle(0, 0.9, 0, 0.34, 32);
  // floor decal under the table
  table.circle(0, 0.005, 0, 1.45, 72).circle(0, 0.005, 0, 1.5, 72);
  for (let r = 1.6; r < 2.3; r += 0.2) table.circle(0, 0.005, 0, r, 72);
  const floorRing = new Group();
  const arcs = new Lines();
  for (let k = 0; k < 6; k++)
    arcs.circle(
      0,
      0.01,
      0,
      1.85,
      12,
      false,
      (k * TAU) / 6 + 0.1,
      ((k + 0.7) * TAU) / 6,
    );
  for (let k = 0; k < 36; k++)
    arcs.seg(
      Math.cos((k * TAU) / 36) * 1.75,
      0.01,
      Math.sin((k * TAU) / 36) * 1.75,
      Math.cos((k * TAU) / 36) * 1.8,
      0.01,
      Math.sin((k * TAU) / 36) * 1.8,
    );
  floorRing.add(
    new LineSegments(arcs.geometry(), lineMaterial(fade, ICE, 0.55)),
  );
  const dial = new Group();
  dial.position.y = 0.815;
  const dialL = new Lines().circle(0, 0, 0, 0.52, 64);
  for (let k = 0; k < 28; k++)
    dialL.seg(
      Math.cos((k * TAU) / 28) * 0.47,
      0,
      Math.sin((k * TAU) / 28) * 0.47,
      Math.cos((k * TAU) / 28) * 0.52,
      0,
      Math.sin((k * TAU) / 28) * 0.52,
    );
  dial.add(new LineSegments(dialL.geometry(), lineMaterial(fade, ICE, 0.7)));

  // ---------- assemble the static room ----------
  root.add(strokes(frame.positions(), fade, ICE, 0.95, 2.2));
  root.add(strokes(tableThick.positions(), fade, ICE, 1, 2.6));
  root.add(new LineSegments(room.geometry(), lineMaterial(fade, ICE, 0.5)));
  root.add(new LineSegments(fine.geometry(), lineMaterial(fade, CYAN, 0.2)));
  root.add(new LineSegments(lights.geometry(), lineMaterial(fade, ICE, 0.9)));
  root.add(new LineSegments(sky.geometry(), lineMaterial(fade, CYAN, 0.4)));
  root.add(new LineSegments(table.geometry(), lineMaterial(fade, CYAN, 0.55)));
  root.add(floorRing, dial);

  // projected light: cone, rising scan rings, motes
  const cone = new Mesh(
    new CylinderGeometry(0.62, 0.28, 0.62, 48, 1, true).translate(0, 1.13, 0),
    fillMaterial(fade, ICE, 0.28),
  );
  cone.userData.noSample = true;
  root.add(cone);
  const ringGeo = new Lines().circle(0, 0, 0, 1, 40).geometry();
  const ringMat = lineMaterial(fade, ICE, 0.7);
  const scanRings = [0, 1, 2].map(() => {
    const r = new LineSegments(ringGeo, ringMat);
    r.userData.noSample = true;
    root.add(r);
    return r;
  });

  // ---------- the machine hologram: meshed gears, the clue to the next world ----------
  const holoMachine = new Group();
  holoMachine.position.set(0, 1.78, 0);
  root.add(holoMachine);
  const gearGeo = (teeth: number, r0: number, r1: number, th: number) => {
    const g = new Lines();
    const p = TAU / teeth;
    for (const z of [-th / 2, th / 2]) {
      for (let i = 0; i < teeth; i++) {
        const a = i * p;
        const pts = [
          [a, r0],
          [a + 0.12 * p, r1],
          [a + 0.38 * p, r1],
          [a + 0.5 * p, r0],
          [a + p, r0],
        ];
        for (let k = 0; k < 4; k++) {
          const [a0, rA] = pts[k];
          const [a1, rB] = pts[k + 1];
          g.seg(
            Math.cos(a0) * rA,
            Math.sin(a0) * rA,
            z,
            Math.cos(a1) * rB,
            Math.sin(a1) * rB,
            z,
          );
        }
      }
      g.circle(0, 0, z, r0 * 0.5, 20, true).circle(
        0,
        0,
        z,
        r0 * 0.18,
        12,
        true,
      );
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        g.seg(
          Math.cos(a) * r0 * 0.18,
          Math.sin(a) * r0 * 0.18,
          z,
          Math.cos(a) * r0 * 0.5,
          Math.sin(a) * r0 * 0.5,
          z,
        );
      }
    }
    for (let i = 0; i < teeth; i++) {
      for (const f of [0.12, 0.38]) {
        const a = (i + f) * p;
        g.seg(
          Math.cos(a) * r1,
          Math.sin(a) * r1,
          -th / 2,
          Math.cos(a) * r1,
          Math.sin(a) * r1,
          th / 2,
        );
      }
    }
    g.seg(0, 0, -th * 1.6, 0, 0, th * 1.6);
    return new LineSegments(g.geometry(), targetMaterial(fade, glow));
  };
  const gear = [
    { n: 14, r0: 0.25, r1: 0.31, x: 0, y: 0, th: 0.07 },
    { n: 8, r0: 0.15, r1: 0.2, x: 0, y: 0, th: 0.07 },
    { n: 6, r0: 0.1, r1: 0.14, x: 0, y: 0, th: 0.07 },
  ].map((c) => ({ ...c, obj: gearGeo(c.n, c.r0, c.r1, c.th) }));
  const phiBC = 1.15;
  const pitch = (c: (typeof gear)[number]) => (c.r0 + c.r1) / 2;
  gear[0].x = -0.36;
  gear[0].y = -0.04;
  gear[1].x = gear[0].x + pitch(gear[0]) + pitch(gear[1]);
  gear[1].y = gear[0].y;
  gear[2].x = gear[1].x + Math.cos(phiBC) * (pitch(gear[1]) + pitch(gear[2]));
  gear[2].y = gear[1].y + Math.sin(phiBC) * (pitch(gear[1]) + pitch(gear[2]));
  for (const c of gear) {
    c.obj.position.set(c.x, c.y, 0);
    holoMachine.add(c.obj);
  }
  const cage = new Lines()
    .circle(0, 0, 0, 0.62, 56)
    .circle(0, 0, 0, 0.62, 56, true)
    .circle(0, -0.45, 0, 0.5, 40);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU;
    cage.seg(
      Math.cos(a) * 0.5,
      -0.45,
      Math.sin(a) * 0.5,
      Math.cos(a) * 0.5,
      -0.5,
      Math.sin(a) * 0.5,
    );
  }
  holoMachine.add(
    new LineSegments(cage.geometry(), targetMaterial(fade, glow)),
  );
  // a ring of data ticks that drifts around the hologram (cyan: only the machine is amber)
  const orbit = new Group();
  const orbitL = new Lines().circle(0, 0, 0, 0.78, 72);
  for (let k = 0; k < 60; k++)
    orbitL.seg(
      Math.cos((k * TAU) / 60) * 0.78,
      0,
      Math.sin((k * TAU) / 60) * 0.78,
      Math.cos((k * TAU) / 60) * (k % 5 === 0 ? 0.86 : 0.82),
      0,
      Math.sin((k * TAU) / 60) * (k % 5 === 0 ? 0.86 : 0.82),
    );
  orbit.add(new LineSegments(orbitL.geometry(), lineMaterial(fade, ICE, 0.45)));
  orbit.position.y = 1.78;
  orbit.rotation.x = 0.4;
  root.add(orbit);

  // ---------- monitors: animated data lines in one dynamic buffer ----------
  const screenBuf = new Float32Array(mons.length * SEGS * 6);
  const screenAttr = new BufferAttribute(screenBuf, 3);
  const screens = new LineSegments(
    new Lines().geometry(),
    lineMaterial(fade, ICE, 0.85),
  );
  screens.geometry.setAttribute("position", screenAttr);
  screens.frustumCulled = false;
  root.add(screens);
  let cur = 0;
  const put = (m: Mon, u0: number, v0: number, u1: number, v1: number) => {
    screenBuf[cur++] = m.ox + m.ux * u0;
    screenBuf[cur++] = m.oy + v0;
    screenBuf[cur++] = m.oz + m.uz * u0;
    screenBuf[cur++] = m.ox + m.ux * u1;
    screenBuf[cur++] = m.oy + v1;
    screenBuf[cur++] = m.oz + m.uz * u1;
  };
  const noise = (n: number) => {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  };
  const drawScreens = (t: number) => {
    cur = 0;
    for (let mi = 0; mi < mons.length; mi++) {
      const m = mons[mi];
      for (let i = 0; i < 8; i++) {
        const u = m.w * (0.06 + i * 0.055);
        const h =
          (0.25 +
            0.7 * (0.5 + 0.5 * Math.sin(t * (0.8 + i * 0.31) + mi * 1.7 + i))) *
          m.h *
          0.6;
        put(m, u, m.h * 0.12, u, m.h * 0.12 + h);
      }
      let pv = 0.75 + 0.15 * Math.sin(mi);
      for (let i = 0; i < 14; i++) {
        const u0 = m.w * (0.55 + (i / 14) * 0.4);
        const u1 = m.w * (0.55 + ((i + 1) / 14) * 0.4);
        const nv =
          0.72 +
          0.17 *
            Math.sin(t * 1.3 + (i + 1) * 0.8 + mi) *
            Math.sin(t * 0.4 + i * 0.3);
        put(m, u0, m.h * pv, u1, m.h * nv);
        pv = nv;
      }
      for (let r = 0; r < 4; r++) {
        const len =
          0.12 + 0.28 * noise(Math.floor(t * 1.5 + r * 3) + mi * 7 + r);
        put(
          m,
          m.w * 0.55,
          m.h * (0.12 + r * 0.1),
          m.w * (0.55 + len),
          m.h * (0.12 + r * 0.1),
        );
      }
    }
    screenAttr.needsUpdate = true;
  };
  drawScreens(0);

  // ---------- light sprites: traffic outside, rack LEDs, drifting motes ----------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attr3 = (a: Float32Array): any =>
    instancedBufferAttribute(new InstancedBufferAttribute(a, 3), "vec3");
  const sprite = (
    pos: Float32Array, // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build: (p: any) => Partial<PointsNodeMaterial>,
    count: number,
  ) => {
    const m = Object.assign(
      new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: false,
      }),
      build(attr3(pos)),
    );
    const s = new Sprite(m);
    s.count = count;
    s.frustumCulled = false;
    return s;
  };
  const soft = smoothstep(0.5, 0.05, length(uv().sub(0.5)));
  // outside traffic: [x0, y, z] + [speed, phase, lane length] packed in two buffers
  const cars: number[] = [];
  const lanes = [
    [-D - 0.55, 0.12, 1],
    [-D - 0.8, 0.12, -1],
    [-D - 1.9, 0.62, 1],
  ];
  for (const [z, y, dir] of lanes) {
    for (let i = 0; i < Math.round(9 * detailK); i++) {
      const sp = (0.5 + rand() * 0.5) * dir;
      const ph = rand();
      for (let k = 0; k < 3; k++)
        cars.push(z, y, sp, ph - (k * 0.05 * dir) / 12);
    }
  }
  const nCars = cars.length / 4;
  const carP = new Float32Array(nCars * 3);
  for (let i = 0; i < nCars; i++) {
    carP.set([cars[i * 4], cars[i * 4 + 1], cars[i * 4 + 2]], i * 3);
  }
  const carPhase = new Float32Array(nCars);
  for (let i = 0; i < nCars; i++) carPhase[i] = cars[i * 4 + 3];
  const carNode = attr3(carP);
  const phaseNode: any = instancedBufferAttribute(
    new InstancedBufferAttribute(carPhase, 1),
    "float",
  ); // eslint-disable-line @typescript-eslint/no-explicit-any
  const run = fract(phaseNode.add(time.mul(carNode.z).mul(0.07)));
  const traffic = new Sprite(
    Object.assign(
      new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: false,
      }),
      {
        positionNode: vec3(run.mul(12).sub(6), carNode.y, carNode.x),
        sizeNode: float(1.7),
        colorNode: color(ICE),
        opacityNode: soft.mul(0.8).mul(fade),
      },
    ),
  );
  traffic.count = nCars;
  traffic.frustumCulled = false;
  root.add(traffic);

  const ledPos = new Float32Array(leds);
  const led = sprite(
    ledPos,
    (p) => ({
      positionNode: p,
      sizeNode: float(3),
      colorNode: color(CYAN),
      opacityNode: soft
        .mul(
          step(
            0.5,
            fract(
              time
                .mul(hash(instanceIndex).mul(1.5).add(0.4))
                .add(hash(instanceIndex.add(7))),
            ),
          ),
        )
        .mul(0.9)
        .mul(fade),
    }),
    ledPos.length / 3,
  );
  led.userData.points = ledPos;
  root.add(led);

  const nMotes = Math.round(70 * detailK);
  const motes = new Float32Array(nMotes * 3);
  for (let i = 0; i < nMotes; i++)
    motes.set(
      [
        (rand() - 0.5) * 2 * (W - 0.5),
        rand() * H,
        (rand() - 0.5) * 2 * (D - 0.5),
      ],
      i * 3,
    );
  const dust = sprite(
    motes,
    (p) => ({
      positionNode: vec3(
        p.x.add(sin(time.mul(0.3).add(p.z.mul(3))).mul(0.12)),
        fract(p.y.div(H).add(time.mul(0.015))).mul(H),
        p.z,
      ),
      sizeNode: float(1.3).add(hash(instanceIndex).mul(1.2)),
      colorNode: color(ICE),
      opacityNode: soft.mul(0.45).mul(fade),
    }),
    nMotes,
  );
  dust.userData.noSample = true;
  root.add(dust);

  // ---------- HUD callouts ----------
  const labels: NonNullable<Layer["labels"]> = [];
  const pin = (x: number, y: number, z: number, pt: string, en: string) => {
    const o = new Object3D();
    o.position.set(x, y, z);
    root.add(o);
    labels.push({ object: o, pt, en });
  };
  pin(0, 2.45, 0, "ANOMALIA · SINAL FRACO", "ANOMALY · FAINT SIGNAL");
  pin(3.0, 2.55, -D, "VISTA · SETOR 7", "VIEW · SECTOR 7");
  pin(-W + 0.4, 1.35, -0.9, "ESTAÇÃO 03 · ATIVA", "STATION 03 · ACTIVE");
  pin(-4.2, 2.4, D - 0.5, "SERVIDOR · CARGA 62%", "SERVER · LOAD 62%");
  pin(W, 2.4, 1.6, "PORTA · ACESSO RESTRITO", "DOOR · RESTRICTED ACCESS");

  return {
    id: "room",
    exposure: 0.5,
    root,
    fade,
    glow,
    radius: 6.5,
    view: {
      distance: 11.5,
      minDistance: 3,
      maxDistance: 15,
      pitch: 0.42,
      height: 1.2,
    },
    target: { object: holoMachine, radius: 0.55 },
    labels,
    update(t) {
      holoMachine.rotation.y = t * 0.35;
      holoMachine.position.y = 1.78 + Math.sin(t * 1.1) * 0.04;
      orbit.position.y = holoMachine.position.y;
      orbit.rotation.y = -t * 0.25;
      // gears mesh: each turns against its driver, phase-shifted so teeth meet gaps
      const a = gear[0];
      const b = gear[1];
      const c = gear[2];
      const tA = t * 0.5;
      const tB = (-tA * a.n) / b.n + Math.PI;
      a.obj.rotation.z = tA;
      b.obj.rotation.z = tB;
      c.obj.rotation.z = (-tB * b.n) / c.n + Math.PI + phiBC * (1 + b.n / c.n);
      floorRing.rotation.y = t * 0.2;
      dial.rotation.y = -t * 0.35;
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.2 + i / 3) % 1;
        const r = scanRings[i];
        r.position.y = 0.84 + q * 0.58;
        r.scale.setScalar(0.28 + q * 0.34);
      }
      drawScreens(t);
    },
  };
}
