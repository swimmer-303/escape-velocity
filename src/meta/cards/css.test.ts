// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('cards.css', () => {
  const css = readFileSync(fileURLToPath(new URL('./cards.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('has balanced braces', () => {
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(2);
    }
    expect(depth).toBe(0);
  });

  it('only animates (the foil shimmer) when motion is allowed, both by the system setting and the game setting', () => {
    const gate = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(gate).toBeGreaterThan(-1);
    const anims = [...css.matchAll(/animation:[^;]+;/g)];
    expect(anims.length).toBeGreaterThan(0);
    for (const m of anims) expect(m.index!).toBeGreaterThan(gate);
    expect(css.slice(gate)).toContain('html:not(.reduce-motion) .sc-foil { animation');
  });
});
