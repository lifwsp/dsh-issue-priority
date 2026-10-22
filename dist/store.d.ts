import type { IssueRecord, LocalDependency, Override, Plan, UsageTotals } from './types.js';
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
}
export declare function defaultDataDir(): string;
export declare function stateFilePath(dataDir: string, repo: string): string;
export declare function emptyState(repo: string, now?: Date): RepoState;
export interface StateStore {
    load(repo: string): Promise<RepoState>;
    save(state: RepoState): Promise<void>;
    /** Repositories with stored state (so the timer resumes after a restart). */
    listRepos(): Promise<string[]>;
}
export declare function createFileStore(dataDir: string, maxJudgments?: number): StateStore;
/** In-memory store for tests. */
export declare function createMemoryStore(): StateStore & {
    states: Map<string, RepoState>;
};
//# sourceMappingURL=store.d.ts.map