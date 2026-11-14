// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The class board store: registering, checking results, nicknames through the blocklist,
// limits, expiry after 7 days, and saving to / loading from a temp STATE_DIR.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClassStore, CLASS_FILE, CLASS_RATE } from './store';
import { checkReport } from './validate';
import { summarize } from './summary';
import { CLASS_LIMITS, dashboardParams, type DashboardView, type ReportRequest } from './protocol';

const T0 = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'ev-class-'));
  dirs.push(d);
  return d;
}

let ids = 0;
const pid = (i = ++ids) => i.toString(16).padStart(24, 'a');
const rid = () => (++ids).toString(16).padStart(16, 'b');

function result(over: Partial<ReportRequest> = {}): ReportRequest {
  return {
    playerId: pid(1),
    rid: rid(),
    mode: 'campaign',
    site: 'mars',
    difficulty: 'cadet',
    n: 1,
    status: 'won',
    loseReason: null,
    sols: 4,
    dose: 6.66,
    doseBudget: 27,
    stars: ['launch', 'safe', 'builder'],
    built: ['panel'],
    series: { fuel: [10, 30, 55, 80, 100] },
    ...over,
  };
}

function store(now = { t: T0 }, dir: string | null = null) {
  return { s: new ClassStore({ dir, now: () => now.t, log: () => undefined }), now };
}

function registered(now = { t: T0 }, dir: string | null = null) {
  const { s } = store(now, dir);
  const r = s.register('1.1.1.1', { code: 'k7r-zq' });
  if (!r.ok) throw new Error(r.message);
  return { s, now, key: r.value.key, code: r.value.code };
}

function dash(s: ClassStore, code: string, key: string): DashboardView {
  const v = s.view(code, '9.9.9.9', key);
  if (!v.ok || 'unchanged' in v.value) throw new Error('no view');
  return v.value;
}

describe('registering a class', () => {
  it('gives a secret key once, and the dashboard needs it', () => {
    const { s, key, code } = registered();
    expect(code).toBe('K7RZQ');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(s.register('1.1.1.1', { code: 'K7RZQ' })).toMatchObject({ ok: false, status: 409 });
    expect(s.register('1.1.1.1', { code: 'K0RZQ' })).toMatchObject({ ok: false, status: 400 });
    expect(s.register('1.1.1.1', {})).toMatchObject({ ok: false, status: 400 });
    expect(s.view(code, 'x', undefined)).toMatchObject({ ok: false, status: 403 });
    expect(s.view(code, 'x', 'f'.repeat(32))).toMatchObject({ ok: false, status: 403 });
    expect(s.view('ZZZZZ', 'x', key)).toMatchObject({ ok: false, status: 404 });
    expect(dash(s, 'k7rzq', key)).toMatchObject({ code: 'K7RZQ', players: [], lastReportAt: null });
    // The key itself is never kept, only its hash.
    expect(JSON.stringify([...s.classes.values()])).not.toContain(key);
  });

  it('limits: 500 classes, and a rate limit per address', () => {
    const { s } = store();
    for (let i = 0; i < CLASS_RATE.register.max; i++) expect(s.register('2.2.2.2', { code: `BC${'DFGHJKMNPQ'[i]}23` }).ok).toBe(true);
    expect(s.register('2.2.2.2', { code: 'BCZ23' })).toMatchObject({ ok: false, status: 429 });
    const full = store().s;
    let made = 0;
    for (let i = 0; made < CLASS_LIMITS.maxClasses; i++) {
      const code = Array.from({ length: 5 }, (_, k) => '23456789BCDFGHJKMNPQRSTVWXYZ'[Math.floor(i / 28 ** k) % 28]).join('');
      if (full.register(`ip${i}`, { code }).ok) made++;
    }
    expect(full.classes.size).toBe(CLASS_LIMITS.maxClasses);
    expect(full.register('ip-last', { code: 'ZZZZZ' })).toMatchObject({ ok: false, status: 503 });
  });
});

