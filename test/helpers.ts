import type { DecisionClient, DecisionRequest, DecisionResponse } from '../src/decision/client.js'
import type { FetchedIssue, GitHubIssueSource, ListIssuesSinceOptions } from '../src/github/adapter.js'
import { renderPlanBlock } from '../src/plan-block.js'
import type { IssueRecord, PlanBlock } from '../src/types.js'

export function rec(n: number, over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    number: n,
    title: `Issue ${n}`,
    body: `body ${n}`,
    htmlUrl: `https://github.com/o/r/issues/${n}`,
    state: 'open',
    labels: [],
    updatedAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    block: null,
    nativeBlockedBy: [],
    textBlockedBy: [],
    mentions: [],
    ...over,
  }
}

export function block(over: Partial<PlanBlock> = {}): PlanBlock {
  return { v: 1, areas: ['core'], size: 'S', files: [], dependsOn: [], ...over }
}

export function fetched(n: number, over: Partial<FetchedIssue> & { planBlock?: PlanBlock } = {}): FetchedIssue {
  const { planBlock, body, ...rest } = over
  return {
    number: n,
    title: `Issue ${n}`,
    body: `${body ?? `body ${n}`}${planBlock ? `\n\n${renderPlanBlock(planBlock)}` : ''}`,
    htmlUrl: `https://github.com/o/r/issues/${n}`,
    state: 'open',
    labels: [],
    updatedAt: '2026-10-01T00:00:00Z',
    closedAt: null,
    nativeBlockedBy: [],
    comments: [],
    ...rest,
  }
}

export class FakeGitHub implements GitHubIssueSource {
  id = 'fake'
  calls: ListIssuesSinceOptions[] = []
  constructor(public issues: FetchedIssue[]) {}
  async listIssuesSince(o: ListIssuesSinceOptions): Promise<FetchedIssue[]> {
    this.calls.push(o)
    if (!o.since) return this.issues.filter((i) => i.state === 'open')
    return this.issues.filter((i) => i.updatedAt > o.since!)
  }
}

/** Decision client answering via a callback per question id. */
export class FakeDecision implements DecisionClient {
  provider = 'fake'
  requests: DecisionRequest[] = []
  constructor(private readonly answer: (qid: string, req: DecisionRequest) => unknown) {}
  async ask(req: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(req)
    const answers: Record<string, unknown> = {}
    for (const qid of Object.keys(req.questions)) answers[qid] = this.answer(qid, req)
    return { model: 'fake', answers: answers as DecisionResponse['answers'], usage: { input_tokens: 100, output_tokens: 0 } }
  }
}

export const silentLogger = { warn() {}, info() {}, debug() {} }
