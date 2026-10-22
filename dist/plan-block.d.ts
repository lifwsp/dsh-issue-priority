/**
 * `<!-- dsh-plan ... -->` block: the single schema used both by `issue_draft`
 * (validate + render) and by sync (parse). A block that fails validation is
 * treated as "no block" by the planner, never as a fatal error.
 */
import type { PlanBlock } from './types.js';
export declare const BLOCK_VERSION: 1;
export interface PlanBlockInput {
    areas?: unknown;
    size?: unknown;
    files?: unknown;
    dependsOn?: unknown;
    acceptance?: unknown;
}
export type ValidationResult = {
    ok: true;
    block: PlanBlock;
} | {
    ok: false;
    errors: string[];
};
/** Validate structured input against the v1 schema. */
export declare function validatePlanBlock(input: PlanBlockInput): ValidationResult;
/** Render the block as an HTML comment (invisible on GitHub). */
export declare function renderPlanBlock(block: PlanBlock): string;
export type ParseResult = {
    found: false;
} | {
    found: true;
    ok: true;
    block: PlanBlock;
} | {
    found: true;
    ok: false;
    errors: string[];
};
/** Extract and validate the block from an Issue body. */
export declare function parsePlanBlock(body: string): ParseResult;
/** Remove the block so judgment input carries only human-written text. */
export declare function stripPlanBlock(body: string): string;
/** Append (or replace) the block at the end of a body. */
export declare function attachPlanBlock(body: string, block: PlanBlock): string;
//# sourceMappingURL=plan-block.d.ts.map