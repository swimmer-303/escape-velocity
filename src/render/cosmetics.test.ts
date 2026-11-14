// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Hangar's looks in 3D, checked at the object level (no GPU needed): suit colors, rocket paint (a tiny
// nearest-neighbor texture), the rover pet that follows the crew, base lights, and the stage plumbing.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Diorama } from './diorama';
import { SwappableStage, CssStage, type Cosmetics, type Stage } from './stage';
import { ThreeStage } from './three-stage';
import { paintAt, paintPixels, hexRgb, PAINT_W, PAINT_H, NOSE_ROW, type RocketPaint } from './paint';
import { PET_HOME } from './pet';
import { emptyLevels } from '../sim/upgrades';
import { emptyAlloc } from '../sim/sim';

const LOOKS: Cosmetics = {
  suit: { body: '#a065e0', trim: '#4f2d7a' },
  rocket: { pattern: 'checker', colors: ['#f4f0e6', '#1c1c24'], fins: '#1c1c24' },
  pet: { body: '#5ef2e6', trim: '#1f6f6a', eyes: '#ffffff', glow: true },
  lights: '#5ef2e6',
};

const scene = (over: Record<string, unknown> = {}) => ({ sol: 1, weather: 'clear' as const, alloc: emptyAlloc(), fuel: 50, sheltered: false, levels: emptyLevels(), crew: 4, ...over });

