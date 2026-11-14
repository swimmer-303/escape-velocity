// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Turns sim results into plain-language cause and effect for kids.

import { TUNING } from './constants';
import type { MissionState, SolReport, SpaceWeatherEvent } from './types';

export type ScienceTopic = 'shelter' | 'monitor' | 'greenhouse' | 'o2' | 'dust' | 'cold' | 'crew' | 'comm';

export interface Debrief {
  headline: string;
  details: string[];
  topic: ScienceTopic;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
const cells = (k: number) => `${k} cell${k === 1 ? '' : 's'}`;
const days = (x: number) => `${n1(Math.max(0, x))} day${Math.abs(x - 1) < 0.05 ? '' : 's'}`;

export function eventName(e: SpaceWeatherEvent): string {
  if (e.kind === 'flare' && e.classType) return `${e.classType} solar flare`;
  if (e.kind === 'sep') return 'solar particle storm';
  if (e.kind === 'cme') return e.speedKms ? `solar eruption (CME) racing at ${Math.round(e.speedKms).toLocaleString('en-US')} km/s` : 'solar eruption (CME)';
  return 'solar storm';
}

export function eventDate(e: SpaceWeatherEvent): string {
  const d = new Date(e.time);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function explainSol(r: SolReport): Debrief {
  const details: string[] = [];
  const fuelLine = r.alloc.fuel
    ? `${cells(r.alloc.fuel)} made rocket fuel: the tank is ${Math.floor(r.after.fuel)}% full.`
    : `No cells went to rocket fuel today: the tank stayed at ${Math.floor(r.after.fuel)}%.`;

  let headline = '';
  let topic: ScienceTopic = 'o2';
  let tone: Debrief['tone'] = 'neutral';

  if (r.storm) {
    const s = r.storm;
    const name = eventName(s.event);
    topic = 'shelter';
    if (s.shelterCells >= 2) {
      headline = `You powered the shelter, so the ${name} only gave your crew a tiny dose (${n1(s.doseTaken)} instead of ${n1(s.doseUnsheltered)}), but you made less fuel today.`;
      tone = 'good';
    } else if (s.shelterCells === 1) {
      headline = `Your half-powered shelter blocked half of the ${name}. Your crew got ${n1(s.doseTaken)} dose. Two cells would have blocked almost all of it.`;
      tone = 'warn';
    } else if (s.warnedBy) {
      headline = `You were warned, but the shelter was off, so the ${name} added ${n1(s.doseTaken)} to your crew's dose.`;
      tone = 'bad';
    } else if (s.event.kind === 'cme' && !s.event.sourceLocation) {
      headline = `A ${name} hit the outpost. Earth's forecasters could not see it coming: it erupted on the far side of the Sun, facing Mars. It added ${n1(s.doseTaken)} to your crew's dose. Only a radiation monitor at Mars could have warned you.`;
      topic = 'monitor';
      tone = 'bad';
    } else if (r.blackout) {
      headline = `A ${name} hit during the blackout. No warning could reach you, so it added ${n1(s.doseTaken)} to your crew's dose.`;
      topic = 'monitor';
      tone = 'bad';
    } else if (s.lateByMin) {
      headline = `A fast ${name} hit before Earth's warning arrived (${s.lateByMin} min too late!). It added ${n1(s.doseTaken)} to your crew's dose. A radiation monitor would have warned you.`;
      topic = 'monitor';
      tone = 'bad';
    } else {
      headline = `A ${name} added ${n1(s.doseTaken)} to your crew's dose.`;
      tone = 'bad';
    }
    if (s.warnedBy === 'monitor') details.push('Your own radiation monitor spotted it coming.');
  } else if (r.newDamage) {
    headline = 'Too many cold nights damaged a battery: you will have 1 fewer power cell every sol from now on.';
    topic = 'cold';
    tone = 'bad';
  } else if (r.heaterShortfall > 0) {
    headline = `You skipped ${r.heaterShortfall === 1 ? 'a heater' : 'the heaters'}, so the batteries got cold: you will have ${cells(r.heaterShortfall)} fewer tomorrow.`;
    topic = 'cold';
    tone = 'warn';
  } else if (r.weather !== 'clear') {
    headline = `Dust blocked the sunlight, so your solar panels only made ${cells(r.cells)} today.`;
    topic = 'dust';
    tone = 'warn';
  } else if (r.after.food < 1.5 && r.after.food < r.before.food) {
    headline = `Your crew ate more food than the greenhouse grew. Only ${days(r.after.food)} of food left!`;
    topic = 'greenhouse';
    tone = 'warn';
  } else if (r.after.air < 1.5 && r.after.air < r.before.air) {
    headline = `Your crew breathed more oxygen than you made. Only ${days(r.after.air)} of air left!`;
    topic = 'o2';
    tone = 'warn';
  } else if (r.alloc.greenhouse >= 3) {
    headline = `Your greenhouse grew ${days(r.foodMade)} of food, but those grow lights used power that could have made fuel.`;
    topic = 'greenhouse';
    tone = 'good';
  } else {
    headline = fuelLine;
    topic = r.alloc.fuel ? 'o2' : 'crew';
    tone = r.alloc.fuel ? 'good' : 'neutral';
  }

  if (headline !== fuelLine) details.push(fuelLine);
  if (r.crate === 'food') details.push('The cargo lander brought 3 days of food.');
  if (r.crate === 'parts') details.push('The cargo lander brought spare parts: repairs done.');
  if (r.crate === 'panel') details.push('The cargo lander brought a new solar panel: +1 cell from tomorrow.');
  if (r.cleaning) details.push('A lucky gust of wind blew the dust off your solar panels.');
  if (r.alloc.monitor) details.push('Your radiation monitor is watching the Sun tonight.');
  return { headline, details, topic, tone };
}

export interface Ending {
  title: string;
  happened: string[];
  tip: string;
  badges: Badge[];
}

export interface Badge {
  id: string;
  name: string;
  why: string;
}

export function endingFor(state: MissionState): Ending {
  const log = state.log;
  const storms = log.filter((r) => r.storm);
  const unsheltered = storms.filter((r) => r.storm!.shelterCells === 0);
  const unwarnedHits = unsheltered.filter((r) => !r.storm!.warnedBy);
  const warnedIgnored = unsheltered.filter((r) => r.storm!.warnedBy);
  const coldNights = log.filter((r) => r.heaterShortfall > 0).length;
  const lastSol = log.length ? log[log.length - 1].sol : 0;
  const happened: string[] = [];
  let tip = '';
  let title = '';

  if (state.status === 'won') {
    title = 'ESCAPE VELOCITY REACHED: 5.0 km/s';
    happened.push(`You filled the tank and launched on sol ${lastSol}.`);
    happened.push(
      `Your crew finished with ${days(Math.min(state.air, state.food))} of supplies and a radiation dose of ${n1(state.dose)} out of ${state.doseBudget}.`,
    );
    if (storms.length) happened.push(`You sheltered from ${storms.length - unsheltered.length} of ${storms.length} solar storms.`);
    tip = state.config.difficulty === 'cadet' ? 'Ready for more? Try Commander: less power, more storms.' : 'Can you launch sooner, or with a smaller dose? Try a new seed.';
  } else {
    title = 'The flight surgeon calls it: your crew heads home early.';
    switch (state.loseReason) {
      case 'air':
        happened.push(`Your crew ran out of air on sol ${lastSol}.`);
        tip = 'Keep at least 1 cell on AIR every sol. Your crew breathes 1 day of air each sol.';
        break;
      case 'food':
        happened.push(`Your crew ran out of food on sol ${lastSol}.`);
        tip = 'Give the greenhouse 2 cells most sols. Grow lights are power-hungry: each cell grows half a day of food.';
        break;
      case 'dose':
        happened.push(`Your crew's radiation dose went over the safe budget (${state.doseBudget}) on sol ${lastSol}.`);
        if (unwarnedHits.length)
          tip = 'Power the radiation monitor when Earth says the Sun is active. It warns you before fast storms that beat Earth\'s messages.';
        else if (warnedIgnored.length) tip = 'When you get a storm warning, put 2 cells in the shelter that sol.';
        else tip = 'Every sol on Mars adds a little dose. Make fuel faster so your crew can go home sooner.';
        break;
      case 'window':
        happened.push(`The launch window closed on sol ${lastSol} with the tank ${Math.floor(state.fuel)}% full.`);
        tip = 'Once your air and food reserves are safe, put more cells into FUEL.';
        break;
    }
    if (unsheltered.length) happened.push(`${unsheltered.length} solar storm${unsheltered.length === 1 ? '' : 's'} caught your crew outside the shelter.`);
    if (coldNights) happened.push(`You skipped the heaters on ${coldNights} cold night${coldNights === 1 ? '' : 's'}, which cost power.`);
    if (happened.length < 2) happened.push(`The fuel tank reached ${Math.floor(state.fuel)}%.`);
  }

  return { title, happened: happened.slice(0, 3), tip, badges: badgesFor(state) };
}

export function badgesFor(state: MissionState): Badge[] {
  const log = state.log;
  const won = state.status === 'won';
  const out: Badge[] = [];
  const storms = log.filter((r) => r.storm);
  const food = log.reduce((s, r) => s + r.foodMade, 0);
  if (won && storms.length && storms.every((r) => r.storm!.shelterCells >= 2))
    out.push({ id: 'stormproof', name: 'Storm Proof', why: 'Launched with every solar storm blocked by the shelter.' });
  if (log.some((r) => r.storm?.warnedBy === 'monitor'))
    out.push({ id: 'watchful', name: 'Watchful Eye', why: 'Your own radiation monitor caught a storm.' });
  if (food >= 10) out.push({ id: 'greenhouse', name: 'Greenhouse Hero', why: `Grew ${n1(food)} days of food on Mars.` });
  if (won && log.every((r) => r.heaterShortfall === 0))
    out.push({ id: 'cozy', name: 'Warm and Cozy', why: 'Never skipped the heaters.' });
  if (won && log.length <= 12) out.push({ id: 'speedy', name: 'Speed Launch', why: `Launched by sol ${log.length}.` });
  if (won && state.config.difficulty === 'commander') out.push({ id: 'commander', name: 'Commander', why: 'Won on Commander difficulty.' });
  if (won && state.config.scenario === 'may2024') out.push({ id: 'history', name: 'History Maker', why: 'Survived the real May 2024 solar storms.' });
  if (won && state.dose < TUNING[state.config.difficulty].doseBudget * 0.4)
    out.push({ id: 'lowdose', name: 'Low Dose', why: 'Kept the crew\'s dose under 40% of the budget.' });
  return out;
}
