// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect on small screens: the top bar wraps (never scrolls sideways, so Close is always on screen) and
// the panels stack around the measured top bar and tool row instead of fixed offsets that the tools could cover.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./builder.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first @media block whose condition contains `cond`. */
function media(cond: string): string {
  const at = css.indexOf(`@media (${cond})`);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  const open = css.indexOf('{', at);
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

describe('builder.css', () => {
  it('has balanced braces', () => {
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it('wraps the top bar on narrow screens instead of scrolling it sideways', () => {
    const narrow = media('max-width: 860px');
    const top = narrow.match(/\.evb-top\s*\{([^}]*)\}/)![1];
    expect(top).toMatch(/flex-wrap:\s*wrap/);
    expect(top).not.toMatch(/overflow-x/);
    expect(top).not.toMatch(/nowrap/);
    // Close keeps its place on the first row.
    expect(narrow).toMatch(/\.evb-close\s*\{[^}]*order:\s*1/);
  });

  it('stacks the phone panels on the measured tool row and top bar, so Turn and Done never cover the parts', () => {
    const narrow = media('max-width: 860px');
    expect(narrow).toMatch(/\.evb-palette\s*\{[^}]*bottom:\s*calc\(var\(--evb-tools-h/);
    expect(narrow).toMatch(/\.evb-readout\s*\{[^}]*var\(--evb-pal-h/);
    expect(narrow).toMatch(/\.evb-goal\s*\{[^}]*top:\s*calc\(var\(--evb-top-h/);
  });
});
