/**
 * Glue shared by tools, commands and the timer: repository resolution,
 * state mutations (overrides / local deps / in-progress) and replanning.
 */
import { resolveRepo } from './github/rest-adapter.js';
import { currentBranch, detectRepo } from './sync.js';
import { PLANNER_VERSION } from './plan/planner.js';
import { evidenceKeys, usableBranch } from './progress.js';
export class IssuePlanRuntime {
    deps;
    /** Repos seen by this process; the timer syncs these. */
    knownRepos = new Set();
    now;
    constructor(deps) {
        this.deps = deps;
        this.now = deps.now ?? (() => new Date());
    }
    async resolveRepoFor(agent, explicit) {
        if (explicit?.trim()) {
            const repo = resolveRepo(explicit.trim());
            this.knownRepos.add(repo);
            return repo;
        }
        return this.resolveRepoAt(this.deps.cwdOf(agent) ?? process.cwd());
    }
    /** Resolve the GitHub repo of a directory (e.g. the cwd the sidebar reports). */
    async resolveRepoAt(cwd) {
        const repo = await detectRepo(cwd);
        if (!repo) {
            throw new Error(`作業ディレクトリ ${cwd} から GitHub リポジトリを特定できませんでした（git remote が GitHub ではない）。repo を owner/name で指定してください。`);
        }
        this.knownRepos.add(repo);
        return repo;
    }
    async branchFor(agent) {
        return currentBranch(this.deps.cwdOf(agent) ?? process.cwd());
    }
    branchAt(cwd) {
        return currentBranch(cwd);
    }
    cwdFor(agent) {
        return this.deps.cwdOf(agent);
    }
    /**
     * Sync if never synced or older than maxAgeMs, else return the stored plan.
     * `cwd` (the caller's clone) is re-scanned for branches either way, so a
     * fresh commit or push shows up without waiting for the next GitHub sync.
     */
    async ensurePlan(repo, options = {}) {
        const state = await this.deps.store.load(repo);
        const age = state.lastSyncAt ? this.now().getTime() - Date.parse(state.lastSyncAt) : Infinity;
        const stale = state.plan !== null && state.plan.plannerVersion !== PLANNER_VERSION;
        if (options.force || !state.plan || stale || age > (options.maxAgeMs ?? 5 * 60_000)) {
            try {
                const res = await this.deps.sync.sync(repo, { signal: options.signal, cwd: options.cwd });
                return { state: res.state, plan: res.plan, synced: res };
            }
            catch (error) {
                if (!state.plan)
                    throw error;
                this.deps.logger.warn('sync failed; using stored plan', { repo, error: String(error) });
                const fresh = await this.deps.store.load(repo);
                return { state: fresh, plan: fresh.plan, synced: null };
            }
        }
        if (options.cwd) {
            const before = JSON.stringify([state.local?.branches ?? null, state.local?.path ?? null]);
            await this.deps.sync.refreshLocal(state, options.cwd);
            if (JSON.stringify([state.local?.branches ?? null, state.local?.path ?? null]) !== before) {
                const plan = await this.deps.sync.replan(state, options.signal);
                await this.deps.store.save(state);
                return { state, plan, synced: null };
            }
        }
        return { state, plan: state.plan, synced: null };
    }
    /** Apply a mutation to local state and rebuild the plan (no GitHub fetch). */
    async mutate(repo, fn, signal, cwd) {
        const state = await this.deps.store.load(repo);
        if (cwd)
            await this.deps.sync.refreshLocal(state, cwd);
        fn(state);
        const plan = await this.deps.sync.replan(state, signal);
        await this.deps.store.save(state);
        return { state, plan };
    }
    setOverride(state, issue, action) {
        state.overrides = state.overrides.filter((o) => o.issue !== issue);
        if (action !== 'clear')
            state.overrides.push({ issue, action, at: this.now().toISOString() });
    }
    addDependency(state, issue, dependsOn, note) {
        if (issue === dependsOn)
            throw new Error('自分自身には依存できません。');
        state.localDependencies = state.localDependencies.filter((d) => !(d.issue === issue && d.dependsOn === dependsOn));
        state.localDependencies.push({ issue, dependsOn, at: this.now().toISOString(), ...(note ? { note } : {}) });
    }
    removeDependency(state, issue, dependsOn) {
        state.localDependencies = state.localDependencies.filter((d) => !(d.issue === issue && d.dependsOn === dependsOn));
    }
    setInProgress(state, issues, branch) {
        state.inProgress = issues && issues.length
            ? { issues: [...new Set(issues)].sort((a, b) => a - b), ...(usableBranch(branch) ? { branch: branch } : {}), startedAt: this.now().toISOString() }
            : null;
        if (state.inProgress) {
            const again = new Set(state.inProgress.issues);
            state.finished = (state.finished ?? []).filter((f) => !again.has(f.issue));
            state.dismissed = (state.dismissed ?? []).filter((d) => !again.has(d.issue));
        }
    }
    /** Record the current branch once work moved off the default branch after `start`. */
    noteBranch(state, branch) {
        if (state.inProgress && usableBranch(branch) && !usableBranch(state.inProgress.branch)) {
            state.inProgress = { ...state.inProgress, branch: branch };
        }
    }
    /**
     * Work is done but the issues are not closed yet (no push / PR / merge):
     * they leave the recommendations until GitHub reports them closed.
     * Without `issues`, everything in progress is finished.
     */
    finish(state, issues, branch) {
        const targets = issues?.length ? [...new Set(issues)] : (state.inProgress?.issues ?? []);
        const recorded = usableBranch(branch) ? branch : state.inProgress?.branch;
        const at = this.now().toISOString();
        const done = new Set(targets);
        state.finished = [
            ...(state.finished ?? []).filter((f) => !done.has(f.issue)),
            ...targets.map((issue) => ({ issue, at, ...(usableBranch(recorded) ? { branch: recorded } : {}) })),
        ].sort((a, b) => a.issue - b.issue);
        state.dismissed = (state.dismissed ?? []).filter((d) => !done.has(d.issue));
        if (state.inProgress) {
            const left = state.inProgress.issues.filter((n) => !done.has(n));
            state.inProgress = left.length ? { ...state.inProgress, issues: left } : null;
        }
        return targets.sort((a, b) => a - b);
    }
    /**
     * "Not done yet": put an awaiting-close issue back into the plan. A finish
     * mark is removed; detected evidence (branch / PR) is remembered so only
     * new evidence takes the issue off again.
     */
    reopen(state, issue) {
        state.finished = (state.finished ?? []).filter((f) => f.issue !== issue);
        const current = this.deps.sync.progress(state);
        const evidence = [
            ...(current.awaitingClose.find((a) => a.issue === issue)?.evidence ?? []),
            ...(current.activity[String(issue)] ?? []),
        ];
        const keys = evidenceKeys(evidence);
        state.dismissed = (state.dismissed ?? []).filter((d) => d.issue !== issue);
        if (keys.length)
            state.dismissed.push({ issue, keys, at: this.now().toISOString() });
    }
}
//# sourceMappingURL=runtime.js.map