/**
 * Sync service: incremental GitHub fetch → local snapshot → plan rebuild.
 * No LLM is involved; the decision model is only asked about changed inputs
 * (answers are cached by input hash in the repo state).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PLANNER_VERSION } from './plan/planner.js';
import { createJudge } from './decision/judge.js';
import { parseDependencies } from './github/dependencies.js';
import { repoFromRemoteUrl, resolveRepo } from './github/rest-adapter.js';
import { parsePlanBlock, stripPlanBlock } from './plan-block.js';
import { buildPlan } from './plan/planner.js';
const execFileAsync = promisify(execFile);
const MENTION_RE = /(?:^|[^\w/&])#(\d+)\b/g;
const MAX_THREAD_POSTS = 20;
const MAX_POST_CHARS = 800;
/** Collapse fenced code / long log lines so a comment carries its words, not its paste. */
export function condenseComment(text) {
    const out = text
        .replace(/```[\s\S]*?```/g, '[code]')
        .replace(/<details>[\s\S]*?<\/details>/gi, '[details]')
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return out.length > MAX_POST_CHARS ? `${out.slice(0, MAX_POST_CHARS)}…` : out;
}
export function toIssueRecord(raw) {
    const parsed = parsePlanBlock(raw.body);
    const body = stripPlanBlock(raw.body);
    const human = raw.comments.filter((c) => !c.bot);
    const deps = parseDependencies([body, ...human.map((c) => c.body)]);
    const thread = human
        .map((c) => ({ by: c.author, at: c.createdAt, text: condenseComment(c.body) }))
        .filter((c) => c.text)
        .slice(-MAX_THREAD_POSTS);
    const mentions = new Set();
    for (const text of [body, ...human.map((c) => c.body)]) {
        for (const m of text.matchAll(MENTION_RE)) {
            const n = Number(m[1]);
            if (n !== raw.number)
                mentions.add(n);
        }
    }
    return {
        number: raw.number,
        title: raw.title,
        body: body.slice(0, 4000),
        htmlUrl: raw.htmlUrl,
        state: raw.state,
        labels: raw.labels,
        updatedAt: raw.updatedAt,
        closedAt: raw.closedAt,
        block: parsed.found && parsed.ok ? parsed.block : null,
        ...(parsed.found && !parsed.ok ? { blockError: parsed.errors.join('; ') } : {}),
        nativeBlockedBy: [...new Set(raw.nativeBlockedBy)].sort((a, b) => a - b),
        textBlockedBy: deps.blockedBy.filter((n) => n !== raw.number),
        mentions: [...mentions].sort((a, b) => a - b),
        thread,
        ...(raw.author ? { author: raw.author } : {}),
        ...(raw.createdAt ? { createdAt: raw.createdAt } : {}),
    };
}
/** `owner/repo` from the git remote of a directory (origin first, then any GitHub remote). */
export async function detectRepo(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, 'remote', '-v'], { timeout: 5000 });
        const lines = stdout.split('\n').filter(Boolean);
        const ordered = [...lines.filter((l) => l.startsWith('origin\t')), ...lines.filter((l) => !l.startsWith('origin\t'))];
        for (const line of ordered) {
            const url = line.split(/\s+/)[1];
            const repo = url ? repoFromRemoteUrl(url) : null;
            if (repo)
                return repo;
        }
        return null;
    }
    catch {
        return null;
    }
}
/** Current git branch of a directory, or null. */
export async function currentBranch(cwd) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 });
        const b = stdout.trim();
        return b && b !== 'HEAD' ? b : null;
    }
    catch {
        return null;
    }
}
function judgmentStore(state, now) {
    return {
        get: (key) => state.judgments[key]?.value,
        set: (key, value) => {
            state.judgments[key] = { value, at: now().toISOString() };
        },
    };
}
function collectAreas(state) {
    const set = new Set(state.areas);
    for (const i of Object.values(state.issues))
        for (const a of i.block?.areas ?? [])
            set.add(a);
    state.areas = [...set].sort();
}
export class SyncService {
    deps;
    running = new Map();
    now;
    constructor(deps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }
    /** Coalesce concurrent syncs of the same repo (timer + command). */
    sync(repo, options = {}) {
        const key = resolveRepo(repo).toLowerCase();
        const existing = this.running.get(key);
        if (existing)
            return existing;
        const p = this.run(resolveRepo(repo), options).finally(() => this.running.delete(key));
        this.running.set(key, p);
        return p;
    }
    /** Rebuild the plan from the local snapshot without touching GitHub. */
    async replan(state, signal, closedSinceLast = []) {
        const settings = this.deps.settings();
        const judge = createJudge(await this.deps.decision(), judgmentStore(state, this.now));
        const plan = await buildPlan({
            repo: state.repo,
            issues: Object.values(state.issues),
            overrides: state.overrides,
            localDependencies: state.localDependencies,
            inProgress: state.inProgress?.issues ?? [],
            areas: state.areas,
            judge,
            previous: state.plan,
            closedSinceLast,
            mergeThreshold: settings.mergeThreshold,
            actionableThreshold: settings.actionableThreshold,
            directionThreshold: settings.directionThreshold,
            ...(settings.similarityThreshold !== undefined ? { similarityThreshold: settings.similarityThreshold } : {}),
            maxPackageSize: settings.maxPackageSize,
            maxQuestions: settings.maxQuestionsPerSync,
            now: this.now,
            signal,
        });
        state.usage.requests += judge.usage.requests;
        state.usage.questions += judge.usage.questions;
        state.usage.inputTokens += judge.usage.inputTokens;
        state.plan = plan;
        return plan;
    }
    async run(repo, options) {
        const { store, logger } = this.deps;
        const settings = this.deps.settings();
        const state = await store.load(repo);
        // Records saved before v0.5 lack comments: refetch everything once.
        const backfill = Object.values(state.issues).some((i) => i.thread === undefined);
        const since = options.full || backfill ? undefined : (state.syncedUntil ?? undefined);
        let fetched;
        try {
            fetched = await (await this.deps.github()).listIssuesSince({
                repo,
                since,
                maxIssues: settings.maxIssues,
                signal: options.signal,
            });
        }
        catch (error) {
            state.lastSyncError = error instanceof Error ? error.message : String(error);
            state.lastSyncAt = this.now().toISOString();
            await store.save(state);
            throw error;
        }
        const changed = [];
        const closed = [];
        if (!since) {
            // Full fetch returns open issues only: anything we knew that is absent is gone.
            const seen = new Set(fetched.map((f) => f.number));
            for (const key of Object.keys(state.issues)) {
                if (!seen.has(Number(key))) {
                    closed.push(Number(key));
                    delete state.issues[key];
                }
            }
        }
        let watermark = state.syncedUntil;
        for (const raw of fetched) {
            if (!watermark || raw.updatedAt > watermark)
                watermark = raw.updatedAt;
            const key = String(raw.number);
            const prev = state.issues[key];
            if (raw.state === 'closed') {
                if (prev) {
                    closed.push(raw.number);
                    delete state.issues[key];
                }
                continue;
            }
            if (prev && prev.updatedAt === raw.updatedAt && prev.thread !== undefined)
                continue;
            state.issues[key] = toIssueRecord(raw);
            changed.push(raw.number);
        }
        if (closed.length) {
            const gone = new Set(closed);
            state.overrides = state.overrides.filter((o) => !gone.has(o.issue));
            state.localDependencies = state.localDependencies.filter((d) => !gone.has(d.issue));
            if (state.inProgress) {
                const left = state.inProgress.issues.filter((n) => !gone.has(n));
                state.inProgress = left.length ? { ...state.inProgress, issues: left } : null;
            }
        }
        state.syncedUntil = watermark;
        state.lastSyncAt = this.now().toISOString();
        state.lastSyncError = null;
        collectAreas(state);
        const stalePlan = state.plan !== null && state.plan.plannerVersion !== PLANNER_VERSION;
        const unchanged = !changed.length && !closed.length && state.plan !== null && !options.full && !stalePlan;
        const plan = unchanged ? state.plan : await this.replan(state, options.signal, closed);
        await store.save(state);
        logger.info('sync complete', {
            repo,
            fetched: fetched.length,
            changed: changed.length,
            closed: closed.length,
            asked: unchanged ? 0 : plan.decision.asked,
        });
        return { state, plan, fetched: fetched.length, changed, closed: closed.sort((a, b) => a - b), unchanged };
    }
}
//# sourceMappingURL=sync.js.map