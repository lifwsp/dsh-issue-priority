/** Cheap, deterministic signals used by the planner (no network). */
import type { IssueRecord, PriorityLevel } from '../types.js';
/**
 * Priority from labels such as `priority:high`, `prio/low`, `P1`, `critical`.
 * Returns the highest level found, or null when no label says anything.
 */
export declare function labelPriority(labels: readonly string[]): PriorityLevel | null;
/** Character-bigram Jaccard similarity of title + start of body (works for Japanese). */
export declare function textSimilarity(a: IssueRecord, b: IssueRecord): number;
//# sourceMappingURL=signals.d.ts.map