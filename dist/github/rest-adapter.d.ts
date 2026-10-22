import { type FetchedIssue, type FetchedPull, type GitHubIssueSource, type ListIssuesSinceOptions, type ListPullsOptions } from './adapter.js';
import type { NativeMeta } from '../types.js';
export interface RestGitHubAdapterOptions {
    token?: string;
    baseUrl?: string;
    maxRetries?: number;
    maxCommentPages?: number;
    /** Hard cap on concurrent detail fetches (comments / timeline). */
    concurrency?: number;
}
interface GhIssueRaw {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    url: string;
    labels: Array<{
        name?: string;
        color?: string;
    } | string>;
    milestone: {
        title: string;
        state?: string;
        due_on?: string | null;
    } | null;
    assignees: Array<{
        login: string;
    }>;
    created_at: string;
    updated_at: string;
    user?: {
        login?: string;
    };
    comments: number;
    pull_request?: unknown;
    state: string;
    closed_at?: string | null;
    issue_dependencies_summary?: {
        blocked_by?: number;
        total_blocked_by?: number;
        blocking?: number;
    };
    sub_issues_summary?: {
        total?: number;
        completed?: number;
    };
    parent_issue_url?: string | null;
    issue_field_values?: GhFieldValueRaw[];
}
interface GhFieldValueRaw {
    issue_field_name?: string;
    data_type?: string;
    value?: unknown;
    single_select_option?: {
        name?: string;
    } | null;
}
/** GitHub-native planning metadata from one list item (pure; no request). */
export declare function nativeMeta(raw: Pick<GhIssueRaw, 'milestone' | 'sub_issues_summary' | 'parent_issue_url' | 'issue_field_values' | 'url'>): NativeMeta | undefined;
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
export {};
//# sourceMappingURL=rest-adapter.d.ts.map