const hex = (c: THREE.Color) => `#${c.getHexString()}`;
const suits = (d: Diorama) => {
  const out: THREE.MeshPhongMaterial[] = [];
  d.group.traverse((o) => {
    if (o.name === 'suit') out.push((o as THREE.Mesh).material as THREE.MeshPhongMaterial);
  });
  return out;
};
const hullMat = (d: Diorama) => (d.group.getObjectByName('rocket')!.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

describe('rocket paint pictures', () => {
  const all: RocketPaint[] = [
    { pattern: 'solid', colors: ['#f4f0e6'], fins: '#b2552a' },
    { pattern: 'stripes', colors: ['#f4f0e6', '#e0402f'], fins: '#e0402f' },
    { pattern: 'checker', colors: ['#f4f0e6', '#1c1c24'], fins: '#1c1c24' },
    { pattern: 'gradient', colors: ['#ffd34d', '#ff5a6e', '#3b2a8f'], fins: '#3b2a8f' },
    { pattern: 'flames', colors: ['#1c1c24', '#ff7a1a', '#ffd34d'], fins: '#ff7a1a' },
    { pattern: 'dots', colors: ['#5ef2e6', '#ff8ccf'], fins: '#ff8ccf' },
    { pattern: 'stars', colors: ['#1d1450', '#ffffff', '#c58bff'], fins: '#c58bff' },
    { pattern: 'bolt', colors: ['#2b3f8f', '#ffd34d'], fins: '#ffd34d' },
  ];

  it('every pattern paints every pixel with one of its own colors, and uses more than one where it should', () => {
    for (const p of all) {
      const seen = new Set<string>();
      for (let y = 0; y < PAINT_H; y++) for (let x = 0; x < PAINT_W; x++) seen.add(paintAt(p, x, y));
      for (const c of seen) expect(p.colors).toContain(c);
      if (p.pattern !== 'solid') expect(seen.size, p.pattern).toBeGreaterThan(1);
      expect(paintPixels(p).length).toBe(PAINT_W * PAINT_H * 4);
    }
  });

  it('checks alternate, flames start at the bottom, gradients run bottom to top, and the nose can have its own color', () => {
    const checker = all[2];
    expect(paintAt(checker, 0, 0)).not.toBe(paintAt(checker, 4, 0));
    expect(paintAt(checker, 0, 0)).toBe(paintAt(checker, 4, 4));
    const flames = all[4];
    expect(paintAt(flames, 2, 0)).toBe('#ffd34d'); // hot at the bottom
    expect(paintAt(flames, 2, PAINT_H - 1)).toBe('#1c1c24'); // plain paint up top
    const sunset = all[3];
    expect(paintAt(sunset, 0, 0)).toBe('#ffd34d');
    expect(paintAt(sunset, 0, PAINT_H - 1)).toBe('#3b2a8f');
    const red: RocketPaint = { pattern: 'solid', colors: ['#b2452a'], fins: '#f4f0e6', nose: '#f4f0e6' };
    expect(paintAt(red, 3, NOSE_ROW - 1)).toBe('#b2452a');
    expect(paintAt(red, 3, NOSE_ROW)).toBe('#f4f0e6');
    expect(NOSE_ROW).toBeGreaterThan(PAINT_H / 2);
    expect(NOSE_ROW).toBeLessThan(PAINT_H);
    expect(hexRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexRgb('#f80')).toEqual([255, 136, 0]);
    expect(hexRgb('nonsense')).toEqual([255, 255, 255]);
  });
});

describe('the Hangar in 3D', () => {
  it('dresses the whole crew in the chosen suit, with the trim on the backpack', () => {
    const d = new Diorama();
    // Before any choice: white and orange suits, taking turns.
    expect(new Set(suits(d).map((m) => hex(m.color))).size).toBe(2);
    d.setCosmetics(LOOKS);
    for (const m of suits(d)) expect(hex(m.color)).toBe('#a065e0');
    const pack = (d.group.getObjectByName('suit-pack') as THREE.Mesh).material as THREE.MeshPhongMaterial;
    expect(hex(pack.color)).toBe('#4f2d7a');
    // Not glowing...
    d.setNight(1);
    for (const m of suits(d)) expect(m.emissiveIntensity).toBe(0);
    // ...until a glow-in-the-dark suit, which glows brighter at night.
    d.setCosmetics({ ...LOOKS, suit: { body: '#b8ffb0', trim: '#2f8f4a', glow: true } });
    d.setNight(0);
    const day = suits(d)[0].emissiveIntensity;
    d.setNight(1);
    expect(day).toBeGreaterThan(0);
    expect(suits(d)[0].emissiveIntensity).toBeGreaterThan(day);
  });

  it('keeps the Moon rule: a white suit brightens there, a colored one stays as painted', () => {
    const d = new Diorama();
    d.setCosmetics({ ...LOOKS, suit: { body: '#f4f0e6', trim: '#c9c2b4' } });
    const white = suits(d)[0].color.clone();
    d.setScene(scene({ site: 'moon' }));
    expect(suits(d)[0].color.r + suits(d)[0].color.g).toBeGreaterThan(white.r + white.g);
    d.setCosmetics(LOOKS);
    expect(hex(suits(d)[0].color)).toBe('#a065e0');
    d.setScene(scene({ site: 'mars' }));
    expect(hex(suits(d)[0].color)).toBe('#a065e0');
  });

  it('paints the rocket with a tiny, crisp texture and swaps it (freeing the old one) on a new paint job', () => {
    const d = new Diorama();
    d.setCosmetics(LOOKS);
    const hull = hullMat(d);
    const tex = hull.map as THREE.DataTexture;
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    expect([tex.image.width, tex.image.height]).toEqual([PAINT_W, PAINT_H]);
    // The texture holds the paint picture: the first pixel is the first checker color.
    expect(Array.from((tex.image.data as Uint8Array).slice(0, 3))).toEqual(hexRgb(paintAt(LOOKS.rocket, 0, 0)));
    // The whole hull shares it: upper stage, nose cone and booster.
    const rocket = d.group.getObjectByName('rocket')!;
    const painted = rocket.children.filter((o) => (o as THREE.Mesh).material === hull);
    expect(painted.length).toBe(3);
    // Fins in the fin color.
    const fins = rocket.children.map((o) => (o as THREE.Mesh).material as THREE.MeshPhongMaterial).filter((m) => m && hex(m.color) === '#1c1c24');
    expect(fins.length).toBeGreaterThanOrEqual(4);
    // UVs run up the whole rocket: the nose cone's tip is at the top of the picture.
    const nose = rocket.children[1] as THREE.Mesh;
    let maxV = 0;
    const uv = nose.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) maxV = Math.max(maxV, uv.getY(i));
    expect(maxV).toBeCloseTo(1, 2);
    // Repaint: a new texture, the old one disposed.
    let freed = false;
    tex.addEventListener('dispose', () => (freed = true));
    d.setCosmetics({ ...LOOKS, rocket: { pattern: 'solid', colors: ['#e8b832'], fins: '#a8741a', shiny: true } });
    expect(hull.map).not.toBe(tex);
    expect(freed).toBe(true);
    expect(hull.shininess).toBeGreaterThan(20);
  });

  it('still launches a painted rocket without its pad, booster and all, and resets for the next crew', () => {
    const d = new Diorama();
    d.setScene(scene({ fuel: 100 }));
    d.setCosmetics(LOOKS);
    const pad = d.group.getObjectByName('launch-pad')!;
    const padY = pad.position.y;
    const padKids = pad.children.length;
    const rocket = d.group.getObjectByName('rocket')!;
    const before = rocket.children.length;
    for (let k = 0; k <= 1; k += 0.02) {
      d.launchStep(k, 1 / 60);
      d.tick(1 / 60, k * 8, false);
    }
    expect(d.rocketPosition().y).toBeGreaterThan(50);
    expect(pad.position.y).toBe(padY);
    expect(pad.parent).toBe(d.group);
    expect(pad.children.length).toBe(padKids);
    expect(d.staged).toBe(true);
    // The falling booster keeps its paint.
    const booster = d.group.getObjectByName('booster')!;
    expect(booster.children.some((o) => (o as THREE.Mesh).material === hullMat(d))).toBe(true);
    d.resetLaunch();
    expect(rocket.children.length).toBe(before);
    expect(d.rocketPosition().y).toBeLessThan(5);
    expect(hullMat(d).map).toBeTruthy();
  });

  it('adds the rover pet, which trundles after the crew by day and naps by the door at night, and removes it', () => {
    const d = new Diorama();
    d.setScene(scene());
    expect(d.group.getObjectByName('rover-pet')).toBeUndefined();
    d.setCosmetics(LOOKS);
    const pet = d.group.getObjectByName('rover-pet')!;
    expect(pet).toBeDefined();
    expect(d.roverPet).not.toBeNull();
    // Daytime: it catches up with an astronaut.
    for (let i = 0; i < 600; i++) d.tick(1 / 30, i / 30, false);
    let nearest = Infinity;
    d.group.traverse((o) => {
      if (o.name === 'suit' && o.parent!.visible) nearest = Math.min(nearest, o.parent!.position.distanceTo(pet.position));
    });
    expect(nearest).toBeLessThan(2);
    expect(d.roverPet!.napping).toBe(false);
    // Night: everyone goes inside and the pet rolls home to nap.
    d.setNight(1);
    for (let i = 0; i < 600; i++) d.tick(1 / 30, 20 + i / 30, false);
    expect(Math.hypot(pet.position.x - PET_HOME.x, pet.position.z - PET_HOME.z)).toBeLessThan(0.1);
    expect(d.roverPet!.napping).toBe(true);
    // A new style recolors the same pet; "no pet" takes it away.
    d.setCosmetics({ ...LOOKS, pet: { body: '#c2562a', trim: '#6e3418', eyes: '#ffd34d' } });
    expect(d.group.getObjectByName('rover-pet')).toBe(pet);
    d.setCosmetics({ ...LOOKS, pet: null });
    expect(d.group.getObjectByName('rover-pet')).toBeUndefined();
    expect(d.roverPet).toBeNull();
  });

  it('never bounces or wiggles the pet with reduced motion', () => {
    const d = new Diorama();
    d.setScene(scene());
    d.setCosmetics(LOOKS);
    const pet = d.group.getObjectByName('rover-pet')!;
    const chassis = pet.children[pet.children.length - 1];
    const head = chassis.children.find((o) => o.children.length > 0)!;
    for (let i = 0; i < 300; i++) {
      d.tick(1 / 30, i / 30, true);
      expect(chassis.position.y).toBe(0);
      expect(head.rotation.y).toBe(0);
    }
  });

  it('colors the base lights', () => {
    const d = new Diorama();
    const lit = () => {
      const out = new Set<string>();
      d.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhongMaterial | undefined;
        if (m?.isMeshPhongMaterial && hex(m.emissive) === '#5ef2e6') out.add(m.uuid);
      });
      return out.size;
    };
    const before = lit();
    d.setCosmetics(LOOKS);
    expect(lit()).toBeGreaterThan(before);
  });
});