describe('results from students', () => {
  it('keeps the latest result per crew plus running totals, and never counts a retried send twice', () => {
    const { s, key, code } = registered();
    const r1 = result({ n: 1 });
    expect(s.report(code, 'ip', { ...r1 })).toMatchObject({ ok: true, value: { num: 1, name: null } });
    expect(s.report(code, 'ip', { ...r1 })).toMatchObject({ ok: true, value: { duplicate: true } });
    expect(s.report(code, 'ip', { ...result({ n: 2, status: 'lost', loseReason: 'air', stars: ['builder'], built: ['battery'], sols: 3, series: null }) })).toMatchObject({ ok: true });
    // Crew 2 again: replaces the slot, but both count in the totals.
    expect(s.report(code, 'ip', { ...result({ n: 2, sols: 2, series: { fuel: [40, 70, 100] }, built: [] }) }).ok).toBe(true);
    const v = dash(s, code, key);
    expect(v.players).toHaveLength(1);
    const p = v.players[0];
    expect(p.crews.map((c) => [c.n, c.status])).toEqual([
      [1, 'won'],
      [2, 'won'],
    ]);
    expect(p.last).toMatchObject({ n: 2, status: 'won', sols: 2 });
    expect(p.tally).toMatchObject({ crews: 3, launched: 2, early: 1, stars: 7, best: { sols: 2, site: 'mars' }, built: ['panel', 'battery'], sites: ['mars'] });
    expect(p.tally.reasons.air).toBe(1);
    expect(p.fuel).toEqual([40, 70, 100]);
    expect(p.crews[0].dose).toBe(6.7);
    // Nothing secret or identifying goes to the dashboard.
    expect(JSON.stringify(v)).not.toContain(pid(1));
    expect(JSON.stringify(v)).not.toContain(r1.rid);

    const sum = summarize(v.players);
    expect(sum).toMatchObject({ players: 1, crews: 3, launched: 2, early: 1, trouble: [{ reason: 'air', count: 1 }] });
    expect(sum.avgStars).toBeCloseTo(7 / 3);
    expect(sum.upgrades).toEqual([
      { id: 'panel', players: 1 },
      { id: 'battery', players: 1 },
    ]);
  });

  it('refuses anything that is not a real result', () => {
    const bad: Array<Partial<Record<keyof ReportRequest, unknown>>> = [
      { playerId: 'not hex!' },
      { playerId: 'abc' },
      { rid: '' },
      { mode: 'party' },
      { site: 'venus' },
      { difficulty: 'easy' },
      { n: 4 },
      { n: 0 },
      { mode: 'quick', n: 2 },
      { status: 'maybe' },
      { status: 'won', loseReason: 'air' },
      { status: 'lost', loseReason: 'boredom', stars: [] },
      { sols: -1 },
      { sols: 3.5 },
      { sols: 999 },
      { dose: Number.NaN },
      { dose: -2 },
      { doseBudget: 0 },
      { stars: ['launch', 'launch'] },
      { stars: ['gold'] },
      { status: 'lost', loseReason: 'air', stars: ['launch'] },
      { built: ['laser'] },
      { built: 'panel' },
      { series: { fuel: [1, 2] } },
      { series: { fuel: [10, 30, 55, 80, 101] } },
      { series: { fuel: [10, 30, 55, 80, 99.5] } },
      { series: 'chart' },
    ];
    for (const b of bad) expect(checkReport({ ...result(), ...b } as Record<string, unknown>).ok, JSON.stringify(b)).toBe(false);
    expect(checkReport({ ...result(), extra: 'ignored', html: '<b>' } as Record<string, unknown>)).toMatchObject({ ok: true });
    const extra = checkReport({ ...result(), extra: 'x' } as Record<string, unknown>);
    expect(extra.ok && 'extra' in extra.report).toBe(false);
    const lost = checkReport({ ...result({ status: 'lost', loseReason: 'window', stars: ['builder'] }) } as unknown as Record<string, unknown>);
    expect(lost).toMatchObject({ ok: true, report: { loseReason: 'window' } });

    const { s, code } = registered();
    expect(s.report(code, 'ip', { ...result(), n: 9 })).toMatchObject({ ok: false, status: 400 });
    expect(s.report('ZZZZZ', 'ip', { ...result() })).toMatchObject({ ok: false, status: 404 });
    expect(s.report('nope!', 'ip', { ...result() })).toMatchObject({ ok: false, status: 404 });
  });

  it('nicknames: format and blocklist, made unique, and "Player N" when skipped', () => {
    const { s, key, code } = registered();
    expect(s.report(code, 'ip', { ...result({ playerId: pid(11), nickname: '  Ava  ' }) })).toMatchObject({ ok: true, value: { num: 1, name: 'Ava' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(12), nickname: 'ava' }) })).toMatchObject({ ok: true, value: { num: 2, name: 'ava 2' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(13), nickname: 'Fuuuck' }) })).toMatchObject({ ok: true, value: { num: 3, name: null, nameProblem: 'blocked' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(14), nickname: '<script>' }) })).toMatchObject({ ok: true, value: { name: null, nameProblem: 'letters' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(15), nickname: 'Abcdefghijklm' }) })).toMatchObject({ ok: true, value: { name: null, nameProblem: 'long' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(16), nickname: null }) })).toMatchObject({ ok: true, value: { num: 6, name: null } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(17), nickname: 'Abcdefghijkl' }) })).toMatchObject({ ok: true, value: { name: 'Abcdefghijkl' } });
    expect(s.report(code, 'ip', { ...result({ playerId: pid(18), nickname: 'abcdefghijkl' }) })).toMatchObject({ ok: true, value: { name: 'abcdefghij 2' } });
    // A name added later (resending the same result) only renames: nothing is counted twice.
    const later = result({ playerId: pid(16) });
    s.report(code, 'ip', { ...later });
    expect(s.report(code, 'ip', { ...later, nickname: 'Ben' })).toMatchObject({ ok: true, value: { num: 6, name: 'Ben', duplicate: true } });
    // No nickname keeps the name it had.
    expect(s.report(code, 'ip', { ...result({ playerId: pid(16) }) })).toMatchObject({ ok: true, value: { name: 'Ben' } });
    const v = dash(s, code, key);
    expect(v.players.find((p) => p.num === 6)!.tally.crews).toBe(3);
    expect(v.players.map((p) => p.name)).toEqual(['Ava', 'ava 2', null, null, null, 'Ben', 'Abcdefghijkl', 'abcdefghij 2']);
  });

  it('limits: 60 players, results per player, and rate limits', () => {
    const { s, code, key } = registered();
    for (let i = 0; i < CLASS_LIMITS.maxPlayers; i++) expect(s.report(code, `ip${i}`, { ...result({ playerId: pid(1000 + i) }) }).ok).toBe(true);
    expect(s.report(code, 'ip-new', { ...result({ playerId: pid(5000) }) })).toMatchObject({ ok: false, status: 409, error: 'class-full' });
    // Players already on the board can still report.
    expect(s.report(code, 'ip0', { ...result({ playerId: pid(1000) }) }).ok).toBe(true);
    expect(dash(s, code, key).players).toHaveLength(CLASS_LIMITS.maxPlayers);

    // One player: a rate limit per minute, and at most maxReportsPerPlayer results in all.
    const now = { t: T0 };
    const b = registered(now);
    let accepted = 0;
    for (let i = 0; i < 400; i++) {
      now.t += 4000; // 15 a minute: under the per-player limit
      const r = b.s.report(b.code, 'school', { ...result({ playerId: pid(7) }) });
      if (r.ok) accepted++;
      else expect(r).toMatchObject({ status: 409, error: 'player-full' });
    }
    expect(accepted).toBe(CLASS_LIMITS.maxReportsPerPlayer);
    const fast = registered();
    const codes = Array.from({ length: CLASS_RATE.player.max + 1 }, () => fast.s.report(fast.code, 'ip', { ...result({ playerId: pid(8) }) }));
    expect(codes.at(-1)).toMatchObject({ ok: false, status: 429 });
    const school = registered();
    const many = Array.from({ length: CLASS_RATE.report.max + 1 }, (_, i) => school.s.report(school.code, 'one-school', { ...result({ playerId: pid(20000 + (i % 50)) }) }));
    expect(many.at(-1)).toMatchObject({ ok: false, status: 429 });
  });

  it('the teacher can take a student off the board (they cannot come back) or delete every result', () => {
    const { s, code, key } = registered();
    s.report(code, 'ip', { ...result({ playerId: pid(31), nickname: 'Ava' }) });
    s.report(code, 'ip', { ...result({ playerId: pid(32), nickname: 'Ben' }) });
    expect(s.teacher(code, 'ip', { key: 'f'.repeat(32), action: 'clear' })).toMatchObject({ ok: false, status: 403 });
    expect(s.teacher(code, 'ip', { key, action: 'remove', num: 9 })).toMatchObject({ ok: false, status: 404 });
    expect(s.teacher(code, 'ip', { key, action: 'explode' })).toMatchObject({ ok: false, status: 400 });
    expect(s.teacher(code, 'ip', { key, action: 'remove', num: 2 }).ok).toBe(true);
    expect(dash(s, code, key).players.map((p) => p.name)).toEqual(['Ava']);
    expect(s.report(code, 'ip', { ...result({ playerId: pid(32), nickname: 'Ben' }) })).toMatchObject({ ok: false, status: 403, error: 'removed' });
    expect(s.teacher(code, 'ip', { key, action: 'clear' }).ok).toBe(true);
    expect(dash(s, code, key).players).toEqual([]);
  });

  it('the dashboard says "unchanged" when nothing is new', () => {
    const { s, code, key } = registered();
    const v1 = dash(s, code, key);
    expect(s.view(code, 'x', key, v1.v)).toEqual({ ok: true, value: { unchanged: true, v: v1.v } });
    s.report(code, 'ip', { ...result() });
    const v2 = s.view(code, 'x', key, v1.v);
    expect(v2.ok && !('unchanged' in v2.value) && v2.value.players.length).toBe(1);
  });
});

