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
      if (qid === 'priority') return { type: 'score', score: 1, probabilities: {} }
      if (qid === 'actionable') return { type: 'noul', noul: 0.9 }
      if (qid === 'merge') return { type: 'noul', noul: 0.8 }
      return { type: 'choice', choice: 'none', probabilities: { none: 1 } }
    })
    const judgments = new Map<string, unknown>()
    const judge = () => createJudge(client, { get: (k) => judgments.get(k), set: (k, v) => judgments.set(k, v) })
    const issues = [
      rec(1, { block: block({ areas: ['auth'] }) }),
      rec(2, { block: block({ areas: ['auth'] }) }),
      rec(3, { title: 'まったく別の話題', body: 'xyz' }), // no block → size judged
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

  it('orders free packages by priority, then unblocking, then size', async () => {
    const client = new FakeDecision((qid, req) => {
      const n = (req.state as { number?: number }).number
      if (qid === 'priority') return { type: 'score', score: n === 3 ? 2 : 0, probabilities: {} }
      if (qid === 'size') return { type: 'score', score: 1, probabilities: {} }
      return { type: 'noul', noul: qid === 'merge' ? 0 : 0.9 }
    })
    const issues = [
      rec(1, { title: 'alpha', body: 'aaaa' }),
      rec(2, { title: 'beta', body: 'bbbb', labels: ['priority: high'] }),
      rec(3, { title: 'gamma', body: 'cccc' }),
      rec(4, { title: 'delta', body: 'dddd', textBlockedBy: [1] }),
    ]
    const plan = await buildPlan(base({ issues, judge: createJudge(client, { get: () => undefined, set: () => {} }) }))
    const order = plan.workPackages.map((p) => p.issues[0])
    // #2 (label high) and #3 (model high) first; #1 before others because it unblocks #4.
    expect(order.slice(0, 2).sort()).toEqual([2, 3])
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(4))
    expect(pkgOf(plan, 2)?.prioritySource).toBe('label')
    expect(pkgOf(plan, 1)?.unblocks).toBe(1)
  })

  it('offers similar block-less issues as merge candidates only with a model', async () => {
    const issues = [
      rec(1, { title: '記入完了前の一括確認を追加する', body: '確認の流れを改善' }),
      rec(2, { title: '記入完了前の確認状態を区別する', body: '確認の流れを改善' }),
    ]
    const without = await buildPlan(base({ issues }))
    expect(without.workPackages).toHaveLength(2)
    const client = new FakeDecision((qid) =>
      qid === 'size' ? { type: 'score', score: 0, probabilities: {} } : qid === 'priority' ? { type: 'score', score: 1, probabilities: {} } : { type: 'noul', noul: 0.9 },
    )
    const plan = await buildPlan(base({ issues, judge: createJudge(client, { get: () => undefined, set: () => {} }) }))
    expect(plan.workPackages).toHaveLength(1)
    expect(plan.workPackages[0]?.rationale.some((r) => r.kind === 'similar-text')).toBe(true)
  })
})
