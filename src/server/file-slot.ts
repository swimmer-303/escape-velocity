// Written with AI assistance (Claude Code). See README "Use of AI tools".
// A save slot that is one JSON file (Node only: the tests and the local server in deploy/server.ts).
// Writes are atomic: a temp file in the same folder, then a rename over the old one.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SaveSlot } from './slot';

let seq = 0;

export function fileSlot(dir: string, file: string): SaveSlot {
  const path = join(dir, file);
  return {
    name: path,
    read() {
      try {
        return readFileSync(path, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
    write(text: string) {
      const tmp = `${path}.${process.pid}.${++seq}.tmp`;
      try {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(tmp, text, { mode: 0o600 });
        renameSync(tmp, path);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    },
    setAside(stamp: number) {
      try {
        renameSync(path, `${path}.damaged-${stamp}`);
      } catch {
        /* leave it */
      }
    },
  };
}
