/**
 * Glue shared by tools, commands and the timer: repository resolution,
 * state mutations (overrides / local deps / in-progress) and replanning.
 */
import { resolveRepo } from './github/rest-adapter.js';
import { currentBranch, detectRepo } from './sync.js';
import { PLANNER_VERSION } from './plan/planner.js';
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
    /** Sync if never synced or older than maxAgeMs, else return the stored plan. */
    async ensurePlan(repo, options = {}) {
        const state = await this.deps.store.load(repo);
        const age = state.lastSyncAt ? this.now().getTime() - Date.parse(state.lastSyncAt) : Infinity;
        const stale = state.plan !== null && state.plan.plannerVersion !== PLANNER_VERSION;
        if (options.force || !state.plan || stale || age > (options.maxAgeMs ?? 5 * 60_000)) {
            try {
                const res = await this.deps.sync.sync(repo, { signal: options.signal });
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
        return { state, plan: state.plan, synced: null };
    }
    /** Apply a mutation to local state and rebuild the plan (no GitHub fetch). */
    async mutate(repo, fn, signal) {
        const state = await this.deps.store.load(repo);
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
            ? { issues: [...new Set(issues)].sort((a, b) => a - b), ...(branch ? { branch } : {}), startedAt: this.now().toISOString() }
            : null;
    }
}
//# sourceMappingURL=runtime.js.map