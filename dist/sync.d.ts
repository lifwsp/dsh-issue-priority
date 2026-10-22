import type { DecisionClient } from './decision/client.js';
import type { FetchedIssue, GitHubIssueSource } from './github/adapter.js';
import type { Logger } from './log.js';
import type { RepoState, StateStore } from './store.js';
import type { IssueRecord, Plan } from './types.js';
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
    sync(repo: string, options?: {
        full?: boolean;
        signal?: AbortSignal;
    }): Promise<SyncResult>;
    /** Rebuild the plan from the local snapshot without touching GitHub. */
    replan(state: RepoState, signal?: AbortSignal, closedSinceLast?: number[]): Promise<Plan>;
    private run;
}
//# sourceMappingURL=sync.d.ts.map