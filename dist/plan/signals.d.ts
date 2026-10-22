/** Cheap, deterministic signals used by the planner (no network). */
import type { IssueRecord, IssueSize, PriorityLevel } from '../types.js';
/**
 * Priority from labels such as `priority:high`, `prio/low`, `P1`, `critical`.
 * Returns the highest level found, or null when no label says anything.
 */
export declare function labelPriority(labels: readonly string[]): PriorityLevel | null;
/** Character-bigram Jaccard similarity of title + start of body (works for Japanese). */
export declare function textSimilarity(a: IssueRecord, b: IssueRecord): number;
/**
 * Priority from the GitHub "Priority" issue field (option name such as
 * `P1`, `High`, `Urgent`). Same vocabulary as `priority:` labels.
 */
export declare function fieldPriority(value: string | undefined): PriorityLevel | null;
/** Size from the GitHub "Effort" issue field: option names (S / Medium / XL) or a number (points). */
export declare function fieldEffort(value: string | number | undefined): IssueSize | null;
//# sourceMappingURL=signals.d.ts.map