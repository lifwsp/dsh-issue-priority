import { SIZE_WEIGHT, PRIORITY_RANK, } from '../types.js';
import { fileOverlap } from './files.js';
import { labelPriority, textSimilarity } from './signals.js';
/** Bump when planning logic changes so stored plans are rebuilt. */
export const PLANNER_VERSION = 4;
const STILL_BLOCKED_THRESHOLD = 0.5;
const DEFAULT_SIZE = 'M';
async function mapPool(items, concurrency, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}
/** Tarjan SCC; returns components with >1 node or a self-loop. */
function cyclicComponents(nodes, adj) {
    let index = 0;
    const idx = new Map();
    const low = new Map();
    const stack = [];
    const onStack = new Set();
    const result = [];
    const visit = (v) => {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
        for (const w of adj.get(v) ?? []) {
            if (!idx.has(w)) {
                visit(w);
                low.set(v, Math.min(low.get(v), low.get(w)));
            }
            else if (onStack.has(w))
                low.set(v, Math.min(low.get(v), idx.get(w)));
        }
        if (low.get(v) === idx.get(v)) {
            const comp = [];
            let w;
            do {
                w = stack.pop();
                onStack.delete(w);
                comp.push(w);
            } while (w !== v);
            if (comp.length > 1 || adj.get(v)?.has(v))
                result.push(comp.sort((a, b) => a - b));
        }
    };
    for (const n of nodes)
        if (!idx.has(n))
            visit(n);
    return result;
}
function hasPath(adj, from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
        const v = stack.pop();
        if (v === to)
            return true;
        if (seen.has(v))
            continue;
        seen.add(v);
        for (const w of adj.get(v) ?? [])
            stack.push(w);
    }
    return false;
}
/** Kahn topological sort with a priority key among available nodes. */
function topoSort(nodes, before, key) {
    const indeg = new Map();
    const out = new Map();
    for (const n of nodes) {
        indeg.set(n, 0);
        out.set(n, []);
    }
    for (const n of nodes) {
        for (const p of before(n)) {
            if (!indeg.has(p))
                continue;
            indeg.set(n, indeg.get(n) + 1);
            out.get(p).push(n);
        }
    }
    const cmp = (a, b) => {
        const ka = key(a);
        const kb = key(b);
        for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
            const d = (ka[i] ?? 0) - (kb[i] ?? 0);
            if (d !== 0)
                return d;
        }
        return 0;
    };
    const ready = nodes.filter((n) => indeg.get(n) === 0);
    const result = [];
    while (ready.length) {
        ready.sort(cmp);
        const n = ready.shift();
        result.push(n);
        for (const m of out.get(n)) {
            indeg.set(m, indeg.get(m) - 1);
            if (indeg.get(m) === 0)
                ready.push(m);
        }
    }
    // Defensive: anything left (should not happen — cycles are removed earlier).
    for (const n of nodes)
        if (!result.includes(n))
            result.push(n);
    return result;
}
export async function buildPlan(options) {
    const { judge, signal, mergeThreshold = 0.6, actionableThreshold = 0.35, directionThreshold = 0.6, similarityThreshold = 0.1, maxPackageSize = 4, maxQuestions = 200, } = options;
    const now = options.now ?? (() => new Date());
    const warnings = [];
    const needsHuman = [];
    const allOpen = options.issues.filter((i) => i.state === 'open').sort((a, b) => a.number - b.number);
    const awaitingClose = (options.awaitingClose ?? []).filter((a) => allOpen.some((i) => i.number === a.issue));
    const awaiting = new Set(awaitingClose.map((a) => a.issue));
    const open = allOpen.filter((i) => !awaiting.has(i.number));
    const byNumber = new Map(open.map((i) => [i.number, i]));
    const knownAreas = new Set(options.areas);
    const pinned = new Set(options.overrides.filter((o) => o.action === 'pin').map((o) => o.issue));
    const deferred = new Set(options.overrides.filter((o) => o.action === 'defer').map((o) => o.issue));
    const inProgress = new Set(options.inProgress.filter((n) => byNumber.has(n)));
    const askedBefore = judge.usage.questions;
    const budgetLeft = () => judge.available && judge.usage.questions - askedBefore < maxQuestions;
    let skippedForBudget = 0;
    // ── 1. sizes / actionability ────────────────────────────────────────────
    const sizes = new Map();
    const sizeSource = new Map();
    const excluded = new Set();
    for (const issue of open) {
        if (issue.blockError)
            warnings.push({ issue: issue.number, kind: 'invalid-block', detail: issue.blockError });
        if (issue.block) {
            sizes.set(issue.number, issue.block.size);
            sizeSource.set(issue.number, 'block');
            for (const a of issue.block.areas) {
                if (knownAreas.size && !knownAreas.has(a)) {
                    warnings.push({ issue: issue.number, kind: 'unknown-area', detail: a });
                }
            }
        }
    }
    const blockless = open.filter((i) => !i.block);
    await mapPool(blockless, 4, async (issue) => {
        if (!budgetLeft()) {
            if (judge.available)
                skippedForBudget += 1;
            sizes.set(issue.number, DEFAULT_SIZE);
            sizeSource.set(issue.number, 'default');
            return;
        }
        const j = await judge.size(issue, signal);
        if (!j) {
            sizes.set(issue.number, DEFAULT_SIZE);
            sizeSource.set(issue.number, 'default');
            return;
        }
        sizes.set(issue.number, j.size);
        sizeSource.set(issue.number, 'decision');
        if (j.actionable < actionableThreshold && !pinned.has(issue.number) && !inProgress.has(issue.number)) {
            needsHuman.push({ issue: issue.number, reason: 'unclear', detail: `actionable p=${j.actionable.toFixed(2)}` });
            excluded.add(issue.number);
        }
    });
    // ── 2. hard dependencies (strongest source wins for the rationale) ─────
    const edges = [];
    const edgeKey = new Set();
    const addEdge = (from, to, source) => {
        if (from === to || !byNumber.has(from))
            return;
        const k = `${from}->${to}`;
        if (edgeKey.has(k))
            return;
        edgeKey.add(k);
        edges.push({ from, to, source });
    };
    for (const issue of open) {
        for (const d of issue.nativeBlockedBy)
            addEdge(issue.number, d, 'github');
        for (const d of issue.block?.dependsOn ?? [])
            addEdge(issue.number, d, 'dsh-plan');
        for (const d of issue.textBlockedBy)
            addEdge(issue.number, d, 'text');
    }
    for (const l of options.localDependencies)
        addEdge(l.issue, l.dependsOn, 'local');
    // Dependencies only found as free text (body or comments) are re-read against
    // the whole thread: a later comment may have dropped them.
    const dropped = new Set();
    const textEdges = edges.filter((e) => e.source === 'text' && byNumber.has(e.to));
    await mapPool(textEdges, 4, async (e) => {
        if (!budgetLeft()) {
            if (judge.available)
                skippedForBudget += 1;
            return;
        }
        const j = await judge.stillBlocked(byNumber.get(e.from), e.to, signal);
        if (j && j.p < STILL_BLOCKED_THRESHOLD) {
            dropped.add(`${e.from}->${e.to}`);
            warnings.push({ issue: e.from, kind: 'dependency-dropped', detail: `#${e.to} 待ちは解消済みと判断（スレッドを読んだ結果）` });
        }
    });
    for (const k of dropped)
        edgeKey.delete(k);
    // Dependencies on issues that are not open (closed, other repo, unknown) are satisfied.
    const hard = edges.filter((e) => byNumber.has(e.to) && !dropped.has(`${e.from}->${e.to}`));
    // Prerequisites that are done but not closed yet: the dependent waits for the close.
    const onClose = new Map();
    for (const e of edges) {
        if (!awaiting.has(e.to) || dropped.has(`${e.from}->${e.to}`))
            continue;
        if (!onClose.has(e.from))
            onClose.set(e.from, new Set());
        onClose.get(e.from).add(e.to);
    }
    // ── 3. cycles → needsHuman ──────────────────────────────────────────────
    const adj = new Map();
    for (const e of hard) {
        if (!adj.has(e.from))
            adj.set(e.from, new Set());
        adj.get(e.from).add(e.to);
    }
    for (const comp of cyclicComponents(open.map((i) => i.number), adj)) {
        for (const n of comp) {
            if (excluded.has(n))
                continue;
            needsHuman.push({ issue: n, reason: 'dependency-cycle', detail: comp.map((c) => `#${c}`).join(' → ') });
            excluded.add(n);
        }
    }
    const eligible = open.filter((i) => !excluded.has(i.number));
    const eligibleSet = new Set(eligible.map((i) => i.number));
    const dependsOnMap = new Map();
    for (const e of hard) {
        if (!dependsOnMap.has(e.from))
            dependsOnMap.set(e.from, []);
        dependsOnMap.get(e.from).push(e);
    }
    // ── 3b. priority: label > decision model > default ─────────────────────
    const priority = new Map();
    const needModel = [];
    for (const issue of eligible) {
        const fromLabel = labelPriority(issue.labels);
        if (fromLabel)
            priority.set(issue.number, { level: fromLabel, score: PRIORITY_RANK[fromLabel], source: 'label' });
        else
            needModel.push(issue);
    }
    await mapPool(needModel, 4, async (issue) => {
        const fallback = { level: 'medium', score: 1, source: 'default' };
        if (!budgetLeft()) {
            if (judge.available)
                skippedForBudget += 1;
            priority.set(issue.number, fallback);
            return;
        }
        const j = await judge.priority(issue, signal);
        priority.set(issue.number, j ? { level: j.level, score: j.score, source: 'decision' } : fallback);
    });
    const prio = (n) => priority.get(n) ?? { level: 'medium', score: 1, source: 'default' };
    const hardBetween = (a, b) => edgeKey.has(`${a}->${b}`) || edgeKey.has(`${b}->${a}`);
    // ── 4. advisory order for mutually-referencing pairs ────────────────────
    const advisory = [];
    const mutualPairs = [];
    for (const a of eligible) {
        for (const m of a.mentions) {
            const b = byNumber.get(m);
            if (!b || b.number <= a.number || !eligibleSet.has(b.number))
                continue;
            if (b.mentions.includes(a.number) && !hardBetween(a.number, b.number))
                mutualPairs.push([a, b]);
        }
    }
    await mapPool(mutualPairs, 4, async ([a, b]) => {
        if (!budgetLeft()) {
            if (judge.available)
                skippedForBudget += 1;
            return;
        }
        const d = await judge.direction(a, b, signal);
        if (!d || d.choice === 'none' || d.p < directionThreshold)
            return;
        advisory.push(d.choice === 'a-first' ? { before: a.number, after: b.number, p: d.p } : { before: b.number, after: a.number, p: d.p });
    });
    const candidates = [];
    for (let i = 0; i < eligible.length; i += 1) {
        const a = eligible[i];
        if (!a.block)
            continue;
        for (let j = i + 1; j < eligible.length; j += 1) {
            const b = eligible[j];
            if (!b.block)
                continue;
            const ov = fileOverlap(a.block.files, b.block.files);
            const sharedAreas = a.block.areas.filter((x) => b.block.areas.includes(x));
            if (!ov.exact.length && !ov.near.length && !sharedAreas.length)
                continue;
            const rationale = [];
            if (ov.exact.length || ov.near.length) {
                rationale.push({ kind: 'files-overlap', issues: [a.number, b.number], files: [...ov.exact, ...ov.near] });
            }
            if (sharedAreas.length)
                rationale.push({ kind: 'area-match', issues: [a.number, b.number], areas: sharedAreas });
            candidates.push({
                a: a.number,
                b: b.number,
                strength: ov.exact.length ? 3 : ov.near.length ? 2 : 1,
                rationale,
            });
        }
    }
    // Block-less issues: near-duplicate wording is a (weak) candidate signal.
    // Only the decision model can accept these, and each issue contributes at
    // most its 3 most similar partners to keep the number of questions small.
    if (judge.available) {
        const paired = new Set(candidates.map((c) => `${c.a}-${c.b}`));
        const sims = [];
        for (let i = 0; i < eligible.length; i += 1) {
            const a = eligible[i];
            for (let j = i + 1; j < eligible.length; j += 1) {
                const b = eligible[j];
                if (a.block && b.block)
                    continue;
                if (paired.has(`${a.number}-${b.number}`) || hardBetween(a.number, b.number))
                    continue;
                const s = textSimilarity(a, b);
                if (s < similarityThreshold)
                    continue;
                sims.push({ a: a.number, b: b.number, strength: s, rationale: [{ kind: 'similar-text', issues: [a.number, b.number], similarity: s }] });
            }
        }
        sims.sort((x, y) => y.strength - x.strength || x.a - y.a || x.b - y.b);
        const perIssue = new Map();
        for (const c of sims) {
            if ((perIssue.get(c.a) ?? 0) >= 3 || (perIssue.get(c.b) ?? 0) >= 3)
                continue;
            perIssue.set(c.a, (perIssue.get(c.a) ?? 0) + 1);
            perIssue.set(c.b, (perIssue.get(c.b) ?? 0) + 1);
            candidates.push({ ...c, strength: 0.5 });
        }
    }
    const accepted = [];
    await mapPool(candidates, 4, async (c) => {
        if (!judge.available) {
            // No decision model: only an exact file overlap is strong enough on its own.
            if (c.strength === 3)
                accepted.push(c);
            return;
        }
        if (!budgetLeft()) {
            skippedForBudget += 1;
            return;
        }
        const m = await judge.merge(byNumber.get(c.a), byNumber.get(c.b), signal);
        if (m && m.p >= mergeThreshold) {
            accepted.push({ ...c, strength: c.strength + m.p, rationale: [...c.rationale, { kind: 'decision-merge', issues: [c.a, c.b], p: m.p }] });
        }
    });
    accepted.sort((x, y) => y.strength - x.strength || x.a - y.a || x.b - y.b);
    const groupOf = new Map();
    const members = new Map();
    const groupRationale = new Map();
    for (const i of eligible) {
        groupOf.set(i.number, i.number);
        members.set(i.number, new Set([i.number]));
        groupRationale.set(i.number, []);
    }
    const groupSize = (g) => [...members.get(g)].reduce((s, n) => s + SIZE_WEIGHT[sizes.get(n) ?? DEFAULT_SIZE], 0);
    const groupGraph = () => {
        const g = new Map();
        for (const e of hard) {
            if (!eligibleSet.has(e.from) || !eligibleSet.has(e.to))
                continue;
            const from = String(groupOf.get(e.from));
            const to = String(groupOf.get(e.to));
            if (from === to)
                continue;
            if (!g.has(from))
                g.set(from, new Set());
            g.get(from).add(to);
        }
        return g;
    };
    const union = (ga, gb, rationale) => {
        const keep = Math.min(ga, gb);
        const drop = Math.max(ga, gb);
        for (const n of members.get(drop)) {
            members.get(keep).add(n);
            groupOf.set(n, keep);
        }
        groupRationale.set(keep, [...groupRationale.get(keep), ...groupRationale.get(drop), ...rationale]);
        members.delete(drop);
        groupRationale.delete(drop);
    };
    // Issues in progress form one forced package regardless of size.
    const active = [...inProgress].filter((n) => eligibleSet.has(n)).sort((a, b) => a - b);
    for (const n of active.slice(1)) {
        const ga = groupOf.get(active[0]);
        const gb = groupOf.get(n);
        if (ga !== gb)
            union(ga, gb, []);
    }
    const activeGroup = active.length ? groupOf.get(active[0]) : null;
    for (const c of accepted) {
        const ga = groupOf.get(c.a);
        const gb = groupOf.get(c.b);
        if (ga === gb) {
            groupRationale.get(ga).push(...c.rationale);
            continue;
        }
        if (ga === activeGroup || gb === activeGroup)
            continue;
        if (groupSize(ga) + groupSize(gb) > maxPackageSize)
            continue;
        // Merging must not create a cycle between packages (A→X→B with X outside).
        const g = groupGraph();
        if (hasPath(g, String(ga), String(gb)) || hasPath(g, String(gb), String(ga))) {
            const direct = (from, to) => g.get(String(from))?.has(String(to)) ?? false;
            const viaOther = (from, to) => [...(g.get(String(from)) ?? [])].some((mid) => mid !== String(to) && hasPath(g, mid, String(to)));
            if (viaOther(ga, gb) || viaOther(gb, ga))
                continue;
            if (!direct(ga, gb) && !direct(gb, ga))
                continue;
        }
        union(ga, gb, c.rationale);
    }
    // ── 6. order issues inside each package, then packages ──────────────────
    const issueKey = (n) => [pinned.has(n) ? 0 : deferred.has(n) ? 2 : 1, n];
    const softBefore = (n, within) => {
        const hardPre = (dependsOnMap.get(n) ?? []).map((e) => e.to).filter((t) => within.has(t));
        const adv = advisory.filter((a) => a.after === n && within.has(a.before)).map((a) => a.before);
        return [...new Set([...hardPre, ...adv])];
    };
    const closedOrMissing = (n) => !byNumber.has(n);
    const packages = [];
    const pkgOfGroup = new Map();
    for (const [g, set] of members) {
        let ordered = topoSort([...set], (n) => softBefore(n, set), issueKey);
        // Advisory edges could in theory conflict with hard ones; fall back to hard-only.
        const hardOnly = (n) => (dependsOnMap.get(n) ?? []).map((e) => e.to).filter((t) => set.has(t));
        const violates = ordered.some((n, i) => hardOnly(n).some((t) => ordered.indexOf(t) > i));
        if (violates)
            ordered = topoSort([...set], hardOnly, issueKey);
        const rationale = [...groupRationale.get(g)];
        const blockedByExternal = new Set();
        const waitingOnClose = new Set();
        for (const n of ordered)
            for (const d of onClose.get(n) ?? [])
                waitingOnClose.add(d);
        for (const n of ordered) {
            for (const e of dependsOnMap.get(n) ?? []) {
                rationale.push({ kind: 'hard-dependency', issue: n, dependsOn: e.to, source: e.source });
                if (!eligibleSet.has(e.to) && !closedOrMissing(e.to))
                    blockedByExternal.add(e.to);
            }
            if (pinned.has(n))
                rationale.push({ kind: 'pinned', issue: n });
            if (deferred.has(n))
                rationale.push({ kind: 'deferred', issue: n });
        }
        for (const a of advisory) {
            if (set.has(a.before) || set.has(a.after))
                rationale.push({ kind: 'advisory-order', ...a });
        }
        for (const n of ordered) {
            const pr = prio(n);
            if (pr.source !== 'default')
                rationale.push({ kind: 'priority', issue: n, level: pr.level, source: pr.source });
        }
        const pkg = {
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
            ...(waitingOnClose.size ? { waitingOnClose: [...waitingOnClose].sort((a, b) => a - b) } : {}),
        };
        packages.push(pkg);
        pkgOfGroup.set(g, pkg);
    }
    const pkgDeps = new Map();
    const pkgSoft = new Map();
    for (const p of packages) {
        pkgDeps.set(p, new Set());
        pkgSoft.set(p, new Set());
    }
    for (const e of hard) {
        if (!eligibleSet.has(e.from) || !eligibleSet.has(e.to))
            continue;
        const a = pkgOfGroup.get(groupOf.get(e.from));
        const b = pkgOfGroup.get(groupOf.get(e.to));
        if (a !== b)
            pkgDeps.get(a).add(b);
    }
    for (const p of packages)
        p.dependsOn = [...pkgDeps.get(p)].map((d) => d.id).sort();
    // Cross-package advisory edges, only when they keep the graph acyclic.
    const idGraph = new Map(packages.map((p) => [p.id, new Set(p.dependsOn)]));
    for (const a of advisory.sort((x, y) => y.p - x.p)) {
        if (!eligibleSet.has(a.before) || !eligibleSet.has(a.after))
            continue;
        const before = pkgOfGroup.get(groupOf.get(a.before));
        const after = pkgOfGroup.get(groupOf.get(a.after));
        if (before === after || hasPath(idGraph, before.id, after.id))
            continue;
        idGraph.get(after.id).add(before.id);
        pkgSoft.get(after).add(before);
    }
    // How many packages (transitively) wait for each package.
    const dependents = new Map(packages.map((p) => [p, new Set()]));
    for (const p of packages)
        for (const d of pkgDeps.get(p))
            dependents.get(d).add(p);
    for (const p of packages) {
        const seen = new Set();
        const stack = [...dependents.get(p)];
        while (stack.length) {
            const q = stack.pop();
            if (seen.has(q))
                continue;
            seen.add(q);
            stack.push(...dependents.get(q));
        }
        p.unblocks = seen.size;
        if (seen.size)
            p.rationale.push({ kind: 'unblocks', count: seen.size });
    }
    // Among packages that are free to go: active > pinned > importance >
    // unblocks more > smaller (quick win) > lower issue number; deferred last.
    const pkgKey = (p) => {
        const isActive = p.issues.some((n) => inProgress.has(n));
        const isPinned = p.issues.some((n) => pinned.has(n));
        const isDeferred = p.issues.every((n) => deferred.has(n));
        const score = Math.max(...p.issues.map((n) => prio(n).score));
        return [
            isActive ? 0 : isPinned ? 1 : isDeferred ? 3 : 2,
            -Math.round(score * 100),
            -p.unblocks,
            p.size,
            Math.min(...p.issues),
        ];
    };
    const orderedPkgs = topoSort(packages, (p) => [...pkgDeps.get(p), ...pkgSoft.get(p)], pkgKey);
    // ── 7. status ────────────────────────────────────────────────────────────
    const blockedIds = new Set();
    for (const p of orderedPkgs) {
        if (p.issues.some((n) => inProgress.has(n)))
            p.status = 'in_progress';
        else if (p.blockedByExternal.length || p.dependsOn.some((d) => blockedIds.has(d)))
            p.status = 'blocked';
        else if (p.dependsOn.length || p.waitingOnClose?.length)
            p.status = 'waiting';
        else
            p.status = 'ready';
        if (p.status === 'blocked')
            blockedIds.add(p.id);
    }
    // ── 8. diff against the previous plan ───────────────────────────────────
    const prev = options.previous;
    const prevIssues = new Set();
    const prevIndex = new Map();
    prev?.workPackages.forEach((p, i) => {
        prevIndex.set(p.id, i);
        p.issues.forEach((n) => prevIssues.add(n));
    });
    prev?.needsHuman.forEach((h) => prevIssues.add(h.issue));
    prev?.awaitingClose?.forEach((a) => prevIssues.add(a.issue));
    const changesSinceLast = {
        new: prev ? allOpen.map((i) => i.number).filter((n) => !prevIssues.has(n)) : [],
        closed: [...(options.closedSinceLast ?? [])].sort((a, b) => a - b),
        reordered: prev
            ? orderedPkgs.filter((p, i) => prevIndex.has(p.id) && prevIndex.get(p.id) !== i).map((p) => p.id)
            : [],
    };
    const asked = judge.usage.questions - askedBefore;
    // The API reports the dated model id (liquid/d1-20260930) only when asked; on a
    // fully cached run keep the id the previous plan recorded for the same route.
    const prevDecision = options.previous?.decision;
    const decisionModel = !judge.available
        ? undefined
        : asked === 0 && prevDecision?.provider === judge.provider && prevDecision.model
            ? prevDecision.model
            : judge.model;
    const notes = [];
    if (!judge.available)
        notes.push('decision model not configured: sizes default to M, priority from labels only, bundling uses exact file overlap only');
    if (skippedForBudget)
        notes.push(`${skippedForBudget} judgment(s) skipped: maxQuestionsPerSync reached`);
    if (judge.lastError)
        notes.push(`last decision error: ${judge.lastError}`);
    return {
        schema: 1,
        plannerVersion: PLANNER_VERSION,
        repo: options.repo,
        generatedAt: now().toISOString(),
        workPackages: orderedPkgs,
        needsHuman: needsHuman.sort((a, b) => a.issue - b.issue),
        awaitingClose,
        ...(options.activity && Object.keys(options.activity).length ? { activity: options.activity } : {}),
        warnings,
        changesSinceLast,
        decision: {
            provider: judge.provider,
            ...(decisionModel ? { model: decisionModel } : {}),
            available: judge.available,
            asked,
            ...(notes.length ? { note: notes.join('; ') } : {}),
        },
    };
}
function packagePriority(issues, prio) {
    let best = prio(issues[0]);
    for (const n of issues.slice(1)) {
        const p = prio(n);
        if (p.score > best.score || (p.score === best.score && best.source === 'default'))
            best = p;
    }
    return { priority: best.level, prioritySource: best.source };
}
function dedupeRationale(items) {
    const seen = new Set();
    return items.filter((r) => {
        const k = JSON.stringify(r);
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}
//# sourceMappingURL=planner.js.map