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
});
