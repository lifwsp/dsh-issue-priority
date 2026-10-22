/** One issue comment, oldest first. */
export interface IssueComment {
    author: string;
    createdAt: string;
    body: string;
    /** Posted by a bot account (CI, Dependabot, …). */
    bot: boolean;
}
/** Normalized raw Issue as fetched from GitHub (before plan-block parsing). */
export interface FetchedIssue {
    number: number;
    title: string;
    body: string;
    author?: string;
    createdAt?: string;
    htmlUrl: string;
    state: 'open' | 'closed';
    labels: string[];
    updatedAt: string;
    closedAt: string | null;
    /** GitHub native "blocked by" (same repo only). */
    nativeBlockedBy: number[];
    /** Comments, oldest first (only fetched when the issue has comments). */
    comments: IssueComment[];
}
export interface ListIssuesSinceOptions {
    repo: string;
    /** ISO timestamp; omit for a full initial fetch of open issues. */
    since?: string;
    /** Upper bound on issues returned (safety cap). */
    maxIssues: number;
    signal?: AbortSignal;
}
/** Pull request as listed by GitHub (open, or closed recently). */
export interface FetchedPull {
    number: number;
    title: string;
    body: string;
    htmlUrl: string;
    state: 'open' | 'closed';
    draft: boolean;
    mergedAt: string | null;
    head: string;
    base: string;
    updatedAt: string;
}
export interface ListPullsOptions {
    repo: string;
    /** Also return PRs closed after this ISO timestamp (merged ones matter). */
    closedSince: string;
    maxPulls: number;
    signal?: AbortSignal;
}
/** Read-only GitHub access seam (REST implementation; tests use fakes). */
export interface GitHubIssueSource {
    readonly id: string;
    listIssuesSince(options: ListIssuesSinceOptions): Promise<FetchedIssue[]>;
    /** Optional: sources without it simply detect nothing from PRs. */
    listPulls?(options: ListPullsOptions): Promise<FetchedPull[]>;
}
export declare class GitHubAdapterError extends Error {
    readonly code: 'auth' | 'rate_limit' | 'not_found' | 'network' | 'invalid' | 'upstream';
    readonly status?: number;
    constructor(message: string, code: GitHubAdapterError['code'], status?: number);
}
//# sourceMappingURL=adapter.d.ts.map