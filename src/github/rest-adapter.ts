import {
  GitHubAdapterError,
  type FetchedIssue,
  type FetchedPull,
  type IssueComment,
  type GitHubIssueSource,
  type ListIssuesSinceOptions,
  type ListPullsOptions,
} from './adapter.js'
import type { NativeMeta } from '../types.js'

const DEFAULT_API_BASE = 'https://api.github.com'
const USER_AGENT = 'dsh-work-planner/0.6.0'
const RETRYABLE = new Set([403, 429])

export interface RestGitHubAdapterOptions {
  token?: string
  baseUrl?: string
  maxRetries?: number
  maxCommentPages?: number
  /** Hard cap on concurrent detail fetches (comments / timeline). */
  concurrency?: number
}

interface GhIssueRaw {
  number: number
  title: string
  body: string | null
  html_url: string
  url: string
  labels: Array<{ name?: string; color?: string } | string>
  milestone: { title: string; state?: string; due_on?: string | null } | null
  assignees: Array<{ login: string }>
  created_at: string
  updated_at: string
  user?: { login?: string }
  comments: number
  pull_request?: unknown
  state: string
  closed_at?: string | null
  issue_dependencies_summary?: { blocked_by?: number; total_blocked_by?: number; blocking?: number }
  sub_issues_summary?: { total?: number; completed?: number }
  parent_issue_url?: string | null
  issue_field_values?: GhFieldValueRaw[]
}

interface GhFieldValueRaw {
  issue_field_name?: string
  data_type?: string
  value?: unknown
  single_select_option?: { name?: string } | null
}

/** GitHub-native planning metadata from one list item (pure; no request). */
export function nativeMeta(raw: Pick<GhIssueRaw, 'milestone' | 'sub_issues_summary' | 'parent_issue_url' | 'issue_field_values' | 'url'>): NativeMeta | undefined {
  const out: NativeMeta = {}
  for (const f of raw.issue_field_values ?? []) {
    const name = f.issue_field_name?.trim().toLowerCase()
    const value = f.single_select_option?.name ?? (typeof f.value === 'string' || typeof f.value === 'number' ? f.value : undefined)
    if (value === undefined || value === '') continue
    if (name === 'priority') out.priority = String(value)
    else if (name === 'effort' || name === 'size' || name === 'estimate') out.effort = value
  }
  // Same-repo parents only: `.../repos/{owner}/{repo}/issues/{n}`.
  const parent = raw.parent_issue_url?.match(/\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/)
  const self = raw.url?.match(/\/repos\/([^/]+\/[^/]+)\/issues\/\d+$/)
  if (parent && (!self || self[1]!.toLowerCase() === parent[1]!.toLowerCase())) out.parent = Number(parent[2])
  const total = raw.sub_issues_summary?.total ?? 0
  if (total > 0) out.subIssues = { total, completed: raw.sub_issues_summary?.completed ?? 0 }
  if (raw.milestone?.title) out.milestone = { title: raw.milestone.title, ...(raw.milestone.due_on ? { dueOn: raw.milestone.due_on } : {}) }
  return Object.keys(out).length ? out : undefined
}

interface GhDependencyRaw {
  number?: number
  state?: string
  repository_url?: string
}

interface GhPullRaw {
  number: number
  title?: string
  body?: string | null
  html_url: string
  state: string
  draft?: boolean
  merged_at?: string | null
  updated_at: string
  head?: { ref?: string }
  base?: { ref?: string }
}

interface GhCommentRaw {
  body?: string
  user?: { login?: string; type?: string }
  created_at?: string
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('aborted'))
      },
      { once: true },
    )
  })
}

function headerNumber(response: Response, name: string): number | null {
  const raw = response.headers.get(name)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = headerNumber(response, 'retry-after')
  if (retryAfter != null && retryAfter >= 0) return retryAfter * 1000
  const reset = headerNumber(response, 'x-ratelimit-reset')
  if (reset != null) return Math.max(0, reset * 1000 - Date.now())
  return Math.min(30_000, 1000 * 2 ** attempt)
}

