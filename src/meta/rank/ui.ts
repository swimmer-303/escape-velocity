// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Astronaut rank, the screens: XP pop-ups (one per sol, not one per reason), the player card on the title screen,
// the "Missions and rank" dialog, the level-up card (only at a calm moment: the end screen or the title), and a
// small XP chip while a mission is on screen.

import './rank.css';
import { h, clear, prefersReducedMotion } from '../../ui/dom';
import { toast } from '../toast';
import { allLevelRewards, metaContext, rewardsAtLevel, type LevelReward } from '../hooks';
import { MAX_LEVEL, RANKS, nextRank, progressFor, rankFor, rankLastLevel, type LevelProgress, type Rank } from './curve';
import { badge, checkSvg } from './badge';
import { ALL_DONE_BONUS, type MissionSlot } from './daily';
import { XP, dailyView, liveStreak, markCelebrated, onRank, pendingLevels, rankState, type DailyView } from './engine';

// ------------------------------------------------------------------ pop-ups, batched per sol
/** XP that arrives within this window (one sol's worth) shares one pop-up. */
export const BATCH_MS = 300;

interface Batch {
  total: number;
  top: { amount: number; reason: string } | null;
  after: Array<() => void>;
  level: number;
  newRank: Rank | null;
}
let batch: Batch | null = null;
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function currentBatch(): Batch {
  if (!batch) {
    batch = { total: 0, top: null, after: [], level: 0, newRank: null };
    batchTimer = setTimeout(flushToasts, BATCH_MS);
  }
  return batch;
}

function checkIcon(done = true, size = 22): HTMLElement {
  const span = h('span', { class: 'icon' });
  span.innerHTML = checkSvg(done, size);
  return span;
}

/** Show the waiting pop-ups now: the XP total, then finished missions, then a level-up. */
export function flushToasts(): void {
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = null;
  const b = batch;
  batch = null;
  if (!b) return;
  const tier = rankFor(progressFor(rankState().xp).level).tier;
  if (b.total > 0 && b.top) toast(`+${b.total} XP`, b.top.reason, { icon: badge(tier, 24) });
  for (const f of b.after) f();
  if (b.level) {
    const r = rankFor(b.level);
    toast(`Level ${b.level}!`, b.newRank ? `New rank: ${b.newRank.name}!` : `${r.name}, level ${b.level}. Keep going!`, { tone: 'gold', icon: badge(r.tier, 28), ms: 5000 });
    bumpChip(true);
  }
}

onRank((n) => {
  switch (n.kind) {
    case 'xp':
      if (!n.quiet) {
        const b = currentBatch();
        b.total += n.amount;
        if (!b.top || n.amount > b.top.amount) b.top = { amount: n.amount, reason: n.reason };
      }
      break;
    case 'mission':
      currentBatch().after.push(() => toast('Daily mission done!', `${n.def.title}. +${n.def.xp} XP`, { tone: 'good', icon: checkIcon(), ms: 4500 }));
      break;
    case 'all-done':
      currentBatch().after.push(() => toast('All 3 daily missions done!', `+${n.xp} bonus XP. New missions tomorrow.`, { tone: 'cyan', ms: 5000 }));
      break;
    case 'level': {
      const b = currentBatch();
      b.level = Math.max(b.level, n.level);
      if (n.newRank) b.newRank = n.rank;
      break;
    }
    case 'streak':
      if (n.count >= 2) currentBatch().after.push(() => toast(`${n.count} days in a row`, 'Welcome back, astronaut!', { tone: 'cyan' }));
      break;
  }
  bumpChip(false);
});

// ------------------------------------------------------------------ shared bits
function xpBar(p: LevelProgress, cls = 'rk-bar'): HTMLElement {
  const pct = Math.round(p.frac * 100);
  return h(
    'div',
    {
      class: cls,
      role: 'progressbar',
      'aria-label': p.max ? 'Top level reached' : `XP to level ${p.level + 1}`,
      'aria-valuemin': '0',
      'aria-valuemax': String(p.max ? 1 : p.need),
      'aria-valuenow': String(p.max ? 1 : p.into),
      'aria-valuetext': p.max ? 'Top level reached' : `${p.into} of ${p.need} XP`,
    },
    h('span', { class: 'rk-fill', style: `width:${pct}%` }),
  );
}

