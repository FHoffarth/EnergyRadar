import { afterEach, describe, expect, it } from 'vitest';
import { applyMotionPreference, resolveEffectiveMotionMode } from '../lib/motion';

describe('effective motion mode', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-motion');
    document.documentElement.removeAttribute('data-motion-setting');
  });

  it.each([
    ['full', false, 'full'],
    ['reduced', false, 'reduced'],
    ['none', false, 'none'],
    ['full', true, 'reduced'],
    ['reduced', true, 'reduced'],
    ['none', true, 'none'],
  ] as const)('%s with OS reduced=%s resolves to %s', (requested, osReduced, expected) => {
    expect(resolveEffectiveMotionMode(requested, osReduced)).toBe(expected);
  });

  it('exposes requested and effective modes as distinct DOM attributes', () => {
    applyMotionPreference('full', document.documentElement, true);
    expect(document.documentElement.dataset.motionSetting).toBe('full');
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });

  it('defines materially different effective motion tokens for all three modes', () => {
    const cssPath = __filename.replace(/\\/g, '/').replace('/test/MotionMode.test.ts', '/index.css');
    const css = require('fs').readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\[data-motion="full"\][\s\S]*--motion-prominent: 700ms/);
    expect(css).toMatch(/\[data-motion="reduced"\][\s\S]*--motion-prominent: 120ms/);
    expect(css).toMatch(/\[data-motion="none"\][\s\S]*--motion-prominent: 0ms/);
  });
});
