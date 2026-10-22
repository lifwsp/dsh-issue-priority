import type { GitHubIssueAdapter } from './github/adapter.js'
import { resolveRepo } from './github/rest-adapter.js'
import type { DecisionEvaluator } from './decision/evaluator.js'
import { buildCacheKey, type EvaluationCache } from './cache/evaluation-cache.js'
import { applyDependencyHints, defaultRankingPolicy, rankIssues } from './ranking/policy.js'
import type { Logger } from './log.js'
import type {
  PrioritizeIssuesArgs,
  PrioritizeResult,
  RankingPolicyConfig,
  EvaluatorKind,
} from './types.js'

export interface PipelineDeps {
  github: GitHubIssueAdapter
  evaluator: DecisionEvaluator
  cache: EvaluationCache
  policy: RankingPolicyConfig
  logger: Logger
  defaultLimit: number
}

export async function prioritizeIssues(
  args: PrioritizeIssuesArgs,
  deps: PipelineDeps,
  signal?: AbortSignal,
): Promise<PrioritizeResult> {
  const repo = resolveRepo(args.repo)
  const limit = args.limit ?? deps.defaultLimit
  const objective = args.objective.trim()
  if (!objective) {
    throw new Error('objective is required')
  }

  deps.logger.info('Fetching open issues', { repo, limit, labels: args.labels ?? [] })
  const issues = await deps.github.listOpenIssues({
    repo,
    limit,
    labels: args.labels,
    signal,
  })

  const evaluatorKind = deps.evaluator.kind as EvaluatorKind
  const cacheKey = buildCacheKey({
    repo,
    objective,
    issues,
    policy: deps.policy,
    evaluatorKind,
    providerId: deps.evaluator.providerId,
    modelId: deps.evaluator.modelId,
  })

  let cacheHit = false
  let storedAt: string | undefined
  let judgments = deps.cache.get(cacheKey)?.judgments

  if (judgments && !args.forceRefresh) {
    cacheHit = true
    storedAt = deps.cache.get(cacheKey)?.storedAt
    deps.logger.info('Evaluation cache hit', { repo, issues: issues.length })
  } else {
    deps.logger.info('Evaluating issues', {
      repo,
      count: issues.length,
      evaluator: deps.evaluator.kind,
      provider: deps.evaluator.providerId,
    })
    judgments = await deps.evaluator.evaluateIssues(issues, {
      objective,
      signal,
    })
    deps.cache.set(cacheKey, judgments)
    storedAt = deps.cache.get(cacheKey)?.storedAt
  }

  const ranked = applyDependencyHints(rankIssues(issues, judgments, deps.policy))

  const syntheticCount = ranked.filter((r) => r.synthetic).length
  return {
    repo,
    objective,
    rankingPolicy: {
      version: deps.policy.version,
      weights: deps.policy.weights,
      confidenceThreshold: deps.policy.confidenceThreshold,
    },
    evaluator: {
      kind: evaluatorKind,
      provider: deps.evaluator.providerId,
      model: deps.evaluator.modelId,
      transmitting: deps.evaluator.transmitting,
    },
    cache: { hit: cacheHit, storedAt },
    issues: ranked,
    summary: {
      total: ranked.length,
      ready: ranked.filter((r) => r.status === 'ready').length,
      blocked: ranked.filter((r) => r.status === 'blocked').length,
      needsReview: ranked.filter((r) => r.status === 'needs_review').length,
      syntheticCount,
    },
  }
}

export { defaultRankingPolicy }
