import React, { useState, useEffect, useCallback } from 'react';
import { X, Check, ArrowLeft, Loader2, Cpu, Globe, ShieldCheck, Zap } from 'lucide-react';
import { ConnectionTestResult } from '../types';

type SetupTarget = 'fronius' | 'meter';
type SetupStep = 'select_target' | 'enter_details' | 'test_result';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTestConnection: (deviceId: string) => Promise<ConnectionTestResult>;
  isBridgeConnected: boolean;
}

export function SetupWizardModal({ isOpen, onClose, onTestConnection, isBridgeConnected }: SetupWizardModalProps) {
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, handleEscape]);

  const [step, setStep] = useState<SetupStep>('select_target');
  const [targetType, setTargetType] = useState<SetupTarget>('fronius');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(80);
  const [displayName, setDisplayName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  if (!isOpen) return null;

  const handleSelectTarget = (type: SetupTarget) => {
    setTargetType(type);
    setDisplayName(type === 'fronius' ? 'Fronius Wechselrichter' : 'Stromzähler');
    setStep('enter_details');
  };

  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    if (!isBridgeConnected) {
      setTestResult({
        ok: false,
        message: 'Desktop-Verbindung ist nicht verfügbar. Der Verbindungstest kann nur über die Desktop-Bridge durchgeführt werden.',
        latencyMs: null
      });
      setIsTesting(false);
      setStep('test_result');
      return;
    }

    const deviceId = targetType === 'fronius' ? 'fronius_primary' : 'mt175_primary';
    const result = await onTestConnection(deviceId);
    setTestResult(result);
    setIsTesting(false);
    setStep('test_result');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm duration-150 font-sans" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-sky-500/30 rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        <div className="p-4 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">Datenquellen-Einrichtung</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Geführte Konfiguration</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors" aria-label="Schließen">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-100/70 dark:bg-slate-800/40 px-5 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-slate-400">
          <span className={step === 'select_target' ? 'text-sky-700 dark:text-sky-400 font-semibold' : ''}>1. Quelle wählen</span>
          <span>&rarr;</span>
          <span className={step === 'enter_details' ? 'text-sky-700 dark:text-sky-400 font-semibold' : ''}>2. Verbindungsdaten</span>
          <span>&rarr;</span>
          <span className={step === 'test_result' ? 'text-sky-700 dark:text-sky-400 font-semibold' : ''}>3. Prüfen & Ergebnis</span>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[420px]">
          {step === 'select_target' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                Wählen Sie die Art der Datenquelle, die Sie im lokalen Netzwerk anbinden möchten.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => handleSelectTarget('fronius')}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 hover:border-sky-400 dark:hover:border-sky-500/50 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 text-left transition-all space-y-2 group"
                >
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 w-fit">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-sky-700 dark:group-hover:text-sky-300">Fronius PV-System</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Wechselrichter (Symo, Primo, GEN24) über Fronius Solar API v1.
                  </p>
                </button>
                <button
                  onClick={() => handleSelectTarget('meter')}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 hover:border-sky-400 dark:hover:border-sky-500/50 hover:bg-sky-50/50 dark:hover:bg-sky-950/30 text-left transition-all space-y-2 group"
                >
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit">
                    <Globe className="w-5 h-5" />
                  </div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 group-hover:text-sky-700 dark:group-hover:text-sky-300">Stromzähler / Smart Meter</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Zähler für Netzbezug und Einspeisung.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === 'enter_details' && (
            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-medium text-slate-700 dark:text-slate-300 block">Bezeichnung</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300 block">Lokale IP-Adresse / Hostname</label>
                  <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
                    placeholder="fronius.local"
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300 block">Port</label>
                  <input type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 80)}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium text-slate-800 dark:text-slate-200">Lokales Netz erkannt</span>
                </div>
              </div>
              {!isBridgeConnected && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
                  Desktop-Verbindung ist nicht aktiv. Der Verbindungstest kann in dieser Sitzung nicht durchgeführt werden.
                </div>
              )}
            </div>
          )}

          {step === 'test_result' && testResult && (
            <div className="space-y-4 text-xs">
              <div className={`p-3.5 rounded-xl border space-y-1 ${
                testResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-500/30 dark:text-emerald-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-500/30 dark:text-amber-200'
              }`}>
                <div className="flex items-center gap-2 font-semibold">
                  {testResult.ok ? <Check className="w-4 h-4 text-emerald-600" /> : <X className="w-4 h-4 text-amber-600" />}
                  <span>{testResult.ok ? 'Verbindung erfolgreich' : 'Verbindung nicht hergestellt'}</span>
                </div>
                <p className="text-[11px] opacity-90 leading-relaxed">{testResult.message}</p>
                {testResult.latencyMs !== null && (
                  <p className="text-[11px] opacity-80">Latenz: {testResult.latencyMs} ms</p>
                )}
              </div>
              {!isBridgeConnected && (
                <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300">
                  <strong>Hinweis:</strong> Der Verbindungstest wird in einem zukünftigen Sprint über die Desktop-Bridge realisiert. Aktuell wird die Desktop-Verbindung vorausgesetzt.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-medium">
          {step !== 'select_target' ? (
            <button onClick={() => setStep(step === 'test_result' ? 'enter_details' : 'select_target')}
              className="flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span>Zurück</span>
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {step === 'enter_details' && (
              <button onClick={handleRunTest} disabled={isTesting || !host.trim()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40 transition-all flex items-center gap-1.5 shadow-xs">
                {isTesting && <Loader2 className="w-3.5 h-3.5" />}
                <span>Verbindung prüfen</span>
              </button>
            )}
            {step === 'test_result' && (
              <button onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold transition-all hover:bg-slate-300 dark:hover:bg-slate-600">
                Schließen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
