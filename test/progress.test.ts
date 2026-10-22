import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchIssueRefs, detectProgress, parseClosingRefs, scanLocalRepo, type ProgressInput } from '../src/progress.js'
import { createMemoryStore } from '../src/store.js'
import { SyncService, toStoredPulls } from '../src/sync.js'
import { IssuePlanRuntime } from '../src/runtime.js'
import type { FetchedPull, ListPullsOptions } from '../src/github/adapter.js'
import type { LocalBranch, LocalScan } from '../src/types.js'
import { FakeGitHub, fetched, silentLogger } from './helpers.js'

const settings = () => ({ maxIssues: 300, maxQuestionsPerSync: 200, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 })

const input = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  open: [1, 2, 3],
  inProgress: null,
  finished: [],
  dismissed: [],
  pulls: [],
  local: null,
  ...over,
})

const branch = (over: Partial<LocalBranch> = {}): LocalBranch => ({
  branch: 'issues/wp-1',
  upstream: null,
  pushed: 'none',
  unpushed: 2,
  commits: 2,
  issues: {},
  targets: [1],
  ...over,
})

const scan = (...branches: LocalBranch[]): LocalScan => ({ path: '/x', base: 'origin/main', scannedAt: '2026-10-22T00:00:00Z', branches })

const pull = (n: number, over: Partial<FetchedPull> = {}): FetchedPull => ({
  number: n,
  title: `PR ${n}`,
  body: '',
  htmlUrl: `https://github.com/o/r/pull/${n}`,
  state: 'open',
  draft: false,
  mergedAt: null,
  head: 'feature',
  base: 'main',
  updatedAt: '2026-10-20T00:00:00Z',
  ...over,
})

describe('parsing', () => {
  it('reads closing keywords for this repo only', () => {
    expect(parseClosingRefs('Closes #12, fixes #3\nresolved: o/r#7, closes other/x#9, see #4', 'o/r')).toEqual([3, 7, 12])
  })
  it('reads issue numbers from branch names', () => {
    expect(branchIssueRefs('issues/wp-12-13')).toEqual([12, 13])
    expect(branchIssueRefs('fix/42-login')).toEqual([42])
    expect(branchIssueRefs('issue-7')).toEqual([7])
    expect(branchIssueRefs('release/2')).toEqual([])
    expect(branchIssueRefs('v2-cleanup')).toEqual([])
  })
})