describe('stage plumbing for the Hangar', () => {
  const fake = (log: string[], name: string, withLooks = true): Stage => ({
    mount() {},
    setScene() {},
    setTimeOfDay() {},
    storm() {},
    launch: async () => {},
    setReducedMotion() {},
    dispose() {},
    ...(withLooks ? { setCosmetics: (c: Cosmetics) => void log.push(`${name} ${c.suit.body}`) } : {}),
  });

  it('the swappable stage passes cosmetics through and paints them again on the stage swapped in', () => {
    const log: string[] = [];
    const s = new SwappableStage(fake(log, 'a'));
    s.mount({} as HTMLElement);
    s.setCosmetics(LOOKS);
    s.swap(fake(log, 'b'));
    s.setCosmetics({ ...LOOKS, suit: { body: '#e0402f', trim: '#7a1f17' } });
    expect(log).toEqual(['a #a065e0', 'b #a065e0', 'b #e0402f']);
    // A stage that can't paint is fine too.
    expect(() => (s.swap(fake(log, 'c', false)), s.setCosmetics(LOOKS))).not.toThrow();
    // Swapping before anything was chosen paints nothing.
    const log2: string[] = [];
    const s2 = new SwappableStage(fake(log2, 'a'));
    s2.mount({} as HTMLElement);
    s2.swap(fake(log2, 'b'));
    expect(log2).toEqual([]);
  });

  it('the simple stage ignores cosmetics, and the 3D stage keeps them until it is mounted', () => {
    expect(() => new CssStage().setCosmetics()).not.toThrow();
    const three = new ThreeStage();
    expect(() => three.setCosmetics(LOOKS)).not.toThrow();
  });
});
