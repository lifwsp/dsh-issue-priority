import { describe, expect, it } from 'vitest'
import { buildCacheKey, createMemoryCache } from '../src/cache/evaluation-cache.js'
import { defaultRankingPolicy } from '../src/ranking/policy.js'
import { issue, judgment } from './fixtures.js'

describe('evaluation cache', () => {
  const policy = defaultRankingPolicy()
  const base = {
    repo: 'o/r',
    objective: 'MVP',
    policy,
    evaluatorKind: 'jev',
    providerId: 'mock',
    modelId: 'mock',
  }

  it('hits when inputs are identical', () => {
    const issues = [issue({ number: 1, title: 'a', updatedAt: '2026-01-01T00:00:00Z' })]
    const key1 = buildCacheKey({ ...base, issues })
    const key2 = buildCacheKey({ ...base, issues })
    expect(key1).toBe(key2)

    const cache = createMemoryCache()
    cache.set(key1, [judgment(1, { impact: 0.5 })])
    expect(cache.get(key1)?.judgments).toHaveLength(1)
  })

  it('misses when issue updatedAt changes', () => {
    const a = buildCacheKey({
      ...base,
      issues: [issue({ number: 1, title: 'a', updatedAt: '2026-01-01T00:00:00Z' })],
    })
    const b = buildCacheKey({
      ...base,
      issues: [issue({ number: 1, title: 'a', updatedAt: '2026-01-02T00:00:00Z' })],
    })
    expect(a).not.toBe(b)
  })

  it('misses when model identifier changes', () => {
    const issues = [issue({ number: 1, title: 'a' })]
    const a = buildCacheKey({ ...base, issues, modelId: 'jev-1' })
    const b = buildCacheKey({ ...base, issues, modelId: 'jev-2' })
    expect(a).not.toBe(b)
  })
})
