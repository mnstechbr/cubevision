import { AdditiveBlending, Group, LineSegments, Mesh, PointsNodeMaterial, Sprite, Vector3, CylinderGeometry, InstancedBufferAttribute } from 'three/webgpu';
import { color, float, hash, instanceIndex, instancedBufferAttribute, length, sin, smoothstep, time, uv } from 'three/tsl';
import { Lines, layerBase, rng } from '../engine/build';
import { ICE, fillMaterial, lineMaterial, targetMaterial } from '../engine/holo';
import type { Layer, LayerContext } from '../engine/layers';

/** Hexagonal bipyramid with ring sections: a crystal in lines. */
function crystalLines(lines: Lines, r: number, h: number, sides = 6, twist = 0) {
  const tip = new Vector3(0, h, 0);
  const foot = new Vector3(0, -h * 0.55, 0);
  const ring: Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + twist;
    ring.push(new Vector3(Math.cos(a) * r, h * 0.35, Math.sin(a) * r));
  }
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % sides];
    lines.seg(p.x, p.y, p.z, q.x, q.y, q.z);
    lines.seg(p.x, p.y, p.z, tip.x, tip.y, tip.z);
    lines.seg(p.x, p.y, p.z, p.x * 0.92, -h * 0.1, p.z * 0.92);
    lines.seg(p.x * 0.92, -h * 0.1, p.z * 0.92, foot.x, foot.y, foot.z);
    const q2 = ring[(i + 1) % sides];
    lines.seg(p.x * 0.92, -h * 0.1, p.z * 0.92, q2.x * 0.92, -h * 0.1, q2.z * 0.92);
  });
  return lines;
}

/** [5] The machine's core: a crystal. Something burns at its very center. */
export function create(ctx: LayerContext): Layer {
  const { root, fade, glow } = layerBase();
  const rand = rng(5);

  // Main crystal with nested inner shells (each smaller, twisted).
  const body = new Group();
  body.position.y = 2.6;
  root.add(body);
  const shell = new Lines();
  crystalLines(shell, 1.6, 3.4);
  const inner = new Lines();
  for (let k = 1; k <= 3; k++) crystalLines(inner, 1.6 * (1 - k * 0.22), 3.4 * (1 - k * 0.22), 6, k * 0.35);
  body.add(new LineSegments(shell.geometry(), lineMaterial(fade, ICE, 1.1)));
  const innerLines = new LineSegments(inner.geometry(), lineMaterial(fade, ICE, 0.35));
  body.add(innerLines);
  const fill = new Mesh(new CylinderGeometry(1.4, 1.4, 4.6, 6, 1, true).translate(0, 0.7, 0), fillMaterial(fade, ICE, 0.16));
  fill.userData.noSample = true;
  body.add(fill);

  // Satellite crystals growing from a rocky base.
  const cluster = new Lines();
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rand() * 0.4;
    const d = 2.2 + rand() * 1.6;
    const s = 0.25 + rand() * 0.45;
    const tmp = new Lines();
    crystalLines(tmp, s, s * (2.2 + rand() * 1.5));
    const g = tmp.geometry();
    g.rotateZ((rand() - 0.5) * 0.9).rotateX((rand() - 0.5) * 0.6).translate(Math.cos(a) * d, s * 0.6, Math.sin(a) * d);
    const p = g.attributes.position.array as Float32Array;
    for (let k = 0; k < p.length; k += 6) cluster.seg(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5]);
    g.dispose();
  }
  for (let r = 1.2; r <= 5; r += 0.9) cluster.circle(0, 0, 0, r, 64);
  root.add(new LineSegments(cluster.geometry(), lineMaterial(fade, ICE, 0.45)));

  // Lattice of light inside the crystal (also a point cloud the particles can land on).
  const n = Math.round(1800 * ctx.detail);
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = -1.2 + rand() * 4.2;
    const rr = (y > 1.2 ? (3.4 - y) / 2.2 : (y + 1.9) / 3.1) * 1.3 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    pts.set([Math.cos(a) * rr, y, Math.sin(a) * rr], i * 3);
  }
  const lattice = new Sprite(
    Object.assign(new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }), {
      positionNode: instancedBufferAttribute(new InstancedBufferAttribute(pts, 3)),
      sizeNode: float(1.5).add(hash(instanceIndex).mul(1.5)),
      colorNode: color(ICE),
      opacityNode: smoothstep(0.5, 0.1, length(uv().sub(0.5)))
        .mul(sin(time.mul(1.3).add(hash(instanceIndex).mul(20))).mul(0.3).add(0.5))
        .mul(fade),
    }),
  );
  lattice.count = n;
  lattice.frustumCulled = false;
  lattice.userData.points = pts;
  body.add(lattice);

  // The spark at the center: a tiny star, ringed. The galaxy is in there.
  const spark = new Group();
  spark.position.y = 0.4;
  body.add(spark);
  const sparkLines = new Lines()
    .circle(0, 0, 0, 0.22, 32, true)
    .circle(0, 0, 0, 0.22, 32)
    .seg(-0.35, 0, 0, 0.35, 0, 0)
    .seg(0, -0.35, 0, 0, 0.35, 0)
    .seg(0, 0, -0.35, 0, 0, 0.35);
  const sparkObj = new LineSegments(sparkLines.geometry(), targetMaterial(fade, glow));
  spark.add(sparkObj);

  return {
    id: 'crystal',
    root,
    fade,
    glow,
    radius: 6,
    view: { distance: 10, minDistance: 4, maxDistance: 15, pitch: 0.18, height: 2.8 },
    target: { object: spark, radius: 0.4 },
    update(t) {
      body.rotation.y = t * 0.12;
      innerLines.rotation.y = -t * 0.2;
      sparkObj.rotation.set(t * 0.8, t * 1.1, 0);
      spark.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    },
  };
}

