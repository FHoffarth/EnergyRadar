import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePrefersReducedMotion } from '../lib/motion';

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return matches; },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  return (next: boolean) => {
    matches = next;
    listeners.forEach(listener => listener());
  };
}

describe('operating-system reduced motion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tracks the operating-system preference without a persisted app mode', () => {
    const setReduced = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => setReduced(true));
    expect(result.current).toBe(true);
  });

  it('disables CSS animation and transitions under prefers-reduced-motion', () => {
    const cssPath = __filename.replace(/\\/g, '/').replace('/test/ReducedMotion.test.tsx', '/index.css');
    const css = require('fs').readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
    expect(css).toMatch(/transition-duration: 0\.01ms !important/);
    expect(css).not.toMatch(/\[data-motion=/);
  });
});
