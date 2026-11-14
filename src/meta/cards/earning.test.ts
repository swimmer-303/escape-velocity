// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emitGame, onGame } from '../hooks';
import type { MissionState, SolReport, SpaceWeatherEvent } from '../../sim/types';
import { may2024Pool } from '../../data/donki';
import { RARITY_XP, SET_BONUS_XP, SPECIAL_BONUS_XP } from './rarity';
import { loadCollection, parseCollection, saveCollection, STORAGE_KEY, emptyCollection } from './store';
import './index';

const M35: SpaceWeatherEvent = {
  id: '2026-11-05T18:20:00-FLR-001',
  kind: 'flare',
  classType: 'M3.5',
  severity: 'moderate',
  time: '2026-11-05T18:33:00.000Z',
  sourceLocation: 'N12E40',
  activeRegionNum: 14566,
  link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/49999/-1',
  origin: 'live',
};

function sol(event: SpaceWeatherEvent | null, o: { demo?: boolean; shelterCells?: number; site?: 'mars' | 'moon' } = {}) {
  const cells = o.shelterCells ?? 0;
  const report = {
    sol: 4,
    storm: event
      ? { event, fast: false, warnedBy: null, shelterCells: cells, doseUnsheltered: 30, doseTaken: cells >= 2 ? 3 : cells === 1 ? 15 : 30 }
      : undefined,
  } as unknown as SolReport;
  const mission = { config: { site: o.site ?? 'mars' } } as unknown as MissionState;
  emitGame('sol', { before: mission, after: mission, report, mode: 'quick', demo: o.demo ?? false });
}

let xp: Array<{ amount: number; reason: string }> = [];
let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  xp = [];
  stop = onGame('xp', (p) => xp.push(p));
});
afterEach(() => stop());

describe('earning Storm Cards', () => {
  it('a storm the crew faced becomes a card that keeps the event\'s own data, with XP and a toast', () => {
    sol(M35);
    const col = loadCollection();
    const c = col.cards[M35.id];
    expect(c).toMatchObject({
      id: M35.id,
      kind: 'flare',
      classType: 'M3.5',
      time: M35.time,
      region: 14566,
      location: 'N12E40',
      link: M35.link,
      origin: 'live',
      count: 1,
      shieldedCount: 0,
      fresh: true,
      sites: ['mars'],
    });
    expect(Date.parse(c.collectedAt)).not.toBeNaN();
    expect(xp).toEqual([{ amount: RARITY_XP.rare, reason: 'New Storm Card: M3.5 solar flare (Rare)' }]);
    const t = document.querySelector('.ev-toast');
    expect(t?.textContent).toContain('New Storm Card!');
    expect(t?.querySelector('.sc-mini')).not.toBeNull();
  });

  it('ignores the self-playing demo and sols without a storm', () => {
    sol(M35, { demo: true });
    sol(null);
    expect(loadCollection().cards).toEqual({});
    expect(xp).toEqual([]);
  });

  it('a duplicate counts again without more XP, and stamps Shielded when the shelter blocked it', () => {
    sol(M35);
    sol(M35, { shelterCells: 2, site: 'moon' });
    sol(M35, { shelterCells: 1 }); // half a shelter is not "shielded"
    const c = loadCollection().cards[M35.id];
    expect(c.count).toBe(3);
    expect(c.shieldedCount).toBe(1);
    expect(c.sites).toEqual(['mars', 'moon']);
    expect(xp).toHaveLength(1);
    expect(document.body.textContent).toContain('Storm Card x3');
  });

  it('rarer cards give more XP', () => {
    const [x1, , , x87, far] = may2024Pool();
    sol(x1);
    sol(x87);
    sol(far);
    expect(xp.map((x) => x.amount)).toEqual([RARITY_XP.epic, RARITY_XP.legendary, RARITY_XP.legendary + SPECIAL_BONUS_XP]);
    expect(xp[2].reason).toBe('New Storm Card: Far-side CME (Legendary)');
    expect(RARITY_XP.common).toBeLessThan(RARITY_XP.rare);
    expect(RARITY_XP.rare).toBeLessThan(RARITY_XP.epic);
    expect(RARITY_XP.epic).toBeLessThan(RARITY_XP.legendary);
  });

  it('completing the May 2024 set gives its bonus once', () => {
    const set = may2024Pool();
    for (const e of set) sol(e);
    for (const e of set) sol(e);
    const bonus = xp.filter((x) => x.amount === SET_BONUS_XP && x.reason.includes('May 2024'));
    expect(bonus).toHaveLength(1);
    expect(loadCollection().setBonus).toBe(true);
  });

  it('never makes a card from the simulator\'s made-up "what if" storm', () => {
    sol({ id: 'what-if', kind: 'flare', severity: 'major', time: '', origin: 'archive' });
    expect(loadCollection().cards).toEqual({});
  });
});

describe('the collection in storage', () => {
  it('survives a reload', () => {
    sol(M35);
    const text = localStorage.getItem(STORAGE_KEY);
    expect(parseCollection(text).cards[M35.id].classType).toBe('M3.5');
  });

  it('falls back to an empty collection for corrupt data', () => {
    for (const bad of ['not json{', '[]', 'null', '42', '{"cards": []}', '{"cards": {"a": {"id": "b", "kind": "flare", "time": "2024-05-01T00:00Z"}}}']) {
      localStorage.setItem(STORAGE_KEY, bad);
      expect(loadCollection()).toEqual(emptyCollection());
    }
    // A broken card is dropped, a good one kept, odd values fixed rather than shown.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cards: {
          bad: { id: 'bad', kind: 'comet', time: 'x' },
          ok: { id: 'ok', kind: 'flare', classType: 'X1.0', time: '2024-05-08T01:41:00Z', count: -3, shieldedCount: 9, link: 'javascript:alert(1)' },
        },
      }),
    );
    const col = loadCollection();
    expect(Object.keys(col.cards)).toEqual(['ok']);
    expect(col.cards.ok.count).toBe(1);
    expect(col.cards.ok.shieldedCount).toBe(1);
    expect(col.cards.ok.link).toBeUndefined();
  });

  it('keeps working when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadCollection()).toEqual(emptyCollection());
    expect(() => saveCollection(emptyCollection())).not.toThrow();
    expect(() => sol(M35)).not.toThrow();
    expect(xp).toHaveLength(1);
    get.mockRestore();
    set.mockRestore();
  });
});
