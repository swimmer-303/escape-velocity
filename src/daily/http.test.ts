// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Integration test: the API on the Node test server (deploy/server.ts) in-process on a random port, with
// daily.json in a temp folder. Gets today's challenge, sends real and tampered games over HTTP,
// reads the board, checks the limits, and restarts the server to prove the day's pool is kept.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from '../../deploy/server';
import { createMission } from '../sim/sim';
import { builder, playOut, pureGreed } from '../sim/strategies';
import { dailyMissionConfig, movesFromLog } from './replay';
import type { DailyConfig, DailyMove, DailySubmitResponse, DailyTop } from './protocol';

// Each test replays whole missions (hundreds, for the limits): allow for a busy CI machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const NOW = Date.parse('2026-11-14T17:00:00Z'); // noon Saturday in Charlotte
let dir: string;
let base = '';
let server: Server;

async function start() {
  ({ server } = createApiServer({ fetchSnapshot: async () => null, stateDir: dir, now: () => NOW }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop() {
  await new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ev-daily-http-'));
  await start();
});
afterAll(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});

async function get<T>(path: string): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path);
  return { status: res.status, json: (await res.json()) as T };
}
async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}

function play(cfg: DailyConfig, strategy = builder): DailyMove[] {
  return movesFromLog(playOut(createMission(dailyMissionConfig(cfg)), strategy));
}

describe('daily challenge over HTTP', () => {
  let cfg: DailyConfig;

  it('GET /api/daily freezes today\'s challenge and gives everyone the same one', async () => {
    const a = await get<DailyConfig>('/api/daily');
    expect(a.status).toBe(200);
    cfg = a.json;
    expect(cfg).toMatchObject({ date: '2026-11-14', seed: '2026-11-14', site: 'mars', difficulty: 'cadet', poolSource: 'archive' });
    expect(cfg.eventPool.length).toBeGreaterThan(5);
    const b = await get<DailyConfig>('/api/daily');
    expect(b.json).toEqual(cfg);
  });

  it('scores a game by replaying its moves, and ignores any score the browser claims', async () => {
    const r = await post<DailySubmitResponse>('/api/daily/2026-11-14/submit', {
      playerId: 'http-player-000001',
      nickname: 'Rocket Kid',
      moves: play(cfg),
      score: { won: true, sols: 1, dose: 0, stars: 3 },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, improved: true, total: 1, you: { rank: 1, nickname: 'Rocket Kid', won: true } });
    expect(r.json.score.sols).toBeGreaterThan(5);
    const lost = await post<DailySubmitResponse>('/api/daily/2026-11-14/submit', { playerId: 'http-player-000002', moves: play(cfg, pureGreed) });
    expect(lost.json).toMatchObject({ you: { rank: 2, nickname: 'Anonymous astronaut', won: false } });
  });

  it('rejects tampered games, illegal allocations, bad names, big bodies and bad JSON', async () => {
    const moves = play(cfg);
    const tampered = JSON.parse(JSON.stringify(moves)) as DailyMove[];
    tampered[1].a[1] += 2;
    const url = '/api/daily/2026-11-14/submit';
    expect(await post(url, { playerId: 'http-player-000003', moves: tampered })).toMatchObject({ status: 422, json: { error: 'illegal-alloc' } });
    expect(await post(url, { playerId: 'http-player-000003', moves: moves.slice(0, 2) })).toMatchObject({ status: 422, json: { error: 'unfinished' } });
    expect(await post(url, { playerId: 'http-player-000003', nickname: 'stupid', moves })).toMatchObject({ status: 400, json: { error: 'bad-name' } });
    expect(await post(url, { playerId: 'http-player-000003', moves, pad: 'x'.repeat(5000) })).toMatchObject({ status: 413, json: { error: 'too-big' } });
    expect(await post(url, '{"playerId":')).toMatchObject({ status: 400, json: { error: 'bad-json' } });
    expect(await post('/api/daily/2026-11-20/submit', { playerId: 'http-player-000003', moves })).toMatchObject({ status: 404 });
    expect(JSON.stringify({ playerId: 'http-player-000003', nickname: 'Max Len Name', moves }).length).toBeLessThan(4096);
  });

  it('GET top: the best players and your rank, with no player ids', async () => {
    const r = await get<DailyTop>('/api/daily/2026-11-14/top?limit=1&player=http-player-000002');
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(2);
    expect(r.json.top).toEqual([expect.objectContaining({ rank: 1, nickname: 'Rocket Kid', won: true })]);
    expect(Object.keys(r.json.top[0]).sort()).toEqual(['dose', 'fuel', 'nickname', 'rank', 'sols', 'stars', 'won']);
    expect(r.json.you).toMatchObject({ rank: 2, nickname: 'Anonymous astronaut' });
    expect(JSON.stringify(r.json)).not.toMatch(/http-player/);
    expect((await get('/api/daily/2026-13-45/top')).status).toBe(400);
    expect((await get<DailyTop>('/api/daily/2026-11-01/top')).json).toMatchObject({ total: 0, top: [] });
    expect((await fetch(`${base}/api/daily`, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(`${base}/api/daily/2026-11-14/submit`)).status).toBe(405);
  });

  it('rate-limits each address (a local proxy passes the real one in X-Forwarded-For)', async () => {
    const lose = play(cfg, pureGreed);
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await post('/api/daily/2026-11-14/submit', { playerId: `rate-player-${String(i).padStart(6, '0')}`, moves: lose }, { 'x-forwarded-for': '203.0.113.9' })).status;
    }
    expect(last).toBe(429);
    expect((await post('/api/daily/2026-11-14/submit', { playerId: 'rate-player-other0', moves: lose }, { 'x-forwarded-for': '203.0.113.10' })).status).toBe(200);
  });

  it('keeps the frozen pool and the board across a restart (daily.json in the state folder)', async () => {
    await stop();
    expect(existsSync(join(dir, 'daily.json'))).toBe(true);
    await start();
    const again = await get<DailyConfig>('/api/daily');
    expect(again.json).toEqual(cfg);
    const top = await get<DailyTop>('/api/daily/2026-11-14/top?limit=3');
    expect(top.json.top[0]).toMatchObject({ rank: 1, nickname: 'Rocket Kid' });
  });
});
