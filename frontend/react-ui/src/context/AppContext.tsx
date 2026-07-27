import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { ViewState, SystemStatus, ThemeMode, PowerData, TodayData, DeviceCardData, SettingsPayload, RawSettings, LocationCandidateData, WeatherReportData } from '../types';
import { initBridge, QtBridge } from '../lib/bridge';
import { nowData$, todayData$, startEnergyService } from '../lib/energyService';
import { NumberLocale, DEFAULT_NUMBER_LOCALE } from '../lib/format';

export type SearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error' | 'timeout';
export type SavedLocationState = 'absent' | 'saved';
export type WeatherTestStatus = 'idle' | 'loading' | 'success' | 'error' | 'timeout';
export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SettingsSaveState {
  status: SettingsSaveStatus;
  message?: string;
}

export interface WeatherSearchState {
  status: SearchState;
  requestId: string | null;
  candidates: LocationCandidateData[];
  message?: string;
}

export interface WeatherTestResult {
  ok: boolean;
  message: string;
  latency_ms?: number;
  [key: string]: unknown;
}

export interface WeatherTestState {
  status: WeatherTestStatus;
  requestId: string | null;
  result?: WeatherTestResult;
}

interface AppContextType {
  view: ViewState;
  setView: (view: ViewState) => void;
  status: SystemStatus;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  powerData: PowerData;
  todayData: TodayData;
  devices: DeviceCardData[];
  testConnectionStatus: Record<string, { testing: boolean; result?: any }>;
  settingsPayload: SettingsPayload | null;
  weatherValidationState: { checking: boolean; result?: any };
  weatherSearchState: WeatherSearchState;
  savedLocationState: SavedLocationState;
  weatherReport: WeatherReportData | null;
  weatherTestState: WeatherTestState;
  settingsSaveState: SettingsSaveState;
  // Weather actions
  searchWeatherLocations: (query: string) => void;
  confirmWeatherLocation: (candidate: LocationCandidateData) => void;
  removeResolvedLocation: () => void;
  testWeatherConnection: () => void;
  // Settings actions
  updateSettings: (patch: RawSettings) => void;
  saveSettings: (settings: { theme?: string; refresh_seconds?: number; mt175_address?: string }) => void;
  saveFroniusAddress: (address: string) => void;
  testConnection: (deviceId: string) => void;
  chooseExportDirectory: () => void;
  openExportDirectory: () => void;
  validateWeatherConfiguration: () => void;
  openDiagnosticLog: () => void;
  openLogDirectory: () => void;
  // Export actions
  requestExport: (kind: string, range: string, start: string, end: string) => void;
  requestMailShare: (range: string, start: string, end: string) => void;
  exportStatus: { id: string, status: 'idle'|'running'|'done'|'error', msg?: string };
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// Start the centralized energy service
startEnergyService();

// Removed mapTodayData as todayData$ now manages this state.

export function AppProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewState>('now');
  const [theme, setTheme] = useState<ThemeMode>('dark');

  // State from energyService
  const [nowDataState, setNowDataState] = useState(nowData$.get());

  const [todayDataState, setTodayDataState] = useState(todayData$.get());
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [bridge, setBridge] = useState<QtBridge | null>(null);

  const [exportStatus, setExportStatus] = useState<{ id: string, status: 'idle'|'running'|'done'|'error', msg?: string }>({ id: '', status: 'idle' });
  const [devices, setDevices] = useState<DeviceCardData[]>([]);
  const [testConnectionStatus, setTestConnectionStatus] = useState<Record<string, { testing: boolean; result?: any }>>({});
  const [settingsPayload, setSettingsPayload] = useState<SettingsPayload | null>(null);
  const [weatherValidationState, setWeatherValidationState] = useState<{ checking: boolean; result?: any }>({ checking: false });
  const [weatherSearchState, setWeatherSearchState] = useState<WeatherSearchState>({
    status: 'idle',
    requestId: null,
    candidates: [],
  });
  const searchOpIdRef = useRef<string | null>(null);
  const searchSequenceRef = useRef(0);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [weatherReport, setWeatherReport] = useState<WeatherReportData | null>(null);
  const [weatherTestState, setWeatherTestState] = useState<WeatherTestState>({
    status: 'idle',
    requestId: null,
  });
  const weatherTestOpIdRef = useRef<string | null>(null);
  const weatherTestSequenceRef = useRef(0);
  const weatherTestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>({ status: 'idle' });
  const settingsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Subscribe to energyService ────────────────────────────────────
  useEffect(() => {
    const unsubNow = nowData$.subscribe(state => setNowDataState(state));
    const unsubToday = todayData$.subscribe(state => setTodayDataState(state));
    return () => {
      unsubNow();
      unsubToday();
    };
  }, []);

