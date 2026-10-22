import { describe, expect, it } from 'vitest'
import { createJudge } from '../src/decision/judge.js'
import { nativeMeta } from '../src/github/rest-adapter.js'
import { buildPlan, type PlannerOptions } from '../src/plan/planner.js'
import { block, rec } from './helpers.js'

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
const order = (plan: Awaited<ReturnType<typeof buildPlan>>) => plan.workPackages.map((p) => p.issues[0])

describe('nativeMeta', () => {
  it('reads Priority / Effort fields, same-repo parent, sub-issues and milestone', () => {
    const m = nativeMeta(
      {
        issue_field_values: [
          { issue_field_name: 'Priority', data_type: 'single_select', value: 'P1', single_select_option: { name: 'P1' } },
          { issue_field_name: 'Effort', data_type: 'number', value: 8 },
        ],
        parent_issue_url: 'https://api.github.com/repos/O/R/issues/7',
        sub_issues_summary: { total: 3, completed: 1, percent_completed: 33 },
        milestone: { title: 'v1', due_on: '2026-11-01T00:00:00Z' },
        url: 'https://api.github.com/repos/o/r/issues/8',
      } as never,
    )
    expect(m).toMatchObject({ priority: 'P1', effort: 8, parent: 7, subIssues: { total: 3, completed: 1 }, milestone: { title: 'v1', dueOn: '2026-11-01T00:00:00Z' } })
    const other = nativeMeta({ parent_issue_url: 'https://api.github.com/repos/x/y/issues/7', url: 'https://api.github.com/repos/o/r/issues/8' } as never)
    expect(other?.parent).toBeUndefined()
  })
})

describe('buildPlan with GitHub-native signals', () => {
  it('uses the Priority / Effort fields over labels and the plan block', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          rec(1, { labels: ['priority:high'], block: block({ areas: ['a'] }) }),
          rec(2, { native: { priority: 'Urgent', effort: 'XL' }, block: block({ areas: ['b'], size: 'S' }) }),
        ],
      }),
    )
    expect(pkgOf(plan, 2)).toMatchObject({ priority: 'high', prioritySource: 'github', size: 4 })
    expect(pkgOf(plan, 2)!.sizeSource['2']).toBe('github')
  })

  it('runs sub-issues before their parent and bundles siblings that share files', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          rec(10, { native: { subIssues: { total: 2, completed: 0 } }, block: block({ areas: ['p'] }) }),
          rec(11, { native: { parent: 10 }, block: block({ areas: ['x'], files: ['src/a.ts'] }) }),
          rec(12, { native: { parent: 10 }, block: block({ areas: ['x'], files: ['src/a.ts'] }) }),
        ],
      }),
    )
    expect(pkgOf(plan, 11)?.issues).toEqual([11, 12])
    expect(pkgOf(plan, 11)?.rationale.some((r) => r.kind === 'same-parent')).toBe(true)
    expect(pkgOf(plan, 10)?.status).toBe('waiting')
    expect(order(plan).indexOf(11)).toBeLessThan(order(plan).indexOf(10))
  })

  it('never bundles issues of different milestones', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          rec(1, { native: { milestone: { title: 'v1' } }, block: block({ files: ['src/a.ts'] }) }),
          rec(2, { native: { milestone: { title: 'v2' } }, block: block({ files: ['src/a.ts'] }) }),
        ],
      }),
    )
    expect(pkgOf(plan, 1)?.issues).toEqual([1])
  })

  it('lifts old or due work above newer quick wins of the same priority', async () => {
    const issues = [
      rec(1, { createdAt: '2026-10-20T00:00:00Z', block: block({ areas: ['a'], size: 'S' }) }),
      rec(2, { createdAt: '2026-06-01T00:00:00Z', block: block({ areas: ['b'], size: 'L' }) }),
    ]
    const aged = await buildPlan(base({ issues }))
    expect(order(aged)).toEqual([2, 1])
    expect(pkgOf(aged, 2)?.rationale.some((r) => r.kind === 'aging')).toBe(true)

    const off = await buildPlan(base({ issues, agingDays: 0 }))
    expect(order(off)).toEqual([1, 2])

    const due = await buildPlan(
      base({
        agingDays: 0,
        issues: [
          rec(1, { block: block({ areas: ['a'], size: 'S' }) }),
          rec(2, { native: { milestone: { title: 'v1', dueOn: '2026-10-25T00:00:00Z' } }, block: block({ areas: ['b'], size: 'L' }) }),
        ],
      }),
    )
    expect(order(due)).toEqual([2, 1])
    expect(pkgOf(due, 2)?.rationale.find((r) => r.kind === 'due')).toMatchObject({ days: 3 })
  })
})

describe('bundling by purpose, not by hub files', () => {
  const hub = ['src/server.ts', 'src/app.ts']
  const issue = (n: number, areas: string[], files: string[] = hub) => rec(n, { block: block({ areas, files }) })

  it('does not bundle different features that only share hub files', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          issue(1, ['export']),
          issue(2, ['status']),
          issue(3, ['export']),
          issue(4, ['status']),
          issue(5, ['intake']),
        ],
      }),
    )
    expect(pkgOf(plan, 1)?.issues).toEqual([1, 3])
    expect(pkgOf(plan, 2)?.issues).toEqual([2, 4])
    expect(pkgOf(plan, 5)?.issues).toEqual([5])
  })

  it('still bundles different areas through a specific shared file', async () => {
    const plan = await buildPlan(
      base({ issues: [issue(1, ['a'], ['src/x.ts', 'src/y.ts']), issue(2, ['b'], ['src/x.ts', 'src/z.ts'])] }),
    )
    // Without a decision model a cross-area overlap stays a candidate only.
    expect(pkgOf(plan, 1)?.issues).toEqual([1])
  })

  it('ignores a catch-all area left by older, coarse blocks', async () => {
    const plan = await buildPlan(
      base({
        issues: [
          issue(1, ['forms'], ['src/a.ts']),
          issue(2, ['forms'], ['src/b.ts']),
          issue(3, ['forms'], ['src/c.ts']),
          issue(4, ['forms', 'export'], ['src/d.ts']),
          issue(5, ['forms', 'export'], ['src/d.ts']),
        ],
      }),
    )
    expect(pkgOf(plan, 1)?.issues).toEqual([1])
    expect(pkgOf(plan, 4)?.issues).toEqual([4, 5])
  })

  it('keeps bundling issues without areas on any shared file', async () => {
    const plan = await buildPlan(base({ issues: [issue(1, [], ['src/a.ts']), issue(2, [], ['src/a.ts'])] }))
    expect(pkgOf(plan, 1)?.issues).toEqual([1, 2])
  })
})
