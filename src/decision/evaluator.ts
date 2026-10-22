import type { GitHubIssue, IssueJudgment } from '../types.js'

export interface EvaluateBatchOptions {
  objective: string
  signal?: AbortSignal
  /** Max concurrent judgments. */
  concurrency?: number
}

/**
 * Pluggable judgment backend.
 *
 * Jev (System One) is the default adapter. Chat LLMs are intentionally not
 * first-class here — they generate prose; this seam expects calibrated
 * structured judgments. A future Decision AI / System One route can implement
 * the same interface without changing Ranking Policy.
 */
export interface DecisionEvaluator {
  readonly kind: 'jev' | string
  readonly providerId: string
  readonly transmitting: boolean
  /** Model id used for judgments when known. */
  readonly modelId: string
  evaluateIssues(issues: readonly GitHubIssue[], options: EvaluateBatchOptions): Promise<IssueJudgment[]>
}

export class DecisionEvaluatorError extends Error {
  readonly code: 'missing_service' | 'egress_denied' | 'provider' | 'invalid'

  constructor(message: string, code: DecisionEvaluatorError['code']) {
    super(message)
    this.name = 'DecisionEvaluatorError'
    this.code = code
  }
}
