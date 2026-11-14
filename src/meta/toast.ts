// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Reward pop-ups shared by every meta feature: toast('+50 XP', 'Survived an X-class storm', { tone: 'gold' }).
import './toast.css';

export type ToastTone = 'amber' | 'good' | 'cyan' | 'gold';

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
  el.className = `ev-toast ${opts.tone && opts.tone !== 'amber' ? opts.tone : ''}`;
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
  box.append(el);
  // Never more than 4 on screen.
  while (box.children.length > 4) box.firstElementChild?.remove();
  window.setTimeout(() => el.remove(), opts.ms ?? 3500);
  return el;
}
