// Written with AI assistance (Claude Code). See README "Use of AI tools".
// @vitest-environment happy-dom
// The Junior Astronaut certificate, drawn on a fake 2D context: what text goes on it, the art credit, print and save.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawCertificate, certForCampaign, certForMission, certificateView, certSummary, CERT_W, type CertData, type CertContext } from './certificate';
import { App } from './app';
import { CssStage } from '../render/stage';
import { newCampaign, type Campaign, type ExpeditionResult } from '../sim/campaign';
import type { MissionState } from '../sim/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TextCall {
  s: string;
  x: number;
  y: number;
  font: string;
  fill: unknown;
}

function fakeContext() {
  const texts: TextCall[] = [];
  const ctx = {
    font: '10px sans-serif',
    fillStyle: '#000' as unknown,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn((s: string, x: number, y: number) => void texts.push({ s, x, y, font: ctx.font, fill: ctx.fillStyle })),
    // About 0.6 em per character.
    measureText: vi.fn((s: string) => ({ width: s.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10) * 0.6 })),
  };
  return { ctx, texts, said: () => texts.map((t) => t.s) };
}

const DATA: CertData = {
  site: 'mars',
  achievement: 'Campaign complete: 3 crews, one base',
  stars: 7,
  maxStars: 9,
  crewsLaunched: 3,
  crewsFlown: 3,
  built: ['Solar panel row x2', 'Battery bank', 'Fission reactor'],
  date: new Date(2026, 10, 14),
};

const draw = (d: CertData, name: string, art: CanvasImageSource | null = null) => {
  const f = fakeContext();
  const out = drawCertificate(f.ctx as unknown as CertContext, d, { name, art });
  return { ...f, out };
};

describe('certificate drawing', () => {
  it('writes the name, stars, crews, base, date and team', () => {
    const { said, texts, ctx } = draw(DATA, '  Ada   Lovelace ');
    const all = said();
    expect(all).toContain('Ada Lovelace');
    expect(all).toContain('7 of 9 stars');
    expect(all).toContain('STARS EARNED');
    expect(all).toContain('3 of 3');
    expect(all).toContain('JUNIOR ASTRONAUT');
    expect(all).toContain('November 14, 2026');
    expect(all).toContain('Escape Velocity · made by Team Escape Velocity');
    expect(all.join(' ')).not.toMatch(/Sendy1/); // the old team name
    expect(all.join(' ')).toMatch(/Solar panel row x2, Battery bank, Fission reactor/);
    expect(all.join(' ')).toMatch(/ran a base on Mars\./);
    // The name is big and bold, centred in its column.
    const name = texts.find((t) => t.s === 'Ada Lovelace')!;
    expect(name.font).toMatch(/^700 \d+px .*Atkinson Hyperlegible/);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // Paper first, the full size of the page.
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, CERT_W, expect.any(Number)]);
  });

  it('credits the AI art only when the art is on it', () => {
    const without = draw(DATA, 'Ada');
    expect(without.out.usedArt).toBe(false);
    expect(without.ctx.drawImage).not.toHaveBeenCalled();
    expect(without.said()).not.toContain('Art: AI-generated');

    const art = { width: 640, height: 360 } as unknown as CanvasImageSource;
    const withArt = draw(DATA, 'Ada', art);
    expect(withArt.out.usedArt).toBe(true);
    expect(withArt.ctx.drawImage).toHaveBeenCalledWith(art, expect.any(Number), expect.any(Number), 640, 360);
    expect(withArt.said()).toContain('Art: AI-generated');
  });

  it('leaves a blank line to write on when no name is typed, and shrinks a long name to fit', () => {
    const blank = draw(DATA, '   ');
    expect(blank.said()).toContain('This certifies that');
    expect(blank.texts.some((t) => t.font.startsWith('700 ') && /px .*Atkinson/.test(t.font) && t.y === 548)).toBe(false);

    const long = draw(DATA, 'Maximiliana Wolfeschlegelst');
    const name = long.texts.find((t) => t.s === 'Maximiliana Wolfeschlegelst')!;
    expect(Number(/(\d+)px/.exec(name.font)![1])).toBeLessThan(76);
    expect(name.s.length * Number(/(\d+)px/.exec(name.font)![1]) * 0.6).toBeLessThanOrEqual(670);
  });

  it('says "the Moon" for a Moon base, and has no stars for the May 2024 replay', () => {
    expect(draw({ ...DATA, site: 'moon' }, 'Ada').said().join(' ')).toMatch(/ran a base on the Moon\./);
    const storms = draw({ ...DATA, stars: null, achievement: 'Replay History: the real May 2024 storms' }, 'Ada').said();
    expect(storms.join(' ')).not.toMatch(/stars/);
    expect(storms).toContain('SPACE WEATHER');
  });
});