describe('expiry and saving', () => {
  it('a class is deleted 7 days after its last result (or after registering, with no results)', () => {
    const now = { t: T0 };
    const { s, code, key } = registered(now);
    now.t += 6 * DAY;
    s.report(code, 'ip', { ...result() });
    now.t += 6 * DAY; // 12 days after registering, 6 after the last result: still here
    expect(dash(s, code, key).expiresAt).toBe(T0 + 6 * DAY + CLASS_LIMITS.expireMs);
    now.t += DAY;
    expect(s.view(code, 'x', key)).toMatchObject({ ok: false, status: 404 });
    expect(s.report(code, 'ip', { ...result() })).toMatchObject({ ok: false, status: 404 });
    // The code is free again.
    expect(s.register('ip', { code }).ok).toBe(true);

    const quiet = registered(now);
    now.t += CLASS_LIMITS.expireMs;
    quiet.s.sweep();
    expect(quiet.s.classes.size).toBe(0);
  });

  it('round-trips through classes.json in STATE_DIR (atomic write, private file)', () => {
    const dir = tempDir();
    const now = { t: T0 };
    const a = registered(now, dir);
    a.s.report(a.code, 'ip', { ...result({ nickname: 'Ava' }) });
    a.s.report(a.code, 'ip', { ...result({ playerId: pid(41), status: 'lost', loseReason: 'dose', stars: [], series: null }) });
    a.s.flush();
    const file = join(dir, CLASS_FILE);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(a.key);
    expect(text).not.toMatch(/ip"/); // no addresses
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([CLASS_FILE]); // the temp file was renamed away

    const b = new ClassStore({ dir, now: () => now.t, log: () => undefined }).load();
    expect(dash(b, a.code, a.key)).toEqual(dash(a.s, a.code, a.key));
    // Player numbers carry on after a restart.
    expect(b.report(a.code, 'ip', { ...result({ playerId: pid(42) }) })).toMatchObject({ ok: true, value: { num: 3 } });

    // Expired classes are dropped when loading.
    now.t += CLASS_LIMITS.expireMs + 1;
    expect(new ClassStore({ dir, now: () => now.t, log: () => undefined }).load().classes.size).toBe(0);
  });

  it('saves a little after a change (debounced), and survives a damaged or missing file', async () => {
    const dir = tempDir();
    const s = new ClassStore({ dir, saveDelayMs: 20, log: () => undefined });
    expect(s.register('ip', { code: 'B4XN9' }).ok).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    await new Promise((r) => setTimeout(r, 80));
    expect(JSON.parse(readFileSync(join(dir, CLASS_FILE), 'utf8')).classes[0].code).toBe('B4XN9');

    writeFileSync(join(dir, CLASS_FILE), '{"version":1,"classes":[{"code":"oops"}, 7]}');
    const logs: string[] = [];
    expect(new ClassStore({ dir, log: (m) => logs.push(m) }).load().classes.size).toBe(0);
    writeFileSync(join(dir, CLASS_FILE), 'not json');
    expect(new ClassStore({ dir, log: (m) => logs.push(m) }).load().classes.size).toBe(0);
    expect(logs).toHaveLength(1);
    expect(new ClassStore({ dir: join(dir, 'missing'), log: (m) => logs.push(m) }).load().classes.size).toBe(0);

    // A folder we cannot write to: keeps working in memory, and says so once.
    const ro = new ClassStore({ dir: join(dir, CLASS_FILE, 'not-a-dir'), saveDelayMs: 1, log: (m) => logs.push(m) });
    expect(ro.register('ip', { code: 'B4XN9' }).ok).toBe(true);
    ro.flush();
    ro.flush();
    expect(logs.filter((m) => m.includes('could not save'))).toHaveLength(1);
  });
});

describe('dashboard links', () => {
  it('reads ?dashboard=CODE&key=KEY', () => {
    const key = 'a'.repeat(32);
    expect(dashboardParams(`?dashboard=k7r-zq&key=${key}`)).toEqual({ code: 'K7RZQ', key });
    expect(dashboardParams('?dashboard=K7RZQ')).toEqual({ code: 'K7RZQ', key: null });
    expect(dashboardParams('?dashboard=K7RZQ&key=short')).toEqual({ code: 'K7RZQ', key: null });
    expect(dashboardParams('?dashboard=K0RZQ')).toBeNull();
    expect(dashboardParams('?code=K7RZQ')).toBeNull();
  });
});
