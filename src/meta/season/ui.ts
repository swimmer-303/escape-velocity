// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Season screens: the Player Card strip and the Season tile on the title screen, the Season Pass screen (tier
// track, Sun event, weekly challenges, welcome-back gifts, what's new today) and the Player Card locker.
// Pop-ups for tiers, challenges and gifts. Keyboard, touch and mouse all work; motion respects reduced motion.

import './season.css';
import { h, prefersReducedMotion } from '../../ui/dom';
import { metaContext, playerLevel } from '../hooks';
import { titleTile } from '../tile';
import { toast } from '../toast';
import { itemById as hangarItem } from '../hangar/items';
import { itemPreview } from '../hangar/preview';
import { MAX_TIER, SEASON_END_WORDS, SEASON_FACT, SEASON_FACT_SOURCE, SEASON_NAME, seasonCountdown, tierProgress, timeLeftWords, xpToReachTier } from './season';
import { BANNERS, FRAMES, TIERS, TITLES, rewardWords, tierOf, type SeasonReward, type TierDef } from './rewards';
import { giftIcon, patchSvg, sunIcon } from './art';
import { nextWeekStart } from './weekly';
import { knownFeed, type LiveSunEvent } from './live';
import { todayLines } from './today';
import {
  GIFTS,
  allPatches,
  cardView,
  claimAll,
  eventPatchArt,
  claimTier,
  claimableTiers,
  eventView,
  giftReady,
  giftStrip,
  isClaimed,
  isOver,
  now,
  onSeason,
  openGift,
  ownedIds,
  patchById,
  rerollCallsign,
  seasonState,
  setCard,
  sunEvent,
  syncBestLevel,
  weeklyView,
  type CardSlot,
  type ChallengeView,
} from './engine';

export const SEASON_LABEL = 'Season Pass';
export const CARD_LABEL = 'Player Card';

function reducedMotion(): boolean {
  try {
    return !!metaContext()?.reducedMotion() || prefersReducedMotion() || document.documentElement.classList.contains('reduce-motion');
  } catch {
    return true;
  }
}

function sfx(name: 'good' | 'win' | 'click' | 'place') {
  try {
    metaContext()?.audio.sfx(name);
  } catch {
    /* sound is a bonus */
  }
}

const fmt = (n: number) => n.toLocaleString('en-US');
/** Toast icons must be HTML elements: wrap an SVG. */
const wrap = (svg: SVGSVGElement): HTMLElement => h('span', { class: 'ss-ico' }, svg);

function bar(value: number, max: number, label: string, text: string, cls = 'ss-bar'): HTMLElement {
  const pct = max > 0 ? Math.round(Math.min(1, value / max) * 100) : 100;
  return h(
    'div',
    { class: cls, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(Math.min(value, max)), 'aria-valuetext': text },
    h('span', { class: 'ss-fill', style: `width:${pct}%` }),
  );
}

// ------------------------------------------------------------------ reward previews
function rewardPreview(x: SeasonReward, size = 40): HTMLElement {
  const box = h('span', { class: `ss-rprev kind-${x.kind}`, 'aria-hidden': 'true' });
  switch (x.kind) {
    case 'patch':
      box.append(patchSvg(patchById(x.id), size));
      break;
    case 'title':
      box.append(h('span', { class: 'ss-rtitle' }, 'TITLE'));
      break;
    case 'banner': {
      const b = BANNERS.find((i) => i.id === x.id);
      box.append(h('span', { class: 'ss-rbanner', style: `background:${b?.css ?? '#000'}` }));
      break;
    }
    case 'frame': {
      const f = FRAMES.find((i) => i.id === x.id);
      box.append(h('span', { class: 'ss-rframe', style: `border-color:${f?.inner ?? '#888'}` }));
      break;
    }
    case 'hangar': {
      const it = hangarItem(x.id);
      if (it) {
        try {
          box.append(itemPreview(it, 'small'));
        } catch {
          /* a preview is decoration */
        }
      }
      break;
    }
  }
  return box;
}

// ------------------------------------------------------------------ pop-ups
let quiet = false;
/** Tests and screens can mute pop-ups for a moment (the season screen shows its own animation). */
export function setQuietToasts(q: boolean): void {
  quiet = q;
}

