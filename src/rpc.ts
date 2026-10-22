/**
 * Loopback RPC channel for the better-sidebar tab (client/client.js).
 *
 * The browser half calls `connection.rpc.call(CHANNEL, endpoint, payload)`;
 * every endpoint resolves the repository from the sidebar's session (its agent's
 * working directory) or the cwd the sidebar reports, then reuses the same
 * runtime the /issues command uses. No endpoint writes to GitHub.
 */
import { nextPackage, renderKickoff, userMessage } from './render.js'
import type { IssuePlanRuntime } from './runtime.js'
import type { RepoState } from './store.js'
import type { Plan } from './types.js'

export const RPC_CHANNEL = '/dsh-issue-priority'

export type RpcResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

interface AgentLike {
  id?: unknown
  session?: unknown
  followup?: (message: unknown) => void
}

export interface RpcDeps {
  runtime: IssuePlanRuntime
  /** Live agents (from the `agents` service); empty when unavailable. */
  agents: () => AgentLike[]
}

interface Payload {
  sessionId?: unknown
  cwd?: unknown
  repo?: unknown
  packageId?: unknown
  issue?: unknown
  action?: unknown
  full?: unknown
}

/** What the tab renders. Only the fields the UI needs, no issue bodies. */
export interface PlanView {
  repo: string
  lastSyncAt: string | null
  lastSyncError: string | null
  plan: Plan
  nextId: string | null
  issues: Record<string, { title: string; htmlUrl: string; labels: string[] }>
  overrides: Record<string, 'defer' | 'pin'>
  inProgress: { issues: number[]; branch?: string | null } | null
  usage: { questions: number; inputTokens: number }
  canKickoff: boolean
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function findAgent(deps: RpcDeps, sessionId: string | undefined): AgentLike | undefined {
  let list: AgentLike[] = []
  try {
    list = deps.agents()
  } catch {
    list = []
  }
  if (sessionId) {
    const hit = list.find((a) => String(a.id) === sessionId)
    if (hit) return hit
  }
  return undefined
}

function view(state: RepoState, plan: Plan, agent: AgentLike | undefined): PlanView {
  const issues: PlanView['issues'] = {}
  const wanted = new Set<number>()
  for (const p of plan.workPackages) for (const n of p.issues) wanted.add(n)
  for (const h of plan.needsHuman) wanted.add(h.issue)
  for (const p of plan.workPackages) for (const n of p.blockedByExternal) wanted.add(n)
  for (const n of wanted) {
    const i = state.issues[String(n)]
    if (i) issues[String(n)] = { title: i.title, htmlUrl: i.htmlUrl, labels: i.labels }
  }
  const overrides: PlanView['overrides'] = {}
  for (const o of state.overrides) overrides[String(o.issue)] = o.action
  return {
    repo: state.repo,
    lastSyncAt: state.lastSyncAt,
    lastSyncError: state.lastSyncError ?? null,
    plan,
    nextId: nextPackage(plan)?.id ?? null,
    issues,
    overrides,
    inProgress: state.inProgress ? { issues: state.inProgress.issues, branch: state.inProgress.branch ?? null } : null,
    usage: { questions: state.usage.questions, inputTokens: state.usage.inputTokens },
    canKickoff: typeof agent?.followup === 'function',
  }
}

function fail(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } }
}

export function createRpcHandler(deps: RpcDeps) {
  const { runtime } = deps

  async function resolve(p: Payload): Promise<{ repo: string; agent: AgentLike | undefined }> {
    const agent = findAgent(deps, str(p.sessionId))
    const explicit = str(p.repo)
    if (explicit) return { repo: await runtime.resolveRepoFor(agent, explicit), agent }
    // Session cwd wins; fall back to the cwd the sidebar reported.
    const cwd = (agent ? runtime.deps.cwdOf(agent) : undefined) ?? str(p.cwd)
    if (!cwd) throw new RpcError('no-cwd', 'セッションの作業ディレクトリがわかりません。リポジトリのフォルダでセッションを開いてください。')
    return { repo: await runtime.resolveRepoAt(cwd), agent }
  }

  const handlers: Record<string, (p: Payload, signal?: AbortSignal) => Promise<unknown>> = {
    async plan(p, signal) {
      const { repo, agent } = await resolve(p)
      const { state, plan } = await runtime.ensurePlan(repo, { signal })
      return view(state, plan, agent)
    },
    async sync(p, signal) {
      const { repo, agent } = await resolve(p)
      const res = await runtime.deps.sync.sync(repo, { full: p.full === true, signal })
      return { ...view(res.state, res.plan, agent), synced: { fetched: res.fetched, changed: res.changed.length, closed: res.closed.length, unchanged: res.unchanged } }
    },
    async override(p, signal) {
      const { repo, agent } = await resolve(p)
      const issue = Number(p.issue)
      const action = p.action
      if (!Number.isInteger(issue) || issue <= 0) throw new RpcError('bad-request', 'issue must be a positive integer')
      if (action !== 'defer' && action !== 'pin' && action !== 'clear') throw new RpcError('bad-request', 'action must be defer | pin | clear')
      const { state, plan } = await runtime.mutate(repo, (s) => runtime.setOverride(s, issue, action), signal)
      return view(state, plan, agent)
    },
    async done(p, signal) {
      const { repo, agent } = await resolve(p)
      const { state, plan } = await runtime.mutate(repo, (s) => runtime.setInProgress(s, null), signal)
      return view(state, plan, agent)
    },
    async next(p, signal) {
      const { repo, agent } = await resolve(p)
      if (typeof agent?.followup !== 'function') {
        throw new RpcError('no-session', 'このセッションのエージェントが見つかりません。チャット欄で /issues next を実行してください。')
      }
      const { state, plan } = await runtime.ensurePlan(repo, { signal })
      const id = str(p.packageId)
      const pkg = id ? plan.workPackages.find((x) => x.id === id) : nextPackage(plan)
      if (!pkg) throw new RpcError('not-found', id ? `パッケージ ${id} が見つかりません。` : '着手可能なパッケージがありません。')
      agent.followup(userMessage(renderKickoff(plan, pkg, state.issues)))
      return { packageId: pkg.id, issues: pkg.issues }
    },
  }

  return async function dispatch(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult> {
    const handler = Object.prototype.hasOwnProperty.call(handlers, endpoint) ? handlers[endpoint] : undefined
    if (!handler) return fail('bad-request', `unknown endpoint ${endpoint}`)
    try {
      const p = payload && typeof payload === 'object' ? (payload as Payload) : {}
      return { ok: true, value: await handler(p, signal) }
    } catch (error) {
      if (error instanceof RpcError) return fail(error.code, error.message)
      return fail('failed', error instanceof Error ? error.message : String(error))
    }
  }
}

class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
