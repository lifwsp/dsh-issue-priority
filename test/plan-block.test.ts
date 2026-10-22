import { describe, expect, it } from 'vitest'
import { attachPlanBlock, parsePlanBlock, renderPlanBlock, stripPlanBlock, validatePlanBlock } from '../src/plan-block.js'

describe('plan block', () => {
  it('validates, renders and round-trips', () => {
    const v = validatePlanBlock({ areas: ['auth', 'ui'], size: 'M', files: ['src/auth/**'], dependsOn: ['#12', 3], acceptance: 'login works' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const body = attachPlanBlock('Hello', v.block)
    const parsed = parsePlanBlock(body)
    expect(parsed).toMatchObject({ found: true, ok: true, block: { areas: ['auth', 'ui'], size: 'M', dependsOn: [3, 12] } })
    expect(stripPlanBlock(body).trim()).toBe('Hello')
    // re-attaching replaces, does not duplicate
    expect(attachPlanBlock(body, v.block).match(/dsh-plan/g)).toHaveLength(1)
    expect(renderPlanBlock(v.block)).toContain('size: M')
  })

  it('rejects bad input with reasons', () => {
    const v = validatePlanBlock({ areas: ['Bad Area'], size: 'XL', files: ['/abs/path'] })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('reports a found-but-invalid block', () => {
    const p = parsePlanBlock('x\n<!-- dsh-plan\nv: 1\nsize: Q\nareas: a\n-->')
    expect(p.found).toBe(true)
    expect(p.found && p.ok).toBe(false)
    expect(parsePlanBlock('no block').found).toBe(false)
  })
})
