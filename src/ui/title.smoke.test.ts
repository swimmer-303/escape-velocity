// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, REPO_URL } from './app';
import { CssStage } from '../render/stage';

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  history.replaceState(null, '', '/');
});

describe('title screen', () => {
  it('shows a GitHub button with the main play buttons, opening the public repo in a new tab', () => {
    new App(new CssStage());
    const link = document.querySelector<HTMLAnchorElement>('.title-screen .menu a.btn.github');
    expect(link).not.toBeNull();
    expect(link!.href).toBe(REPO_URL);
    expect(REPO_URL).toBe('https://github.com/swimmer-303/escape-velocity');
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toContain('noopener');
    expect(link!.textContent).toBe('See the code on GitHub');
  });
});
