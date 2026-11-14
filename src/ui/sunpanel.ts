// Written with AI assistance (Claude Code). See README "Use of AI tools".
// "The Sun right now": NASA SDO's newest picture of the Sun, plus the latest real flare in the DONKI data.
// Full card on the title screen; compact inside the briefing's "Space weather from Earth" card.
// It renders from whatever is known right now (the title screen redraws when the DONKI feed arrives).
// The picture is real NASA imagery, not AI-generated, so it carries a NASA/SDO credit and no watermark.

import { h } from './dom';
import type { SpaceWeatherFeed } from '../data/donki';
import { SDO_HOME_URL, SDO_LATEST_URL, agoText, flareDay, getSunPicture, latestFlare, type SunPicture } from '../data/sun';

export interface SunPanelOptions {
  compact?: boolean;
  /** Defaults to the shared picture (our server first, then NASA directly). */
  picture?: SunPicture | Promise<SunPicture>;
  now?: number;
}

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

/** The latest real flare line, tagged LIVE or ARCHIVE. Null when there is nothing honest to say. */
export function flareLine(feed: SpaceWeatherFeed, opts: { compact?: boolean; now?: number } = {}): HTMLElement | null {
  if (feed.status === 'none') return feed.error ? null : h('div', { class: 'sun-flare' }, 'Checking NASA for the latest solar flare...');
  const snap = feed.snapshot;
  if (!snap) return null;
  const live = feed.status === 'live';
  const now = new Date(opts.now ?? Date.now());
  const tag = h('span', { class: `tag ${live ? 'live' : 'archive'}` }, live ? 'LIVE' : 'ARCHIVE');
  const f = latestFlare(snap);
  if (!f) {
    const from = flareDay(`${snap.startDate}T00:00:00Z`, now);
    const to = flareDay(`${snap.endDate}T00:00:00Z`, now);
    return h('div', { class: 'sun-flare' }, tag, `NASA's DONKI list has no solar flares from ${from} to ${to}.`);
  }
  const when = flareDay(f.peakTime ?? f.beginTime ?? '', now);
  const where = f.activeRegionNum ? `, from sunspot region ${f.activeRegionNum}` : '';
  return h(
    'div',
    { class: 'sun-flare' },
    tag,
    live ? 'Latest real flare: ' : 'Latest flare in our stored NASA data: ',
    h('b', null, f.classType),
    ` on ${when}${where}.`,
    f.link && !opts.compact ? [' ', link(f.link, 'NASA record')] : null,
  );
}

export function sunPanel(feed: SpaceWeatherFeed, opts: SunPanelOptions = {}): HTMLElement {
  const now = opts.now ?? Date.now();
  const compact = !!opts.compact;
  const size = compact ? 56 : 96;
  const img = h('img', { width: size, height: size, decoding: 'async', alt: "The Sun in ultraviolet light: a real picture from NASA's Solar Dynamics Observatory" });
  const pic = h('div', { class: 'sun-img' }, img);
  const title = h('b', { class: 'sun-title' }, 'The Sun right now');
  const time = h('span', { class: 'sun-time' });
  const credit = h('a', { class: 'sun-credit', href: SDO_HOME_URL, target: '_blank', rel: 'noopener' }, 'Image: NASA/SDO');
  const about = compact
    ? h('div', { class: 'sun-about' }, title, ", seen by NASA's Solar Dynamics Observatory. ", time, ' ', credit)
    : h(
        'div',
        { class: 'sun-about' },
        title,
        h('p', null, "Seen by NASA's Solar Dynamics Observatory. ", time),
        h('p', { class: 'sun-why' }, 'Its camera sees ultraviolet light that our eyes cannot see, so NASA colors it gold. Bright spots with loops are busy sunspot regions, where solar flares burst out.'),
        credit,
      );
  const flare = flareLine(feed, { compact, now });
  const panel = h('div', { class: `sun-panel${compact ? ' compact' : ' card'}`, role: 'group', 'aria-label': 'The Sun right now' }, pic, h('div', { class: 'sun-body' }, about, flare));

  let triedDirect = false;
  const noPicture = () => {
    pic.hidden = true;
    about.hidden = true;
    if (!flare) panel.hidden = true;
  };
  const show = (p: SunPicture) => {
    if (p.via === 'direct') triedDirect = true;
    const ago = agoText(p.takenAt, now);
    const old = p.takenAt != null && now - Date.parse(p.takenAt) > 3 * 3_600_000;
    title.textContent = old ? 'A recent picture of the Sun' : 'The Sun right now';
    time.textContent = ago
      ? `Picture taken ${ago}.`
      : p.takenAt
        ? `Picture taken on ${flareDay(p.takenAt, new Date(now))}.`
        : 'NASA adds a new picture about every 10 minutes.';
    img.src = p.src;
  };
  // Our server's copy failed to show: try NASA's own file once, then hide the picture.
  img.addEventListener('error', () => {
    if (!triedDirect) show({ src: SDO_LATEST_URL, via: 'direct', takenAt: null });
    else noPicture();
  });
  const p = opts.picture ?? getSunPicture(now);
  if (p instanceof Promise) p.then(show, noPicture);
  else show(p);
  return panel;
}