describe('detectProgress', () => {
  it('marked issues await close until the PR exists', () => {
    const r = detectProgress(input({ finished: [{ issue: 1, at: 't' }] }))
    expect(r.awaitingClose).toEqual([{ issue: 1, source: 'marked', step: 'check', evidence: [{ kind: 'marked', at: 't' }] }])
  })

  it('a branch for an issue that is not in progress takes it off: push first', () => {
    const r = detectProgress(input({ local: scan(branch()) }))
    expect(r.awaitingClose.map((a) => [a.issue, a.step])).toEqual([[1, 'push']])
  })

  it('pushed branch without PR → open-pr; open PR → merge-pr; merged → close-issue', () => {
    const pushed = branch({ upstream: 'origin/issues/wp-1', pushed: 'all', unpushed: 0 })
    expect(detectProgress(input({ local: scan(pushed) })).awaitingClose[0]!.step).toBe('open-pr')
    const open = toStoredPulls([pull(9, { body: 'Closes #1', head: 'issues/wp-1' })], 'o/r')
    expect(detectProgress(input({ local: scan(pushed), pulls: open })).awaitingClose[0]!.step).toBe('merge-pr')
    const merged = toStoredPulls([pull(9, { body: 'Closes #1', state: 'closed', mergedAt: '2026-10-21T00:00:00Z', base: 'develop' })], 'o/r')
    expect(detectProgress(input({ pulls: merged })).awaitingClose[0]!.step).toBe('close-issue')
  })

  it('a passing #N in a commit is shown as activity only', () => {
    const r = detectProgress(input({ local: scan(branch({ issues: { '2': 1 }, targets: [] })) }))
    expect(r.awaitingClose).toEqual([])
    expect(r.activity['2']?.[0]).toMatchObject({ kind: 'branch', mentionOnly: true })
  })

  it('in-progress issues stay in the plan until a finished-looking PR', () => {
    const inProgress = { issues: [1], branch: 'work' }
    const local = scan(branch({ branch: 'work', targets: [] }))
    const r = detectProgress(input({ inProgress, local }))
    expect(r.awaitingClose).toEqual([])
    expect(r.activity['1']?.[0]).toMatchObject({ kind: 'branch', branch: 'work' })

    const draft = toStoredPulls([pull(5, { head: 'work', body: 'Closes #1', draft: true })], 'o/r')
    expect(detectProgress(input({ inProgress, local, pulls: draft })).awaitingClose).toEqual([])
    const ready = toStoredPulls([pull(5, { head: 'work', body: 'Closes #1' })], 'o/r')
    expect(detectProgress(input({ inProgress, local, pulls: ready })).awaitingClose.map((a) => a.issue)).toEqual([1])
  })

  it('dismissed evidence keeps the issue in the plan until something new shows up', () => {
    const local = scan(branch())
    const dismissed = [{ issue: 1, keys: ['b:issues/wp-1'], at: 't' }]
    expect(detectProgress(input({ local, dismissed })).awaitingClose).toEqual([])
    const pulls = toStoredPulls([pull(9, { body: 'Closes #1' })], 'o/r')
    expect(detectProgress(input({ local, dismissed, pulls })).awaitingClose.map((a) => a.issue)).toEqual([1])
  })

  it('ignores closed issues and closed-unmerged PRs', () => {
    expect(toStoredPulls([pull(9, { body: 'Closes #1', state: 'closed', mergedAt: null })], 'o/r')).toEqual([])
    const r = detectProgress(input({ open: [2], finished: [{ issue: 1, at: 't' }] }))
    expect(r.awaitingClose).toEqual([])
  })
})

