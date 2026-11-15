// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Outpost Architect: share codes round-trip every part, turn and flag design, and garbage is rejected.
import { describe, it, expect } from 'vitest';
import { codeFromSearch, decodeLayout, encodeLayout, shareLink, MAX_CODE } from './share';
import { Editor, emptyLayout, type Layout } from './layout';
import { autoLayout } from './fixtures.test-util';

const strip = (l: Layout) => ({ site: l.site, parts: l.parts.map(({ part, x, z, rot, style }) => ({ part, x, z, rot, style })) });

describe('share codes', () => {
  it('round-trips a base with every site, turns and flag designs', () => {
    for (const site of ['gale', 'arcadia', 'moon'] as const) {
      const l = autoLayout(site, { habitat: 2, o2: 1, greenhouse: 1, heater: 1, solar: 8, battery: 2, shelter: 1, rocket: 1, path: 3 });
      const ed = new Editor(l);
      const f = ed.place('flag', 13, 13, 0, undefined, 4);
      expect('uid' in f).toBe(true);
      const code = encodeLayout(ed.layout);
      expect(code).toMatch(/^[0-9a-z]+$/);
      const back = decodeLayout(code)!;
      expect(back).not.toBeNull();
      expect(strip(back)).toEqual(strip(ed.layout));
    }
  });

  it('is short: about 4 characters per part', () => {
    const l = autoLayout('gale', { habitat: 2, solar: 10 });
    expect(encodeLayout(l).length).toBe(3 + 4 * 12);
    expect(encodeLayout(emptyLayout('moon'))).toHaveLength(3);
  });

  it('accepts upper case and spaces around the code', () => {
    const code = encodeLayout(autoLayout('moon', { habitat: 1, solar: 3 }));
    expect(decodeLayout(`  ${code.toUpperCase()} `)?.site).toBe('moon');
  });

  it('rejects garbage', () => {
    const good = encodeLayout(autoLayout('gale', { habitat: 2, solar: 4 }));
    const bad = [
      '',
      'x',
      '1g',
      '<script>',
      'hello world',
      '2g0000x',
      '1z0000x',
      good.slice(0, -1) + (good.at(-1) === 'a' ? 'b' : 'a'),
      good.slice(0, -2) + good.at(-1),
      'a'.repeat(MAX_CODE + 1),
      null,
      undefined,
      42,
      { site: 'gale' },
    ];
    for (const b of bad) expect(decodeLayout(b), String(b)).toBeNull();
  });

  it('drops parts that overlap, even with a valid check character', () => {
    // Hand-build a code with two habitats on the same squares (same check function as the encoder).
    const l = autoLayout('gale', { habitat: 1 });
    const twice: Layout = { site: 'gale', parts: [l.parts[0], { ...l.parts[0], uid: 99 }] };
    const back = decodeLayout(encodeLayout(twice));
    expect(back?.parts).toHaveLength(1);
  });

  it('makes a link to the live game and reads it back', () => {
    const l = autoLayout('arcadia', { habitat: 1 });
    const link = shareLink(l);
    expect(link.startsWith('https://playescapevelocity.com/?base=')).toBe(true);
    const code = codeFromSearch(new URL(link).search);
    expect(decodeLayout(code)?.site).toBe('arcadia');
    expect(codeFromSearch('?demo')).toBeNull();
    expect(codeFromSearch(`?base=${'z'.repeat(5000)}`)).toBeNull();
  });
});
