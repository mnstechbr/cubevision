import './style.css';
import { Dive, type DiveHost } from './engine/dive';
import { createDust } from './engine/dust';
import { createWarp } from './engine/warp';
import { updateCallouts } from './hud';
import { holo } from './engine/holo';
import { ORDER, loadLayer, nextOf, type Layer, type LayerId } from './engine/layers';
import { Orbit } from './engine/orbit';
import { Particles } from './engine/particles';
import { createGovernor, createStage } from './engine/stage';
import { textPoints } from './engine/text';
import { Vector3 } from 'three/webgpu';
import { i18n } from './i18n';
import { tracker as trackerInfo, type HandsSession } from './input/hands';
import { metrics as handMetrics, zooming } from './input/gestures';
import { attachPointer, type Intents } from './input/pointer';
import { ui } from './ui';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchFirst = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
const canCamera = !touchFirst && !!navigator.mediaDevices?.getUserMedia;
const requested = params.get('layer') as LayerId | null;
const startId: LayerId = requested && ORDER.includes(requested) ? requested : 'table';

const DETAIL = [1, 0.8, 0.6, 0.45];

// Shader warm-up must never block the experience (it can stall while the tab isn't painting).
const atMost = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
const PARTICLES = [1, 0.7, 0.45, 0.3];