export function resolveRepo(input: string): string {
  const raw = input.trim()
  const urlMatch = raw.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?\/?$/)
  const value = urlMatch ? urlMatch[1]! : raw
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new GitHubAdapterError(`Invalid repo "${input}": expected "owner/name".`, 'invalid')
  }
  return value
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
    while (next < items.length) {
      const i = next
      next += 1
      results[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

export class RestGitHubAdapter implements GitHubIssueSource {
  readonly id = 'github-rest'
  private readonly token?: string
  private readonly baseUrl: string
  private readonly maxRetries: number
  private readonly maxCommentPages: number
  private readonly concurrency: number
  /** Tracks whether any mutating HTTP method was attempted (read-only guarantee). */
  private readonly methodsUsed = new Set<string>()

  constructor(options: RestGitHubAdapterOptions = {}) {
    this.token = options.token
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE).replace(/\/$/, '')
    this.maxRetries = options.maxRetries ?? 3
    this.maxCommentPages = options.maxCommentPages ?? 3
    this.concurrency = options.concurrency ?? 4
  }

  getUsedMethods(): readonly string[] {
    return [...this.methodsUsed]
  }

  /**
   * Initial sync (no `since`): all open issues. Incremental sync: every issue
   * (open or closed) updated since the timestamp, so closures are observed.
   * Pull requests are skipped. Comments and native dependencies are fetched
   * only when the list payload says they exist.
   */
  async listIssuesSince(options: ListIssuesSinceOptions): Promise<FetchedIssue[]> {
    const repo = resolveRepo(options.repo)
    const [owner, name] = repo.split('/') as [string, string]
    const cap = Math.max(1, options.maxIssues)
    const collected: GhIssueRaw[] = []
    for (let page = 1; collected.length < cap; page += 1) {
      const batch =
        (await this.request<GhIssueRaw[]>('GET', `/repos/${owner}/${name}/issues`, {
          query: {
            state: options.since ? 'all' : 'open',
            per_page: '100',
            page: String(page),
            sort: 'updated',
            direction: 'desc',
            ...(options.since ? { since: options.since } : {}),
          },
          signal: options.signal,
        })) ?? []
      for (const item of batch) {
        if (item.pull_request !== undefined) continue
        collected.push(item)
        if (collected.length >= cap) break
      }
      if (batch.length < 100) break
    }

    return mapPool(collected, this.concurrency, async (raw) => {
      const comments =
        (raw.comments ?? 0) > 0 ? await this.fetchCommentBodies(owner, name, raw.number, options.signal) : []
      const summary = raw.issue_dependencies_summary
      const nativeBlockedBy =
        raw.state === 'open' && ((summary?.blocked_by ?? 0) > 0 || (summary?.total_blocked_by ?? 0) > 0)
          ? await this.fetchBlockedBy(owner, name, raw.number, options.signal)
          : []
      return {
        number: raw.number,
        title: raw.title,
        body: raw.body ?? '',
        author: raw.user?.login ?? '',
        createdAt: raw.created_at,
        htmlUrl: raw.html_url,
        state: raw.state === 'closed' ? 'closed' : 'open',
        labels: (raw.labels ?? [])
          .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
          .filter(Boolean),
        updatedAt: raw.updated_at,
        closedAt: raw.closed_at ?? null,
        nativeBlockedBy,
        comments,
        ...(() => {
          const native = nativeMeta(raw)
          return native ? { native } : {}
        })(),
      } satisfies FetchedIssue
    })
  }

  /**
   * Open PRs plus PRs closed since `closedSince` (newest first). Merged PRs
   * that still left an issue open are how "merged into a non-default branch"
   * or "forgot Closes #N" show up.
   */
  async listPulls(options: ListPullsOptions): Promise<FetchedPull[]> {
    const repo = resolveRepo(options.repo)
    const [owner, name] = repo.split('/') as [string, string]
    const cap = Math.max(1, options.maxPulls)
    const out: FetchedPull[] = []
    const take = (raw: GhPullRaw): FetchedPull => ({
      number: raw.number,
      title: raw.title ?? '',
      body: raw.body ?? '',
      htmlUrl: raw.html_url,
      state: raw.state === 'closed' ? 'closed' : 'open',
      draft: raw.draft === true,
      mergedAt: raw.merged_at ?? null,
      head: raw.head?.ref ?? '',
      base: raw.base?.ref ?? '',
      updatedAt: raw.updated_at,
    })
    for (const state of ['open', 'closed'] as const) {
      for (let page = 1; out.length < cap; page += 1) {
        const batch =
          (await this.request<GhPullRaw[]>('GET', `/repos/${owner}/${name}/pulls`, {
            query: { state, sort: 'updated', direction: 'desc', per_page: '100', page: String(page) },
            signal: options.signal,
          })) ?? []
        let older = false
        for (const raw of batch) {
          if (state === 'closed' && raw.updated_at < options.closedSince) {
            older = true
            break
          }
          out.push(take(raw))
          if (out.length >= cap) break
        }
        if (older || batch.length < 100) break
      }
    }
    return out
  }

  private async fetchCommentBodies(
    owner: string,
    name: string,
    issueNumber: number,
    signal?: AbortSignal,
  ): Promise<IssueComment[]> {
    const out: IssueComment[] = []
    for (let page = 1; page <= this.maxCommentPages; page += 1) {
      const batch = (await this.request<GhCommentRaw[]>(
        'GET',
        `/repos/${owner}/${name}/issues/${issueNumber}/comments`,
        { query: { per_page: '100', page: String(page) }, signal },
      )) ?? []
      for (const c of batch) {
        if (!c.body) continue
        const login = c.user?.login ?? ''
        out.push({
          author: login,
          createdAt: c.created_at ?? '',
          body: c.body,
          bot: c.user?.type === 'Bot' || login.endsWith('[bot]'),
        })
      }
      if (batch.length < 100) break
    }
    return out
  }

  /** GitHub issue dependencies (REST, 2025+). Missing feature/permission → []. */
  private async fetchBlockedBy(
    owner: string,
    name: string,
    issueNumber: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    try {
      const items =
        (await this.request<GhDependencyRaw[]>(
          'GET',
          `/repos/${owner}/${name}/issues/${issueNumber}/dependencies/blocked_by`,
          { query: { per_page: '100' }, signal },
        )) ?? []
      const sameRepo = `/repos/${owner}/${name}/`.toLowerCase()
      return items
        .filter((d) => d.state !== 'closed')
        .filter((d) => !d.repository_url || `${d.repository_url}/`.toLowerCase().endsWith(sameRepo))
        .map((d) => d.number)
        .filter((n): n is number => typeof n === 'number' && n !== issueNumber)
    } catch (error) {
      if (signal?.aborted) throw error
      return []
    }
  }

  private async request<T>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string>
      signal?: AbortSignal
      headers?: Record<string, string>
    } = {},
  ): Promise<T | null> {
    this.methodsUsed.add(method.toUpperCase())
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      throw new GitHubAdapterError(
        `Read-only adapter refused mutating method ${method}`,
        'invalid',
      )
    }

    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v)
    }

    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await fetch(url, {
          method,
          signal: options.signal,
          headers: {
            accept: options.headers?.accept ?? 'application/vnd.github+json',
            'user-agent': USER_AGENT,
            'x-github-api-version': '2022-11-28',
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...options.headers,
          },
        })
      } catch (error) {
        if (options.signal?.aborted) throw error
        throw new GitHubAdapterError(
          `GitHub network error: ${error instanceof Error ? error.message : String(error)}`,
          'network',
        )
      }

      if (response.ok) {
        if (response.status === 204) return null
        return (await response.json()) as T
      }

      const remaining = headerNumber(response, 'x-ratelimit-remaining')
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 && (remaining === 0 || response.headers.has('retry-after')))

      if (rateLimited && RETRYABLE.has(response.status) && attempt < this.maxRetries) {
        await sleep(retryDelayMs(response, attempt), options.signal)
        continue
      }

      const bodyText = await response.text().catch(() => '')
      if (response.status === 401 || response.status === 403) {
        throw new GitHubAdapterError(
          `GitHub auth/permission error (${response.status})`,
          rateLimited ? 'rate_limit' : 'auth',
          response.status,
        )
      }
      if (response.status === 404) {
        throw new GitHubAdapterError(`GitHub resource not found: ${path}`, 'not_found', 404)
      }
      if (rateLimited) {
        throw new GitHubAdapterError('GitHub API rate limited', 'rate_limit', response.status)
      }
      throw new GitHubAdapterError(
        `GitHub API error ${response.status}: ${bodyText.slice(0, 200)}`,
        'upstream',
        response.status,
      )
    }
  }
}

/** Parse `owner/repo` from a git remote URL (https or ssh). Returns null for non-GitHub remotes. */
export function repoFromRemoteUrl(remote: string): string | null {
  const raw = remote.trim()
  const m =
    raw.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/i) ??
    raw.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i) ??
    raw.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return m ? m[1]! : null
}
