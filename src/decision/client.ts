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
 */

export type DecisionProviderId = 'liquid' | 'openrouter'

export type Entry = string | Record<string, unknown> | unknown[] | null

export type DecisionQuestion =
  | { type: 'noul'; instructions: Entry; criteria?: { true?: Entry; false?: Entry } }
  | { type: 'choice'; instructions: Entry; criteria: Record<string, Entry> }
  | { type: 'score'; instructions: Entry; criteria: Entry[] }

export type DecisionAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence?: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence?: number; probabilities: Record<string, number> }

export interface DecisionResponse {
  model: string
  answers: Record<string, DecisionAnswer>
  usage: { input_tokens: number; output_tokens: number }
}

export interface DecisionRequest {
  state: Entry
  questions: Record<string, DecisionQuestion>
  signal?: AbortSignal
}

/** Seam for tests and future providers. */
export interface DecisionClient {
  readonly provider: string
  ask(request: DecisionRequest): Promise<DecisionResponse>
}

export class DecisionError extends Error {
  readonly code: 'auth' | 'rate_limit' | 'network' | 'timeout' | 'invalid' | 'upstream'
  readonly status?: number
  constructor(message: string, code: DecisionError['code'], status?: number) {
    super(message)
    this.name = 'DecisionError'
    this.code = code
    this.status = status
  }
}

const ENDPOINTS: Record<DecisionProviderId, { url: string; model: string }> = {
  liquid: { url: 'https://api.liquid.ai/decisions/v1/systemone', model: 'd1' },
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: 'liquid/d1' },
}

export interface HttpDecisionClientOptions {
  provider: DecisionProviderId
  apiKey: string
  /** Overrides the provider default model id. */
  model?: string
  /** Overrides the endpoint (tests / proxies). */
  url?: string
  timeoutMs?: number
  maxRetries?: number
  fetchImpl?: typeof fetch
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason ?? new Error('aborted'))
      },
      { once: true },
    )
  })
}

function validateQuestions(questions: Record<string, DecisionQuestion>): void {
  const entries = Object.entries(questions)
  if (entries.length === 0) throw new DecisionError('No decision questions', 'invalid')
  for (const [id, q] of entries) {
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2)) {
      throw new DecisionError(`Score question "${id}" needs a criteria list of at least 2 levels`, 'invalid')
    }
    if (q.type === 'choice' && (Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2)) {
      throw new DecisionError(`Choice question "${id}" needs a criteria map of at least 2 labels`, 'invalid')
    }
  }
}

export class HttpDecisionClient implements DecisionClient {
  readonly provider: string
  private readonly url: string
  private readonly model: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpDecisionClientOptions) {
    const endpoint = ENDPOINTS[options.provider]
    this.provider = options.provider
    this.url = options.url ?? endpoint.url
    this.model = options.model || endpoint.model
    this.apiKey = options.apiKey
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxRetries = options.maxRetries ?? 2
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async ask(request: DecisionRequest): Promise<DecisionResponse> {
    validateQuestions(request.questions)
    const body = JSON.stringify({ model: this.model, state: request.state, questions: request.questions })

    for (let attempt = 0; ; attempt += 1) {
      const timeout = AbortSignal.timeout(this.timeoutMs)
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
      let response: Response
      try {
        response = await this.fetchImpl(this.url, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`,
          },
          body,
        })
      } catch (error) {
        if (request.signal?.aborted) throw error
        if (timeout.aborted) throw new DecisionError(`Decision request timed out after ${this.timeoutMs}ms`, 'timeout')
        throw new DecisionError(
          `Decision network error: ${error instanceof Error ? error.message : String(error)}`,
          'network',
        )
      }

      if (response.ok) {
        const json = (await response.json()) as Partial<DecisionResponse>
        if (!json || typeof json !== 'object' || !json.answers) {
          throw new DecisionError('Unexpected decision response shape (no answers)', 'upstream', response.status)
        }
        return {
          model: json.model ?? this.model,
          answers: json.answers,
          usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 },
        }
      }

      const retryable = response.status === 429 || response.status >= 500
      if (retryable && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt, request.signal)
        continue
      }
      const text = (await response.text().catch(() => '')).slice(0, 200)
      if (response.status === 401 || response.status === 403) {
        throw new DecisionError(`Decision API auth error (${response.status})`, 'auth', response.status)
      }
      if (response.status === 429) throw new DecisionError('Decision API rate limited', 'rate_limit', 429)
      if (response.status === 400 || response.status === 422) {
        throw new DecisionError(`Decision API rejected request (${response.status}): ${text}`, 'invalid', response.status)
      }
      throw new DecisionError(`Decision API error ${response.status}: ${text}`, 'upstream', response.status)
    }
  }
}
