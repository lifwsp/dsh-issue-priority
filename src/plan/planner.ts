/**
 * Deterministic planner: open issues → ordered work packages (design §5).
 * The decision model is consulted only through the Judge (size, merge,
 * direction); everything else is plain code so the result is reproducible.
 */
import type { Judge } from '../decision/judge.js'
import {
  SIZE_WEIGHT,
  type DependencySource,
  type IssueRecord,
  type IssueSize,
  type LocalDependency,
  type NeedsHuman,
  type Override,
  type Plan,
  type PlanWarning,
  PRIORITY_RANK,
  type PriorityLevel,
  type PrioritySource,
  type Rationale,
  type WorkPackage,
} from '../types.js'
import { fileOverlap } from './files.js'
import { labelPriority, textSimilarity } from './signals.js'

/** Bump when planning logic changes so stored plans are rebuilt. */
export const PLANNER_VERSION = 2

export interface PlannerOptions {
  repo: string
  issues: readonly IssueRecord[]
  overrides: readonly Override[]
  localDependencies: readonly LocalDependency[]
  /** Issues the user is currently working on (forced into one package). */
  inProgress: readonly number[]
  /** Known area vocabulary (for unknown-area warnings). */
  areas: readonly string[]
  judge: Judge
  previous?: Plan | null
  /** Issues observed closed since the previous plan. */
  closedSinceLast?: readonly number[]
  mergeThreshold?: number
  actionableThreshold?: number
  directionThreshold?: number
  /** Minimum text similarity for two block-less issues to become a merge candidate. */
  similarityThreshold?: number
  maxPackageSize?: number
  /** Hard cap on decision-model questions per run (cache misses only). */
  maxQuestions?: number
  now?: () => Date
  signal?: AbortSignal
}

interface Edge {
  from: number
  to: number
  source: DependencySource
}

const DEFAULT_SIZE: IssueSize = 'M'

async function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

/** Tarjan SCC; returns components with >1 node or a self-loop. */
function cyclicComponents(nodes: readonly number[], adj: Map<number, Set<number>>): number[][] {
  let index = 0
  const idx = new Map<number, number>()
  const low = new Map<number, number>()
  const stack: number[] = []
  const onStack = new Set<number>()
  const result: number[][] = []
  const visit = (v: number) => {
    idx.set(v, index)
    low.set(v, index)
    index += 1
    stack.push(v)
    onStack.add(v)
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!))
    }
    if (low.get(v) === idx.get(v)) {
      const comp: number[] = []
      let w: number
      do {
        w = stack.pop()!
        onStack.delete(w)
        comp.push(w)
      } while (w !== v)
      if (comp.length > 1 || adj.get(v)?.has(v)) result.push(comp.sort((a, b) => a - b))
    }
  }
  for (const n of nodes) if (!idx.has(n)) visit(n)
  return result
}

function hasPath(adj: Map<string, Set<string>>, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const v = stack.pop()!
    if (v === to) return true
    if (seen.has(v)) continue
    seen.add(v)
    for (const w of adj.get(v) ?? []) stack.push(w)
  }
  return false
}

