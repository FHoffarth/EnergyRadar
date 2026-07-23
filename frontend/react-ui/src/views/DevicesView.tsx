import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ChevronDown, ChevronUp, Server, Activity, CheckCircle, AlertTriangle, XCircle, HelpCircle, Loader2, RefreshCw, Key, ShieldAlert } from 'lucide-react';
import { DeviceCardData } from '../types';

export function DevicesView() {
  const { devices, setView, testConnection, testConnectionStatus, saveFroniusAddress, updateSettings } = useApp();
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [editingIp, setEditingIp] = useState<Record<string, string>>({});

  const toggleExpand = (id: string) => {
    setExpandedDevice(prev => prev === id ? null : id);
  };

  const displayDevices: DeviceCardData[] = devices;

  const issuesCount = displayDevices.filter(d => d.connection_status !== 'connected' || d.data_status !== 'complete').length;

  const capLabelMap: Record<string, string> = {
    'current_power': 'Solarleistung',
    'daily_energy': 'Tageserzeugung',
    'grid_import_total': 'Zählerstand Bezug (kWh)',
    'grid_export_total': 'Zählerstand Einspeisung (kWh)',
  };

  const formatRelativeTime = (isoStr: string | null) => {
    if (!isoStr) return 'Noch nie';
    try {
      const dt = new Date(isoStr);
      const diffSec = Math.floor((Date.now() - dt.getTime()) / 1000);
      if (diffSec < 10) return 'vor wenigen Sekunden';
      if (diffSec < 60) return `vor ${diffSec} Sekunden`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `vor ${diffMin} Minute${diffMin > 1 ? 'n' : ''}`;
      const diffHours = Math.floor(diffMin / 60);
      return `vor ${diffHours} Stunde${diffHours > 1 ? 'n' : ''}`;
    } catch {
      return 'Noch nie';
    }
  };

  const renderStatusBadge = (device: DeviceCardData) => {
    const conn = device.connection_status;
    const data = device.data_status;
    const pin = device.pin_status;

    if (conn === 'unconfigured') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
          <span>— Nicht eingerichtet</span>
        </div>
      );
    }
    if (conn === 'error' || data === 'error') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          <XCircle className="w-4 h-4" />
          <span>× Fehler</span>
        </div>
      );
    }
    if (conn === 'offline' || data === 'unavailable') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
          <XCircle className="w-4 h-4" />
          <span>× Offline</span>
        </div>
      );
    }
    if (pin === 'locked' || data === 'partial') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-4 h-4" />
          <span>! PIN erforderlich</span>
        </div>
      );
    }
    if (conn === 'stale') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
          <AlertTriangle className="w-4 h-4" />
          <span>⏱ Veraltet</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
        <CheckCircle className="w-4 h-4" />
        <span>✓ Verbunden</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full pt-12 pb-8 overflow-y-auto">
      {/* Header Statement */}
      <header className="px-12 pb-8">
        <h1 className="text-4xl font-semibold text-[#1C1C1E] dark:text-white leading-tight max-w-2xl">
          {displayDevices.length === 0
            ? 'Noch keine Geräte eingerichtet.'
            : issuesCount > 0
            ? `${issuesCount} Gerät${issuesCount > 1 ? 'e benötigen' : ' benötigt'} Aufmerksamkeit.`
            : "Alle Geräte arbeiten wie erwartet."}
        </h1>
        <p className="text-[#6E6E6E] dark:text-slate-400 mt-3 text-lg">
          {displayDevices.length === 0
            ? 'Verbinde EnergyRadar in den Einstellungen mit deinem lokalen Energiesystem.'
            : `${displayDevices.length} Geräte im Netzwerk konfiguriert.`}
        </p>
      </header>

      {/* Devices List */}
      <section className="px-12 space-y-6 pb-12">
        {displayDevices.length === 0 && (
          <div className="bg-white dark:bg-slate-800/90 rounded-3xl border border-[#E5E5E3] dark:border-slate-700 p-8">
            <p className="text-slate-700 dark:text-slate-300">
              Es werden keine Demo-Geräte oder erfundenen Messwerte angezeigt.
            </p>
            <button
              type="button"
              onClick={() => setView('settings')}
              className="mt-5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors"
            >
              Datenquelle einrichten
            </button>
          </div>
        )}
        {displayDevices.map(device => {
          const isExpanded = expandedDevice === device.device_id;
          const testState = testConnectionStatus[device.device_id] || { testing: false };

          return (
            <div key={device.device_id} className="bg-white dark:bg-slate-800/90 rounded-3xl border border-[#E5E5E3] dark:border-slate-700 shadow-sm overflow-hidden transition-all duration-300">

              {/* Primary Card View */}
              <div className="p-8">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-5">
                    <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-700 shrink-0">
                      {device.device_type === 'inverter' ? (
                        <Server className="w-8 h-8 text-indigo-500" />
                      ) : (
                        <Activity className="w-8 h-8 text-emerald-500" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-2xl font-bold text-[#1C1C1E] dark:text-white">{device.display_name}</h3>
                        {renderStatusBadge(device)}
                      </div>

                      <p className="text-base text-slate-700 dark:text-slate-300 mt-2 font-medium">
                        {device.user_message}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mt-3">
                        <span>Zuletzt gemessen: <strong>{formatRelativeTime(device.last_measurement_at)}</strong></span>
                        <span>•</span>
                        <span>Datenqualität: <strong>{device.data_quality_label}</strong></span>
                      </div>

                      {/* Capability Pills */}
                      {device.capabilities && device.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {device.capabilities.map(cap => (
                            <span key={cap} className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-xs font-medium">
                              {capLabelMap[cap] || cap}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & Test Button */}
                  <div className="flex flex-col items-end gap-3 shrink-0">
                    <button
                      onClick={() => testConnection(device.device_id)}
                      disabled={testState.testing}
                      className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      {testState.testing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                          <span>Test läuft...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          <span>Verbindung testen</span>
                        </>
                      )}
                    </button>

                    {testState.result && (
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-md ${
                        testState.result.ok
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                          : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                      }`}>
                        {testState.result.message} {testState.result.latency_ms ? `(${testState.result.latency_ms} ms)` : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline IP Quick-Edit Bar */}
                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700/60 flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0">IP / Hostname:</span>
                  <input
                    type="text"
                    placeholder={device.device_type === 'inverter' ? "z. B. wechselrichter.local" : "z. B. zaehler.local"}
                    value={editingIp[device.device_id] !== undefined ? editingIp[device.device_id] : (device.address_display || '')}
                    onChange={(e) => setEditingIp(prev => ({ ...prev, [device.device_id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = editingIp[device.device_id] !== undefined ? editingIp[device.device_id] : device.address_display;
                        if (device.device_id === 'fronius_primary') {
                          saveFroniusAddress(val);
                          testConnection('fronius_primary');
                        } else {
                          updateSettings({ mt175_address: val });
                          testConnection('mt175_primary');
                        }
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#E5E5E3] dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-1 max-w-xs"
                  />
                  <button
                    onClick={() => {
                      const val = editingIp[device.device_id] !== undefined ? editingIp[device.device_id] : device.address_display;
                      if (device.device_id === 'fronius_primary') {
                        saveFroniusAddress(val);
                        testConnection('fronius_primary');
                      } else {
                        updateSettings({ mt175_address: val });
                        testConnection('mt175_primary');
                      }
                    }}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm shrink-0"
                  >
                    IP Speichern & Testen
                  </button>
                </div>

                {/* PIN Lock Notice Box (Directive 8) */}
                {device.pin_status === 'locked' && device.pin_instructions && (
                  <div className="mt-6 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3 text-amber-800 dark:text-amber-300">
                    <Key className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm leading-relaxed">
                      <p className="font-semibold mb-1">PIN-Freigabe erforderlich</p>
                      <p>{device.pin_instructions}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Technical Details Toggle */}
              <div
                onClick={() => toggleExpand(device.device_id)}
                className="px-8 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-[#E5E5E3] dark:border-slate-700 flex items-center justify-between cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
              >
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {isExpanded ? "Technische Details ausblenden" : "Technische Details anzeigen"}
                </span>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
              </div>

              {/* Collapsed Technical Details View (Directive 10) */}
              {isExpanded && (
                <div className="p-8 pt-4 bg-slate-50/70 dark:bg-slate-800/30 border-t border-[#E5E5E3] dark:border-slate-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 text-sm">
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Adresse / IP</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">{device.address_display || "Nicht zugewiesen"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Protokoll</span>
                      <span className="text-slate-800 dark:text-slate-200">{device.protocol}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Firmware</span>
                      <span className="text-slate-800 dark:text-slate-200">{device.firmware ?? "Nicht gemeldet"}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Geräte-ID</span>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{device.device_id}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Letzter erfolgreicher Test</span>
                      <span className="text-slate-800 dark:text-slate-200">{formatRelativeTime(device.last_successful_test_at)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200 dark:border-slate-700/60 pb-2">
                      <span className="text-slate-500">Technischer Fehler</span>
                      <span className="text-xs font-mono text-red-600 dark:text-red-400">{device.technical_error ?? "Keiner"}</span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </section>
    </div>
  );
}
