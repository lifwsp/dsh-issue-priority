import { describe, expect, it, vi } from 'vitest'
import { createRpcHandler, createRpcRoute } from '../src/rpc.js'
import { IssuePlanRuntime } from '../src/runtime.js'
import { createMemoryStore } from '../src/store.js'
import { SyncService } from '../src/sync.js'
import { FakeGitHub, fetched, silentLogger } from './helpers.js'

function setup(agents: Array<{ id: string; followup?: (m: unknown) => void }> = []) {
  const store = createMemoryStore()
  const gh = new FakeGitHub([fetched(1), fetched(2)])
  const sync = new SyncService({
    github: () => gh,
    decision: () => null,
    store,
    logger: silentLogger,
    settings: () => ({ maxIssues: 300, maxQuestionsPerSync: 0, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 }),
  })
  const runtime = new IssuePlanRuntime({ store, sync, logger: silentLogger, cwdOf: () => '/repo', decisionStatus: async () => undefined })
  vi.spyOn(runtime, 'resolveRepoAt').mockResolvedValue('o/r')
  return createRpcHandler({ runtime, agents: () => agents })
}

describe('sidebar RPC', () => {
  it('returns a plan view with issue titles and kickoff availability', async () => {
    const dispatch = setup([{ id: 's1', followup: () => {} }])
    const res = await dispatch('plan', { sessionId: 's1' })
    expect(res.ok).toBe(true)
    const v = (res as { value: any }).value
    expect(v.repo).toBe('o/r')
    expect(v.canKickoff).toBe(true)
    expect(v.nextId).toBe(v.plan.workPackages[0].id)
    expect(Object.keys(v.issues).sort()).toEqual(['1', '2'])
  })

  it('applies overrides and kicks off a package on the session agent', async () => {
    const followup = vi.fn()
    const dispatch = setup([{ id: 's1', followup }])
    const deferred = await dispatch('override', { sessionId: 's1', issue: 1, action: 'defer' })
    expect(deferred.ok).toBe(true)
    expect((deferred as { value: any }).value.overrides).toEqual({ '1': 'defer' })

    const next = await dispatch('next', { sessionId: 's1' })
    expect(next.ok).toBe(true)
    expect(followup).toHaveBeenCalledOnce()
    const msg = followup.mock.calls[0]![0] as { role: string; content: Array<{ text: string }> }
    expect(msg.role).toBe('user')
    expect(msg.content[0]!.text).toContain('Closes #2')
  })

  it('refuses kickoff without a matching session and rejects bad input', async () => {
    const dispatch = setup([{ id: 'other', followup: () => {} }])
    const next = await dispatch('next', { sessionId: 's1', cwd: '/repo' })
    expect(next).toMatchObject({ ok: false, error: { code: 'no-session' } })
    expect(await dispatch('override', { cwd: '/repo', issue: 'x', action: 'pin' })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await dispatch('nope', {})).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('needs a cwd when no session matches', async () => {
    const store = createMemoryStore()
    const sync = new SyncService({
      github: () => new FakeGitHub([]),
      decision: () => null,
      store,
      logger: silentLogger,
      settings: () => ({ maxIssues: 1, maxQuestionsPerSync: 0, mergeThreshold: 0.6, actionableThreshold: 0.35, directionThreshold: 0.6, maxPackageSize: 4 }),
    })
    const runtime = new IssuePlanRuntime({ store, sync, logger: silentLogger, cwdOf: () => undefined, decisionStatus: async () => undefined })
    const dispatch = createRpcHandler({ runtime, agents: () => [] })
    expect(await dispatch('plan', {})).toMatchObject({ ok: false, error: { code: 'no-cwd' } })
  })

  it('direct route speaks the connection.rpc envelope', async () => {
    const route = createRpcRoute(async (endpoint, payload) => ({ ok: true, value: { endpoint, payload } }))
    const call = async (url: string, body: unknown, method = 'POST', ct = 'application/json') => {
      let status = 0
      let out = ''
      const req = Object.assign(
        (async function* () { yield Buffer.from(JSON.stringify(body)) })(),
        { url, method, headers: { 'content-type': ct } },
      )
      await route.handler(req as never, { writeHead: (s: number) => { status = s }, end: (b?: string) => { out = b ?? '' } })
      return { status, out }
    }
    const ok = await call('/dsh-issue-priority/plan', { type: 'client-request', rpcId: 'r1', method: 'plan', payload: { a: 1 } })
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.out)).toEqual({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: { endpoint: 'plan', payload: { a: 1 } } } })
    expect((await call('/dsh-issue-priority/plan', {}, 'GET')).status).toBe(404)
    expect((await call('/dsh-issue-priority/plan', {}, 'POST', 'text/plain')).status).toBe(415)
    const bad = await call('/dsh-issue-priority/plan', { type: 'client-request', rpcId: 'r2', method: 'sync' })
    expect(JSON.parse(bad.out).result.ok).toBe(false)
  })
})
