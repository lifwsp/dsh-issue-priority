import type { GitHubIssue, IssueJudgment, DimensionScores } from '../types.js'
import { DecisionEvaluatorError, type DecisionEvaluator, type EvaluateBatchOptions } from './evaluator.js'
import { EFFORT_LEVELS, normalizeScore, POSITIVE_LEVELS } from './score-rubric.js'
import type { Logger } from '../log.js'

/** Minimal surface of ctx.get('jev') from jevcore-dsh (verified against 0.4.1). */
export interface JevServiceLike {
  ask(input: {
    feature: string
    state: unknown
    questions: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<{
    model: string
    provider: string
    warning?: string
    answers: Record<string, JevAnswerLike>
    truncated?: boolean
  }>
  readonly providerId: string
  readonly transmitting: boolean
}

type JevAnswerLike =
  | { type: 'noul'; noul: number }
  | {
      type: 'score'
      score: number
      confidence?: number
      legend?: Record<string, string>
      probabilities?: Record<string, number>
    }
  | {
      type: 'choice'
      choice: string
      confidence?: number
      probabilities?: Record<string, number>
    }

const FEATURE = 'tool:jev_ask'

function scoreQuestion(instructions: string, levels: Record<string, string>) {
  return {
    type: 'score' as const,
    instructions,
    // jevcore's score() converts map → ordered array by insertion order.
    // We pass the map shape that jev.ask tools accept; the service's ask()
    // expects already-built JevQuestion with criteria as string[]. Build array.
    criteria: Object.values(levels),
  }
}

function noulQuestion(instructions: string, boundary: { true: string; false: string }) {
  return {
    type: 'noul' as const,
    instructions,
    criteria: boundary,
  }
}

function buildState(issue: GitHubIssue, objective: string) {
  return {
    objective,
    issue: {
      number: issue.number,
      title: issue.title,
      body: issue.body.slice(0, 4000),
      labels: issue.labels.map((l) => l.name),
      milestone: issue.milestone?.title ?? null,
      assignees: issue.assignees.map((a) => a.login),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      blockedBy: issue.blockedBy,
      blocks: issue.blocks,
      relatedPullRequests: issue.relatedPullRequests.map((p) => ({
        number: p.number,
        state: p.state,
        title: p.title,
      })),
      commentSummaries: issue.commentSummaries.slice(0, 3),
    },
  }
}

function evidenceRefs(issue: GitHubIssue): string[] {
  const refs = [
    `issue:${issue.number}`,
    `issue:${issue.number}:updatedAt:${issue.updatedAt}`,
  ]
  if (issue.labels.length) refs.push(`issue:${issue.number}:labels`)
  if (issue.milestone) refs.push(`issue:${issue.number}:milestone:${issue.milestone.title}`)
  if (issue.blockedBy.length) refs.push(`issue:${issue.number}:blockedBy:${issue.blockedBy.join(',')}`)
  if (issue.relatedPullRequests.length) {
    refs.push(`issue:${issue.number}:relatedPrs:${issue.relatedPullRequests.map((p) => p.number).join(',')}`)
  }
  return refs
}

function readScore(answer: JevAnswerLike | undefined): { value: number; confidence: number } | null {
  if (!answer || answer.type !== 'score') return null
  if (!Number.isFinite(answer.score)) return null
  const confidence =
    typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
      ? answer.confidence
      : estimateConcentration(answer.probabilities)
  return { value: normalizeScore(answer.score), confidence }
}

function estimateConcentration(probabilities?: Record<string, number>): number {
  if (!probabilities) return 0.5
  const values = Object.values(probabilities)
  if (values.length === 0) return 0.5
  return Math.max(...values)
}

function readNoul(answer: JevAnswerLike | undefined): { value: number; confidence: number } | null {
  if (!answer || answer.type !== 'noul') return null
  if (!Number.isFinite(answer.noul)) return null
  const value = Math.min(1, Math.max(0, answer.noul))
  return { value, confidence: Math.max(value, 1 - value) }
}

function parseAnswers(answers: Record<string, JevAnswerLike>): DimensionScores | null {
  const impact = readScore(answers.impact)
  const urgency = readScore(answers.urgency)
  const effort = readScore(answers.effort)
  const unblockValue = readScore(answers.unblockValue)
  const actionability = readNoul(answers.actionable)

  if (!impact || !urgency || !effort || !unblockValue || !actionability) return null

  const confidence = Math.min(
    impact.confidence,
    urgency.confidence,
    effort.confidence,
    unblockValue.confidence,
    actionability.confidence,
  )

  return {
    impact: impact.value,
    urgency: urgency.value,
    effort: effort.value,
    unblockValue: unblockValue.value,
    actionability: actionability.value,
    confidence,
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next
        next += 1
        results[i] = await fn(items[i]!, i)
      }
    }),
  )
  return results
}

