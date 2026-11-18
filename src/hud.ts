import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Layer } from './engine/layers';
import { i18n } from './i18n';

const box = document.getElementById('callouts')!;
const v = new Vector3();
let shown: { el: HTMLElement; object: NonNullable<Layer['labels']>[number] }[] = [];
let owner: Layer | null = null;

/**
 * Holographic callouts: small labels with a leader line, pinned to parts of the current world.
 * Rebuilt when the world (or language) changes; positioned every frame.
 */
export function updateCallouts(layer: Layer, camera: PerspectiveCamera, visible: boolean) {
  if (owner !== layer) {
    owner = layer;
    box.replaceChildren();
    shown = (layer.labels ?? []).map((l, i) => {
      const el = document.createElement('div');
      el.className = 'callout';
      el.style.setProperty('--delay', `${0.4 + i * 0.35}s`);
      el.innerHTML = '<i></i><span></span>';
      el.querySelector('span')!.textContent = i18n.lang === 'pt' ? l.pt : l.en;
      box.append(el);
      return { el, object: l };
    });
  }
  box.classList.toggle('on', visible);
  if (!visible) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const { el, object } of shown) {
    object.object.getWorldPosition(v).project(camera);
    const off = v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.92;
    el.classList.toggle('off', off);
    el.classList.toggle('left', v.x > 0.35); // near the right edge the label points the other way
    if (!off) el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
  }
}

i18n.onChange(() => (owner = null));
