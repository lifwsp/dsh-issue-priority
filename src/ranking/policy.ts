import type {
  GitHubIssue,
  IssueJudgment,
  IssueStatus,
  RankedIssue,
  RankingPolicyConfig,
  RankingWeights,
} from '../types.js'

export const RANKING_POLICY_VERSION = '1.0.0'

export const DEFAULT_WEIGHTS: RankingWeights = {
  impact: 0.35,
  urgency: 0.25,
  unblockValue: 0.25,
  effort: 0.15,
}

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.55

export function defaultRankingPolicy(
  overrides?: Partial<RankingPolicyConfig> & { weights?: Partial<RankingWeights> },
): RankingPolicyConfig {
  return {
    version: overrides?.version ?? RANKING_POLICY_VERSION,
    confidenceThreshold: overrides?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    weights: {
      ...DEFAULT_WEIGHTS,
      ...(overrides?.weights ?? {}),
    },
  }
}

/**
 * priority = wI·impact + wU·urgency + wB·unblock − wE·effort
 *
 * All dimension inputs are expected in [0, 1]. Effort is a cost term.
 */
export function computePriorityScore(
  scores: { impact: number; urgency: number; unblockValue: number; effort: number },
  weights: RankingWeights,
): number {
  const raw =
    weights.impact * scores.impact +
    weights.urgency * scores.urgency +
    weights.unblockValue * scores.unblockValue -
    weights.effort * scores.effort
  // Keep a stable numeric range roughly in [-wE, wI+wU+wB]
  return Number(raw.toFixed(6))
}

function unresolvedBlockers(issue: GitHubIssue): number[] {
  // Explicit dependencies always block until resolved. Numbers outside the
  // evaluated set are still treated as blockers — we refuse to assume they are done.
  return issue.blockedBy.filter((n) => n !== issue.number)
}

function decideStatus(
  judgment: IssueJudgment,
  issue: GitHubIssue,
  confidenceThreshold: number,
): { status: IssueStatus; blockedBy: number[] } {
  const blockedBy = unresolvedBlockers(issue)

  if (!judgment.scores) {
    return { status: 'needs_review', blockedBy }
  }
  if (judgment.scores.confidence < confidenceThreshold) {
    return { status: 'needs_review', blockedBy }
  }
  if (blockedBy.length > 0) {
    return { status: 'blocked', blockedBy }
  }
  // Soft signal from Jev: low actionability with otherwise OK confidence → blocked
  // only when clearly not actionable (< 0.4). Mid values stay ready so the agent
  // can still propose the issue with the score visible.
  if (judgment.scores.actionability < 0.4) {
    return { status: 'blocked', blockedBy }
  }
  return { status: 'ready', blockedBy: [] }
}

/**
 * Deterministic ranking. Stable tie-break: higher priorityScore, then lower
 * issue number, then title.
 *
 * Ready issues are ordered first among equals of the same score band only via
 * the numeric score; status is reported separately so a high-scoring blocked
 * issue is never silently promoted to "do next".
 */
export function rankIssues(
  issues: readonly GitHubIssue[],
  judgments: readonly IssueJudgment[],
  policy: RankingPolicyConfig,
): RankedIssue[] {
  const byNumber = new Map(judgments.map((j) => [j.issueNumber, j]))

  const rows: RankedIssue[] = issues.map((issue) => {
    const judgment =
      byNumber.get(issue.number) ??
      ({
        issueNumber: issue.number,
        scores: null,
        synthetic: false,
        provider: 'unknown',
        model: 'unknown',
        failureReason: 'Missing judgment',
        evidenceRefs: [`issue:${issue.number}`],
      } satisfies IssueJudgment)

    const { status, blockedBy } = decideStatus(judgment, issue, policy.confidenceThreshold)
    const scores = judgment.scores
    const priorityScore = scores ? computePriorityScore(scores, policy.weights) : null

    return {
      rank: 0,
      number: issue.number,
      title: issue.title,
      url: issue.htmlUrl,
      priorityScore,
      impact: scores?.impact ?? null,
      urgency: scores?.urgency ?? null,
      effort: scores?.effort ?? null,
      unblockValue: scores?.unblockValue ?? null,
      actionability: scores?.actionability ?? null,
      confidence: scores?.confidence ?? null,
      status,
      blockedBy,
      evidenceRefs: judgment.evidenceRefs,
      synthetic: judgment.synthetic,
      provider: judgment.provider,
      model: judgment.model,
      failureReason: judgment.failureReason,
    }
  })

  // Sort key: ready first (so "next to implement" surfaces), then by score desc,
  // then blocked, then needs_review. Within a status, score then issue number.
  const statusOrder: Record<IssueStatus, number> = { ready: 0, blocked: 1, needs_review: 2 }

  rows.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status]
    if (so !== 0) return so
    const as = a.priorityScore
    const bs = b.priorityScore
    if (as == null && bs == null) return a.number - b.number
    if (as == null) return 1
    if (bs == null) return -1
    if (bs !== as) return bs - as
    if (a.number !== b.number) return a.number - b.number
    return a.title.localeCompare(b.title)
  })

  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

/**
 * When A is blocked by B and B is in the set, B should appear before A among
 * ready/blocked recommendations. The primary sort already prefers ready; this
 * pass does a stable dependency-aware reorder within the ready+blocked prefix
 * without changing needs_review placement.
 */
export function applyDependencyHints(ranked: RankedIssue[]): RankedIssue[] {
  const index = new Map(ranked.map((r, i) => [r.number, i]))
  const result = [...ranked]

  // One bubble pass: if a blocked issue's dependency appears later, swap toward it.
  let moved = true
  let guard = 0
  while (moved && guard < result.length * result.length) {
    moved = false
    guard += 1
    for (let i = 0; i < result.length; i += 1) {
      const row = result[i]!
      if (row.status === 'needs_review') continue
      for (const dep of row.blockedBy) {
        const depIndex = index.get(dep)
        if (depIndex == null) continue
        if (depIndex > i) {
          const depRow = result[depIndex]!
          // Move dependency just before the blocked issue.
          result.splice(depIndex, 1)
          result.splice(i, 0, depRow)
          // Rebuild index
          for (let j = 0; j < result.length; j += 1) index.set(result[j]!.number, j)
          moved = true
          break
        }
      }
      if (moved) break
    }
  }

  return result.map((row, i) => ({ ...row, rank: i + 1 }))
}
