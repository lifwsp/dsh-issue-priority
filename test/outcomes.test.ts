import { describe, expect, it } from 'vitest'
import { classifyStart, describeOutcomes, MAX_OUTCOMES, pushOutcome, summarizeOutcomes } from '../src/outcomes.js'
import { renderKickoff } from '../src/render.js'
import { IssuePlanRuntime } from '../src/runtime.js'
import { createMemoryStore } from '../src/store.js'
import { SyncService } from '../src/sync.js'
import type { Plan, WorkPackage } from '../src/types.js'
import { block, FakeGitHub, fetched, rec, silentLogger } from './helpers.js'

const pkg = (issues: number[], status: WorkPackage['status'] = 'ready'): WorkPackage => ({
  id: `wp-${issues.join('-')}`,
  issues,
  dependsOn: [],
  blockedByExternal: [],
  rationale: [],
  size: 1,
  sizeSource: {},
  priority: 'medium',
  prioritySource: 'default',
  unblocks: 0,
  status,
})
const plan = (packages: WorkPackage[]): Plan => ({
  schema: 1,
  repo: 'o/r',
  generatedAt: '2026-10-22T00:00:00Z',
  workPackages: packages,
  needsHuman: [],
  warnings: [],
  changesSinceLast: { new: [], closed: [], reordered: [] },
  decision: { provider: 'none', available: false, asked: 0 },
})

describe('plan outcomes', () => {
  it('classifies a start as adopted / other package / regrouped', () => {
    const p = plan([pkg([1, 2]), pkg([3])])
    expect(classifyStart(p, [2, 1])).toEqual({ recommended: 'wp-1-2', match: 'adopted' })
    expect(classifyStart(p, [3]).match).toBe('other-package')
    expect(classifyStart(p, [1]).match).toBe('regrouped')
    expect(classifyStart(null, [1])).toEqual({ recommended: null, match: 'regrouped' })
  })

  it('caps the log and summarizes it', () => {
    let list = pushOutcome(undefined, { kind: 'start', at: 'a', issues: [1], recommended: 'wp-1', match: 'adopted' })
    list = pushOutcome(list, { kind: 'finish', at: 'b', issues: [1], partial: true })
    list = pushOutcome(list, { kind: 'override', at: 'c', issue: 2, action: 'pin' })
    const stats = summarizeOutcomes(list)
    expect(stats).toMatchObject({ starts: 1, adopted: 1, partialFinishes: 1, overrides: 1 })
    expect(describeOutcomes(stats)).toContain('推奨どおり 1')
    for (let i = 0; i < MAX_OUTCOMES + 5; i++) list = pushOutcome(list, { kind: 'dependency', at: String(i), issue: 1, dependsOn: 2 })
    expect(list).toHaveLength(MAX_OUTCOMES)
  })

  it('records start / split finish through the runtime', async () => {
    const store = createMemoryStore()
    const gh = new FakeGitHub([
      fetched(1, { planBlock: block({ files: ['src/a.ts'] }) }),
      fetched(2, { planBlock: block({ files: ['src/a.ts'] }) }),
    ])
    const sync = new SyncService({
      github: () => gh,
      decision: () => null,
      store,
      logger: silentLogger,
      settings: () => ({ maxIssues: 300, maxQuestionsPerSync: 0, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 }),
    })
    const runtime = new IssuePlanRuntime({ store, sync, logger: silentLogger, cwdOf: () => undefined, decisionStatus: async () => undefined })
    const { plan: p } = await runtime.ensurePlan('o/r')
    expect(p.workPackages[0]!.issues).toEqual([1, 2])
    await runtime.mutate('o/r', (s) => runtime.setInProgress(s, [1, 2]))
    const { state } = await runtime.mutate('o/r', (s) => void runtime.finish(s, [1]))
    expect(state.outcomes.map((o) => o.kind)).toEqual(['start', 'finish'])
    expect(state.outcomes[0]).toMatchObject({ match: 'adopted', recommended: 'wp-1-2' })
    expect(state.outcomes[1]).toMatchObject({ partial: true })
  })
})

describe('renderKickoff', () => {
  it('hands over acceptance, files and the review scope', () => {
    const issues = {
      '1': rec(1, { block: block({ acceptance: 'ログインできる', files: ['src/auth.ts'], areas: ['auth'] }), native: { parent: 9 } }),
      '2': rec(2, { block: block({ areas: ['auth'] }) }),
    }
    const text = renderKickoff(plan([pkg([1, 2])]), pkg([1, 2]), issues)
    expect(text).toContain('dsh-work-planner')
    expect(text).toContain('完了条件: ログインできる')
    expect(text).toContain('親 Issue #9')
    expect(text).toContain('src/auth.ts')
    expect(text).toContain('完了条件が未記入: #2')
  })
})