export interface JevEvaluatorOptions {
  jev: JevServiceLike
  logger?: Logger
  /** When true, refuse if the Jev service would transmit state externally. */
  allowExternalJudgment?: boolean
  /** Override model reporting when the service does not stamp one until after ask. */
  modelHint?: string
  askTimeoutMs?: number
}

export class JevDecisionEvaluator implements DecisionEvaluator {
  readonly kind = 'jev' as const
  private readonly jev: JevServiceLike
  private readonly logger?: Logger
  private readonly allowExternalJudgment: boolean
  private readonly modelHint?: string
  private readonly askTimeoutMs: number
  private lastModel = 'unknown'

  constructor(options: JevEvaluatorOptions) {
    this.jev = options.jev
    this.logger = options.logger
    this.allowExternalJudgment = options.allowExternalJudgment ?? false
    this.modelHint = options.modelHint
    this.askTimeoutMs = options.askTimeoutMs ?? 30_000
  }

  get providerId(): string {
    return this.jev.providerId
  }

  get transmitting(): boolean {
    return this.jev.transmitting
  }

  get modelId(): string {
    return this.modelHint ?? this.lastModel
  }

  async evaluateIssues(
    issues: readonly GitHubIssue[],
    options: EvaluateBatchOptions,
  ): Promise<IssueJudgment[]> {
    if (this.jev.transmitting && !this.allowExternalJudgment) {
      throw new DecisionEvaluatorError(
        'Jev is configured to transmit state externally, but allowExternalJudgment is false. ' +
          'Set allowExternalJudgment: true only after reviewing the private-repo privacy note in the README.',
        'egress_denied',
      )
    }

    const concurrency = options.concurrency ?? 4
    return mapPool(issues, concurrency, async (issue) => this.evaluateOne(issue, options.objective, options.signal))
  }

  private async evaluateOne(
    issue: GitHubIssue,
    objective: string,
    parentSignal?: AbortSignal,
  ): Promise<IssueJudgment> {
    const refs = evidenceRefs(issue)
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error(`Jev ask timed out after ${this.askTimeoutMs}ms`)),
      this.askTimeoutMs,
    )
    const onParent = () => controller.abort(parentSignal?.reason ?? new Error('aborted'))
    parentSignal?.addEventListener('abort', onParent)

    try {
      const result = await this.jev.ask({
        feature: FEATURE,
        state: buildState(issue, objective),
        questions: {
          impact: scoreQuestion(
            'Score how much completing this issue advances the project objective. Use the ordered levels; compare against the objective, not general importance.',
            POSITIVE_LEVELS,
          ),
          urgency: scoreQuestion(
            'Score how urgently this issue should be done now versus later, given the objective and current state.',
            POSITIVE_LEVELS,
          ),
          effort: scoreQuestion(
            'Score the implementation effort / cost to complete this issue as described.',
            EFFORT_LEVELS,
          ),
          unblockValue: scoreQuestion(
            'Score how much completing this issue unblocks other important work toward the objective.',
            POSITIVE_LEVELS,
          ),
          actionable: noulQuestion(
            'Can a contributor start implementing this issue now with the information and dependencies given?',
            {
              true: 'Yes — dependencies are clear or absent, scope is actionable, no hard blocker.',
              false: 'No — blocked, underspecified, or not actionable yet.',
            },
          ),
        },

        signal: controller.signal,
      })

      this.lastModel = result.model || this.lastModel
      const synthetic = Boolean(result.warning) || result.provider === 'mock'
      const scores = parseAnswers(result.answers)

      if (!scores || result.truncated) {
        return {
          issueNumber: issue.number,
          scores: null,
          synthetic,
          provider: result.provider,
          model: result.model,
          failureReason: result.truncated
            ? 'State was truncated before judgment; refusing to invent scores.'
            : 'Incomplete or malformed Jev answers; needs_review.',
          evidenceRefs: refs,
          rawAnswers: result.answers as unknown as Record<string, unknown>,
        }
      }

      return {
        issueNumber: issue.number,
        scores,
        synthetic,
        provider: result.provider,
        model: result.model,
        evidenceRefs: refs,
        rawAnswers: result.answers as unknown as Record<string, unknown>,
      }
    } catch (error) {
      this.logger?.warn('Jev evaluation failed for issue', {
        issue: issue.number,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        issueNumber: issue.number,
        scores: null,
        synthetic: this.jev.providerId === 'mock',
        provider: this.jev.providerId,
        model: this.modelId,
        failureReason: error instanceof Error ? error.message : String(error),
        evidenceRefs: refs,
      }
    } finally {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', onParent)
    }
  }
}

/** Resolve ctx.get('jev') or throw a clear missing-service error. */
export function requireJevService(ctx: { get: (name: string) => unknown }): JevServiceLike {
  const jev = ctx.get('jev') as JevServiceLike | undefined
  if (!jev || typeof jev.ask !== 'function') {
    throw new DecisionEvaluatorError(
      'Jev service is not available. Install and activate jevcore-dsh (ctx.get("jev")), then retry.',
      'missing_service',
    )
  }
  return jev
}
