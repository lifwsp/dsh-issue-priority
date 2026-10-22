/** Normalized raw Issue as fetched from GitHub (before plan-block parsing). */
export interface FetchedIssue {
    number: number;
    title: string;
    body: string;
    htmlUrl: string;
    state: 'open' | 'closed';
    labels: string[];
    updatedAt: string;
    closedAt: string | null;
    /** GitHub native "blocked by" (same repo only). */
    nativeBlockedBy: number[];
    /** Comment bodies (only fetched when the issue has comments). */
    comments: string[];
}
export interface ListIssuesSinceOptions {
    repo: string;
    /** ISO timestamp; omit for a full initial fetch of open issues. */
    since?: string;
    /** Upper bound on issues returned (safety cap). */
    maxIssues: number;
    signal?: AbortSignal;
}
/** Read-only GitHub access seam (REST implementation; tests use fakes). */
export interface GitHubIssueSource {
    readonly id: string;
    listIssuesSince(options: ListIssuesSinceOptions): Promise<FetchedIssue[]>;
}
export declare class GitHubAdapterError extends Error {
    readonly code: 'auth' | 'rate_limit' | 'not_found' | 'network' | 'invalid' | 'upstream';
    readonly status?: number;
    constructor(message: string, code: GitHubAdapterError['code'], status?: number);
}
//# sourceMappingURL=adapter.d.ts.map