function xpLine(p: LevelProgress, xp: number): string {
  return p.max ? `${xp.toLocaleString('en-US')} XP. Top level!` : `${p.into} / ${p.need} XP to level ${p.level + 1}`;
}

const SLOT_NAME: Record<MissionSlot, string> = { easy: 'Quick', medium: 'Mission', hard: 'Stretch goal' };

function missionRow(m: DailyView): HTMLElement {
  return h(
    'li',
    { class: m.done ? 'done' : '' },
    checkIcon(m.done, 18),
    h('span', { class: 'rs-mt' }, m.def.title),
    h('span', { class: 'rs-mp' }, m.done ? 'Done' : `${m.progress}/${m.def.goal}`),
  );
}

function arrow() {
  return h('span', { class: 'arrow' });
}

// ------------------------------------------------------------------ the title-screen card
export function titleStrip(): HTMLElement {
  const s = rankState();
  const p = progressFor(s.xp);
  const r = rankFor(p.level);
  const missions = dailyView();
  const done = missions.filter((m) => m.done).length;
  const streak = liveStreak();
  const next = nextRank(p.level);
  const who = h(
    'div',
    { class: 'rs-id' },
    h('div', { class: 'rs-badge' }, badge(r.tier, 64), h('span', { class: 'rs-lv', 'aria-hidden': 'true' }, String(p.level))),
    h(
      'div',
      { class: 'rs-who' },
      h('div', { class: 'rs-kicker' }, 'Astronaut rank'),
      h('div', { class: 'rs-rank' }, r.name),
      h('div', { class: 'rs-level' }, `Level ${p.level}`, h('span', { class: 'rs-of' }, ` of ${MAX_LEVEL}`)),
      xpBar(p),
      h('div', { class: 'rs-xp' }, xpLine(p, s.xp)),
      next ? h('div', { class: 'rs-next' }, 'Next rank: ', h('b', null, next.name), ` at level ${next.from}`) : null,
    ),
  );
  const daily = h(
    'div',
    { class: 'rs-daily' },
    h(
      'div',
      { class: 'rs-dhead' },
      h('span', { class: 'rs-kicker' }, `Today's missions: ${done} of 3 done`),
      streak >= 2 ? h('span', { class: 'rs-streak' }, `${streak} days in a row`) : null,
    ),
    h('ul', { class: 'rs-list' }, missions.map(missionRow)),
    h('button', { class: 'btn small cyan rs-open', onclick: () => openRankDialog() }, 'Missions and rank', arrow()),
  );
  return h('section', { class: 'rank-strip', 'aria-label': 'Your astronaut rank and daily missions' }, h('div', { class: 'rs-inner' }, who, daily));
}

// ------------------------------------------------------------------ the "Missions and rank" dialog
export function openRankDialog(): void {
  const ctx = metaContext();
  if (!ctx) return;
  const back = () => ctx.showTitle();
  ctx.modal(rankDialog(back), { label: 'Missions and rank', wide: true, onClose: back });
}

function rewardPreview(r: LevelReward): HTMLElement | null {
  try {
    return r.preview?.() ?? null;
  } catch {
    return null;
  }
}

function rewardChip(r: LevelReward, level: number): HTMLElement {
  const open = level >= r.level;
  return h(
    'li',
    { class: `rd-reward ${open ? 'open' : 'locked'}` },
    h('span', { class: 'rd-rprev', 'aria-hidden': 'true' }, rewardPreview(r)),
    h('span', { class: 'rd-rtext' }, h('b', null, r.name), h('small', null, `Level ${r.level} · ${r.kind}`)),
    h('span', { class: 'rd-rstate' }, open ? 'Unlocked' : 'Locked'),
  );
}

