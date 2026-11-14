// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Junior Astronaut certificate: drawn on a canvas in the game's retro style, with the player's name typed in on
// the spot (it is never saved or sent anywhere), their stars, crews launched, the base they built and today's date.
// "Print" prints only the certificate (print stylesheet in style.css, under "Access"); "Save picture" downloads a PNG.
// Everything happens in the browser: no network calls.

import { h, type Child } from './dom';
import { EXPEDITIONS, siteOf, type Site } from '../sim/constants';
import { starsFor, totalStars, type Campaign } from '../sim/campaign';
import { UPGRADE_IDS, upgradeDef, maxLevel, type Levels } from '../sim/upgrades';
import type { MissionState } from '../sim/types';

export const CERT_W = 1650;
export const CERT_H = 1275; // US Letter, landscape (11 x 8.5 in at 150 dpi)

export interface CertData {
  site: Site;
  /** e.g. "Campaign complete: 3 crews" or "Crew 2: Second Wave". */
  achievement: string;
  /** Null when this mode has no stars (May 2024 storms). */
  stars: number | null;
  maxStars: number;
  crewsLaunched: number;
  crewsFlown: number;
  /** Upgrade names, e.g. "Solar panel row x2". */
  built: string[];
  date: Date;
}

// ------------------------------------------------------------------ data

function builtNames(levels: Levels, site: Site): string[] {
  return UPGRADE_IDS.filter((id) => levels[id] > 0).map((id) => `${upgradeDef(id, site).name}${maxLevel(id) > 1 ? ` x${levels[id]}` : ''}`);
}

/** A won mission. `campaign` is the campaign after this crew finished (campaign mode only). */
export function certForMission(m: MissionState, opts: { campaign?: Campaign | null; history?: boolean; quick?: boolean } = {}): CertData {
  const site = siteOf(m.config);
  const spec = EXPEDITIONS[m.config.expedition - 1];
  const c = opts.campaign ?? null;
  const achievement = opts.history
    ? 'Replay History: the real May 2024 storms'
    : c
      ? `Crew ${m.config.expedition}: ${spec?.name ?? 'mission'} launched home`
      : `Quick mission: ${spec?.name ?? 'mission'} launched home`;
  return {
    site,
    achievement,
    stars: opts.history ? null : starsFor(m).length,
    maxStars: 3,
    crewsLaunched: c ? c.results.filter((r) => r.status === 'won').length : m.status === 'won' ? 1 : 0,
    crewsFlown: c ? Math.max(1, c.results.length) : 1,
    built: builtNames(m.base.levels, site),
    date: new Date(),
  };
}

/** The whole campaign, at the finale. */
export function certForCampaign(c: Campaign): CertData {
  const site = siteOf(c);
  return {
    site,
    achievement: `Campaign complete: ${c.results.length} crews, one base`,
    stars: totalStars(c),
    maxStars: EXPEDITIONS.length * 3,
    crewsLaunched: c.results.filter((r) => r.status === 'won').length,
    crewsFlown: c.results.length,
    built: builtNames(c.base.levels, site),
    date: new Date(),
  };
}

export function cleanName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
}

export function certDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** One sentence that says what the certificate shows (for screen readers and read-aloud). */
export function certSummary(d: CertData, name: string): string {
  const who = cleanName(name) || 'you';
  const stars = d.stars === null ? '' : ` ${d.stars} of ${d.maxStars} stars.`;
  const base = d.built.length ? ` Base built: ${d.built.join(', ')}.` : '';
  return `Junior Astronaut certificate for ${who}. ${d.achievement}.${stars} Crews launched home: ${d.crewsLaunched} of ${d.crewsFlown}.${base} ${certDate(d.date)}.`;
}

// ------------------------------------------------------------------ drawing

const C = {
  paper: '#f4ead8',
  card: '#fffaf0',
  ink: '#0b0a18',
  panel: '#2e2654',
  line: '#4a3f7a',
  rust: '#7a2e17',
  oxide: '#c2562a',
  amber: '#ffb627',
  dust: '#ecc98f',
  sky: '#15122b',
  moon: '#9aa0b5',
  moonDark: '#5c6178',
};
const PX = '"Silkscreen", ui-monospace, monospace';
const BODY = '"Atkinson Hyperlegible", system-ui, sans-serif';

/** The smallest part of CanvasRenderingContext2D the certificate needs (so tests can pass a fake). */
export type CertContext = Pick<
  CanvasRenderingContext2D,
  'fillRect' | 'fillText' | 'measureText' | 'drawImage' | 'save' | 'restore' | 'font' | 'fillStyle' | 'textAlign' | 'textBaseline' | 'imageSmoothingEnabled'
>;