onSeason((n) => {
  if (quiet) return;
  switch (n.kind) {
    case 'tier': {
      const def = TIERS[n.tier - 1];
      toast(`Season tier ${n.tier}!`, def ? `Claim it: ${def.rewards.map(rewardWords).join(' + ')}.` : '', { tone: 'gold', icon: wrap(sunIcon(28)), ms: 5000 });
      break;
    }
    case 'weekly':
      toast('Weekly challenge done!', `${n.def.title}. +${fmt(n.def.xp)} Season XP`, { tone: 'good', ms: 5000 });
      break;
    case 'event-step':
      toast('Event challenge done!', `${n.def.title}. +${n.def.xp} Season XP`, { tone: 'cyan', ms: 4500 });
      break;
    case 'event-done': {
      const art = allPatches().find((p) => p.id === n.patch.id);
      toast('Event patch earned!', `${art?.name ?? 'A new patch'}. Wear it on your Player Card.`, { tone: 'gold', icon: art ? wrap(patchSvg(art, 28)) : undefined, ms: 6000 });
      break;
    }
    case 'claim':
      break;
    case 'gift':
      break;
  }
});

// ------------------------------------------------------------------ title screen: the Player Card strip
function frameStyle(card: ReturnType<typeof cardView>): string {
  return `background:${card.banner.css};--ss-frame:${card.frame.inner}`;
}

export function cardStrip(): HTMLElement {
  const level = playerLevel();
  syncBestLevel(level);
  const card = cardView();
  return h(
    'section',
    { class: 'ss-strip', 'aria-label': 'Your player card' },
    h(
      'button',
      {
        class: 'ss-pcard',
        type: 'button',
        style: frameStyle(card),
        'aria-label': `Player card: ${card.callsign}, ${card.title.name}, level ${level}. Change your card.`,
        onclick: () => openLocker(),
      },
      h('span', { class: 'ss-pc-patch', 'aria-hidden': 'true' }, patchSvg(card.patch, 44)),
      h('span', { class: 'ss-pc-text', 'aria-hidden': 'true' }, h('span', { class: 'ss-pc-call' }, card.callsign), h('span', { class: 'ss-pc-title' }, card.title.name)),
      h('span', { class: 'ss-pc-lv', 'aria-hidden': 'true' }, `LV ${level}`),
      h('span', { class: 'ss-pc-edit', 'aria-hidden': 'true' }, 'Edit'),
    ),
  );
}

// ------------------------------------------------------------------ title screen: the Season tile
export function seasonTile(): HTMLElement {
  const s = seasonState();
  const p = tierProgress(s.xp);
  const claim = claimableTiers().length;
  const gift = !!giftReady();
  const live = !isOver() && sunEvent().type === 'live';
  const sub = isOver()
    ? `Season 1 complete. Tier ${p.tier} of ${MAX_TIER}`
    : `Tier ${p.tier} of ${MAX_TIER}${claim ? ` · ${claim} to claim` : gift ? ' · a gift is waiting' : ''}`;
  return titleTile({
    id: 'season',
    name: SEASON_NAME,
    sub,
    icon: sunIcon(48),
    badge: live ? 'LIVE' : claim || gift ? 'NEW' : undefined,
    accent: 'gold',
    onClick: () => openSeason(),
  });
}

// ------------------------------------------------------------------ the Season Pass screen
function back(): void {
  metaContext()?.showTitle();
}

/** Escape goes back to the title, like the Back button (the same as the Hangar). */
function escapeGoesBack(box: HTMLElement): void {
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    back();
  });
}

function tierState(t: TierDef, reached: number): 'claimed' | 'ready' | 'locked' {
  if (isClaimed(t.tier)) return 'claimed';
  return t.tier <= reached ? 'ready' : 'locked';
}

