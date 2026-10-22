import { describe, expect, it } from 'vitest'
import { createJudge } from '../src/decision/judge.js'
import { buildPlan, type PlannerOptions } from '../src/plan/planner.js'
import { block, FakeDecision, rec } from './helpers.js'

const noJudge = () => createJudge(null, { get: () => undefined, set: () => {} })
const base = (over: Partial<PlannerOptions>): PlannerOptions => ({
  repo: 'o/r',
  issues: [],
  overrides: [],
  localDependencies: [],
  inProgress: [],
  areas: [],
  judge: noJudge(),
  now: () => new Date('2026-10-22T00:00:00Z'),
  ...over,
})

const pkgOf = (plan: Awaited<ReturnType<typeof buildPlan>>, n: number) => plan.workPackages.find((p) => p.issues.includes(n))

describe('buildPlan', () => {
  it('bundles exact file overlap without a model and respects size cap', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          rec(1, { block: block({ files: ['src/a.ts'] }) }),
          rec(2, { block: block({ files: ['src/a.ts'] }) }),
          rec(3, { block: block({ files: ['src/z.ts'], areas: ['other'] }) }),
        ],
      }),
    )
    expect(pkgOf(plan, 1)?.issues).toEqual([1, 2])
    expect(pkgOf(plan, 3)?.issues).toEqual([3])
    expect(plan.decision.available).toBe(false)

    const big = await buildPlan(
      base({
        issues: [rec(1, { block: block({ size: 'L', files: ['x.ts'] }) }), rec(2, { block: block({ size: 'M', files: ['x.ts'] }) })],
      }),
    )
    expect(pkgOf(big, 1)?.issues).toEqual([1])
  })

  it('orders by hard dependencies and marks waiting', async () => {
    const plan = await buildPlan(
      base({
        issues: [rec(1, { block: block({ dependsOn: [3], areas: ['a'] }) }), rec(2, { nativeBlockedBy: [1] }), rec(3, { block: block({ areas: ['b'] }) })],
      }),
    )
    const order = plan.workPackages.map((p) => p.issues[0])
    expect(order.indexOf(3)).toBeLessThan(order.indexOf(1))
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2))
    expect(pkgOf(plan, 3)?.status).toBe('ready')
    expect(pkgOf(plan, 1)?.status).toBe('waiting')
  })

  it('treats deps on closed / unknown issues as satisfied and sends cycles to needsHuman', async () => {
    const plan = await buildPlan(
      base({
        issues: [rec(1, { textBlockedBy: [99] }), rec(2, { textBlockedBy: [3] }), rec(3, { textBlockedBy: [2] })],
      }),
    )
    expect(pkgOf(plan, 1)?.status).toBe('ready')
    expect(plan.needsHuman.map((h) => h.issue).sort()).toEqual([2, 3])
    expect(plan.needsHuman[0]?.reason).toBe('dependency-cycle')
  })

  it('applies pin / defer and in-progress', async () => {
    const issues = [rec(1), rec(2), rec(3)]
    const plan = await buildPlan(
      base({
        issues,
        overrides: [
          { issue: 3, action: 'pin', at: 'x' },
          { issue: 1, action: 'defer', at: 'x' },
        ],
      }),
    )
    expect(plan.workPackages.map((p) => p.issues[0])).toEqual([3, 2, 1])
    const wip = await buildPlan(base({ issues, inProgress: [2] }))
    expect(wip.workPackages[0]?.issues).toEqual([2])
    expect(wip.workPackages[0]?.status).toBe('in_progress')
  })

  it('uses the decision model for size, unclear issues and merge', async () => {
    const client = new FakeDecision((qid) => {
      if (qid === 'size') return { type: 'score', score: 0, probabilities: {} }
      if (qid === 'actionable') return { type: 'noul', noul: 0.9 }
      if (qid === 'merge') return { type: 'noul', noul: 0.8 }
      return { type: 'choice', choice: 'none', probabilities: { none: 1 } }
    })
    const judgments = new Map<string, unknown>()
    const judge = () => createJudge(client, { get: (k) => judgments.get(k), set: (k, v) => judgments.set(k, v) })
    const issues = [
      rec(1, { block: block({ areas: ['auth'] }) }),
      rec(2, { block: block({ areas: ['auth'] }) }),
      rec(3), // no block → size judged
    ]
    const plan = await buildPlan(base({ issues, judge: judge() }))
    expect(pkgOf(plan, 1)?.issues).toEqual([1, 2])
    expect(pkgOf(plan, 3)?.sizeSource['3']).toBe('decision')
    const asked = client.requests.length
    expect(asked).toBeGreaterThan(0)
    // Second run with same inputs: answered from cache, zero new requests.
    await buildPlan(base({ issues, judge: judge() }))
    expect(client.requests.length).toBe(asked)
    // Switching model invalidates cached answers.
    const other = Object.assign(new FakeDecision(() => ({ type: 'noul', noul: 0.9 })), { model: 'other' })
    await buildPlan(base({ issues, judge: createJudge(other, { get: (k) => judgments.get(k), set: (k, v) => judgments.set(k, v) }) }))
    expect(other.requests.length).toBeGreaterThan(0)
  })

  it('flags unclear issues', async () => {
    const client = new FakeDecision((qid) =>
      qid === 'size' ? { type: 'score', score: 1, probabilities: {} } : { type: 'noul', noul: 0.1 },
    )
    const plan = await buildPlan(base({ issues: [rec(1)], judge: createJudge(client, { get: () => undefined, set: () => {} }) }))
    expect(plan.needsHuman).toEqual([expect.objectContaining({ issue: 1, reason: 'unclear' })])
    expect(plan.workPackages).toHaveLength(0)
  })

  it('turns a mutual mention into an advisory order', async () => {
    const client = new FakeDecision((qid) => {
      if (qid === 'order') return { type: 'choice', choice: 'b-first', probabilities: { 'b-first': 0.9 } }
      if (qid === 'size') return { type: 'score', score: 0, probabilities: {} }
      return { type: 'noul', noul: 0.9 }
    })
    const plan = await buildPlan(
      base({
        issues: [rec(1, { mentions: [2], block: block({ areas: ['x'] }) }), rec(2, { mentions: [1], block: block({ areas: ['y'] }) })],
        judge: createJudge(client, { get: () => undefined, set: () => {} }),
      }),
    )
    const order = plan.workPackages.map((p) => p.issues[0])
    expect(order).toEqual([2, 1])
  })
})