const STAR = ['....K....', '...KYK...', '...KYK...', 'KKKKYKKKK', 'KYYYYYYYK', '.KYYYYYK.', '..KYYYK..', '.KYYKYYK.', '.KK...KK.'];

function sprite(ctx: CertContext, grid: string[], x: number, y: number, px: number, colors: Record<string, string>) {
  grid.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = colors[row[i]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + i * px, y + j * px, px, px);
    }
  });
}

function star(ctx: CertContext, x: number, y: number, size: number, on: boolean) {
  sprite(ctx, STAR, x, y, size / 9, { K: C.ink, Y: on ? C.amber : C.card });
}

function text(ctx: CertContext, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = 'center') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

/** Largest font size (down to `min`) at which `s` fits in `maxW`. */
function fit(ctx: CertContext, s: string, family: string, weight: string, size: number, maxW: number, min = 18): string {
  let px = size;
  for (; px > min; px -= 2) {
    ctx.font = `${weight}${px}px ${family}`;
    if (ctx.measureText(s).width <= maxW) break;
  }
  return `${weight}${px}px ${family}`;
}

/** Word-wrap `s` to `maxW`, at most `maxLines` lines (the last one ends with "..." if it had to stop). */
export function wrap(ctx: CertContext, s: string, maxW: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const tryLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(tryLine).width <= maxW || !line) {
      line = tryLine;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines) {
      line = '';
      const last = lines.pop()!;
      lines.push(`${last.replace(/[,;:]$/, '')}...`);
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The chunky pixel border: a checker of oxide and amber blocks, a dark rule, and riveted corners. */
function border(ctx: CertContext, w: number, hgt: number) {
  const m = 28;
  const p = 18;
  for (let x = m, i = 0; x + p <= w - m + 0.5; x += p, i++) {
    ctx.fillStyle = i % 2 ? C.amber : C.oxide;
    ctx.fillRect(x, m, p, p);
    ctx.fillStyle = i % 2 ? C.oxide : C.amber;
    ctx.fillRect(x, hgt - m - p, p, p);
  }
  for (let y = m, i = 0; y + p <= hgt - m + 0.5; y += p, i++) {
    ctx.fillStyle = i % 2 ? C.amber : C.oxide;
    ctx.fillRect(m, y, p, p);
    ctx.fillStyle = i % 2 ? C.oxide : C.amber;
    ctx.fillRect(w - m - p, y, p, p);
  }
  // Dark rule inside the blocks.
  const r = m + p + 8;
  ctx.fillStyle = C.ink;
  ctx.fillRect(r, r, w - 2 * r, 6);
  ctx.fillRect(r, hgt - r - 6, w - 2 * r, 6);
  ctx.fillRect(r, r, 6, hgt - 2 * r);
  ctx.fillRect(w - r - 6, r, 6, hgt - 2 * r);
  // Rivets in the corners.
  for (const [cx, cy] of [
    [m, m],
    [w - m - 2 * p, m],
    [m, hgt - m - 2 * p],
    [w - m - 2 * p, hgt - m - 2 * p],
  ]) {
    ctx.fillStyle = C.rust;
    ctx.fillRect(cx, cy, 2 * p, 2 * p);
    ctx.fillStyle = C.amber;
    ctx.fillRect(cx + p / 2, cy + p / 2, p, p);
  }
}

/** No title art (the Moon, or the picture has not loaded): a little pixel planet in a starry sky instead. */
function pixelPlanet(ctx: CertContext, x: number, y: number, w: number, hgt: number, site: Site) {
  ctx.fillStyle = C.sky;
  ctx.fillRect(x, y, w, hgt);
  const px = 10;
  ctx.fillStyle = C.paper;
  for (let i = 0; i < 40; i++) ctx.fillRect(x + ((i * 97) % (w - px)), y + ((i * 53) % (hgt - px)), i % 3 ? 4 : 6, i % 3 ? 4 : 6);
  const r = Math.min(w, hgt) * 0.36;
  const cx = x + w / 2;
  const cy = y + hgt / 2;
  const [light, dark] = site === 'moon' ? [C.moon, C.moonDark] : [C.oxide, C.rust];
  for (let gy = -r; gy <= r; gy += px) {
    for (let gx = -r; gx <= r; gx += px) {
      if (gx * gx + gy * gy > r * r) continue;
      const crater = (Math.abs(Math.round(gx / px) * 7 + Math.round(gy / px) * 13) % 11 === 0) || gx + gy > r * 0.7;
      ctx.fillStyle = crater ? dark : light;
      ctx.fillRect(cx + gx, cy + gy, px, px);
    }
  }
}

export interface DrawOptions {
  name: string;
  /** The title art, only if it has loaded. */
  art?: CanvasImageSource | null;
}

/** Draw the certificate. Returns whether the AI-generated title art is on it. */
export function drawCertificate(ctx: CertContext, d: CertData, o: DrawOptions): { usedArt: boolean } {
  const W = CERT_W;
  const H = CERT_H;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  border(ctx, W, H);

  // Title.
  text(ctx, 'ESCAPE VELOCITY', W / 2, 168, `34px ${PX}`, C.rust);
  const title = 'JUNIOR ASTRONAUT';
  const titleFont = fit(ctx, title, PX, '', 92, W - 300, 40);
  text(ctx, title, W / 2 + 6, 272 + 6, titleFont, C.rust);
  text(ctx, title, W / 2, 272, titleFont, C.oxide);
  text(ctx, 'CERTIFICATE', W / 2, 330, `40px ${PX}`, C.panel);

  // Picture on the left, at its real size (640 x 360) so the pixel art stays crisp.
  const ax = 150;
  const ay = 380;
  const aw = 640;
  const ah = 360;
  ctx.fillStyle = C.ink;
  ctx.fillRect(ax - 8, ay - 8, aw + 16, ah + 16);
  let usedArt = false;
  if (o.art) {
    try {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(o.art, ax, ay, aw, ah);
      usedArt = true;
    } catch {
      usedArt = false;
    }
  }
  if (!usedArt) pixelPlanet(ctx, ax, ay, aw, ah, d.site);
  if (usedArt) text(ctx, 'Art: AI-generated', ax, ay + ah + 36, `22px ${BODY}`, C.line, 'left');

  // Who, and what they did.
  const rx = 830;
  const rw = 670;
  const rc = rx + rw / 2;
  text(ctx, 'This certifies that', rc, 440, `34px ${BODY}`, C.ink);
  const name = cleanName(o.name);
  if (name) text(ctx, name, rc, 548, fit(ctx, name, BODY, '700 ', 76, rw, 28), C.ink);
  ctx.fillStyle = C.ink;
  ctx.fillRect(rx, 572, rw, 5);
  ctx.font = `32px ${BODY}`;
  const where = d.site === 'moon' ? 'the Moon' : 'Mars';
  const body = wrap(ctx, `trained as a Junior Astronaut and ran a base on ${where}.`, rw, 2);
  body.forEach((l, i) => text(ctx, l, rc, 630 + i * 42, `32px ${BODY}`, C.ink));
  ctx.font = `26px ${PX}`;
  wrap(ctx, d.achievement.toUpperCase(), rw, 2).forEach((l, i) => text(ctx, l, rc, 730 + i * 34, `26px ${PX}`, C.rust));

  // Three boxes: stars, crews, base.
  const by = 810;
  const bh = 220;
  const bw = 430;
  const gap = 30;
  const boxes = [150, 150 + bw + gap, 150 + 2 * (bw + gap)];
  for (const bx of boxes) {
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = C.card;
    ctx.fillRect(bx + 6, by + 6, bw - 12, bh - 12);
    ctx.fillStyle = C.amber;
    ctx.fillRect(bx + 6, by + 6, bw - 12, 6);
  }
  const mid = (i: number) => boxes[i] + bw / 2;

  if (d.stars === null) {
    text(ctx, 'SPACE WEATHER', mid(0), by + 50, `24px ${PX}`, C.rust);
    ctx.font = `700 32px ${BODY}`;
    wrap(ctx, 'Lived through real solar storms', bw - 40, 3).forEach((l, i) => text(ctx, l, mid(0), by + 110 + i * 38, `700 32px ${BODY}`, C.ink));
  } else {
    text(ctx, 'STARS EARNED', mid(0), by + 50, `24px ${PX}`, C.rust);
    text(ctx, `${d.stars} of ${d.maxStars} stars`, mid(0), by + 112, `700 46px ${BODY}`, C.ink);
    if (d.maxStars <= 10) {
      const size = d.maxStars > 5 ? 36 : 54;
      const step = size + 8;
      const sx = mid(0) - (d.maxStars * step - 8) / 2;
      for (let i = 0; i < d.maxStars; i++) star(ctx, sx + i * step, by + 140, size, i < d.stars);
    }
  }

  text(ctx, 'CREWS LAUNCHED', mid(1), by + 50, `24px ${PX}`, C.rust);
  text(ctx, `${d.crewsLaunched} of ${d.crewsFlown}`, mid(1), by + 116, `700 54px ${BODY}`, C.ink);
  text(ctx, d.crewsLaunched === 1 ? 'crew flew home' : 'crews flew home', mid(1), by + 166, `28px ${BODY}`, C.ink);

  text(ctx, 'BASE BUILT', mid(2), by + 50, `24px ${PX}`, C.rust);
  ctx.font = `26px ${BODY}`;
  const builtText = d.built.length ? d.built.join(', ') : 'The first habitat, ready for the next crew';
  wrap(ctx, builtText, bw - 40, 4).forEach((l, i) => text(ctx, l, mid(2), by + 92 + i * 32, `26px ${BODY}`, C.ink));

  // Date, signature line, and who made the game.
  const fy = 1110;
  text(ctx, certDate(d.date), 150, fy - 12, `30px ${BODY}`, C.ink, 'left');
  ctx.fillStyle = C.ink;
  ctx.fillRect(150, fy, 430, 4);
  text(ctx, 'DATE', 150, fy + 32, `20px ${PX}`, C.line, 'left');
  ctx.fillStyle = C.ink;
  ctx.fillRect(W - 150 - 430, fy, 430, 4);
  text(ctx, 'MISSION DIRECTOR', W - 150, fy + 32, `20px ${PX}`, C.line, 'right');
  text(ctx, 'Escape Velocity · Team Sendy1', W / 2, 1176, `24px ${PX}`, C.rust);

  ctx.restore();
  return { usedArt };
}

// ------------------------------------------------------------------ the dialog

let art: HTMLImageElement | null = null;

function titleArt(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!art) {
    art = new Image();
    art.decoding = 'async';
    art.src = '/art/title.png';
  }
  return art;
}

