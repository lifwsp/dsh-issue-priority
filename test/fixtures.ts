import type { GitHubIssue, IssueJudgment, DimensionScores } from '../src/types.js'

export function issue(partial: Partial<GitHubIssue> & Pick<GitHubIssue, 'number' | 'title'>): GitHubIssue {
  return {
    body: '',
    url: `https://api.github.com/repos/o/r/issues/${partial.number}`,
    htmlUrl: `https://github.com/o/r/issues/${partial.number}`,
    labels: [],
    milestone: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    commentsCount: 0,
    blockedBy: [],
    blocks: [],
    relatedPullRequests: [],
    commentSummaries: [],
    ...partial,
  }
}

export function scores(partial: Partial<DimensionScores>): DimensionScores {
  return {
    impact: 0.5,
    urgency: 0.5,
    effort: 0.5,
    unblockValue: 0.5,
    actionability: 0.9,
    confidence: 0.9,
    ...partial,
  }
}

export function judgment(
  issueNumber: number,
  dims: Partial<DimensionScores> | null,
  extra: Partial<IssueJudgment> = {},
): IssueJudgment {
  return {
    issueNumber,
    scores: dims === null ? null : scores(dims),
    synthetic: false,
    provider: 'test',
    model: 'test-model',
    evidenceRefs: [`issue:${issueNumber}`],
    ...extra,
  }
}
