import { describe, expect, it, vi } from 'vitest'
import { JevDecisionEvaluator, requireJevService } from '../src/decision/jev-evaluator.js'
import { DecisionEvaluatorError } from '../src/decision/evaluator.js'
import { issue } from './fixtures.js'

function mockJev(overrides: Partial<{ providerId: string; transmitting: boolean; ask: ReturnType<typeof vi.fn> }> = {}) {
  return {
    providerId: overrides.providerId ?? 'mock',
    transmitting: overrides.transmitting ?? false,
    ask:
      overrides.ask ??
      vi.fn(async () => ({
        model: 'mock-jev',
        provider: 'mock',
        warning: 'synthetic mock answer',
        answers: {
          impact: { type: 'score', score: 3, confidence: 0.8, probabilities: { '3': 0.8 } },
          urgency: { type: 'score', score: 2, confidence: 0.7, probabilities: { '2': 0.7 } },
          effort: { type: 'score', score: 1, confidence: 0.75, probabilities: { '1': 0.75 } },
          unblockValue: { type: 'score', score: 2, confidence: 0.7, probabilities: { '2': 0.7 } },
          actionable: { type: 'noul', noul: 0.9 },
        },
      })),
  }
}

describe('JevDecisionEvaluator', () => {
  it('marks mock results as synthetic', async () => {
    const evaluator = new JevDecisionEvaluator({ jev: mockJev(), allowExternalJudgment: false })
    const [result] = await evaluator.evaluateIssues([issue({ number: 1, title: 't' })], {
      objective: 'MVP',
    })
    expect(result?.synthetic).toBe(true)
    expect(result?.provider).toBe('mock')
    expect(result?.scores?.impact).toBeCloseTo(0.75, 5) // 3/4
  })

  it('refuses external transmission when allowExternalJudgment is false', async () => {
    const evaluator = new JevDecisionEvaluator({
      jev: mockJev({ transmitting: true, providerId: 'live' }),
      allowExternalJudgment: false,
    })
    await expect(
      evaluator.evaluateIssues([issue({ number: 1, title: 't' })], { objective: 'MVP' }),
    ).rejects.toBeInstanceOf(DecisionEvaluatorError)
  })

  it('returns needs_review-shaped judgment on ask failure (no invented scores)', async () => {
    const ask = vi.fn(async () => {
      throw new Error('upstream down')
    })
    const evaluator = new JevDecisionEvaluator({ jev: mockJev({ ask }), allowExternalJudgment: true })
    const [result] = await evaluator.evaluateIssues([issue({ number: 4, title: 't' })], {
      objective: 'MVP',
    })
    expect(result?.scores).toBeNull()
    expect(result?.failureReason).toMatch(/upstream down/)
  })

  it('requireJevService throws when missing', () => {
    expect(() => requireJevService({ get: () => undefined })).toThrow(DecisionEvaluatorError)
  })
})
