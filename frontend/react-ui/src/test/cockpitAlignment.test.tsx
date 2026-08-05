import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SolarBalanceBlock, HouseBalanceBlock } from '../components/decision/EnergyBalanceStory';

const locale = 'de-DE' as const;
const data: any = {
  solarTotal: { state: 'available', value: 12.8 }, homeTotal: { state: 'available', value: 7.2 },
  gridFeedInTotal: { state: 'available', value: 9.2 }, gridDrawTotal: { state: 'available', value: 3.6 },
  selfSufficiency: { state: 'available', value: 57 }, selfConsumption: { state: 'available', value: 28 }, history: [],
};

describe('cockpit alignment — shared 12-column grid', () => {
  it('balance blocks apply the parent col-span (so axes align on the shared grid)', () => {
    render(<>
      <SolarBalanceBlock data={data} locale={locale} className="col-span-12 md:col-span-6 lg:col-span-3" />
      <HouseBalanceBlock data={data} locale={locale} className="col-span-12 md:col-span-6 lg:col-span-3" />
    </>);
    expect(screen.getByTestId('solar-balance').className).toContain('lg:col-span-3');
    expect(screen.getByTestId('house-balance').className).toContain('lg:col-span-3');
    // Blocks carry no ad-hoc horizontal offsets — alignment is grid-only.
    for (const id of ['solar-balance', 'house-balance']) {
      const cls = screen.getByTestId(id).className;
      expect(cls).not.toMatch(/\bml-|\bpl-|translate-x/);
    }
  });

  it('the cockpit uses one grid-cols-12 with matching 6/6 and 3/3/6 spans, no positioning hacks', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, '../views/TodayView.tsx'), 'utf8');
    // Shared 12-col grid + the decision-zone spans.
    expect(src).toMatch(/grid-cols-12/);
    expect(src).toMatch(/AutarkieBar[\s\S]{0,400}lg:col-span-6/);
    expect(src).toMatch(/EconomicHero[\s\S]{0,200}lg:col-span-6|lg:col-span-6[\s\S]{0,200}EconomicHero/);
    expect(src).toMatch(/SolarBalanceBlock[\s\S]{0,120}lg:col-span-3/);
    expect(src).toMatch(/HouseBalanceBlock[\s\S]{0,120}lg:col-span-3/);
    expect(src).toMatch(/CockpitWeather[\s\S]{0,200}lg:col-span-6|lg:col-span-6[\s\S]{0,200}CockpitWeather/);
    // No ad-hoc horizontal positioning on cockpit blocks.
    expect(src).not.toMatch(/decision-cockpit[\s\S]*?(ml-\[|translate-x)/);
  });
});
