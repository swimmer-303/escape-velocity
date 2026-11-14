// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pixel rank badges, drawn from ASCII grids like src/ui/icons.ts: a 16x16 medallion whose frame color shows the
// rank tier, with a small emblem in the middle (a star, a helmet, a rocket...). No images, no insignia.

// The medallion. F = frame, L = frame light edge, D = frame dark edge, I = inside, K = outline.
const FRAME = [
  '....KKKKKKKK....',
  '..KKFFFFFFFFKK..',
  '.KFFLLLLLLLLFFK.',
  '.KFLIIIIIIIIDFK.',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  'KFLIIIIIIIIIIDFK',
  '.KFLIIIIIIIIDFK.',
  '.KFFDDDDDDDDFFK.',
  '..KKFFFFFFFFKK..',
  '....KKKKKKKK....',
];

const COLORS: Record<string, string> = {
  K: '#0b0a18',
  I: '#15122b',
  W: '#f4ead8',
  Y: '#ffb627',
  y: '#ffe08a',
  O: '#c2562a',
  o: '#7a2e17',
  R: '#ff5a4f',
  G: '#7ddc5a',
  g: '#3f8f3a',
  B: '#8fd3ff',
  b: '#3b6fb0',
  C: '#5ef2e6',
  c: '#2a9d96',
  S: '#9aa0b5',
  s: '#5c6178',
  P: '#c58bff',
  D: '#ecc98f',
};

/** Frame colors per tier: [main, light, dark]. */
const TIERS: Array<[string, string, string]> = [
  ['#9aa0b5', '#d6d9e6', '#5c6178'], // Cadet: steel
  ['#c2562a', '#ecc98f', '#7a2e17'], // Rookie: Mars oxide
  ['#ffb627', '#ffe08a', '#c2562a'], // Pilot: amber
  ['#7ddc5a', '#c8f7a8', '#3f8f3a'], // Engineer: green
  ['#5ef2e6', '#c9fffa', '#2a9d96'], // Scientist: cyan
  ['#8fd3ff', '#e0f4ff', '#3b6fb0'], // Specialist: sky blue
  ['#c58bff', '#ead6ff', '#7a4fb5'], // Commander: violet
  ['#ff5a4f', '#ffb3ad', '#a3271f'], // Flight Director: red
  ['#ff8a3d', '#ffd0a8', '#a8401a'], // Mars Pioneer: sunset orange
  ['#f4ead8', '#ffffff', '#9aa0b5'], // Star Voyager: white
  ['#ffd34d', '#fff3b0', '#c2562a'], // Legend: gold
];

/** 8x8 emblems, one per tier. */
const EMBLEMS: string[][] = [
  // Cadet: a star
  ['...Y....', '...Y....', '..YYY...', 'YYYyYYY.', '.YYYYY..', '..YYY...', '.YY.YY..', '.Y...Y..'],
  // Rookie: a helmet
  ['..WWWW..', '.WWWWWW.', 'WWCCCCWW', 'WCCWCCCW', 'WCCCCCCW', 'WWCCCCWW', '.WWWWWW.', '.SSSSSS.'],
  // Pilot: a rocket
  ['...WW...', '..WWWW..', '..WCCW..', '..WWWW..', '.OWWWWO.', 'OOWWWWOO', 'O.YRRY.O', '...YY...'],
  // Engineer: a gear
  ['..S..S..', '.SSSSSS.', 'SSs..sSS', '.S....S.', '.S....S.', 'SSs..sSS', '.SSSSSS.', '..S..S..'],
  // Scientist: a flask
  ['..WWWW..', '...WW...', '...WW...', '..W..W..', '.W.GG.W.', 'W.GGGG.W', 'WGGgGGGW', '.WWWWWW.'],
  // Specialist: a radio dish
  ['.......Y', '.SSSS.Y.', 'SSSSSSY.', 'SSSSSS..', '.SSSS...', '...SS...', '..SSSS..', '.ssssss.'],
  // Commander: a ringed planet
  ['..PPPP..', '.PWPPPP.', 'YYPPPPYY', 'PYYYYYYP', '.PPPPPP.', '..PPPP..', '........', '........'],
  // Flight Director: an orbit
  ['..CCCC..', '.C....C.', 'C..YY..C', 'C.YYYY.C', 'C.YYYY.C', 'C..YY..W', '.C....C.', '..CCCC..'],
  // Mars Pioneer: Mars
  ['..OOOO..', '.OOoOOO.', 'OOooOOOO', 'OOOOODOO', 'OOOOOOOO', 'ODOOOoOO', '.OOOOOO.', '..OOOO..'],
  // Star Voyager: a comet
  ['.....yy.', '....yWWy', '....yWWy', '...CCyy.', '..CCC...', '.CCc....', 'CCc.....', 'Cc......'],
  // Legend: the Sun
  ['Y..Y..Y.', '.Y.Y.Y..', '..yyy...', 'YYyWyYY.', '..yyy...', '.Y.Y.Y..', 'Y..Y..Y.', '........'],
];

export const BADGE_TIERS = TIERS.length;

const cache = new Map<string, string>();

/** The badge as an SVG string (decorative: aria-hidden). */
export function badgeSvg(tier: number, size = 64): string {
  const t = Math.max(0, Math.min(TIERS.length - 1, Math.floor(tier) || 0));
  const key = `${t}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [main, light, dark] = TIERS[t];
  const frameColor: Record<string, string> = { F: main, L: light, D: dark, I: COLORS.I, K: COLORS.K };
  let rects = '';
  const rect = (x: number, y: number, fill: string) => {
    rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
  };
  FRAME.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = frameColor[row[x]];
      if (c) rect(x, y, c);
    }
  });
  EMBLEMS[t].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]];
      if (c) rect(x + 4, y + 4, c);
    }
  });
  const svg = `<svg class="px-icon rank-badge-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
  cache.set(key, svg);
  return svg;
}

/** The badge in a span, ready to drop into the page. */
export function badge(tier: number, size = 64): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'rank-badge';
  span.innerHTML = badgeSvg(tier, size);
  return span;
}

/** A pixel check mark for finished missions (decorative). */
export function checkSvg(done: boolean, size = 18): string {
  const rows = done
    ? ['KKKKKKKK', 'KggggggK', 'KgggggWK', 'KggggWWK', 'KWggWWgK', 'KWWWWggK', 'KgWWgggK', 'KKKKKKKK']
    : ['KKKKKKKK', 'KssssssK', 'Ks....sK', 'Ks....sK', 'Ks....sK', 'Ks....sK', 'KssssssK', 'KKKKKKKK'];
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x] === '.' ? '#211b40' : COLORS[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  return `<svg class="px-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}
