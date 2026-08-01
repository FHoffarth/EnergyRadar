import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HourlyWeatherForecast, MultiDayWeatherForecast, WeatherIntelligence } from '../components/WeatherIntelligence';
import { EnergySnapshot, WeatherReportData } from '../types';

const freshSnapshot: EnergySnapshot = {
  timestamp: '12:00', quality: 'live',
  solar: { valueKw: 2.4, origin: 'observed' },
  homeLoad: { valueKw: 1.2, origin: 'observed' },
  grid: { valueKw: -1.2, origin: 'observed' },
  battery: null, assessment: null, warnings: [],
};

function completeReport(overrides: Partial<WeatherReportData> = {}): WeatherReportData {
  return {
    status: 'available',
    provider_status: 'reachable',
    served_from_cache: false,
    observed_at: '2099-07-29T12:00:00+02:00',
    fetched_at: '2099-07-29T12:00:00+02:00',
    location: {
      provider_id: 'test',
      display_name: 'Teststadt',
      latitude: 0,
      longitude: 0,
      timezone: 'Europe/Berlin',
      provider: 'open_meteo',
      original_query: 'Teststadt',
      resolved_at: '2099-07-29T11:00:00Z',
    },
    sun: {
      sunrise: '2099-07-30T05:30:00+02:00',
      sunset: '2099-07-29T21:05:00+02:00',
    },
    current: {
      condition: 'partly_cloudy',
      weather_code: 2,
      cloud_cover_percent: 20,
      temperature_c: 22.4,
      feels_like_c: 21.8,
      wind_speed_kmh: 12.5,
      precipitation_mm: 0,
      precipitation_probability_percent: 15,
      is_day: true,
    },
    hourly: Array.from({ length: 7 }, (_, index) => ({
      time: `2099-07-29T${String(12 + index).padStart(2, '0')}:00:00+02:00`,
      condition: index > 2 ? 'cloudy' : 'partly_cloudy',
      weather_code: index > 2 ? 3 : 2,
      cloud_cover_percent: index * 10,
      temperature_c: 22 + index,
      precipitation_mm: 0,
      precipitation_probability_percent: index * 10,
    })),
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2099-0${index < 3 ? '7' : '8'}-${String(29 + index > 31 ? 29 + index - 31 : 29 + index).padStart(2, '0')}`,
      condition: index > 2 ? 'rain' : 'partly_cloudy',
      weather_code: index > 2 ? 61 : 2,
      temperature_min_c: 14 + index,
      temperature_max_c: 22 + index,
      precipitation_probability_percent: index * 10,
      sunrise: null,
      sunset: null,
    })),
    quality: { freshness: 'fresh', source: 'open_meteo', age_seconds: 0 },
    warnings: [],
    ...overrides,
  };
}

describe('WeatherIntelligence', () => {
  it('renders complete current weather, PV context, sun data, and hourly depth', () => {
    render(<WeatherIntelligence report={completeReport()} locale="de-DE" snapshot={freshSnapshot} now={new Date('2099-07-29T12:00:00+02:00')} />);
    const section = screen.getByRole('region', { name: 'Wetter und Solarbedingungen' });

    expect(within(section).getByText('Teststadt')).toBeTruthy();
    expect(within(section).getByText('22,4 °C')).toBeTruthy();
    expect(within(section).getByText('Teilweise bewölkt')).toBeTruthy();
    expect(within(section).getByText(/Gefühlt 21,8 °C/)).toBeTruthy();
    expect(within(section).getByText(/12,5 km\/h/)).toBeTruthy();
    expect(within(section).getByText(/Sonnenaufgang:/)).toBeTruthy();
    expect(within(section).getByText(/Sonnenuntergang:/)).toBeTruthy();
    expect(within(section).getByText('Die aktuellen Bedingungen für Solarstrom sind günstig.')).toBeTruthy();
    expect(within(section).getAllByRole('listitem')).toHaveLength(6);
  });

  it('renders partial weather without raw null-like values', () => {
    const report = completeReport({
      location: null,
      sun: null,
      hourly: [],
      current: {
        condition: 'cloudy',
        weather_code: null,
        cloud_cover_percent: null,
        temperature_c: null,
        precipitation_mm: null,
        is_day: null,
      },
    });
    render(<WeatherIntelligence report={report} locale="de-DE" />);
    const text = screen.getByRole('region', { name: 'Wetter und Solarbedingungen' }).textContent ?? '';

    expect(text).toContain('Temperatur nicht verfügbar');
    expect(text).toContain('Bewölkt');
    expect(text).not.toMatch(/\b(?:None|null|undefined)\b/i);
  });

  it.each([null, completeReport({ status: 'unreachable', current: null })])(
    'shows a calm fallback when weather is unavailable',
    report => {
      render(<WeatherIntelligence report={report} locale="de-DE" />);
      expect(screen.getByText('Wetterdaten aktuell nicht verfügbar')).toBeTruthy();
    },
  );

  it('omits the forecast and sun event when those fields are missing', () => {
    render(<WeatherIntelligence report={completeReport({ hourly: [], sun: null })} locale="de-DE" />);
    expect(screen.queryByText('Nächste Stunden')).toBeNull();
    expect(screen.queryByText(/Sonnen(?:auf|unter)gang/)).toBeNull();
  });

  it('omits PV interpretation at night and without cloud-cover evidence', () => {
    const night = completeReport({
      current: { ...completeReport().current!, is_day: false, cloud_cover_percent: 95 },
    });
    const noCloudEvidence = completeReport({
      current: { ...completeReport().current!, cloud_cover_percent: null },
    });

    const { rerender } = render(<WeatherIntelligence report={night} locale="de-DE" snapshot={freshSnapshot} now={new Date('2099-07-29T22:00:00+02:00')} />);
    expect(screen.getByText('Die Solarerzeugung ist für heute beendet.')).toBeTruthy();
    expect(screen.queryByText(/Bewölkung.*Solarbedingungen/)).toBeNull();

    rerender(<WeatherIntelligence report={noCloudEvidence} locale="de-DE" snapshot={freshSnapshot} now={new Date('2099-07-29T12:00:00+02:00')} />);
    expect(screen.getByText('Die aktuelle Solarleistung wird zuverlässig gemessen.')).toBeTruthy();
  });

  it('does not render an empty forecast section for malformed hourly points', () => {
    const report = completeReport({
      hourly: [{
        time: 'invalid',
        condition: 'unknown',
        weather_code: null,
        cloud_cover_percent: null,
        temperature_c: null,
        precipitation_mm: null,
      }],
    });
    render(<WeatherIntelligence report={report} locale="de-DE" />);
    expect(screen.queryByText('Nächste Stunden')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('suppresses non-finite metrics and null-like payload strings', () => {
    const report = completeReport({
      location: { ...completeReport().location!, display_name: 'null' },
      current: {
        ...completeReport().current!,
        condition: 'undefined',
        feels_like_c: Number.NaN,
        wind_speed_kmh: Number.NaN,
        precipitation_probability_percent: Number.NaN,
      },
    });
    render(<WeatherIntelligence report={report} locale="de-DE" />);
    const text = screen.getByRole('region', { name: 'Wetter und Solarbedingungen' }).textContent ?? '';
    expect(text).toContain('Wetterlage unbekannt');
    expect(text).not.toMatch(/\b(?:None|null|undefined|NaN|Invalid Date)\b/i);
    expect(text).not.toContain('km/h');
  });

  it('keeps a long provider condition readable and contained', () => {
    const report = completeReport({
      current: {
        ...completeReport().current!,
        condition: 'lang_anhaltende_dichte_bewölkung_mit_vereinzelten_schauern',
      },
    });
    render(<WeatherIntelligence report={report} locale="de-DE" />);
    const condition = screen.getByText('lang anhaltende dichte bewölkung mit vereinzelten schauern');
    expect(condition.className).toContain('break-words');
    expect(condition.closest('section')?.className).toContain('overflow-hidden');
  });

  it('contains an unusually long location label without widening the card', () => {
    const location = 'Neustadt an der sehr langen Wetterbeobachtungsstraße, Region mit langem Namen';
    const report = completeReport({
      location: { ...completeReport().location!, display_name: location },
    });
    render(<WeatherIntelligence report={report} locale="de-DE" />);
    const label = screen.getByText(location);
    expect(label.className).toContain('truncate');
    expect(label.getAttribute('title')).toBe(location);
  });

  it('uses a wrapping forecast grid suitable for narrow windows', () => {
    render(<WeatherIntelligence report={completeReport()} locale="de-DE" />);
    const list = screen.getByRole('list');
    expect(list.className).toContain('auto-fit');
    expect(list.className).not.toContain('overflow-x');
  });

  it('keeps Home compact while Today can render hourly and a secondary seven-day outlook', () => {
    const report = completeReport();
    const { rerender } = render(<WeatherIntelligence report={report} locale="de-DE" compact />);
    expect(screen.queryByRole('region', { name: 'Stündliche Wettervorhersage' })).toBeNull();
    expect(screen.getByText(/12,5 km\/h/)).toBeTruthy();
    expect(screen.getByText('15 %')).toBeTruthy();

    rerender(<><HourlyWeatherForecast report={report} locale="de-DE" /><MultiDayWeatherForecast report={report} locale="de-DE" /></>);
    expect(screen.getByRole('region', { name: 'Stündliche Wettervorhersage' })).toBeTruthy();
    expect(screen.getByText('5–7-Tage-Ausblick')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: '1 weitere Stunden anzeigen' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(14);
  });
});
