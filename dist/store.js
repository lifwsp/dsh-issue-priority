/**
 * Local persistence (design §6): one JSON file per repository, never committed
 * to the repository itself. Writes are atomic (tmp + rename).
 */
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
export const STORE_SCHEMA = 1;
function dshHome() {
    return process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
}
export function defaultDataDir() {
    return join(dshHome(), 'data', 'dsh-work-planner');
}
/** Where this plugin stored its plans while it was called dsh-issue-priority (≤ 0.5). */
export function legacyDataDir() {
    return join(dshHome(), 'data', 'dsh-issue-priority');
}
/**
 * One-time carry-over after the rename: when the new directory does not exist
 * yet, copy the old one (copy, not move, so downgrading still finds its data).
 * Returns true when something was copied.
 */
export async function migrateLegacyDataDir(target, legacy = legacyDataDir()) {
    if (target === legacy)
        return false;
    const exists = (p) => stat(p).then(() => true, () => false);
    if ((await exists(target)) || !(await exists(legacy)))
        return false;
    await mkdir(dirname(target), { recursive: true });
    await cp(legacy, target, { recursive: true, errorOnExist: false, force: false });
    return true;
}
export function stateFilePath(dataDir, repo) {
    return join(dataDir, `${repo.replace('/', '__').toLowerCase()}.json`);
}
export function emptyState(repo, now = new Date()) {
    return {
        schema: STORE_SCHEMA,
        repo,
        syncedUntil: null,
        lastSyncAt: null,
        lastSyncError: null,
        issues: {},
        overrides: [],
        localDependencies: [],
        inProgress: null,
        finished: [],
        dismissed: [],
        pulls: [],
        pullsSyncedAt: null,
        local: null,
        areas: [],
        judgments: {},
        plan: null,
        usage: { requests: 0, questions: 0, inputTokens: 0, since: now.toISOString() },
        outcomes: [],
    };
}
/** Prune judgment cache to the most recent N entries to bound file growth. */
function pruneJudgments(state, max) {
    const entries = Object.entries(state.judgments);
    if (entries.length <= max)
        return;
    entries.sort((a, b) => (a[1].at < b[1].at ? 1 : -1));
    state.judgments = Object.fromEntries(entries.slice(0, max));
}
export function createFileStore(dataDir, maxJudgments = 2000, ready = Promise.resolve()) {
    // Serialize writes per file so a timer sync and a tool call cannot interleave.
    const queues = new Map();
    // A failed one-time preparation (legacy carry-over) must not wedge the store.
    const prepared = ready.catch(() => undefined);
    return {
        async load(repo) {
            await prepared;
            const path = stateFilePath(dataDir, repo);
            try {
                const raw = JSON.parse(await readFile(path, 'utf8'));
                if (raw.schema !== STORE_SCHEMA || raw.repo?.toLowerCase() !== repo.toLowerCase())
                    return emptyState(repo);
                return { ...emptyState(repo), ...raw, repo };
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return emptyState(repo);
                // Corrupt file: start over rather than wedging the plugin.
                return emptyState(repo);
            }
        },
        async listRepos() {
            await prepared;
            let names;
            try {
                names = await readdir(dataDir);
            }
            catch {
                return [];
            }
            const repos = [];
            for (const name of names.filter((n) => n.endsWith('.json'))) {
                try {
                    const raw = JSON.parse(await readFile(join(dataDir, name), 'utf8'));
                    if (raw.schema === STORE_SCHEMA && typeof raw.repo === 'string')
                        repos.push(raw.repo);
                }
                catch {
                    // skip unreadable files
                }
            }
            return repos;
        },
        save(state) {
            const path = stateFilePath(dataDir, state.repo);
            pruneJudgments(state, maxJudgments);
            const json = `${JSON.stringify(state, null, 2)}\n`;
            const run = async () => {
                await mkdir(dirname(path), { recursive: true });
                const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
                await writeFile(tmp, json, 'utf8');
                await rename(tmp, path);
            };
            const prev = queues.get(path) ?? prepared;
            const next = prev.then(run, run);
            queues.set(path, next.catch(() => undefined));
            return next;
        },
    };
}
/** In-memory store for tests. */
export function createMemoryStore() {
    const states = new Map();
    return {
        states,
        async load(repo) {
            const s = states.get(repo.toLowerCase());
            return s ? structuredClone(s) : emptyState(repo);
        },
        async listRepos() {
            return [...states.values()].map((s) => s.repo);
        },
        async save(state) {
            states.set(state.repo.toLowerCase(), structuredClone(state));
        },
    };
}
//# sourceMappingURL=store.js.map