async function boot() {
  ui.applyTexts();
  i18n.onChange(ui.applyTexts);
  const canvas = ui.$<HTMLCanvasElement>('#scene');
  ui.progress(0.08);

  let stage: Awaited<ReturnType<typeof createStage>>;
  try {
    stage = await createStage(canvas, reducedMotion);
  } catch (e) {
    console.error(e);
    ui.fatal('WebGPU / WebGL2 unavailable');
    return;
  }
  ui.progress(0.3);
  holo.flicker.value = reducedMotion ? 0 : 1;
  const { scene, camera, renderer, pipeline } = stage;
  stage.resize();
  addEventListener('resize', stage.resize);

  const particles = new Particles(30000);
  scene.add(particles.object);
  const orbit = new Orbit(camera, reducedMotion);
  const dust = createDust(touchFirst ? 300 : 900);
  scene.add(dust.object);
  const warp = createWarp(touchFirst ? 250 : 500);
  scene.add(warp.object);
  const governor = createGovernor(
    (level) => {
      stage.setQuality(level);
      particles.setCount(Math.round(particles.max * PARTICLES[level]));
    },
    params.has('q') ? Number(params.get('q')) : touchFirst ? 2 : 0,
  );
  if (params.has('q')) governor.tick = () => {}; // debug: pin the quality level
  const ctx = () => ({ detail: DETAIL[governor.level], reducedMotion });

  const first = await loadLayer(startId, ctx());
  ui.progress(0.65);
  scene.add(first.root);
  orbit.apply(first.view, true);
  first.fade.value = 0.18;
  await atMost(renderer.compileAsync(scene, camera), 4000);
  ui.progress(1);

  // Streaming: only the current world and the next one live in memory.
  let next: Layer | null = null;
  let loops = 0;
  const preload = (id: LayerId) => {
    next = null;
    loadLayer(id, ctx())
      .then(async (layer) => {
        await atMost(renderer.compileAsync(layer.root, camera, scene), 6000); // no shader hitch mid-dive
        next = layer;
      })
      .catch((e) => console.error('layer load failed', id, e));
  };

  let findHint = 0;
  let started = false;
  const host: DiveHost = {
    scene,
    camera,
    orbit,
    particles,
    current: first,
    reducedMotion,
    next: () => next,
    arrived(layer) {
      next = null;
      if (hands) ui.hint(null);
      ui.layer(layer.id);
      if (layer.id === 'table') {
        loops++;
        setTimeout(showReveal, 600);
      }
      findHint = 0;
      preload(nextOf(layer.id));
    },
  };
  const dive = new Dive(host);
  if (debug) Object.assign(window, { cv: { dive, orbit, host, stage, intents: () => intents } });

  let hovered = false;
  let hands: HandsSession | null = null;
  const AIM = 0.3; // how close to the reticle the spot must be (screen-height units)
  const intents: Intents = {
    rotate: (a, b) => orbit.rotate(a, b),
    zoom: (f) => dive.zoom(f, AIM),
    hover(x, y) {
      hovered = !dive.busy && dive.hits(x, y);
      canvas.classList.toggle('on-target', hovered);
      return hovered;
    },
    select(x, y) {
      if (!dive.busy && dive.hits(x, y)) dive.start();
    },
    activate: () => dive.start(),
    fling: (y, p) => orbit.fling(y, p),
  };

  // The ending (each time the loop closes): the workshop becomes the signature, then itself again.
  const revealEl = ui.$('#reveal');
  function showReveal() {
    if (dive.state !== 'idle') return;
    const pts = new Float32Array(particles.max * 3);
    const center = new Vector3(0, host.current.view.height + 0.6, 0);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    textPoints('MNS TECH', particles.max, center, right, up, 5.2, pts);
    dive.reveal(pts, () => {
      revealEl.hidden = false;
      setTimeout(() => (revealEl.hidden = true), 9000);
    });
  }

  // Frame loop. Allocation-free; pauses with the tab.
  const fpsEl = ui.$('#fps');
  const reticle = ui.$('#reticle');
  const guide = ui.$('#hand-guide');
  const zoomInd = ui.$('#zoom-ind');
  fpsEl.hidden = !debug;
  let last = performance.now();
  let fpsAcc = 0;
  let fpsFrames = 0;
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = now / 1000;
    governor.tick(dt);
    orbit.update(dt);
    dust.scale.value = orbit.now.distance;
    dive.update(dt);
    const cur = host.current;
    // Streaks peak between worlds: rising while the target dissolves, fading as the next world forms.
    const pr = particles.progress.value;
    const w = dive.state === 'dissolve' ? pr : dive.state === 'wait' ? 1 : dive.state === 'reform' ? 1 - pr * pr : 0;
    warp.amount.value = reducedMotion ? w * 0.3 : w;
    warp.object.visible = w > 0.01;
    if (warp.object.visible) {
      warp.object.position.copy(camera.position);
      warp.object.quaternion.copy(camera.quaternion);
      warp.object.scale.setScalar(orbit.now.distance * 0.5);
    }
    // Exposure follows whichever world fills the screen (the incoming one once it takes over).
    const lit = dive.state === 'reform' && pr > 0.5 && next ? (next.exposure ?? 1) : (cur.exposure ?? 1);
    stage.exposure.value += (lit - stage.exposure.value) * Math.min(1, dt * 2.5);
    holo.fogNear.value = orbit.now.distance * 1.2;
    holo.fogFar.value = orbit.now.distance * 3.6;
    // A band of brighter light sweeps up through the world every few seconds.
    holo.sweepY.value = orbit.now.target.y - cur.radius * 0.6 + ((t * 0.35) % 3) * cur.radius * 0.6;
    holo.sweepWidth.value = cur.radius * 0.04;
    updateCallouts(cur, camera, started && dive.state === 'idle' && cur.fade.value > 0.95);
    if (hands) {
      // Say out loud what the hand is doing to the camera.
      const recent = performance.now() - zooming.at < 400 && dive.state === 'idle';
      const atLimit = zooming.dir > 0 && orbit.goal.distance <= orbit.minDistance * 1.02;
      const show = recent || dive.atEntry;
      zoomInd.classList.toggle('on', show);
      if (show) zoomInd.textContent = dive.atEntry ? i18n.t.zoomEnter : atLimit ? i18n.t.zoomLimit : zooming.dir > 0 ? i18n.t.zoomIn : i18n.t.zoomOut;
      const aimed = dive.state === 'idle' && dive.hits(0, 0, AIM);
      reticle.classList.toggle('aimed', aimed);
      const span = Math.max(1e-3, cur.view.distance - orbit.minDistance);
      reticle.style.setProperty('--p', aimed ? Math.min(1, Math.max(0, (cur.view.distance - orbit.goal.distance) / span)).toFixed(3) : '0');
    }
    if (dive.state === 'idle') cur.glow.value += ((hovered ? 0.75 : 0) - cur.glow.value) * Math.min(1, dt * 6);
    cur.update(t, dt);
    if (next && next.root.parent) next.update(t, dt);
    pipeline.render();

    if (started && cur.id === 'table' && loops === 0 && dive.state === 'idle') {
      findHint += dt;
      if (findHint > 14 && findHint - dt <= 14) ui.hint('hintFind', 7000);
    }
    if (debug) {
      fpsAcc += dt;
      fpsFrames++;
      if (fpsAcc > 0.5) {
        const info = renderer.info.render;
        fpsEl.textContent = `${Math.round(fpsFrames / fpsAcc)} fps · q${governor.level} · ${info.drawCalls} draws · ${cur.id} · ${dive.state}${hands ? `\n${trackerInfo.text}\n${handMetrics.text}` : ''}`;
        fpsAcc = 0;
        fpsFrames = 0;
      }
    }
  };
  renderer.setAnimationLoop(frame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
      hands?.pause();
    } else {
      last = performance.now();
      renderer.setAnimationLoop(frame);
      hands?.resume();
    }
  });

  ui.layer(first.id);
  ui.bootDone();

  // Entry: hands or mouse/touch. The scene is already alive (dim) behind it.
  const entry = ui.$('#entry');
  const goCamera = ui.$<HTMLButtonElement>('#go-camera');
  const goMouse = ui.$<HTMLButtonElement>('#go-mouse');
  const camToggle = ui.$<HTMLButtonElement>('#cam-toggle');
  if (!canCamera) {
    goCamera.hidden = true;
    goMouse.dataset.t = touchFirst ? 'useTouch' : 'useMouse';
    goMouse.classList.add('primary');
    ui.applyTexts();
  }
  entry.hidden = false;
  (canCamera ? goCamera : goMouse).focus();

  const pointerHint = () => ui.hint(touchFirst ? 'hintTouch' : 'hintMouse');
  const begin = (withCamera: boolean) => {
    if (started) return;
    started = true;
    entry.hidden = true;
    attachPointer(canvas, intents);
    canvas.focus();
    dive.intro();
    preload(nextOf(first.id));
    if (withCamera) void startCamera();
    else pointerHint();
    if (import.meta.env.PROD) setTimeout(loadAnalytics, 4000);
  };
  goCamera.addEventListener('click', () => begin(true));
  goMouse.addEventListener('click', () => begin(false));

  async function startCamera() {
    ui.toast(i18n.t.loadingHands, 0);
    try {
      const { startHands } = await import('./input/hands');
      hands = await startHands({
        video: ui.$<HTMLVideoElement>('#cam'),
        skeleton: ui.$<HTMLCanvasElement>('#cam-skeleton'),
        onDistance: (d) => ui.toast(d === 'close' ? i18n.t.handClose : i18n.t.handFar, 3000),
        intents,
        onCursors: (c) => {
          ui.cursors(c);
          guide.dataset.state = c.length === 0 ? 'none' : c[0].pinch ? 'grab' : 'open';
        },
        onProgress: (p) => ui.toast(`${i18n.t.loadingHands} ${Math.round(p * 100)}%`, 0),
      });
      ui.toast('', 1);
      ui.hint('hintHands', 0); // stays until the first dive
      camToggle.hidden = false;
      setCamLabel(true);
      reticle.classList.add('on');
      guide.hidden = false;
      guide.dataset.state = 'none';
      if (params.has('gravar')) addRecordButton();
    } catch (e) {
      console.warn('hands unavailable', e);
      hands = null;
      ui.toast(i18n.t.camDenied);
      pointerHint();
    }
  }

  // ?gravar: a button that saves the recorded hand points as a file, to calibrate the gestures.
  function addRecordButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = i18n.lang === 'pt' ? 'Salvar gravação' : 'Save recording';
    b.addEventListener('click', () => {
      const json = hands?.recording();
      if (!json) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'cubevision-maos.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    camToggle.after(b);
  }

  function setCamLabel(on: boolean) {
    camToggle.textContent = on ? i18n.t.cameraOff : i18n.t.cameraOn;
    camToggle.setAttribute('aria-pressed', String(on));
  }
  camToggle.addEventListener('click', () => {
    if (hands) {
      hands.stop();
      hands = null;
      reticle.classList.remove('on');
      guide.hidden = true;
      ui.cursors([]);
      setCamLabel(false);
      pointerHint();
    } else {
      void startCamera();
    }
  });
  i18n.onChange(() => setCamLabel(!!hands));
  ui.$('#lang-toggle').addEventListener('click', () => i18n.toggle());
}

async function loadAnalytics() {
  const [{ inject }, { injectSpeedInsights }] = await Promise.all([
    import('@vercel/analytics'),
    import('@vercel/speed-insights'),
  ]);
  inject({ mode: 'production' });
  injectSpeedInsights();
}

void boot();
