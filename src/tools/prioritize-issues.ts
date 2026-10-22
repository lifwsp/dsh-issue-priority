import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PipelineDeps } from '../pipeline.js'
import { prioritizeIssues } from '../pipeline.js'
import type { PrioritizeResult } from '../types.js'

function renderText(result: PrioritizeResult): string {
  const lines: string[] = [
    `Issue priority for ${result.repo} (objective: ${result.objective})`,
    `Policy ${result.rankingPolicy.version} · evaluator=${result.evaluator.kind}/${result.evaluator.provider}` +
      (result.evaluator.model ? ` · model=${result.evaluator.model}` : '') +
      (result.summary.syntheticCount > 0
        ? ` · WARNING: ${result.summary.syntheticCount} synthetic/mock judgments`
        : ''),
    `ready=${result.summary.ready} blocked=${result.summary.blocked} needs_review=${result.summary.needsReview} cache=${result.cache.hit ? 'hit' : 'miss'}`,
    '',
  ]
  for (const issue of result.issues.slice(0, 30)) {
    const score = issue.priorityScore == null ? 'n/a' : issue.priorityScore.toFixed(3)
    lines.push(
      `#${issue.rank} Issue #${issue.number} [${issue.status}] score=${score} — ${issue.title}`,
    )
    lines.push(`  ${issue.url}`)
    if (issue.status === 'blocked' && issue.blockedBy.length) {
      lines.push(`  blocked_by: ${issue.blockedBy.map((n) => `#${n}`).join(', ')}`)
    }
    if (issue.failureReason) lines.push(`  note: ${issue.failureReason}`)
    if (issue.synthetic) lines.push('  synthetic: true (mock / non-live judgment)')
  }
  return lines.join('\n')
}

export function createPrioritizeIssuesTool(getDeps: () => PipelineDeps) {
  return defineTool({
    name: 'prioritize_issues',
    description:
      'Fetch open GitHub Issues for a repository, judge them with the configured DecisionEvaluator ' +
      '(Jev / System One by default — not a chat LLM), and return a deterministic priority ranking ' +
      'toward a stated development objective. Use when the user asks what to implement next. ' +
      'Read-only: never mutates GitHub. Does not invent prose rationales — returns scores, status, ' +
      'evidence refs, and policy version so the agent can explain from structured data.',
    parameters: {
      repo: {
        type: 'string',
        required: true,
        description: 'GitHub repository as owner/repo (or https://github.com/owner/repo).',
      },
      objective: {
        type: 'string',
        required: true,
        description: 'Current development goal, e.g. "Ship MVP" or "Stabilize auth".',
      },
      limit: {
        type: 'number',
        description: 'Max open issues to evaluate (default from plugin config, typically 20).',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional GitHub label filter (AND).',
      },
      forceRefresh: {
        type: 'boolean',
        description: 'Ignore evaluation cache and re-judge.',
      },
    },
    isConcurrencySafe: () => false,
    output: {
      // Complex nested result; allow additional properties like other GitHub DSH tools.
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [
        { type: 'text', text: renderText(value as unknown as PrioritizeResult) },
      ],
    },
    async execute(args, exec) {
      const result = await prioritizeIssues(
        {
          repo: args.repo,
          objective: args.objective,
          limit: args.limit,
          labels: args.labels,
          forceRefresh: args.forceRefresh,
        },
        getDeps(),
        exec.signal,
      )
      // dsh-tools validates JSON-shaped objects; interface types lack an index signature.
      return JSON.parse(JSON.stringify(result)) as never
    },
  })
}
