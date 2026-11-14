// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addLevelRewards, emitGame, onGame, playerLevel, renderTitleExtras, setMetaContext, type GameEventMap, type MetaContext } from '../hooks';
import { END_DELAY_MS, TITLE_DELAY_MS } from './index';
import { dailyToday, liveStreak, pendingLevels, rankState, resetRankEngine } from './engine';
import { BATCH_MS, resetRankUi } from './ui';
import { STORAGE_KEY } from './store';
import { missionsForDay } from './daily';
import { fakeMission, fakeReport, fakeStorm } from './fixtures';
import type { Child } from '../../ui/dom';

let now = new Date(2026, 10, 14, 15, 0);
const useDay = (y: number, m: number, d: number) => {
  now = new Date(y, m - 1, d, 15, 0);
};

function sol(over: Parameters<typeof fakeReport>[0] = {}, opts: { demo?: boolean; mode?: GameEventMap['sol']['mode']; site?: 'moon' } = {}) {
  const m = fakeMission({}, opts.site ? { site: opts.site } : {});
  emitGame('sol', { before: m, after: m, report: fakeReport(over), mode: opts.mode ?? 'quick', demo: !!opts.demo });
}

function end(won: boolean, stars: GameEventMap['mission-end']['stars'] = [], demo = false) {
  emitGame('mission-end', { mission: fakeMission({ status: won ? 'won' : 'lost' }), won, mode: 'quick', stars, demo });
}

const toastTexts = () => Array.from(document.querySelectorAll('.ev-toast')).map((t) => t.textContent ?? '');

let modalRoot: HTMLElement;
const sfx = vi.fn();
const showTitle = vi.fn();
const ctx: MetaContext = {
  stage: {} as MetaContext['stage'],
  audio: { sfx } as unknown as MetaContext['audio'],
  modal: (content: Child, opts: { label: string }) => {
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', opts.label);
    const kids = Array.isArray(content) ? content : [content];
    for (const k of kids) if (k instanceof Node) box.append(k);
    modalRoot.replaceChildren(box);
    return box;
  },
  closeModal: () => modalRoot.replaceChildren(),
  showTitle,
  reducedMotion: () => true,
};
setMetaContext(ctx);

function showEndScreen() {
  ctx.modal(Object.assign(document.createElement('button'), { textContent: 'Next crew' }), { label: 'Mission complete' });
}
function showTitleScreen() {
  const box = ctx.modal(renderTitleExtras(), { label: 'Escape Velocity title screen' });
  return box;
}

/** Today's missions, set by hand (the real pick depends on the date). These three never trigger by accident here. */
const QUIET_MISSIONS = ['crate', 'history', 'monitor'];
function seedDaily(ids: string[], progress = [0, 0, 0]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, xp: 0, celebrated: 1, daily: { date: '2026-11-14', ids, progress, bonus: false } }));
  resetRankEngine({ clock: () => now });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useDay(2026, 11, 14);
  seedDaily(QUIET_MISSIONS);
  resetRankUi();
  document.body.replaceChildren();
  modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  document.body.append(modalRoot);
  sfx.mockClear();
  showTitle.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('XP from the game', () => {
  it('gives XP for a sol, a storm survived in the shelter and an upgrade, in one pop-up', () => {
    sol({ storm: fakeStorm({ shelterCells: 1, classType: 'X1.1' }), built: 'panel' });
    expect(rankState().xp).toBe(10 + 25 + 40);
    expect(rankState().stats).toMatchObject({ sols: 1, storms: 1, sheltered: 1, upgrades: 1 });
    expect(toastTexts()).toEqual([]);
    vi.advanceTimersByTime(BATCH_MS);
    const t = toastTexts();
    expect(t).toHaveLength(1);
    expect(t[0]).toContain('+75 XP');
    expect(t[0]).toContain('Built: Solar panel row');
  });

  it('names the storm the crew sheltered from', () => {
    sol({ storm: fakeStorm({ shelterCells: 2, classType: 'X1.1' }) });
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts()[0]).toContain('an X-class storm');
    expect(toastTexts()[0]).toContain('+35 XP');
  });

  it('gives nothing for a storm without the shelter (but counts it as survived)', () => {
    sol({ storm: fakeStorm({ shelterCells: 0 }) });
    expect(rankState().xp).toBe(10);
    expect(rankState().stats.storms).toBe(1);
    expect(rankState().stats.sheltered).toBe(0);
  });

  it('rewards a launch with stars, and a lost mission too', () => {
    end(true, ['launch', 'safe']);
    expect(rankState().xp).toBe(100 + 50);
    end(false);
    expect(rankState().xp).toBe(150 + 30);
    emitGame('campaign-complete', { campaign: {} as GameEventMap['campaign-complete']['campaign'] });
    expect(rankState().xp).toBe(180 + 300);
    expect(rankState().stats).toMatchObject({ missions: 2, launches: 1, campaigns: 1 });
  });

  it('takes XP from other features, and ignores broken amounts', () => {
    emitGame('xp', { amount: 30, reason: 'New Storm Card: X12.0' });
    emitGame('xp', { amount: NaN, reason: 'bad' });
    emitGame('xp', { amount: -50, reason: 'bad' });
    emitGame('xp', { amount: 999999, reason: 'typo' });
    expect(rankState().xp).toBe(30 + 1000);
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts()[0]).toContain('+1030 XP');
  });

  it('ignores everything from the self-playing demo', () => {
    sol({ storm: fakeStorm(), built: 'panel' }, { demo: true });
    end(true, ['launch', 'safe', 'builder'], true);
    expect(rankState().xp).toBe(0);
    expect(rankState().stats.sols).toBe(0);
    expect(rankState().stats.missions).toBe(0);
    expect(rankState().streak.count).toBe(0);
    expect(document.querySelector('.rank-chip')).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(toastTexts()).toEqual([]);
  });
});

