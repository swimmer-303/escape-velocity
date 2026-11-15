// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Tiny pixel icons for Rival Race, drawn as inline SVG from character maps (no emoji, no images).

const SVG_NS = 'http://www.w3.org/2000/svg';

function pixels(map: string[], colors: Record<string, string>, size: number, label?: string): SVGSVGElement {
  const w = map[0].length;
  const hgt = map.length;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(Math.round((size * hgt) / w)));
  svg.setAttribute('shape-rendering', 'crispEdges');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === c) run++;
      if (c !== '.' && colors[c]) {
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', String(x));
        r.setAttribute('y', String(y));
        r.setAttribute('width', String(run));
        r.setAttribute('height', '1');
        r.setAttribute('fill', colors[c]);
        svg.append(r);
      }
      x += run;
    }
  });
  return svg;
}

const TROPHY = [
  '.KKKKKKKKKK.',
  'KK.TTTTTT.KK',
  'K.KTTTTTTK.K',
  'K.KTLTTTTK.K',
  'KK.KTTTTK.KK',
  '.KK.KTTK.KK.',
  '....KTTK....',
  '.....KK.....',
  '....KTTK....',
  '...KKKKKK...',
  '...KTTTTK...',
  '..KKKKKKKK..',
];

/** A pixel trophy in a league color. */
export function trophy(color: string, size = 40, label?: string): SVGSVGElement {
  return pixels(TROPHY, { K: '#0b0a18', T: color, L: '#ffffff' }, size, label);
}

const HEART = ['.GG.GG.', 'GLGGGGG', 'GGGGGGG', '.GGGGG.', '..GGG..', '...G...'];
const ROCKET = ['...C...', '..CWC..', '..CBC..', '..CWC..', '.CCWCC.', 'C.CCC.C', '..O.O..'];
const HOUSE = ['...M...', '..MMM..', '.MMMMM.', 'MMMMMMM', '.MDDDM.', '.MDKDM.', '.MDKDM.'];

export function statusIcon(status: 'playing' | 'won' | 'lost', size = 14): SVGSVGElement {
  if (status === 'won') return pixels(ROCKET, { C: '#5ef2e6', W: '#f4ead8', B: '#15122b', O: '#ffb627' }, size, 'Launched');
  if (status === 'lost') return pixels(HOUSE, { M: '#c2b59b', D: '#4a3f7a', K: '#0b0a18' }, size, 'Crew headed home early, safe');
  return pixels(HEART, { G: '#7ddc5a', L: '#d9ffc8' }, size, 'Crew safe');
}
