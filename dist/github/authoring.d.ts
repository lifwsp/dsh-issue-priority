import type { IssueRecord, PriorityLevel } from '../types.js';
/** gh 2.94 added --blocked-by / --blocking / --parent to issue create/edit. */
export declare const GH_RELATIONS_MIN: readonly [2, 94];
export declare function parseGhVersion(text: string): [number, number] | null;
export declare function supportsRelations(version: [number, number] | null): boolean;
/** Local gh version (cached for the process); null when gh is missing. */
export declare function detectGhVersion(): Promise<[number, number] | null>;
/** What the repository already uses, learned from synced issues (no request). */
export interface RepoFeatures {
    priorityField: boolean;
    effortField: boolean;
    /** Existing priority labels by level, e.g. { high: 'priority:high' }. */
    priorityLabels: Partial<Record<PriorityLevel, string>>;
    milestones: string[];
}
export declare function repoFeatures(issues: Iterable<IssueRecord>): RepoFeatures;
export interface AuthoringInput {
    repo: string | null;
    title: string;
    /** Existing issue to edit; omit to create. */
    issue?: number;
    dependsOn: number[];
    parent?: number;
    milestone?: string;
    priority?: PriorityLevel;
    /** What GitHub already has for the edited issue (skipped so edits do not fail on duplicates). */
    existing?: {
        blockedBy: number[];
        parent?: number;
        milestone?: string;
        labels: string[];
    };
    /** Local gh can set dependencies / parent directly. */
    ghRelations: boolean;
    features: RepoFeatures;
}
export interface AuthoringPlan {
    /** Shell commands, in order. `body.md` holds the returned body. */
    commands: string[];
    /** Dependencies that must stay in the dsh-plan block (gh cannot set them). */
    blockDependsOn: number[];
    notes: string[];
}
/** POSIX single-quote unless the word is plainly safe. */
export declare function shellQuote(value: string): string;
export declare function planAuthoring(input: AuthoringInput): AuthoringPlan;
//# sourceMappingURL=authoring.d.ts.map