describe('levels', () => {
  it('announces a level-up to the other features and pops up right away', () => {
    const ups: GameEventMap['level-up'][] = [];
    const stop = onGame('level-up', (p) => ups.push(p));
    expect(playerLevel()).toBe(1);
    for (let i = 0; i < 7; i++) sol();
    expect(ups).toEqual([]);
    sol();
    expect(ups).toEqual([{ level: 2, rank: 'Cadet' }]);
    expect(playerLevel()).toBe(2);
    emitGame('xp', { amount: 200, reason: 'test' });
    expect(ups.at(-1)).toEqual({ level: 3, rank: 'Rookie' });
    stop();
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts().some((t) => t.includes('Level 3!') && t.includes('New rank: Rookie'))).toBe(true);
  });

  it('never shows the level-up card during play: it waits for the end screen', () => {
    emitGame('xp', { amount: 100, reason: 'test' });
    sol();
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector('.ev-levelup')).toBeNull();
    expect(pendingLevels()).toEqual([2]);
    showEndScreen();
    end(true);
    vi.advanceTimersByTime(END_DELAY_MS - 10);
    expect(document.querySelector('.ev-levelup')).toBeNull();
    vi.advanceTimersByTime(20);
    const card = document.querySelector('.ev-levelup')!;
    expect(card).not.toBeNull();
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    // 100 + 10 + 100 = 210 XP: level 2.
    expect(card.querySelector('#ev-lu-title')!.textContent).toBe('Level 2');
    expect(pendingLevels()).toEqual([]);
    expect(sfx).toHaveBeenCalledWith('win');
    // Reduced motion: no confetti.
    expect(card.querySelector('.ev-lu-burst')).toBeNull();
    (card.querySelector('button') as HTMLButtonElement).click();
    expect(document.querySelector('.ev-levelup')).toBeNull();
  });

  it('lists the rewards unlocked at the new levels, with their previews', () => {
    addLevelRewards(() => [
      { id: 'suit-red', name: 'Red suit', kind: 'Suit color', level: 2, preview: () => Object.assign(document.createElement('i'), { className: 'swatch-red' }) },
      { id: 'paint-stripes', name: 'Striped rocket', kind: 'Rocket paint', level: 3 },
      { id: 'rover-dog', name: 'Robot dog', kind: 'Rover pet', level: 9 },
    ]);
    emitGame('xp', { amount: 300, reason: 'test' });
    showTitleScreen();
    vi.advanceTimersByTime(TITLE_DELAY_MS + 10);
    const card = document.querySelector('.ev-levelup')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Level 3');
    expect(card.textContent).toContain('Rookie');
    expect(card.textContent).toContain('Red suit');
    expect(card.textContent).toContain('Striped rocket');
    expect(card.querySelector('.swatch-red')).not.toBeNull();
    expect(card.textContent).toContain('Next unlock: Robot dog at level 9');
  });

  it('closes with Escape and keeps keys away from the game', () => {
    emitGame('xp', { amount: 100, reason: 'test' });
    showTitleScreen();
    vi.advanceTimersByTime(TITLE_DELAY_MS + 10);
    const card = document.querySelector<HTMLElement>('.ev-levelup')!;
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
    expect(document.querySelector('.ev-levelup')).toBeNull();
  });

  it('skips the card if the screen moved on before the calm moment', () => {
    emitGame('xp', { amount: 100, reason: 'test' });
    showTitleScreen();
    modalRoot.replaceChildren(); // the player started a mission right away
    vi.advanceTimersByTime(TITLE_DELAY_MS + 10);
    expect(document.querySelector('.ev-levelup')).toBeNull();
    expect(pendingLevels()).toEqual([2]);
  });
});

