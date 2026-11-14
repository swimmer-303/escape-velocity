// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The crew roster matches the campaign, and the "Meet your crew" UI shows one portrait per astronaut.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CREWS, crewFor, crewQuote } from './crew';
import { EXPEDITIONS } from '../sim/constants';
import { meetCrew, crewSays } from '../ui/crew';

// Vitest runs from the project root.
const publicDir = resolve(process.cwd(), 'public');

describe('crew roster', () => {
  it('has one roster per expedition, sized to its crew count', () => {
    expect(CREWS.map((c) => c.expedition)).toEqual(EXPEDITIONS.map((e) => e.n));
    for (const spec of EXPEDITIONS) expect(crewFor(spec.n).members).toHaveLength(spec.crew);
  });

  it('never repeats a name, even across crews', () => {
    const names = CREWS.flatMap((c) => c.members.map((m) => m.name.toLowerCase()));
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives everyone a role and a short fun fact, with no emoji', () => {
    for (const m of CREWS.flatMap((c) => c.members)) {
      expect(m.role.length).toBeGreaterThan(0);
      expect(m.fact.length).toBeGreaterThan(0);
      expect(m.fact.split(/\s+/).length).toBeLessThanOrEqual(10);
      expect(`${m.name} ${m.role} ${m.fact}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('has a commander on every crew, and a sprite sheet file for every crew', () => {
    for (const c of CREWS) {
      expect(c.members.some((m) => m.role === 'Commander')).toBe(true);
      expect(existsSync(publicDir + c.sheet)).toBe(true);
    }
  });

  it('picks an end-screen speaker from the right crew', () => {
    for (const c of CREWS) {
      for (const won of [true, false]) {
        const q = crewQuote(c.expedition, won);
        expect(c.members[q.index]).toBe(q.member);
        expect(q.line.length).toBeGreaterThan(0);
      }
    }
    expect(crewQuote(1, true).member.role).toBe('Commander');
    expect(crewQuote(1, false).member.role).toBe('Doctor');
  });
});

describe('crew UI', () => {
  it('shows a portrait, name and role for every astronaut', () => {
    for (const spec of EXPEDITIONS) {
      const el = meetCrew(spec.n);
      expect(el.textContent).toContain('Meet your crew');
      const faces = [...el.querySelectorAll<HTMLElement>('.crew-face')];
      expect(faces).toHaveLength(spec.crew);
      expect(faces[0].getAttribute('style')).toContain('background-position:0% 0');
      expect(faces[faces.length - 1].getAttribute('style')).toContain('background-position:100% 0');
      for (const m of crewFor(spec.n).members) {
        expect(el.textContent).toContain(m.name);
        expect(el.textContent).toContain(m.role);
      }
    }
  });

  it('names one crew member on the end screen', () => {
    expect(crewSays(3, true).textContent).toMatch(/^Mei says: /);
  });
});
