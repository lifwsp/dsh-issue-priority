/** Shared domain types for dsh-issue-priority (v1: work-package planning). */

export type IssueSize = 'S' | 'M' | 'L'

export const SIZE_WEIGHT: Record<IssueSize, number> = { S: 1, M: 2, L: 4 }

/** Parsed `<!-- dsh-plan -->` block. */
export interface PlanBlock {
  v: 1
  areas: string[]
  size: IssueSize
  files: string[]
  dependsOn: number[]
  acceptance?: string
}

/** One comment kept for judgment input (bots removed, code collapsed, trimmed). */
export interface ThreadPost {
  by: string
  at: string
  text: string
}

/** One Issue as kept in the local snapshot. */
export interface IssueRecord {
  number: number
  title: string
  /** Body with the dsh-plan block removed, truncated for judgment input. */
  body: string
  htmlUrl: string
  state: 'open' | 'closed'
  labels: string[]
  updatedAt: string
  closedAt: string | null
  /** Parsed planning block, or null when absent / invalid. */
  block: PlanBlock | null
  /** Why the block was rejected, when one was present but invalid. */
  blockError?: string
  /** GitHub native "blocked by" issue numbers (same repo). */
  nativeBlockedBy: number[]
  /** `blocked by #N` style phrases in body / human comments. */
  textBlockedBy: number[]
  /**
   * Human comments, oldest first. Absent on records saved before v0.5 (the
   * next sync then refetches everything once).
   */
  thread?: ThreadPost[]
  /** Issue author login (labels the body in the thread). */
  author?: string
  createdAt?: string
  /** Every `#N` mentioned in the body or human comments (for mutual-mention detection). */
  mentions: number[]
}

export type PackageStatus = 'ready' | 'waiting' | 'blocked' | 'in_progress'

export type DependencySource = 'github' | 'dsh-plan' | 'text' | 'local'

export type Rationale =
  | { kind: 'files-overlap'; issues: [number, number]; files: string[] }
  | { kind: 'area-match'; issues: [number, number]; areas: string[] }
  | { kind: 'decision-merge'; issues: [number, number]; p: number }
  | { kind: 'hard-dependency'; issue: number; dependsOn: number; source: DependencySource }
  | { kind: 'advisory-order'; before: number; after: number; p: number }
  | { kind: 'similar-text'; issues: [number, number]; similarity: number }
  | { kind: 'priority'; issue: number; level: PriorityLevel; source: PrioritySource }
  | { kind: 'unblocks'; count: number }
  | { kind: 'pinned'; issue: number }
  | { kind: 'deferred'; issue: number }

/** Importance of an issue: low / medium / high. */
export type PriorityLevel = 'low' | 'medium' | 'high'
export const PRIORITY_RANK: Record<PriorityLevel, number> = { low: 0, medium: 1, high: 2 }
export type PrioritySource = 'label' | 'decision' | 'default'

export interface WorkPackage {
  id: string
  /** Issues in the order they should be handled within one session. */
  issues: number[]
  /** Other package ids that must be finished first (hard dependencies). */
  dependsOn: string[]
  /** Open issues outside the plan (excluded / needs-human) that block this package. */
  blockedByExternal: number[]
  rationale: Rationale[]
  /** Sum of size weights (S=1, M=2, L=4). */
  size: number
  /** Where each issue's size came from, keyed by issue number. */
  sizeSource: Record<string, 'block' | 'decision' | 'default'>
  /** Highest priority among the package's issues. */
  priority: PriorityLevel
  /** Where that priority came from ('default' = nothing to go on). */
  prioritySource: PrioritySource
  /** Number of other packages that (transitively) wait for this one. */
  unblocks: number
  status: PackageStatus
  /** Prerequisites that are done but not yet closed (awaiting close): the package waits, not blocked. */
  waitingOnClose?: number[]
}

