import Schema from '@deepseek-ai/schemastery';
/**
 * Cordis Config (Standard Schema). Fields are volatile() so live settings
 * updates are re-read on the next sync without a plugin reload.
 */
export const Config = Schema.object({
    decisionProvider: Schema.union(['liquid', 'openrouter', 'typesafe', 'custom', 'none'])
        .default('none')
        .description('Decision model (System One API). `liquid` = api.liquid.ai d1 (LIQUID_API_KEY), ' +
        '`openrouter` = liquid/d1 (OPENROUTER_API_KEY), `typesafe` = Jev (TYPESAFE_API_KEY), ' +
        '`custom` = decisionApiUrl + decisionModel (DECISION_API_KEY), `none` = deterministic only.')
        .volatile(),
    decisionApiKeyRef: Schema.string()
        .default('')
        .description('Credential / env name for the decision API key. Empty = OPENROUTER_API_KEY / LIQUID_API_KEY / TYPESAFE_API_KEY / DECISION_API_KEY by provider.')
        .volatile(),
    decisionModel: Schema.string().default('').description('Model id override. Empty = provider default (d1 / liquid/d1 / jev-1.14.0). Required for custom.').volatile(),
    decisionApiUrl: Schema.string().default('').description('Endpoint override. Required for custom (POST, System One request shape).').volatile(),
    allowExternalJudgment: Schema.boolean()
        .default(false)
        .description('Issue titles/bodies are sent to the decision API. Must be true to use any decision provider; ' +
        'while false the plugin plans deterministically and says so.')
        .volatile(),
    maxQuestionsPerSync: Schema.natural().min(0).max(2000).default(200).description('Cap on decision questions per sync (cache misses only).').volatile(),
    mergeThreshold: Schema.number().min(0).max(1).default(0.6).description('Merge noul ≥ this → same package.').volatile(),
    actionableThreshold: Schema.number().min(0).max(1).default(0.35).description('Actionable noul below this → needsHuman (unclear).').volatile(),
    directionThreshold: Schema.number().min(0).max(1).default(0.6).description('Direction choice probability needed for an advisory order.').volatile(),
    similarityThreshold: Schema.number().min(0).max(1).default(0.1).description('Text similarity (bigram Jaccard) for two issues without dsh-plan blocks to be asked whether they belong together.').volatile(),
    maxPackageSize: Schema.natural().min(1).max(16).default(4).description('Max package size (S=1, M=2, L=4).').volatile(),
    syncIntervalMinutes: Schema.natural().min(0).max(1440).default(60).description('Background sync interval; 0 disables the timer.'),
    maxIssues: Schema.natural().min(1).max(5000).default(300).description('Max open issues fetched per sync (most recently updated first). Raise for large backlogs; more issues = more GitHub requests and more decision questions on the first sync.').volatile(),
    githubTokenRef: Schema.string().default('GITHUB_TOKEN').description('Credential / env name for a GitHub token (value is never logged). Falls back to `gh auth token`.').volatile(),
    githubApiBase: Schema.string().default('https://api.github.com').description('GitHub API base URL.').volatile(),
    githubMaxRetries: Schema.natural().min(0).max(8).default(3).description('Retries on GitHub rate limit.').volatile(),
    dataDir: Schema.string().default('').description('Local plan storage directory. Empty = $DSH_HOME/data/dsh-issue-priority.'),
    logLevel: Schema.union(['silent', 'warn', 'info', 'debug']).default('info').description('Log verbosity.').volatile(),
    decisionTimeoutMs: Schema.natural().min(1000).max(120_000).default(15_000).description('Per-request decision API timeout.').volatile(),
});
export const DEFAULTS = {
    decisionProvider: 'none',
    decisionApiKeyRef: '',
    decisionModel: '',
    decisionApiUrl: '',
    allowExternalJudgment: false,
    maxQuestionsPerSync: 200,
    mergeThreshold: 0.6,
    actionableThreshold: 0.35,
    directionThreshold: 0.6,
    similarityThreshold: 0.1,
    maxPackageSize: 4,
    syncIntervalMinutes: 60,
    maxIssues: 300,
    githubTokenRef: 'GITHUB_TOKEN',
    githubApiBase: 'https://api.github.com',
    githubMaxRetries: 3,
    dataDir: '',
    logLevel: 'info',
    decisionTimeoutMs: 15_000,
};
function readLive(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value === 'object' && typeof value.get === 'function') {
        const v = value.get();
        return v === undefined || v === null ? fallback : v;
    }
    return value;
}
export function resolveLiveConfig(raw) {
    const out = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        out[key] = readLive(raw[key], fallback);
    }
    return out;
}
//# sourceMappingURL=config.js.map