function tierCard(t: TierDef, xp: number, onClaim: (tier: number) => void, popped: Set<number>): HTMLElement {
  const reached = tierProgress(xp).tier;
  const st = tierState(t, reached);
  const toGo = Math.max(0, xpToReachTier(t.tier) - xp);
  const words = t.rewards.map(rewardWords).join(' + ');
  return h(
    'li',
    {
      class: `ss-tier ${st}${t.big ? ' big' : ''}${t.tier === reached ? ' here' : ''}${popped.has(t.tier) ? ' pop' : ''}`,
      'data-tier': String(t.tier),
    },
    h('span', { class: 'ss-tnum' }, h('span', { class: 'sr-only' }, 'Tier '), String(t.tier)),
    t.big ? h('span', { class: 'ss-tbig' }, 'Big reward') : null,
    h('span', { class: 'ss-tprevs' }, t.rewards.map((x) => rewardPreview(x, t.big ? 44 : 36))),
    h('span', { class: 'ss-tname' }, words),
    st === 'ready'
      ? h('button', { class: 'btn small go ss-claim', type: 'button', 'data-key': `claim-${t.tier}`, 'aria-label': `Claim tier ${t.tier}: ${words}`, onclick: () => onClaim(t.tier) }, 'Claim')
      : st === 'claimed'
        ? h('span', { class: 'ss-tstate done', 'data-key': `claimed-${t.tier}` }, 'Claimed')
        : h('span', { class: 'ss-tstate' }, h('span', { class: 'sr-only' }, 'Locked. '), `${fmt(toGo)} XP to go`),
    popped.has(t.tier) && !reducedMotion() ? h('span', { class: 'ss-burst', 'aria-hidden': 'true' }) : null,
  );
}

function challengeCard(v: ChallengeView<{ title: string; goal: number; xp: number; detail?: string }>, cls: string): HTMLElement {
  const text = v.done ? 'Done' : `${fmt(v.progress)} of ${fmt(v.def.goal)}`;
  return h(
    'li',
    { class: `${cls}${v.done ? ' done' : ''}` },
    h('div', { class: 'ss-chead' }, h('b', null, v.def.title), h('span', { class: 'ss-cxp' }, `+${fmt(v.def.xp)}`)),
    v.def.detail ? h('p', null, v.def.detail) : null,
    h('div', { class: 'ss-cfoot' }, bar(v.progress, v.def.goal, v.def.title, text, 'ss-bar small'), h('span', { class: 'ss-ccount', 'aria-hidden': 'true' }, v.done ? 'Done' : `${fmt(v.progress)}/${fmt(v.def.goal)}`)),
  );
}

function utcWords(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${date} at ${time} UTC`;
}

// Flare classes: B, C, M and X, each letter ten times stronger than the one before; X is the biggest.
// Source: NASA Scientific Visualization Studio, "X-Class: A Guide to Solar Flares", https://svs.gsfc.nasa.gov/10109
// A CME (coronal mass ejection) is a huge cloud of charged gas the Sun throws out; DONKI lists its speed.
function liveWords(e: LiveSunEvent): string {
  return e.kind === 'flare'
    ? `NASA's DONKI database recorded a real ${e.classType} solar flare on ${utcWords(e.time)}. ${e.classType?.startsWith('X') ? 'X-class flares are the biggest kind.' : 'M-class flares are big: ten times stronger than C-class ones.'}`
    : `NASA's DONKI database recorded a real coronal mass ejection (a giant cloud of solar gas) leaving the Sun at ${fmt(Math.round(e.speedKms ?? 0))} km per second on ${utcWords(e.time)}.`;
}

function eventSection(): HTMLElement {
  const v = eventView();
  const e = v.event;
  const feed = knownFeed();
  const patchArt = eventPatchArt(v.patch);
  const head =
    e.type === 'live'
      ? [
          h('span', { class: 'tag live' }, 'LIVE EVENT'),
          h('h3', null, 'The real Sun just erupted!'),
          h('p', null, liveWords(e)),
          h('p', { class: 'ss-ecount' }, `Event ends in ${timeLeftWords(Date.parse(e.endsAt) - now().getTime())}.`),
        ]
      : [
          h('span', { class: 'tag archive' }, 'ARCHIVE EVENT'),
          h('h3', null, 'The May 2024 Gannon storm'),
          h(
            'p',
            null,
            'On May 10, 2024, the strongest geomagnetic storm in over 20 years hit Earth. NASA calls it the Gannon storm, named for space weather scientist Jennifer Gannon. ',
            e.kp != null ? `NASA's DONKI records list it at Kp ${e.kp}, the top of the scale. ` : '',
            'This is real data from the archive, not live.',
          ),
          h(
            'p',
            { class: 'ss-ecount' },
            feed.status === 'live'
              ? 'Live NASA data is on: no big flare in the last 3 days. When the real Sun erupts, a LIVE event starts here.'
              : 'No live NASA data right now (offline or stored data). A LIVE event only starts with live data.',
          ),
        ];
  const link = e.link ? h('a', { class: 'ss-elink', href: e.link, target: '_blank', rel: 'noopener' }, e.type === 'live' ? 'See the NASA DONKI record' : 'See the storm in NASA DONKI') : null;
  return h(
    'section',
    { class: `ss-event ${e.type}`, 'aria-label': e.type === 'live' ? 'Live event' : 'Archive event' },
    h('div', { class: 'ss-ehead' }, h('div', { class: 'ss-etext' }, ...head, link), h('div', { class: 'ss-epatch' }, patchSvg(patchArt, 72), h('small', null, v.rewarded ? 'Patch earned!' : 'Finish all 3 for this patch'))),
    h('ul', { class: 'ss-clist three' }, v.steps.map((s) => challengeCard(s, 'ss-chal'))),
  );
}

