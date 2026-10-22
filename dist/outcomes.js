export const MAX_OUTCOMES = 200;
export function pushOutcome(list, outcome) {
    const next = [...(list ?? []), outcome];
    return next.length > MAX_OUTCOMES ? next.slice(next.length - MAX_OUTCOMES) : next;
}
const sameSet = (a, b) => a.length === b.length && a.every((n) => b.includes(n));
/** Classify a start against the plan that was current when work began. */
export function classifyStart(plan, issues) {
    const packages = plan?.workPackages ?? [];
    const recommended = packages.find((p) => p.status === 'in_progress') ?? packages.find((p) => p.status === 'ready') ?? null;
    if (recommended && sameSet(recommended.issues, issues))
        return { recommended: recommended.id, match: 'adopted' };
    if (packages.some((p) => sameSet(p.issues, issues)))
        return { recommended: recommended?.id ?? null, match: 'other-package' };
    return { recommended: recommended?.id ?? null, match: 'regrouped' };
}
export function summarizeOutcomes(list) {
    const s = { starts: 0, adopted: 0, otherPackage: 0, regrouped: 0, finishes: 0, partialFinishes: 0, overrides: 0, dependenciesAdded: 0 };
    for (const o of list ?? []) {
        if (o.kind === 'start') {
            s.starts++;
            if (o.match === 'adopted')
                s.adopted++;
            else if (o.match === 'other-package')
                s.otherPackage++;
            else
                s.regrouped++;
        }
        else if (o.kind === 'finish') {
            s.finishes++;
            if (o.partial)
                s.partialFinishes++;
        }
        else if (o.kind === 'override') {
            if (o.action !== 'clear')
                s.overrides++;
        }
        else
            s.dependenciesAdded++;
    }
    return s;
}
/** One-line Japanese summary, or null when nothing has been recorded. */
export function describeOutcomes(stats) {
    if (!stats.starts && !stats.overrides && !stats.dependenciesAdded)
        return null;
    const parts = [];
    if (stats.starts) {
        parts.push(`着手 ${stats.starts} 回のうち推奨どおり ${stats.adopted}・別パッケージ ${stats.otherPackage}・組み替え ${stats.regrouped}`);
    }
    if (stats.partialFinishes)
        parts.push(`途中で分割 ${stats.partialFinishes}`);
    if (stats.overrides)
        parts.push(`手動の優先/後回し ${stats.overrides}`);
    if (stats.dependenciesAdded)
        parts.push(`後から追加した依存 ${stats.dependenciesAdded}`);
    return parts.join(' / ');
}
//# sourceMappingURL=outcomes.js.map