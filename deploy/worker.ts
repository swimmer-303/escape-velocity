// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The live site on Cloudflare (Workers free plan), configured in wrangler.jsonc.
// - The game itself (dist/) is served as static assets, without running this code.
// - Every /api request comes here and goes to ONE Durable Object ("main"), which runs the whole API
//   (src/server/api.ts) in memory, like the single server we had before. Mission Control's live
//   streams stay open on it, and it saves class boards, daily boards and rooms in its own SQLite
//   storage, so a deploy or a quiet spell (the object goes to sleep) loses nothing.
// - NASA space weather and the Sun picture are also kept in Cloudflare's cache for a few minutes.

import { DurableObject } from 'cloudflare:workers';
import { createApi, type Api } from '../src/server/api';
import type { SaveSlot } from '../src/server/slot';
import type { RoomSaver } from '../src/room/store';
import type { Room } from '../src/room/room';

interface Env {
  API: DurableObjectNamespace;
  ASSETS: Fetcher;
}

/** One SQLite row holds at most 2 MB, so long saves are split into parts of this many characters. */
const PART = 500_000;

/** A save slot in the Durable Object's SQLite storage (table `saves`). */
function sqlSlot(state: DurableObjectState, name: string): SaveSlot {
  const sql = state.storage.sql;
  return {
    name: `storage:${name}`,
    read() {
      const rows = sql.exec<{ body: string }>('SELECT body FROM saves WHERE name = ? ORDER BY part', name).toArray();
      return rows.length ? rows.map((r) => r.body).join('') : null;
    },
    write(text: string) {
      state.storage.transactionSync(() => {
        sql.exec('DELETE FROM saves WHERE name = ?', name);
        let part = 0;
        for (let at = 0; at < text.length || part === 0; part++) {
          let end = Math.min(text.length, at + PART);
          // Never split a character that takes two UTF-16 units.
          const code = text.charCodeAt(end - 1);
          if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
          sql.exec('INSERT INTO saves (name, part, body) VALUES (?, ?, ?)', name, part, text.slice(at, end));
          at = end;
        }
      });
    },
    setAside(stamp: number) {
      sql.exec('UPDATE saves SET name = ? WHERE name = ?', `${name}.damaged-${stamp}`, name);
    },
  };
}

/** Mission Control rooms in the Durable Object's SQLite storage (table `rooms`, one row per room). */
function sqlRooms(state: DurableObjectState): RoomSaver {
  const sql = state.storage.sql;
  return {
    load() {
      const rooms: Room[] = [];
      for (const row of sql.exec<{ code: string; body: string }>('SELECT code, body FROM rooms').toArray()) {
        try {
          rooms.push(JSON.parse(row.body) as Room);
        } catch {
          sql.exec('DELETE FROM rooms WHERE code = ?', row.code);
        }
      }
      return rooms;
    },
    save(room: Room) {
      sql.exec('INSERT INTO rooms (code, body) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET body = excluded.body', room.code, JSON.stringify(room));
    },
    remove(code: string) {
      sql.exec('DELETE FROM rooms WHERE code = ?', code);
    },
  };
}

/** The whole API, in one Durable Object. */
export class ApiObject extends DurableObject<Env> {
  private api: Api;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS saves (name TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (name, part)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, body TEXT NOT NULL) WITHOUT ROWID;
    `);
    this.api = createApi({
      classSlot: sqlSlot(state, 'classes.json'),
      dailySlot: sqlSlot(state, 'daily.json'),
      roomSaver: sqlRooms(state),
    });
    this.api.warm();
  }

  fetch(request: Request): Promise<Response> {
    // Cloudflare sets CF-Connecting-IP; nobody can reach this object except through our Worker.
    return this.api.handle(request, request.headers.get('cf-connecting-ip') ?? 'unknown');
  }
}

/** NASA data that every player shares: kept in Cloudflare's cache for as long as its Cache-Control says. */
const SHARED = new Set(['/api/spaceweather', '/api/sun']);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const shared = request.method === 'GET' && SHARED.has(url.pathname);
    if (shared) {
      const hit = await caches.default.match(request);
      if (hit) return hit;
    }
    // locationHint: start the object in eastern North America, near most players.
    const api = env.API.get(env.API.idFromName('main'), { locationHint: 'enam' });
    const response = await api.fetch(request);
    if (shared && response.status === 200 && /\bpublic\b/.test(response.headers.get('cache-control') ?? '')) {
      ctx.waitUntil(caches.default.put(request, response.clone()));
    }
    return response;
  },
};
