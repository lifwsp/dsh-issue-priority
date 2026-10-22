import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/index.js'

describe('plugin registration', () => {
  it('registers tools, the /issues command and skills, all disposable', () => {
    expect(name).toBe('dsh-issue-priority')
    expect(inject).toEqual(expect.arrayContaining(['tools', 'commands', 'skills']))
    const disposers: Array<() => void> = []
    const tools = vi.fn(() => () => {})
    const commands = vi.fn(() => () => {})
    const skills = vi.fn(() => () => {})
    const ctx = {
      tools: { register: tools },
      commands: { register: commands },
      skills: { register: skills },
      effect: (fn: () => (() => void) | void) => {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
      get: () => undefined,
      interval: vi.fn(() => () => {}),
      setTimeout: vi.fn(() => () => {}),
    }
    apply(ctx as never, { logLevel: 'silent', dataDir: mkdtempSync(join(tmpdir(), 'dip-')) })
    expect(tools.mock.calls.map((c: any[]) => c[0].name).sort()).toEqual(['issue_draft', 'issue_plan_read', 'issue_plan_update'])
    expect(commands.mock.calls.map((c: any[]) => c[0].name)).toEqual(['issues'])
    expect(skills.mock.calls.map((c: any[]) => c[0].name).sort()).toEqual(['issue-authoring', 'issue-work'])
    expect(ctx.interval).toHaveBeenCalledWith(expect.any(Function), 60 * 60_000)
    for (const d of disposers) d()
  })
})
