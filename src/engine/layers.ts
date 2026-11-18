import type { Group, Object3D, Vector3 } from 'three/webgpu';
import type { Fade } from './holo';

/** Story order; the last one dives back into the first (the loop). */
export const ORDER = ['table', 'city', 'room', 'machine', 'crystal', 'galaxy'] as const;
export type LayerId = (typeof ORDER)[number];

export interface View {
  distance: number;
  minDistance: number;
  maxDistance: number;
  pitch: number;
  /** World Y the camera orbits around (layers are centered on X/Z). */
  height: number;
}

export interface LayerContext {
  /** 0..1 detail multiplier from the adaptive quality level. */
  detail: number;
  reducedMotion: boolean;
}

/**
 * A world. Built at unit scale around the origin, at most `radius` big.
 * The engine owns placement, fades and disposal (`disposeTree`); the layer only describes itself.
 */
export interface Layer {
  id: LayerId;
  root: Group;
  radius: number;
  view: View;
  /** Where the next world hides. Its world position and `radius` drive the dive. */
  target: {
    object: Object3D;
    radius: number;
    /** If set (local axis of `object`), the target only reacts when it faces the camera. */
    facing?: Vector3;
  };
  /** Brightness before bloom, 0..1 (default 1). Dense worlds lower it so they don't burn to white. */
  exposure?: number;
  /** HUD callouts pinned to parts of the world (shown while the world is idle). */
  labels?: { object: Object3D; pt: string; en: string }[];
  /** Multiplies every material's opacity (0..1). */
  fade: Fade;
  /** Hover/arm highlight of the target (0..1). */
  glow: Fade;
  update(time: number, dt: number): void;
}

export interface LayerModule {
  create(ctx: LayerContext): Layer;
}

// Each world is its own chunk, fetched only when it is about to be needed.
const loaders: Record<LayerId, () => Promise<LayerModule>> = {
  table: () => import('../layers/table'),
  city: () => import('../layers/city'),
  room: () => import('../layers/room'),
  machine: () => import('../layers/machine'),
  crystal: () => import('../layers/crystal'),
  galaxy: () => import('../layers/galaxy'),
};

export function nextOf(id: LayerId): LayerId {
  return ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];
}

export async function loadLayer(id: LayerId, ctx: LayerContext): Promise<Layer> {
  return (await loaders[id]()).create(ctx);
}

/** Frees GPU memory of everything under `root`. */
export function disposeTree(root: Object3D) {
  root.traverse((o) => {
    const m = o as Object3D & { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    m.geometry?.dispose();
    if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
    else m.material?.dispose();
  });
}
