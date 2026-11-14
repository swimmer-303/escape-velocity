// Written with AI assistance (Claude Code). See README "Use of AI tools".
// High contrast mode meets WCAG AA (4.5:1) for text: checked straight from the colors in style.css.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const base = tokens(/:root\s*\{([^}]*)\}/.exec(css)![1]);
const contrast = { ...base, ...tokens(/html\.ev-contrast\s*\{([^}]*)\}/.exec(css)![1]) };

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A button background in high contrast mode, from its rule (a color or a token). */
function buttonBg(selector: string): string {
  const re = new RegExp(`html\\.ev-contrast ${selector.replace(/\./g, '\\.')}[^{]*\\{\\s*background:\\s*([^;]+);`);
  const v = re.exec(css)![1].trim();
  return v.startsWith('var(') ? contrast[/--([\w-]+)/.exec(v)![1]] : v.toLowerCase();
}

describe('high contrast colors', () => {
  it('body text and muted text are well above AA on every panel', () => {
    for (const surface of ['bg', 'panel', 'panel-2', 'panel-3']) {
      expect(ratio(contrast.ink, contrast[surface]), `ink on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(ratio(contrast.muted, contrast[surface]), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('colored status text (good, warning, danger, links) meets AA on cards', () => {
    for (const tone of ['green', 'amber', 'red', 'cyan', 'air']) {
      expect(ratio(contrast[tone], contrast['panel-2']), `${tone} on a card`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(contrast[tone], contrast.panel), `${tone} on a dialog`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('button labels meet AA (the normal orange button is only about 3.8:1)', () => {
    expect(ratio(base.ink, base.oxide)).toBeLessThan(4.5);
    for (const sel of ['.btn.primary', '.btn.go', '.btn.cyan']) {
      expect(ratio(contrast.ink, buttonBg(sel)), sel).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(contrast.ink, contrast['panel-3'])).toBeGreaterThanOrEqual(4.5);
  });

  it('lines around controls are visible (3:1 for non-text contrast)', () => {
    expect(ratio(contrast.line, contrast.panel)).toBeGreaterThanOrEqual(3);
    expect(ratio(contrast.line, contrast['panel-2'])).toBeGreaterThanOrEqual(3);
    expect(ratio(base.line, base.panel)).toBeLessThan(3);
  });
});
