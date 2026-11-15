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
  it('on phones, keeps the compass and minimap clear of the button row and the gauges', () => {
    const at = css.indexOf('@media (max-width: 700px)');
    expect(at).toBeGreaterThan(-1);
    const phone = css.slice(at, css.indexOf('\n}', at));
    const top = (sel: string) => Number(phone.match(new RegExp(`\\${sel}\\s*\\{[^}]*top:\\s*calc\\((\\d+)px`))?.[1]);
    // One row of 36px buttons from 8px; two gauges in a column end near 130px.
    expect(top('.ev-rover-map')).toBeGreaterThanOrEqual(8 + 36 + 8);
    expect(top('.ev-rover-compass-box')).toBeGreaterThanOrEqual(136);
    expect(phone).toMatch(/\.ev-rover-hud\s*\{[^}]*flex-direction:\s*column/);
    expect(phone).toMatch(/\.ev-rover-buttons \.ev-rover-key\s*\{\s*display:\s*none/);
  });
  it('keeps Start driving on screen: the start card buttons stick to the bottom while it scrolls', () => {
    expect(css).toMatch(/\.ev-rover-start > \.actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/);
  });
  it('only animates when motion is allowed (system setting and game setting)', () => {
    const gate = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(gate).toBeGreaterThan(-1);
    for (const m of css.matchAll(/animation:[^;]+;/g)) expect(m.index!).toBeGreaterThan(gate);
    expect(css.slice(gate)).toContain('html:not(.reduce-motion)');
  });
});
