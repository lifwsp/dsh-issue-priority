import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/store.js'
import { condenseComment, SyncService, toIssueRecord } from '../src/sync.js'
import { block, FakeDecision, FakeGitHub, fetched, silentLogger } from './helpers.js'

const settings = () => ({ maxIssues: 300, maxQuestionsPerSync: 200, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 })

describe('toIssueRecord', () => {
  it('parses block, text deps and mentions', () => {
    const r = toIssueRecord(
      fetched(5, {
        body: 'see #7, blocked by #3',
        planBlock: block({ areas: ['ui'] }),
        comments: [
          { author: 'alice', createdAt: '2026-10-02T00:00:00Z', body: 'depends on #4, also see #9', bot: false },
          { author: 'ci[bot]', createdAt: '2026-10-03T00:00:00Z', body: 'blocked by #8', bot: true },
        ],
      }),
    )
    expect(r.block?.areas).toEqual(['ui'])
    expect(r.textBlockedBy.sort()).toEqual([3, 4])
    expect(r.mentions).toEqual(expect.arrayContaining([3, 7, 9]))
    expect(r.mentions).not.toContain(8)
    expect(r.body).not.toContain('dsh-plan')
    expect(r.thread).toEqual([{ by: 'alice', at: '2026-10-02T00:00:00Z', text: 'depends on #4, also see #9' }])
  })

  it('condenses code blocks and long comments', () => {
    expect(condenseComment('log:\n```\nerror at line 1\n```\nfixed')).toBe('log:\n[code]\nfixed')
    expect(condenseComment('x'.repeat(2000)).length).toBeLessThanOrEqual(801)
  })
})

describe('SyncService', () => {
  it('syncs incrementally and only judges changed issues', async () => {
    const gh = new FakeGitHub([fetched(1), fetched(2, { updatedAt: '2026-10-02T00:00:00Z' })])
    const client = new FakeDecision((qid) =>
      qid === 'size' || qid === 'priority'
        ? { type: 'score', score: 1, probabilities: {} }
        : { type: 'noul', noul: qid === 'merge' ? 0.1 : 0.9 },
    )
    const store = createMemoryStore()
    const svc = new SyncService({ github: () => gh, decision: () => client, store, logger: silentLogger, settings })

    const first = await svc.sync('o/r')
    expect(first.fetched).toBe(2)
    expect(first.plan.workPackages).toHaveLength(2)
    const asked = client.requests.length
    // size+actionable and priority per issue, plus one merge question for the similar pair.
    expect(asked).toBe(5)

    // Nothing changed upstream → no judging, plan reused.
    const second = await svc.sync('o/r')
    expect(gh.calls[1]?.since).toBe('2026-10-02T00:00:00Z')
    expect(second.unchanged).toBe(true)
    expect(client.requests.length).toBe(asked)

    // #1 closes, #3 appears.
    gh.issues = [
      fetched(1, { state: 'closed', updatedAt: '2026-10-03T00:00:00Z', closedAt: '2026-10-03T00:00:00Z' }),
      fetched(2, { updatedAt: '2026-10-02T00:00:00Z' }),
      fetched(3, { updatedAt: '2026-10-03T00:00:00Z' }),
    ]
    const third = await svc.sync('o/r')
    expect(third.closed).toEqual([1])
    expect(third.changed).toEqual([3])
    // Only #3 is new: its size, its priority, and the #2–#3 merge question.
    expect(client.requests.length).toBe(asked + 3)
    expect(third.plan.changesSinceLast.closed).toEqual([1])
    expect(third.plan.changesSinceLast.new).toEqual([3])
  })

  it('works with no decision model', async () => {
    const gh = new FakeGitHub([fetched(1)])
    const svc = new SyncService({ github: () => gh, decision: () => null, store: createMemoryStore(), logger: silentLogger, settings })
    const res = await svc.sync('o/r')
    expect(res.plan.decision.available).toBe(false)
    expect(res.plan.workPackages[0]?.sizeSource['1']).toBe('default')
  })

  it('refetches everything once when stored records predate comment threads', async () => {
    const gh = new FakeGitHub([fetched(1)])
    const store = createMemoryStore()
    const svc = new SyncService({ github: () => gh, decision: () => null, store, logger: silentLogger, settings })
    await svc.sync('o/r')
    const state = await store.load('o/r')
    delete state.issues['1']!.thread
    await store.save(state)
    await svc.sync('o/r')
    expect(gh.calls.at(-1)?.since).toBeUndefined()
    expect((await store.load('o/r')).issues['1']!.thread).toEqual([])
    await svc.sync('o/r')
    expect(gh.calls.at(-1)?.since).toBeDefined()
  })
})
