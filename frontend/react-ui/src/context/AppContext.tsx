import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ViewState, SystemStatus, ThemeMode, PowerData, TodayData, DeviceCardData, SettingsPayload, RawSettings, LocationCandidateData, WeatherReportData } from '../types';
import { initBridge, QtBridge } from '../lib/bridge';
import { nowData$, todayData$, startEnergyService } from '../lib/energyService';

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
  weatherCandidates: LocationCandidateData[];
  isSearchingCandidates: boolean;
  weatherReport: WeatherReportData | null;
  weatherTestState: { testing: boolean; result?: any };
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
  const [weatherCandidates, setWeatherCandidates] = useState<LocationCandidateData[]>([]);
  const [isSearchingCandidates, setIsSearchingCandidates] = useState(false);
  const [weatherReport, setWeatherReport] = useState<WeatherReportData | null>(null);
  const [weatherTestState, setWeatherTestState] = useState<{ testing: boolean; result?: any }>({ testing: false });

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

      b.settingsDataChanged.connect(parseSettings);
      parseSettings();

      b.weatherCandidatesResult.connect((_, resJson) => {
        try {
          const res = JSON.parse(resJson);
          setWeatherCandidates(res.candidates || []);
        } catch {
          setWeatherCandidates([]);
        } finally {
          setIsSearchingCandidates(false);
        }
      });

      b.weatherConnectionTestStarted.connect(() => {
        setWeatherTestState({ testing: true });
      });

      b.weatherConnectionTestResult.connect((_, resJson) => {
        try {
          const res = JSON.parse(resJson);
          setWeatherTestState({ testing: false, result: res });
        } catch {
          setWeatherTestState({ testing: false });
        }
      });

      b.weatherReportChanged.connect((weatherJson) => {
        try {
          const parsed = JSON.parse(weatherJson);
          setWeatherReport(parsed);
        } catch {}
      });

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
      setWeatherCandidates([]);
      return;
    }
    setIsSearchingCandidates(true);
    const opId = `loc-search-${Date.now()}`;
    if (bridge) {
      bridge.searchWeatherLocations(opId, query);
    } else {
      setWeatherCandidates([]);
      setIsSearchingCandidates(false);
    }
  };

  const confirmWeatherLocation = (candidate: LocationCandidateData) => {
    if (bridge) {
      bridge.confirmWeatherLocation(JSON.stringify(candidate));
    }
    setWeatherCandidates([]);
  };

  const removeResolvedLocation = () => {
    if (bridge) {
      bridge.removeResolvedLocation();
    }
  };

  const testWeatherConnection = () => {
    setWeatherTestState({ testing: true });
    const opId = `wtest-${Date.now()}`;
    if (bridge) {
      bridge.testWeatherConnection(opId);
    } else {
      setWeatherTestState({
        testing: false,
        result: { ok: false, message: 'Desktop-Verbindung ist nicht verfügbar.' },
      });
    }
  };
  const updateSettings = (patch: RawSettings) => {
    if (bridge) {
      bridge.updateSettings(JSON.stringify(patch));
    }
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
      weatherCandidates,
      isSearchingCandidates,
      weatherReport,
      weatherTestState,
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
