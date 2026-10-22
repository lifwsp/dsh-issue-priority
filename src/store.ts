/**
 * Local persistence (design §6): one JSON file per repository, never committed
 * to the repository itself. Writes are atomic (tmp + rename).
 */
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PlanOutcome } from './outcomes.js'
import type { Dismissal, FinishedMark } from './progress.js'
import type { IssueRecord, LocalDependency, LocalScan, Override, Plan, StoredPull, UsageTotals } from './types.js'

export const STORE_SCHEMA = 1

export interface RepoState {
  schema: typeof STORE_SCHEMA
  repo: string
  /** Start point for the next incremental fetch (server `updated_at` watermark). */
  syncedUntil: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
  issues: Record<string, IssueRecord>
  overrides: Override[]
  localDependencies: LocalDependency[]
  inProgress: { issues: number[]; branch?: string; startedAt: string } | null
  /** Issues marked finished (finish / done) that are still open: awaiting close. */
  finished: FinishedMark[]
  /** Detected "awaiting close" evidence the user said is not done yet. */
  dismissed: Dismissal[]
  /** PRs (open, or merged recently) that point at issues. */
  pulls: StoredPull[]
  pullsSyncedAt: string | null
  /** Last scan of the local clone's branches (path is reused by the background timer). */
  local: LocalScan | null
  /** Area vocabulary seen in blocks + registered by issue_draft. */
  areas: string[]
  /** Decision-model answer cache, keyed by input hash. */
  judgments: Record<string, { value: unknown; at: string }>
  plan: Plan | null
  usage: UsageTotals & { since: string }
  /** What happened to the recommendations (adopted / reordered / regrouped / split), capped. */
  outcomes: PlanOutcome[]
}

function dshHome(): string {
  return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
}

export function defaultDataDir(): string {
  return join(dshHome(), 'data', 'dsh-work-planner')
}

/** Where this plugin stored its plans while it was called dsh-issue-priority (≤ 0.5). */
export function legacyDataDir(): string {
  return join(dshHome(), 'data', 'dsh-issue-priority')
}

/**
 * One-time carry-over after the rename: when the new directory does not exist
 * yet, copy the old one (copy, not move, so downgrading still finds its data).
 * Returns true when something was copied.
 */
export async function migrateLegacyDataDir(target: string, legacy = legacyDataDir()): Promise<boolean> {
  if (target === legacy) return false
  const exists = (p: string) => stat(p).then(() => true, () => false)
  if ((await exists(target)) || !(await exists(legacy))) return false
  await mkdir(dirname(target), { recursive: true })
  await cp(legacy, target, { recursive: true, errorOnExist: false, force: false })
  return true
}

export function stateFilePath(dataDir: string, repo: string): string {
  return join(dataDir, `${repo.replace('/', '__').toLowerCase()}.json`)
}

export function emptyState(repo: string, now = new Date()): RepoState {
  return {
    schema: STORE_SCHEMA,
    repo,
    syncedUntil: null,
    lastSyncAt: null,
    lastSyncError: null,
    issues: {},
    overrides: [],
    localDependencies: [],
    inProgress: null,
    finished: [],
    dismissed: [],
    pulls: [],
    pullsSyncedAt: null,
    local: null,
    areas: [],
    judgments: {},
    plan: null,
    usage: { requests: 0, questions: 0, inputTokens: 0, since: now.toISOString() },
    outcomes: [],
  }
}

export interface StateStore {
  load(repo: string): Promise<RepoState>
  save(state: RepoState): Promise<void>
  /** Repositories with stored state (so the timer resumes after a restart). */
  listRepos(): Promise<string[]>
}

/** Prune judgment cache to the most recent N entries to bound file growth. */
function pruneJudgments(state: RepoState, max: number): void {
  const entries = Object.entries(state.judgments)
  if (entries.length <= max) return
  entries.sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
  state.judgments = Object.fromEntries(entries.slice(0, max))
}

export function createFileStore(dataDir: string, maxJudgments = 2000, ready: Promise<unknown> = Promise.resolve()): StateStore {
  // Serialize writes per file so a timer sync and a tool call cannot interleave.
  const queues = new Map<string, Promise<void>>()
  // A failed one-time preparation (legacy carry-over) must not wedge the store.
  const prepared = ready.catch(() => undefined)
  return {
    async load(repo) {
      await prepared
      const path = stateFilePath(dataDir, repo)
      try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<RepoState>
        if (raw.schema !== STORE_SCHEMA || raw.repo?.toLowerCase() !== repo.toLowerCase()) return emptyState(repo)
        return { ...emptyState(repo), ...raw, repo } as RepoState
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState(repo)
        // Corrupt file: start over rather than wedging the plugin.
        return emptyState(repo)
      }
    },
    async listRepos() {
      await prepared
      let names: string[]
      try {
        names = await readdir(dataDir)
      } catch {
        return []
      }
      const repos: string[] = []
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        try {
          const raw = JSON.parse(await readFile(join(dataDir, name), 'utf8')) as Partial<RepoState>
          if (raw.schema === STORE_SCHEMA && typeof raw.repo === 'string') repos.push(raw.repo)
        } catch {
          // skip unreadable files
        }
      }
      return repos
    },
    save(state) {
      const path = stateFilePath(dataDir, state.repo)
      pruneJudgments(state, maxJudgments)
      const json = `${JSON.stringify(state, null, 2)}\n`
      const run = async () => {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
        await writeFile(tmp, json, 'utf8')
        await rename(tmp, path)
      }
      const prev = queues.get(path) ?? prepared
      const next = prev.then(run, run)
      queues.set(path, next.catch(() => undefined))
      return next
    },
  }
}

/** In-memory store for tests. */
export function createMemoryStore(): StateStore & { states: Map<string, RepoState> } {
  const states = new Map<string, RepoState>()
  return {
    states,
    async load(repo) {
      const s = states.get(repo.toLowerCase())
      return s ? structuredClone(s) : emptyState(repo)
    },
    async listRepos() {
      return [...states.values()].map((s) => s.repo)
    },
    async save(state) {
      states.set(state.repo.toLowerCase(), structuredClone(state))
    },
  }
}