function giftSection(onOpen: () => void): HTMLElement {
  const ready = giftReady();
  const strip = giftStrip();
  return h(
    'section',
    { class: 'ss-gifts', 'aria-label': 'Welcome-back gifts' },
    h('h3', null, 'Welcome-back gifts'),
    h('p', { class: 'ss-note' }, 'A small gift each day you visit. Missing a day never resets your progress or takes anything away: the next gift just waits for you.'),
    h(
      'ol',
      { class: 'ss-days' },
      GIFTS.map((xp, i) => {
        const opened = i < strip.opened;
        const next = !!ready && i === strip.next;
        return h(
          'li',
          { class: `ss-day${opened ? ' opened' : ''}${next ? ' next' : ''}${i === GIFTS.length - 1 ? ' big' : ''}` },
          giftIcon(i === GIFTS.length - 1 ? 34 : 26, opened),
          h('b', null, `Day ${i + 1}`),
          h('small', null, `+${xp} XP`),
          h('span', { class: 'sr-only' }, opened ? 'Opened.' : next ? 'Ready to open.' : 'Coming up.'),
        );
      }),
    ),
    ready
      ? h('button', { class: 'btn go ss-gift-open', type: 'button', 'data-key': 'gift', onclick: onOpen }, `Open today's gift: +${ready.xp} Season XP`)
      : h('p', { class: 'ss-note ok' }, isOver() ? 'Season 1 is complete.' : "Today's gift is opened. Come back tomorrow for the next one!"),
  );
}

function todaySection(): HTMLElement | null {
  const lines = todayLines();
  if (!lines.length) return null;
  return h(
    'section',
    { class: 'ss-today', 'aria-label': "What's new today" },
    h('h3', null, "What's new today"),
    h('ul', null, lines.map((l) => h('li', null, l.tag ? h('span', { class: `tag ${l.tag === 'LIVE' ? 'live' : l.tag === 'ARCHIVE' ? 'archive' : 'real'}` }, l.tag) : null, l.text))),
  );
}

function nextReward(xp: number): HTMLElement {
  const reached = tierProgress(xp).tier;
  const next = TIERS.find((t) => t.tier > reached);
  if (!next) return h('div', { class: 'ss-next' }, h('small', null, 'Next reward'), h('b', null, 'You reached tier 40. Amazing!'));
  return h(
    'div',
    { class: `ss-next${next.big ? ' big' : ''}` },
    h('small', null, `Next reward: tier ${next.tier}`),
    h('span', { class: 'ss-tprevs' }, next.rewards.map((x) => rewardPreview(x, 36))),
    h('b', null, next.rewards.map(rewardWords).join(' + ')),
    h('small', null, `${fmt(Math.max(0, xpToReachTier(next.tier) - xp))} Season XP to go`),
  );
}

