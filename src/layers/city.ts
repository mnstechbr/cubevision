import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PointsNodeMaterial,
  Sprite,
} from "three/webgpu";
import {
  atan,
  color,
  cos,
  float,
  fract,
  hash,
  instanceIndex,
  instancedBufferAttribute,
  length,
  mix,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  step,
  time,
  uv,
  vec3,
} from "three/tsl";
import { Lines, layerBase, rng } from "../engine/build";
import {
  AMBER,
  CYAN,
  ICE,
  fillMaterial,
  lineMaterial,
  strokes,
  targetMaterial,
} from "../engine/holo";
import type { Layer, LayerContext } from "../engine/layers";

const R = 11;
const RING = R - 0.6; // ring road centre line
const CELL = 1.8;
const STREET = 0.34;
const AVENUE = 0.9;
const TAU = Math.PI * 2;

/** [2] Inside the cube: a whole city in wireframe. One building has a lit window. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(1337);
  const detail = Math.max(0.5, ctx.detail);
  const floorGap = 0.14 / detail;

  const ground = new Lines(); // faint: lots, lane marks, ticks
  const shells = new Lines(); // medium: building edges
  const facade = new Lines(); // faint dense: floors, mullions
  const windows = new Lines(); // lit window dashes
  const sil = new Lines(); // thick: silhouettes
  const roads = new Lines(); // thick: avenues, ring road
  const hwThin = new Lines();
  const hwThick = new Lines();
  const boxes: number[] = []; // x,y,z,w,h,d for façade fills
  const cyls: number[] = []; // x,z,r,h
  const beacons: number[] = [];

  // ---------- street grid ----------
  const cells: { a: number; b: number }[] = [];
  const gapMid: number[] = [];
  const avenues: number[] = [];
  {
    let p = 0;
    for (let i = 0; i < 10; i++) {
      cells.push({ a: p, b: p + CELL });
      p += CELL;
      if (i < 9) {
        const g = i % 4 === 3 ? AVENUE : STREET;
        gapMid.push(p + g / 2);
        if (g === AVENUE) avenues.push(p + g / 2);
        p += g;
      }
    }
    const off = p / 2;
    for (const c of cells) ((c.a -= off), (c.b -= off));
    for (let i = 0; i < gapMid.length; i++) gapMid[i] -= off;
    for (let i = 0; i < avenues.length; i++) avenues[i] -= off;
  }
  const reach = (c: number) => Math.sqrt(Math.max(0, RING * RING - c * c));

  // ---------- building archetypes ----------
  const facadeLines = (
    x: number,
    y0: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    for (let y = y0 + floorGap; y < y0 + h - 0.04; y += floorGap)
      facade.rect(x, y, z, x + w, z + d);
    const nx = Math.max(1, Math.round(w / 0.15));
    const nz = Math.max(1, Math.round(d / 0.15));
    for (let i = 1; i < nx; i++) {
      const xx = x + (w * i) / nx;
      facade
        .seg(xx, y0, z, xx, y0 + h, z)
        .seg(xx, y0, z + d, xx, y0 + h, z + d);
    }
    for (let i = 1; i < nz; i++) {
      const zz = z + (d * i) / nz;
      facade
        .seg(x, y0, zz, x, y0 + h, zz)
        .seg(x + w, y0, zz, x + w, y0 + h, zz);
    }
  };

  const litWindows = (
    x: number,
    y0: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    const n = Math.round(h * 5 * detail);
    for (let i = 0; i < n; i++) {
      const y = y0 + 0.08 + rand() * (h - 0.16);
      const s = 0.05 + rand() * 0.07;
      const face = (rand() * 4) | 0;
      if (face < 2) {
        const xx = x + 0.05 + rand() * (w - 0.2);
        const zz = face === 0 ? z : z + d;
        windows.seg(xx, y, zz, xx + s, y, zz);
      } else {
        const zz = z + 0.05 + rand() * (d - 0.2);
        const xx = face === 2 ? x : x + w;
        windows.seg(xx, y, zz, xx, y, zz + s);
      }
    }
  };

  const outline = (
    l: Lines,
    x: number,
    y0: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    l.rect(x, y0 + h, z, x + w, z + d);
    for (const [px, pz] of [
      [x, z],
      [x + w, z],
      [x, z + d],
      [x + w, z + d],
    ])
      l.seg(px, y0, pz, px, y0 + h, pz);
  };

  const rooftop = (
    cx: number,
    cz: number,
    y: number,
    w: number,
    d: number,
    h: number,
  ) => {
    const k = rand();
    if (k < 0.3) {
      // antenna mast with cross arms and a blinking light
      const t = 0.35 + rand() * 0.7 + h * 0.08;
      shells
        .seg(cx, y, cz, cx, y + t, cz)
        .seg(cx - 0.06, y + t * 0.7, cz, cx + 0.06, y + t * 0.7, cz)
        .seg(cx, y + t * 0.5, cz - 0.05, cx, y + t * 0.5, cz + 0.05);
      if (h > 1.6) beacons.push(cx, y + t, cz);
    } else if (k < 0.5) {
      // water tank on legs
      shells.circle(cx, y + 0.12, cz, 0.1, 10).circle(cx, y + 0.2, cz, 0.1, 10);
      for (let i = 0; i < 4; i++)
        shells.seg(
          cx + Math.cos(i * 1.57) * 0.08,
          y,
          cz + Math.sin(i * 1.57) * 0.08,
          cx + Math.cos(i * 1.57) * 0.1,
          y + 0.12,
          cz + Math.sin(i * 1.57) * 0.1,
        );
    } else if (k < 0.68 && Math.min(w, d) > 0.7) {
      // helipad
      const r = Math.min(w, d) * 0.32;
      shells
        .circle(cx, y + 0.005, cz, r, 20)
        .circle(cx, y + 0.005, cz, r * 0.8, 20);
      shells
        .seg(
          cx - r * 0.3,
          y + 0.005,
          cz - r * 0.35,
          cx - r * 0.3,
          y + 0.005,
          cz + r * 0.35,
        )
        .seg(
          cx + r * 0.3,
          y + 0.005,
          cz - r * 0.35,
          cx + r * 0.3,
          y + 0.005,
          cz + r * 0.35,
        )
        .seg(cx - r * 0.3, y + 0.005, cz, cx + r * 0.3, y + 0.005, cz);
    } else {
      // HVAC boxes
      for (let i = 0; i < 2; i++)
        shells.box(
          cx - w * 0.3 + i * w * 0.32,
          y,
          cz - d * 0.2 + (rand() - 0.5) * 0.1,
          w * 0.2,
          0.06 + rand() * 0.06,
          d * 0.3,
        );
    }
  };

  const tower = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    tiers: number,
    thick: boolean,
  ) => {
    let y0 = 0;
    let cw = w;
    let cd = d;
    let cx = x;
    let cz = z;
    const split =
      tiers === 1 ? [1] : tiers === 2 ? [0.68, 0.32] : [0.55, 0.3, 0.15];
    for (let t = 0; t < tiers; t++) {
      const th = h * split[t];
      shells.box(cx, y0, cz, cw, th, cd);
      facadeLines(cx, y0, cz, cw, th, cd);
      litWindows(cx, y0, cz, cw, th, cd);
      boxes.push(cx, y0, cz, cw, th, cd);
      if (thick && (t === tiers - 1 || t === 0))
        outline(sil, cx, y0, cz, cw, th, cd);
      y0 += th;
      const sx = cw * 0.2;
      const sz = cd * 0.2;
      cx += sx / 2 + (rand() - 0.5) * 0.06;
      cz += sz / 2 + (rand() - 0.5) * 0.06;
      cw -= sx;
      cd -= sz;
    }
    rooftop(cx + cw / 2, cz + cd / 2, y0, cw, cd, h);
    return y0;
  };

  const cylinder = (
    cx: number,
    cz: number,
    r: number,
    h: number,
    dome: boolean,
    thick: boolean,
  ) => {
    for (let y = floorGap; y <= h + 0.001; y += floorGap)
      facade.circle(cx, y, cz, r, 20);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      facade.seg(
        cx + Math.cos(a) * r,
        0,
        cz + Math.sin(a) * r,
        cx + Math.cos(a) * r,
        h,
        cz + Math.sin(a) * r,
      );
    }
    shells.circle(cx, 0, cz, r, 28).circle(cx, h, cz, r, 28);
    if (thick)
      sil
        .circle(cx, h, cz, r, 28)
        .seg(cx - r, 0, cz, cx - r, h, cz)
        .seg(cx + r, 0, cz, cx + r, h, cz)
        .seg(cx, 0, cz - r, cx, h, cz - r)
        .seg(cx, 0, cz + r, cx, h, cz + r);
    cyls.push(cx, cz, r, h);
    if (dome) {
      for (let k = 0; k < 6; k++) {
        const ph = (k / 6) * Math.PI;
        let px = cx + Math.cos(ph) * r;
        let py = h;
        let pz = cz + Math.sin(ph) * r;
        for (let s = 1; s <= 8; s++) {
          const th = (s / 8) * Math.PI;
          const qx = cx + Math.cos(ph) * r * Math.cos(th);
          const qy = h + Math.sin(th) * r * 0.7;
          const qz = cz + Math.sin(ph) * r * Math.cos(th);
          shells.seg(px, py, pz, qx, qy, qz);
          if (thick && (k === 0 || k === 3)) sil.seg(px, py, pz, qx, qy, qz);
          [px, py, pz] = [qx, qy, qz];
        }
      }
      for (const f of [0.45, 0.8])
        facade.circle(
          cx,
          h + Math.sin(f * 1.4) * r * 0.7,
          cz,
          r * Math.cos(f * 1.4),
          20,
        );
    } else {
      rooftop(cx, cz, h, r * 1.6, r * 1.6, h);
    }
  };

  const heightAt = (cx: number, cz: number) => {
    const f = Math.max(0, 1 - Math.hypot(cx, cz) / (R - 1));
    return 0.3 + Math.pow(rand(), 1.8) * 4.8 * Math.pow(f, 1.2) + rand() * 0.35;
  };

  // reserved blocks: landmarks and the target
  const nearest = (px: number, pz: number) => {
    let best = [0, 0];
    let bd = 1e9;
    for (let i = 0; i < cells.length; i++)
      for (let j = 0; j < cells.length; j++) {
        const d = Math.hypot(
          (cells[i].a + cells[i].b) / 2 - px,
          (cells[j].a + cells[j].b) / 2 - pz,
        );
        if (d < bd) ((bd = d), (best = [i, j]));
      }
    return best.join(",");
  };
  const reserved = new Map<string, string>([
    [nearest(-2.5, -1.8), "spire"],
    [nearest(3.6, -3.8), "twin"],
    [nearest(-5.8, 3.4), "ziggurat"],
    [nearest(5.4, 0.2), "arena"],
    [nearest(1.9, 5.3), "target"],
  ]);

  let targetLot = { x: 0, z: 0, w: 0.86, d: 0.86, h: 2.7 };
  const anchors: Record<string, [number, number, number]> = {};
  const gridLimit = R - 1.1;

  cells.forEach((cx, i) =>
    cells.forEach((cz, j) => {
      const x0 = cx.a;
      const x1 = cx.b;
      const z0 = cz.a;
      const z1 = cz.b;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      let far = 0;
      for (const [px, pz] of [
        [x0, z0],
        [x1, z0],
        [x0, z1],
        [x1, z1],
      ])
        far = Math.max(far, Math.hypot(px, pz));
      if (far > gridLimit) {
        if (Math.hypot(mx, mz) < gridLimit) ground.rect(x0, 0, z0, x1, z1); // partial edge block: a lot only
        return;
      }
      ground
        .rect(x0, 0, z0, x1, z1)
        .rect(x0 + 0.05, 0, z0 + 0.05, x1 - 0.05, z1 - 0.05);
      const kind = reserved.get(`${i},${j}`);
      const w2 = CELL / 2 - 0.06;
      const dist = Math.hypot(mx, mz);

      if (kind === "spire") {
        // needle tower: tapering shaft, observation ring, long mast
        const h = 5.4;
        tower(mx - 0.4, mz - 0.4, 0.8, 0.8, h * 0.55, 2, true);
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * TAU + Math.PI / 4;
          const bx = mx + Math.cos(a) * 0.5;
          const bz = mz + Math.sin(a) * 0.5;
          sil.seg(
            bx,
            0,
            bz,
            mx + Math.cos(a) * 0.1,
            h * 0.72,
            mz + Math.sin(a) * 0.1,
          );
          shells.seg(bx, 0, bz, mx, h * 0.72, mz);
        }
        for (let y = 0.4; y < h * 0.72; y += 0.22)
          shells.circle(mx, y, mz, 0.5 * (1 - y / (h * 0.8)) + 0.04, 16);
        for (const [yy, rr] of [
          [h * 0.72, 0.42],
          [h * 0.72 + 0.14, 0.34],
        ]) {
          sil.circle(mx, yy, mz, rr, 24);
          shells.circle(mx, yy - 0.05, mz, rr, 24);
        }
        sil.seg(mx, h * 0.72 + 0.14, mz, mx, h + 1.1, mz);
        shells.seg(mx, h + 0.4, mz - 0.06, mx, h + 0.4, mz + 0.06);
        beacons.push(mx, h + 1.1, mz);
        anchors.spire = [mx, h + 1.1, mz];
        return;
      }
      if (kind === "twin") {
        const h = 4.6;
        for (const s of [-1, 1])
          tower(mx + s * 0.5 - 0.3, mz - 0.3, 0.6, 0.6, h + s * 0.2, 3, true);
        // skybridge with truss
        const yb = h * 0.62;
        sil.box(mx - 0.2, yb, mz - 0.07, 0.4, 0.1, 0.14);
        for (let k = 0; k < 8; k++)
          shells.seg(
            mx - 0.2 + k * 0.05,
            yb,
            mz,
            mx - 0.15 + k * 0.05,
            yb + 0.1,
            mz,
          );
        anchors.twin = [mx, h + 0.2, mz];
        return;
      }
      if (kind === "ziggurat") {
        let s = CELL - 0.2;
        let y = 0;
        for (let k = 0; k < 6; k++, s -= 0.26) {
          shells.box(mx - s / 2, y, mz - s / 2, s, 0.2, s);
          facade.rect(mx - s / 2, y + 0.1, mz - s / 2, mx + s / 2, mz + s / 2);
          boxes.push(mx - s / 2, y, mz - s / 2, s, 0.2, s);
          sil.rect(mx - s / 2, y + 0.2, mz - s / 2, mx + s / 2, mz + s / 2);
          for (let q = 0; q < 8; q++)
            facade.seg(
              mx - s / 2 + (s * q) / 7,
              y,
              mz + s / 2,
              mx - s / 2 + (s * q) / 7,
              y + 0.2,
              mz + s / 2,
            );
          y += 0.2;
        }
        sil.seg(mx, y, mz, mx, y + 0.9, mz);
        beacons.push(mx, y + 0.9, mz);
        return;
      }
      if (kind === "arena") {
        cylinder(mx, mz, 0.78, 0.7, true, true);
        shells.circle(mx, 0.35, mz, 0.9, 32).circle(mx, 0.05, mz, 0.9, 32);
        anchors.arena = [mx, 1.2, mz];
        return;
      }
      if (kind === "target") {
        // the lot you can enter: front-right of the block, everyone else stays low
        const w = 0.86;
        const lots: [number, number][] = [
          [x0 + 0.04, z0 + 0.04],
          [x0 + 0.04 + w + 0.06, z0 + 0.04],
          [x0 + 0.04, z0 + 0.04 + w + 0.06],
        ];
        for (const [lx, lz] of lots)
          tower(lx, lz, w, w, 0.35 + rand() * 0.45, 1, false);
        targetLot = { x: x1 - 0.04 - w, z: z1 - 0.04 - w, w, d: w, h: 2.7 };
        return;
      }

      const r = rand();
      if (r < 0.34) {
        for (let lx = 0; lx < 2; lx++)
          for (let lz = 0; lz < 2; lz++) {
            const w = w2 * (0.82 + rand() * 0.16);
            const d = w2 * (0.82 + rand() * 0.16);
            const h = heightAt(mx, mz);
            tower(
              x0 + 0.05 + lx * (w2 + 0.06),
              z0 + 0.05 + lz * (w2 + 0.06),
              w,
              d,
              h,
              h > 3.2 ? 3 : h > 1.6 ? 2 : 1,
              h > 1.5,
            );
          }
      } else if (r < 0.52) {
        const alongX = rand() < 0.5;
        for (let k = 0; k < 2; k++) {
          const h = heightAt(mx, mz) * 0.8 + 0.2;
          if (alongX)
            tower(
              x0 + 0.05,
              z0 + 0.06 + k * (CELL / 2),
              CELL - 0.1,
              CELL / 2 - 0.12,
              h,
              1 + (h > 2 ? 1 : 0),
              h > 1.5,
            );
          else
            tower(
              x0 + 0.06 + k * (CELL / 2),
              z0 + 0.05,
              CELL / 2 - 0.12,
              CELL - 0.1,
              h,
              1 + (h > 2 ? 1 : 0),
              h > 1.5,
            );
        }
      } else if (r < 0.68) {
        const h = heightAt(mx, mz) * 1.15 + 0.5;
        tower(
          x0 + 0.2,
          z0 + 0.2,
          CELL - 0.4,
          CELL - 0.4,
          h,
          h > 2.4 ? 3 : 2,
          true,
        );
      } else if (r < 0.82) {
        const n = 2 + ((rand() * 2) | 0);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + rand();
          const dd = n === 2 ? 0.36 : 0.32;
          const h = heightAt(mx, mz) * 0.9 + 0.3;
          cylinder(
            mx + Math.cos(a) * dd,
            mz + Math.sin(a) * dd,
            0.3 + rand() * 0.1,
            h,
            h < 1.4 && rand() < 0.6,
            h > 1.2,
          );
        }
      } else if (r < 0.92) {
        // courtyard block
        const h = 0.4 + rand() * 0.5;
        const t = 0.4;
        tower(x0 + 0.05, z0 + 0.05, CELL - 0.1, t, h, 1, false);
        tower(x0 + 0.05, z1 - 0.05 - t, CELL - 0.1, t, h, 1, false);
        tower(x0 + 0.05, z0 + 0.05 + t, t, CELL - 0.1 - 2 * t, h, 1, false);
        tower(x1 - 0.05 - t, z0 + 0.05 + t, t, CELL - 0.1 - 2 * t, h, 1, false);
        ground.circle(mx, 0.01, mz, 0.22, 16);
      } else {
        // plaza: fountain, trees, cross paths
        ground
          .circle(mx, 0.01, mz, 0.32, 24)
          .circle(mx, 0.01, mz, 0.2, 20)
          .circle(mx, 0.05, mz, 0.08, 10);
        ground.seg(x0, 0, mz, x1, 0, mz).seg(mx, 0, z0, mx, 0, z1);
        for (let k = 0; k < 7; k++) {
          const a = rand() * TAU;
          const rr = 0.45 + rand() * 0.35;
          shells
            .circle(
              mx + Math.cos(a) * rr,
              0.14,
              mz + Math.sin(a) * rr,
              0.07 + rand() * 0.04,
              8,
            )
            .seg(
              mx + Math.cos(a) * rr,
              0,
              mz + Math.sin(a) * rr,
              mx + Math.cos(a) * rr,
              0.14,
              mz + Math.sin(a) * rr,
            );
        }
      }
      if (dist < 3.2 && !anchors.core) anchors.core = [mx, 3.2, mz];
    }),
  );

  // ---------- roads ----------
  const L = (c: number) => reach(c);
  for (const c of gapMid) {
    const isAve = avenues.includes(c);
    const l = L(c);
    for (let s = -l + 0.1; s < l - 0.2; s += 0.2) {
      if (isAve) continue;
      ground.seg(c, 0, s, c, 0, s + 0.1).seg(s, 0, c, s + 0.1, 0, c);
    }
    if (isAve) {
      const half = AVENUE / 2 - 0.05;
      for (const o of [-half, half])
        roads
          .seg(c + o, 0, -L(c + o), c + o, 0, L(c + o))
          .seg(-L(c + o), 0, c + o, L(c + o), 0, c + o);
      for (const o of [-0.03, 0.03])
        ground.seg(c + o, 0, -l, c + o, 0, l).seg(-l, 0, c + o, l, 0, c + o);
    }
  }
  // ring road, concentric edges, bearing ticks
  roads
    .circle(0, 0, 0, RING - 0.16, 160)
    .circle(0, 0, 0, RING + 0.16, 160)
    .circle(0, 0, 0, R, 160);
  ground.circle(0, 0, 0, RING, 160).circle(0, 0, 0, R + 0.25, 128);
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * TAU;
    ground.seg(
      Math.cos(a) * R,
      0,
      Math.sin(a) * R,
      Math.cos(a) * (R + (i % 10 === 0 ? 0.5 : 0.2)),
      0,
      Math.sin(a) * (R + (i % 10 === 0 ? 0.5 : 0.2)),
    );
  }
  for (let r = 2; r < RING - 1; r += 2) ground.circle(0, 0, 0, r, 96);

  // ---------- elevated highways over the avenues (they cross at an interchange) ----------
  const hw = [
    { c: avenues[0], y: 0.95, alongZ: true },
    { c: avenues[1], y: 1.3, alongZ: false },
  ];
  for (const h of hw) {
    const l = L(h.c) - 0.15;
    const P = (u: number, y: number, o: number): [number, number, number] =>
      h.alongZ ? [h.c + o, y, u] : [u, y, h.c + o];
    for (const o of [-0.15, 0.15]) {
      const [a0, a1, a2] = P(-l, h.y, o);
      const [b0, b1, b2] = P(l, h.y, o);
      hwThick.seg(a0, a1, a2, b0, b1, b2);
    }
    for (let u = -l; u <= l; u += 0.16) {
      const a = P(u, h.y, -0.15);
      const b = P(u, h.y, 0.15);
      hwThin.seg(a[0], a[1], a[2], b[0], b[1], b[2]);
      if (Math.round((u + l) / 0.16) % 8 === 0) {
        const c = P(u, 0, 0);
        const e = P(u, h.y, 0);
        hwThin.seg(c[0], c[1], c[2], e[0], e[1], e[2]);
        const f = P(u, h.y - 0.08, -0.15);
        const g = P(u, h.y - 0.08, 0.15);
        hwThin
          .seg(f[0], f[1], f[2], g[0], g[1], g[2])
          .seg(f[0], f[1], f[2], c[0], c[1], c[2])
          .seg(g[0], g[1], g[2], c[0], c[1], c[2]);
      }
    }
    // an off-ramp curling down to street level
    const n = 14;
    const ramp = (s: number) => {
      let prev: [number, number, number] | null = null;
      for (let k = 0; k <= n; k++) {
        const q = k / n;
        const p = P(
          s * (l - 0.2 - q * 1.6),
          h.y * (1 - q * q),
          s * 0.15 + s * q * 0.35,
        );
        if (prev) hwThick.seg(prev[0], prev[1], prev[2], p[0], p[1], p[2]);
        prev = p;
      }
    };
    ramp(1);
    ramp(-1);
  }

  // ---------- target building ----------
  const t = targetLot;
  const door = new Group();
  door.position.set(t.x + t.w / 2, t.h / 2, t.z + t.d / 2);
  root.add(door);
  const hx = t.w / 2;
  const hd = t.d / 2;
  const hh = t.h / 2;
  const shellT = new Lines().box(-hx, -hh, -hd, t.w, t.h, t.d);
  for (let k = 1; k < 4; k++)
    shellT.seg(-hx + (t.w * k) / 4, -hh, hd, -hx + (t.w * k) / 4, hh, hd);
  door.add(new LineSegments(shellT.geometry(), targetMaterial(fade, glow)));
  const tFloors = new Lines();
  for (let y = -hh + 0.17; y < hh - 0.05; y += 0.17)
    tFloors.rect(-hx, y, -hd, hx, hd);
  door.add(new LineSegments(tFloors.geometry(), lineMaterial(fade, ICE, 0.4)));
  // the lit window: framed, mullioned, with panes glowing inside
  const wz = hd + 0.012;
  const win = new Lines()
    .box(-0.19, 0.03, wz, 0.38, 0.42, 0)
    .seg(0, 0.03, wz, 0, 0.45, wz)
    .seg(-0.19, 0.24, wz, 0.19, 0.24, wz)
    .seg(-0.26, -0.02, wz, -0.26, 0.5, wz)
    .seg(0.26, -0.02, wz, 0.26, 0.5, wz);
  for (let k = 0; k < 7; k++)
    win.seg(-0.17, 0.06 + k * 0.058, wz, 0.17, 0.06 + k * 0.058, wz);
  door.add(new LineSegments(win.geometry(), targetMaterial(fade, glow)));
  const base = new Lines()
    .circle(0, -hh, 0, 0.8, 40)
    .circle(0, -hh, 0, 0.58, 32)
    .seg(0, hh, 0, 0, hh + 1.5, 0);
  for (let k = 0; k < 8; k++)
    base
      .seg(0, hh + 0.15 + k * 0.18, 0, 0, hh + 0.2 + k * 0.18, 0)
      .circle(0, hh + 0.2 + k * 0.18, 0, 0.06, 8);
  door.add(new LineSegments(base.geometry(), targetMaterial(fade, glow)));
  anchors.target = [t.x + t.w / 2, t.h + 0.9, t.z + t.d / 2];

  // ---------- assemble static geometry ----------
  root.add(new LineSegments(ground.geometry(), lineMaterial(fade, CYAN, 0.2)));
  root.add(new LineSegments(shells.geometry(), lineMaterial(fade, ICE, 0.5)));
  root.add(new LineSegments(facade.geometry(), lineMaterial(fade, CYAN, 0.16)));
  root.add(new LineSegments(windows.geometry(), lineMaterial(fade, ICE, 0.75)));
  root.add(new LineSegments(hwThin.geometry(), lineMaterial(fade, CYAN, 0.4)));
  root.add(strokes(sil.positions(), fade, ICE, 0.9, 2));
  root.add(strokes(roads.positions(), fade, CYAN, 0.7, 1.8));
  root.add(strokes(hwThick.positions(), fade, ICE, 0.9, 2.6));

  // façade fills: boxes and cylinders, one instanced draw call each
  const m4 = new Matrix4();
  const boxFill = new InstancedMesh(
    new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5),
    fillMaterial(fade, CYAN, 0.16),
    boxes.length / 6,
  );
  for (let i = 0; i < boxes.length; i += 6)
    boxFill.setMatrixAt(
      i / 6,
      m4
        .makeScale(boxes[i + 3], boxes[i + 4], boxes[i + 5])
        .setPosition(boxes[i], boxes[i + 1], boxes[i + 2]),
    );
  boxFill.userData.noSample = true;
  root.add(boxFill);
  const cylFill = new InstancedMesh(
    new CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0),
    fillMaterial(fade, CYAN, 0.16),
    Math.max(1, cyls.length / 4),
  );
  for (let i = 0; i < cyls.length; i += 4)
    cylFill.setMatrixAt(
      i / 4,
      m4
        .makeScale(cyls[i + 2], cyls[i + 3], cyls[i + 2])
        .setPosition(cyls[i], 0, cyls[i + 1]),
    );
  cylFill.count = cyls.length / 4;
  cylFill.userData.noSample = true;
  root.add(cylFill);

  // ---------- traffic: light streams computed on the GPU ----------
  type Car = [number, number, number, number, number, number, number, number]; // x0,y,z0,len,dx,dz,speed,phase
  const cars: Car[] = [];
  const trail = 3;
  const lane = (
    x0: number,
    y: number,
    z0: number,
    len: number,
    dx: number,
    dz: number,
    n: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const sp = (0.5 + rand() * 0.5) / len;
      const ph = rand();
      for (let k = 0; k < trail; k++)
        cars.push([x0, y, z0, len, dx, dz, sp, ph - (k * 0.1) / len]);
    }
  };
  const perLane = Math.max(1, Math.round(3 * detail));
  for (const c of gapMid) {
    const l = L(c) * 2 - 0.3;
    const isAve = avenues.includes(c);
    const n = isAve ? perLane * 2 : perLane;
    for (const o of isAve ? [-0.2, -0.1, 0.1, 0.2] : [-0.07, 0.07]) {
      const sgn = o < 0 ? 1 : -1;
      lane(c + o, 0.02, sgn > 0 ? -l / 2 : l / 2, l, 0, sgn, n);
      lane(sgn > 0 ? -l / 2 : l / 2, 0.02, c + o, l, sgn, 0, n);
    }
  }
  for (const h of hw) {
    const l = L(h.c) * 2 - 0.4;
    for (const o of [-0.08, 0.08]) {
      const sgn = o < 0 ? 1 : -1;
      if (h.alongZ)
        lane(
          h.c + o,
          h.y + 0.02,
          sgn > 0 ? -l / 2 : l / 2,
          l,
          0,
          sgn,
          perLane * 3,
        );
      else
        lane(
          sgn > 0 ? -l / 2 : l / 2,
          h.y + 0.02,
          h.c + o,
          l,
          sgn,
          0,
          perLane * 3,
        );
    }
  }
  const carA = new Float32Array(cars.length * 4);
  const carB = new Float32Array(cars.length * 4);
  cars.forEach((c, i) => {
    carA.set([c[0], c[1], c[2], c[3]], i * 4);
    carB.set([c[4], c[5], c[6], c[7]], i * 4);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attr4 = (a: Float32Array): any =>
    instancedBufferAttribute(new InstancedBufferAttribute(a, 4), "vec4");
  const A = attr4(carA);
  const B = attr4(carB);
  const along = fract(B.w.add(time.mul(B.z))).mul(A.w);
  const sparkle = (m: PointsNodeMaterial, size: number) => {
    const seed = hash(instanceIndex);
    m.sizeNode = float(size).add(seed.mul(1.2));
    m.colorNode = mix(color(ICE), color(AMBER), step(0.78, seed).mul(0.8));
    m.opacityNode = smoothstep(0.5, 0.05, length(uv().sub(0.5)))
      .mul(0.85)
      .mul(fade);
    return m;
  };
  const traffic = new Sprite(
    sparkle(
      Object.assign(
        new PointsNodeMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          sizeAttenuation: false,
        }),
        {
          positionNode: vec3(
            A.x.add(B.x.mul(along)),
            A.y,
            A.z.add(B.y.mul(along)),
          ),
        },
      ),
      1.8,
    ),
  );
  traffic.count = cars.length;
  traffic.frustumCulled = false;
  root.add(traffic);

  // ring road traffic: angle driven by time
  const ringN = Math.round(8 * detail) * trail * 2;
  const ringA = new Float32Array(ringN * 4);
  for (let i = 0; i < ringN; i++) {
    const lane2 = (i / trail) % 2;
    const car = Math.floor(i / trail);
    const k = i % trail;
    const dir = lane2 === 0 ? 1 : -1;
    const rr = RING + (lane2 === 0 ? -0.08 : 0.08);
    ringA.set(
      [
        rr,
        0.02,
        (dir * (0.55 + (car % 3) * 0.12)) / rr,
        car * 0.77 - (k * 0.1 * dir) / rr,
      ],
      i * 4,
    );
  }
  const RA = attr4(ringA);
  const ang = RA.w.add(time.mul(RA.z));
  const rc = cos(ang).mul(RA.x) as unknown as typeof RA;
  const rs = sin(ang).mul(RA.x) as unknown as typeof RA;
  const ringTraffic = new Sprite(
    sparkle(
      Object.assign(
        new PointsNodeMaterial({
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          sizeAttenuation: false,
        }),
        { positionNode: vec3(rc, RA.y, rs) },
      ),
      1.8,
    ),
  );
  ringTraffic.count = ringN;
  ringTraffic.frustumCulled = false;
  root.add(ringTraffic);

  // aircraft warning lights on masts: slow blink
  const bp = new Float32Array(beacons);
  const blink = new Sprite(
    Object.assign(
      new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: false,
      }),
      {
        positionNode: instancedBufferAttribute(
          new InstancedBufferAttribute(bp, 3),
          "vec3",
        ),
        sizeNode: float(4.5),
        colorNode: color(ICE),
        opacityNode: smoothstep(0.5, 0.05, length(uv().sub(0.5)))
          .mul(
            pow(
              sin(time.mul(2.1).add(hash(instanceIndex).mul(30)))
                .mul(0.5)
                .add(0.5),
              3,
            ),
          )
          .mul(fade),
      },
    ),
  );
  blink.count = bp.length / 3;
  blink.frustumCulled = false;
  blink.userData.points = bp;
  root.add(blink);

  // ---------- radar sweep over the whole city ----------
  const radar = new Group();
  radar.position.y = 0.03;
  root.add(radar);
  const wedge = new Mesh(
    new CircleGeometry(R, 48, 0, 1.1),
    (() => {
      const mat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      const a = atan(positionGeometry.y, positionGeometry.x).div(1.1);
      mat.colorNode = color(CYAN);
      mat.opacityNode = pow(a, 3)
        .mul(0.22)
        .mul(smoothstep(0.0, 0.3, length(positionGeometry.xy).div(R)))
        .mul(fade);
      return mat;
    })(),
  );
  wedge.rotation.x = -Math.PI / 2;
  wedge.userData.noSample = true;
  radar.add(wedge);
  const edge = new LineSegments(
    new Lines()
      .seg(0, 0, 0, Math.cos(1.1) * R, 0, -Math.sin(1.1) * R)
      .geometry(),
    lineMaterial(fade, ICE, 0.5),
  );
  radar.add(edge);

  // ---------- HUD callouts ----------
  const labels: NonNullable<Layer["labels"]> = [];
  const pin = (
    key: string,
    pt: string,
    en: string,
    fallback?: [number, number, number],
  ) => {
    const p = anchors[key] ?? fallback;
    if (!p) return;
    const o = new Object3D();
    o.position.set(p[0], p[1], p[2]);
    root.add(o);
    labels.push({ object: o, pt, en });
  };
  pin("target", "ANOMALIA · SINAL FRACO", "ANOMALY · FAINT SIGNAL");
  pin("spire", "TORRE CENTRAL · 312 M", "CENTRAL TOWER · 312 M");
  pin("core", "SETOR 7 · DENSIDADE 94%", "SECTOR 7 · DENSITY 94%");
  pin("arena", "ARENA · OCUPAÇÃO 61%", "ARENA · OCCUPANCY 61%");
  pin("twin", "PONTE AÉREA · FLUXO 1,2K/MIN", "SKYBRIDGE · FLOW 1.2K/MIN");

  const sweepSpeed = ctx.reducedMotion ? 0.05 : 0.45;
  return {
    id: "city",
    exposure: 0.5,
    root,
    fade,
    glow,
    radius: R,
    view: {
      distance: 18,
      minDistance: 6,
      maxDistance: 27,
      pitch: 0.55,
      height: 0.9,
    },
    target: { object: door, radius: 1.1 },
    labels,
    update(_t, dt) {
      radar.rotation.y += dt * sweepSpeed;
    },
  };
}
