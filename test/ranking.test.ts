import { describe, expect, it } from 'vitest'
import {
  applyDependencyHints,
  computePriorityScore,
  defaultRankingPolicy,
  rankIssues,
} from '../src/ranking/policy.js'
import { issue, judgment } from './fixtures.js'

describe('computePriorityScore', () => {
  const weights = defaultRankingPolicy().weights

  it('rewards high impact', () => {
    const high = computePriorityScore(
      { impact: 1, urgency: 0.5, unblockValue: 0.5, effort: 0.2 },
      weights,
    )
    const low = computePriorityScore(
      { impact: 0.1, urgency: 0.5, unblockValue: 0.5, effort: 0.2 },
      weights,
    )
    expect(high).toBeGreaterThan(low)
  })

  it('rewards high urgency', () => {
    const high = computePriorityScore(
      { impact: 0.5, urgency: 1, unblockValue: 0.5, effort: 0.2 },
      weights,
    )
    const low = computePriorityScore(
      { impact: 0.5, urgency: 0.1, unblockValue: 0.5, effort: 0.2 },
      weights,
    )
    expect(high).toBeGreaterThan(low)
  })

  it('penalizes high effort', () => {
    const cheap = computePriorityScore(
      { impact: 0.8, urgency: 0.5, unblockValue: 0.5, effort: 0.1 },
      weights,
    )
    const expensive = computePriorityScore(
      { impact: 0.8, urgency: 0.5, unblockValue: 0.5, effort: 0.9 },
      weights,
    )
    expect(cheap).toBeGreaterThan(expensive)
  })

  it('is deterministic for the same inputs', () => {
    const a = computePriorityScore(
      { impact: 0.7, urgency: 0.6, unblockValue: 0.4, effort: 0.3 },
      weights,
    )
    const b = computePriorityScore(
      { impact: 0.7, urgency: 0.6, unblockValue: 0.4, effort: 0.3 },
      weights,
    )
    expect(a).toBe(b)
  })
})

describe('rankIssues', () => {
  const policy = defaultRankingPolicy()

  it('orders higher impact ready issues first', () => {
    const issues = [issue({ number: 1, title: 'low' }), issue({ number: 2, title: 'high' })]
    const judgments = [
      judgment(1, { impact: 0.2, urgency: 0.2, unblockValue: 0.2, effort: 0.2 }),
      judgment(2, { impact: 0.95, urgency: 0.5, unblockValue: 0.5, effort: 0.2 }),
    ]
    const ranked = rankIssues(issues, judgments, policy)
    expect(ranked[0]?.number).toBe(2)
    expect(ranked[0]?.status).toBe('ready')
  })

  it('marks unresolved dependencies as blocked even with high score', () => {
    const issues = [
      issue({ number: 10, title: 'blocked', blockedBy: [11] }),
      issue({ number: 11, title: 'blocker' }),
    ]
    const judgments = [
      judgment(10, { impact: 1, urgency: 1, unblockValue: 1, effort: 0.1 }),
      judgment(11, { impact: 0.4, urgency: 0.4, unblockValue: 0.4, effort: 0.2 }),
    ]
    const ranked = rankIssues(issues, judgments, policy)
    const blocked = ranked.find((r) => r.number === 10)
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.blockedBy).toEqual([11])
  })

  it('puts low confidence into needs_review', () => {
    const issues = [issue({ number: 3, title: 'unsure' })]
    const judgments = [judgment(3, { confidence: 0.2, impact: 0.9 })]
    const ranked = rankIssues(issues, judgments, policy)
    expect(ranked[0]?.status).toBe('needs_review')
  })

  it('does not treat missing scores as high priority', () => {
    const issues = [
      issue({ number: 1, title: 'failed' }),
      issue({ number: 2, title: 'ok' }),
    ]
    const judgments = [judgment(1, null, { failureReason: 'boom' }), judgment(2, { impact: 0.5 })]
    const ranked = rankIssues(issues, judgments, policy)
    expect(ranked[0]?.number).toBe(2)
    expect(ranked.find((r) => r.number === 1)?.status).toBe('needs_review')
    expect(ranked.find((r) => r.number === 1)?.priorityScore).toBeNull()
  })

  it('reproduces the same order for identical inputs', () => {
    const issues = [
      issue({ number: 5, title: 'a' }),
      issue({ number: 6, title: 'b' }),
      issue({ number: 7, title: 'c' }),
    ]
    const judgments = [
      judgment(5, { impact: 0.5, urgency: 0.5, unblockValue: 0.5, effort: 0.5 }),
      judgment(6, { impact: 0.5, urgency: 0.5, unblockValue: 0.5, effort: 0.5 }),
      judgment(7, { impact: 0.8, urgency: 0.2, unblockValue: 0.2, effort: 0.1 }),
    ]
    const a = rankIssues(issues, judgments, policy).map((r) => r.number)
    const b = rankIssues(issues, judgments, policy).map((r) => r.number)
    expect(a).toEqual(b)
  })

  it('stable-sorts equal scores by issue number', () => {
    const issues = [issue({ number: 20, title: 'z' }), issue({ number: 10, title: 'a' })]
    const same = { impact: 0.5, urgency: 0.5, unblockValue: 0.5, effort: 0.5 }
    const ranked = rankIssues(issues, [judgment(20, same), judgment(10, same)], policy)
    expect(ranked.map((r) => r.number)).toEqual([10, 20])
  })
})

describe('applyDependencyHints', () => {
  it('moves dependency before the blocked issue', () => {
    const policy = defaultRankingPolicy()
    const issues = [
      issue({ number: 2, title: 'feature', blockedBy: [1] }),
      issue({ number: 1, title: 'foundation' }),
    ]
    const judgments = [
      judgment(2, { impact: 0.9, urgency: 0.9, unblockValue: 0.9, effort: 0.2 }),
      judgment(1, { impact: 0.5, urgency: 0.5, unblockValue: 0.8, effort: 0.2 }),
    ]
    const ranked = applyDependencyHints(rankIssues(issues, judgments, policy))
    const i1 = ranked.findIndex((r) => r.number === 1)
    const i2 = ranked.findIndex((r) => r.number === 2)
    expect(i1).toBeLessThan(i2)
  })
})
