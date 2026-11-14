// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The 3-sol presenter demo at /demo: it must play the same way at every rehearsal and on stage.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, isShortDemoUrl, SHORT_DEMO_SEED, SHORT_DEMO_PREFILL } from './app';
import { CssStage } from '../render/stage';
import { createMission, getBriefing, runSol } from '../sim/sim';
import { advise } from '../sim/advisor';
import { newCampaign, missionConfigFor } from '../sim/campaign';
import { may2024Pool } from '../data/donki';
import type { Allocation, MissionState } from '../sim/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
  history.replaceState(null, '', '/');
});

describe('short presenter demo', () => {
  it('opens at /demo and ?short, and nowhere else', () => {
    expect(isShortDemoUrl({ pathname: '/demo', search: '' })).toBe(true);
    expect(isShortDemoUrl({ pathname: '/demo/', search: '' })).toBe(true);
    expect(isShortDemoUrl({ pathname: '/', search: '?short' })).toBe(true);
    expect(isShortDemoUrl({ pathname: '/', search: '' })).toBe(false);
    expect(isShortDemoUrl({ pathname: '/', search: '?demo' })).toBe(false);
    expect(isShortDemoUrl({ pathname: '/teacher/', search: '' })).toBe(false);
  });

  // Earth-Mars light time runs from about 3 to 22 minutes; the script must hold for any of them.
  for (const light of [3, 8, 11, 16, 22]) {
    it(`calm, calm, then the real May 8, 2024 X-flare with a warning, and "Suggest a plan" launches on sol 3 (${light} min light time)`, () => {
      const c = { ...newCampaign(SHORT_DEMO_SEED, 'cadet', 'mars'), prefillPct: SHORT_DEMO_PREFILL };
      let s = createMission({ ...missionConfigFor(c, light, may2024Pool()), scenario: 'may2024' });
      const seen: string[] = [];
      while (s.status === 'playing' && s.sol <= 5) {
        const b = getBriefing(s);
        seen.push(`${s.sol}:${b.weather}:${b.warning ? 'warn' : '-'}`);
        const { next, report } = runSol(s, advise(s).alloc, 'food');
        if (s.sol === 3) {
          expect(report.storm?.event.classType?.startsWith('X')).toBe(true);
          expect(report.storm?.event.time.slice(0, 10)).toBe('2024-05-08');
        } else expect(report.storm).toBeUndefined();
        s = next;
      }
      expect(seen).toEqual(['1:clear:-', '2:clear:-', '3:clear:warn']);
      expect(s.status).toBe('won');
      expect(s.sol).toBe(4);
      expect(s.dose).toBeLessThan(s.doseBudget * 0.6);
    });
  }

  it('/demo skips the title and opens sol 1 of the short demo; Play again restarts it', async () => {
    history.replaceState(null, '', '/demo');
    const app = new App(new CssStage());
    const internals = app as unknown as { phase: string; mission: MissionState | null; alloc: Allocation; ff: boolean; plan(): void; run(): Promise<void> };
    expect(internals.phase).toBe('briefing');
    expect(document.body.textContent).toContain('Short demo: three sols.');
    expect(document.getElementById('hud')!.textContent).toContain('SHORT DEMO');
    expect(internals.mission!.fuel).toBe(SHORT_DEMO_PREFILL);
    for (let sol = 1; sol <= 3; sol++) {
      internals.plan();
      internals.alloc = advise(internals.mission!).alloc;
      const running = internals.run();
      internals.ff = true;
      await running;
      expect(internals.phase).toBe('debrief');
      if (sol < 3) (app as unknown as { showBriefing(): void }).showBriefing();
    }
    expect(internals.mission!.status).toBe('won');
    await (app as unknown as { showEnd(w: boolean): Promise<void> }).showEnd(true);
    for (let i = 0; i < 50 && internals.phase !== 'end'; i++) await sleep(10);
    const again = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Play again')!;
    again.click();
    expect(internals.phase).toBe('briefing');
    expect(internals.mission!.sol).toBe(1);
    expect(internals.mission!.fuel).toBe(SHORT_DEMO_PREFILL);
    expect(document.getElementById('hud')!.textContent).toContain('SHORT DEMO');
  }, 60000);
});