/** Open the Season Pass screen. */
export function openSeason(): HTMLElement | null {
  const ctx = metaContext();
  if (!ctx) return null;
  const root = h('div', { class: 'season-screen' });
  const popped = new Set<number>();
  let firstDraw = true;

  const onClaim = (tier: number) => {
    const got = claimTier(tier);
    if (!got) return;
    if (!reducedMotion()) popped.add(tier);
    const big = TIERS[tier - 1]?.big;
    sfx(big ? 'win' : 'good');
    toast(big ? `Big reward: tier ${tier}!` : `Tier ${tier} claimed!`, got.map(rewardWords).join(' + ') + (got.some((x) => x.kind === 'hangar') ? '. Equip it in the Hangar.' : '.'), {
      tone: 'gold',
      icon: rewardPreview(got[0], 28),
      ms: 4500,
    });
    draw(`claimed-${tier}`);
  };
  const onClaimAll = () => {
    const tiers = claimAll();
    if (!tiers.length) return;
    if (!reducedMotion()) for (const t of tiers) popped.add(t);
    sfx('win');
    toast(`${tiers.length} ${tiers.length === 1 ? 'reward' : 'rewards'} claimed!`, `Tiers ${tiers[0]}${tiers.length > 1 ? ` to ${tiers[tiers.length - 1]}` : ''}. Check your Player Card.`, { tone: 'gold', ms: 4500 });
    draw(`claimed-${tiers[tiers.length - 1]}`);
  };
  const onGift = () => {
    const xp = openGift();
    if (!xp) return;
    sfx('good');
    toast('Welcome back!', `+${xp} Season XP. See you tomorrow, astronaut.`, { tone: 'cyan', icon: wrap(giftIcon(28, true)), ms: 4000 });
    draw('gift');
  };

  function draw(focusKey?: string) {
    const oldTrack = root.querySelector<HTMLElement>('.ss-track');
    const keepLeft = oldTrack ? oldTrack.scrollLeft : null;
    const s = seasonState();
    const p = tierProgress(s.xp);
    const over = isOver();
    const claim = claimableTiers();
    const liveNow = sunEvent().type === 'live';
    const track = h(
      'ol',
      { class: 'ss-track', tabindex: '0', 'aria-label': `Season tiers 1 to ${MAX_TIER}. Scroll sideways for more.` },
      TIERS.map((t) => tierCard(t, s.xp, onClaim, popped)),
    );
    const scrollBy = (dir: number) => {
      const step = Math.max(160, track.clientWidth * 0.8);
      track.scrollBy?.({ left: dir * step, behavior: reducedMotion() ? 'auto' : 'smooth' });
    };
    const header = h(
      'div',
      { class: 'ss-head' },
      h('span', { class: 'ss-head-icon', 'aria-hidden': 'true' }, sunIcon(64)),
      h(
        'div',
        { class: 'ss-head-text' },
        h('div', { class: 'kicker' }, 'Season 1'),
        h('h2', { tabindex: '-1', 'data-autofocus': firstDraw ? true : undefined }, 'Solar Maximum'),
        h('p', { class: `ss-count${over ? ' over' : ''}` }, over ? 'Season 1 complete. Thanks for flying! Your rewards are yours to keep.' : `${seasonCountdown(now())} (on ${SEASON_END_WORDS}).`),
        h('div', { class: 'ss-tierline' }, h('b', null, `Tier ${p.tier}`), h('span', null, ` of ${MAX_TIER}`)),
        bar(p.max ? 1 : p.into, p.max ? 1 : p.need, p.max ? 'Top tier reached' : `Season XP to tier ${p.tier + 1}`, p.max ? 'Top tier reached' : `${fmt(p.into)} of ${fmt(p.need)} Season XP`),
        h('div', { class: 'ss-xp' }, p.max ? `${fmt(s.xp)} Season XP. Top tier!` : `${fmt(p.into)} / ${fmt(p.need)} Season XP to tier ${p.tier + 1}`),
      ),
    );
    const parts: Array<HTMLElement | null> = [
      header,
      h('p', { class: 'ss-fact' }, SEASON_FACT, ' ', h('a', { href: SEASON_FACT_SOURCE, target: '_blank', rel: 'noopener' }, 'Source: NASA')),
      over ? null : todaySection(),
      // A LIVE event is the big news, so it goes above the rewards; the ARCHIVE event sits below them.
      !over && liveNow ? eventSection() : null,
      h(
        'section',
        { class: 'ss-pass', 'aria-label': 'Season rewards' },
        h(
          'div',
          { class: 'ss-passhead' },
          h('h3', null, 'Rewards'),
          h('p', { class: 'ss-note' }, 'Every tier is free: just play. Every 5th tier is a big one. Season XP comes from everything you do in the game.'),
          claim.length > 1 ? h('button', { class: 'btn small go', type: 'button', 'data-key': 'claim-all', onclick: onClaimAll }, `Claim all (${claim.length})`) : null,
        ),
        h(
          'div',
          { class: 'ss-passbody' },
          nextReward(s.xp),
          h(
            'div',
            { class: 'ss-scroller' },
            h('button', { class: 'btn small icon-only ss-scroll prev', type: 'button', 'aria-label': 'Earlier tiers', onclick: () => scrollBy(-1) }, h('span', { class: 'ss-arrow left' })),
            track,
            h('button', { class: 'btn small icon-only ss-scroll next', type: 'button', 'aria-label': 'Later tiers', onclick: () => scrollBy(1) }, h('span', { class: 'ss-arrow' })),
          ),
        ),
      ),
      !over && !liveNow ? eventSection() : null,
      over
        ? null
        : h(
            'section',
            { class: 'ss-weekly', 'aria-label': 'Weekly challenges' },
            h('div', { class: 'ss-passhead' }, h('h3', null, 'Weekly challenges'), h('p', { class: 'ss-note' }, `New challenges in ${timeLeftWords(nextWeekStart(now()).getTime() - now().getTime())}. Same 7 for every player this week.`)),
            h('ul', { class: 'ss-clist' }, weeklyView().map((v) => challengeCard(v, 'ss-chal'))),
          ),
      over ? null : giftSection(onGift),
      h(
        'div',
        { class: 'actions end' },
        h('button', { class: 'btn small cyan', type: 'button', onclick: () => openLocker() }, 'Player Card'),
        h('button', { class: 'btn primary', type: 'button', onclick: back }, 'Back to title'),
      ),
    ];
    root.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
    // Show the right part of the track: where it was, or the first reward to claim, or the current tier.
    const target = claim[0] ?? p.tier;
    const scrollToTier = () => {
      if (keepLeft !== null) track.scrollLeft = keepLeft;
      else {
        const li = track.querySelector<HTMLElement>(`[data-tier="${Math.max(1, target - 1)}"]`);
        if (li) track.scrollLeft = Math.max(0, li.offsetLeft - track.offsetLeft);
      }
    };
    scrollToTier();
    requestAnimationFrame?.(scrollToTier);
    if (focusKey) {
      const el = root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) ?? root.querySelector<HTMLElement>('.ss-tier.here .ss-tstate, .ss-track');
      if (el && !el.matches('button, a, [tabindex]')) el.setAttribute('tabindex', '-1');
      el?.focus({ preventScroll: true });
    }
    firstDraw = false;
    window.setTimeout(() => popped.clear(), 1200);
  }

  draw();
  const box = ctx.modal(root, { label: SEASON_LABEL, wide: true, onClose: back });
  box.classList.add('season-modal');
  escapeGoesBack(box);
  return box;
}

