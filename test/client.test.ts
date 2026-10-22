/**
 * Loads client/client.js the way the DSH module loader does, with a tiny React
 * stand-in, to prove apply() binds the tab (also late) and never throws.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(join(__dirname, '..', 'client', 'client.js'), 'utf8')

function loadClient(firstState?: unknown) {
  let mod: any
  const elements: any[] = []
  let stateCalls = 0
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => {
      const el = { type, props, children }
      elements.push(el)
      return el
    },
    useState: (init: unknown) => [stateCalls++ === 0 && firstState !== undefined ? firstState : init, () => {}],
    useEffect: () => {},
  }
  const appended: any[] = []
  const window = {
    __ModuleLoader__: { load: ({ factory }: any) => { mod = factory((name: string) => { if (name !== 'react') throw new Error(name); return react }) } },
    document: {
      createElement: () => ({ setAttribute() {}, remove: vi.fn(), textContent: '' }),
      head: { appendChild: (n: unknown) => appended.push(n) },
    },
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    open: () => {},
  }
  new Function('window', source)(window)
  return { mod, elements, appended }
}

function fakeCtx(sidebar: any) {
  const effects: Array<() => void> = []
  const intervals: Array<() => void> = []
  return {
    effects,
    intervals,
    ctx: {
      get: (name: string) => (name === 'betterSidebar' ? sidebar.current : name === 'connection' ? { rpc: { call: vi.fn() } } : undefined),
      interval: (fn: () => void) => { intervals.push(fn); return vi.fn() },
      effect: (fn: () => () => void) => { effects.push(fn()) },
    },
  }
}

describe('client bundle', () => {
  it('registers the tab immediately when the sidebar exists, and tears down', () => {
    const { mod, appended } = loadClient()
    expect(mod.name).toBe('dsh-issue-priority')
    expect(mod.inject).toEqual(['connection', 'timer'])
    const dispose = vi.fn()
    const registerTab = vi.fn(() => dispose)
    const { ctx, effects } = fakeCtx({ current: { registerTab } })
    mod.apply(ctx)
    expect(registerTab).toHaveBeenCalledOnce()
    const tab = (registerTab.mock.calls[0] as any)[0]
    expect(tab.id).toBe('dsh-issue-priority:plan')
    expect(tab.title()).toBe('Issue 計画')
    expect(appended).toHaveLength(1)
    // Rendering with no data yet must not throw.
    expect(() => tab.component({ scope: { sessionId: 's1' }, visible: true })).not.toThrow()
    for (const e of effects) e()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('binds late when the sidebar arrives after the bundle', () => {
    const { mod } = loadClient()
    const sidebar: any = { current: undefined }
    const { ctx, intervals } = fakeCtx(sidebar)
    mod.apply(ctx)
    expect(intervals).toHaveLength(1)
    const registerTab = vi.fn(() => () => {})
    sidebar.current = { registerTab }
    intervals[0]!()
    expect(registerTab).toHaveBeenCalledOnce()
  })

  it('renders a full plan (packages, needs-human, warnings) without throwing', () => {
    const view = {
      repo: 'o/r',
      lastSyncAt: '2026-10-22T05:00:00Z',
      lastSyncError: null,
      nextId: 'P1',
      canKickoff: true,
      issues: { '1': { title: 'A', htmlUrl: 'https://x/1', labels: [] }, '2': { title: 'B', htmlUrl: 'https://x/2', labels: [] } },
      overrides: { '2': 'pin' },
      inProgress: { issues: [1], branch: 'issues/P1' },
      usage: { questions: 3, inputTokens: 100 },
      decisionOff: 'OPENROUTER_API_KEY が未設定',
      signals: { open: 2, withBlock: 0, withPriority: 0 },
      plan: {
        workPackages: [
          { id: 'P1', issues: [1], dependsOn: [], blockedByExternal: [], rationale: [{ kind: 'files-overlap', issues: [1, 2], files: ['a'] }], size: 1, sizeSource: {}, status: 'in_progress' },
          { id: 'P2', issues: [2], dependsOn: ['P1'], blockedByExternal: [9], rationale: [{ kind: 'hard-dependency', issue: 2, dependsOn: 1, source: 'text' }], size: 2, sizeSource: {}, status: 'waiting' },
        ],
        needsHuman: [{ issue: 3, reason: 'unclear' }],
        warnings: [{ issue: 4, kind: 'invalid-block', detail: 'bad' }],
        decision: { provider: 'openrouter', available: true, asked: 0 },
      },
    }
    const loaded = loadClient(view)
    const register = vi.fn(() => () => {})
    loaded.mod.apply(fakeCtx({ current: { registerTab: register } }).ctx)
    const planTab = (register.mock.calls[0] as any)[0].component
    const texts: string[] = []
    const titles: string[] = []
    const render = (el: any): void => {
      if (el == null || el === false) return
      if (typeof el === 'string' || typeof el === 'number') return void texts.push(String(el))
      if (Array.isArray(el)) return el.forEach(render)
      if (typeof el.type === 'function') return render(el.type(el.props))
      if (el.props?.title) titles.push(String(el.props.title))
      for (const c of el.children ?? []) render(c)
    }
    expect(() => render(planTab({ scope: { sessionId: 's1' }, visible: true }))).not.toThrow()
    const all = texts.join(' ')
    expect(all).toContain('o/r')
    expect(all).toContain('続ける')
    expect(all).toContain('#2')
    expect(all).toContain('人の判断が必要')
    expect(all).toContain('作業中を解除')
    expect(all).toContain('そのあと')
    // How the plan was made stays behind a "!" icon: visible text has no hints,
    // the tooltip carries them.
    expect(all).toContain('!')
    expect(all).not.toContain('判定モデルが止まっています')
    expect(all).not.toContain('最終同期')
    const tips = titles.join('\n')
    expect(tips).toContain('判定モデルが止まっています')
    expect(tips).toContain('#4 bad')
    expect(tips).toContain('dsh-plan ブロック付き 0 / 2 件')
    expect(tips).toContain('選んだ理由')
  })

  it('does not throw when every service is missing', () => {
    const { mod } = loadClient()
    expect(() => mod.apply({ get: () => undefined, effect: () => {} })).not.toThrow()
  })
})
