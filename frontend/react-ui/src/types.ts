export type ViewState = 'now' | 'today' | 'devices' | 'memory' | 'settings';

export type SystemStatus = 'live' | 'no_data' | 'meter_locked' | 'stale' | 'error';

export type ThemeMode = 'light' | 'dark' | 'system';

export type DataState<T> =
  | { state: 'loading' }
  | { state: 'available', value: T }
  | { state: 'unknown' }
  | { state: 'error', message: string };

export interface PowerData {
  solar: DataState<number>;
  grid: DataState<number>;  // positive = grid draw, negative = feed-in
  home: DataState<number>;
  lastUpdated: string | null;
  solar_forecast?: SolarForecastReportData | null;
}

export interface TodayHistoryPoint {
  time: string;
  solar: number | null;
  home: number | null;
  gridImport: number | null;
  gridExport: number | null;
}

export interface TodayData {
  solarTotal: DataState<number>;
  homeTotal: DataState<number>;
  gridFeedInTotal: DataState<number>;
  gridDrawTotal: DataState<number>;
  selfSufficiency: DataState<number>;
  selfConsumption: DataState<number>;
  history: TodayHistoryPoint[];
  solar_forecast?: SolarForecastReportData | null;
}

export interface DeviceCardData {
  device_id: string;
  device_type: 'inverter' | 'smart_meter' | string;
  display_name: string;
  connection_status: 'connected' | 'stale' | 'offline' | 'error' | 'unconfigured' | 'testing' | string;
  data_status: 'complete' | 'partial' | 'unavailable' | 'error' | 'unconfigured' | string;
  configuration_status: 'configured' | 'unconfigured' | string;
  address_display: string;
  protocol: string;
  firmware: string | null;
  last_seen_at: string | null;
  last_measurement_at: string | null;
  last_successful_test_at: string | null;
  last_error_at: string | null;
  capabilities: string[];
  data_quality_label: string;
  pin_status: 'locked' | 'unlocked' | 'not_applicable' | string;
  pin_instructions: string | null;
  user_message: string;
  technical_error: string | null;
}

export interface RawSettings {
  refresh_seconds?: number | null;
  theme?: 'dark' | 'light' | 'system' | null;
  dynamic_bg_enabled?: boolean | null;
  motion_mode?: 'full' | 'reduced' | 'none' | null;
  text_size?: 'normal' | 'large' | null;
  number_format?: 'de-DE' | 'en-US' | null;
  location_mode?: 'manual' | 'none' | null;
  location_query?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  weather_enabled?: boolean | null;
  export_directory?: string | null;
  fronius_address?: string | null;
  mt175_address?: string | null;
  pv_installed_kwp?: number | null;
  resolved_location?: ResolvedLocationData | null;
}

export interface EffectiveSettings {
  refresh_seconds: number;
  theme: 'dark' | 'light' | 'system';
  dynamic_bg_enabled: boolean;
  motion_mode: 'full' | 'reduced' | 'none';
  text_size: 'normal' | 'large';
  number_format: 'de-DE' | 'en-US';
  location_mode: 'manual' | 'none';
  location_query: string | null;
  latitude: number | null;
  longitude: number | null;
  weather_enabled: boolean;
  export_directory: string | null;
  fronius_address: string;
  mt175_address: string;
  pv_installed_kwp: number | null;
}

export interface SystemInfo {
  app_version: string;
  build: string;
  database_schema_version: number;
  database_path: string;
  log_path: string;
}

export interface SettingsPayload {
  settings: RawSettings;
  effective_settings: EffectiveSettings;
  system: SystemInfo;
  fronius_address: string;
  fronius_editable: boolean;
  mt175_address: string;
  refresh_seconds: number;
  timezone: string;
  theme: ThemeMode;
}

export interface LocationCandidateData {
  provider_id: string;
  display_name: string;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string | null;
  admin2?: string | null;
  country?: string | null;
  country_code?: string | null;
  postcodes?: string[] | null;
  timezone?: string | null;
  provider: string;
}

export interface ResolvedLocationData {
  provider_id: string;
  display_name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country_code?: string | null;
  provider: string;
  original_query: string;
  resolved_at: string;
}

export interface SunData {
  sunrise: string | null;
  sunset: string | null;
}

export interface CurrentWeatherData {
  condition: string;
  weather_code: number | null;
  cloud_cover_percent: number | null;
  temperature_c: number | null;
  precipitation_mm: number | null;
  is_day: boolean | null;
}

export interface WeatherQualityData {
  freshness: 'fresh' | 'stale' | 'expired' | 'unknown';
  source: string;
  age_seconds: number | null;
}

export interface WeatherWarningData {
  code: string;
  message: string;
}

export interface WeatherReportData {
  status: 'available' | 'disabled' | 'missing_location' | 'unreachable' | 'error';
  provider_status: 'reachable' | 'unreachable' | 'rate_limited' | 'invalid_response' | 'unknown';
  served_from_cache: boolean;
  observed_at: string | null;
  fetched_at: string | null;
  location: ResolvedLocationData | null;
  sun: SunData | null;
  current: CurrentWeatherData | null;
  quality: WeatherQualityData | null;
  warnings: WeatherWarningData[];
}

export interface SolarForecastIntervalData {
  start_time: string;
  end_time: string;
  expected_min_w: number | null;
  expected_max_w: number | null;
  trend: 'rising' | 'steady' | 'falling' | 'unknown';
  cloud_cover_percent: number | null;
}

export interface ForecastConfidenceData {
  level: 'high' | 'medium' | 'low' | 'uncertain';
  score: number;
  reasons: string[];
}

export interface SolarForecastReportData {
  status: 'available' | 'disabled' | 'uncertain' | 'no_data';
  headline: string;
  confidence: ForecastConfidenceData;
  peak_window_start: string | null;
  peak_window_end: string | null;
  installed_kwp: number | null;
  intervals: SolarForecastIntervalData[];
  generated_at: string;
  valid_until: string | null;
  data_basis: string[];
  warnings: string[];
}
