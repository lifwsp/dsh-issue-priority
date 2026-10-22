import type { IssuePlanRuntime } from './runtime.js';
import type { Plan } from './types.js';
export declare const RPC_CHANNEL = "/dsh-issue-priority";
export type RpcResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
};
interface AgentLike {
    id?: unknown;
    session?: unknown;
    followup?: (message: unknown) => void;
}
export interface RpcDeps {
    runtime: IssuePlanRuntime;
    /** Live agents (from the `agents` service); empty when unavailable. */
    agents: () => AgentLike[];
}
/** What the tab renders. Only the fields the UI needs, no issue bodies. */
export interface PlanView {
    repo: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    plan: Plan;
    nextId: string | null;
    issues: Record<string, {
        title: string;
        htmlUrl: string;
        labels: string[];
    }>;
    overrides: Record<string, 'defer' | 'pin'>;
    inProgress: {
        issues: number[];
        branch?: string | null;
    } | null;
    usage: {
        questions: number;
        inputTokens: number;
    };
    canKickoff: boolean;
    /** Why the decision model is off (user-facing), when it is. */
    decisionOff: string | null;
    /** Done but not closed, pre-rendered for the tab (texts live in progress.ts). */
    awaiting: {
        issue: number;
        marked: boolean;
        step: string;
        next: string;
        evidence: string[];
        urls: string[];
    }[];
    /** How much the planner had to go on (to explain a flat plan). */
    signals: {
        open: number;
        withBlock: number;
        withPriority: number;
    };
}
export declare function createRpcHandler(deps: RpcDeps): (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>;
type RawReq = AsyncIterable<Uint8Array> & {
    url?: string;
    method?: string;
    headers: Record<string, string | string[] | undefined>;
};
type RawRes = {
    writeHead(status: number, headers?: Record<string, string>): unknown;
    end(body?: string): unknown;
};
/**
 * A `webServer.register` prefix route speaking the same envelope as
 * `connection.rpc.call` in the browser ({type:'client-request', rpcId, method,
 * payload} → {type:'server-response', rpcId, result}). Used when the host has no
 * `connection` service (DSH desktop), mirroring dsh-run-button.
 */
export declare function createRpcRoute(handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult>, requestRejection?: (req: unknown) => number | undefined): {
    kind: "prefix";
    path: string;
    handler: (req: RawReq, res: RawRes) => Promise<void>;
};
export {};
//# sourceMappingURL=rpc.d.ts.map