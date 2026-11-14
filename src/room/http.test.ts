// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Integration test: the real droplet server (deploy/server.ts) in-process on a random port.
// A teacher makes a room, 4 students join, cells are placed through POSTs, a live
// Server-Sent Events stream is read, and the sol that the teacher runs shows up in the stream.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiServer } from '../../deploy/server';
import { builder } from '../sim/strategies';
import { getBriefing } from '../sim/sim';
import { MODULE_IDS, type MissionState, type ModuleId } from '../sim/types';
import { STATION_OF, type JoinResponse, type RoomView } from './protocol';

let base = '';
let close: () => Promise<void>;

beforeAll(async () => {
  // Offline: rooms fall back to the bundled NASA DONKI archive snapshot.
  const { server } = createApiServer({ fetchSnapshot: async () => null, coalesceMs: 5 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => (server.closeAllConnections(), server.close(() => r())));
});
afterAll(() => close());

async function post<T = Record<string, unknown>>(path: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as T };
}

interface Frame {
  event: string;
  data: string;
}

/** A tiny Server-Sent Events reader on node:http (no browser needed). */
function stream(path: string) {
  const frames: Frame[] = [];
  let headers: http.IncomingHttpHeaders = {};
  let buf = '';
  let ended = false;
  const req = http.get(base + path, (res) => {
    headers = res.headers;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f: Frame = { event: 'message', data: '' };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) f.event = line.slice(7);
          else if (line.startsWith('data: ')) f.data += line.slice(6);
        }
        if (f.data) frames.push(f);
      }
    });
    res.on('end', () => (ended = true));
  });
  const states = () => frames.filter((f) => f.event === 'state').map((f) => JSON.parse(f.data) as RoomView);
  return {
    frames,
    states,
    headers: () => headers,
    ended: () => ended,
    close: () => req.destroy(),
    async until<T>(fn: () => T | undefined | null | false, ms = 4000): Promise<T> {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const v = fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`stream: timed out (${frames.length} frames)`);
    },
  };
}

describe('Mission Control over HTTP + Server-Sent Events', () => {
  it('teacher makes a room, 4 students join and place cells, the sol runs, and every screen sees it', async () => {
    const made = await post<{ code: string; teacherToken: string }>('/api/rooms', { difficulty: 'cadet', mode: 'quick' });
    expect(made.status).toBe(201);
    const { code, teacherToken } = made.json;
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{5}$/);

    const info = await fetch(`${base}/api/rooms/${code.toLowerCase()}`).then((r) => r.json());
    expect(info).toMatchObject({ code, phase: 'lobby', players: 0, full: false });

    const kids: JoinResponse[] = [];
    for (const name of ['Ava', 'Ben', 'Cy', 'Dee']) {
      const j = await post<JoinResponse>(`/api/rooms/${code}/join`, { name });
      expect(j.status).toBe(200);
      kids.push(j.json);
    }
    expect((await post(`/api/rooms/${code}/join`, { name: 'ben' })).status).toBe(409);

    const projector = stream(`/api/rooms/${code}/events?teacher=${teacherToken}`);
    const ava = stream(`/api/rooms/${code}/events?token=${kids[0].token}`);
    const first = await ava.until(() => ava.states()[0]);
    expect(ava.headers()['content-type']).toMatch(/^text\/event-stream/);
    expect(ava.headers()['cache-control']).toContain('no-transform');
    expect(first.players.map((p) => p.name)).toEqual(['Ava', 'Ben', 'Cy', 'Dee']);
    expect(first.data.status).toBe('archive');
    const stationOf = new Map(first.players.map((p) => [p.id, p.stations]));
    const tokenFor = (id: ModuleId) => kids.find((k) => stationOf.get(k.playerId)!.includes(STATION_OF[id]))!.token;

    expect((await post(`/api/rooms/${code}/teacher`, { teacherToken, type: 'start' })).status).toBe(200);
    expect((await post(`/api/rooms/${code}/teacher`, { teacherToken, type: 'plan' })).status).toBe(200);
    const planning = await projector.until(() => projector.states().find((s) => s.phase === 'plan'));
    const mission = planning.mission as MissionState;
    expect(mission.sol).toBe(1);

    // Too early: not every cell is placed.
    const early = await post<{ message: string }>(`/api/rooms/${code}/teacher`, { teacherToken, type: 'run' });
    expect(early.status).toBe(409);
    expect(early.json.message).toMatch(/Place every power cell/);

    // Someone tries a module that belongs to another station.
    const wrong = await post(`/api/rooms/${code}/action`, { token: tokenFor('air'), type: 'place', module: 'shelter' });
    expect(wrong.status).toBe(403);

    // Each station places its own cells, through POSTs.
    const { alloc } = builder(mission);
    for (const id of MODULE_IDS) {
      for (let k = 0; k < alloc[id]; k++) {
        const r = await post(`/api/rooms/${code}/action`, { token: tokenFor(id), type: 'place', module: id });
        expect(r.status, `place ${id}`).toBe(200);
      }
    }
    const placed = await ava.until(() => ava.states().find((s) => Object.values(s.alloc).reduce((a, b) => a + b, 0) === getBriefing(mission).cells));
    expect(placed.alloc).toEqual(alloc);
    expect((await post(`/api/rooms/${code}/action`, { token: kids[1].token, type: 'ping', ping: 'ready' })).status).toBe(200);
    await ava.until(() => ava.states().some((s) => s.pings.some((p) => p.from === 'Ben' && p.ping === 'ready')));

    const run = await post(`/api/rooms/${code}/teacher`, { teacherToken, type: 'run' });
    expect(run.status).toBe(200);
    const after = await projector.until(() => projector.states().find((s) => s.phase === 'debrief'));
    expect(after.mission!.sol).toBe(2);
    expect(after.report!.sol).toBe(1);
    await ava.until(() => ava.states().find((s) => s.mission?.sol === 2));

    // Nothing secret ever goes down the stream.
    const all = projector.frames.map((f) => f.data).join('\n') + ava.frames.map((f) => f.data).join('\n');
    expect(all).not.toContain(teacherToken);
    for (const k of kids) expect(all).not.toContain(k.token);

    // Reconnect: the same token rejoins the same player.
    const again = await post<JoinResponse>(`/api/rooms/${code}/join`, { token: kids[2].token });
    expect(again.json).toMatchObject({ playerId: kids[2].playerId, rejoined: true });

    // The teacher closes the room: every stream hears it and ends.
    expect((await post(`/api/rooms/${code}/teacher`, { teacherToken, type: 'end' })).status).toBe(200);
    await ava.until(() => ava.ended());
    expect(ava.frames.some((f) => f.event === 'closed' && f.data.includes('ended'))).toBe(true);
    expect((await fetch(`${base}/api/rooms/${code}`)).status).toBe(404);
    projector.close();
    ava.close();
  }, 20000);

  it('rejects bad requests', async () => {
    const made = await post<{ code: string; teacherToken: string }>('/api/rooms', {});
    const { code } = made.json;
    const big = await fetch(`${base}/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(5000) }) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/api/rooms/${code}/join`, { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/rooms/${code}/join`)).status).toBe(405);
    expect((await post('/api/rooms/ZZZZZ/join', { name: 'Ava' })).status).toBe(404);
    expect((await post('/api/rooms/0000/join', { name: 'Ava' })).status).toBe(404);
    expect((await fetch(`${base}/api/rooms/${code}/events?token=nope`)).status).toBe(403);
    expect((await post(`/api/rooms/${code}/teacher`, { teacherToken: 'guess', type: 'start' })).status).toBe(403);
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
  });
});
