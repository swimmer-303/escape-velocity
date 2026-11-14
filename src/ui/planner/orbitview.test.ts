// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The trip animation must survive a requestAnimationFrame timestamp from slightly before it started:
// browsers stamp a frame with its start time, which can be earlier than the performance.now() taken when
// the animation was scheduled. That made a negative frame index and crashed the Trip planner in Chrome.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { orbitView } from './orbitview';
import { trip } from '../../orbits/transfer';
import { daysSinceJ2000 } from '../../orbits/ephemeris';

afterEach(() => vi.unstubAllGlobals());

describe('trip animation', () => {
  it('draws the first frame without crashing when the frame timestamp is earlier than the start time', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (queued.push(cb), queued.length));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const view = orbitView(false);
    document.body.append(view.el);
    const t = trip('mars', 'earth', daysSinceJ2000(Date.UTC(2026, 10, 14)) + 300, 250);
    expect(t).not.toBeNull();
    view.show(t);
    expect(queued.length).toBeGreaterThan(0);
    // A frame stamped 8 ms before the animation started, then normal frames after it.
    const now = performance.now();
    for (const stamp of [now - 8, now + 16, now + 5000]) {
      const cb = queued.shift()!;
      expect(() => cb(stamp)).not.toThrow();
    }
    expect(view.el.textContent).toMatch(/Day \d+ of \d+/);
    view.el.remove();
  });
});
