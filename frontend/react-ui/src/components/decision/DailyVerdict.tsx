import React from 'react';
import { DailyAssessment } from '../../types';
import { verdictTone } from '../../lib/decisionView';

/**
 * The day's verdict — one concrete, data-driven headline and one short
 * explanation. No stars, no praise. The single h1 of the page. Tariff and
 * trust caveats live elsewhere (economy block / trust chip), never in the hero
 * paragraph, so the explanation stays to the point.
 */
export function DailyVerdict({ assessment, autarkiePct }: {
  assessment: DailyAssessment | null | undefined;
  autarkiePct?: number | null;
}) {
  if (!assessment) return null;
  const tone = verdictTone(assessment.assessment_class);

  const headline = assessment.assessable && autarkiePct !== null && autarkiePct !== undefined
    ? `${autarkiePct} % energieautark heute.`
    : assessment.headline;

  // Keep only the explanatory nuance: drop the autonomy restatement, the trust
  // clause (shown as a chip) and any tariff caveat (shown in the economy block).
  const explanation = assessment.sentence
    .split('. ')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/des Strombedarfs/i.test(part) && !/vorläufig/i.test(part) && !/Stromtarif/i.test(part))
    .join('. ');
  const explanationText = explanation ? (explanation.endsWith('.') ? explanation : `${explanation}.`) : null;

  return (
    <div data-testid="daily-verdict" data-class={assessment.assessment_class ?? 'none'} data-trust={assessment.trust}>
      <h1 className={`text-2xl font-semibold sm:text-3xl ${tone}`}>{headline}</h1>
      {explanationText && (
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{explanationText}</p>
      )}
      {assessment.trust === 'partial' && (
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Vorläufig · Messdaten noch nicht vollständig
        </span>
      )}
    </div>
  );
}