function artReady(img: HTMLImageElement | null): boolean {
  return !!img && img.complete && img.naturalWidth > 0;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** Print only the certificate: a print-only copy as a picture, shown by the print stylesheet, removed after printing. */
export function printCertificate(canvas: HTMLCanvasElement) {
  document.getElementById('cert-print')?.remove();
  let url: string;
  try {
    url = canvas.toDataURL('image/png');
  } catch {
    return;
  }
  const img = h('img', { src: url, alt: 'Junior Astronaut certificate' });
  const holder = h('div', { id: 'cert-print' }, img);
  document.body.append(holder);
  const root = document.documentElement;
  root.classList.add('ev-printing-cert');
  const done = () => {
    holder.remove();
    root.classList.remove('ev-printing-cert');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  const go = () => {
    try {
      window.print();
    } catch {
      done();
    }
  };
  // Make sure the picture is ready before the print preview is made.
  if (typeof img.decode === 'function') img.decode().then(go, go);
  else go();
}

/** Download the certificate as a PNG picture. */
export function saveCertificate(canvas: HTMLCanvasElement, name = '') {
  const file = `junior-astronaut-certificate${cleanName(name) ? `-${cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : ''}.png`;
  const download = (blob: Blob | null) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: file, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  try {
    canvas.toBlob(download, 'image/png');
  } catch {
    /* nothing to save */
  }
}

/** The certificate dialog: type a name, see the certificate, print it or save it. */
export function certificateView(d: CertData, back: () => void): Child[] {
  const canvas = h('canvas', { class: 'cert-canvas', width: String(CERT_W), height: String(CERT_H), role: 'img', 'aria-label': certSummary(d, '') });
  const input = h('input', {
    id: 'cert-name',
    class: 'cc-input cert-name',
    type: 'text',
    maxlength: '28',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    placeholder: 'Your name',
    'aria-describedby': 'cert-name-note',
    'data-autofocus': true,
  });
  const picture = d.site === 'mars' ? titleArt() : null;
  const ctx = context(canvas);
  const redraw = () => {
    if (!ctx) return;
    drawCertificate(ctx, d, { name: input.value, art: picture && artReady(picture) ? picture : null });
    canvas.setAttribute('aria-label', certSummary(d, input.value));
  };
  input.addEventListener('input', redraw);
  if (picture && !artReady(picture)) picture.addEventListener('load', redraw, { once: true });
  // The pixel font may still be on its way the first time.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.load) Promise.all([fonts.load(`40px ${PX}`), fonts.load(`700 40px ${BODY}`), fonts.load(`40px ${BODY}`)]).then(redraw, () => {});
  redraw();

  return [
    h('div', { class: 'kicker' }, 'Well done'),
    h('h2', null, 'Your Junior Astronaut certificate'),
    h(
      'div',
      { class: 'cert-name-row' },
      h('label', { for: 'cert-name' }, 'Type your name'),
      input,
      h('p', { id: 'cert-name-note', class: 'title-foot' }, 'Your name stays on this screen. It is not saved or sent anywhere.'),
    ),
    ctx
      ? h('div', { class: 'cert-preview' }, canvas)
      : h('p', { class: 'card' }, 'This browser cannot draw the certificate. Try a newer browser.'),
    h(
      'div',
      { class: 'actions' },
      ctx ? h('button', { class: 'btn primary', type: 'button', onclick: () => printCertificate(canvas) }, 'Print') : null,
      ctx ? h('button', { class: 'btn', type: 'button', onclick: () => saveCertificate(canvas, input.value) }, 'Save picture') : null,
      h('button', { class: 'btn', type: 'button', onclick: back }, 'Back'),
    ),
  ];
}
