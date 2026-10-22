/**
 * Minimal System One (decision model) client for LiquidAI d1.
 *
 * d1 is not a chat model: it returns probabilities for noul / choice / score
 * questions and is billed on input tokens only. Every question is billed as its
 * own prompt (state included), so callers keep states short and ask only what
 * the planner needs.
 *
 * Endpoints:
 * - liquid:     POST https://api.liquid.ai/decisions/v1/systemone   (model "d1")
 * - openrouter: POST https://openrouter.ai/api/v1/systemone          (model "liquid/d1")
 * - typesafe:   POST https://api.typesafe.ai/v1/systemone            (model "jev-1.14.0")
 * - custom:     any System One–compatible URL + model
 */
export type DecisionProviderId = 'liquid' | 'openrouter' | 'typesafe' | 'custom';
export type Entry = string | Record<string, unknown> | unknown[] | null;
export type DecisionQuestion = {
    type: 'noul';
    instructions: Entry;
    criteria?: {
        true?: Entry;
        false?: Entry;
    };
} | {
    type: 'choice';
    instructions: Entry;
    criteria: Record<string, Entry>;
} | {
    type: 'score';
    instructions: Entry;
    criteria: Entry[];
};
export type DecisionAnswer = {
    type: 'noul';
    noul: number;
} | {
    type: 'choice';
    choice: string;
    confidence?: number;
    probabilities: Record<string, number>;
} | {
    type: 'score';
    score: number;
    confidence?: number;
    probabilities: Record<string, number>;
};
export interface DecisionResponse {
    model: string;
    answers: Record<string, DecisionAnswer>;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}
export interface DecisionRequest {
    state: Entry;
    questions: Record<string, DecisionQuestion>;
    signal?: AbortSignal;
}
/** Seam for tests and future providers. */
export interface DecisionClient {
    readonly provider: string;
    /** Model id; part of the judgment cache key so switching models re-judges. */
    readonly model?: string;
    ask(request: DecisionRequest): Promise<DecisionResponse>;
}
export declare class DecisionError extends Error {
    readonly code: 'auth' | 'rate_limit' | 'network' | 'timeout' | 'invalid' | 'upstream';
    readonly status?: number;
    constructor(message: string, code: DecisionError['code'], status?: number);
}
export interface HttpDecisionClientOptions {
    provider: DecisionProviderId;
    apiKey: string;
    /** Overrides the provider default model id. */
    model?: string;
    /** Overrides the endpoint (tests / proxies). */
    url?: string;
    timeoutMs?: number;
    maxRetries?: number;
    fetchImpl?: typeof fetch;
}
export declare class HttpDecisionClient implements DecisionClient {
    readonly provider: string;
    readonly model: string;
    private readonly url;
    private readonly apiKey;
    private readonly timeoutMs;
    private readonly maxRetries;
    private readonly fetchImpl;
    constructor(options: HttpDecisionClientOptions);
    ask(request: DecisionRequest): Promise<DecisionResponse>;
}
//# sourceMappingURL=client.d.ts.map