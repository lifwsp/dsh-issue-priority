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
//# sourceMappingURL=files.d.ts.map