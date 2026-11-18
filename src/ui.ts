import { i18n } from './i18n';
import type { LayerId } from './engine/layers';
import { ORDER } from './engine/layers';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface Cursor {
  x: number; // NDC
  y: number;
  pinch: boolean;
  progress: number; // 0..1 ring fill
}

let hintKey: keyof typeof i18n.t | null = null;
let hintTimer = 0;
let toastTimer = 0;
let currentLayer: LayerId | null = null;
const cursorEls = [...document.querySelectorAll<HTMLElement>('#cursors i')];

export const ui = {
  $,

  applyTexts() {
    const t = i18n.t as unknown as Record<string, string>;
    document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
      el.textContent = t[el.dataset.t!];
    });
    const lang = $('#lang-toggle');
    lang.textContent = i18n.t.lang;
    lang.setAttribute('aria-label', i18n.t.langLabel);
    $('#privacy-link').setAttribute('href', i18n.lang === 'pt' ? '/privacidade.html' : '/privacidade.html#en');
    if (hintKey) $('#hint').textContent = i18n.t[hintKey] as string;
    if (currentLayer) ui.layer(currentLayer);
  },

  progress(p: number) {
    const pct = Math.round(p * 100);
    $('#boot-bar').style.width = `${pct}%`;
    $('#boot-pct').textContent = `${pct}%`;
  },

  bootDone() {
    const boot = $('#boot');
    boot.classList.add('done');
    setTimeout(() => (boot.hidden = true), 700);
  },

  fatal(message: string) {
    $('#boot .boot-label').textContent = message;
  },

  layer(id: LayerId) {
    currentLayer = id;
    const n = String(ORDER.indexOf(id) + 1).padStart(2, '0');
    const name = i18n.t.names[id];
    $('#layer-label').innerHTML = `${i18n.t.layer} ${n} · <b>${name}</b>`;
    $('#scene').setAttribute('aria-label', `${i18n.t.sceneLabel} ${name}`);
  },

  hint(key: keyof typeof i18n.t | null, holdMs = 9000) {
    const el = $('#hint');
    hintKey = key;
    clearTimeout(hintTimer);
    if (!key) {
      el.classList.add('fade');
      return;
    }
    el.textContent = i18n.t[key] as string;
    el.hidden = false;
    el.classList.remove('fade');
    if (holdMs > 0) hintTimer = window.setTimeout(() => el.classList.add('fade'), holdMs);
  },

  toast(text: string, holdMs = 4500) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    if (holdMs > 0) toastTimer = window.setTimeout(() => (el.hidden = true), holdMs);
  },

  cursors(list: Cursor[]) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    cursorEls.forEach((el, i) => {
      const c = list[i];
      el.classList.toggle('on', !!c);
      if (!c) return;
      el.classList.toggle('pinch', c.pinch);
      el.style.transform = `translate(${((c.x + 1) / 2) * w}px, ${((1 - c.y) / 2) * h}px)`;
      el.style.setProperty('--p', c.progress.toFixed(3));
    });
  },
};
