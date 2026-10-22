import { describe, expect, it, vi } from 'vitest'
import { apply, name, inject } from '../src/index.js'

describe('plugin registration', () => {
  it('registers prioritize_issues via tools and cleans up through effect dispose', () => {
    expect(name).toBe('dsh-issue-priority')
    expect(inject).toContain('tools')

    const disposers: Array<() => void> = []
    const register = vi.fn((tool: { name: string }) => {
      expect(tool.name).toBe('prioritize_issues')
      return () => {
        /* unregister */
      }
    })

    const ctx = {
      tools: { register },
      effect: (fn: () => (() => void) | void) => {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      get: (key: string) => {
        if (key === 'jev') {
          return {
            providerId: 'mock',
            transmitting: false,
            ask: async () => ({
              model: 'mock',
              provider: 'mock',
              warning: 'synthetic',
              answers: {},
            }),
          }
        }
        return undefined
      },
      logger: () => console,
    }

    apply(ctx as never, { logLevel: 'silent', allowExternalJudgment: false })
    expect(register).toHaveBeenCalledTimes(1)
    // Simulate unload: run disposers (Cordis does this when the fiber exits).
    for (const d of disposers) d()
  })
})