function ladderRow(rank: Rank, level: number, rewards: LevelReward[]): HTMLElement {
  const last = rankLastLevel(rank);
  const here = level >= rank.from && level <= last;
  const reached = level >= rank.from;
  const mine = rewards.filter((x) => x.level >= rank.from && x.level <= last).sort((a, b) => a.level - b.level);
  const next = nextRank(level);
  const open = here || next?.tier === rank.tier;
  return h(
    'li',
    { class: `rd-rank ${here ? 'here' : reached ? 'reached' : 'locked'}` },
    h(
      'details',
      { open: open || undefined },
      h(
        'summary',
        null,
        badge(rank.tier, 40),
        h('span', { class: 'rd-rname' }, h('b', null, rank.name), h('small', null, rank.from === last ? `Level ${rank.from}` : `Levels ${rank.from} to ${last}`)),
        h('span', { class: 'rd-rtag' }, here ? 'You are here' : reached ? 'Reached' : 'Locked'),
      ),
      h('p', { class: 'rd-blurb' }, rank.blurb),
      mine.length ? h('ul', { class: 'rd-rewards' }, mine.map((x) => rewardChip(x, level))) : h('p', { class: 'rd-none' }, 'A new badge and rank title.'),
    ),
  );
}

function missionCard(m: DailyView): HTMLElement {
  const pct = Math.round((m.progress / m.def.goal) * 100);
  return h(
    'li',
    { class: `rd-mission card ${m.done ? 'done' : ''}` },
    h('div', { class: 'rd-mhead' }, checkIcon(m.done, 22), h('b', null, m.def.title), h('span', { class: 'rd-mxp' }, `+${m.def.xp} XP`)),
    h('p', null, m.def.detail),
    h(
      'div',
      { class: 'rd-mfoot' },
      h('span', { class: 'rd-slot' }, SLOT_NAME[m.def.slot]),
      h(
        'div',
        {
          class: 'rk-bar small',
          role: 'progressbar',
          'aria-label': m.def.title,
          'aria-valuemin': '0',
          'aria-valuemax': String(m.def.goal),
          'aria-valuenow': String(m.progress),
          'aria-valuetext': m.done ? 'Done' : `${m.progress} of ${m.def.goal}`,
        },
        h('span', { class: 'rk-fill', style: `width:${pct}%` }),
      ),
      h('span', { class: 'rd-mcount' }, m.done ? 'Done' : `${m.progress} / ${m.def.goal}`),
    ),
  );
}

function earnList(): Array<[string, string]> {
  return [
    ['Play a sol', `+${XP.sol}`],
    ['Shelter from a solar storm', `+${XP.sheltered}`],
    ['Build an upgrade', `+${XP.upgrade}`],
    ['Launch home', `+${XP.win}`],
    ['Each star', `+${XP.star}`],
    ['Come home early (you still learn)', `+${XP.loss}`],
    ['Finish a 3-crew campaign', `+${XP.campaign}`],
    ['Daily missions', '+50 to +150'],
  ];
}

export function rankDialog(back: () => void): HTMLElement {
  const s = rankState();
  const p = progressFor(s.xp);
  const r = rankFor(p.level);
  const next = nextRank(p.level);
  const missions = dailyView();
  const streak = liveStreak();
  const rewards = allLevelRewards();
  const st = s.stats;
  const stats: Array<[string, number]> = [
    ['Sols played', st.sols],
    ['Solar storms survived', st.storms],
    ['Storms in the shelter', st.sheltered],
    ['Rockets launched', st.launches],
    ['Upgrades built', st.upgrades],
    ['Campaigns finished', st.campaigns],
    ['Missions played', st.missions],
    ['Daily missions done', st.dailyDone],
    ['Best streak (days)', s.streak.best],
    ['Total XP', s.xp],
  ];
  return h(
    'div',
    { class: 'rank-dialog' },
    h(
      'div',
      { class: 'rd-head' },
      h('div', { class: 'rs-badge big' }, badge(r.tier, 96), h('span', { class: 'rs-lv', 'aria-hidden': 'true' }, String(p.level))),
      h(
        'div',
        { class: 'rd-who' },
        h('div', { class: 'kicker' }, 'Astronaut rank'),
        // Focus starts here (not on Back at the bottom), so the dialog opens at the top.
        h('h2', { tabindex: '-1', 'data-autofocus': true }, r.name),
        h('div', { class: 'rs-level' }, `Level ${p.level}`, h('span', { class: 'rs-of' }, ` of ${MAX_LEVEL}`)),
        xpBar(p),
        h('div', { class: 'rs-xp' }, xpLine(p, s.xp)),
        h('p', { class: 'rd-next' }, next ? `Next rank: ${next.name} at level ${next.from}.` : 'You hold the top rank. Amazing work!'),
      ),
    ),
    h('h3', null, "Today's missions"),
    h(
      'p',
      { class: 'rd-note' },
      `New missions every day. Finish all 3 for a bonus of +${ALL_DONE_BONUS} XP.`,
      streak >= 2 ? ` You have played ${streak} days in a row. Nice flying!` : '',
    ),
    h('ul', { class: 'rd-missions' }, missions.map(missionCard)),
    h('h3', null, 'Ranks and rewards'),
    h('p', { class: 'rd-note' }, 'Every level brings you closer to the next rank. Ways to earn XP:'),
    h(
      'ul',
      { class: 'rd-earn' },
      earnList().map(([what, xp]) => h('li', null, what, h('b', null, xp))),
    ),
    h('ol', { class: 'rd-ladder' }, RANKS.map((x) => ladderRow(x, p.level, rewards))),
    h('h3', null, 'Your astronaut record'),
    h(
      'dl',
      { class: 'rd-stats' },
      stats.map(([k, v]) => h('div', { class: 'rd-stat' }, h('dt', null, k), h('dd', null, v.toLocaleString('en-US')))),
    ),
    h('div', { class: 'actions end' }, h('button', { class: 'btn primary', 'data-autofocus': true, onclick: back }, 'Back to title', arrow())),
  );
}

