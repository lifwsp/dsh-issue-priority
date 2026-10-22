import type { GitHubIssue } from '../types.js'

export interface ListIssuesOptions {
  repo: string
  limit: number
  labels?: string[]
  signal?: AbortSignal
}

/**
 * GitHub access seam. MVP uses REST; MCP (or gh CLI) can implement the same
 * interface without changing ranking / evaluation code.
 */
export interface GitHubIssueAdapter {
  readonly id: string
  listOpenIssues(options: ListIssuesOptions): Promise<GitHubIssue[]>
}

export class GitHubAdapterError extends Error {
  readonly code: 'auth' | 'rate_limit' | 'not_found' | 'network' | 'invalid' | 'upstream'
  readonly status?: number

  constructor(message: string, code: GitHubAdapterError['code'], status?: number) {
    super(message)
    this.name = 'GitHubAdapterError'
    this.code = code
    this.status = status
  }
}
