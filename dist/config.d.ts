import Schema from '@deepseek-ai/schemastery';
import type { LogLevel } from './log.js';
import type { DecisionProviderId } from './decision/client.js';
export interface PluginConfig {
    decisionProvider?: DecisionProviderId | 'none';
    decisionApiKeyRef?: string;
    decisionModel?: string;
    decisionApiUrl?: string;
    allowExternalJudgment?: boolean;
    maxQuestionsPerSync?: number;
    mergeThreshold?: number;
    actionableThreshold?: number;
    directionThreshold?: number;
    similarityThreshold?: number;
    maxPackageSize?: number;
    syncIntervalMinutes?: number;
    maxIssues?: number;
    githubTokenRef?: string;
    githubApiBase?: string;
    githubMaxRetries?: number;
    dataDir?: string;
    logLevel?: LogLevel;
    decisionTimeoutMs?: number;
}
/**
 * Cordis Config (Standard Schema). Fields are volatile() so live settings
 * updates are re-read on the next sync without a plugin reload.
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    decisionProvider: Schema<"none" | "liquid" | "openrouter" | "typesafe" | "custom", "none" | "liquid" | "openrouter" | "typesafe" | "custom", "volatile-defined">;
    decisionApiKeyRef: Schema<string, string, "volatile-defined">;
    decisionModel: Schema<string, string, "volatile-defined">;
    decisionApiUrl: Schema<string, string, "volatile-defined">;
    allowExternalJudgment: Schema<boolean, boolean, "volatile-defined">;
    maxQuestionsPerSync: Schema<number, number, "volatile-defined">;
    mergeThreshold: Schema<number, number, "volatile-defined">;
    actionableThreshold: Schema<number, number, "volatile-defined">;
    directionThreshold: Schema<number, number, "volatile-defined">;
    similarityThreshold: Schema<number, number, "volatile-defined">;
    maxPackageSize: Schema<number, number, "volatile-defined">;
    syncIntervalMinutes: Schema<number, number, "defined">;
    maxIssues: Schema<number, number, "volatile-defined">;
    githubTokenRef: Schema<string, string, "volatile-defined">;
    githubApiBase: Schema<string, string, "volatile-defined">;
    githubMaxRetries: Schema<number, number, "volatile-defined">;
    dataDir: Schema<string, string, "defined">;
    logLevel: Schema<"silent" | "warn" | "info" | "debug", "silent" | "warn" | "info" | "debug", "volatile-defined">;
    decisionTimeoutMs: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    decisionProvider: Schema<"none" | "liquid" | "openrouter" | "typesafe" | "custom", "none" | "liquid" | "openrouter" | "typesafe" | "custom", "volatile-defined">;
    decisionApiKeyRef: Schema<string, string, "volatile-defined">;
    decisionModel: Schema<string, string, "volatile-defined">;
    decisionApiUrl: Schema<string, string, "volatile-defined">;
    allowExternalJudgment: Schema<boolean, boolean, "volatile-defined">;
    maxQuestionsPerSync: Schema<number, number, "volatile-defined">;
    mergeThreshold: Schema<number, number, "volatile-defined">;
    actionableThreshold: Schema<number, number, "volatile-defined">;
    directionThreshold: Schema<number, number, "volatile-defined">;
    similarityThreshold: Schema<number, number, "volatile-defined">;
    maxPackageSize: Schema<number, number, "volatile-defined">;
    syncIntervalMinutes: Schema<number, number, "defined">;
    maxIssues: Schema<number, number, "volatile-defined">;
    githubTokenRef: Schema<string, string, "volatile-defined">;
    githubApiBase: Schema<string, string, "volatile-defined">;
    githubMaxRetries: Schema<number, number, "volatile-defined">;
    dataDir: Schema<string, string, "defined">;
    logLevel: Schema<"silent" | "warn" | "info" | "debug", "silent" | "warn" | "info" | "debug", "volatile-defined">;
    decisionTimeoutMs: Schema<number, number, "volatile-defined">;
}>>, "plain">;
export type ResolvedConfig = Required<PluginConfig>;
export declare const DEFAULTS: ResolvedConfig;
export declare function resolveLiveConfig(raw: Record<string, unknown>): ResolvedConfig;
//# sourceMappingURL=config.d.ts.map