describe('certificate data', () => {
  const result = (n: number, status: 'won' | 'lost', stars: number): ExpeditionResult => ({
    n,
    status,
    sols: 12,
    dose: 5,
    doseBudget: 27,
    stars: (['launch', 'safe', 'builder'] as const).slice(0, stars) as ExpeditionResult['stars'],
    built: [],
  });

  it('adds up a whole campaign', () => {
    const c: Campaign = { ...newCampaign('abc', 'cadet'), expedition: 4, results: [result(1, 'won', 3), result(2, 'won', 2), result(3, 'lost', 1)] };
    c.base = { ...c.base, levels: { ...c.base.levels, panel: 2, battery: 1 } };
    const d = certForCampaign(c);
    expect(d).toMatchObject({ site: 'mars', stars: 6, maxStars: 9, crewsLaunched: 2, crewsFlown: 3 });
    expect(d.built).toEqual(['Solar panel row x2', 'Battery bank']);
    expect(certSummary(d, 'Ada')).toMatch(/^Junior Astronaut certificate for Ada\. Campaign complete: 3 crews, one base\. 6 of 9 stars\. Crews launched home: 2 of 3\./);
  });

  it('describes one won mission (quick, campaign crew, or the May 2024 replay)', () => {
    const c = newCampaign('abc', 'cadet', 'moon');
    const m = {
      config: { expedition: 1, site: 'moon' },
      status: 'won',
      dose: 3,
      doseBudget: 27,
      builtThisExpedition: ['panel'],
      base: { levels: { ...c.base.levels, panel: 1 } },
    } as unknown as MissionState;
    const quick = certForMission(m);
    expect(quick).toMatchObject({ site: 'moon', stars: 3, maxStars: 3, crewsLaunched: 1, crewsFlown: 1 });
    expect(quick.achievement).toMatch(/^Quick mission: First Footprints/);
    const inCampaign = certForMission(m, { campaign: { ...c, results: [result(1, 'won', 3)] } });
    expect(inCampaign.achievement).toMatch(/^Crew 1: First Footprints/);
    expect(certForMission(m, { history: true }).stars).toBeNull();
  });
});

describe('certificate dialog', () => {
  let fake: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    document.body.innerHTML = `<div id="app"><div id="stage"></div><header id="hud"></header><main id="dock"></main></div><div id="modal-root"></div>`;
    document.documentElement.className = '';
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
    fake = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fake.ctx) as unknown as HTMLCanvasElement['getContext']);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('redraws as the name is typed, and never saves the name', () => {
    const root = document.getElementById('modal-root')!;
    const back = vi.fn();
    root.append(...(certificateView(DATA, back) as Node[]));
    const input = root.querySelector<HTMLInputElement>('input#cert-name')!;
    expect(root.querySelector('label[for="cert-name"]')?.textContent).toBe('Type your name');
    input.value = 'Ada';
    input.dispatchEvent(new Event('input'));
    expect(fake.said()).toContain('Ada');
    expect(root.querySelector('canvas')!.getAttribute('aria-label')).toMatch(/certificate for Ada\./);
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/Ada/);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Back')!.click();
    expect(back).toHaveBeenCalled();
  });

  it('prints only the certificate, then tidies up', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
    const root = document.getElementById('modal-root')!;
    root.append(...(certificateView(DATA, () => {}) as Node[]));
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Print')!.click();
    await sleep(0);
    expect(print).toHaveBeenCalledTimes(1);
    const holder = document.getElementById('cert-print')!;
    expect(holder.parentElement).toBe(document.body);
    expect(holder.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(document.documentElement.classList.contains('ev-printing-cert')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('cert-print')).toBeNull();
    expect(document.documentElement.classList.contains('ev-printing-cert')).toBe(false);
  });

  it('saves a PNG picture without any network call', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no network')));
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
      cb(new Blob(['png'], { type: 'image/png' }));
    });
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cert');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const root = document.getElementById('modal-root')!;
    root.append(...(certificateView(DATA, () => {}) as Node[]));
    const input = root.querySelector<HTMLInputElement>('input#cert-name')!;
    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input'));
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save picture')!.click();
    expect(created).toHaveBeenCalled();
    expect(clicked[0].getAttribute('download')).toBe('junior-astronaut-certificate-ada-lovelace.png');
    expect(clicked[0].getAttribute('href')).toBe('blob:cert');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is offered at the campaign finale, and Back returns there', async () => {
    const app = new App(new CssStage());
    const c: Campaign = {
      ...newCampaign('abc', 'cadet'),
      expedition: 4,
      results: [1, 2, 3].map((n) => ({ n, status: 'won' as const, sols: 12, dose: 5, doseBudget: 27, stars: ['launch' as const], built: [] })),
    };
    const internals = app as unknown as { campaign: Campaign; mode: string; showFinale(): void };
    internals.campaign = c;
    internals.mode = 'campaign';
    internals.showFinale();
    const get = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Get my certificate')!;
    expect(get).toBeTruthy();
    get.click();
    const dialog = document.querySelector('.modal[aria-label="Junior Astronaut certificate"]')!;
    expect(dialog).not.toBeNull();
    expect(document.activeElement?.id).toBe('cert-name');
    expect(fake.said()).toContain('3 of 9 stars');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Back')!.click();
    expect(document.querySelector('.modal[aria-label="Campaign complete"]')).not.toBeNull();
  });
});