  // ── Connect to Qt bridge on mount ──────────────────────────────────
  useEffect(() => {
    initBridge().then((b) => {
      if (!b) {
        setBridgeConnected(false);
        return;
      }

      setBridge(b);
      setBridgeConnected(true);

      const parseDevices = () => {
        try {
          if (b.devicesData) {
            const parsed = JSON.parse(b.devicesData);
            if (Array.isArray(parsed)) setDevices(parsed);
          }
        } catch (e) {
          console.warn('[bridge] Failed to parse devicesData JSON, keeping prior state', e);
        }
      };

      b.devicesDataChanged.connect(parseDevices);
      parseDevices();

      b.connectionTestStarted.connect((devId) => {
        setTestConnectionStatus(prev => ({
          ...prev,
          [devId]: { testing: true }
        }));
      });

      b.connectionTestResult.connect((devId, _, resJson) => {
        try {
          const res = JSON.parse(resJson);
          setTestConnectionStatus(prev => ({
            ...prev,
            [devId]: { testing: false, result: res }
          }));
        } catch {
          setTestConnectionStatus(prev => ({
            ...prev,
            [devId]: { testing: false }
          }));
        }
      });

      const parseSettings = () => {
        try {
          if (b.settingsData) {
            const parsed = JSON.parse(b.settingsData);
            setSettingsPayload(parsed);
            if (parsed.effective_settings?.theme) {
              setTheme(parsed.effective_settings.theme);
            }
          }
        } catch (e) {
          console.warn('[bridge] Failed to parse settingsData JSON', e);
        }
      };

      b.settingsDataChanged.connect(() => {
        parseSettings();
      });
      parseSettings();

      // "Gespeichert" is only shown once the backend confirms the write.
      b.settingsSaveSucceeded.connect(() => {
        if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
        setSettingsSaveState({ status: 'saved' });
        settingsSaveTimeoutRef.current = setTimeout(() => {
          setSettingsSaveState(prev => (prev.status === 'saved' ? { status: 'idle' } : prev));
          settingsSaveTimeoutRef.current = null;
        }, 3000);
      });

      b.settingsSaveFailed.connect((errorJson) => {
        if (settingsSaveTimeoutRef.current) {
          clearTimeout(settingsSaveTimeoutRef.current);
          settingsSaveTimeoutRef.current = null;
        }
        let message = 'Einstellungen konnten nicht gespeichert werden.';
        try {
          const parsed = JSON.parse(errorJson);
          if (typeof parsed?.error === 'string' && parsed.error) message = parsed.error;
        } catch {}
        setSettingsSaveState({ status: 'error', message });
      });

      b.weatherCandidatesResult.connect((opId, resJson) => {
        if (opId !== searchOpIdRef.current) return;
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }
        try {
          const res = JSON.parse(resJson);
          const candidates = Array.isArray(res.candidates) ? res.candidates : [];
          if (res.ok !== true) {
            setWeatherSearchState({
              status: 'error',
              requestId: opId,
              candidates: [],
              message: typeof res.error === 'string' ? res.error : 'Standortsuche fehlgeschlagen.',
            });
          } else if (candidates.length === 0) {
            setWeatherSearchState({ status: 'empty', requestId: opId, candidates: [] });
          } else {
            setWeatherSearchState({ status: 'results', requestId: opId, candidates });
          }
        } catch {
          setWeatherSearchState({
            status: 'error',
            requestId: opId,
            candidates: [],
            message: 'Antwort der Standortsuche war ungültig.',
          });
        }
      });

      b.weatherConnectionTestStarted.connect((opId) => {
        if (opId !== weatherTestOpIdRef.current) return;
        setWeatherTestState({ status: 'loading', requestId: opId });
      });

      b.weatherConnectionTestResult.connect((opId, resJson) => {
        if (opId !== weatherTestOpIdRef.current) return;
        if (weatherTestTimeoutRef.current) {
          clearTimeout(weatherTestTimeoutRef.current);
          weatherTestTimeoutRef.current = null;
        }
        weatherTestOpIdRef.current = null;
        try {
          const res = JSON.parse(resJson) as WeatherTestResult;
          if (typeof res?.ok !== 'boolean' || typeof res?.message !== 'string') {
            throw new Error('invalid payload');
          }
          setWeatherTestState({
            status: res.ok ? 'success' : 'error',
            requestId: opId,
            result: res,
          });
        } catch {
          setWeatherTestState({
            status: 'error',
            requestId: opId,
            result: { ok: false, message: 'Antwort des Wettertests war ungültig.' },
          });
        }
      });

      b.weatherReportChanged.connect((weatherJson) => {
        try {
          const parsed = JSON.parse(weatherJson);
          setWeatherReport(parsed);
        } catch {}
      });
      b.requestWeatherReport();

      b.exportStarted.connect((opId) => {
        setExportStatus({ id: opId, status: 'running' });
      });

      b.exportCompleted.connect((jsonStr) => {
        try {
           const res = JSON.parse(jsonStr);
           setExportStatus({ id: res.operation_id, status: 'done', msg: `Export erfolgreich: ${res.filename}` });
        } catch {}
      });

      b.exportFailed.connect((opId, err) => {
        setExportStatus({ id: opId, status: 'error', msg: err });
      });

      b.mailHandoffPrepared.connect((opId) => {
        setExportStatus({ id: opId, status: 'done', msg: 'Mail vorbereitet. PDF wurde markiert.' });
      });

      b.directorySelected.connect((dirPath) => {
        setSettingsPayload(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            effective_settings: { ...prev.effective_settings, export_directory: dirPath },
            settings: { ...prev.settings, export_directory: dirPath }
          };
        });
      });
    });
  }, []);

  useEffect(() => () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (weatherTestTimeoutRef.current) clearTimeout(weatherTestTimeoutRef.current);
    if (settingsSaveTimeoutRef.current) clearTimeout(settingsSaveTimeoutRef.current);
  }, []);

  // ── Apply theme & global styling attributes to DOM ───────────────────────
  useEffect(() => {
    const root = window.document.documentElement;
    root.setAttribute('lang', 'de');

    const effective = settingsPayload?.effective_settings;
    const currentTheme = theme || effective?.theme || 'dark';
    const motionMode = effective?.motion_mode || 'full';
    const textSize = effective?.text_size || 'normal';

    root.setAttribute('data-theme', currentTheme);
    root.setAttribute('data-motion', motionMode);
    root.setAttribute('data-text-size', textSize);

    const applyThemeClass = () => {
      root.classList.remove('light', 'dark');
      if (currentTheme === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(systemDark ? 'dark' : 'light');
      } else {
        root.classList.add(currentTheme);
      }
    };

    applyThemeClass();

    if (currentTheme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyThemeClass();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [theme, settingsPayload]);

  // ── Weather actions ──────────────────────────────────────────────
  const searchWeatherLocations = (query: string) => {
    if (!query.trim()) {
      searchOpIdRef.current = null;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      setWeatherSearchState({ status: 'idle', requestId: null, candidates: [] });
      return;
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    searchSequenceRef.current += 1;
    const opId = `weather-search-${Date.now()}-${searchSequenceRef.current}`;
    searchOpIdRef.current = opId;
    setWeatherSearchState({ status: 'loading', requestId: opId, candidates: [] });
    if (bridge) {
      bridge.searchWeatherLocations(opId, query);
      searchTimeoutRef.current = setTimeout(() => {
        setWeatherSearchState(prev => (
          prev.status === 'loading' && prev.requestId === opId
            ? {
                status: 'timeout',
                requestId: opId,
                candidates: [],
                message: 'Standortsuche hat das Zeitlimit überschritten.',
              }
            : prev
        ));
        searchTimeoutRef.current = null;
      }, 10000);
    } else {
      searchOpIdRef.current = null;
      setWeatherSearchState({
        status: 'error',
        requestId: opId,
        candidates: [],
        message: 'Desktop-Verbindung ist nicht verfügbar.',
      });
    }
  };

  const confirmWeatherLocation = (candidate: LocationCandidateData) => {
    searchOpIdRef.current = null;
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setWeatherSearchState({ status: 'idle', requestId: null, candidates: [] });
    if (bridge) {
      bridge.confirmWeatherLocation(JSON.stringify(candidate));
    }
  };

  const removeResolvedLocation = () => {
    searchOpIdRef.current = null;
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setWeatherSearchState({ status: 'idle', requestId: null, candidates: [] });
    if (bridge) {
      bridge.removeResolvedLocation();
    }
  };

  const testWeatherConnection = () => {
    if (weatherTestTimeoutRef.current) {
      clearTimeout(weatherTestTimeoutRef.current);
      weatherTestTimeoutRef.current = null;
    }
    weatherTestSequenceRef.current += 1;
    const opId = `weather-test-${Date.now()}-${weatherTestSequenceRef.current}`;
    weatherTestOpIdRef.current = opId;
    setWeatherTestState({ status: 'loading', requestId: opId });
    if (bridge) {
      bridge.testWeatherConnection(opId);
      weatherTestTimeoutRef.current = setTimeout(() => {
        if (weatherTestOpIdRef.current !== opId) return;
        weatherTestOpIdRef.current = null;
        setWeatherTestState({
          status: 'timeout',
          requestId: opId,
          result: {
            ok: false,
            message: 'Zeitüberschreitung — Wetterdienst antwortet nicht.',
          },
        });
        weatherTestTimeoutRef.current = null;
      }, 15000);
    } else {
      weatherTestOpIdRef.current = null;
      setWeatherTestState({
        status: 'error',
        requestId: opId,
        result: { ok: false, message: 'Desktop-Verbindung ist nicht verfügbar.', latency_ms: 0 },
      });
    }
  };
  const updateSettings = (patch: RawSettings) => {
    if (settingsSaveTimeoutRef.current) {
      clearTimeout(settingsSaveTimeoutRef.current);
      settingsSaveTimeoutRef.current = null;
    }
    if (!bridge) {
      setSettingsSaveState({ status: 'error', message: 'Desktop-Verbindung ist nicht verfügbar.' });
      return;
    }
    setSettingsSaveState({ status: 'saving' });
    bridge.updateSettings(JSON.stringify(patch));
  };

  const saveSettings = (settings: { theme?: string; refresh_seconds?: number; mt175_address?: string }) => {
    if (bridge) bridge.updateSettings(JSON.stringify(settings));
    if (settings.theme) setTheme(settings.theme as ThemeMode);
  };

  const saveFroniusAddress = (address: string) => {
    if (bridge) bridge.saveFroniusAddress(address);
  };

  const chooseExportDirectory = () => {
    if (bridge) bridge.chooseExportDirectory();
  };

  const openExportDirectory = () => {
    if (bridge) bridge.openExportDirectory();
  };

  const validateWeatherConfiguration = () => {
    setWeatherValidationState({ checking: true });
    if (bridge) {
      bridge.validateWeatherConfiguration();
    } else {
      setWeatherValidationState({
        checking: false,
        result: { ok: false, message: 'Desktop-Verbindung ist nicht verfügbar.' },
      });
    }
  };

  const openDiagnosticLog = () => {
    if (bridge) bridge.openDiagnosticLog();
  };

  const openLogDirectory = () => {
    if (bridge) bridge.openLogDirectory();
  };

  const testConnection = (deviceId: string) => {
    if (bridge) {
      bridge.testConnection(deviceId);
    } else {
      setTestConnectionStatus(prev => ({
        ...prev,
        [deviceId]: {
          testing: false,
          result: { ok: false, message: 'Desktop-Verbindung ist nicht verfügbar.', latency_ms: 0 },
        },
      }));
    }
  };

  const requestExport = (kind: string, range: string, start: string, end: string) => {
    const opId = Math.random().toString(36).substring(7);
    if (bridge) bridge.requestExport(opId, kind, range, start, end);
    else {
      setExportStatus({ id: opId, status: 'error', msg: 'Desktop-Verbindung ist nicht verfügbar.' });
    }
  };

  const requestMailShare = (range: string, start: string, end: string) => {
    const opId = Math.random().toString(36).substring(7);
    if (bridge) bridge.requestMailShare(opId, range, start, end);
    else {
       setExportStatus({ id: opId, status: 'error', msg: 'Desktop-Verbindung ist nicht verfügbar.' });
    }
  };

  return (
    <AppContext.Provider value={{
      view, setView,
      status: nowDataState.status,
      theme, setTheme,
      powerData: nowDataState.power,
      todayData: todayDataState,
      bridgeConnected,
      devices,
      testConnectionStatus,
      settingsPayload,
      weatherSearchState,
      savedLocationState: (
        settingsPayload?.settings?.resolved_location
        || (
          typeof settingsPayload?.settings?.latitude === 'number'
          && typeof settingsPayload?.settings?.longitude === 'number'
        )
      ) ? 'saved' : 'absent',
      weatherReport,
      weatherTestState,
      settingsSaveState,
      searchWeatherLocations,
      confirmWeatherLocation,
      removeResolvedLocation,
      testWeatherConnection,
      updateSettings,
      saveSettings,
      saveFroniusAddress,
      testConnection,
      chooseExportDirectory,
      openExportDirectory,
      validateWeatherConfiguration,
      openDiagnosticLog,
      openLogDirectory,
      requestExport,
      requestMailShare,
      exportStatus,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

/**
 * The locale every visible number is formatted with, from the
 * `number_format` setting. Read through a hook so a settings change
 * re-renders the consuming view with the new format.
 */
export function useNumberLocale(): NumberLocale {
  const { settingsPayload } = useApp();
  return settingsPayload?.effective_settings?.number_format ?? DEFAULT_NUMBER_LOCALE;
}
