// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Pixel-art icons drawn from ASCII grids (no emoji: they look different on every device).
// Each character maps to a palette color; '.' is transparent.

const PALETTE: Record<string, string> = {
  K: '#0b0a18', // outline
  W: '#f4ead8', // white
  Y: '#ffb627', // amber
  O: '#c2562a', // oxide
  R: '#ff5a4f', // red
  G: '#7ddc5a', // green
  g: '#3f8f3a', // dark green
  B: '#8fd3ff', // air blue
  b: '#3b6fb0', // dark blue
  C: '#5ef2e6', // cyan
  c: '#2a9d96', // dark cyan
  S: '#9aa0b5', // steel
  s: '#5c6178', // dark steel
  D: '#ecc98f', // dust
  P: '#c58bff', // violet
};

const ICONS = {
  power: [
    '....KKKK',
    '...KYYK.',
    '..KYYK..',
    '.KYYYYK.',
    '..KKYYK.',
    '...KYK..',
    '..KYK...',
    '..KK....',
  ],
  air: [
    '..KKKK..',
    '.KBBBBK.',
    'KBWBBBBK',
    'KBBBBBBK',
    'KBBBBBbK',
    'KBBBBbbK',
    '.KBbbbK.',
    '..KKKK..',
  ],
  food: [
    '....KK..',
    '...KgK..',
    '..KKKKK.',
    '.KRRRRRK',
    'KRWRRRRK',
    'KRRRRRRK',
    '.KRRRRK.',
    '..KKKK..',
  ],
  radiation: [
    '..KKKK..',
    '.KYYYYK.',
    'KYKYYKYK',
    'KYYKKYYK',
    'KYYKKYYK',
    'KYKKKKYK',
    '.KYYYYK.',
    '..KKKK..',
  ],
  rocket: [
    '...KK...',
    '..KWWK..',
    '..KWCK..',
    '..KWWK..',
    '.KWWWWK.',
    'KOKWWKOK',
    'K.KYYK.K',
    '...KK...',
  ],
  o2: [
    'KKKKKKKK',
    'KSSSSSSK',
    'KSBKKCSK',
    'KSBKKCSK',
    'KSSSSSSK',
    'KsSsSsSK',
    'KKKKKKKK',
    '.K....K.',
  ],
  greenhouse: [
    '...KK...',
    '..KGGK..',
    '.KGgGGK.',
    'KGGGgGGK',
    'KGgGGGgK',
    'KGGGGGGK',
    'KOOOOOOK',
    'KKKKKKKK',
  ],
  heater: [
    '...K....',
    '..KRK...',
    '..KRRK..',
    '.KRYRK..',
    '.KRYYRK.',
    'KRYYWYRK',
    'KRYWWYRK',
    '.KKKKKK.',
  ],
  shelter: [
    '.KKKKKK.',
    'KCCCCCCK',
    'KCWCCCCK',
    'KCCCCCCK',
    'KCCCCCcK',
    '.KCCCcK.',
    '..KCcK..',
    '...KK...',
  ],
  monitor: [
    'K......K',
    '.K.KK.K.',
    '..KPPK..',
    '..KPPK..',
    '...KK...',
    '...SS...',
    '..KSSK..',
    '.KKKKKK.',
  ],
  cell: [
    '..KKKK..',
    '.KKKKKK.',
    '.KYYYYK.',
    '.KYKYYK.',
    '.KYYYYK.',
    '.KYKYYK.',
    '.KYYYYK.',
    '.KKKKKK.',
  ],
  sun: [
    'Y..YY..Y',
    '.Y....Y.',
    '..KYYK..',
    'YKYYYYKY',
    'YKYYYYKY',
    '..KYYK..',
    '.Y....Y.',
    'Y..YY..Y',
  ],
  dust: [
    '........',
    '.DD..D..',
    'DDDDDDD.',
    '.D.DDDDD',
    'DDDDD.D.',
    '.DDD.DDD',
    'DD.DDDD.',
    '........',
  ],
  antenna: [
    'K.....K.',
    '.K...K..',
    '..KKK...',
    '..KSK...',
    '...S....',
    '...S....',
    '..KSK...',
    '.KKKKK..',
  ],
  crate: [
    'KKKKKKKK',
    'KOOOOOOK',
    'KODDDDOK',
    'KODOODOK',
    'KODOODOK',
    'KODDDDOK',
    'KOOOOOOK',
    'KKKKKKKK',
  ],
  sound: [
    '....K...',
    '...KK.K.',
    'KKKWK..K',
    'KWWWK.K.',
    'KWWWK.K.',
    'KKKWK..K',
    '...KK.K.',
    '....K...',
  ],
  mute: [
    '....K...',
    '...KK...',
    'KKKWK.R.R',
    'KWWWK..R.',
    'KWWWK.R.R',
    'KKKWK...',
    '...KK...',
    '....K...',
  ],
} as const;

export type IconName = keyof typeof ICONS;

const cache = new Map<string, string>();

export function iconSvg(name: IconName, size = 24): string {
  const key = `${name}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = ICONS[name];
  const w = Math.max(...rows.map((r) => r.length));
  const hgt = rows.length;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
  });
  const svg = `<svg class="px-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hgt}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  cache.set(key, svg);
  return svg;
}

export function icon(name: IconName, size = 24): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = iconSvg(name, size);
  return span;
}
