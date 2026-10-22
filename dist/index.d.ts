import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export declare const name = "dsh-work-planner";
/**
 * Required core services. `credentials` and `workingDirectory` are looked up
 * lazily with ctx.get() so their absence degrades (env / process.cwd()) instead
 * of leaving the plugin pending.
 */
export declare const inject: string[];
export { Config };
export type { PluginConfig } from './config.js';
export { buildPlan } from './plan/planner.js';
export { validatePlanBlock, parsePlanBlock, renderPlanBlock } from './plan-block.js';
export { HttpDecisionClient } from './decision/client.js';
export { RestGitHubAdapter } from './github/rest-adapter.js';
export { SyncService } from './sync.js';
type AnyCtx = Context & Record<string, any>;
/**
 * Cordis plugin entry. All registrations are effect-scoped so unloading the
 * plugin removes tools, the command, skills and the timer.
 */
export declare const apply: (ctx: AnyCtx, rawConfig?: Record<string, unknown>) => void;
//# sourceMappingURL=index.d.ts.map