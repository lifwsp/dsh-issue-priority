/**
 * The only three things the decision model is asked (design §5.3):
 * 1. size + actionable — for issues without a valid dsh-plan block
 * 2. merge             — for candidate pairs the code already found
 * 3. direction         — for pairs that mention each other
 *
 * Every answer is cached under a hash of exactly the inputs it saw, so an
 * unchanged issue is never re-asked (judge only on diff).
 */
import { createHash } from 'node:crypto'
import type { DirectionJudgment, IssueRecord, IssueSize, MergeJudgment, SizeJudgment, UsageTotals } from '../types.js'
import type { DecisionAnswer, DecisionClient, DecisionQuestion } from './client.js'

/** Bump when question wording changes so cached answers are re-asked. */
export const QUESTION_VERSION = 'q1'
const BODY_LIMIT = 1200

export interface JudgmentStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export interface Judge {
  readonly available: boolean
  readonly provider: string
  size(issue: IssueRecord, signal?: AbortSignal): Promise<SizeJudgment | null>
  merge(a: IssueRecord, b: IssueRecord, signal?: AbortSignal): Promise<MergeJudgment | null>
  direction(a: IssueRecord, b: IssueRecord, signal?: AbortSignal): Promise<DirectionJudgment | null>
  /** Questions actually sent (cache misses) since construction. */
  readonly usage: UsageTotals
  /** Last error message, if any call failed (calls fail soft → null). */
  readonly lastError?: string
}

function hash(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)
}

function issueState(issue: IssueRecord): Record<string, unknown> {
  return {
    number: issue.number,
    title: issue.title,
    labels: issue.labels,
    body: issue.body.length > BODY_LIMIT ? `${issue.body.slice(0, BODY_LIMIT)}…` : issue.body,
    ...(issue.block ? { areas: issue.block.areas, files: issue.block.files } : {}),
  }
}

const SIZE_Q: DecisionQuestion = {
  type: 'score',
  instructions:
    'How much implementation work does this GitHub issue need for one developer working with an AI coding agent?',
  criteria: [
    'S: small, about an hour or less (typo, config, one small function)',
    'M: medium, about half a day (a feature touching a few files)',
    'L: large, a day or more, or should be split into several issues',
  ],
}

const ACTIONABLE_Q: DecisionQuestion = {
  type: 'noul',
  instructions: 'Could a developer start implementing this issue now without asking the author for clarification?',
  criteria: {
    true: 'The goal and expected behaviour are clear enough to start',
    false: 'Requirements are missing, contradictory, or it is only a discussion / question',
  },
}

const MERGE_Q: DecisionQuestion = {
  type: 'noul',
  instructions:
    'Should these two GitHub issues be fixed together in one branch and one pull request by the same developer, ' +
    'because they change the same code or one fix naturally includes the other?',
  criteria: {
    true: 'Doing them in one change is clearly simpler than doing them separately',
    false: 'They are independent changes that merely share a topic',
  },
}

const DIRECTION_Q: DecisionQuestion = {
  type: 'choice',
  instructions: 'These two issues reference each other. Which one should be implemented first?',
  criteria: {
    'a-first': 'Issue A should be done before issue B',
    'b-first': 'Issue B should be done before issue A',
    none: 'Order does not matter',
  },
}

function scoreToSize(answer: DecisionAnswer | undefined): IssueSize | null {
  if (!answer || answer.type !== 'score' || !Number.isFinite(answer.score)) return null
  return answer.score < 0.5 ? 'S' : answer.score < 1.5 ? 'M' : 'L'
}

function noulValue(answer: DecisionAnswer | undefined): number | null {
  return answer && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null
}

export function createJudge(client: DecisionClient | null, store: JudgmentStore, providerLabel?: string): Judge {
  const usage: UsageTotals = { requests: 0, questions: 0, inputTokens: 0 }
  let lastError: string | undefined

  async function ask(
    state: Record<string, unknown>,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal,
  ): Promise<Record<string, DecisionAnswer> | null> {
    if (!client) return null
    try {
      const res = await client.ask({ state, questions, signal })
      usage.requests += 1
      usage.questions += Object.keys(questions).length
      usage.inputTokens += res.usage.input_tokens
      return res.answers
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  async function cached<T>(key: string, compute: () => Promise<T | null>): Promise<T | null> {
    const hit = store.get(key)
    if (hit !== undefined) return hit as T
    const value = await compute()
    if (value !== null) store.set(key, value)
    return value
  }

  const pairState = (a: IssueRecord, b: IssueRecord) => ({ A: issueState(a), B: issueState(b) })

  return {
    get available() {
      return client !== null
    },
    provider: providerLabel ?? client?.provider ?? 'none',
    usage,
    get lastError() {
      return lastError
    },

    size(issue, signal) {
      const state = issueState(issue)
      return cached(`size:${QUESTION_VERSION}:${issue.number}:${hash(state)}`, async () => {
        const answers = await ask(state, { size: SIZE_Q, actionable: ACTIONABLE_Q }, signal)
        if (!answers) return null
        const size = scoreToSize(answers.size)
        const actionable = noulValue(answers.actionable)
        if (!size || actionable === null) return null
        return { size, actionable } satisfies SizeJudgment
      })
    },

    merge(a, b, signal) {
      const [x, y] = a.number < b.number ? [a, b] : [b, a]
      const state = pairState(x, y)
      return cached(`merge:${QUESTION_VERSION}:${x.number}-${y.number}:${hash(state)}`, async () => {
        const answers = await ask(state, { merge: MERGE_Q }, signal)
        const p = noulValue(answers?.merge)
        return p === null ? null : ({ p } satisfies MergeJudgment)
      })
    },

    direction(a, b, signal) {
      const [x, y] = a.number < b.number ? [a, b] : [b, a]
      const state = pairState(x, y)
      return cached(`direction:${QUESTION_VERSION}:${x.number}-${y.number}:${hash(state)}`, async () => {
        const answers = await ask(state, { order: DIRECTION_Q }, signal)
        const ans = answers?.order
        if (!ans || ans.type !== 'choice') return null
        const choice = ans.choice === 'a-first' || ans.choice === 'b-first' ? ans.choice : 'none'
        const p = ans.probabilities[ans.choice] ?? ans.confidence ?? 0
        return { choice, p } satisfies DirectionJudgment
      })
    },
  }
}
