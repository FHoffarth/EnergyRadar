import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../index.css'), 'utf8');
const fontsDir = resolve(here, '../assets/fonts');

describe('typography system — local Plus Jakarta Sans (UI) + Barlow (data)', () => {
  it('defines the two role tokens correctly', () => {
    expect(css).toMatch(/--font-ui:\s*'Plus Jakarta Sans'/);
    expect(css).toMatch(/--font-data:\s*'Barlow'/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-ui\)/);
    expect(css).toMatch(/--font-data:\s*'Barlow'/);
  });

  it('self-hosts both families via @font-face on local files', () => {
    expect(css).toMatch(/@font-face[^}]*'Plus Jakarta Sans'[^}]*PlusJakartaSans-Regular\.woff2/s);
    expect(css).toMatch(/@font-face[^}]*'Barlow'[^}]*Barlow-Medium\.woff2/s);
  });

  it('binds the data font to numeric metrics', () => {
    expect(css).toMatch(/\.tabular-nums\s*\{[^}]*var\(--font-data\)/s);
  });

  it('makes no external font requests and never uses Barlow Condensed', () => {
    expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\/[^)]*font/i);
    expect(css).not.toMatch(/Barlow Condensed|BarlowCondensed/i);
  });

  it('ships exactly the declared weights as local WOFF2', () => {
    for (const f of [
      'PlusJakartaSans-Regular', 'PlusJakartaSans-Medium', 'PlusJakartaSans-SemiBold', 'PlusJakartaSans-Bold',
      'Barlow-Medium', 'Barlow-SemiBold', 'Barlow-Bold',
    ]) {
      expect(existsSync(resolve(fontsDir, `${f}.woff2`)), `${f}.woff2 present`).toBe(true);
    }
    // The replaced Geist-sans faces are gone (Geist Mono stays for code fields).
    expect(existsSync(resolve(fontsDir, 'Geist-Regular.woff2'))).toBe(false);
  });
});
