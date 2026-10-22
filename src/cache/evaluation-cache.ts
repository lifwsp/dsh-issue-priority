import { createHash } from 'node:crypto'
import type { GitHubIssue, IssueJudgment, RankingPolicyConfig } from '../types.js'

export interface CacheEntry {
  key: string
  storedAt: string
  judgments: IssueJudgment[]
}

export interface EvaluationCache {
  get(key: string): CacheEntry | undefined
  set(key: string, judgments: IssueJudgment[]): void
  clear(): void
  readonly size: number
}

export function buildCacheKey(input: {
  repo: string
  objective: string
  issues: readonly GitHubIssue[]
  policy: RankingPolicyConfig
  evaluatorKind: string
  providerId: string
  modelId: string
}): string {
  const issueFingerprint = input.issues
    .map((i) => `${i.number}:${i.updatedAt}:${i.blockedBy.join(',')}:${hashText(i.title + '\n' + i.body)}`)
    .sort()
    .join('|')

  const material = JSON.stringify({
    repo: input.repo,
    objective: input.objective,
    policyVersion: input.policy.version,
    weights: input.policy.weights,
    confidenceThreshold: input.policy.confidenceThreshold,
    evaluatorKind: input.evaluatorKind,
    providerId: input.providerId,
    modelId: input.modelId,
    issues: issueFingerprint,
  })
  return createHash('sha256').update(material).digest('hex')
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export function createMemoryCache(maxEntries = 64): EvaluationCache {
  const map = new Map<string, CacheEntry>()
  return {
    get(key) {
      return map.get(key)
    },
    set(key, judgments) {
      if (map.size >= maxEntries) {
        const first = map.keys().next().value
        if (first !== undefined) map.delete(first)
      }
      map.set(key, {
        key,
        storedAt: new Date().toISOString(),
        judgments: structuredClone(judgments),
      })
    },
    clear() {
      map.clear()
    },
    get size() {
      return map.size
    },
  }
}
