// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Reward toasts: at most two on screen, the rest wait their turn, and none of them catch taps.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_MS, MAX_SHOWN, MAX_WAITING, toast } from './toast';

const shown = () => [...document.querySelectorAll<HTMLElement>('.ev-toast:not(.wait)')].map((t) => t.querySelector('b')!.textContent);
const waiting = () => [...document.querySelectorAll<HTMLElement>('.ev-toast.wait')].map((t) => t.querySelector('b')!.textContent);

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows at most two at once; the rest wait their turn, oldest first', () => {
    expect(MAX_SHOWN).toBe(2);
    for (const t of ['A', 'B', 'C', 'D']) toast(t, 'body');
    expect(shown()).toEqual(['A', 'B']);
    expect(waiting()).toEqual(['C', 'D']);
    vi.advanceTimersByTime(DEFAULT_MS);
    expect(shown()).toEqual(['C', 'D']);
    expect(waiting()).toEqual([]);
    vi.advanceTimersByTime(DEFAULT_MS);
    expect(document.querySelectorAll('.ev-toast').length).toBe(0);
  });

  it('starts a waiting toast\'s timer only when it appears', () => {
    toast('A', '', { ms: 1000 });
    toast('B', '', { ms: 6000 });
    toast('C', '', { ms: 1000 });
    vi.advanceTimersByTime(1000);
    expect(shown()).toEqual(['B', 'C']);
    vi.advanceTimersByTime(999);
    expect(shown()).toEqual(['B', 'C']);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual(['B']);
  });

  it('drops the oldest waiting toast when too many pile up', () => {
    for (let i = 0; i < MAX_SHOWN + MAX_WAITING + 2; i++) toast(`T${i}`);
    expect(shown()).toEqual(['T0', 'T1']);
    expect(waiting()).toHaveLength(MAX_WAITING);
    expect(waiting()[0]).toBe('T4');
  });

  it('never catches taps, sits bottom-left on big screens and stays compact at the top on phones', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'toast.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.ev-toasts\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.ev-toast\s*\{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/pointer-events:\s*auto/);
    expect(css).toMatch(/\.ev-toasts\s*\{[^}]*bottom:/);
    expect(css).toMatch(/\.ev-toast\.wait\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*\.ev-toasts\s*\{[^}]*top:/);
  });

  it('is a polite live region and keeps the title and body as text', () => {
    const el = toast('+50 XP', 'Survived an X-class storm', { tone: 'gold' });
    const box = document.querySelector('.ev-toasts')!;
    expect(box.getAttribute('role')).toBe('status');
    expect(box.getAttribute('aria-live')).toBe('polite');
    expect(el.textContent).toBe('+50 XP Survived an X-class storm');
    expect(el.classList.contains('gold')).toBe(true);
  });
});
