/**
 * Deterministic planner: open issues → ordered work packages (design §5).
 * The decision model is consulted only through the Judge (size, merge,
 * direction); everything else is plain code so the result is reproducible.
 */
import type { Judge } from '../decision/judge.js';
import { type IssueRecord, type LocalDependency, type Override, type Plan } from '../types.js';
/** Bump when planning logic changes so stored plans are rebuilt. */
export declare const PLANNER_VERSION = 2;
export interface PlannerOptions {
    repo: string;
    issues: readonly IssueRecord[];
    overrides: readonly Override[];
    localDependencies: readonly LocalDependency[];
    /** Issues the user is currently working on (forced into one package). */
    inProgress: readonly number[];
    /** Known area vocabulary (for unknown-area warnings). */
    areas: readonly string[];
    judge: Judge;
    previous?: Plan | null;
    /** Issues observed closed since the previous plan. */
    closedSinceLast?: readonly number[];
    mergeThreshold?: number;
    actionableThreshold?: number;
    directionThreshold?: number;
    /** Minimum text similarity for two block-less issues to become a merge candidate. */
    similarityThreshold?: number;
    maxPackageSize?: number;
    /** Hard cap on decision-model questions per run (cache misses only). */
    maxQuestions?: number;
    now?: () => Date;
    signal?: AbortSignal;
}
export declare function buildPlan(options: PlannerOptions): Promise<Plan>;
//# sourceMappingURL=planner.d.ts.map