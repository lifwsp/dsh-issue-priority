/**
 * Local persistence (design §6): one JSON file per repository, never committed
 * to the repository itself. Writes are atomic (tmp + rename).
 */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
export const STORE_SCHEMA = 1;
export function defaultDataDir() {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
    return join(home, 'data', 'dsh-issue-priority');
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
        areas: [],
        judgments: {},
        plan: null,
        usage: { requests: 0, questions: 0, inputTokens: 0, since: now.toISOString() },
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
export function createFileStore(dataDir, maxJudgments = 2000) {
    // Serialize writes per file so a timer sync and a tool call cannot interleave.
    const queues = new Map();
    return {
        async load(repo) {
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
            const prev = queues.get(path) ?? Promise.resolve();
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