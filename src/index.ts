import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { createIssuesCommand } from './commands.js'
import { Config, resolveLiveConfig, type ResolvedConfig } from './config.js'
import { HttpDecisionClient, type DecisionClient } from './decision/client.js'
import { RestGitHubAdapter } from './github/rest-adapter.js'
import { createLogger, type Logger } from './log.js'
import { createRpcHandler, createRpcRoute, RPC_CHANNEL } from './rpc.js'
import { IssuePlanRuntime } from './runtime.js'
import { ISSUE_AUTHORING_SKILL, ISSUE_WORK_SKILL } from './skill.js'
import { createFileStore, defaultDataDir } from './store.js'
import { SyncService } from './sync.js'
import { createIssueDraftTool, createPlanReadTool, createPlanUpdateTool } from './tools.js'

const execFileAsync = promisify(execFile)

export const name = 'dsh-issue-priority'
/**
 * Required core services. `credentials` and `workingDirectory` are looked up
 * lazily with ctx.get() so their absence degrades (env / process.cwd()) instead
 * of leaving the plugin pending.
 */
export const inject = ['tools', 'commands', 'skills', 'timer']

export { Config }
export type { PluginConfig } from './config.js'
export { buildPlan } from './plan/planner.js'
export { validatePlanBlock, parsePlanBlock, renderPlanBlock } from './plan-block.js'
export { HttpDecisionClient } from './decision/client.js'
export { RestGitHubAdapter } from './github/rest-adapter.js'
export { SyncService } from './sync.js'

type AnyCtx = Context & Record<string, any>

async function resolveSecret(ctx: AnyCtx, ref: string): Promise<string | undefined> {
  if (!ref) return undefined
  const credentials = ctx.get?.('credentials') as { resolve?: (ref: string) => Promise<{ value: string } | undefined> } | undefined
  if (credentials?.resolve) {
    try {
      const hit = await credentials.resolve(ref)
      if (hit?.value) return hit.value
    } catch {
      // invalid ref grammar or provider error → env fallback
    }
  }
  return process.env[ref] || undefined
}

let ghTokenCache: { value: string | undefined; at: number } | null = null
async function ghCliToken(): Promise<string | undefined> {
  if (ghTokenCache && Date.now() - ghTokenCache.at < 10 * 60_000) return ghTokenCache.value
  let value: string | undefined
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 })
    value = stdout.trim() || undefined
  } catch {
    value = undefined
  }
  ghTokenCache = { value, at: Date.now() }
  return value
}

async function githubToken(ctx: AnyCtx, config: ResolvedConfig): Promise<string | undefined> {
  return (
    (await resolveSecret(ctx, config.githubTokenRef)) ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (await ghCliToken())
  )
}

function defaultKeyRef(config: ResolvedConfig): string {
  if (config.decisionApiKeyRef) return config.decisionApiKeyRef
  const refs = { liquid: 'LIQUID_API_KEY', openrouter: 'OPENROUTER_API_KEY', typesafe: 'TYPESAFE_API_KEY', custom: 'DECISION_API_KEY', none: '' } as const
  return refs[config.decisionProvider]
}

