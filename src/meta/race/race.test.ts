// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rival Race rules: deterministic rivals, scoring and tie-breaks, leagues, challenge codes, callsigns and storage.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMission } from '../../sim/sim';
import { balanced, playOut } from '../../sim/strategies';
import { missionConfigFor, newCampaign } from '../../sim/campaign';
import type { MissionState } from '../../sim/types';
import { finishRival, stepRival } from './brain';
import { ADJECTIVES, SPACE_NOUNS, callsignText, isCallsign, parseCallsignSlug, randomCallsign } from './callsign';
import { challengeUrl, decodeRun, encodeRun, ghostFromMission, poolFingerprint, raceParam, type GhostRun } from './code';
import { createRace, finishRace, isRaceMission, liveRows, newsBetween, racePool, syncRivals, type Race } from './race';
import { LEAGUES, pickRivals } from './rivals';
import { compareFinish, rankFinishes, rankLive, xpForPlace, type Finish } from './score';
import { STORAGE_KEY, applyPlace, freshSave, loadSave, progressLine, sanitize, writeSave } from './store';
import { banterFor, homeStory } from './banter';

const POOL = racePool();
const YOU = { adj: 'Brave', noun: 'Comet', num: 42 };

function missionFor(race: Race): MissionState {
  const c = newCampaign(race.seed, race.difficulty, race.site);
  return createMission(missionConfigFor(c, race.lightTimeMin, race.eventPool));
}

/** Play a whole race with the balanced player as "you"; return the standings after every sol and the results. */
function playRace(seed: string, league = 0, site: 'mars' | 'moon' = 'mars') {
  const race = createRace({ league, you: YOU, seed, site, lightTimeMin: 12.5, eventPool: POOL });
  let m = missionFor(race);
  const standings: string[][] = [];
  while (m.status === 'playing') {
    const before = m;
    const { alloc, crate } = balanced(m);
    m = playOut(m, () => ({ alloc, crate }), 1);
    syncRivals(race, m);
    standings.push(liveRows(race, m).map((r) => `${r.place}:${r.id}:${Math.floor(r.fuel)}:${r.status}`));
    void before;
  }
  return { race, standings, results: finishRace(race, m), end: m };
}

describe('rivals', () => {
  it('step deterministically: the same seed gives the same standings, sol by sol', () => {
    const a = playRace('rtest01', 1);
    const b = playRace('rtest01', 1);
    expect(a.standings).toEqual(b.standings);
    expect(a.results.map((r) => [r.id, r.place, r.sols])).toEqual(b.results.map((r) => [r.id, r.place, r.sols]));
    expect(a.standings.length).toBe(a.end.log.length);
  });

  it('meet exactly the storms the player meets (same mission config)', () => {
    const { race, end } = playRace('rtest02', 2);
    for (const r of race.racers.filter((x) => x.kind === 'ai')) {
      expect(r.state!.config).toBe(end.config);
      const n = Math.min(r.state!.log.length, end.log.length);
      for (let i = 0; i < n; i++) expect(r.state!.log[i].storm?.event.id).toBe(end.log[i].storm?.event.id);
    }
  });

  it('pick three rivals from the league lineup, the same three for the same seed', () => {
    for (const lg of LEAGUES) {
      const a = pickRivals(lg, 'rseed').map((s) => s.rival);
      expect(a).toEqual(pickRivals(lg, 'rseed').map((s) => s.rival));
      expect(new Set(a).size).toBe(3);
    }
  });

  it('get smarter by league: Legend rivals launch sooner than Bronze rivals on average', () => {
    const avg = (league: number) => {
      let total = 0;
      let n = 0;
      for (let i = 0; i < 12; i++) {
        const race = createRace({ league, you: YOU, seed: `lg${i}`, lightTimeMin: 12.5, eventPool: POOL });
        // Same difficulty for both, so only the rivals' skill differs.
        const cfg = missionConfigFor(newCampaign(race.seed, 'cadet', 'mars'), 12.5, POOL);
        for (const r of race.racers) {
          if (r.kind !== 'ai') continue;
          const end = finishRival(createMission(cfg), r.brain!, `${race.seed}|${r.id}`);
          total += end.status === 'won' ? end.log.length : 25;
          n++;
        }
      }
      return total / n;
    };
    expect(avg(4)).toBeLessThan(avg(0));
  });

  it('can have to go home early (the daredevil skips the heaters), and the story stays friendly', () => {
    const cfg = missionConfigFor(newCampaign('x', 'cadet', 'mars'), 12.5, POOL);
    let lost = 0;
    for (let i = 0; i < 30; i++) {
      const end = finishRival(createMission({ ...cfg, seed: `home${i}` }), LEAGUES[0].lineup.find((s) => s.rival === 'rook')!.brain, `k${i}`);
      if (end.status === 'lost') lost++;
    }
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(30);
    for (const why of ['dose', 'air', 'food', 'window']) expect(homeStory('Pilot Rook', why, 'solar')).toMatch(/safe/);
  });

  it('never step past the end of their mission', () => {
    const cfg = missionConfigFor(newCampaign('done', 'cadet', 'mars'), 12.5, POOL);
    const end = finishRival(createMission(cfg), { style: 'steady', slip: 0 }, 'k');
    expect(end.status).not.toBe('playing');
    expect(stepRival(end, { style: 'steady', slip: 0 }, 'k')).toBe(end);
  });
});

