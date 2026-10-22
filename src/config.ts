import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_WEIGHTS, RANKING_POLICY_VERSION } from './ranking/policy.js'
import type { LogLevel } from './log.js'
import type { EvaluatorKind, RankingWeights } from './types.js'

export interface PluginConfig {
  /** Decision backend. Only `jev` is shipped; the seam is pluggable for future System One routes. */
  evaluator?: EvaluatorKind
  /** Max issues fetched / judged per call. */
  defaultLimit?: number
  /** Concurrent Jev asks. */
  evaluateConcurrency?: number
  /** Refuse when Jev would send state off-box, unless true. */
  allowExternalJudgment?: boolean
  githubTokenRef?: string
  githubApiBase?: string
  githubMaxRetries?: number
  confidenceThreshold?: number
  weights?: Partial<RankingWeights>
  rankingPolicyVersion?: string
  cacheMaxEntries?: number
  logLevel?: LogLevel
  askTimeoutMs?: number
}

const weightField = (fallback: number, description: string) =>
  Schema.number().min(0).max(1).default(fallback).description(description).volatile()

/**
 * Cordis Config: must be a Standard Schema (`~standard.validate`).
 * Fields marked volatile() so live settings updates re-read without full reload
 * where the host supports it.
 */
export const Config = Schema.object({
  evaluator: Schema.union(['jev' as const])
    .default('jev')
    .description(
      'Decision evaluator. `jev` uses jevcore-dsh (ctx.get("jev")). Model/provider switching ' +
        'is configured on jevcore-dsh (mock | live | openrouter + model id), not here.',
    )
    .volatile(),
  defaultLimit: Schema.natural().min(1).max(100).default(20).description('Default Issue limit.').volatile(),
  evaluateConcurrency: Schema.natural().min(1).max(8).default(4).description('Concurrent judgments.').volatile(),
  allowExternalJudgment: Schema.boolean()
    .default(false)
    .description(
      'When false, refuse if Jev is transmitting (live/openrouter). Private Issue bodies would leave the machine.',
    )
    .volatile(),
  githubTokenRef: Schema.string()
    .default('GITHUB_TOKEN')
    .description('Credential / env name for a GitHub token (value is never logged).')
    .volatile(),
  githubApiBase: Schema.string().default('https://api.github.com').description('GitHub API base URL.').volatile(),
  githubMaxRetries: Schema.natural().min(0).max(8).default(3).description('Retries on rate limit.').volatile(),
  confidenceThreshold: Schema.number()
    .min(0)
    .max(1)
    .default(DEFAULT_CONFIDENCE_THRESHOLD)
    .description('Below this confidence → needs_review.')
    .volatile(),
  weights: Schema.object({
    impact: weightField(DEFAULT_WEIGHTS.impact, 'Weight for Impact.'),
    urgency: weightField(DEFAULT_WEIGHTS.urgency, 'Weight for Urgency.'),
    unblockValue: weightField(DEFAULT_WEIGHTS.unblockValue, 'Weight for Unblock Value.'),
    effort: weightField(DEFAULT_WEIGHTS.effort, 'Weight for Effort (cost term).'),
  }).description('Ranking weights for priority = Σ positive − effort.'),
  rankingPolicyVersion: Schema.string()
    .default(RANKING_POLICY_VERSION)
    .description('Reported policy version string.')
    .volatile(),
  cacheMaxEntries: Schema.natural().min(1).max(512).default(64).description('In-memory evaluation cache size.').volatile(),
  logLevel: Schema.union(['silent' as const, 'warn' as const, 'info' as const, 'debug' as const])
    .default('info')
    .description('Structured log verbosity.')
    .volatile(),
  askTimeoutMs: Schema.natural().min(1000).max(120_000).default(30_000).description('Per-issue Jev timeout.').volatile(),
})

export type ResolvedConfig = Required<
  Pick<
    PluginConfig,
    | 'evaluator'
    | 'defaultLimit'
    | 'evaluateConcurrency'
    | 'allowExternalJudgment'
    | 'githubTokenRef'
    | 'githubApiBase'
    | 'githubMaxRetries'
    | 'confidenceThreshold'
    | 'cacheMaxEntries'
    | 'logLevel'
    | 'askTimeoutMs'
    | 'rankingPolicyVersion'
  >
> & {
  weights: RankingWeights
}

type Live<T> = T | { get(): T }

function readLive<T>(value: Live<T>): T {
  return value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function'
    ? (value as { get(): T }).get()
    : (value as T)
}

export function resolveLiveConfig(raw: Record<string, unknown>): ResolvedConfig {
  const weightsRaw = (raw.weights ?? {}) as Record<string, unknown>
  return {
    evaluator: readLive((raw.evaluator as Live<EvaluatorKind> | undefined) ?? 'jev'),
    defaultLimit: readLive((raw.defaultLimit as Live<number> | undefined) ?? 20),
    evaluateConcurrency: readLive((raw.evaluateConcurrency as Live<number> | undefined) ?? 4),
    allowExternalJudgment: readLive((raw.allowExternalJudgment as Live<boolean> | undefined) ?? false),
    githubTokenRef: readLive((raw.githubTokenRef as Live<string> | undefined) ?? 'GITHUB_TOKEN'),
    githubApiBase: readLive((raw.githubApiBase as Live<string> | undefined) ?? 'https://api.github.com'),
    githubMaxRetries: readLive((raw.githubMaxRetries as Live<number> | undefined) ?? 3),
    confidenceThreshold: readLive(
      (raw.confidenceThreshold as Live<number> | undefined) ?? DEFAULT_CONFIDENCE_THRESHOLD,
    ),
    rankingPolicyVersion: readLive(
      (raw.rankingPolicyVersion as Live<string> | undefined) ?? RANKING_POLICY_VERSION,
    ),
    cacheMaxEntries: readLive((raw.cacheMaxEntries as Live<number> | undefined) ?? 64),
    logLevel: readLive((raw.logLevel as Live<LogLevel> | undefined) ?? 'info'),
    askTimeoutMs: readLive((raw.askTimeoutMs as Live<number> | undefined) ?? 30_000),
    weights: {
      impact: readLive((weightsRaw.impact as Live<number> | undefined) ?? DEFAULT_WEIGHTS.impact),
      urgency: readLive((weightsRaw.urgency as Live<number> | undefined) ?? DEFAULT_WEIGHTS.urgency),
      unblockValue: readLive(
        (weightsRaw.unblockValue as Live<number> | undefined) ?? DEFAULT_WEIGHTS.unblockValue,
      ),
      effort: readLive((weightsRaw.effort as Live<number> | undefined) ?? DEFAULT_WEIGHTS.effort),
    },
  }
}