describe('saving', () => {
  it('keeps XP, stats and the waiting level-up card across visits', () => {
    sol();
    emitGame('xp', { amount: 100, reason: 'test' });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.xp).toBe(110);
    resetRankEngine({ clock: () => now });
    expect(rankState().xp).toBe(110);
    expect(rankState().stats.sols).toBe(1);
    expect(pendingLevels()).toEqual([2]);
  });

  it('falls back to a fresh start when the save is damaged', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    resetRankEngine({ clock: () => now });
    expect(rankState().xp).toBe(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 'lots', stats: null, daily: { date: 'soon', ids: [1, 2] }, streak: 7, celebrated: 99 }));
    resetRankEngine({ clock: () => now });
    expect(rankState()).toMatchObject({ xp: 0, celebrated: 1, daily: null, streak: { last: null, count: 0, best: 0 } });
    expect(rankState().stats.sols).toBe(0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ xp: 500, stats: { sols: 12, storms: -4, launches: 'x' }, daily: { date: '2026-11-14', ids: ['nope', 'shelter', 'build'], progress: [0, 0, 0] } }));
    resetRankEngine({ clock: () => now });
    expect(rankState().xp).toBe(500);
    expect(rankState().stats).toMatchObject({ sols: 12, storms: 0, launches: 0 });
    // A save without a celebrated level has nothing waiting; an unknown mission means a fresh pick for today.
    expect(pendingLevels()).toEqual([]);
    expect(dailyToday().ids).toEqual(missionsForDay('2026-11-14').map((m) => m.id));
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    resetRankEngine({ clock: () => now });
    expect(() => sol()).not.toThrow();
    expect(rankState().xp).toBe(10);
    expect(() => renderTitleExtras()).not.toThrow();
  });
});

describe('daily missions', () => {
  const seed = seedDaily;

  it('tracks progress from game events and pays XP when a mission is done', () => {
    seed(['play-sols', 'shelter', 'three-stars']);
    for (let i = 0; i < 4; i++) sol();
    expect(dailyToday().progress).toEqual([4, 0, 0]);
    sol();
    expect(dailyToday().progress).toEqual([5, 0, 0]);
    // 5 sols (50) + the mission (50).
    expect(rankState().xp).toBe(100);
    expect(rankState().stats.dailyDone).toBe(1);
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts().some((t) => t.includes('Daily mission done!') && t.includes('Play 5 sols'))).toBe(true);
    // A finished mission stops counting.
    sol();
    expect(dailyToday().progress[0]).toBe(5);
  });

  it('pays a bonus for all three, once', () => {
    seed(['play-sols', 'shelter', 'three-stars'], [4, 0, 0]);
    sol({ storm: fakeStorm({ shelterCells: 1 }) });
    expect(dailyToday().progress).toEqual([5, 1, 0]);
    const before = rankState().xp;
    end(true, ['launch', 'safe', 'builder']);
    // Launch (100 + 75) + the stretch mission (150) + the bonus (100).
    expect(rankState().xp - before).toBe(175 + 150 + 100);
    expect(dailyToday().bonus).toBe(true);
    end(true, ['launch', 'safe', 'builder']);
    expect(rankState().xp - before).toBe(2 * 175 + 150 + 100);
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts().some((t) => t.includes('All 3 daily missions done!'))).toBe(true);
  });

  it('gives new missions on a new day, the same ones for the same date', () => {
    seed(['play-sols', 'shelter', 'three-stars'], [3, 1, 0]);
    useDay(2026, 11, 15);
    const d = dailyToday();
    expect(d.date).toBe('2026-11-15');
    expect(d.progress).toEqual([0, 0, 0]);
    expect(d.ids).toEqual(missionsForDay('2026-11-15').map((m) => m.id));
  });

  it('counts days in a row without ever holding a missed day against anyone', () => {
    sol();
    expect(liveStreak()).toBe(1);
    sol();
    expect(rankState().streak.count).toBe(1);
    useDay(2026, 11, 15);
    expect(liveStreak()).toBe(1); // yesterday still counts until you play today
    sol();
    expect(liveStreak()).toBe(2);
    vi.advanceTimersByTime(BATCH_MS);
    expect(toastTexts().some((t) => t.includes('2 days in a row'))).toBe(true);
    useDay(2026, 11, 18);
    expect(liveStreak()).toBe(0);
    sol();
    expect(liveStreak()).toBe(1);
    expect(rankState().streak.best).toBe(2);
  });
});