/** Kahn topological sort with a priority key among available nodes. */
function topoSort<T>(nodes: readonly T[], before: (a: T) => readonly T[], key: (n: T) => readonly number[]): T[] {
  const indeg = new Map<T, number>()
  const out = new Map<T, T[]>()
  for (const n of nodes) {
    indeg.set(n, 0)
    out.set(n, [])
  }
  for (const n of nodes) {
    for (const p of before(n)) {
      if (!indeg.has(p)) continue
      indeg.set(n, indeg.get(n)! + 1)
      out.get(p)!.push(n)
    }
  }
  const cmp = (a: T, b: T) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
      const d = (ka[i] ?? 0) - (kb[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }
  const ready = nodes.filter((n) => indeg.get(n) === 0)
  const result: T[] = []
  while (ready.length) {
    ready.sort(cmp)
    const n = ready.shift()!
    result.push(n)
    for (const m of out.get(n)!) {
      indeg.set(m, indeg.get(m)! - 1)
      if (indeg.get(m) === 0) ready.push(m)
    }
  }
  // Defensive: anything left (should not happen — cycles are removed earlier).
  for (const n of nodes) if (!result.includes(n)) result.push(n)
  return result
}

export async function buildPlan(options: PlannerOptions): Promise<Plan> {
  const {
    judge,
    signal,
    mergeThreshold = 0.6,
    actionableThreshold = 0.35,
    directionThreshold = 0.6,
    similarityThreshold = 0.1,
    maxPackageSize = 4,
    maxQuestions = 200,
  } = options
  const now = options.now ?? (() => new Date())
  const warnings: PlanWarning[] = []
  const needsHuman: NeedsHuman[] = []

  const open = options.issues.filter((i) => i.state === 'open').sort((a, b) => a.number - b.number)
  const byNumber = new Map(open.map((i) => [i.number, i]))
  const knownAreas = new Set(options.areas)
  const pinned = new Set(options.overrides.filter((o) => o.action === 'pin').map((o) => o.issue))
  const deferred = new Set(options.overrides.filter((o) => o.action === 'defer').map((o) => o.issue))
  const inProgress = new Set(options.inProgress.filter((n) => byNumber.has(n)))
  const askedBefore = judge.usage.questions
  const budgetLeft = () => judge.available && judge.usage.questions - askedBefore < maxQuestions
  let skippedForBudget = 0

  // ── 1. sizes / actionability ────────────────────────────────────────────
  const sizes = new Map<number, IssueSize>()
  const sizeSource = new Map<number, 'block' | 'decision' | 'default'>()
  const excluded = new Set<number>()

  for (const issue of open) {
    if (issue.blockError) warnings.push({ issue: issue.number, kind: 'invalid-block', detail: issue.blockError })
    if (issue.block) {
      sizes.set(issue.number, issue.block.size)
      sizeSource.set(issue.number, 'block')
      for (const a of issue.block.areas) {
        if (knownAreas.size && !knownAreas.has(a)) {
          warnings.push({ issue: issue.number, kind: 'unknown-area', detail: a })
        }
      }
    }
  }
  const blockless = open.filter((i) => !i.block)
  await mapPool(blockless, 4, async (issue) => {
    if (!budgetLeft()) {
      if (judge.available) skippedForBudget += 1
      sizes.set(issue.number, DEFAULT_SIZE)
      sizeSource.set(issue.number, 'default')
      return
    }
    const j = await judge.size(issue, signal)
    if (!j) {
      sizes.set(issue.number, DEFAULT_SIZE)
      sizeSource.set(issue.number, 'default')
      return
    }
    sizes.set(issue.number, j.size)
    sizeSource.set(issue.number, 'decision')
    if (j.actionable < actionableThreshold && !pinned.has(issue.number) && !inProgress.has(issue.number)) {
      needsHuman.push({ issue: issue.number, reason: 'unclear', detail: `actionable p=${j.actionable.toFixed(2)}` })
      excluded.add(issue.number)
    }
  })

  // ── 2. hard dependencies (strongest source wins for the rationale) ─────
  const edges: Edge[] = []
  const edgeKey = new Set<string>()
  const addEdge = (from: number, to: number, source: DependencySource) => {
    if (from === to || !byNumber.has(from)) return
    const k = `${from}->${to}`
    if (edgeKey.has(k)) return
    edgeKey.add(k)
    edges.push({ from, to, source })
  }
  for (const issue of open) {
    for (const d of issue.nativeBlockedBy) addEdge(issue.number, d, 'github')
    for (const d of issue.block?.dependsOn ?? []) addEdge(issue.number, d, 'dsh-plan')
    for (const d of issue.textBlockedBy) addEdge(issue.number, d, 'text')
  }
  for (const l of options.localDependencies) addEdge(l.issue, l.dependsOn, 'local')
  // Dependencies on issues that are not open (closed, other repo, unknown) are satisfied.
  const hard = edges.filter((e) => byNumber.has(e.to))

  // ── 3. cycles → needsHuman ──────────────────────────────────────────────
  const adj = new Map<number, Set<number>>()
  for (const e of hard) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    adj.get(e.from)!.add(e.to)
  }
  for (const comp of cyclicComponents(open.map((i) => i.number), adj)) {
    for (const n of comp) {
      if (excluded.has(n)) continue
      needsHuman.push({ issue: n, reason: 'dependency-cycle', detail: comp.map((c) => `#${c}`).join(' → ') })
      excluded.add(n)
    }
  }

  const eligible = open.filter((i) => !excluded.has(i.number))
  const eligibleSet = new Set(eligible.map((i) => i.number))
  const dependsOnMap = new Map<number, Edge[]>()
  for (const e of hard) {
    if (!dependsOnMap.has(e.from)) dependsOnMap.set(e.from, [])
    dependsOnMap.get(e.from)!.push(e)
  }
  // ── 3b. priority: label > decision model > default ─────────────────────
  const priority = new Map<number, { level: PriorityLevel; score: number; source: PrioritySource }>()
  const needModel: IssueRecord[] = []
  for (const issue of eligible) {
    const fromLabel = labelPriority(issue.labels)
    if (fromLabel) priority.set(issue.number, { level: fromLabel, score: PRIORITY_RANK[fromLabel], source: 'label' })
    else needModel.push(issue)
  }
  await mapPool(needModel, 4, async (issue) => {
    const fallback = { level: 'medium' as const, score: 1, source: 'default' as const }
    if (!budgetLeft()) {
      if (judge.available) skippedForBudget += 1
      priority.set(issue.number, fallback)
      return
    }
    const j = await judge.priority(issue, signal)
    priority.set(issue.number, j ? { level: j.level, score: j.score, source: 'decision' } : fallback)
  })
  const prio = (n: number) => priority.get(n) ?? { level: 'medium' as const, score: 1, source: 'default' as const }

  const hardBetween = (a: number, b: number) => edgeKey.has(`${a}->${b}`) || edgeKey.has(`${b}->${a}`)

  // ── 4. advisory order for mutually-referencing pairs ────────────────────
  const advisory: Array<{ before: number; after: number; p: number }> = []
  const mutualPairs: Array<[IssueRecord, IssueRecord]> = []
  for (const a of eligible) {
    for (const m of a.mentions) {
      const b = byNumber.get(m)
      if (!b || b.number <= a.number || !eligibleSet.has(b.number)) continue
      if (b.mentions.includes(a.number) && !hardBetween(a.number, b.number)) mutualPairs.push([a, b])
    }
  }
  await mapPool(mutualPairs, 4, async ([a, b]) => {
    if (!budgetLeft()) {
      if (judge.available) skippedForBudget += 1
      return
    }
    const d = await judge.direction(a, b, signal)
    if (!d || d.choice === 'none' || d.p < directionThreshold) return
    advisory.push(d.choice === 'a-first' ? { before: a.number, after: b.number, p: d.p } : { before: b.number, after: a.number, p: d.p })
  })

  // ── 5. bundling candidates → union with size cap ────────────────────────
  interface Candidate {
    a: number
    b: number
    strength: number
    rationale: Rationale[]
  }
  const candidates: Candidate[] = []
  for (let i = 0; i < eligible.length; i += 1) {
    const a = eligible[i]!
    if (!a.block) continue
    for (let j = i + 1; j < eligible.length; j += 1) {
      const b = eligible[j]!
      if (!b.block) continue
      const ov = fileOverlap(a.block.files, b.block.files)
      const sharedAreas = a.block.areas.filter((x) => b.block!.areas.includes(x))
      if (!ov.exact.length && !ov.near.length && !sharedAreas.length) continue
      const rationale: Rationale[] = []
      if (ov.exact.length || ov.near.length) {
        rationale.push({ kind: 'files-overlap', issues: [a.number, b.number], files: [...ov.exact, ...ov.near] })
      }
      if (sharedAreas.length) rationale.push({ kind: 'area-match', issues: [a.number, b.number], areas: sharedAreas })
      candidates.push({
        a: a.number,
        b: b.number,
        strength: ov.exact.length ? 3 : ov.near.length ? 2 : 1,
        rationale,
      })
    }
  }

  // Block-less issues: near-duplicate wording is a (weak) candidate signal.
  // Only the decision model can accept these, and each issue contributes at
  // most its 3 most similar partners to keep the number of questions small.
  if (judge.available) {
    const paired = new Set(candidates.map((c) => `${c.a}-${c.b}`))
    const sims: Candidate[] = []
    for (let i = 0; i < eligible.length; i += 1) {
      const a = eligible[i]!
      for (let j = i + 1; j < eligible.length; j += 1) {
        const b = eligible[j]!
        if (a.block && b.block) continue
        if (paired.has(`${a.number}-${b.number}`) || hardBetween(a.number, b.number)) continue
        const s = textSimilarity(a, b)
        if (s < similarityThreshold) continue
        sims.push({ a: a.number, b: b.number, strength: s, rationale: [{ kind: 'similar-text', issues: [a.number, b.number], similarity: s }] })
      }
    }
    sims.sort((x, y) => y.strength - x.strength || x.a - y.a || x.b - y.b)
    const perIssue = new Map<number, number>()
    for (const c of sims) {
      if ((perIssue.get(c.a) ?? 0) >= 3 || (perIssue.get(c.b) ?? 0) >= 3) continue
      perIssue.set(c.a, (perIssue.get(c.a) ?? 0) + 1)
      perIssue.set(c.b, (perIssue.get(c.b) ?? 0) + 1)
      candidates.push({ ...c, strength: 0.5 })
    }
  }

  const accepted: Candidate[] = []
  await mapPool(candidates, 4, async (c) => {
    if (!judge.available) {
      // No decision model: only an exact file overlap is strong enough on its own.
      if (c.strength === 3) accepted.push(c)
      return
    }
    if (!budgetLeft()) {
      skippedForBudget += 1
      return
    }
    const m = await judge.merge(byNumber.get(c.a)!, byNumber.get(c.b)!, signal)
    if (m && m.p >= mergeThreshold) {
      accepted.push({ ...c, strength: c.strength + m.p, rationale: [...c.rationale, { kind: 'decision-merge', issues: [c.a, c.b], p: m.p }] })
    }
  })
  accepted.sort((x, y) => y.strength - x.strength || x.a - y.a || x.b - y.b)

  const groupOf = new Map<number, number>()
  const members = new Map<number, Set<number>>()
  const groupRationale = new Map<number, Rationale[]>()
  for (const i of eligible) {
    groupOf.set(i.number, i.number)
    members.set(i.number, new Set([i.number]))
    groupRationale.set(i.number, [])
  }
  const groupSize = (g: number) => [...members.get(g)!].reduce((s, n) => s + SIZE_WEIGHT[sizes.get(n) ?? DEFAULT_SIZE], 0)

  const groupGraph = (): Map<string, Set<string>> => {
    const g = new Map<string, Set<string>>()
    for (const e of hard) {
      if (!eligibleSet.has(e.from) || !eligibleSet.has(e.to)) continue
      const from = String(groupOf.get(e.from))
      const to = String(groupOf.get(e.to))
      if (from === to) continue
      if (!g.has(from)) g.set(from, new Set())
      g.get(from)!.add(to)
    }
    return g
  }
  const union = (ga: number, gb: number, rationale: Rationale[]) => {
    const keep = Math.min(ga, gb)
    const drop = Math.max(ga, gb)
    for (const n of members.get(drop)!) {
      members.get(keep)!.add(n)
      groupOf.set(n, keep)
    }
    groupRationale.set(keep, [...groupRationale.get(keep)!, ...groupRationale.get(drop)!, ...rationale])
    members.delete(drop)
    groupRationale.delete(drop)
  }

  // Issues in progress form one forced package regardless of size.
  const active = [...inProgress].filter((n) => eligibleSet.has(n)).sort((a, b) => a - b)
  for (const n of active.slice(1)) {
    const ga = groupOf.get(active[0]!)!
    const gb = groupOf.get(n)!
    if (ga !== gb) union(ga, gb, [])
  }
  const activeGroup = active.length ? groupOf.get(active[0]!)! : null

  for (const c of accepted) {
    const ga = groupOf.get(c.a)!
    const gb = groupOf.get(c.b)!
    if (ga === gb) {
      groupRationale.get(ga)!.push(...c.rationale)
      continue
    }
    if (ga === activeGroup || gb === activeGroup) continue
    if (groupSize(ga) + groupSize(gb) > maxPackageSize) continue
    // Merging must not create a cycle between packages (A→X→B with X outside).
    const g = groupGraph()
    if (hasPath(g, String(ga), String(gb)) || hasPath(g, String(gb), String(ga))) {
      const direct = (from: number, to: number) => g.get(String(from))?.has(String(to)) ?? false
      const viaOther = (from: number, to: number) =>
        [...(g.get(String(from)) ?? [])].some((mid) => mid !== String(to) && hasPath(g, mid, String(to)))
      if (viaOther(ga, gb) || viaOther(gb, ga)) continue
      if (!direct(ga, gb) && !direct(gb, ga)) continue
    }
    union(ga, gb, c.rationale)
  }

  // ── 6. order issues inside each package, then packages ──────────────────
  const issueKey = (n: number) => [pinned.has(n) ? 0 : deferred.has(n) ? 2 : 1, n]
  const softBefore = (n: number, within: Set<number>) => {
    const hardPre = (dependsOnMap.get(n) ?? []).map((e) => e.to).filter((t) => within.has(t))
    const adv = advisory.filter((a) => a.after === n && within.has(a.before)).map((a) => a.before)
    return [...new Set([...hardPre, ...adv])]
  }

  const closedOrMissing = (n: number) => !byNumber.has(n)
  const packages: WorkPackage[] = []
  const pkgOfGroup = new Map<number, WorkPackage>()
  for (const [g, set] of members) {
    let ordered = topoSort([...set], (n) => softBefore(n, set), issueKey)
    // Advisory edges could in theory conflict with hard ones; fall back to hard-only.
    const hardOnly = (n: number) => (dependsOnMap.get(n) ?? []).map((e) => e.to).filter((t) => set.has(t))
    const violates = ordered.some((n, i) => hardOnly(n).some((t) => ordered.indexOf(t) > i))
    if (violates) ordered = topoSort([...set], hardOnly, issueKey)

    const rationale: Rationale[] = [...groupRationale.get(g)!]
    const blockedByExternal = new Set<number>()
    for (const n of ordered) {
      for (const e of dependsOnMap.get(n) ?? []) {
        rationale.push({ kind: 'hard-dependency', issue: n, dependsOn: e.to, source: e.source })
        if (!eligibleSet.has(e.to) && !closedOrMissing(e.to)) blockedByExternal.add(e.to)
      }
      if (pinned.has(n)) rationale.push({ kind: 'pinned', issue: n })
      if (deferred.has(n)) rationale.push({ kind: 'deferred', issue: n })
    }
    for (const a of advisory) {
      if (set.has(a.before) || set.has(a.after)) rationale.push({ kind: 'advisory-order', ...a })
    }
    for (const n of ordered) {
      const pr = prio(n)
      if (pr.source !== 'default') rationale.push({ kind: 'priority', issue: n, level: pr.level, source: pr.source })
    }
    const pkg: WorkPackage = {
      id: `wp-${ordered.join('-')}`,
      issues: ordered,
      dependsOn: [],
      blockedByExternal: [...blockedByExternal].sort((a, b) => a - b),
      rationale: dedupeRationale(rationale),
      size: groupSize(g),
      sizeSource: Object.fromEntries(ordered.map((n) => [String(n), sizeSource.get(n) ?? 'default'])),
      ...packagePriority(ordered, prio),
      unblocks: 0,
      status: 'ready',
    }
    packages.push(pkg)
    pkgOfGroup.set(g, pkg)
  }

  const pkgDeps = new Map<WorkPackage, Set<WorkPackage>>()
  const pkgSoft = new Map<WorkPackage, Set<WorkPackage>>()
  for (const p of packages) {
    pkgDeps.set(p, new Set())
    pkgSoft.set(p, new Set())
  }
  for (const e of hard) {
    if (!eligibleSet.has(e.from) || !eligibleSet.has(e.to)) continue
    const a = pkgOfGroup.get(groupOf.get(e.from)!)!
    const b = pkgOfGroup.get(groupOf.get(e.to)!)!
    if (a !== b) pkgDeps.get(a)!.add(b)
  }
  for (const p of packages) p.dependsOn = [...pkgDeps.get(p)!].map((d) => d.id).sort()

  // Cross-package advisory edges, only when they keep the graph acyclic.
  const idGraph = new Map<string, Set<string>>(packages.map((p) => [p.id, new Set(p.dependsOn)]))
  for (const a of advisory.sort((x, y) => y.p - x.p)) {
    if (!eligibleSet.has(a.before) || !eligibleSet.has(a.after)) continue
    const before = pkgOfGroup.get(groupOf.get(a.before)!)!
    const after = pkgOfGroup.get(groupOf.get(a.after)!)!
    if (before === after || hasPath(idGraph, before.id, after.id)) continue
    idGraph.get(after.id)!.add(before.id)
    pkgSoft.get(after)!.add(before)
  }

  // How many packages (transitively) wait for each package.
  const dependents = new Map<WorkPackage, Set<WorkPackage>>(packages.map((p) => [p, new Set()]))
  for (const p of packages) for (const d of pkgDeps.get(p)!) dependents.get(d)!.add(p)
  for (const p of packages) {
    const seen = new Set<WorkPackage>()
    const stack = [...dependents.get(p)!]
    while (stack.length) {
      const q = stack.pop()!
      if (seen.has(q)) continue
      seen.add(q)
      stack.push(...dependents.get(q)!)
    }
    p.unblocks = seen.size
    if (seen.size) p.rationale.push({ kind: 'unblocks', count: seen.size })
  }

  // Among packages that are free to go: active > pinned > importance >
  // unblocks more > smaller (quick win) > lower issue number; deferred last.
  const pkgKey = (p: WorkPackage) => {
    const isActive = p.issues.some((n) => inProgress.has(n))
    const isPinned = p.issues.some((n) => pinned.has(n))
    const isDeferred = p.issues.every((n) => deferred.has(n))
    const score = Math.max(...p.issues.map((n) => prio(n).score))
    return [
      isActive ? 0 : isPinned ? 1 : isDeferred ? 3 : 2,
      -Math.round(score * 100),
      -p.unblocks,
      p.size,
      Math.min(...p.issues),
    ]
  }
  const orderedPkgs = topoSort(packages, (p) => [...pkgDeps.get(p)!, ...pkgSoft.get(p)!], pkgKey)

  // ── 7. status ────────────────────────────────────────────────────────────
  const blockedIds = new Set<string>()
  for (const p of orderedPkgs) {
    if (p.issues.some((n) => inProgress.has(n))) p.status = 'in_progress'
    else if (p.blockedByExternal.length || p.dependsOn.some((d) => blockedIds.has(d))) p.status = 'blocked'
    else if (p.dependsOn.length) p.status = 'waiting'
    else p.status = 'ready'
    if (p.status === 'blocked') blockedIds.add(p.id)
  }

  // ── 8. diff against the previous plan ───────────────────────────────────
  const prev = options.previous
  const prevIssues = new Set<number>()
  const prevIndex = new Map<string, number>()
  prev?.workPackages.forEach((p, i) => {
    prevIndex.set(p.id, i)
    p.issues.forEach((n) => prevIssues.add(n))
  })
  prev?.needsHuman.forEach((h) => prevIssues.add(h.issue))
  const changesSinceLast = {
    new: prev ? open.map((i) => i.number).filter((n) => !prevIssues.has(n)) : [],
    closed: [...(options.closedSinceLast ?? [])].sort((a, b) => a - b),
    reordered: prev
      ? orderedPkgs.filter((p, i) => prevIndex.has(p.id) && prevIndex.get(p.id) !== i).map((p) => p.id)
      : [],
  }

  const asked = judge.usage.questions - askedBefore
  const notes: string[] = []
  if (!judge.available) notes.push('decision model not configured: sizes default to M, priority from labels only, bundling uses exact file overlap only')
  if (skippedForBudget) notes.push(`${skippedForBudget} judgment(s) skipped: maxQuestionsPerSync reached`)
  if (judge.lastError) notes.push(`last decision error: ${judge.lastError}`)

  return {
    schema: 1,
    plannerVersion: PLANNER_VERSION,
    repo: options.repo,
    generatedAt: now().toISOString(),
    workPackages: orderedPkgs,
    needsHuman: needsHuman.sort((a, b) => a.issue - b.issue),
    warnings,
    changesSinceLast,
    decision: {
      provider: judge.provider,
      available: judge.available,
      asked,
      ...(notes.length ? { note: notes.join('; ') } : {}),
    },
  }
}

function packagePriority(
  issues: readonly number[],
  prio: (n: number) => { level: PriorityLevel; score: number; source: PrioritySource },
): { priority: PriorityLevel; prioritySource: PrioritySource } {
  let best = prio(issues[0]!)
  for (const n of issues.slice(1)) {
    const p = prio(n)
    if (p.score > best.score || (p.score === best.score && best.source === 'default')) best = p
  }
  return { priority: best.level, prioritySource: best.source }
}

function dedupeRationale(items: Rationale[]): Rationale[] {
  const seen = new Set<string>()
  return items.filter((r) => {
    const k = JSON.stringify(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
