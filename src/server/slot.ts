// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Where the class boards and the daily challenge keep their saved JSON between restarts:
// a file in the Node server (./file-slot.ts) or rows in the Durable Object's SQLite storage on
// Cloudflare (deploy/worker.ts). The stores only see this small interface.

export interface SaveSlot {
  /** Where the text lives, for log messages. */
  readonly name: string;
  /** The saved text, or null if nothing was saved yet. Throws if it can't be read. */
  read(): string | null;
  /** Replace the saved text all at once (never half written). Throws if it can't be saved. */
  write(text: string): void;
  /** Keep the current (damaged) text aside under another name, so the next save does not overwrite it. */
  setAside(stamp: number): void;
}

/** A slot in memory (tests). */
export function memorySlot(name = 'memory'): SaveSlot & { text: string | null } {
  return {
    name,
    text: null,
    read() {
      return this.text;
    },
    write(text: string) {
      this.text = text;
    },
    setAside() {
      /* nothing to keep */
    },
  };
}
