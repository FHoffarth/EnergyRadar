import React from 'react';

export function DailyInterpretation({ statements }: { statements: string[] }) {
  if (!statements.length) return null;
  return (
    <section aria-labelledby="today-interpretation-title" className="mb-6 max-w-4xl">
      <h2 id="today-interpretation-title" className="cockpit-section-title">Heute bisher</h2>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
        {statements.map(statement => <li key={statement}>{statement}</li>)}
      </ul>
    </section>
  );
}
