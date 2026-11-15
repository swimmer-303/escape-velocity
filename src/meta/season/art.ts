// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Original pixel-style mission patches, drawn as small inline SVGs from simple shapes (planets, rockets, stars,
// the Sun). They are our own designs: no agency logos, insignia or real mission patches. Also the season's
// sun icon for the lobby tile. Decoration only: the name is always written next to it.

import type { CardPatch, PatchShape } from './rewards';

const SHAPES: Record<PatchShape, string> = {
  hex: '<polygon points="24,2 44,13 44,35 24,46 4,35 4,13"/>',
  shield: '<path d="M6 4 H42 V26 Q42 40 24 46 Q6 40 6 26 Z"/>',
  octagon: '<polygon points="15,2 33,2 46,15 46,33 33,46 15,46 2,33 2,15"/>',
  round: '<circle cx="24" cy="24" r="22"/>',
  diamond: '<polygon points="24,1 47,24 24,47 1,24"/>',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function rays(cx: number, cy: number, r0: number, r1: number, n: number, color: string, w = 2): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x0 = (cx + Math.cos(a) * r0).toFixed(1);
    const y0 = (cy + Math.sin(a) * r0).toFixed(1);
    const x1 = (cx + Math.cos(a) * r1).toFixed(1);
    const y1 = (cy + Math.sin(a) * r1).toFixed(1);
    out += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${w}" stroke-linecap="square"/>`;
  }
  return out;
}

function star(cx: number, cy: number, r: number, color: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
}

const ROCKET = (x: number, y: number, s = 1, body = '#f4ead8') =>
  `<g transform="translate(${x} ${y}) scale(${s})">` +
  `<polygon points="0,-12 4,-6 4,6 -4,6 -4,-6" fill="${body}"/>` +
  `<rect x="-2" y="-4" width="4" height="4" fill="#5ef2e6"/>` +
  `<polygon points="-4,2 -8,8 -4,6" fill="#e0402f"/><polygon points="4,2 8,8 4,6" fill="#e0402f"/>` +
  `<polygon points="-3,6 0,13 3,6" fill="#ffb627"/></g>`;

function motif(p: CardPatch): string {
  switch (p.motif) {
    case 'star':
      return star(24, 24, 12, '#ffd34d') + star(24, 24, 5, '#fff3b0');
    case 'first-light':
      return `<rect x="8" y="28" width="32" height="2" fill="#f4ead8"/><path d="M12 28 A12 12 0 0 1 36 28 Z" fill="#ffb627"/>${rays(24, 28, 14, 18, 9, '#ffd34d')}<rect x="10" y="32" width="28" height="6" fill="#7a2e17"/>`;
    case 'sunspot':
      return `<circle cx="24" cy="24" r="12" fill="#ffb627"/><circle cx="20" cy="21" r="3" fill="#7a2e17"/><circle cx="28" cy="27" r="2" fill="#7a2e17"/><circle cx="26" cy="18" r="1.5" fill="#7a2e17"/>`;
    case 'red-planet':
      return `<circle cx="24" cy="22" r="12" fill="#c2562a"/><circle cx="19" cy="18" r="3" fill="#8a3418"/><circle cx="28" cy="26" r="2" fill="#8a3418"/><rect x="14" y="13" width="8" height="2" fill="#f4ead8"/>${star(38, 36, 3, '#ffd34d')}`;
    case 'rocket':
      return `${ROCKET(24, 22, 1.3)}${star(12, 12, 2.5, '#ffd34d')}${star(36, 34, 2, '#ffd34d')}`;
    case 'two-moons':
      return `<circle cx="22" cy="26" r="10" fill="#c2562a"/><circle cx="36" cy="14" r="3" fill="#a89a8a"/><circle cx="11" cy="12" r="2" fill="#a89a8a"/>`;
    case 'corona':
      return `${rays(24, 24, 11, 17, 16, '#ffd84a', 1.5)}<circle cx="24" cy="24" r="11" fill="#fff3b0"/><circle cx="24" cy="24" r="9" fill="#000"/>`;
    case 'moon-base':
      return `<path d="M4 34 Q24 26 44 34 V46 H4 Z" fill="#9a9aa2"/><path d="M14 31 A7 7 0 0 1 28 31 Z" fill="#e8f0ff"/><rect x="30" y="24" width="2" height="8" fill="#e8f0ff"/><circle cx="34" cy="12" r="5" fill="#5ec8f2"/><circle cx="35" cy="11" r="2" fill="#7ddc5a"/>`;
    case 'comet':
      return `<polygon points="14,34 36,12 38,16 18,36" fill="#5ef2e6" opacity="0.6"/><polygon points="12,30 34,10 36,12 14,32" fill="#c58bff" opacity="0.6"/><circle cx="34" cy="14" r="5" fill="#f4ead8"/>`;
    case 'ringed':
      return `<circle cx="24" cy="24" r="9" fill="#ffcf4a"/><ellipse cx="24" cy="24" rx="17" ry="5" fill="none" stroke="#f4ead8" stroke-width="2" transform="rotate(-20 24 24)"/><rect x="18" y="20" width="12" height="2" fill="#c2862a"/>`;
    case 'magnet':
      return `<circle cx="24" cy="24" r="6" fill="#5ec8f2"/><path d="M24 18 C8 6 8 42 24 30 M24 18 C40 6 40 42 24 30" fill="none" stroke="#7ddc5a" stroke-width="2"/><path d="M24 15 C2 0 2 48 24 33 M24 15 C46 0 46 48 24 33" fill="none" stroke="#7ddc5a" stroke-width="1.5" opacity="0.7"/>`;
    case 'sunburst':
      return `${rays(24, 24, 8, 19, 12, '#ffd34d', 3)}<circle cx="24" cy="24" r="8" fill="#fff3b0"/>`;
    case 'lander':
      return `<rect x="16" y="16" width="16" height="10" fill="#e8b832"/><rect x="20" y="12" width="8" height="4" fill="#f4ead8"/><line x1="16" y1="26" x2="10" y2="36" stroke="#f4ead8" stroke-width="2"/><line x1="32" y1="26" x2="38" y2="36" stroke="#f4ead8" stroke-width="2"/><rect x="6" y="36" width="36" height="3" fill="#c2562a"/>`;
    case 'solar-max':
      return `<circle cx="24" cy="22" r="10" fill="#ff9a3c"/><path d="M18 14 C14 2 34 2 30 14" fill="none" stroke="#ffd84a" stroke-width="3"/>${rays(24, 22, 11, 15, 10, '#ffd84a')}`;
    case 'escape':
      return `<path d="M2 46 Q24 30 46 46 Z" fill="#c2562a"/><line x1="24" y1="36" x2="24" y2="26" stroke="#ffb627" stroke-width="2" stroke-dasharray="2 2"/>${ROCKET(24, 16, 1)}`;
    case 'aurora':
      return `<path d="M6 22 Q14 12 22 20 T38 16 T44 14" fill="none" stroke="#7dffb0" stroke-width="3"/><path d="M6 28 Q16 20 24 26 T42 22" fill="none" stroke="#c58bff" stroke-width="2"/><path d="M4 40 Q24 30 44 40 V46 H4 Z" fill="#1f3a6a"/>`;
    case 'flare':
      return `<circle cx="24" cy="26" r="11" fill="#ff7a1a"/><path d="M17 18 C12 4 32 4 28 17" fill="none" stroke="#ffd84a" stroke-width="3"/>${rays(24, 26, 12, 15, 10, '#ffd84a', 1.5)}`;
    case 'gannon':
      return `<path d="M6 18 Q16 8 24 16 T42 12" fill="none" stroke="#7dffb0" stroke-width="3"/><path d="M6 24 Q16 16 26 22 T42 18" fill="none" stroke="#ff6bd6" stroke-width="2"/><path d="M2 46 Q24 28 46 46 Z" fill="#2a6ab0"/><path d="M14 40 Q20 36 26 39" fill="none" stroke="#7ddc5a" stroke-width="2"/>`;
  }
}