describe('scoring', () => {
  const f = (id: string, o: Partial<Finish>): Finish => ({ id, launched: true, sols: 10, dose: 10, life: 5, fuel: 100, ...o });

  it('puts the first crew to launch first', () => {
    const r = rankFinishes([f('a', { sols: 11 }), f('b', { sols: 9 }), f('c', { launched: false, fuel: 99, sols: 20 })]);
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(r.map((x) => x.place)).toEqual([1, 2, 3]);
  });

  it('breaks ties by fewer sols, then lower dose, then more air and food', () => {
    expect(compareFinish(f('a', { sols: 9 }), f('b', { sols: 10 }))).toBeLessThan(0);
    expect(compareFinish(f('a', { dose: 8.2 }), f('b', { dose: 8.3 }))).toBeLessThan(0);
    expect(compareFinish(f('a', { life: 6 }), f('b', { life: 5 }))).toBeLessThan(0);
    // Compared at 0.1 precision (what a challenge link keeps).
    expect(compareFinish(f('a', { dose: 8.21 }), f('b', { dose: 8.24 }))).toBe(0);
  });

  it('shares a place for a true tie and keeps input order', () => {
    const r = rankFinishes([f('a', {}), f('b', {}), f('c', { sols: 12 })]);
    expect(r.map((x) => [x.id, x.place])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
  });

  it('orders crews that went home by fuel, then by how long they lasted', () => {
    const r = rankFinishes([f('a', { launched: false, fuel: 40, sols: 6 }), f('b', { launched: false, fuel: 70, sols: 5 }), f('c', { launched: false, fuel: 40, sols: 8 })]);
    expect(r.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders live standings: launched, then fullest rockets, then crews that went home', () => {
    const live = rankLive([
      { id: 'you', status: 'playing' as const, fuel: 50, sols: 5, dose: 3, life: 4 },
      { id: 'a', status: 'lost' as const, fuel: 90, sols: 5, dose: 30, life: 0 },
      { id: 'b', status: 'won' as const, fuel: 100, sols: 5, dose: 3, life: 4 },
      { id: 'c', status: 'playing' as const, fuel: 60, sols: 5, dose: 3, life: 4 },
    ]);
    expect(live.map((x) => x.id)).toEqual(['b', 'c', 'you', 'a']);
  });

  it('gives more XP for better places', () => {
    expect(xpForPlace(1, 0)).toBeGreaterThan(xpForPlace(2, 0));
    expect(xpForPlace(2, 0)).toBeGreaterThan(xpForPlace(3, 0));
    expect(xpForPlace(3, 0)).toBeGreaterThan(xpForPlace(4, 0));
    expect(xpForPlace(4, 0)).toBeGreaterThan(0);
  });

  it('reports overtakes when you pass a rival', () => {
    const race = createRace({ league: 0, you: YOU, seed: 'rnews', lightTimeMin: 12.5, eventPool: POOL });
    const row = (id: string, fuel: number) => ({ id, racer: race.racers.find((r) => r.id === id) ?? race.racers[0], status: 'playing' as const, fuel, sols: 3, dose: 1, life: 4 });
    const rival = race.racers[1].id;
    const before = rankLive([row('you', 20), row(rival, 30)]);
    const after = rankLive([row('you', 45), row(rival, 40)]);
    expect(newsBetween(before, after)).toEqual([{ kind: 'overtake', racer: race.racers[1] }]);
    expect(newsBetween(after, before)).toEqual([{ kind: 'passed', racer: race.racers[1] }]);
  });

  it('has friendly banter only', () => {
    const { race, end } = playRace('rbanter', 0);
    const rows = liveRows(race, end);
    for (let sol = 1; sol < 15; sol++) {
      const b = banterFor(race.seed, sol, rows, [], sol % 3 === 0);
      if (b) expect(b.text).not.toMatch(/loser|bad|stupid|slow ?poke|lol/i);
    }
  });
});

describe('leagues', () => {
  it('promote after enough top-2 finishes, and never demote', () => {
    let s = freshSave(() => 0.5);
    expect(s.league).toBe(0);
    s = applyPlace(s, 3).save;
    s = applyPlace(s, 4).save;
    expect(s.league).toBe(0);
    expect(s.progress).toBe(0);
    let out = applyPlace(s, 2);
    expect(out.outcome.good).toBe(true);
    expect(out.outcome.promoted).toBe(false);
    out = applyPlace(out.save, 1);
    expect(out.outcome.promoted).toBe(true);
    expect(out.outcome.trophy).toBe(true);
    expect(out.save.league).toBe(1);
    expect(out.save.progress).toBe(0);
    expect(out.save.trophies).toBe(1);
    expect(out.save.races).toBe(4);
    expect(out.save.points).toBe(1 + 0 + 2 + 3);
    s = out.save;
    for (let i = 0; i < 10; i++) s = applyPlace(s, 4).save;
    expect(s.league).toBe(1);
  });

  it('stops at Legend and keeps counting trophies', () => {
    let s = { ...freshSave(), league: LEAGUES.length - 1 };
    for (let i = 0; i < 5; i++) s = applyPlace(s, 1).save;
    expect(s.league).toBe(LEAGUES.length - 1);
    expect(s.trophies).toBe(5);
    expect(progressLine(s)).toMatch(/trophies/);
  });

  it('says how far it is to the next league', () => {
    expect(progressLine({ ...freshSave(), league: 1, progress: 1 })).toBe('2 more top-2 finishes to Gold');
  });

  it('runs Bronze to Gold on Cadet, and Diamond and Legend on Commander', () => {
    expect(LEAGUES.map((l) => l.difficulty)).toEqual(['cadet', 'cadet', 'cadet', 'commander', 'commander']);
  });
});

describe('callsigns', () => {
  it('come only from the word lists', () => {
    for (let i = 0; i < 50; i++) {
      const c = randomCallsign();
      expect(isCallsign(c)).toBe(true);
      expect(ADJECTIVES).toContain(c.adj);
      expect(SPACE_NOUNS).toContain(c.noun);
    }
    expect(callsignText(YOU)).toBe('Brave Comet 42');
    expect(isCallsign({ adj: 'Mean', noun: 'Comet', num: 4 })).toBe(false);
    expect(isCallsign({ adj: 'Brave', noun: 'Comet', num: 100 })).toBe(false);
    expect(parseCallsignSlug('brave-comet-42')).toEqual(YOU);
    expect(parseCallsignSlug('john-smith-12')).toBeNull();
    // Numbers with rude meanings online are never used (the same list as the Player Card).
    for (const num of [14, 18, 69, 88]) {
      expect(isCallsign({ adj: 'Brave', noun: 'Comet', num })).toBe(false);
      expect(parseCallsignSlug(`brave-comet-${num}`)).toBeNull();
    }
    let k = 0;
    const seq = [0, 0, 13 / 99];
    expect(randomCallsign(() => seq[k++ % 3]).num).not.toBe(14);
  });

  it('use the Player Card callsign when there is one (one name everywhere), and ignore a damaged card', async () => {
    const { myCallsign, PLAYER_CARD_KEY } = await import('./index');
    localStorage.removeItem(PLAYER_CARD_KEY);
    expect(myCallsign().fromCard).toBe(false);
    localStorage.setItem(PLAYER_CARD_KEY, JSON.stringify({ card: { callsign: { adj: 'Sunny', noun: 'Voyager', num: 7 } } }));
    expect(myCallsign()).toEqual({ callsign: { adj: 'Sunny', noun: 'Voyager', num: 7 }, fromCard: true });
    localStorage.setItem(PLAYER_CARD_KEY, JSON.stringify({ card: { callsign: { adj: 'Rude', noun: 'Voyager', num: 7 } } }));
    expect(myCallsign().fromCard).toBe(false);
    localStorage.setItem(PLAYER_CARD_KEY, '{oops');
    expect(isCallsign(myCallsign().callsign)).toBe(true);
    localStorage.removeItem(PLAYER_CARD_KEY);
  });
});

describe('challenge codes', () => {
  const run = (): GhostRun => {
    const { end } = playRace('rcode01', 0);
    return ghostFromMission(end, YOU);
  };

  it('round-trip a real run', () => {
    const g = run();
    const code = encodeRun(g);
    expect(code).toMatch(/^[a-z0-9.\-]+$/);
    expect(decodeRun(code)).toEqual(g);
    expect(g.pool).toBe(poolFingerprint(POOL));
    const url = challengeUrl(g);
    expect(url.startsWith('https://playescapevelocity.com/?race=')).toBe(true);
    expect(raceParam(new URL(url).search)).toBe(code);
  });

  it('round-trip a crew that went home, on the Moon, on Commander', () => {
    const g: GhostRun = { ...run(), site: 'moon', difficulty: 'commander', status: 'lost', loseReason: 'dose', fuel: [10, 22, 35], dose: 41.3, life: 2.5 };
    expect(decodeRun(encodeRun(g))).toEqual(g);
  });

  it('reject garbage and tampering', () => {
    const code = encodeRun(run());
    const bad: unknown[] = [
      null,
      undefined,
      42,
      '',
      'hello',
      'x'.repeat(1000),
      code.replace(/^1\./, '2.'),
      code.slice(0, -3),
      `${code}.extra`,
      code.replace('brave-comet-42', 'mean-comet-42'),
      code.replace('brave-comet-42', 'john-smith-42'),
      code.replace('.mc.', '.zz.'),
      '<script>alert(1)</script>',
      code.replace(/\.[0-9a-z]{2}$/, '.00') === code ? code.replace(/\.[0-9a-z]{2}$/, '.01') : code.replace(/\.[0-9a-z]{2}$/, '.00'),
    ];
    for (const b of bad) expect(decodeRun(b)).toBeNull();
  });

  it('reject a "launch" whose rocket never filled, and fuel over 100%', () => {
    const g = run();
    const parts = encodeRun({ ...g, status: 'won', fuel: [10, 20, 30] }).split('.');
    expect(decodeRun(parts.join('.'))).toBeNull();
  });

  it('race a friend: the ghost replays their run sol by sol on the same seed', () => {
    const g = run();
    const race = createRace({ league: 0, you: YOU, ghost: g });
    expect(race.seed).toBe(g.seed);
    expect(race.sameStorms).toBe(true);
    expect(race.racers.map((r) => r.kind)).toEqual(['you', 'ghost', 'ai', 'ai']);
    let m = missionFor(race);
    expect(isRaceMission(race, m)).toBe(true);
    for (let k = 1; k <= 3; k++) {
      m = playOut(m, balanced, 1);
      syncRivals(race, m);
      expect(liveRows(race, m).find((r) => r.id === 'ghost')!.fuel).toBe(g.fuel[k - 1]);
    }
  });

  it('flag a friend run from a different storm pool', () => {
    const g = { ...run(), pool: 'zzzz' };
    expect(createRace({ league: 0, you: YOU, ghost: g }).sameStorms).toBe(false);
  });
});

describe('storage', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('turns garbage into a valid save, field by field', () => {
    for (const raw of [null, 7, 'x', [], { league: 99, progress: -4, races: 'lots', trophies: 1e12, callsign: { adj: 'Rude', noun: 'X', num: 5 }, lastCode: '<b>' }]) {
      const s = sanitize(raw);
      expect(s.league).toBeGreaterThanOrEqual(0);
      expect(s.league).toBeLessThan(LEAGUES.length);
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(isCallsign(s.callsign)).toBe(true);
      expect(s.lastCode).toBeNull();
      expect(s.trophies).toBeLessThanOrEqual(s.races);
    }
    expect(sanitize({ league: 99 }).league).toBe(LEAGUES.length - 1);
    expect(sanitize({ league: 0, progress: 50 }).progress).toBe(LEAGUES[0].promote - 1);
  });

  it('saves and loads, and survives broken JSON and blocked storage', () => {
    const s = { ...freshSave(), league: 2, races: 5, trophies: 2, callsign: YOU };
    writeSave(s);
    expect(loadSave()).toEqual(s);
    localStorage.setItem(STORAGE_KEY, '{nope');
    expect(loadSave().league).toBe(0);
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    try {
      expect(() => writeSave(s)).not.toThrow();
      expect(loadSave().league).toBe(0);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('podium tip', () => {
  it('gives one honest tip from how the race went', async () => {
    const { raceTip } = await import('./ui');
    const race = createRace({ league: 0, you: YOU, seed: 'rtip', lightTimeMin: 12.5, eventPool: POOL });
    const you = race.racers[0];
    const rival = race.racers[1];
    const res = (me: Partial<Finish> & { loseReason?: 'dose' | 'air' | 'food' | 'window' }, them: Partial<Finish>) =>
      rankFinishes([
        { id: 'you', racer: you, launched: true, sols: 10, dose: 10, life: 4, fuel: 100, ...me },
        { id: rival.id, racer: rival, launched: true, sols: 10, dose: 10, life: 4, fuel: 100, ...them },
      ]);
    expect(raceTip(res({ sols: 12 }, { sols: 9 }), 'mars')).toMatch(/launched 3 sols sooner/);
    expect(raceTip(res({ sols: 12 }, { sols: 11 }), 'moon')).toMatch(/launched 1 day sooner/);
    expect(raceTip(res({ dose: 12 }, { dose: 9 }), 'mars')).toMatch(/same sol/);
    expect(raceTip(res({ launched: false, fuel: 60, loseReason: 'dose' }, {}), 'mars')).toMatch(/storm shelter/);
    expect(raceTip(res({ launched: false, fuel: 60, loseReason: 'window' }, {}), 'mars')).toMatch(/FUEL/);
    expect(raceTip(res({ sols: 8 }, { sols: 9 }), 'mars')).toMatch(/Great flying/);
  });
});
