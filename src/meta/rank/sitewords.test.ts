// @vitest-environment happy-dom
// Written with AI assistance (Claude Code). See README "Use of AI tools".
// Rank pop-ups during Moon play never say "sol" (a Moon base counts Earth days).
import { describe, it, expect } from 'vitest';
import { siteWords } from './ui';
import { DAILY_MISSIONS } from './daily';

describe('siteWords', () => {
  it('turns sols into days on the Moon only', () => {
    expect(siteWords('Play 5 sols', true)).toBe('Play 5 days');
    expect(siteWords('Get through a dusty sol. Sol 3!', true)).toBe('Get through a dusty day. Day 3!');
    expect(siteWords('Play 5 sols', false)).toBe('Play 5 sols');
    expect(siteWords('solar storm', true)).toBe('solar storm');
  });
  it('leaves no sol word in any daily mission title on the Moon', () => {
    for (const m of DAILY_MISSIONS) expect(siteWords(`Daily mission: ${m.title}`, true)).not.toMatch(/\bsols?\b/i);
  });
});