// ------------------------------------------------------------------ the Player Card locker
const SLOT_WORDS: Record<CardSlot, string> = { title: 'Title', banner: 'Banner', frame: 'Frame', patch: 'Mission patch' };

function bigCard(): HTMLElement {
  const card = cardView();
  const level = playerLevel();
  return h(
    'div',
    { class: 'ss-bigcard', style: frameStyle(card) },
    h('span', { class: 'ss-bc-patch' }, patchSvg(card.patch, 88)),
    h(
      'div',
      { class: 'ss-bc-text' },
      h('div', { class: 'ss-bc-call' }, card.callsign),
      h('div', { class: 'ss-bc-title' }, card.title.name),
      h('div', { class: 'ss-bc-lv' }, `Astronaut level ${level}`),
    ),
  );
}

function stats(): HTMLElement {
  const s = seasonState();
  const st = s.stats;
  const best = Math.max(st.bestLevel, playerLevel());
  const rows: Array<[string, string]> = [
    ['Missions played', fmt(st.missions)],
    ['Rockets launched', fmt(st.launches)],
    ['Sols played', fmt(st.sols)],
    ['Solar storms survived', fmt(st.storms)],
    ['Best rank', st.bestRank && best === st.bestLevel ? `${st.bestRank}, level ${best}` : `Level ${best}`],
    ['Season tier', `${tierProgress(s.xp).tier} of ${MAX_TIER}`],
    ['Event patches', fmt(s.eventPatches.length)],
  ];
  return h('dl', { class: 'ss-stats' }, rows.map(([k, v]) => h('div', { class: 'ss-stat' }, h('dt', null, k), h('dd', null, v))));
}

interface Option {
  id: string;
  name: string;
  preview: () => Node | null;
}