describe('sync + runtime', () => {
  class PullGitHub extends FakeGitHub {
    pulls: FetchedPull[] = []
    async listPulls(_o: ListPullsOptions): Promise<FetchedPull[]> {
      return this.pulls
    }
  }

  const setup = () => {
    const gh = new PullGitHub([fetched(1), fetched(2), fetched(3, { body: 'blocked by #1' })])
    const store = createMemoryStore()
    let local: LocalScan | null = null
    let head: string | null = 'main'
    const sync = new SyncService({
      github: () => gh,
      decision: () => null,
      store,
      logger: silentLogger,
      settings,
      scanLocal: async () => local,
      branchOf: async () => head,
    })
    const runtime = new IssuePlanRuntime({
      store,
      sync,
      logger: silentLogger,
      cwdOf: () => '/clone',
      decisionStatus: async () => undefined,
    } as never)
    return { gh, store, sync, runtime, setLocal: (s: LocalScan | null) => (local = s), setHead: (b: string | null) => (head = b) }
  }

  it('finish moves the package out of the plan; dependents wait for the close', async () => {
    const { sync, runtime } = setup()
    await sync.sync('o/r')
    await runtime.mutate('o/r', (s) => runtime.setInProgress(s, [1], 'main'))
    const { plan } = await runtime.mutate('o/r', (s) => void runtime.finish(s))
    const all = plan.workPackages.flatMap((p) => p.issues)
    expect(all).not.toContain(1)
    expect(plan.awaitingClose?.map((a) => a.issue)).toEqual([1])
    const p3 = plan.workPackages.find((p) => p.issues.includes(3))!
    expect(p3.status).toBe('waiting')
    expect(p3.waitingOnClose).toEqual([1])

    const back = await runtime.mutate('o/r', (s) => runtime.reopen(s, 1))
    expect(back.plan.workPackages.flatMap((p) => p.issues)).toContain(1)
    expect(back.state.finished).toEqual([])
  })

  it('records the branch created after start, and detects a merged PR from it', async () => {
    const { gh, sync, runtime, setLocal, setHead } = setup()
    await sync.sync('o/r')
    await runtime.mutate('o/r', (s) => runtime.setInProgress(s, [2], 'main'))
    setHead('feat/login')
    setLocal(scan(branch({ branch: 'feat/login', targets: [], upstream: 'origin/feat/login', pushed: 'all', unpushed: 0 })))
    const { state, plan } = await runtime.ensurePlan('o/r', { cwd: '/clone' })
    expect(state.inProgress?.branch).toBe('feat/login')
    expect(plan.activity?.['2']?.[0]).toMatchObject({ kind: 'branch', branch: 'feat/login' })
    expect(plan.awaitingClose).toEqual([])

    gh.pulls = [pull(20, { head: 'feat/login', state: 'closed', mergedAt: '2026-10-21T00:00:00Z' })]
    const res = await sync.sync('o/r', { cwd: '/clone' })
    expect(res.plan.awaitingClose?.map((a) => [a.issue, a.step])).toEqual([[2, 'close-issue']])
    expect(res.state.inProgress).toBeNull()

    // GitHub closes it → gone everywhere.
    gh.issues = gh.issues.map((i) => (i.number === 2 ? { ...i, state: 'closed' as const, updatedAt: '2026-10-23T00:00:00Z', closedAt: '2026-10-23T00:00:00Z' } : i))
    gh.pulls = []
    const after = await sync.sync('o/r')
    expect(after.plan.awaitingClose).toEqual([])
    expect(after.plan.workPackages.flatMap((p) => p.issues)).not.toContain(2)
  })
})

describe('scanLocalRepo (real git)', () => {
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString()

  it('finds unpushed branch commits and push state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-ip-'))
    const remote = join(root, 'remote.git')
    const clone = join(root, 'clone')
    execFileSync('git', ['init', '--bare', '-b', 'main', remote])
    execFileSync('git', ['init', '-b', 'main', clone])
    sh(clone, 'remote', 'add', 'origin', 'https://github.com/o/r.git')
    sh(clone, 'remote', 'add', 'local', remote)
    writeFileSync(join(clone, 'a'), '1')
    sh(clone, 'add', '.')
    sh(clone, 'commit', '-m', 'init')
    // the GitHub remote's tracking ref, without network
    sh(clone, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

    sh(clone, 'checkout', '-b', 'issues/wp-4')
    writeFileSync(join(clone, 'a'), '2')
    sh(clone, 'commit', '-am', 'do it (#4), see #9')
    sh(clone, 'checkout', 'main')
    sh(clone, 'checkout', '-b', 'pushed')
    writeFileSync(join(clone, 'b'), '1')
    sh(clone, 'add', '.')
    sh(clone, 'commit', '-m', 'Fixes #5')
    sh(clone, 'update-ref', 'refs/remotes/origin/pushed', 'HEAD')
    sh(clone, 'checkout', 'main')

    const res = await scanLocalRepo(clone, 'o/r')
    expect(res?.base).toBe('origin/main')
    const wp = res!.branches.find((b) => b.branch === 'issues/wp-4')!
    expect(wp).toMatchObject({ pushed: 'none', unpushed: 1, commits: 1, targets: [4], issues: { '4': 1, '9': 1 } })
    const pushed = res!.branches.find((b) => b.branch === 'pushed')!
    expect(pushed).toMatchObject({ upstream: 'origin/pushed', pushed: 'all', unpushed: 0, targets: [5] })
    expect(res!.branches.find((b) => b.branch === 'main')).toBeUndefined()
    expect(await scanLocalRepo(clone, 'other/repo')).toBeNull()
  })
})
