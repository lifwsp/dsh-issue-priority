/** Extract explicit issue dependency numbers from free text. */
const BLOCKED_BY = /(?:blocked\s+by|depends\s+on|blocked\s+on|waiting\s+(?:on|for)|requires)\s+#(\d+)/gi;
const BLOCKS = /(?:blocks|blocking|unblocks|unlocks)\s+#(\d+)/gi;
const RELATED = /(?:related\s+to|see\s+also|part\s+of)\s+#(\d+)/gi;
function uniqueSorted(nums) {
    return [...new Set(nums)].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}
export function parseDependencies(texts) {
    const blockedBy = [];
    const blocks = [];
    const related = [];
    for (const text of texts) {
        if (!text)
            continue;
        for (const match of text.matchAll(BLOCKED_BY)) {
            const n = Number(match[1]);
            if (Number.isFinite(n))
                blockedBy.push(n);
        }
        for (const match of text.matchAll(BLOCKS)) {
            const n = Number(match[1]);
            if (Number.isFinite(n))
                blocks.push(n);
        }
        for (const match of text.matchAll(RELATED)) {
            const n = Number(match[1]);
            if (Number.isFinite(n))
                related.push(n);
        }
    }
    return {
        blockedBy: uniqueSorted(blockedBy),
        blocks: uniqueSorted(blocks),
        related: uniqueSorted(related),
    };
}
//# sourceMappingURL=dependencies.js.map