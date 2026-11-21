// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Integration test: the API on the Node test server (deploy/server.ts) in-process on a random port, with
// a temp state folder. A teacher registers a class, students send results, the dashboard reads them,
// and the class board is still there after the server restarts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer } from '../../deploy/server';
import type { DashboardView, RegisterResponse, ReportRequest, ReportResponse } from './protocol';

let dir = '';
let base = '';
let server: Server;

async function boot() {
  ({ server } = createApiServer({ fetchSnapshot: async () => null, stateDir: dir }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const shut = () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r())));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ev-class-http-'));
  await boot();
});
afterAll(async () => {
  await shut();
  rmSync(dir, { recursive: true, force: true });
});

async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}

const report = (over: Partial<ReportRequest>): ReportRequest => ({
  playerId: 'a'.repeat(24),
  rid: '1'.repeat(16),
  mode: 'campaign',
  site: 'mars',
  difficulty: 'cadet',
  n: 1,
  status: 'won',
  sols: 3,
  dose: 5.2,
  doseBudget: 27,
  stars: ['launch', 'safe'],
  built: [],
  series: { fuel: [20, 50, 80, 100] },
  ...over,
});

describe('class board over HTTP', () => {
  it('register, report, read the dashboard, and keep it across a restart', async () => {
    const reg = await post<RegisterResponse>('/api/class', { code: 'q9m-tk' });
    expect(reg.status).toBe(201);
    const { code, key } = reg.json;
    expect(code).toBe('Q9MTK');
    expect((await post('/api/class', { code })).status).toBe(409);

    const r1 = await post<ReportResponse>(`/api/class/${code}/report`, report({ nickname: 'Ava' }));
    expect(r1).toEqual({ status: 200, json: { ok: true, num: 1, name: 'Ava' } });
    const r2 = await post<ReportResponse>(`/api/class/${code.toLowerCase()}/report`, report({ playerId: 'b'.repeat(24), rid: '2'.repeat(16), status: 'lost', loseReason: 'air', stars: [], built: ['panel'] }));
    expect(r2.json).toMatchObject({ ok: true, num: 2, name: null });
    // Never sent to students: the key is not in any report answer.
    expect(JSON.stringify([r1.json, r2.json])).not.toContain(key);

    const res = await fetch(`${base}/api/class/${code}?key=${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const view = (await res.json()) as DashboardView;
    expect(view.players.map((p) => [p.num, p.name, p.last.status, p.last.loseReason ?? null])).toEqual([
      [1, 'Ava', 'won', null],
      [2, null, 'lost', 'air'],
    ]);
    expect(JSON.stringify(view)).not.toContain('a'.repeat(24));
    const same = await fetch(`${base}/api/class/${code}?key=${key}&since=${view.v}`).then((r) => r.json());
    expect(same).toEqual({ unchanged: true, v: view.v });

    // Restart: the class board comes back from classes.json (saved on close).
    await shut();
    expect(JSON.parse(readFileSync(join(dir, 'classes.json'), 'utf8')).classes).toHaveLength(1);
    await boot();
    const again = (await fetch(`${base}/api/class/${code}?key=${key}`).then((r) => r.json())) as DashboardView;
    expect(again.players).toEqual(view.players);

    // Teacher tools.
    expect((await post(`/api/class/${code}/teacher`, { key, action: 'remove', num: 2 })).status).toBe(200);
    expect((await post(`/api/class/${code}/report`, report({ playerId: 'b'.repeat(24), rid: '3'.repeat(16) }))).status).toBe(403);
  });

  it('a student who joins shows on the dashboard before any result', async () => {
    const { json } = await post<RegisterResponse>('/api/class', { code: 'J7W2P' });
    const { code, key } = json;
    const j = await post(`/api/class/${code}/join`, { playerId: 'c'.repeat(24), nickname: 'Sam' });
    expect(j).toEqual({ status: 200, json: { ok: true, num: 1, name: 'Sam' } });
    const view = (await fetch(`${base}/api/class/${code}?key=${key}`).then((r) => r.json())) as DashboardView;
    expect(view.players).toEqual([]);
    expect(view.joined?.map((x) => [x.num, x.name])).toEqual([[1, 'Sam']]);
    expect(JSON.stringify(view)).not.toContain('c'.repeat(24));
    expect((await post('/api/class/ZZZZZ/join', { playerId: 'c'.repeat(24) })).status).toBe(404);
    expect((await fetch(`${base}/api/class/${code}/join`)).status).toBe(405);
  });

  it('rejects bad requests', async () => {
    const { json } = await post<RegisterResponse>('/api/class', { code: 'B4XN9' });
    const { code, key } = json;
    expect((await fetch(`${base}/api/class/${code}`)).status).toBe(403);
    expect((await fetch(`${base}/api/class/${code}?key=${'0'.repeat(32)}`)).status).toBe(403);
    expect((await fetch(`${base}/api/class/ZZZZZ?key=${key}`)).status).toBe(404);
    expect((await post('/api/class/ZZZZZ/report', report({}))).status).toBe(404);
    expect((await post(`/api/class/${code}/report`, report({ n: 7 }))).status).toBe(400);
    expect((await post(`/api/class/${code}/report`, { ...report({}), nickname: 'x'.repeat(3000) })).status).toBe(413);
    const bad = await fetch(`${base}/api/class/${code}/report`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/class`)).status).toBe(405);
    expect((await fetch(`${base}/api/class/${code}/report`)).status).toBe(405);
    expect((await post(`/api/class/${code}`, {})).status).toBe(405);
    expect((await post('/api/class', { code: 'hello' })).status).toBe(400);
    expect((await fetch(`${base}/api/classes`)).status).toBe(404);
    // Mission Control is untouched.
    expect((await post('/api/rooms', {})).status).toBe(201);
  });
});