// ------------------------------------------------------------------ the level-up card
let calmTimer: ReturnType<typeof setTimeout> | null = null;

/** Show the level-up card at the next calm moment: after `ms`, if the end screen (or the title) is up. */
export function scheduleCelebration(where: 'title' | 'end', ms: number): void {
  if (calmTimer) clearTimeout(calmTimer);
  calmTimer = setTimeout(() => {
    calmTimer = null;
    tryCelebrate(where);
  }, ms);
}

function reducedMotion(): boolean {
  try {
    return !!metaContext()?.reducedMotion() || prefersReducedMotion() || document.documentElement.classList.contains('reduce-motion');
  } catch {
    return true;
  }
}

/** Show the card if a level is waiting and the screen is calm. */
export function tryCelebrate(where: 'title' | 'end'): boolean {
  if (!pendingLevels().length || document.querySelector('.ev-levelup')) return false;
  // The title: our card is on screen. The end screen: a dialog is open (never the running sol, which has none).
  const calm = where === 'title' ? !!document.querySelector('.rank-strip') : !!document.querySelector('[role="dialog"]');
  if (!calm) return false;
  return !!showCelebration();
}

function confetti(): HTMLElement {
  const colors = ['#ffb627', '#5ef2e6', '#7ddc5a', '#c58bff', '#ff5a4f', '#f4ead8'];
  const bits = Array.from({ length: 28 }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = ((i * 13) % 10) / 10;
    const dur = 1.6 + ((i * 7) % 10) / 10;
    return h('i', { style: `left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s` });
  });
  return h('div', { class: 'ev-lu-burst', 'aria-hidden': 'true' }, h('div', { class: 'ev-lu-rays' }), ...bits);
}

function rewardItem(r: LevelReward): HTMLElement {
  return h(
    'li',
    { class: 'ev-lu-reward' },
    h('span', { class: 'ev-lu-prev', 'aria-hidden': 'true' }, rewardPreview(r)),
    h('span', { class: 'ev-lu-rtext' }, h('b', null, r.name), h('small', null, r.kind)),
  );
}

