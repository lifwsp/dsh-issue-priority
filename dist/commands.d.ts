import type { IssuePlanRuntime } from './runtime.js';
type CommandResult = {
    kind: 'success';
    text?: string;
} | {
    kind: 'error';
    text: string;
};
interface Invocation {
    agent: {
        followup?: (message: unknown) => void;
        session?: unknown;
    };
    rawInput: string;
    signal?: AbortSignal;
}
export declare function runIssuesCommand(runtime: IssuePlanRuntime, inv: Invocation): Promise<CommandResult>;
export declare function createIssuesCommand(runtime: IssuePlanRuntime): {
    name: string;
    description: string;
    input: {
        hint: string;
    };
    handler: (inv: Invocation) => Promise<CommandResult>;
};
export {};
//# sourceMappingURL=commands.d.ts.map