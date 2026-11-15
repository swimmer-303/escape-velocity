// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('rover.css', () => {
  const css = readFileSync(fileURLToPath(new URL('./rover.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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
  it('only animates when motion is allowed (system setting and game setting)', () => {
    const gate = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(gate).toBeGreaterThan(-1);
    for (const m of css.matchAll(/animation:[^;]+;/g)) expect(m.index!).toBeGreaterThan(gate);
    expect(css.slice(gate)).toContain('html:not(.reduce-motion)');
  });
});
