/**
 * Deterministic planner: open issues → ordered work packages (design §5).
 * The decision model is consulted only through the Judge (size, merge,
 * direction); everything else is plain code so the result is reproducible.
 */
import type { Judge } from '../decision/judge.js';
import { type AwaitingClose, type CloseEvidence, type IssueRecord, type LocalDependency, type Override, type Plan } from '../types.js';
/** Bump when planning logic changes so stored plans are rebuilt. */
export declare const PLANNER_VERSION = 5;
export interface PlannerOptions {
    repo: string;
    issues: readonly IssueRecord[];
    overrides: readonly Override[];
    localDependencies: readonly LocalDependency[];
    /** Issues the user is currently working on (forced into one package). */
    inProgress: readonly number[];
    /**
     * Done but still open (see progress.ts): kept out of the packages; packages
     * that depend on them wait instead of being blocked.
     */
    awaitingClose?: readonly AwaitingClose[];
    /** Git / PR activity for issues that stay in the plan (passed through to the plan). */
    activity?: Record<string, CloseEvidence[]>;
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
    /**
     * Days after which an open issue gets the full aging boost (+0.5 priority
     * score), so large or long-waiting work is not starved by a stream of quick
     * wins. 0 disables aging.
     */
    agingDays?: number;
    now?: () => Date;
    signal?: AbortSignal;
}
export declare function buildPlan(options: PlannerOptions): Promise<Plan>;
//# sourceMappingURL=planner.d.ts.map