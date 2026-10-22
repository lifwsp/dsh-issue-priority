/**
 * Sync service: incremental GitHub fetch → local snapshot → plan rebuild.
 * No LLM is involved; the decision model is only asked about changed inputs
 * (answers are cached by input hash in the repo state).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PLANNER_VERSION } from './plan/planner.js'
import { createJudge, type Judge, type JudgmentStore } from './decision/judge.js'
import type { DecisionClient } from './decision/client.js'
import type { FetchedIssue, GitHubIssueSource } from './github/adapter.js'
import { parseDependencies } from './github/dependencies.js'
import { repoFromRemoteUrl, resolveRepo } from './github/rest-adapter.js'
import type { Logger } from './log.js'
import { parsePlanBlock, stripPlanBlock } from './plan-block.js'
import { buildPlan } from './plan/planner.js'
import type { RepoState, StateStore } from './store.js'
import type { IssueRecord, Plan } from './types.js'

const execFileAsync = promisify(execFile)
const MENTION_RE = /(?:^|[^\w/&])#(\d+)\b/g

export interface SyncSettings {
  maxIssues: number
  maxQuestionsPerSync: number
  mergeThreshold: number
  actionableThreshold: number
  directionThreshold: number
  similarityThreshold?: number
  maxPackageSize: number
}

export interface SyncDeps {
  github: () => GitHubIssueSource | Promise<GitHubIssueSource>
  decision: () => DecisionClient | null | Promise<DecisionClient | null>
  store: StateStore
  logger: Logger
  settings: () => SyncSettings
  now?: () => Date
}

export interface SyncResult {
  state: RepoState
  plan: Plan
  fetched: number
  changed: number[]
  closed: number[]
  /** True when nothing changed on GitHub and no replan was required. */
  unchanged: boolean
}

export function toIssueRecord(raw: FetchedIssue): IssueRecord {
  const parsed = parsePlanBlock(raw.body)
  const body = stripPlanBlock(raw.body)
  const deps = parseDependencies([body, ...raw.comments])
  const mentions = new Set<number>()
  for (const m of body.matchAll(MENTION_RE)) {
    const n = Number(m[1])
    if (n !== raw.number) mentions.add(n)
  }
  return {
    number: raw.number,
    title: raw.title,
    body: body.slice(0, 4000),
    htmlUrl: raw.htmlUrl,
    state: raw.state,
    labels: raw.labels,
    updatedAt: raw.updatedAt,
    closedAt: raw.closedAt,
    block: parsed.found && parsed.ok ? parsed.block : null,
    ...(parsed.found && !parsed.ok ? { blockError: parsed.errors.join('; ') } : {}),
    nativeBlockedBy: [...new Set(raw.nativeBlockedBy)].sort((a, b) => a - b),
    textBlockedBy: deps.blockedBy.filter((n) => n !== raw.number),
    mentions: [...mentions].sort((a, b) => a - b),
  }
}

/** `owner/repo` from the git remote of a directory (origin first, then any GitHub remote). */
export async function detectRepo(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'remote', '-v'], { timeout: 5000 })
    const lines = stdout.split('\n').filter(Boolean)
    const ordered = [...lines.filter((l) => l.startsWith('origin\t')), ...lines.filter((l) => !l.startsWith('origin\t'))]
    for (const line of ordered) {
      const url = line.split(/\s+/)[1]
      const repo = url ? repoFromRemoteUrl(url) : null
      if (repo) return repo
    }
    return null
  } catch {
    return null
  }
}

