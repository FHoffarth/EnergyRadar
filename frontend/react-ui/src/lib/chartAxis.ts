/**
 * Axis label helpers.
 *
 * Presentation only — these never change which points are plotted, only
 * which tick captions are drawn.
 */

/**
 * Build a tick formatter that shows each distinct caption at most once.
 *
 * Samples arrive seconds apart, so a minute-resolution time axis otherwise
 * repeats the same caption several times. Only the first occurrence of a
 * caption is drawn; later ones render as an empty label, so the tick
 * position is untouched and only the duplicate text disappears.
 */
export function dedupeTickFormatter<T>(
  data: readonly T[],
  key: keyof T,
): (value: unknown, index: number) => string {
  const visible = new Set<number>();
  const seen = new Set<string>();

  data.forEach((point, index) => {
    const label = point[key] == null ? '' : String(point[key]);
    if (label && !seen.has(label)) {
      visible.add(index);
      seen.add(label);
    }
  });

  return (value: unknown, index: number) => (visible.has(index) ? String(value ?? '') : '');
}
