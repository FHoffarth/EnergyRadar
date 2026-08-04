import React from 'react';

/**
 * Autarkie gauge — the primary Heute instrument. Calm semicircular arc, real
 * percentage in the centre, derived-weight styling (not a measured-hero look),
 * accessible as a meter, honest unknown state ("Nicht bewertbar", never 0 %).
 */
export function AutarkieGauge({ pct, tone, animate = true }: {
  pct: number | null;
  tone: string;
  animate?: boolean;
}) {
  const known = pct !== null && Number.isFinite(pct);
  const clamped = known ? Math.max(0, Math.min(100, pct as number)) : 0;

  return (
    <figure className="flex flex-col items-center" data-testid="autarkie-gauge" data-known={known}>
      <div className="relative w-full max-w-[18rem]">
        <svg viewBox="0 0 200 116" className="w-full"
          {...(known ? {
            role: 'meter', 'aria-label': 'Autarkiegrad',
            'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': clamped,
            'aria-valuetext': `${clamped} Prozent des Strombedarfs ohne Netzbezug gedeckt`,
          } : { role: 'img', 'aria-label': 'Autarkiegrad nicht bewertbar' })}>
          {/* warm, receding track */}
          <path d="M14 100 A86 86 0 0 1 186 100" fill="none"
            className="stroke-amber-100 dark:stroke-amber-950/40" strokeWidth={14} strokeLinecap="round" />
          {/* solar-amber active arc — the arc carries the energy */}
          {known && (
            <path data-testid="gauge-arc" d="M14 100 A86 86 0 0 1 186 100" fill="none" pathLength={100}
              className="stroke-amber-500 dark:stroke-amber-400" strokeWidth={14} strokeLinecap="round"
              strokeDasharray={`${clamped} 100`}
              style={animate ? { transition: 'stroke-dasharray 600ms ease' } : undefined} />
          )}
        </svg>
        <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
          {known ? (
            <span className={`text-5xl font-semibold tabular-nums ${tone}`}>
              {clamped}<span className="ml-0.5 align-top text-2xl font-normal text-amber-500/70">%</span>
            </span>
          ) : (
            <span className="text-2xl font-medium text-slate-500 dark:text-slate-400">Nicht bewertbar</span>
          )}
          <span className="mt-0.5 text-xs uppercase tracking-wide text-amber-700/70 dark:text-amber-400/70">Autarkie</span>
        </div>
      </div>
    </figure>
  );
}
