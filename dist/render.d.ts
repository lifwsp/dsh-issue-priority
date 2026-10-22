import type { RepoState } from './store.js';
import type { IssueRecord, Plan, Rationale, WorkPackage } from './types.js';
export declare const PRIORITY_LABEL: {
    readonly high: "高";
    readonly medium: "中";
    readonly low: "低";
};
export declare function describeRationale(r: Rationale): string;
/** The next package to work on: in-progress first, else the first ready one. */
export declare function nextPackage(plan: Plan): WorkPackage | null;
export declare function renderPackage(pkg: WorkPackage, issues: Record<string, IssueRecord>, index?: number): string[];
export declare function renderPlan(state: RepoState, plan: Plan, options?: {
    limit?: number;
}): string;
/** Follow-up message handed to the agent by `/issues next`. */
export declare function renderKickoff(plan: Plan, pkg: WorkPackage, issues: Record<string, IssueRecord>): string;
/** Build a frozen user message shaped like dsh-llm createUserMessage (no hard dependency). */
export declare function userMessage(text: string): unknown;
//# sourceMappingURL=render.d.ts.map