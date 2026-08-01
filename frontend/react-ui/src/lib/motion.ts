import { useEffect, useState } from 'react';

export type MotionMode = 'full' | 'reduced' | 'none';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

export function resolveEffectiveMotionMode(
  requested: MotionMode = 'full',
  prefersReduced = false,
): MotionMode {
  if (requested === 'none') return 'none';
  if (prefersReduced) return 'reduced';
  return requested;
}

export function useEffectiveMotionMode(requested: MotionMode = 'full'): MotionMode {
  const [effective, setEffective] = useState(() => resolveEffectiveMotionMode(
    requested,
    reducedMotionQuery()?.matches ?? false,
  ));
  useEffect(() => {
    const query = reducedMotionQuery();
    const update = () => setEffective(resolveEffectiveMotionMode(requested, query?.matches ?? false));
    update();
    if (!query) return;
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [requested]);
  return effective;
}

export function applyMotionPreference(
  requested: MotionMode = 'full',
  root: HTMLElement = document.documentElement,
  prefersReduced = reducedMotionQuery()?.matches ?? false,
): MotionMode {
  const effective = resolveEffectiveMotionMode(requested, prefersReduced);
  root.setAttribute('data-motion-setting', requested);
  root.setAttribute('data-motion', effective);
  return effective;
}
