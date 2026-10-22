import { describe, expect, it } from 'vitest'
import { labelPriority, textSimilarity } from '../src/plan/signals.js'
import { rec } from './helpers.js'

describe('labelPriority', () => {
  it('reads common priority labels', () => {
    expect(labelPriority(['priority:high'])).toBe('high')
    expect(labelPriority(['prio/low', 'bug'])).toBe('low')
    expect(labelPriority(['P1'])).toBe('high')
    expect(labelPriority(['priority: medium', 'critical'])).toBe('high')
    expect(labelPriority(['bug', 'enhancement', 'high-contrast'])).toBeNull()
  })
})

describe('textSimilarity', () => {
  it('ignores bracketed prefixes and scores Japanese text', () => {
    const a = rec(1, { title: '[検討案] 空欄確認を残作業中心で表示する', body: '' })
    const b = rec(2, { title: '[検討案] 空欄確認の表示を残作業で示す', body: '' })
    const c = rec(3, { title: '[検討案] 認証トークンの更新', body: '' })
    expect(textSimilarity(a, b)).toBeGreaterThan(textSimilarity(a, c))
    expect(textSimilarity(a, c)).toBeLessThan(0.1)
  })
})
