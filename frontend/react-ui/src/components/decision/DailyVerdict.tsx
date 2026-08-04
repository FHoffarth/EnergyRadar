import React from 'react';
import { DailyAssessment } from '../../types';
import { verdictTone } from '../../lib/decisionView';

/** The day's verdict — one human sentence, no stars, no praise. Hero of Heute. */
export function DailyVerdict({ assessment }: { assessment: DailyAssessment | null | undefined }) {
  if (!assessment) return null;
  const tone = verdictTone(assessment.assessment_class);
  return (
    <div data-testid="daily-verdict" data-class={assessment.assessment_class ?? 'none'} data-trust={assessment.trust}>
      <p className="cockpit-eyebrow">Tagesbewertung</p>
      <h1 className={`mt-1 text-2xl font-semibold sm:text-3xl ${tone}`}>{assessment.headline}</h1>
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
        {assessment.sentence}
      </p>
      {assessment.trust === 'partial' && (
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Vorläufig · Tag noch nicht vollständig erfasst
        </span>
      )}
    </div>
  );
}