/** Open pull request (or recently merged one) that points at issues. */
export interface StoredPull {
  number: number
  state: 'open' | 'merged'
  draft: boolean
  htmlUrl: string
  head: string
  base: string
  updatedAt: string
  /** Issues named with a closing keyword (`Closes #N`) in the title / body. */
  closes: number[]
  /** Issues named only by the head branch (e.g. `issues/wp-12-13`). */
  branchRefs: number[]
}

/** How much of a local branch exists on the remote. `gone` = upstream deleted. */
export type PushState = 'none' | 'partial' | 'all' | 'gone'

export interface LocalBranch {
  branch: string
  upstream: string | null
  pushed: PushState
  /** Commits not on the upstream (all commits when there is no upstream). */
  unpushed: number
  /** Commits not on the default branch of the remote. */
  commits: number
  /** Issue → commits that mention it (`#N` anywhere in the message). */
  issues: Record<string, number>
  /** Issues the branch is clearly for: named by the branch, or a closing keyword in a commit. */
  targets: number[]
}

export interface LocalScan {
  path: string
  /** Remote default branch the branches are compared with (e.g. origin/main). */
  base: string
  scannedAt: string
  branches: LocalBranch[]
}

/** Why an open issue looks finished but is not closed yet. */
export type CloseEvidence =
  | { kind: 'marked'; at: string; branch?: string }
  | { kind: 'branch'; branch: string; commits: number; unpushed: number; pushed: PushState; upstream: string | null; mentionOnly?: boolean }
  | { kind: 'pr'; number: number; state: 'open' | 'merged'; draft: boolean; url: string; base: string; linked: 'keyword' | 'branch' }

/** What is left before the issue closes. */
export type CloseStep = 'push' | 'open-pr' | 'merge-pr' | 'close-issue' | 'check'

export interface AwaitingClose {
  issue: number
  /** marked = finished explicitly (finish / done); detected = found from git / PRs. */
  source: 'marked' | 'detected'
  step: CloseStep
  evidence: CloseEvidence[]
}

export type NeedsHumanReason = 'dependency-cycle' | 'unclear'

export interface NeedsHuman {
  issue: number
  reason: NeedsHumanReason
  detail?: string
}

export interface PlanWarning {
  issue: number
  kind: 'invalid-block' | 'unknown-area' | 'judge-failed' | 'dependency-dropped'
  detail: string
}

export interface Override {
  issue: number
  action: 'defer' | 'pin'
  at: string
}

export interface LocalDependency {
  issue: number
  dependsOn: number
  at: string
  note?: string
}

export interface ChangesSinceLast {
  new: number[]
  closed: number[]
  reordered: string[]
}

export interface Plan {
  schema: 1
  /** Planner logic version; a mismatch forces a rebuild on the next sync. */
  plannerVersion?: number
  repo: string
  generatedAt: string
  /** Ordered: first `ready` entry is the recommended next package. */
  workPackages: WorkPackage[]
  needsHuman: NeedsHuman[]
  /** Done (or worked on elsewhere) but still open: kept out of the recommendations. */
  awaitingClose?: AwaitingClose[]
  /** Git / PR activity seen for issues that stay in the plan (e.g. the one in progress). */
  activity?: Record<string, CloseEvidence[]>
  /** Non-fatal problems (e.g. an invalid dsh-plan block that was ignored). */
  warnings: PlanWarning[]
  changesSinceLast: ChangesSinceLast
  decision: {
    provider: string
    /** Model id (e.g. liquid/d1-20260930); provider is only the route. */
    model?: string
    available: boolean
    /** Decision questions asked during the sync that produced this plan. */
    asked: number
    note?: string
  }
}

export interface SizeJudgment {
  size: IssueSize
  /** Probability the issue is actionable as written. */
  actionable: number
}

export interface PriorityJudgment {
  level: PriorityLevel
  /** Expected rank 0..2 (low..high), for finer tie-breaking. */
  score: number
}

export interface MergeJudgment {
  p: number
}

export interface DirectionJudgment {
  /** 'a-first' = the lower-numbered issue of the pair should go first. */
  choice: 'a-first' | 'b-first' | 'none'
  p: number
}

export interface UsageTotals {
  requests: number
  questions: number
  inputTokens: number
}
