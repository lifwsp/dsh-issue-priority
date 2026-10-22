import { type FetchedIssue, type FetchedPull, type GitHubIssueSource, type ListIssuesSinceOptions, type ListPullsOptions } from './adapter.js';
export interface RestGitHubAdapterOptions {
    token?: string;
    baseUrl?: string;
    maxRetries?: number;
    maxCommentPages?: number;
    /** Hard cap on concurrent detail fetches (comments / timeline). */
    concurrency?: number;
}
export declare function resolveRepo(input: string): string;
export declare class RestGitHubAdapter implements GitHubIssueSource {
    readonly id = "github-rest";
    private readonly token?;
    private readonly baseUrl;
    private readonly maxRetries;
    private readonly maxCommentPages;
    private readonly concurrency;
    /** Tracks whether any mutating HTTP method was attempted (read-only guarantee). */
    private readonly methodsUsed;
    constructor(options?: RestGitHubAdapterOptions);
    getUsedMethods(): readonly string[];
    /**
     * Initial sync (no `since`): all open issues. Incremental sync: every issue
     * (open or closed) updated since the timestamp, so closures are observed.
     * Pull requests are skipped. Comments and native dependencies are fetched
     * only when the list payload says they exist.
     */
    listIssuesSince(options: ListIssuesSinceOptions): Promise<FetchedIssue[]>;
    /**
     * Open PRs plus PRs closed since `closedSince` (newest first). Merged PRs
     * that still left an issue open are how "merged into a non-default branch"
     * or "forgot Closes #N" show up.
     */
    listPulls(options: ListPullsOptions): Promise<FetchedPull[]>;
    private fetchCommentBodies;
    /** GitHub issue dependencies (REST, 2025+). Missing feature/permission → []. */
    private fetchBlockedBy;
    private request;
}
/** Parse `owner/repo` from a git remote URL (https or ssh). Returns null for non-GitHub remotes. */
export declare function repoFromRemoteUrl(remote: string): string | null;
//# sourceMappingURL=rest-adapter.d.ts.map