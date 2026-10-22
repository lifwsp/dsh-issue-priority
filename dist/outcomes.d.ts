/**
 * Plan outcome log: what happened to the recommendations, so planning quality
 * can be measured later. Local only (never written to GitHub), capped.
 *
 * - start: work began on a set of issues. Compared with the plan at that time:
 *   `adopted` = exactly the recommended package, `other-package` = another
 *   planned package as-is (manual reorder), `regrouped` = a set that matches no
 *   planned package (manual merge / split of packages).
 * - finish: `partial` when some issues of the started set are still in progress
 *   (the package was split during implementation).
 * - override / dependency: manual corrections (pin / defer, a dependency the
 *   planner did not know about).
 */
import type { Plan } from './types.js';
export type PlanOutcome = {
    kind: 'start';
    at: string;
    issues: number[];
    recommended: string | null;
    match: 'adopted' | 'other-package' | 'regrouped';
    plannerVersion?: number;
} | {
    kind: 'finish';
    at: string;
    issues: number[];
    partial: boolean;
} | {
    kind: 'override';
    at: string;
    issue: number;
    action: 'defer' | 'pin' | 'clear';
} | {
    kind: 'dependency';
    at: string;
    issue: number;
    dependsOn: number;
};
export declare const MAX_OUTCOMES = 200;
export declare function pushOutcome(list: PlanOutcome[] | undefined, outcome: PlanOutcome): PlanOutcome[];
/** Classify a start against the plan that was current when work began. */
export declare function classifyStart(plan: Plan | null, issues: readonly number[]): {
    recommended: string | null;
    match: 'adopted' | 'other-package' | 'regrouped';
};
export interface OutcomeStats {
    starts: number;
    adopted: number;
    otherPackage: number;
    regrouped: number;
    finishes: number;
    partialFinishes: number;
    overrides: number;
    dependenciesAdded: number;
}
export declare function summarizeOutcomes(list: readonly PlanOutcome[] | undefined): OutcomeStats;
/** One-line Japanese summary, or null when nothing has been recorded. */
export declare function describeOutcomes(stats: OutcomeStats): string | null;
//# sourceMappingURL=outcomes.d.ts.map