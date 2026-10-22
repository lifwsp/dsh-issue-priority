import { describe, expect, it, vi } from 'vitest'
import { prioritizeIssues } from '../src/pipeline.js'
import { createMemoryCache } from '../src/cache/evaluation-cache.js'
import { defaultRankingPolicy } from '../src/ranking/policy.js'
import { createLogger } from '../src/log.js'
import type { GitHubIssueAdapter } from '../src/github/adapter.js'
import type { DecisionEvaluator } from '../src/decision/evaluator.js'
import { issue, judgment } from './fixtures.js'

describe('prioritizeIssues pipeline', () => {
  const issues = [
    issue({ number: 1, title: 'High impact', updatedAt: '2026-01-01T00:00:00Z' }),
    issue({ number: 2, title: 'Blocked', body: 'blocked by #1', blockedBy: [1], updatedAt: '2026-01-01T00:00:00Z' }),
  ]

  const github: GitHubIssueAdapter = {
    id: 'mock-gh',
    listOpenIssues: vi.fn(async () => issues),
  }

  const evaluator: DecisionEvaluator = {
    kind: 'jev',
    providerId: 'mock',
    transmitting: false,
    modelId: 'mock',
    evaluateIssues: vi.fn(async () => [
      judgment(1, { impact: 0.9, urgency: 0.5, unblockValue: 0.5, effort: 0.2 }, { synthetic: true, provider: 'mock' }),
      judgment(2, { impact: 0.95, urgency: 0.9, unblockValue: 0.9, effort: 0.1 }, { synthetic: true, provider: 'mock' }),
    ]),
  }

  it('returns ranked issues and distinguishes synthetic judgments', async () => {
    const result = await prioritizeIssues(
      { repo: 'o/r', objective: 'Ship MVP' },
      {
        github,
        evaluator,
        cache: createMemoryCache(),
        policy: defaultRankingPolicy(),
        logger: createLogger(console, 'silent'),
        defaultLimit: 20,
      },
    )
    expect(result.summary.total).toBe(2)
    expect(result.summary.syntheticCount).toBe(2)
    expect(result.issues.find((i) => i.number === 2)?.status).toBe('blocked')
    expect(result.evaluator.kind).toBe('jev')
    expect(result.rankingPolicy.version).toBeTruthy()
  })

  it('uses cache unless forceRefresh', async () => {
    const cache = createMemoryCache()
    const deps = {
      github,
      evaluator,
      cache,
      policy: defaultRankingPolicy(),
      logger: createLogger(console, 'silent'),
      defaultLimit: 20,
    }
    const evaluate = evaluator.evaluateIssues as ReturnType<typeof vi.fn>
    evaluate.mockClear()
    await prioritizeIssues({ repo: 'o/r', objective: 'Ship MVP' }, deps)
    await prioritizeIssues({ repo: 'o/r', objective: 'Ship MVP' }, deps)
    expect(evaluate).toHaveBeenCalledTimes(1)
    await prioritizeIssues({ repo: 'o/r', objective: 'Ship MVP', forceRefresh: true }, deps)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('propagates GitHub failures', async () => {
    const failing: GitHubIssueAdapter = {
      id: 'mock-gh',
      listOpenIssues: async () => {
        throw Object.assign(new Error('boom'), { code: 'rate_limit' })
      },
    }
    await expect(
      prioritizeIssues(
        { repo: 'o/r', objective: 'MVP' },
        {
          github: failing,
          evaluator,
          cache: createMemoryCache(),
          policy: defaultRankingPolicy(),
          logger: createLogger(console, 'silent'),
          defaultLimit: 20,
        },
      ),
    ).rejects.toThrow(/boom/)
  })
})
