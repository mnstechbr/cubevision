/**
 * What any input can ask of the scene. Mouse, touch, keyboard and hands all speak this,
 * so the scene never knows (or cares) which one is in use.
 */
export interface Intents {
  /** Radians of yaw / pitch. */
  rotate(dYaw: number, dPitch: number): void;
  /** Multiplies camera distance (<1 = closer). */
  zoom(factor: number): void;
  /** Cursor position in NDC (-1..1). Returns whether it is on the target. */
  hover(x: number, y: number): boolean;
  /** Dive into the target, if the cursor (NDC) is on it. */
  select(x: number, y: number): void;
  /** Keyboard: dive into the current target wherever it is. */
  activate(): void;
}

const CLICK_PX = 7;
const CLICK_MS = 450;

/** Mouse, trackpad, touch (via Pointer Events) and keyboard. Returns a detach function. */
export function attachPointer(el: HTMLElement, intents: Intents) {
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let pinch = 0;

  const ndc = (e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1] as const;
  };
  const spread = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (pts.size === 2) pinch = spread();
  };
  const move = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') intents.hover(...ndc(e));
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 1) {
      intents.rotate((dx / el.clientWidth) * Math.PI * 1.4, (dy / el.clientHeight) * Math.PI * 0.8);
      intents.hover(...ndc(e));
    } else if (pts.size === 2) {
      const d = spread();
      if (pinch > 0 && d > 0) intents.zoom(pinch / d);
      pinch = d;
    }
  };
  const up = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (!p || pts.size > 0) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    if (moved < CLICK_PX && performance.now() - p.t < CLICK_MS) intents.select(...ndc(e));
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    intents.zoom(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0025));
  };
  const key = (e: KeyboardEvent) => {
    const step = 0.12;
    const map: Record<string, () => void> = {
      ArrowLeft: () => intents.rotate(-step, 0),
      ArrowRight: () => intents.rotate(step, 0),
      ArrowUp: () => intents.rotate(0, step * 0.6),
      ArrowDown: () => intents.rotate(0, -step * 0.6),
      '+': () => intents.zoom(0.88),
      '=': () => intents.zoom(0.88),
      '-': () => intents.zoom(1.14),
      Enter: () => intents.activate(),
      ' ': () => intents.activate(),
    };
    const f = map[e.key];
    if (!f) return;
    e.preventDefault();
    f();
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('keydown', key);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('keydown', key);
  };
}
