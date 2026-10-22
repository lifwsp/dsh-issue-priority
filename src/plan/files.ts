/** File-overlap heuristics for bundling candidates (no I/O). */

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
        if (glob[i + 1] === '/') i += 1
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

const isGlob = (p: string) => /[*?]/.test(p)

function normalize(p: string): string {
  return p.replace(/^\.\//, '').replace(/\/+$/, '')
}

/** Directory part of a path or glob (the prefix before any wildcard segment). */
export function dirOf(p: string): string {
  const parts = normalize(p).split('/')
  const firstWild = parts.findIndex((s) => isGlob(s))
  const fixed = firstWild === -1 ? parts.slice(0, -1) : parts.slice(0, firstWild)
  return fixed.join('/')
}

function matches(a: string, b: string): boolean {
  if (a === b) return true
  if (isGlob(a) && !isGlob(b)) return globToRegExp(a).test(b)
  if (isGlob(b) && !isGlob(a)) return globToRegExp(b).test(a)
  if (isGlob(a) && isGlob(b)) return dirOf(a) === dirOf(b)
  return false
}

export interface FileOverlap {
  /** Paths that are the same file (or matched by a glob). */
  exact: string[]
  /** Directories shared without a file match ("near"). */
  near: string[]
}

export function fileOverlap(filesA: readonly string[], filesB: readonly string[]): FileOverlap {
  const a = filesA.map(normalize)
  const b = filesB.map(normalize)
  const exact = new Set<string>()
  for (const x of a) for (const y of b) if (matches(x, y)) exact.add(isGlob(x) ? y : x)
  const near = new Set<string>()
  if (exact.size === 0) {
    const dirsB = new Set(b.map(dirOf))
    for (const x of a) {
      const d = dirOf(x)
      if (d && dirsB.has(d)) near.add(`${d}/`)
    }
  }
  return { exact: [...exact].sort(), near: [...near].sort() }
}
