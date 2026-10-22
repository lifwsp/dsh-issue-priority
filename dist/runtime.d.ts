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
    /** Local gh version for issue_draft's commands (tests inject; default runs `gh --version`). */
    ghVersion?: () => Promise<[number, number] | null>;
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
    branchAt(cwd: string): Promise<string | null>;
    cwdFor(agent: unknown): string | undefined;
    /**
     * Sync if never synced or older than maxAgeMs, else return the stored plan.
     * `cwd` (the caller's clone) is re-scanned for branches either way, so a
     * fresh commit or push shows up without waiting for the next GitHub sync.
     */
    ensurePlan(repo: string, options?: {
        maxAgeMs?: number;
        force?: boolean;
        signal?: AbortSignal;
        cwd?: string;
    }): Promise<{
        state: RepoState;
        plan: Plan;
        synced: SyncResult | null;
    }>;
    /** Apply a mutation to local state and rebuild the plan (no GitHub fetch). */
    mutate(repo: string, fn: (state: RepoState) => void, signal?: AbortSignal, cwd?: string): Promise<{
        state: RepoState;
        plan: Plan;
    }>;
    setOverride(state: RepoState, issue: number, action: 'defer' | 'pin' | 'clear'): void;
    addDependency(state: RepoState, issue: number, dependsOn: number, note?: string): void;
    removeDependency(state: RepoState, issue: number, dependsOn: number): void;
    setInProgress(state: RepoState, issues: number[] | null, branch?: string | null): void;
    /** Record the current branch once work moved off the default branch after `start`. */
    noteBranch(state: RepoState, branch: string | null): void;
    /**
     * Work is done but the issues are not closed yet (no push / PR / merge):
     * they leave the recommendations until GitHub reports them closed.
     * Without `issues`, everything in progress is finished.
     */
    finish(state: RepoState, issues?: number[], branch?: string | null): number[];
    /**
     * "Not done yet": put an awaiting-close issue back into the plan. A finish
     * mark is removed; detected evidence (branch / PR) is remembered so only
     * new evidence takes the issue off again.
     */
    reopen(state: RepoState, issue: number): void;
}
//# sourceMappingURL=runtime.d.ts.map