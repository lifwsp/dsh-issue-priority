import type { DecisionClient } from './decision/client.js';
import type { FetchedIssue, FetchedPull, GitHubIssueSource } from './github/adapter.js';
import type { Logger } from './log.js';
import { type ProgressResult } from './progress.js';
import type { RepoState, StateStore } from './store.js';
import type { IssueRecord, LocalScan, Plan, StoredPull } from './types.js';
export interface SyncSettings {
    maxIssues: number;
    maxQuestionsPerSync: number;
    mergeThreshold: number;
    actionableThreshold: number;
    directionThreshold: number;
    similarityThreshold?: number;
    maxPackageSize: number;
}
export interface SyncDeps {
    github: () => GitHubIssueSource | Promise<GitHubIssueSource>;
    decision: () => DecisionClient | null | Promise<DecisionClient | null>;
    store: StateStore;
    logger: Logger;
    settings: () => SyncSettings;
    now?: () => Date;
    /** Local clone scanner (tests inject a fake). Default: read-only git commands. */
    scanLocal?: (cwd: string, repo: string, now: Date) => Promise<LocalScan | null>;
    /** Current branch of a clone (tests inject a fake). */
    branchOf?: (cwd: string) => Promise<string | null>;
}
export interface SyncOptions {
    full?: boolean;
    signal?: AbortSignal;
    /** Directory of a local clone to scan for branches (else the last scanned one). */
    cwd?: string;
}
export interface SyncResult {
    state: RepoState;
    plan: Plan;
    fetched: number;
    changed: number[];
    closed: number[];
    /** True when nothing changed on GitHub and no replan was required. */
    unchanged: boolean;
}
/** Keep only PRs that point at issues; closed-unmerged PRs are dropped. */
export declare function toStoredPulls(raw: readonly FetchedPull[], repo: string, knownBranches?: ReadonlySet<string>): StoredPull[];
/** Collapse fenced code / long log lines so a comment carries its words, not its paste. */
export declare function condenseComment(text: string): string;
export declare function toIssueRecord(raw: FetchedIssue): IssueRecord;
/** `owner/repo` from the git remote of a directory (origin first, then any GitHub remote). */
export declare function detectRepo(cwd: string): Promise<string | null>;
/** Current git branch of a directory, or null. */
export declare function currentBranch(cwd: string): Promise<string | null>;
export declare class SyncService {
    private readonly deps;
    private readonly running;
    private readonly now;
    constructor(deps: SyncDeps);
    /** Coalesce concurrent syncs of the same repo (timer + command). */
    sync(repo: string, options?: SyncOptions): Promise<SyncResult>;
    /** Re-scan the local clone (read-only git). Keeps the old scan when the scan fails. */
    refreshLocal(state: RepoState, cwd?: string): Promise<void>;
    progress(state: RepoState): ProgressResult;
    /** Rebuild the plan from the local snapshot without touching GitHub. */
    replan(state: RepoState, signal?: AbortSignal, closedSinceLast?: number[], progress?: ProgressResult): Promise<Plan>;
    private run;
    /** PRs are a best-effort signal: a failure keeps the previous list. */
    private refreshPulls;
}
//# sourceMappingURL=sync.d.ts.map