let uid = 0;

/** A mission patch as SVG markup (48x48 view box, drawn at `size` px). */
export function patchMarkup(p: CardPatch, size = 48): string {
  const shape = SHAPES[p.shape];
  const clip = `ss-clip-${++uid}`;
  const mark = p.mark
    ? `<rect x="12" y="35" width="24" height="9" fill="#000" opacity="0.75"/><text x="24" y="42" text-anchor="middle" font-family="monospace" font-size="8" font-weight="700" fill="#fff">${esc(p.mark.slice(0, 5))}</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false">` +
    `<g fill="#000" transform="translate(1.5 1.5)">${shape}</g>` +
    `<g fill="${p.bg}" stroke="${p.rim}" stroke-width="3">${shape}</g>` +
    `<clipPath id="${clip}">${shape}</clipPath>` +
    `<g clip-path="url(#${clip})">${motif(p)}</g>` +
    mark +
    `</svg>`
  );
}

function fromMarkup(markup: string): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = markup;
  return wrap.firstElementChild as SVGSVGElement;
}

export function patchSvg(p: CardPatch, size = 48): SVGSVGElement {
  const el = fromMarkup(patchMarkup(p, size));
  el.classList.add('ss-patch');
  return el;
}

/** The season's icon: a pixel Sun with a flare loop. */
export function sunIcon(size = 48): SVGSVGElement {
  return fromMarkup(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">` +
      `${rays(24, 26, 13, 20, 12, '#ffd84a', 3)}<circle cx="24" cy="26" r="12" fill="#ff9a3c" stroke="#000" stroke-width="2"/>` +
      `<circle cx="20" cy="23" r="2.5" fill="#c2562a"/><path d="M15 17 C10 3 34 3 30 16" fill="none" stroke="#fff3b0" stroke-width="3"/></svg>`,
  );
}

/** A tiny gift box for the welcome-back calendar. */
export function giftIcon(size = 28, open = false): SVGSVGElement {
  return fromMarkup(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false" shape-rendering="crispEdges">` +
      (open
        ? `<rect x="2" y="7" width="12" height="8" fill="#2f8f4a"/><rect x="7" y="7" width="2" height="8" fill="#7ddc5a"/><path d="M5 6 L8 3 L11 6" fill="none" stroke="#7ddc5a" stroke-width="2"/>`
        : `<rect x="2" y="7" width="12" height="8" fill="#ff9a3c"/><rect x="1" y="4" width="14" height="4" fill="#ffd34d"/><rect x="7" y="4" width="2" height="11" fill="#e0402f"/><path d="M4 1 L8 4 L12 1" fill="none" stroke="#e0402f" stroke-width="2"/>`) +
      `</svg>`,
  );
}
