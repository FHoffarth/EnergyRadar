import React from 'react';

export function CurrentEnergyBriefing({ title, verdict, timestamp }: {
  title: string;
  verdict?: string | null;
  timestamp?: string | null;
}) {
  return (
    <header className="max-w-3xl" data-testid="current-energy-briefing">
      <p className="cockpit-eyebrow">Aktuelle Energielage</p>
      <h1 className="cockpit-title mt-2 text-slate-900 dark:text-white">{title}</h1>
      {verdict && <p className="mt-2 max-w-2xl text-base text-slate-700 dark:text-slate-300">{verdict}</p>}
      {timestamp && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{timestamp}</p>}
    </header>
  );
}
