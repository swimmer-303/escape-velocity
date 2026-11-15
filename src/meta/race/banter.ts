// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Short, friendly lines from the rivals during a race. Never mean: rivals cheer you on even when they are ahead.
// Picked deterministically from the race seed and the sol, so a replay of the same race says the same things.

import { makeRng } from '../../sim/rng';
import type { Style } from './brain';
import type { RaceNews, Racer, Row } from './race';
import type { Placed } from './score';

export interface Banter {
  racer: Racer;
  text: string;
}

const STYLE_LINES: Record<Style, string[]> = {
  careful: ['Slow and steady... I hope!', 'Safety stock is full. Feeling good!', 'I checked my plan three times.'],
  steady: ['Two days of air in the tank. Nice and calm.', 'Heaters on, rocket filling. Good sol!', 'Balance is the secret!'],
  builder: ['I am building something cool for the next crew!', 'More power for the base, then the rocket.', 'One more bolt... there!'],
  racer: ['Every power cell counts!', 'Fuel, fuel, fuel!', 'The launch pad is calling!'],
  daredevil: ['Full speed ahead!', 'Who needs a big safety stock? Me, maybe...', 'Zooming to the launch pad!'],
};

const pickFrom = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** One line for this sol, or null for a quiet sol. */
export function banterFor(seed: string, sol: number, rows: Array<Placed<Row>>, news: RaceNews[], stormToday: boolean): Banter | null {
  const r = makeRng(`${seed}|banter|${sol}`);
  for (const n of news) {
    if (n.racer.kind === 'ghost') continue;
    if (n.kind === 'launch') return { racer: n.racer, text: pickFrom(r, ['Liftoff! See you back on Earth!', 'We launched! Your turn next!']) };
    if (n.kind === 'home') return { racer: n.racer, text: pickFrom(r, ['We are heading home safe. You have got this!', 'Our crew is going home early. Next time!']) };
    if (n.kind === 'overtake') return { racer: n.racer, text: pickFrom(r, ['Whoa, nice flying! You passed me!', 'Hey, you zoomed past me! Great plan!']) };
    if (n.kind === 'passed') return { racer: n.racer, text: pickFrom(r, ['Zoom! Catch me if you can!', 'Passing on your left! Good luck!']) };
  }
  const rivals = rows.filter((x) => x.racer.kind === 'ai' && x.status === 'playing');
  if (!rivals.length) return null;
  // Half-full and almost-full rockets are worth a shout.
  for (const x of rivals) {
    const s = x.racer.state;
    const prev = s && s.log.length >= 2 ? s.log[s.log.length - 2].after.fuel : 0;
    if (prev < 50 && x.fuel >= 50 && x.fuel < 75) return { racer: x.racer, text: 'My rocket is half full!' };
    if (prev < 75 && x.fuel >= 75) return { racer: x.racer, text: 'Almost there! My tank is three-quarters full.' };
  }
  const who = pickFrom(r, rivals);
  if (stormToday) {
    const sheltered = !!who.racer.state?.log[who.racer.state.log.length - 1]?.alloc.shelter;
    return { racer: who.racer, text: sheltered ? 'Into the shelter, crew! Safety first.' : 'That storm was a bumpy one!' };
  }
  if (sol % 2 === 1 && r() < 0.7) return null;
  return { racer: who.racer, text: pickFrom(r, STYLE_LINES[who.racer.brain?.style ?? 'steady']) };
}

/** What happened to a rival crew that went home early: dramatic, but friendly and honest about why. */
export function homeStory(name: string, reason: string, storm: 'solar' | 'dust' | null): string {
  const after = storm === 'solar' ? ' after a solar storm' : storm === 'dust' ? ' after a dust storm' : '';
  switch (reason) {
    case 'dose':
      return `${name}'s crew took too much radiation${after}, so the flight doctor called them home early. Everyone is safe!`;
    case 'air':
      return `${name}'s crew ran low on air${after}, so Mission Control sent them home early. Everyone is safe!`;
    case 'food':
      return `${name}'s crew ran low on food${after}, so Mission Control sent them home early. Everyone is safe!`;
    default:
      return `${name}'s launch window closed before the rocket was full. The crew headed home safe.`;
  }
}
