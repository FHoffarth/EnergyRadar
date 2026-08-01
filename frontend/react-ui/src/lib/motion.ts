import { useEffect, useState } from 'react';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
}

export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(
    () => reducedMotionQuery()?.matches ?? false,
  );
  useEffect(() => {
    const query = reducedMotionQuery();
    const update = () => setPrefersReduced(query?.matches ?? false);
    update();
    if (!query) return;
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return prefersReduced;
}