/** The card itself (also used by tests). Marks the levels as celebrated. */
export function showCelebration(): HTMLElement | null {
  const levels = pendingLevels();
  if (!levels.length) return null;
  markCelebrated();
  const top = levels[levels.length - 1];
  const rank = rankFor(top);
  const newRank = levels.some((l) => rankFor(l).from === l);
  const unlocked = levels.flatMap((l) => rewardsAtLevel(l));
  const comingUp = allLevelRewards()
    .filter((x) => x.level > top)
    .sort((a, b) => a.level - b.level)[0];
  const next = nextRank(top);
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const close = () => {
    overlay.remove();
    // Back to where the player was (or the first button of the dialog underneath).
    const target = before?.isConnected ? before : document.querySelector<HTMLElement>('[role="dialog"] button');
    target?.focus();
  };
  const ok = h('button', { class: 'btn primary', onclick: close }, 'Awesome!');
  const overlay = h(
    'div',
    {
      class: 'ev-levelup',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'ev-lu-title',
      'aria-describedby': 'ev-lu-desc',
      onkeydown: (e: KeyboardEvent) => {
        // Keep keys here (the game listens on the window) and keep focus inside the card.
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Tab') {
          const f = Array.from(overlay.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
          if (!f.length) return;
          const i = f.indexOf(document.activeElement as HTMLElement);
          const j = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
          e.preventDefault();
          f[j].focus();
        }
      },
    },
    reducedMotion() ? null : confetti(),
    h(
      'div',
      { class: 'ev-lu-card' },
      h('div', { class: 'ev-lu-kicker' }, newRank ? 'New rank!' : 'Level up!'),
      h('div', { class: 'ev-lu-hero' }, badge(rank.tier, 96), h('div', { class: 'ev-lu-num', 'aria-hidden': 'true' }, String(top))),
      h('h2', { id: 'ev-lu-title', class: 'ev-lu-title' }, `Level ${top}`),
      h('p', { class: 'ev-lu-rank' }, newRank ? 'You are now a ' : 'Rank: ', h('b', null, rank.name)),
      h('p', { id: 'ev-lu-desc', class: 'ev-lu-blurb' }, rank.blurb),
      unlocked.length
        ? h('section', { class: 'ev-lu-unlocks', 'aria-label': 'Unlocked' }, h('h3', null, 'Unlocked'), h('ul', null, unlocked.map(rewardItem)))
        : null,
      comingUp || next
        ? h(
            'p',
            { class: 'ev-lu-next' },
            comingUp ? `Next unlock: ${comingUp.name} at level ${comingUp.level}.` : '',
            comingUp && next ? ' ' : '',
            next ? `Next rank: ${next.name} at level ${next.from}.` : '',
          )
        : h('p', { class: 'ev-lu-next' }, 'You reached the very top. Legendary!'),
      h('div', { class: 'ev-lu-actions' }, ok),
    ),
  );
  document.body.append(overlay);
  ok.focus();
  try {
    metaContext()?.audio.sfx('win');
  } catch {
    /* sound is a bonus */
  }
  return overlay;
}

// ------------------------------------------------------------------ the XP chip during a mission
let chip: HTMLElement | null = null;

function renderChip(): void {
  if (!chip) return;
  const s = rankState();
  const p = progressFor(s.xp);
  const r = rankFor(p.level);
  clear(chip);
  chip.append(
    badge(r.tier, 26),
    h('span', { class: 'rc-text', 'aria-hidden': 'true' }, h('b', null, `LV ${p.level}`), xpBar(p, 'rk-bar tiny')),
    h('span', { class: 'sr-only' }, `Astronaut level ${p.level}, ${r.name}. ${xpLine(p, s.xp)}.`),
  );
  // The bar inside is decorative here: the sentence above says the same.
  chip.querySelector('[role="progressbar"]')?.removeAttribute('role');
}

/** Show (or refresh) the chip: a mission is on screen. */
export function showChip(): void {
  if (!chip) {
    chip = h('div', { class: 'rank-chip' });
    document.body.append(chip);
  }
  renderChip();
}

export function hideChip(): void {
  chip?.remove();
  chip = null;
}

function bumpChip(levelUp: boolean): void {
  if (!chip) return;
  renderChip();
  chip.classList.remove('bump', 'lvl');
  void chip.offsetWidth; // restart the animation
  chip.classList.add(levelUp ? 'lvl' : 'bump');
}

/** Tests: forget timers and anything on screen. */
export function resetRankUi(): void {
  if (batchTimer) clearTimeout(batchTimer);
  if (calmTimer) clearTimeout(calmTimer);
  batch = null;
  batchTimer = null;
  calmTimer = null;
  hideChip();
  document.querySelectorAll('.ev-levelup').forEach((e) => e.remove());
}
