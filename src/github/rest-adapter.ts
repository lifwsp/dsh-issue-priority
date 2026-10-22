import { GitHubAdapterError, type FetchedIssue, type GitHubIssueSource, type ListIssuesSinceOptions } from './adapter.js'

const DEFAULT_API_BASE = 'https://api.github.com'
const USER_AGENT = 'dsh-issue-priority/0.4.0'
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
  comments: number
  pull_request?: unknown
  state: string
  closed_at?: string | null
  issue_dependencies_summary?: { blocked_by?: number; total_blocked_by?: number; blocking?: number }
}

interface GhDependencyRaw {
  number?: number
  state?: string
  repository_url?: string
}

interface GhCommentRaw {
  body?: string
  user?: { login?: string }
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
    this.maxCommentPages = options.maxCommentPages ?? 1
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
        htmlUrl: raw.html_url,
        state: raw.state === 'closed' ? 'closed' : 'open',
        labels: (raw.labels ?? [])
          .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
          .filter(Boolean),
        updatedAt: raw.updated_at,
        closedAt: raw.closed_at ?? null,
        nativeBlockedBy,
        comments,
      } satisfies FetchedIssue
    })
  }

  private async fetchCommentBodies(
    owner: string,
    name: string,
    issueNumber: number,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const bodies: string[] = []
    for (let page = 1; page <= this.maxCommentPages; page += 1) {
      const batch = (await this.request<GhCommentRaw[]>(
        'GET',
        `/repos/${owner}/${name}/issues/${issueNumber}/comments`,
        { query: { per_page: '30', page: String(page) }, signal },
      )) ?? []
      for (const c of batch) {
        if (c.body) bodies.push(c.body)
      }
      if (batch.length < 30) break
    }
    return bodies
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
