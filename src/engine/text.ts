import type { Vector3 } from 'three/webgpu';

/**
 * World-space points tracing `text` on a plane (center, right, up), `width` world units wide.
 * Sampled from a 2D canvas, so it uses the page's own (self-hosted) font.
 */
export function textPoints(text: string, count: number, center: Vector3, right: Vector3, up: Vector3, width: number, out: Float32Array) {
  const W = 1024;
  const H = 220;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 170px 'IBM Plex Mono', monospace`;
  g.fillText(text, W / 2, H / 2);
  const data = g.getImageData(0, 0, W, H).data;
  const lit: number[] = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 128) lit.push(x, y);
  const scale = width / W;
  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * (lit.length / 2)) * 2;
    const px = (lit[k] - W / 2 + Math.random() * 2) * scale;
    const py = (H / 2 - lit[k + 1] + Math.random() * 2) * scale;
    out[i * 3] = center.x + right.x * px + up.x * py;
    out[i * 3 + 1] = center.y + right.y * px + up.y * py;
    out[i * 3 + 2] = center.z + right.z * px + up.z * py;
  }
}
