/** File-overlap heuristics for bundling candidates (no I/O). */
/** Directory part of a path or glob (the prefix before any wildcard segment). */
export declare function dirOf(p: string): string;
export interface FileOverlap {
    /** Paths that are the same file (or matched by a glob). */
    exact: string[];
    /** Directories shared without a file match ("near"). */
    near: string[];
}
export declare function fileOverlap(filesA: readonly string[], filesB: readonly string[]): FileOverlap;
/**
 * Files named by so many issues that sharing them says little about purpose
 * (entry points, registries): listed by at least 3 issues and at least a
 * quarter of the issues that name files.
 */
export declare function hubFiles(issues: ReadonlyArray<{
    block?: {
        files: readonly string[];
    } | null;
}>): Set<string>;
/**
 * Areas carried by at least 3 issues and more than half of the issues with a
 * block: a catch-all label that does not separate features.
 */
export declare function catchAllAreas(issues: ReadonlyArray<{
    block?: {
        areas: readonly string[];
    } | null;
}>): Set<string>;
//# sourceMappingURL=files.d.ts.map