function optionsFor(slot: CardSlot): Option[] {
  switch (slot) {
    case 'title':
      return TITLES.map((t) => ({ id: t.id, name: t.name, preview: () => null }));
    case 'banner':
      return BANNERS.map((b) => ({ id: b.id, name: b.name, preview: () => h('span', { class: 'ss-rbanner', style: `background:${b.css}` }) }));
    case 'frame':
      return FRAMES.map((f) => ({ id: f.id, name: f.name, preview: () => h('span', { class: 'ss-rframe', style: `border-color:${f.inner}` }) }));
    case 'patch':
      return allPatches().map((p) => ({ id: p.id, name: p.name, preview: () => patchSvg(p, 40) }));
  }
}

function lockText(slot: CardSlot, id: string): string {
  if (slot === 'patch' && /^(live|archive):/.test(id)) return 'Event patch';
  const t = tierOf(slot, id);
  return t > 0 ? `Season tier ${t}` : 'Locked';
}

/** Open the Player Card locker. */
export function openLocker(): HTMLElement | null {
  const ctx = metaContext();
  if (!ctx) return null;
  const root = h('div', { class: 'ss-locker' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  let firstDraw = true;

  function picker(slot: CardSlot): HTMLElement {
    const owned = ownedIds(slot);
    const chosen = seasonState().card[slot];
    const opts = optionsFor(slot);
    const n = opts.filter((o) => owned.has(o.id)).length;
    return h(
      'section',
      { class: `ss-pick ss-pick-${slot}`, 'aria-label': SLOT_WORDS[slot] },
      h('h3', null, SLOT_WORDS[slot], h('small', null, ` ${n} of ${opts.length}`)),
      h(
        'ul',
        { class: 'ss-opts' },
        opts.map((o) => {
          const have = owned.has(o.id);
          const on = o.id === chosen;
          return h(
            'li',
            null,
            h(
              'button',
              {
                class: `ss-opt${on ? ' on' : ''}${have ? '' : ' locked'}`,
                type: 'button',
                'data-key': `${slot}-${o.id}`,
                'aria-pressed': on ? 'true' : 'false',
                'aria-disabled': have ? undefined : 'true',
                'aria-label': have ? `${SLOT_WORDS[slot]}: ${o.name}${on ? ', chosen' : ''}` : `${SLOT_WORDS[slot]}: ${o.name}. Locked: ${lockText(slot, o.id)}`,
                onclick: () => {
                  if (!have) {
                    sfx('click');
                    live.textContent = `${o.name} unlocks at ${lockText(slot, o.id)}.`;
                    return;
                  }
                  if (setCard(slot, o.id)) {
                    sfx('place');
                    live.textContent = `${o.name} chosen.`;
                  }
                  draw(`${slot}-${o.id}`);
                },
              },
              o.preview(),
              h('span', { class: 'ss-oname' }, o.name),
              have ? null : h('small', { class: 'ss-olock' }, lockText(slot, o.id)),
            ),
          );
        }),
      ),
    );
  }

  function draw(focusKey?: string) {
    const card = cardView();
    root.replaceChildren(
      h('div', { class: 'kicker' }, 'Player Card'),
      h('h2', { tabindex: '-1', 'data-autofocus': firstDraw ? true : undefined }, 'Your player card'),
      bigCard(),
      h(
        'div',
        { class: 'ss-callrow' },
        h('div', null, h('small', null, 'Callsign'), h('b', null, card.callsign)),
        h(
          'button',
          {
            class: 'btn small cyan',
            type: 'button',
            'data-key': 'reroll',
            onclick: () => {
              const name = rerollCallsign();
              sfx('click');
              live.textContent = `New callsign: ${name}.`;
              draw('reroll');
            },
          },
          'New callsign',
        ),
      ),
      h('p', { class: 'ss-note' }, 'Callsigns are made from space words and a number, so they are safe to share. Never use your real name online.'),
      picker('title'),
      picker('patch'),
      picker('banner'),
      picker('frame'),
      h('h3', null, 'Your record'),
      stats(),
      live,
      h(
        'div',
        { class: 'actions end' },
        h('button', { class: 'btn small cyan', type: 'button', onclick: () => openSeason() }, 'Season Pass'),
        h('button', { class: 'btn primary', type: 'button', onclick: back }, 'Back to title'),
      ),
    );
    if (focusKey) root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
    firstDraw = false;
  }

  draw();
  const box = ctx.modal(root, { label: CARD_LABEL, wide: true, onClose: back });
  box.classList.add('season-modal');
  escapeGoesBack(box);
  return box;
}
