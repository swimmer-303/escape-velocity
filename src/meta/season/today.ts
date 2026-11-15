// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "What's new today": a tiny registry of reasons to play today, shown on the Season screen. Any feature can add
// a line with addTodayItem (for example, new rover targets). A line that returns null is skipped today.

export interface TodayItem {
  id: string;
  /** Lowest first. */
  order: number;
  /** One short line, or null when there is nothing new from this feature today. */
  text(): string | null;
  /** A short tag shown before the line, e.g. 'LIVE' or 'NEW'. */
  tag?: () => string | null;
}

const items: TodayItem[] = [];

export function addTodayItem(item: TodayItem): void {
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items.splice(i, 1);
  items.push(item);
  items.sort((a, b) => a.order - b.order);
}

export interface TodayLine {
  id: string;
  text: string;
  tag: string | null;
}

/** Today's lines, in order. A feature that throws is skipped, never breaking the screen. */
export function todayLines(): TodayLine[] {
  const out: TodayLine[] = [];
  for (const it of items) {
    try {
      const text = it.text();
      if (text) out.push({ id: it.id, text, tag: it.tag?.() ?? null });
    } catch (e) {
      console.error(`[season] today item ${it.id} failed`, e);
    }
  }
  return out;
}
