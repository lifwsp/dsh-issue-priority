/** Shared ordered rubrics so every Issue is scored on the same scale. */

/** Impact / Urgency / Unblock: position 0..4 → normalize by /4 */
export const POSITIVE_LEVELS = {
  none: 'No meaningful effect on the stated objective.',
  low: 'Minor contribution; nice-to-have relative to the objective.',
  medium: 'Clear contribution; advances the objective but is not critical-path.',
  high: 'Major contribution; substantially advances the objective.',
  critical: 'Essential for the objective; without it the objective is blocked or hollow.',
} as const

/** Effort: higher = more costly (subtracted in ranking). */
export const EFFORT_LEVELS = {
  trivial: 'Less than about half a day for a familiar contributor.',
  small: 'About one day of focused work.',
  medium: 'Several days; may need design discussion.',
  large: 'A week or more; significant implementation surface.',
  huge: 'Multi-week or multi-person effort; high coordination cost.',
} as const

export const SCORE_MAX = 4

export function normalizeScore(raw: number, max = SCORE_MAX): number {
  if (!Number.isFinite(raw)) return 0
  return Math.min(1, Math.max(0, raw / max))
}
