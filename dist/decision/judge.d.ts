import type { DirectionJudgment, IssueRecord, MergeJudgment, PriorityJudgment, SizeJudgment, UsageTotals } from '../types.js';
import type { DecisionClient } from './client.js';
/** Bump when question wording changes so cached answers are re-asked. */
export declare const QUESTION_VERSION = "q1";
export interface JudgmentStore {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}
export interface Judge {
    readonly available: boolean;
    readonly provider: string;
    /** Model id actually answering (as reported by the API), or the configured one. */
    readonly model?: string;
    size(issue: IssueRecord, signal?: AbortSignal): Promise<SizeJudgment | null>;
    priority(issue: IssueRecord, signal?: AbortSignal): Promise<PriorityJudgment | null>;
    merge(a: IssueRecord, b: IssueRecord, signal?: AbortSignal): Promise<MergeJudgment | null>;
    direction(a: IssueRecord, b: IssueRecord, signal?: AbortSignal): Promise<DirectionJudgment | null>;
    /** Questions actually sent (cache misses) since construction. */
    readonly usage: UsageTotals;
    /** Last error message, if any call failed (calls fail soft → null). */
    readonly lastError?: string;
}
export declare function createJudge(client: DecisionClient | null, store: JudgmentStore, providerLabel?: string): Judge;
//# sourceMappingURL=judge.d.ts.map