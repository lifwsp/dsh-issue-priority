import type { Logger } from './log.js';
import type { RepoState, StateStore } from './store.js';
import { type SyncResult, type SyncService } from './sync.js';
import type { Plan } from './types.js';
export interface RuntimeDeps {
    store: StateStore;
    sync: SyncService;
    logger: Logger;
    /** Working directory of the calling session, when known. */
    cwdOf: (agent: unknown) => string | undefined;
    /** Why the decision model is unavailable (for user-facing notes), if it is. */
    decisionStatus: () => Promise<string | undefined>;
    now?: () => Date;
}
export declare class IssuePlanRuntime {
    readonly deps: RuntimeDeps;
    /** Repos seen by this process; the timer syncs these. */
    readonly knownRepos: Set<string>;
    private readonly now;
    constructor(deps: RuntimeDeps);
    resolveRepoFor(agent: unknown, explicit?: string): Promise<string>;
    /** Resolve the GitHub repo of a directory (e.g. the cwd the sidebar reports). */
    resolveRepoAt(cwd: string): Promise<string>;
    branchFor(agent: unknown): Promise<string | null>;
    /** Sync if never synced or older than maxAgeMs, else return the stored plan. */
    ensurePlan(repo: string, options?: {
        maxAgeMs?: number;
        force?: boolean;
        signal?: AbortSignal;
    }): Promise<{
        state: RepoState;
        plan: Plan;
        synced: SyncResult | null;
    }>;
    /** Apply a mutation to local state and rebuild the plan (no GitHub fetch). */
    mutate(repo: string, fn: (state: RepoState) => void, signal?: AbortSignal): Promise<{
        state: RepoState;
        plan: Plan;
    }>;
    setOverride(state: RepoState, issue: number, action: 'defer' | 'pin' | 'clear'): void;
    addDependency(state: RepoState, issue: number, dependsOn: number, note?: string): void;
    removeDependency(state: RepoState, issue: number, dependsOn: number): void;
    setInProgress(state: RepoState, issues: number[] | null, branch?: string | null): void;
}
//# sourceMappingURL=runtime.d.ts.map