/** Returns a client, or a reason string why the model is off. */
async function decisionClient(ctx: AnyCtx, config: ResolvedConfig): Promise<DecisionClient | string> {
  if (config.decisionProvider === 'none') return 'decisionProvider が未設定（none）'
  if (!config.allowExternalJudgment) return 'allowExternalJudgment=false（Issue 内容を外部に送らない設定）'
  const ref = defaultKeyRef(config)
  const apiKey = await resolveSecret(ctx, ref)
  if (!apiKey) return `${ref} が未設定`
  try {
    return new HttpDecisionClient({
      provider: config.decisionProvider,
      apiKey,
      ...(config.decisionModel ? { model: config.decisionModel } : {}),
      ...(config.decisionApiUrl ? { url: config.decisionApiUrl } : {}),
      timeoutMs: config.decisionTimeoutMs,
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Mount the RPC channel the better-sidebar tab talks to.
 *
 * `connection.rpc.handle()` registers a prefix route through
 * `owner.webServer.register()` on the context that READ the service, so that
 * context must have `webServer` (and `connection`) injected — otherwise the
 * registration fails and the browser gets the SPA fallback's HTTP 405. A nested
 * `ctx.inject` keeps the plugin itself loadable on headless profiles.
 */
function mountRpc(ctx: AnyCtx, runtime: IssuePlanRuntime, logger: Logger): void {
  const dispatch = createRpcHandler({
    runtime,
    agents: () => {
      const agents = ctx.get?.('agents') as { list?: () => unknown[] } | undefined
      try {
        return (agents?.list?.() ?? []) as never
      } catch {
        return [] as never
      }
    },
  })
  if (typeof ctx.inject !== 'function') {
    logger.warn('ctx.inject unavailable; sidebar tab disabled')
    return
  }
  // Only `webServer` is required: on the desktop host `connection` is absent
  // (dsh-run-button logs connection=false) and a nested inject on it never fires.
  ctx.inject(['webServer'], (inner: AnyCtx) => {
    const handler = (endpoint: string, payload: unknown, signal?: AbortSignal) => dispatch(endpoint, payload, signal)
    const connection = inner.get('connection') as
      | { rpc?: { handle?: (channel: string, h: unknown) => unknown }; requestRejection?: (req: unknown) => number | undefined }
      | undefined
    if (connection?.rpc && typeof connection.rpc.handle === 'function') {
      try {
        connection.rpc.handle(RPC_CHANNEL, handler)
        logger.info('sidebar RPC channel mounted via connection.rpc', { channel: RPC_CHANNEL })
        return
      } catch (error) {
        logger.warn('connection.rpc.handle failed; falling back to a direct route', { error: String(error) })
      }
    }
    const webServer = inner.get('webServer') as { register?: (route: unknown) => unknown } | undefined
    if (!webServer || typeof webServer.register !== 'function') {
      logger.warn('webServer.register unavailable; sidebar tab disabled')
      return
    }
    const route = createRpcRoute(handler, connection?.requestRejection?.bind(connection))
    try {
      inner.effect(() => webServer.register!(route) as () => void, 'dsh-issue-priority: sidebar RPC route')
      logger.info('sidebar RPC channel mounted as direct route', { channel: RPC_CHANNEL })
    } catch (error) {
      logger.warn('sidebar RPC route could not be registered', { error: String(error) })
    }
  })
}

/**
 * Cordis plugin entry. All registrations are effect-scoped so unloading the
 * plugin removes tools, the command, skills and the timer.
 */
export const apply = (ctx: AnyCtx, rawConfig: Record<string, unknown> = {}) => {
  const config = () => resolveLiveConfig(rawConfig)
  const hostLogger = typeof ctx.logger === 'function' ? ctx.logger(name) : undefined
  const logger: Logger = createLogger(hostLogger ?? console, config().logLevel)
  const store = createFileStore(config().dataDir || defaultDataDir())

  const sync = new SyncService({
    store,
    logger,
    settings: () => {
      const c = config()
      return {
        maxIssues: c.maxIssues,
        maxQuestionsPerSync: c.maxQuestionsPerSync,
        mergeThreshold: c.mergeThreshold,
        actionableThreshold: c.actionableThreshold,
        directionThreshold: c.directionThreshold,
        similarityThreshold: c.similarityThreshold,
        maxPackageSize: c.maxPackageSize,
      }
    },
    github: async () => {
      const c = config()
      return new RestGitHubAdapter({ token: await githubToken(ctx, c), baseUrl: c.githubApiBase, maxRetries: c.githubMaxRetries })
    },
    decision: async () => {
      const res = await decisionClient(ctx, config())
      if (typeof res === 'string') {
        logger.debug('decision model off', { reason: res })
        return null
      }
      return res
    },
  })

  const runtime = new IssuePlanRuntime({
    store,
    sync,
    logger,
    cwdOf: (agent) => {
      const wd = ctx.get?.('workingDirectory') as { get?: (session: unknown) => string } | undefined
      const session = (agent as { session?: unknown } | undefined)?.session
      if (!wd?.get || !session) return undefined
      try {
        return wd.get(session)
      } catch {
        return undefined
      }
    },
    decisionStatus: async () => {
      const res = await decisionClient(ctx, config())
      return typeof res === 'string' ? res : undefined
    },
  })

  ctx.effect(() => ctx.tools.register(createIssueDraftTool(runtime)))
  ctx.effect(() => ctx.tools.register(createPlanReadTool(runtime)))
  ctx.effect(() => ctx.tools.register(createPlanUpdateTool(runtime)))
  ctx.effect(() => ctx.commands.register(createIssuesCommand(runtime)))
  for (const skill of [ISSUE_AUTHORING_SKILL, ISSUE_WORK_SKILL]) {
    ctx.effect(() => ctx.skills.register({ ...skill, source: 'runtime' }))
  }

  mountRpc(ctx, runtime, logger)

  // Background sync: plugin-internal timer, no LLM. Repos become known when a
  // tool/command first resolves them in this process.
  const minutes = config().syncIntervalMinutes
  if (minutes > 0) {
    const tick = async () => {
      for (const repo of await store.listRepos().catch(() => [])) runtime.knownRepos.add(repo)
      for (const repo of runtime.knownRepos) {
        try {
          await sync.sync(repo)
        } catch (error) {
          logger.warn('background sync failed', { repo, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    const every = minutes * 60_000
    // First pass shortly after startup so a stale plan is refreshed before the user asks.
    if (typeof ctx.setTimeout === 'function') ctx.setTimeout(() => void tick(), 30_000)
    if (typeof ctx.interval === 'function') ctx.interval(() => void tick(), every)
    else ctx.effect(() => {
      const h = setInterval(() => void tick(), every)
      h.unref?.()
      return () => clearInterval(h)
    })
  }
}
