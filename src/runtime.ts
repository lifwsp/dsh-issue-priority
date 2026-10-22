/**
 * Glue shared by tools, commands and the timer: repository resolution,
 * state mutations (overrides / local deps / in-progress) and replanning.
 */
import { resolveRepo } from './github/rest-adapter.js'
import type { Logger } from './log.js'
import type { RepoState, StateStore } from './store.js'
import { currentBranch, detectRepo, type SyncResult, type SyncService } from './sync.js'
import type { Plan } from './types.js'

export interface RuntimeDeps {
  store: StateStore
  sync: SyncService
  logger: Logger
  /** Working directory of the calling session, when known. */
  cwdOf: (agent: unknown) => string | undefined
  /** Why the decision model is unavailable (for user-facing notes), if it is. */
  decisionStatus: () => Promise<string | undefined>
  now?: () => Date
}

export class IssuePlanRuntime {
  /** Repos seen by this process; the timer syncs these. */
  readonly knownRepos = new Set<string>()
  private readonly now: () => Date

  constructor(readonly deps: RuntimeDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async resolveRepoFor(agent: unknown, explicit?: string): Promise<string> {
    if (explicit?.trim()) {
      const repo = resolveRepo(explicit.trim())
      this.knownRepos.add(repo)
      return repo
    }
    return this.resolveRepoAt(this.deps.cwdOf(agent) ?? process.cwd())
  }

  /** Resolve the GitHub repo of a directory (e.g. the cwd the sidebar reports). */
  async resolveRepoAt(cwd: string): Promise<string> {
    const repo = await detectRepo(cwd)
    if (!repo) {
      throw new Error(
        `作業ディレクトリ ${cwd} から GitHub リポジトリを特定できませんでした（git remote が GitHub ではない）。repo を owner/name で指定してください。`,
      )
    }
    this.knownRepos.add(repo)
    return repo
  }

  async branchFor(agent: unknown): Promise<string | null> {
    return currentBranch(this.deps.cwdOf(agent) ?? process.cwd())
  }

  /** Sync if never synced or older than maxAgeMs, else return the stored plan. */
  async ensurePlan(repo: string, options: { maxAgeMs?: number; force?: boolean; signal?: AbortSignal } = {}): Promise<{ state: RepoState; plan: Plan; synced: SyncResult | null }> {
    const state = await this.deps.store.load(repo)
    const age = state.lastSyncAt ? this.now().getTime() - Date.parse(state.lastSyncAt) : Infinity
    if (options.force || !state.plan || age > (options.maxAgeMs ?? 5 * 60_000)) {
      try {
        const res = await this.deps.sync.sync(repo, { signal: options.signal })
        return { state: res.state, plan: res.plan, synced: res }
      } catch (error) {
        if (!state.plan) throw error
        this.deps.logger.warn('sync failed; using stored plan', { repo, error: String(error) })
        const fresh = await this.deps.store.load(repo)
        return { state: fresh, plan: fresh.plan!, synced: null }
      }
    }
    return { state, plan: state.plan, synced: null }
  }

  /** Apply a mutation to local state and rebuild the plan (no GitHub fetch). */
  async mutate(repo: string, fn: (state: RepoState) => void, signal?: AbortSignal): Promise<{ state: RepoState; plan: Plan }> {
    const state = await this.deps.store.load(repo)
    fn(state)
    const plan = await this.deps.sync.replan(state, signal)
    await this.deps.store.save(state)
    return { state, plan }
  }

  setOverride(state: RepoState, issue: number, action: 'defer' | 'pin' | 'clear'): void {
    state.overrides = state.overrides.filter((o) => o.issue !== issue)
    if (action !== 'clear') state.overrides.push({ issue, action, at: this.now().toISOString() })
  }

  addDependency(state: RepoState, issue: number, dependsOn: number, note?: string): void {
    if (issue === dependsOn) throw new Error('自分自身には依存できません。')
    state.localDependencies = state.localDependencies.filter((d) => !(d.issue === issue && d.dependsOn === dependsOn))
    state.localDependencies.push({ issue, dependsOn, at: this.now().toISOString(), ...(note ? { note } : {}) })
  }

  removeDependency(state: RepoState, issue: number, dependsOn: number): void {
    state.localDependencies = state.localDependencies.filter((d) => !(d.issue === issue && d.dependsOn === dependsOn))
  }

  setInProgress(state: RepoState, issues: number[] | null, branch?: string | null): void {
    state.inProgress = issues && issues.length
      ? { issues: [...new Set(issues)].sort((a, b) => a - b), ...(branch ? { branch } : {}), startedAt: this.now().toISOString() }
      : null
  }
}
