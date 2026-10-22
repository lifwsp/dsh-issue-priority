/** File-overlap heuristics for bundling candidates (no I/O). */
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i += 1) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                re += '.*';
                i += 1;
                if (glob[i + 1] === '/')
                    i += 1;
            }
            else
                re += '[^/]*';
        }
        else if (c === '?')
            re += '[^/]';
        else
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}
const isGlob = (p) => /[*?]/.test(p);
function normalize(p) {
    return p.replace(/^\.\//, '').replace(/\/+$/, '');
}
/** Directory part of a path or glob (the prefix before any wildcard segment). */
export function dirOf(p) {
    const parts = normalize(p).split('/');
    const firstWild = parts.findIndex((s) => isGlob(s));
    const fixed = firstWild === -1 ? parts.slice(0, -1) : parts.slice(0, firstWild);
    return fixed.join('/');
}
function matches(a, b) {
    if (a === b)
        return true;
    if (isGlob(a) && !isGlob(b))
        return globToRegExp(a).test(b);
    if (isGlob(b) && !isGlob(a))
        return globToRegExp(b).test(a);
    if (isGlob(a) && isGlob(b))
        return dirOf(a) === dirOf(b);
    return false;
}
export function fileOverlap(filesA, filesB) {
    const a = filesA.map(normalize);
    const b = filesB.map(normalize);
    const exact = new Set();
    for (const x of a)
        for (const y of b)
            if (matches(x, y))
                exact.add(isGlob(x) ? y : x);
    const near = new Set();
    if (exact.size === 0) {
        const dirsB = new Set(b.map(dirOf));
        for (const x of a) {
            const d = dirOf(x);
            if (d && dirsB.has(d))
                near.add(`${d}/`);
        }
    }
    return { exact: [...exact].sort(), near: [...near].sort() };
}
/**
 * Files named by so many issues that sharing them says little about purpose
 * (entry points, registries): listed by at least 3 issues and at least a
 * quarter of the issues that name files.
 */
export function hubFiles(issues) {
    const count = new Map();
    let naming = 0;
    for (const i of issues) {
        const files = new Set((i.block?.files ?? []).filter((f) => !isGlob(f)).map(normalize));
        if (files.size)
            naming += 1;
        for (const f of files)
            count.set(f, (count.get(f) ?? 0) + 1);
    }
    const min = Math.max(3, Math.ceil(naming / 4));
    return new Set([...count].filter(([, n]) => n >= min).map(([f]) => f));
}
/**
 * Areas carried by at least 3 issues and more than half of the issues with a
 * block: a catch-all label that does not separate features.
 */
export function catchAllAreas(issues) {
    const count = new Map();
    let withBlock = 0;
    for (const i of issues) {
        if (!i.block)
            continue;
        withBlock += 1;
        for (const a of new Set(i.block.areas))
            count.set(a, (count.get(a) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n >= 3 && n * 2 > withBlock).map(([a]) => a));
}
//# sourceMappingURL=files.js.map