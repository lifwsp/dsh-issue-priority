import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveLiveConfig, type ResolvedConfig } from './config.js'
import { createMemoryCache, type EvaluationCache } from './cache/evaluation-cache.js'
import { RestGitHubAdapter } from './github/rest-adapter.js'
import { JevDecisionEvaluator, requireJevService } from './decision/jev-evaluator.js'
import { DecisionEvaluatorError } from './decision/evaluator.js'
import { createLogger } from './log.js'
import { createPrioritizeIssuesTool } from './tools/prioritize-issues.js'
import type { PipelineDeps } from './pipeline.js'
import { defaultRankingPolicy } from './ranking/policy.js'

export const name = 'dsh-issue-priority'
/**
 * `tools` is required. `jev` is resolved at call time so a missing jevcore-dsh
 * fails the tool with a clear error instead of leaving this plugin `pending`.
 */
export const inject = ['tools']

export { Config }
export type { PluginConfig } from './config.js'
export { prioritizeIssues } from './pipeline.js'
export { rankIssues, computePriorityScore, defaultRankingPolicy, RANKING_POLICY_VERSION } from './ranking/policy.js'
export { RestGitHubAdapter } from './github/rest-adapter.js'
export { JevDecisionEvaluator } from './decision/jev-evaluator.js'
export type { DecisionEvaluator } from './decision/evaluator.js'
export type { GitHubIssueAdapter } from './github/adapter.js'

function resolveGithubToken(ctx: Context, ref: string): string | undefined {
  const credentials = ctx.get('credentials') as
    | { get?: (name: string) => string | undefined | Promise<string | undefined> }
    | undefined
  if (credentials?.get) {
    try {
      const value = credentials.get(ref)
      if (typeof value === 'string' && value) return value
    } catch {
      // fall through to env
    }
  }
  return process.env[ref] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined
}

function buildDeps(ctx: Context, config: ResolvedConfig, cache: EvaluationCache): PipelineDeps {
  const hostLogger = (ctx as Context & { logger?: (n: string) => Console }).logger?.(name)
  const logger = createLogger(hostLogger ?? console, config.logLevel)

  const github = new RestGitHubAdapter({
    token: resolveGithubToken(ctx, config.githubTokenRef),
    baseUrl: config.githubApiBase,
    maxRetries: config.githubMaxRetries,
  })

  if (config.evaluator !== 'jev') {
    throw new DecisionEvaluatorError(
      `Unsupported evaluator "${String(config.evaluator)}". This build ships only "jev".`,
      'invalid',
    )
  }

  const jev = requireJevService(ctx)
  const evaluator = new JevDecisionEvaluator({
    jev,
    logger,
    allowExternalJudgment: config.allowExternalJudgment,
    askTimeoutMs: config.askTimeoutMs,
  })

  const baseEvaluate = evaluator.evaluateIssues.bind(evaluator)
  evaluator.evaluateIssues = (issues, options) =>
    baseEvaluate(issues, {
      ...options,
      concurrency: options.concurrency ?? config.evaluateConcurrency,
    })

  return {
    github,
    evaluator,
    cache,
    policy: defaultRankingPolicy({
      version: config.rankingPolicyVersion,
      confidenceThreshold: config.confidenceThreshold,
      weights: config.weights,
    }),
    logger,
    defaultLimit: config.defaultLimit,
  }
}

/**
 * Cordis plugin entry. Registration is effect-scoped: unloading the plugin
 * unregisters prioritize_issues.
 */
export const apply = (ctx: Context, rawConfig: Record<string, unknown> = {}) => {
  let cache: EvaluationCache | undefined

  const getDeps = (): PipelineDeps => {
    const config = resolveLiveConfig(rawConfig)
    cache ??= createMemoryCache(config.cacheMaxEntries)
    return buildDeps(ctx, config, cache)
  }

  const tool = createPrioritizeIssuesTool(getDeps)
  ctx.effect(() => ctx.tools.register(tool))
}
