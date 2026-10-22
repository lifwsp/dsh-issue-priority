import type { AwaitingClose, CloseEvidence, CloseStep, LocalScan, StoredPull } from './types.js';
/** A finish recorded by the user / agent. */
export interface FinishedMark {
    issue: number;
    at: string;
    branch?: string;
}
/** "Not done yet" said about detected evidence; new evidence brings the issue back. */
export interface Dismissal {
    issue: number;
    keys: string[];
    at: string;
}
export interface ProgressInput {
    open: readonly number[];
    inProgress: {
        issues: number[];
        branch?: string;
    } | null;
    finished: readonly FinishedMark[];
    dismissed: readonly Dismissal[];
    pulls: readonly StoredPull[];
    local: LocalScan | null;
}
export interface ProgressResult {
    awaitingClose: AwaitingClose[];
    activity: Record<string, CloseEvidence[]>;
}
/** Issues a PR closes via GitHub closing keywords (`Closes #12`, `fixes owner/repo#3`). */
export declare function parseClosingRefs(text: string, repo: string): number[];
/**
 * Issue numbers a branch name points at: `issues/wp-12-13` (kickoff default),
 * `issue-12`, `fix/12-title`, `gh-12`, `12-title`. Callers keep only open issues.
 */
export declare function branchIssueRefs(branch: string): number[];
export declare function mentionsIn(text: string): number[];
/** A branch name worth recording (not detached, not the usual default branches). */
export declare function usableBranch(branch: string | null | undefined): branch is string;
/** Stable keys of the detected (not marked) evidence, for dismissals. */
export declare function evidenceKeys(evidence: readonly CloseEvidence[]): string[];
export declare function detectProgress(input: ProgressInput): ProgressResult;
/** Branches whose last commit is older than this are treated as abandoned. */
export declare const STALE_BRANCH_DAYS = 30;
/**
 * Local branches with commits that are not on the remote default branch, and
 * which issues those commits / branch names point at. Read-only (no fetch).
 */
export declare function scanLocalRepo(cwd: string, repo: string, now?: Date): Promise<LocalScan | null>;
export declare const STEP_LABEL: Record<CloseStep, string>;
export declare function describeEvidence(e: CloseEvidence): string;
/** One line on what to do next. */
export declare function describeStep(a: AwaitingClose): string;
//# sourceMappingURL=progress.d.ts.map