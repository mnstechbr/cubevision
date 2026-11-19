import type { Vector3 } from 'three/webgpu';
import mark from './mark.json';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * World-space points tracing the MNS Tech mark (">_ mns.tech", see brand/) on a plane
 * (center, right, up), `width` world units wide. Points are spread along the strokes by length,
 * so the particles draw the mark the way it is drawn: as lines.
 */
export function markPoints(count: number, center: Vector3, right: Vector3, up: Vector3, width: number, out: Float32Array) {
  // Path geometry needs a live SVG element; it is removed right after.
  const host = document.createElementNS(SVG, 'svg');
  host.setAttribute('width', '0');
  host.setAttribute('height', '0');
  host.style.position = 'absolute';
  document.body.append(host);
  const strokes = mark.paths.map(({ x, d }) => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    host.append(p);
    return { x, p, len: p.getTotalLength() };
  });
  const [dx, dy, dr] = mark.dot;
  const dotLen = Math.PI * 2 * dr;
  const total = strokes.reduce((s, k) => s + k.len, 0) + dotLen;
  const scale = width / mark.width;
  const midY = (mark.top + mark.bottom) / 2;

  for (let i = 0; i < count; i++) {
    let along = Math.random() * total;
    let px = dx;
    let py = dy;
    const hit = strokes.find((k) => (along -= k.len) < 0);
    if (hit) {
      const q = hit.p.getPointAtLength(hit.len + along);
      px = q.x + hit.x;
      py = q.y;
    } else {
      const a = Math.random() * Math.PI * 2;
      px = dx + Math.cos(a) * dr * Math.random();
      py = dy + Math.sin(a) * dr * Math.random();
    }
    // A little thickness, like the stroke itself.
    px += (Math.random() - 0.5) * 0.9;
    py += (Math.random() - 0.5) * 0.9;
    const u = (px - mark.width / 2) * scale;
    const v = (midY - py) * scale;
    out[i * 3] = center.x + right.x * u + up.x * v;
    out[i * 3 + 1] = center.y + right.y * u + up.y * v;
    out[i * 3 + 2] = center.z + right.z * u + up.z * v;
  }
  host.remove();
}
