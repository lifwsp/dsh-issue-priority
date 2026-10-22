/** Shared domain types for dsh-issue-priority. */

export type IssueStatus = 'ready' | 'blocked' | 'needs_review'

export type EvaluatorKind = 'jev'

export interface RankingWeights {
  impact: number
  urgency: number
  unblockValue: number
  effort: number
}

export interface RankingPolicyConfig {
  version: string
  weights: RankingWeights
  confidenceThreshold: number
}

export interface IssueLabel {
  name: string
  color?: string
}

export interface IssueMilestone {
  title: string
  state?: string
  dueOn?: string | null
}

export interface IssueAssignee {
  login: string
}

export interface RelatedPullRequest {
  number: number
  title: string
  url: string
  state: string
}

/** Normalized GitHub Issue (never a Pull Request). */
export interface GitHubIssue {
  number: number
  title: string
  body: string
  url: string
  htmlUrl: string
  labels: IssueLabel[]
  milestone: IssueMilestone | null
  assignees: IssueAssignee[]
  createdAt: string
  updatedAt: string
  commentsCount: number
  /** Explicit dependency issue numbers parsed from body / comments. */
  blockedBy: number[]
  /** Issue numbers this issue claims to block / unlock. */
  blocks: number[]
  relatedPullRequests: RelatedPullRequest[]
  commentSummaries: string[]
}

export interface DimensionScores {
  impact: number
  urgency: number
  effort: number
  unblockValue: number
  actionability: number
  confidence: number
}

export interface IssueJudgment {
  issueNumber: number
  scores: DimensionScores | null
  /** True when answers came from an offline / synthetic provider. */
  synthetic: boolean
  provider: string
  model: string
  /** Why judgment is incomplete, when scores is null. */
  failureReason?: string
  /** Evidence refs used in the judgment state (issue fields, deps). */
  evidenceRefs: string[]
  rawAnswers?: Record<string, unknown>
}

export interface RankedIssue {
  rank: number
  number: number
  title: string
  url: string
  priorityScore: number | null
  impact: number | null
  urgency: number | null
  effort: number | null
  unblockValue: number | null
  actionability: number | null
  confidence: number | null
  status: IssueStatus
  blockedBy: number[]
  evidenceRefs: string[]
  synthetic: boolean
  provider: string
  model: string
  failureReason?: string
}

export interface PrioritizeResult {
  repo: string
  objective: string
  rankingPolicy: {
    version: string
    weights: RankingWeights
    confidenceThreshold: number
  }
  evaluator: {
    kind: EvaluatorKind
    provider: string
    model: string
    transmitting: boolean
  }
  cache: {
    hit: boolean
    storedAt?: string
  }
  issues: RankedIssue[]
  summary: {
    total: number
    ready: number
    blocked: number
    needsReview: number
    syntheticCount: number
  }
}

export interface PrioritizeIssuesArgs {
  repo: string
  objective: string
  limit?: number
  labels?: string[]
  forceRefresh?: boolean
}
