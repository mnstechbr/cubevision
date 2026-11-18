import { Color, PerspectiveCamera, RenderPipeline, Scene, WebGPURenderer } from 'three/webgpu';
import { float, length, mix, pass, screenCoordinate, screenUV, sin, smoothstep, uniform, vec2, vec4 } from 'three/tsl';
import type { Fade } from './holo';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export interface Stage {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  pipeline: RenderPipeline;
  /** Scene brightness before bloom (dense worlds turn it down so they don't burn to white). */
  exposure: Fade;
  /** 0 = best … 3 = lowest. */
  setQuality(level: number): void;
  resize(): void;
}

const PIXEL_RATIO = [2, 1.5, 1, 0.75];

export async function createStage(canvas: HTMLCanvasElement, reducedMotion: boolean): Promise<Stage> {
  const renderer = new WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  await renderer.init();

  const scene = new Scene();
  scene.background = new Color(0x010409);
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);

  const scenePass = pass(scene, camera);
  const exposure = uniform(1);
  const color = scenePass.getTextureNode('output').mul(exposure);
  const glow = bloom(color, 1.15, 0.55, 0.02);
  const lit = color.add(glow);

  // Screen-space finish: faint scanlines, vignette, a breath of chromatic aberration.
  const scanlines = mix(float(1), sin(screenCoordinate.y.mul(2.2)).mul(0.5).add(0.5), 0.07);
  const vignette = smoothstep(1.05, 0.35, length(screenUV.sub(0.5)).mul(1.35));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node typings don't unify across addon nodes
  const finish = (rgb: any) => vec4(rgb.rgb.mul(scanlines).mul(vignette), 1);
  const aberration = uniform(reducedMotion ? 0 : 0.35);

  const outputs = {
    full: finish(chromaticAberration(lit, aberration, vec2(0.5, 0.5))),
    bloomOnly: finish(vec4(lit)),
    flat: finish(vec4(color)),
  };

  const pipeline = new RenderPipeline(renderer, outputs.full);
  let level = -1;

  const stage: Stage = {
    renderer,
    scene,
    camera,
    pipeline,
    exposure,
    setQuality(next) {
      if (next === level) return;
      level = next;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[level]));
      pipeline.outputNode = level === 0 ? outputs.full : level < 3 ? outputs.bloomOnly : outputs.flat;
      pipeline.needsUpdate = true;
    },
    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
  return stage;
}

/**
 * Adaptive quality: watches frame time and steps quality down when the GPU
 * can't keep up. Only goes down, so it never oscillates.
 */
export function createGovernor(onLevel: (level: number) => void, startLevel: number) {
  let level = startLevel;
  let acc = 0;
  let frames = 0;
  let warmup = 3;
  onLevel(level);
  return {
    get level() {
      return level;
    },
    tick(dt: number) {
      if (warmup > 0) {
        warmup -= dt;
        return;
      }
      acc += dt;
      frames++;
      if (acc < 2) return;
      const fps = frames / acc;
      acc = 0;
      frames = 0;
      if (fps < 48 && level < 3) {
        level++;
        warmup = 2;
        onLevel(level);
      }
    },
  };
}
