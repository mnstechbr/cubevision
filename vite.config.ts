import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// `vite preview` serves the same security headers as Vercel, so CSP breakage shows up locally.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const globalHeaders = Object.fromEntries(
  vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]),
);

export default defineConfig({
  // three.js (WebGPU + TSL) is one ~240 kB gzip chunk by nature; each world is split out.
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  worker: { format: 'es' },
  preview: { headers: globalHeaders },
});
