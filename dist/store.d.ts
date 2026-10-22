import type { PlanOutcome } from './outcomes.js';
import type { Dismissal, FinishedMark } from './progress.js';
import type { IssueRecord, LocalDependency, LocalScan, Override, Plan, StoredPull, UsageTotals } from './types.js';
export declare const STORE_SCHEMA = 1;
export interface RepoState {
    schema: typeof STORE_SCHEMA;
    repo: string;
    /** Start point for the next incremental fetch (server `updated_at` watermark). */
    syncedUntil: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    issues: Record<string, IssueRecord>;
    overrides: Override[];
    localDependencies: LocalDependency[];
    inProgress: {
        issues: number[];
        branch?: string;
        startedAt: string;
    } | null;
    /** Issues marked finished (finish / done) that are still open: awaiting close. */
    finished: FinishedMark[];
    /** Detected "awaiting close" evidence the user said is not done yet. */
    dismissed: Dismissal[];
    /** PRs (open, or merged recently) that point at issues. */
    pulls: StoredPull[];
    pullsSyncedAt: string | null;
    /** Last scan of the local clone's branches (path is reused by the background timer). */
    local: LocalScan | null;
    /** Area vocabulary seen in blocks + registered by issue_draft. */
    areas: string[];
    /** Decision-model answer cache, keyed by input hash. */
    judgments: Record<string, {
        value: unknown;
        at: string;
    }>;
    plan: Plan | null;
    usage: UsageTotals & {
        since: string;
    };
    /** What happened to the recommendations (adopted / reordered / regrouped / split), capped. */
    outcomes: PlanOutcome[];
}
export declare function defaultDataDir(): string;
/** Where this plugin stored its plans while it was called dsh-issue-priority (≤ 0.5). */
export declare function legacyDataDir(): string;
/**
 * One-time carry-over after the rename: when the new directory does not exist
 * yet, copy the old one (copy, not move, so downgrading still finds its data).
 * Returns true when something was copied.
 */
export declare function migrateLegacyDataDir(target: string, legacy?: string): Promise<boolean>;
export declare function stateFilePath(dataDir: string, repo: string): string;
export declare function emptyState(repo: string, now?: Date): RepoState;
export interface StateStore {
    load(repo: string): Promise<RepoState>;
    save(state: RepoState): Promise<void>;
    /** Repositories with stored state (so the timer resumes after a restart). */
    listRepos(): Promise<string[]>;
}
export declare function createFileStore(dataDir: string, maxJudgments?: number, ready?: Promise<unknown>): StateStore;
/** In-memory store for tests. */
export declare function createMemoryStore(): StateStore & {
    states: Map<string, RepoState>;
};
//# sourceMappingURL=store.d.ts.map