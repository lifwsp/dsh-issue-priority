import { describe, expect, it, vi, afterEach } from 'vitest'
import { RestGitHubAdapter, resolveRepo } from '../src/github/rest-adapter.js'
import { GitHubAdapterError } from '../src/github/adapter.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveRepo', () => {
  it('accepts owner/repo and URLs', () => {
    expect(resolveRepo('acme/app')).toBe('acme/app')
    expect(resolveRepo('https://github.com/acme/app')).toBe('acme/app')
  })

  it('rejects invalid names', () => {
    expect(() => resolveRepo('nope')).toThrow(GitHubAdapterError)
  })
})

describe('RestGitHubAdapter', () => {
  it('skips pull requests and maps issues', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/issues?') || url.includes('/issues&') || /\/issues\?/.test(url) || url.includes('state=open')) {
        return new Response(
          JSON.stringify([
            {
              number: 1,
              title: 'Real issue',
              body: 'blocked by #2',
              html_url: 'https://github.com/o/r/issues/1',
              url: 'https://api.github.com/repos/o/r/issues/1',
              labels: [{ name: 'bug' }],
              milestone: null,
              assignees: [],
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              comments: 0,
              state: 'open',
            },
            {
              number: 9,
              title: 'A PR',
              body: '',
              html_url: 'https://github.com/o/r/pull/9',
              url: 'https://api.github.com/repos/o/r/issues/9',
              labels: [],
              milestone: null,
              assignees: [],
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              comments: 0,
              state: 'open',
              pull_request: { url: 'https://api.github.com/repos/o/r/pulls/9' },
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/comments')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (url.includes('/timeline')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new RestGitHubAdapter({ token: 'test-token' })
    const issues = await adapter.listOpenIssues({ repo: 'o/r', limit: 10 })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.number).toBe(1)
    expect(issues[0]?.blockedBy).toEqual([2])
    expect(adapter.getUsedMethods()).toEqual(['GET'])
  })

  it('surfaces rate limit errors after retries exhausted', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '0', 'x-ratelimit-remaining': '0' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = new RestGitHubAdapter({ maxRetries: 0 })
    await expect(adapter.listOpenIssues({ repo: 'o/r', limit: 1 })).rejects.toMatchObject({
      code: 'rate_limit',
    })
  })

  it('refuses mutating methods (read-only guarantee)', async () => {
    const adapter = new RestGitHubAdapter()
    // Access private request via casting for the invariant test.
    const anyAdapter = adapter as unknown as {
      request: (method: string, path: string) => Promise<unknown>
    }
    await expect(anyAdapter.request('POST', '/repos/o/r/issues')).rejects.toMatchObject({
      code: 'invalid',
    })
  })
})
