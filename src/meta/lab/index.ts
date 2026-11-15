// Written with AI assistance (Claude Code). See README "Use of AI tools".
// The Space Lab: a what-if lab framed as a fair-test science experiment. Players turn six dials built on real NASA
// numbers (the world, the Sun's activity, Mars' orbit, dust in the air, the message delay and the crew size), make a
// guess, run a mission, and get a Lab result card and a Lab Notebook to compare runs. The rules live in
// src/sim/lab.ts; the campaign, daily challenge, Rival Race and leaderboards always play under real conditions.
//
// It talks to the game only through ../hooks:
// - a lobby tile (order 28) and a section in the Settings dialog (order 10) that open the lab;
// - startQuick() with `lab` settings to run an experiment (the game reports it as play mode 'lab');
// - a SPACE LAB badge in the HUD and the result card on the end screen;
// - a small, capped XP reward for finished experiments (rank only, never the season pass).
//
//   store.ts       save data ('ev-lab-v1'): dials, notebook, the daily XP cap
//   experiment.ts  words, live readouts, the fair test (autopilot), the science sentences
//   ui.ts          the screens

import { addEndExtra, addHudExtra, addSettingsSection, addTitleExtra, emitGame, metaContext, onGame } from '../hooks';
import { titleTile } from '../tile';
import { hypothesisHeld, sanitizeLab } from '../../sim/lab';
import { fairTest, summaryLine } from './experiment';
import { LAB_XP_PER_DAY, addEntry, claimXp, loadSave, storeSave, today, type NotebookEntry } from './store';
import { flaskIcon, hudBadge, openLab, pendingHypothesis, resultCard, settingsSection } from './ui';
import type { MissionState } from '../../sim/types';

export { openLab, openNotebook, LAB_LABEL, NOTEBOOK_LABEL, REWARD_RULE } from './ui';

/** The last experiment's result, for the end screen (which may be drawn again, e.g. coming back from a dialog). */
let last: { mission: MissionState; entry: NotebookEntry; xpLeft: number } | null = null;
export function lastResult() {
  return last;
}

/** A lab mission ended: write it in the notebook, run the fair test, and give the (capped) XP. */
export function recordExperiment(m: MissionState, won: boolean): NotebookEntry | null {
  if (!m.config.lab) return null;
  const settings = sanitizeLab(m.config.lab);
  let fair: ReturnType<typeof fairTest> | null = null;
  try {
    fair = fairTest(m.config);
  } catch (e) {
    console.error('[lab] fair test failed', e);
  }
  const hypothesis = pendingHypothesis();
  let save = loadSave();
  const claim = claimXp(save, today());
  save = claim.save;
  const entry: NotebookEntry = {
    at: new Date().toISOString(),
    settings,
    hypothesis,
    won,
    sols: m.log.length,
    dose: Math.round(m.dose * 10) / 10,
    doseBudget: m.doseBudget,
    fuel: Math.round(m.fuel),
    ...(m.loseReason ? { loseReason: m.loseReason } : {}),
    ...(fair ? { autoReal: fair.real, autoLab: fair.lab, outcome: fair.outcome } : {}),
    held: hypothesis && fair ? hypothesisHeld(hypothesis, fair.outcome) : null,
    xp: claim.xp,
  };
  save = addEntry(save, entry);
  storeSave(save);
  last = { mission: m, entry, xpLeft: Math.max(0, LAB_XP_PER_DAY - save.xpCount) };
  if (claim.xp) emitGame('xp', { amount: claim.xp, reason: 'Space Lab experiment finished', source: 'lab' });
  return entry;
}

onGame('mission-end', (p) => {
  if (p.demo || p.mode !== 'lab') return;
  recordExperiment(p.mission, p.won);
});

addEndExtra({
  id: 'space-lab',
  render: (m, mode) => (mode === 'lab' && last && last.mission === m ? resultCard(last.entry, last.xpLeft) : null),
});

addHudExtra({
  id: 'space-lab',
  render: (m) => (m.config.lab ? hudBadge() : null),
});

addSettingsSection({ id: 'space-lab', order: 10, render: () => settingsSection() });

addTitleExtra({
  id: 'space-lab',
  order: 28,
  render: () => {
    const s = loadSave();
    return titleTile({
      id: 'space-lab',
      name: 'Space Lab',
      sub: s.notebook.length ? `${s.notebook.length} experiment${s.notebook.length === 1 ? '' : 's'} · ${summaryLine(s.settings)}` : 'What if the Sun got angrier? Turn the dials and find out.',
      icon: flaskIcon(48),
      accent: 'green',
      badge: s.notebook.length ? undefined : 'NEW',
      onClick: () => {
        metaContext()?.audio.sfx('click');
        openLab();
      },
    });
  },
});
