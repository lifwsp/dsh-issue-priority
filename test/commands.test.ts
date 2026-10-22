import { describe, expect, it, vi } from 'vitest'
import { runIssuesCommand } from '../src/commands.js'
import { IssuePlanRuntime } from '../src/runtime.js'
import { createMemoryStore } from '../src/store.js'
import { SyncService } from '../src/sync.js'
import { FakeGitHub, fetched, silentLogger } from './helpers.js'

function setup() {
  const store = createMemoryStore()
  const gh = new FakeGitHub([fetched(1), fetched(2)])
  const sync = new SyncService({
    github: () => gh,
    decision: () => null,
    store,
    logger: silentLogger,
    settings: () => ({ maxIssues: 300, maxQuestionsPerSync: 0, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 }),
  })
  const runtime = new IssuePlanRuntime({ store, sync, logger: silentLogger, cwdOf: () => undefined, decisionStatus: async () => undefined })
  vi.spyOn(runtime, 'resolveRepoFor').mockResolvedValue('o/r')
  return runtime
}

describe('/issues', () => {
  it('shows the plan, defers, and kicks off the next package', async () => {
    const runtime = setup()
    const shown = await runIssuesCommand(runtime, { agent: {}, rawInput: '' })
    expect(shown.kind).toBe('success')
    expect(shown.text).toContain('#1')

    const deferred = await runIssuesCommand(runtime, { agent: {}, rawInput: 'defer 1' })
    expect(deferred.kind).toBe('success')

    const followup = vi.fn()
    const next = await runIssuesCommand(runtime, { agent: { followup }, rawInput: 'next' })
    expect(next.kind).toBe('success')
    const msg = followup.mock.calls[0]![0] as { role: string; content: Array<{ text: string }> }
    expect(msg.role).toBe('user')
    expect(msg.content[0]!.text).toContain('Closes #2')
  })

  it('errors on bad input', async () => {
    const runtime = setup()
    expect((await runIssuesCommand(runtime, { agent: {}, rawInput: 'pin x' })).kind).toBe('error')
    expect((await runIssuesCommand(runtime, { agent: {}, rawInput: 'bogus' })).kind).toBe('error')
  })
})