describe('screens', () => {
  it('puts a player card at the top of the title screen', () => {
    emitGame('xp', { amount: 300, reason: 'test' });
    const extras = renderTitleExtras();
    const strip = extras.find((e) => e.classList.contains('rank-strip'))!;
    expect(strip).toBeTruthy();
    expect(strip.getAttribute('aria-label')).toBe('Your astronaut rank and daily missions');
    expect(strip.querySelector('.rs-rank')!.textContent).toBe('Rookie');
    expect(strip.textContent).toContain('Level 3');
    expect(strip.textContent).toContain('40 / 280 XP to level 4');
    expect(strip.querySelector('svg')).not.toBeNull();
    const bar = strip.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    const items = strip.querySelectorAll('.rs-list li');
    expect(items).toHaveLength(3);
    expect(Array.from(items).map((li) => li.querySelector('.rs-mt')!.textContent)).toEqual(['Open a supply crate', 'Play 3 sols of the May 2024 storms', 'Get a storm warning from your own monitor']);
    expect(strip.querySelector('.rs-open')!.textContent).toContain('Missions and rank');
  });

  it('marks finished missions with words and a check, not color alone', () => {
    seedDaily(['play-sols', 'shelter', 'build'], [5, 0, 0]);
    const strip = renderTitleExtras()[0];
    const first = strip.querySelectorAll('.rs-list li')[0];
    expect(first.classList.contains('done')).toBe(true);
    expect(first.textContent).toContain('Done');
    expect(strip.textContent).toContain('1 of 3 done');
  });

  it('opens the missions and rank dialog, and Back returns to the title', () => {
    addLevelRewards(() => [{ id: 'suit-teal', name: 'Teal suit', kind: 'Suit color', level: 4 }]);
    const strip = renderTitleExtras()[0];
    (strip.querySelector('.rs-open') as HTMLButtonElement).click();
    const dlg = modalRoot.querySelector('[aria-label="Missions and rank"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.querySelectorAll('.rd-mission')).toHaveLength(3);
    expect(dlg.querySelectorAll('.rd-rank')).toHaveLength(11);
    expect(dlg.querySelector('.rd-rank.here')!.textContent).toContain('Cadet');
    expect(dlg.textContent).toContain('Teal suit');
    expect(dlg.textContent).toContain('Locked');
    expect(dlg.textContent).toContain('Sols played');
    expect(dlg.textContent).toContain('Campaigns finished');
    (Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent?.includes('Back to title')) as HTMLButtonElement).click();
    expect(showTitle).toHaveBeenCalled();
  });

  it('shows an XP chip while a mission is on screen, and hides it on the title', () => {
    sol();
    const chip = document.querySelector('.rank-chip')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('LV 1');
    expect(chip.textContent).toContain('10 / 80 XP to level 2');
    renderTitleExtras();
    expect(document.querySelector('.rank-chip')).toBeNull();
  });

  it('uses no emoji anywhere', () => {
    sol({ storm: fakeStorm(), built: 'panel' });
    end(true, ['launch']);
    const strip = renderTitleExtras()[0];
    document.body.append(strip);
    vi.advanceTimersByTime(BATCH_MS);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
