import React from 'react';

/**
 * The day assessment — the hero of Heute. It leads the page and answers
 * "how is today developing?". The statements are evidence-gated upstream
 * (see lib/storytelling.dailyStatements): coverage first when the day is only
 * partly captured, peaks only when the data supports them. Nothing here is
 * unsupported praise; the lead is simply the most important true thing.
 */
export function DailyInterpretation({ statements }: { statements: string[] }) {
  if (!statements.length) return null;
  const [lead, ...rest] = statements;
  return (
    <section aria-labelledby="today-assessment" className="max-w-3xl">
      <p className="cockpit-eyebrow">Heute</p>
      <h1 id="today-assessment" className="cockpit-title mt-2 text-slate-900 dark:text-white">{lead}</h1>
      {rest.length > 0 && (
        <ul className="mt-3 space-y-1 text-base text-slate-600 dark:text-slate-300">
          {rest.map(statement => <li key={statement}>{statement}</li>)}
        </ul>
      )}
    </section>
  );
}
