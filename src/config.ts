import Schema from '@deepseek-ai/schemastery'
import type { LogLevel } from './log.js'
import type { DecisionProviderId } from './decision/client.js'

export interface PluginConfig {
  decisionProvider?: DecisionProviderId | 'none'
  decisionApiKeyRef?: string
  decisionModel?: string
  decisionApiUrl?: string
  allowExternalJudgment?: boolean
  maxQuestionsPerSync?: number
  mergeThreshold?: number
  actionableThreshold?: number
  directionThreshold?: number
  maxPackageSize?: number
  syncIntervalMinutes?: number
  maxIssues?: number
  githubTokenRef?: string
  githubApiBase?: string
  githubMaxRetries?: number
  dataDir?: string
  logLevel?: LogLevel
  decisionTimeoutMs?: number
}

/**
 * Cordis Config (Standard Schema). Fields are volatile() so live settings
 * updates are re-read on the next sync without a plugin reload.
 */
export const Config = Schema.object({
  decisionProvider: Schema.union(['liquid' as const, 'openrouter' as const, 'typesafe' as const, 'custom' as const, 'none' as const])
    .default('liquid')
    .description(
      'Decision model (System One API). `liquid` = api.liquid.ai d1 (LIQUID_API_KEY), ' +
        '`openrouter` = liquid/d1 (OPENROUTER_API_KEY), `typesafe` = Jev (TYPESAFE_API_KEY), ' +
        '`custom` = decisionApiUrl + decisionModel (DECISION_API_KEY), `none` = deterministic only.',
    )
    .volatile(),
  decisionApiKeyRef: Schema.string()
    .default('')
    .description('Credential / env name for the decision API key. Empty = LIQUID_API_KEY or OPENROUTER_API_KEY by provider.')
    .volatile(),
  decisionModel: Schema.string().default('').description('Model id override. Empty = provider default (d1 / liquid/d1 / jev-1.14.0). Required for custom.').volatile(),
  decisionApiUrl: Schema.string().default('').description('Endpoint override. Required for custom (POST, System One request shape).').volatile(),
  allowExternalJudgment: Schema.boolean()
    .default(false)
    .description(
      'Issue titles/bodies are sent to the decision API. Must be true to use any decision provider; ' +
        'while false the plugin plans deterministically and says so.',
    )
    .volatile(),
  maxQuestionsPerSync: Schema.natural().min(0).max(2000).default(200).description('Cap on decision questions per sync (cache misses only).').volatile(),
  mergeThreshold: Schema.number().min(0).max(1).default(0.6).description('Merge noul ≥ this → same package.').volatile(),
  actionableThreshold: Schema.number().min(0).max(1).default(0.35).description('Actionable noul below this → needsHuman (unclear).').volatile(),
  directionThreshold: Schema.number().min(0).max(1).default(0.6).description('Direction choice probability needed for an advisory order.').volatile(),
  maxPackageSize: Schema.natural().min(1).max(16).default(4).description('Max package size (S=1, M=2, L=4).').volatile(),
  syncIntervalMinutes: Schema.natural().min(0).max(1440).default(60).description('Background sync interval; 0 disables the timer.'),
  maxIssues: Schema.natural().min(1).max(5000).default(300).description('Max open issues fetched per sync (most recently updated first). Raise for large backlogs; more issues = more GitHub requests and more decision questions on the first sync.').volatile(),
  githubTokenRef: Schema.string().default('GITHUB_TOKEN').description('Credential / env name for a GitHub token (value is never logged). Falls back to `gh auth token`.').volatile(),
  githubApiBase: Schema.string().default('https://api.github.com').description('GitHub API base URL.').volatile(),
  githubMaxRetries: Schema.natural().min(0).max(8).default(3).description('Retries on GitHub rate limit.').volatile(),
  dataDir: Schema.string().default('').description('Local plan storage directory. Empty = $DSH_HOME/data/dsh-issue-priority.'),
  logLevel: Schema.union(['silent' as const, 'warn' as const, 'info' as const, 'debug' as const]).default('info').description('Log verbosity.').volatile(),
  decisionTimeoutMs: Schema.natural().min(1000).max(120_000).default(15_000).description('Per-request decision API timeout.').volatile(),
})

export type ResolvedConfig = Required<PluginConfig>

export const DEFAULTS: ResolvedConfig = {
  decisionProvider: 'liquid',
  decisionApiKeyRef: '',
  decisionModel: '',
  decisionApiUrl: '',
  allowExternalJudgment: false,
  maxQuestionsPerSync: 200,
  mergeThreshold: 0.6,
  actionableThreshold: 0.35,
  directionThreshold: 0.6,
  maxPackageSize: 4,
  syncIntervalMinutes: 60,
  maxIssues: 300,
  githubTokenRef: 'GITHUB_TOKEN',
  githubApiBase: 'https://api.github.com',
  githubMaxRetries: 3,
  dataDir: '',
  logLevel: 'info',
  decisionTimeoutMs: 15_000,
}

type Live<T> = T | { get(): T }

function readLive<T>(value: Live<T> | undefined, fallback: T): T {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function') {
    const v = (value as { get(): T }).get()
    return v === undefined || v === null ? fallback : v
  }
  return value as T
}

export function resolveLiveConfig(raw: Record<string, unknown>): ResolvedConfig {
  const out = {} as Record<string, unknown>
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    out[key] = readLive(raw[key] as Live<unknown> | undefined, fallback)
  }
  return out as ResolvedConfig
}
