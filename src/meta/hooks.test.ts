// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { describe, it, expect, vi } from 'vitest';
import { onGame, emitGame, setInterstitial, runInterstitial, addTitleExtra, renderTitleExtras, addLevelRewards, rewardsAtLevel, setLevelProvider, playerLevel, type InterstitialContext } from './hooks';

describe('meta hooks', () => {
  it('delivers events, and a failing listener never breaks the game or the other listeners', () => {
    const got: number[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stopBad = onGame('xp', () => {
      throw new Error('boom');
    });
    const stop = onGame('xp', (p) => got.push(p.amount));
    emitGame('xp', { amount: 5, reason: 'test' });
    stop();
    stopBad();
    emitGame('xp', { amount: 7, reason: 'test' });
    expect(got).toEqual([5]);
  });

  it('runs an interstitial, and swallows its failure so the mission carries on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = {} as InterstitialContext;
    let ran = false;
    setInterstitial('launch', async () => {
      ran = true;
    });
    await runInterstitial('launch', ctx);
    expect(ran).toBe(true);
    setInterstitial('launch', async () => {
      throw new Error('crash');
    });
    await expect(runInterstitial('launch', ctx)).resolves.toBeUndefined();
    setInterstitial('launch', null);
    await expect(runInterstitial('landing', ctx)).resolves.toBeUndefined();
  });

  it('orders title extras, replaces one with the same id, and skips one that throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = (t: string) => Object.assign(document.createElement('div'), { textContent: t });
    addTitleExtra({ id: 'b', order: 2, render: () => el('B') });
    addTitleExtra({ id: 'a', order: 1, render: () => el('A') });
    addTitleExtra({ id: 'b', order: 2, render: () => el('B2') });
    addTitleExtra({ id: 'bad', order: 0, render: () => { throw new Error('x'); } });
    expect(renderTitleExtras().map((e) => e.textContent)).toEqual(['A', 'B2']);
  });

  it('shares level rewards and the player level between features', () => {
    addLevelRewards(() => [{ id: 'suit-gold', name: 'Gold suit', kind: 'Suit color', level: 5 }]);
    expect(rewardsAtLevel(5).map((r) => r.id)).toEqual(['suit-gold']);
    expect(playerLevel()).toBe(1);
    setLevelProvider(() => 7);
    expect(playerLevel()).toBe(7);
  });
});
