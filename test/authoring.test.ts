import { describe, expect, it } from 'vitest'
import { parseGhVersion, planAuthoring, repoFeatures, shellQuote, supportsRelations, type AuthoringInput } from '../src/github/authoring.js'
import { rec } from './helpers.js'

const base = (over: Partial<AuthoringInput> = {}): AuthoringInput => ({
  repo: 'o/r',
  title: 'Fix login',
  dependsOn: [],
  ghRelations: true,
  features: repoFeatures([]),
  ...over,
})

describe('gh version', () => {
  it('parses and compares', () => {
    expect(parseGhVersion('gh version 2.103.0 (2026-10-21)\nhttps://...')).toEqual([2, 103])
    expect(supportsRelations([2, 94])).toBe(true)
    expect(supportsRelations([2, 83])).toBe(false)
    expect(supportsRelations([3, 0])).toBe(true)
    expect(supportsRelations(null)).toBe(false)
  })
})

describe('planAuthoring', () => {
  it('records dependencies, parent and milestone with gh flags when gh is new', () => {
    const p = planAuthoring(
      base({ dependsOn: [5, 3], parent: 10, milestone: 'v1.0', features: { ...repoFeatures([]), milestones: ['v1.0'] } }),
    )
    expect(p.commands).toEqual(['gh issue create -R o/r --title \'Fix login\' --body-file body.md --blocked-by 3,5 --parent 10 --milestone v1.0'])
    expect(p.blockDependsOn).toEqual([])
    expect(p.notes).toEqual([])
  })

  it('keeps dependencies in the block when gh is too old', () => {
    const p = planAuthoring(base({ dependsOn: [3], parent: 10, ghRelations: false }))
    expect(p.blockDependsOn).toEqual([3])
    expect(p.commands.at(-1)).not.toContain('--blocked-by')
    expect(p.commands.at(-1)).not.toContain('--parent')
    expect(p.notes.join('\n')).toContain('2.94')
    expect(p.notes.join('\n')).toContain('#10')
  })

  it('warns about an unknown milestone', () => {
    const p = planAuthoring(base({ milestone: 'Spring release' }))
    expect(p.commands.at(-1)).toContain("--milestone 'Spring release'")
    expect(p.notes.join('\n')).toContain('gh api repos/o/r/milestones')
  })

  it('reuses an existing priority label, else creates priority:<level>', () => {
    const features = repoFeatures([rec(1, { labels: ['P1'] })])
    expect(planAuthoring(base({ priority: 'high', features })).commands).toHaveLength(1)
    expect(planAuthoring(base({ priority: 'high', features })).commands[0]).toContain('--label P1')
    const fresh = planAuthoring(base({ priority: 'low' }))
    expect(fresh.commands[0]).toContain('gh label create priority:low -R o/r')
    expect(fresh.commands[1]).toContain('--label priority:low')
  })

  it('points to the Priority field when the repo uses it', () => {
    const features = repoFeatures([rec(1, { native: { priority: 'P2' } })])
    const p = planAuthoring(base({ priority: 'medium', features }))
    expect(p.commands).toHaveLength(1)
    expect(p.commands[0]).not.toContain('--label')
    expect(p.notes.join('\n')).toContain('issue-field-values')
    expect(p.notes.join('\n')).toContain('orgs/o/issue-fields')
  })

  it('edits only what GitHub does not have yet', () => {
    const p = planAuthoring(
      base({
        issue: 7,
        dependsOn: [3, 4],
        parent: 10,
        priority: 'high',
        existing: { blockedBy: [3], parent: 10, labels: ['priority:high'] },
      }),
    )
    expect(p.commands).toEqual(['gh issue edit 7 -R o/r --body-file body.md --add-blocked-by 4'])
  })
})

describe('repoFeatures / shellQuote', () => {
  it('collects fields, labels and milestones from synced issues', () => {
    const f = repoFeatures([
      rec(1, { labels: ['priority:low', 'bug'], native: { effort: 'M', milestone: { title: 'v2' } } }),
      rec(2, { labels: ['critical'] }),
    ])
    expect(f).toEqual({ priorityField: false, effortField: true, priorityLabels: { low: 'priority:low', high: 'critical' }, milestones: ['v2'] })
  })

  it('quotes shell words', () => {
    expect(shellQuote('v1.0')).toBe('v1.0')
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('issue_draft tool', () => {
  it('returns gh commands and drops dependencies from the block when gh records them', async () => {
    const { createIssueDraftTool } = await import('../src/tools.js')
    const { IssuePlanRuntime } = await import('../src/runtime.js')
    const { createMemoryStore } = await import('../src/store.js')
    const { SyncService } = await import('../src/sync.js')
    const { silentLogger } = await import('./helpers.js')
    const store = createMemoryStore()
    const sync = new SyncService({
      github: () => ({ id: 'x', listIssuesSince: async () => [] }),
      decision: () => null,
      store,
      logger: silentLogger,
      settings: () => ({ maxIssues: 300, maxQuestionsPerSync: 0, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 }),
    })
    const make = (version: [number, number] | null) =>
      createIssueDraftTool(
        new IssuePlanRuntime({ store, sync, logger: silentLogger, cwdOf: () => undefined, decisionStatus: async () => undefined, ghVersion: async () => version }),
      ) as unknown as { execute: (args: Record<string, unknown>, exec: unknown) => Promise<any> }
    const args = { title: 'T', body: 'b', areas: ['core'], size: 'S', dependsOn: [3], parent: 9, repo: 'o/r' }
    const fresh = await make([2, 103]).execute(args, { agent: {} })
    expect(fresh.ok).toBe(true)
    expect(fresh.body).not.toContain('dependsOn')
    expect(fresh.commands.at(-1)).toContain('--blocked-by 3 --parent 9')
    const old = await make([2, 83]).execute(args, { agent: {} })
    expect(old.body).toContain('dependsOn: [3]')
    expect(old.commands.at(-1)).not.toContain('--blocked-by')
  })
})
