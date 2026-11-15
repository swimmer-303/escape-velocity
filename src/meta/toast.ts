// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Reward pop-ups shared by every meta feature: toast('+50 XP', 'Survived an X-class storm', { tone: 'gold' }).
// At most two show at once; the rest wait their turn (each one's timer starts when it appears). They never catch
// taps or clicks, so a pile of rewards can't block the results card underneath.
import './toast.css';

export type ToastTone = 'amber' | 'good' | 'cyan' | 'gold';

/** How many toasts are on screen at once. */
export const MAX_SHOWN = 2;
/** How many more can wait their turn (the oldest waiting one is dropped after that). */
export const MAX_WAITING = 6;
export const DEFAULT_MS = 3500;

export function toast(title: string, body = '', opts: { tone?: ToastTone; ms?: number; icon?: HTMLElement } = {}): HTMLElement {
  let box = document.querySelector<HTMLElement>('.ev-toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'ev-toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `ev-toast ${opts.tone && opts.tone !== 'amber' ? opts.tone : ''} wait`;
  el.dataset.ms = String(opts.ms ?? DEFAULT_MS);
  el.dataset.key = `${opts.tone ?? 'amber'}|${title}|${body}`;
  if (opts.icon) {
    opts.icon.classList.add('ev-toast-icon');
    el.append(opts.icon);
  }
  const text = document.createElement('div');
  const b = document.createElement('b');
  b.textContent = title;
  text.append(b);
  if (body) text.append(' ', body);
  el.append(text);
  // The same message already showing or waiting (a locked part tapped three times): merge, don't stack.
  const same = [...box.querySelectorAll<HTMLElement>(':scope > .ev-toast')].find((t) => t.dataset.key === el.dataset.key);
  if (same) return same;
  box.append(el);
  const waiting = [...box.querySelectorAll<HTMLElement>(':scope > .ev-toast.wait')];
  for (const old of waiting.slice(0, Math.max(0, waiting.length - MAX_WAITING))) old.remove();
  pump(box);
  return el;
}

/** Show waiting toasts while there is room. */
function pump(box: HTMLElement): void {
  let shown = box.querySelectorAll(':scope > .ev-toast:not(.wait)').length;
  for (const el of [...box.querySelectorAll<HTMLElement>(':scope > .ev-toast.wait')]) {
    if (shown >= MAX_SHOWN) break;
    el.classList.remove('wait');
    shown++;
    window.setTimeout(() => {
      const parent = el.parentElement;
      el.remove();
      if (parent?.isConnected) pump(parent);
    }, Number(el.dataset.ms) || DEFAULT_MS);
  }
}