/** Current git branch of a directory, or null. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 })
    const b = stdout.trim()
    return b && b !== 'HEAD' ? b : null
  } catch {
    return null
  }
}

function judgmentStore(state: RepoState, now: () => Date): JudgmentStore {
  return {
    get: (key) => state.judgments[key]?.value,
    set: (key, value) => {
      state.judgments[key] = { value, at: now().toISOString() }
    },
  }
}

function collectAreas(state: RepoState): void {
  const set = new Set(state.areas)
  for (const i of Object.values(state.issues)) for (const a of i.block?.areas ?? []) set.add(a)
  state.areas = [...set].sort()
}

export class SyncService {
  private readonly running = new Map<string, Promise<SyncResult>>()
  private readonly now: () => Date

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Coalesce concurrent syncs of the same repo (timer + command). */
  sync(repo: string, options: { full?: boolean; signal?: AbortSignal } = {}): Promise<SyncResult> {
    const key = resolveRepo(repo).toLowerCase()
    const existing = this.running.get(key)
    if (existing) return existing
    const p = this.run(resolveRepo(repo), options).finally(() => this.running.delete(key))
    this.running.set(key, p)
    return p
  }

  /** Rebuild the plan from the local snapshot without touching GitHub. */
  async replan(state: RepoState, signal?: AbortSignal, closedSinceLast: number[] = []): Promise<Plan> {
    const settings = this.deps.settings()
    const judge: Judge = createJudge(await this.deps.decision(), judgmentStore(state, this.now))
    const plan = await buildPlan({
      repo: state.repo,
      issues: Object.values(state.issues),
      overrides: state.overrides,
      localDependencies: state.localDependencies,
      inProgress: state.inProgress?.issues ?? [],
      areas: state.areas,
      judge,
      previous: state.plan,
      closedSinceLast,
      mergeThreshold: settings.mergeThreshold,
      actionableThreshold: settings.actionableThreshold,
      directionThreshold: settings.directionThreshold,
      ...(settings.similarityThreshold !== undefined ? { similarityThreshold: settings.similarityThreshold } : {}),
      maxPackageSize: settings.maxPackageSize,
      maxQuestions: settings.maxQuestionsPerSync,
      now: this.now,
      signal,
    })
    state.usage.requests += judge.usage.requests
    state.usage.questions += judge.usage.questions
    state.usage.inputTokens += judge.usage.inputTokens
    state.plan = plan
    return plan
  }

  private async run(repo: string, options: { full?: boolean; signal?: AbortSignal }): Promise<SyncResult> {
    const { store, logger } = this.deps
    const settings = this.deps.settings()
    const state = await store.load(repo)
    const since = options.full ? undefined : (state.syncedUntil ?? undefined)

    let fetched: FetchedIssue[]
    try {
      fetched = await (await this.deps.github()).listIssuesSince({
        repo,
        since,
        maxIssues: settings.maxIssues,
        signal: options.signal,
      })
    } catch (error) {
      state.lastSyncError = error instanceof Error ? error.message : String(error)
      state.lastSyncAt = this.now().toISOString()
      await store.save(state)
      throw error
    }

    const changed: number[] = []
    const closed: number[] = []
    if (!since) {
      // Full fetch returns open issues only: anything we knew that is absent is gone.
      const seen = new Set(fetched.map((f) => f.number))
      for (const key of Object.keys(state.issues)) {
        if (!seen.has(Number(key))) {
          closed.push(Number(key))
          delete state.issues[key]
        }
      }
    }
    let watermark = state.syncedUntil
    for (const raw of fetched) {
      if (!watermark || raw.updatedAt > watermark) watermark = raw.updatedAt
      const key = String(raw.number)
      const prev = state.issues[key]
      if (raw.state === 'closed') {
        if (prev) {
          closed.push(raw.number)
          delete state.issues[key]
        }
        continue
      }
      if (prev && prev.updatedAt === raw.updatedAt) continue
      state.issues[key] = toIssueRecord(raw)
      changed.push(raw.number)
    }

    if (closed.length) {
      const gone = new Set(closed)
      state.overrides = state.overrides.filter((o) => !gone.has(o.issue))
      state.localDependencies = state.localDependencies.filter((d) => !gone.has(d.issue))
      if (state.inProgress) {
        const left = state.inProgress.issues.filter((n) => !gone.has(n))
        state.inProgress = left.length ? { ...state.inProgress, issues: left } : null
      }
    }

    state.syncedUntil = watermark
    state.lastSyncAt = this.now().toISOString()
    state.lastSyncError = null
    collectAreas(state)

    const stalePlan = state.plan !== null && state.plan.plannerVersion !== PLANNER_VERSION
    const unchanged = !changed.length && !closed.length && state.plan !== null && !options.full && !stalePlan
    const plan = unchanged ? state.plan! : await this.replan(state, options.signal, closed)
    await store.save(state)
    logger.info('sync complete', {
      repo,
      fetched: fetched.length,
      changed: changed.length,
      closed: closed.length,
      asked: unchanged ? 0 : plan.decision.asked,
    })
    return { state, plan, fetched: fetched.length, changed, closed: closed.sort((a, b) => a - b), unchanged }
  }
}
