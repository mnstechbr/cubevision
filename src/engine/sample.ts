import { Vector3, type BufferAttribute, type Object3D } from 'three/webgpu';

const a = new Vector3();
const b = new Vector3();

/**
 * Fills `out` with `count` world-space points spread along the visible lines of `root`
 * (weighted by length), plus any point clouds that expose `userData.points` (local xyz).
 * Runs once per transition, never per frame.
 */
export function samplePoints(root: Object3D, count: number, out: Float32Array) {
  root.updateMatrixWorld(true);
  const segs: number[] = [];
  const clouds: { obj: Object3D; pts: Float32Array }[] = [];
  let cloudTotal = 0;

  root.traverseVisible((o) => {
    if (o.userData.noSample) return;
    const pts = o.userData.points as Float32Array | undefined;
    if (pts) {
      clouds.push({ obj: o, pts });
      cloudTotal += pts.length / 3;
      return;
    }
    const raw = o.userData.segments as Float32Array | undefined;
    if (raw) {
      for (let i = 0; i + 5 < raw.length; i += 6) {
        a.fromArray(raw, i).applyMatrix4(o.matrixWorld);
        b.fromArray(raw, i + 3).applyMatrix4(o.matrixWorld);
        segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      return;
    }
    if (!(o as { isLineSegments?: boolean }).isLineSegments) return;
    const geo = (o as unknown as { geometry: { attributes: { position: BufferAttribute }; index: BufferAttribute | null } }).geometry;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 1 < n; i += 2) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });

  const segCount = segs.length / 6;
  const cum = new Float32Array(segCount);
  let total = 0;
  for (let s = 0; s < segCount; s++) {
    const o = s * 6;
    total += Math.hypot(segs[o + 3] - segs[o], segs[o + 4] - segs[o + 1], segs[o + 5] - segs[o + 2]);
    cum[s] = total;
  }

  // Point clouds get a share proportional to how much of the world they are.
  const cloudShare = cloudTotal === 0 ? 0 : segCount === 0 ? 1 : Math.min(0.85, cloudTotal / (cloudTotal + segCount * 4));

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    if (Math.random() < cloudShare) {
      let r = Math.floor(Math.random() * cloudTotal);
      for (const c of clouds) {
        const n = c.pts.length / 3;
        if (r < n) {
          a.fromArray(c.pts, r * 3).applyMatrix4(c.obj.matrixWorld);
          a.toArray(out, o);
          break;
        }
        r -= n;
      }
      continue;
    }
    if (segCount === 0) {
      root.getWorldPosition(a).toArray(out, o);
      continue;
    }
    const s = upperBound(cum, Math.random() * total) * 6;
    const t = Math.random();
    out[o] = segs[s] + (segs[s + 3] - segs[s]) * t;
    out[o + 1] = segs[s + 1] + (segs[s + 4] - segs[s + 1]) * t;
    out[o + 2] = segs[s + 2] + (segs[s + 5] - segs[s + 2]) * t;
  }
}

function upperBound(arr: Float32Array, v: number) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Random points in a ball (denser at the core), for the "cloud" between two worlds. */
export function cloudPoints(center: Vector3, radius: number, count: number, out: Float32Array) {
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = radius * Math.pow(Math.random(), 0.6);
    const s = Math.sqrt(1 - u * u);
    out[i * 3] = center.x + r * s * Math.cos(th);
    out[i * 3 + 1] = center.y + r * u;
    out[i * 3 + 2] = center.z + r * s * Math.sin(th);
  }
}

const u = new Vector3();
const v = new Vector3();

/**
 * A spiral disc of light facing `normal` (toward the camera): the portal between two worlds.
 */
export function vortexPoints(center: Vector3, normal: Vector3, radius: number, count: number, out: Float32Array) {
  u.set(0, 1, 0).cross(normal);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  v.crossVectors(normal, u).normalize();
  for (let i = 0; i < count; i++) {
    const r = radius * (0.18 + 0.82 * Math.sqrt(Math.random()));
    const arm = (i % 3) * ((Math.PI * 2) / 3);
    const th = arm + (r / radius) * 4.2 + (Math.random() - 0.5) * 0.9;
    const depth = (Math.random() - 0.5) * radius * 0.25 * (1 - r / radius);
    const c = Math.cos(th) * r;
    const s = Math.sin(th) * r;
    out[i * 3] = center.x + u.x * c + v.x * s + normal.x * depth;
    out[i * 3 + 1] = center.y + u.y * c + v.y * s + normal.y * depth;
    out[i * 3 + 2] = center.z + u.z * c + v.z * s + normal.z * depth;
  }
}
