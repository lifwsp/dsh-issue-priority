const HIGH = new Set(['critical', 'urgent', 'blocker', 'highest', 'high', 'p0', 'p1', '0', '1']);
const MEDIUM = new Set(['medium', 'normal', 'mid', 'p2', '2']);
const LOW = new Set(['low', 'lowest', 'minor', 'trivial', 'p3', 'p4', '3', '4', 'someday', 'nice-to-have']);
/**
 * Priority from labels such as `priority:high`, `prio/low`, `P1`, `critical`.
 * Returns the highest level found, or null when no label says anything.
 */
export function labelPriority(labels) {
    let best = null;
    const rank = { low: 0, medium: 1, high: 2 };
    for (const raw of labels) {
        const l = raw.trim().toLowerCase();
        const m = /^(?:priority|prio|pri)\s*[:/\-_ ]\s*(.+)$/.exec(l);
        const value = m ? m[1].trim() : l;
        // Bare words only count when they are unambiguous priority labels.
        const bare = !m;
        let level = null;
        if (bare) {
            if (/^p[0-1]$/.test(value) || value === 'critical' || value === 'urgent' || value === 'blocker')
                level = 'high';
            else if (value === 'p2')
                level = 'medium';
            else if (/^p[3-4]$/.test(value))
                level = 'low';
        }
        else if (HIGH.has(value))
            level = 'high';
        else if (MEDIUM.has(value))
            level = 'medium';
        else if (LOW.has(value))
            level = 'low';
        if (level && (best === null || rank[level] > rank[best]))
            best = level;
    }
    return best;
}
const TEXT_LIMIT = 400;
function bigrams(issue) {
    const text = `${issue.title} ${issue.body.slice(0, TEXT_LIMIT)}`
        .toLowerCase()
        // Bracketed prefixes like "[検討案]" or "【提案】" are shared boilerplate.
        .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
        .replace(/[\s\p{P}\p{S}_]+/gu, '');
    const out = new Set();
    for (let i = 0; i + 1 < text.length; i += 1)
        out.add(text.slice(i, i + 2));
    return out;
}
/** Character-bigram Jaccard similarity of title + start of body (works for Japanese). */
export function textSimilarity(a, b) {
    const x = bigrams(a);
    const y = bigrams(b);
    if (!x.size || !y.size)
        return 0;
    let inter = 0;
    for (const g of x)
        if (y.has(g))
            inter += 1;
    return inter / (x.size + y.size - inter);
}
//# sourceMappingURL=signals.js.map