// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Guards against a merge dropping a closing brace: inside an @media block that would silently
// swallow every rule after it (the build doesn't always catch it).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('style.css', () => {
  it('has balanced braces with no rule left open', () => {
    const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let line = 1;
    for (const ch of css) {
      if (ch === '\n') line++;
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth, `extra closing brace near line ${line}`).toBeGreaterThanOrEqual(0);
      // Nothing in our CSS nests deeper than @media { rule { } }.
      expect(depth, `unclosed block before line ${line}`).toBeLessThanOrEqual(2);
    }
    expect(depth).toBe(0);
  });

  it('keeps the planning panel on screen: the right column scrolls and the Run button stays in view', () => {
    const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // The last word on these rules (later rules win), inside the desktop media block.
    const block = css.slice(css.lastIndexOf('@media (min-width: 901px)'));
    expect(block).toMatch(/\.dock-right > \.brief-mini \{[^}]*overflow-y: auto/);
    expect(block).toMatch(/\.dock-right > :last-child \{[^}]*flex: none/);
    expect(block).toMatch(/\.dock \{[^}]*max-height: calc\(100dvh - var\(--hud-h/);
  });

  it('never mixes a flexible (fr) column with auto-fit or auto-fill: CSS drops that whole rule', () => {
    const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/grid-template-columns:\s*([^;}]+)/g)) {
      const value = m[1];
      if (!/repeat\(\s*auto-(fit|fill)/.test(value)) continue;
      const outside = value.replace(/repeat\((?:[^()]|\([^()]*\))*\)/g, '');
      expect(outside, `invalid grid-template-columns: ${value}`).not.toMatch(/\d(\.\d+)?fr\b/);
    }
  });

  it('hides the stage\'s "Look at" menu while any dialog is open (it sat beside them, under the backdrop)', () => {
    const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/body:has\(> #modal-root > \.modal\) \.look-at \{ visibility: hidden; \}/);
  });
});
