import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import appLayoutSource from '../components/layout/AppLayout.tsx?raw';

const layoutCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

describe('desktop experience layout contract', () => {
  it('uses one bounded fluid workspace instead of the former 960px global cap', () => {
    expect(appLayoutSource).toContain('cockpit-shell');
    expect(appLayoutSource).not.toContain('max-w-[960px]');
    expect(layoutCss).toContain('max-width: 1720px');
    expect(layoutCss).toContain('--radar-gutter: clamp(');
  });

  it('defines a 12-column desktop grid and a single-column narrow fallback', () => {
    expect(layoutCss).toContain('grid-template-columns: repeat(12, minmax(0, 1fr))');
    expect(layoutCss).toContain('@media (max-width: 1079px)');
    expect(layoutCss).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('keeps horizontal overflow out of the shared app shell', () => {
    expect(appLayoutSource).toContain('overflow-x-hidden');
    expect(layoutCss).toContain('min-width: 0');
  });
});
