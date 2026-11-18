import { CylinderGeometry, Group, LineSegments, Mesh, OctahedronGeometry } from 'three/webgpu';
import { Lines, layerBase, rng } from '../engine/build';
import { AMBER, CYAN, ICE, edges, fillMaterial, lineMaterial, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

/** Gear outline in the XY plane, centered at the origin. */
function gear(lines: Lines, r: number, teeth: number, depth = 0.12, hub = 0.25) {
  const inner = r - depth;
  for (let i = 0; i < teeth; i++) {
    const step = (Math.PI * 2) / teeth;
    const a = i * step;
    const pts: [number, number][] = [
      [a, inner],
      [a + step * 0.1, r],
      [a + step * 0.45, r],
      [a + step * 0.55, inner],
      [a + step, inner],
    ];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a0, r0] = pts[k];
      const [a1, r1] = pts[k + 1];
      lines.seg(Math.cos(a0) * r0, Math.sin(a0) * r0, 0, Math.cos(a1) * r1, Math.sin(a1) * r1, 0);
    }
  }
  lines.circle(0, 0, 0, r * hub, 32, true).circle(0, 0, 0, inner * 0.82, 64, true);
  const spokes = 5 + (teeth % 3);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    lines.seg(Math.cos(a) * r * hub, Math.sin(a) * r * hub, 0, Math.cos(a) * inner * 0.82, Math.sin(a) * inner * 0.82, 0);
  }
  return lines;
}

/** [4] On that table: a giant machine. Gears turn around a core that glows. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(99);
  const frame = new Lines();
  const pipes = new Lines();

  // Housing: a tall drum with ribs, a platform, and gantries.
  const ribs = Math.round(16 + 16 * ctx.detail);
  for (let y = 0; y <= 6; y += 0.5) frame.circle(0, y, 0, y === 0 || y === 6 ? 3.4 : 3.1, 72);
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    // Leave an opening at the front so the core can be seen.
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.6) continue;
    frame.seg(Math.cos(a) * 3.1, 0.5, Math.sin(a) * 3.1, Math.cos(a) * 3.1, 5.5, Math.sin(a) * 3.1);
  }
  frame.circle(0, 0, 0, 6.5, 96).circle(0, -0.3, 0, 7, 96);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    frame.seg(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4, Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5);
  }
  for (const s of [-1, 1]) {
    frame.box(s * 5 - 0.4, 0, -0.4, 0.8, 7.2, 0.8).box(-5.4, 7.2, -0.3, 10.8, 0.25, 0.6);
    for (let y = 0.6; y < 7; y += 0.6) frame.seg(s * 5 - 0.4, y, -0.4, s * 5 + 0.4, y + 0.6, 0.4);
  }

  // Pipes: helices climbing the drum and arcs between gantries.
  for (let p = 0; p < 3; p++) {
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 4 + p * 2.1;
      const pt: [number, number, number] = [Math.cos(a) * 3.6, 0.3 + (i / 120) * 5.4, Math.sin(a) * 3.6];
      if (prev) pipes.seg(...prev, ...pt);
      prev = pt;
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = -4 + rand() * 8;
    pipes.seg(x, 6.8, -0.2, x, 6 + rand() * 0.5, -0.2);
  }

  root.add(new LineSegments(frame.geometry(), lineMaterial(fade, ICE, 0.45)));
  root.add(new LineSegments(pipes.geometry(), lineMaterial(fade, CYAN, 0.3)));
  const drum = new Mesh(new CylinderGeometry(3.1, 3.1, 5, 48, 1, true).translate(0, 3, 0), fillMaterial(fade, CYAN, 0.14));
  drum.userData.noSample = true;
  root.add(drum);

  // Gears: each its own object so it can turn; meshing pairs spin in opposite directions.
  const gears: { obj: LineSegments; speed: number }[] = [];
  const addGear = (x: number, y: number, z: number, r: number, teeth: number, speed: number, ry = 0) => {
    const g = new LineSegments(gear(new Lines(), r, teeth).geometry(), lineMaterial(fade, ICE, 0.7));
    g.position.set(x, y, z);
    g.rotation.y = ry;
    root.add(g);
    gears.push({ obj: g, speed });
  };
  addGear(-4.6, 4.2, 1.2, 1.7, 22, 0.25);
  addGear(-2.35, 5.85, 1.2, 1.0, 13, -0.42);
  addGear(4.4, 2.4, 1.2, 1.9, 24, -0.2);
  addGear(4.9, 5.3, 1.2, 1.2, 15, 0.32);
  addGear(0, 6.6, 0, 2.6, 34, 0.12, Math.PI / 2);
  addGear(-5.6, 1.4, -1.5, 1.1, 14, 0.5, 0.6);

  // Pistons pumping around the base.
  const pistons: LineSegments[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const p = new LineSegments(new Lines().box(-0.18, 0, -0.18, 0.36, 1.4, 0.36).box(-0.1, 1.4, -0.1, 0.2, 0.8, 0.2).geometry(), lineMaterial(fade, CYAN, 0.6));
    p.position.set(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6);
    root.add(p);
    pistons.push(p);
  }

  // The core, seen through the opening: rings around a crystal. The crystal is the way in.
  const core = new Group();
  core.position.set(0, 3, 0);
  root.add(core);
  const rings = new LineSegments(
    new Lines().circle(0, 0, 0, 1.3, 64, true).circle(0, 0, 0, 1.05, 64, true).circle(0, 0, 0, 1.3, 64).geometry(),
    lineMaterial(fade, AMBER, 0.35),
  );
  core.add(rings);
  const crystal = new Group();
  core.add(crystal);
  const gem = new OctahedronGeometry(0.55, 0).scale(0.7, 1.25, 0.7);
  crystal.add(edges(gem, targetMaterial(fade, glow)));
  const gemFill = new Mesh(gem, fillMaterial(fade, AMBER, 0.35));
  gemFill.userData.noSample = true;
  crystal.add(gemFill);

  return {
    id: 'machine',
    root,
    fade,
    glow,
    radius: 8,
    view: { distance: 15, minDistance: 6, maxDistance: 22, pitch: 0.22, height: 3.2 },
    target: { object: crystal, radius: 0.7 },
    update(t, dt) {
      for (const g of gears) g.obj.rotation.z += g.speed * dt;
      pistons.forEach((p, i) => (p.position.y = Math.max(0, Math.sin(t * 2.2 + i * 1.05)) * 0.35));
      rings.rotation.set(t * 0.4, t * 0.7, 0);
      crystal.rotation.y = t * 0.5;
    },
  };
}
