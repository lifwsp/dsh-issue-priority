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
export class DecisionError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.name = 'DecisionError';
        this.code = code;
        this.status = status;
    }
}
const ENDPOINTS = {
    liquid: { url: 'https://api.liquid.ai/decisions/v1/systemone', model: 'd1' },
    openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: 'liquid/d1' },
    typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.14.0' },
    // Any System One–compatible endpoint; url and model must be supplied.
    custom: { url: '', model: '' },
};
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted)
            return reject(signal.reason ?? new Error('aborted'));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(signal.reason ?? new Error('aborted'));
        }, { once: true });
    });
}
function validateQuestions(questions) {
    const entries = Object.entries(questions);
    if (entries.length === 0)
        throw new DecisionError('No decision questions', 'invalid');
    for (const [id, q] of entries) {
        if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
            throw new DecisionError(`Score question "${id}" needs a criteria list of at least 2 levels`, 'invalid');
        }
        if (q.type === 'choice' && (Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2)) {
            throw new DecisionError(`Choice question "${id}" needs a criteria map of at least 2 labels`, 'invalid');
        }
    }
}
export class HttpDecisionClient {
    provider;
    model;
    url;
    apiKey;
    timeoutMs;
    maxRetries;
    fetchImpl;
    constructor(options) {
        const endpoint = ENDPOINTS[options.provider];
        this.provider = options.provider;
        this.url = options.url ?? endpoint.url;
        this.model = options.model || endpoint.model;
        if (!this.url || !this.model) {
            throw new DecisionError(`Decision provider "${options.provider}" needs both a URL and a model id`, 'invalid');
        }
        this.apiKey = options.apiKey;
        this.timeoutMs = options.timeoutMs ?? 15_000;
        this.maxRetries = options.maxRetries ?? 2;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }
    async ask(request) {
        validateQuestions(request.questions);
        const body = JSON.stringify({ model: this.model, state: request.state, questions: request.questions });
        for (let attempt = 0;; attempt += 1) {
            const timeout = AbortSignal.timeout(this.timeoutMs);
            const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
            let response;
            try {
                response = await this.fetchImpl(this.url, {
                    method: 'POST',
                    signal,
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${this.apiKey}`,
                    },
                    body,
                });
            }
            catch (error) {
                if (request.signal?.aborted)
                    throw error;
                if (timeout.aborted)
                    throw new DecisionError(`Decision request timed out after ${this.timeoutMs}ms`, 'timeout');
                throw new DecisionError(`Decision network error: ${error instanceof Error ? error.message : String(error)}`, 'network');
            }
            if (response.ok) {
                const json = (await response.json());
                if (!json || typeof json !== 'object' || !json.answers) {
                    throw new DecisionError('Unexpected decision response shape (no answers)', 'upstream', response.status);
                }
                return {
                    model: json.model ?? this.model,
                    answers: json.answers,
                    usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 },
                };
            }
            const retryable = response.status === 429 || response.status >= 500;
            if (retryable && attempt < this.maxRetries) {
                const retryAfter = Number(response.headers.get('retry-after'));
                await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt, request.signal);
                continue;
            }
            const text = (await response.text().catch(() => '')).slice(0, 200);
            if (response.status === 401 || response.status === 403) {
                throw new DecisionError(`Decision API auth error (${response.status})`, 'auth', response.status);
            }
            if (response.status === 429)
                throw new DecisionError('Decision API rate limited', 'rate_limit', 429);
            if (response.status === 400 || response.status === 422) {
                throw new DecisionError(`Decision API rejected request (${response.status}): ${text}`, 'invalid', response.status);
            }
            throw new DecisionError(`Decision API error ${response.status}: ${text}`, 'upstream', response.status);
        }
    }
}
//# sourceMappingURL=client.js.map