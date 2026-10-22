/**
 * Agent tools (design §7):
 * - issue_draft:       validate + render a dsh-plan block and the gh commands that record
 *                      dependencies / parent / milestone / priority in GitHub (never writes itself)
 * - issue_plan_read:   read the stored plan (syncs if stale)
 * - issue_plan_update: record local overrides / dependencies / in-progress
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { detectGhVersion, planAuthoring, repoFeatures, supportsRelations } from './github/authoring.js';
import { attachPlanBlock, renderPlanBlock, validatePlanBlock } from './plan-block.js';
import { nextPackage, renderPlan } from './render.js';
const json = (value) => JSON.parse(JSON.stringify(value));
const textOutput = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: String(value.text ?? JSON.stringify(value)) }],
};
export function createIssueDraftTool(runtime) {
    return defineTool({
        name: 'issue_draft',
        description: 'Validate and render the machine-readable `<!-- dsh-plan -->` block for a GitHub Issue body. ' +
            'ALWAYS call this before creating or editing any GitHub Issue (gh issue create/edit, GitHub API, MCP, etc.), ' +
            'even when the user just says "Issue 起票して" / "file an issue" without mentioning the plan block. ' +
            'Returns the final body (block appended/replaced) plus the known `areas` vocabulary — reuse those names. ' +
            'Does NOT create the Issue: it returns `commands` — save `body` to body.md and run them. They record dependencies, parent (sub-issue), ' +
            'milestone and priority in GitHub\'s own features (Issue Dependencies, Sub-issues, Milestones, Priority field or labels), ' +
            'so the dsh-plan block keeps only what GitHub has no place for (areas, files, acceptance, size). ' +
            'A valid block only proves the FORMAT, not that the issue is a sensible unit: design the issue units first ' +
            '(issue-authoring skill) — one primary outcome per issue that can be prioritized, accepted/rejected, started, verified and closed on its own. ' +
            'Do not bundle independent findings just because they came from the same request, screen or conversation; ' +
            'add evidence to an existing issue with the same outcome instead of filing a duplicate; ' +
            'call this once per issue, and leave same-session batching to the planner\'s work packages.',
        parameters: {
            title: { type: 'string', required: true, description: 'Issue title.' },
            body: { type: 'string', required: true, description: 'Human-readable Issue body (markdown). Any existing dsh-plan block is replaced.' },
            areas: { type: 'array', items: { type: 'string' }, required: true, description: 'Kebab-case area names, e.g. ["auth","ui"]. Prefer existing names.' },
            size: { type: 'string', enum: ['S', 'M', 'L'], required: true, description: 'S ≈ under an hour, M ≈ half a day, L ≈ a day or more.' },
            files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths or globs likely to change (e.g. src/auth/**).' },
            dependsOn: { type: 'array', items: { type: 'integer' }, description: 'Issue numbers that must be done first (recorded as GitHub "blocked by"). Merely related issues belong as links in the body, not here.' },
            parent: { type: 'integer', description: 'Parent issue when this is one part of a larger outcome split into sub-issues (recorded as a GitHub sub-issue). The parent waits for its sub-issues in the plan.' },
            milestone: { type: 'string', description: 'Existing milestone (release / deadline) this issue belongs to. Issues in different milestones are never bundled.' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Importance, only when the user said so or it is clear (recorded as the Priority field or a priority label).' },
            issue: { type: 'integer', description: 'Number of the existing issue when editing; omit when creating.' },
            acceptance: { type: 'string', description: 'One-line acceptance criterion for this issue\'s single primary outcome (not a list of separate items to consider).' },
            repo: { type: 'string', description: 'owner/name. Default: detected from the session working directory.' },
        },
        isConcurrencySafe: () => true,
        output: textOutput,
        async execute(args, exec) {
            let repo = null;
            let known = [];
            let features = repoFeatures([]);
            let existing;
            try {
                repo = await runtime.resolveRepoFor(exec.agent, args.repo);
                const state = await runtime.deps.store.load(repo);
                known = state.areas;
                features = repoFeatures(Object.values(state.issues));
                if (args.issue !== undefined)
                    existing = state.issues[String(args.issue)];
            }
            catch {
                // Area vocabulary is advisory; drafting works without a repo.
            }
            const result = validatePlanBlock({
                areas: args.areas,
                size: args.size,
                files: args.files,
                dependsOn: args.dependsOn,
                acceptance: args.acceptance,
            });
            if (!result.ok) {
                return json({
                    ok: false,
                    errors: result.errors,
                    knownAreas: known,
                    text: `dsh-plan ブロックが不正です:\n- ${result.errors.join('\n- ')}\n既知の areas: ${known.join(', ') || '(なし)'}`,
                });
            }
            const ghRelations = supportsRelations(await (runtime.deps.ghVersion ?? detectGhVersion)());
            const authoring = planAuthoring({
                repo,
                title: args.title,
                ...(args.issue !== undefined ? { issue: args.issue } : {}),
                dependsOn: result.block.dependsOn,
                ...(args.parent !== undefined ? { parent: args.parent } : {}),
                ...(args.milestone?.trim() ? { milestone: args.milestone.trim() } : {}),
                ...(args.priority ? { priority: args.priority } : {}),
                ...(existing
                    ? {
                        existing: {
                            blockedBy: existing.nativeBlockedBy,
                            ...(existing.native?.parent !== undefined ? { parent: existing.native.parent } : {}),
                            ...(existing.native?.milestone ? { milestone: existing.native.milestone.title } : {}),
                            labels: existing.labels,
                        },
                    }
                    : {}),
                ghRelations,
                features,
            });
            // Dependencies live in GitHub when gh can record them; the block keeps them only as a fallback.
            result.block.dependsOn = authoring.blockDependsOn;
            if (features.effortField) {
                authoring.notes.push('このリポジトリは Effort フィールドを使っています。計画は size より Effort を優先するので、Effort も設定してください。');
            }
            const unknownAreas = result.block.areas.filter((a) => !known.includes(a));
            if (repo && unknownAreas.length) {
                // Register new names so later drafts converge on the same vocabulary.
                await runtime.mutate(repo, (s) => {
                    s.areas = [...new Set([...s.areas, ...unknownAreas])].sort();
                }).catch(() => undefined);
            }
            const body = attachPlanBlock(args.body, result.block);
            return json({
                ok: true,
                title: args.title,
                body,
                block: renderPlanBlock(result.block),
                knownAreas: known,
                newAreas: unknownAreas,
                commands: authoring.commands,
                notes: authoring.notes,
                text: [
                    `タイトル: ${args.title}`,
                    unknownAreas.length && known.length ? `新しい area を登録: ${unknownAreas.join(', ')}（既存: ${known.join(', ')}）` : '',
                    '--- body（body.md に保存） ---',
                    body,
                    '--- 実行するコマンド ---',
                    ...authoring.commands,
                    ...(authoring.notes.length ? ['--- 注意 ---', ...authoring.notes.map((n) => `- ${n}`)] : []),
                ]
                    .filter(Boolean)
                    .join('\n'),
            });
        },
    });
}
export function createPlanReadTool(runtime) {
    return defineTool({
        name: 'issue_plan_read',
        description: 'Read the current work-package plan for the repository: ordered packages (issues to handle together in one session), ' +
            'dependencies, items needing a human decision, and the recommended next package. ' +
            'Built in the background without an LLM. Use at the start of Issue work and before choosing what to do next.',
        parameters: {
            repo: { type: 'string', description: 'owner/name. Default: detected from the session working directory.' },
            refresh: { type: 'boolean', description: 'Sync with GitHub first even if the plan is fresh.' },
            issues: { type: 'array', items: { type: 'integer' }, description: 'Also return full bodies of these issues.' },
        },
        isConcurrencySafe: () => false,
        output: textOutput,
        async execute(args, exec) {
            const repo = await runtime.resolveRepoFor(exec.agent, args.repo);
            const cwd = runtime.cwdFor(exec.agent);
            const { state, plan } = await runtime.ensurePlan(repo, { force: args.refresh, signal: exec.signal, cwd });
            const details = (args.issues ?? []).map((n) => state.issues[String(n)]).filter(Boolean);
            const next = nextPackage(plan);
            const text = [
                renderPlan(state, plan),
                ...details.map((i) => `\n--- #${i.number} ${i.title} (${i.htmlUrl}) ---\n${i.body}`),
            ].join('\n');
            return json({ repo, plan, next: next?.id ?? null, inProgress: state.inProgress, awaitingClose: plan.awaitingClose ?? [], text });
        },
    });
}
export function createPlanUpdateTool(runtime) {
    return defineTool({
        name: 'issue_plan_update',
        description: 'Record local planning facts (stored only on this machine, never on GitHub): defer/pin/clear an issue, ' +
            'add or remove a dependency you discovered ("#A must wait for #B"), or mark which issues are in progress / finished. ' +
            'Call finish as soon as the implementation is done (even before push / PR / merge): finished issues stay open on GitHub ' +
            'but leave the recommendations as "awaiting close" until GitHub reports them closed. ' +
            'Branches and PRs that reference issues (`Closes #N`, branch `issues/wp-N`) are also detected automatically. ' +
            'The plan is rebuilt immediately.',
        parameters: {
            action: {
                type: 'string',
                enum: ['defer', 'pin', 'clear', 'depend', 'undepend', 'start', 'finish', 'stop', 'reopen'],
                required: true,
                description: 'defer/pin/clear: override for `issue`. depend/undepend: `issue` waits for `dependsOn`. ' +
                    'start: mark `issues` in progress. finish: implementation done → awaiting close (default: everything in progress, or `issues`). ' +
                    'stop: stop working without finishing (back into the plan). reopen: `issue` is not done after all (back into the plan).',
            },
            issue: { type: 'integer', description: 'Target issue (defer/pin/clear/depend/undepend).' },
            dependsOn: { type: 'integer', description: 'Prerequisite issue (depend/undepend).' },
            issues: { type: 'array', items: { type: 'integer' }, description: 'Issues being worked on together (start), or finished (finish; default: all in progress).' },
            note: { type: 'string', description: 'Why (depend).' },
            repo: { type: 'string', description: 'owner/name. Default: detected from the session working directory.' },
        },
        isConcurrencySafe: () => false,
        output: textOutput,
        async execute(args, exec) {
            const repo = await runtime.resolveRepoFor(exec.agent, args.repo);
            const need = (v, name) => {
                if (v == null)
                    throw new Error(`action=${args.action} には ${name} が必要です。`);
                return v;
            };
            const branch = await runtime.branchFor(exec.agent);
            let finished = [];
            const { state, plan } = await runtime.mutate(repo, (s) => {
                switch (args.action) {
                    case 'defer':
                    case 'pin':
                    case 'clear':
                        runtime.setOverride(s, need(args.issue, 'issue'), args.action);
                        break;
                    case 'depend':
                        runtime.addDependency(s, need(args.issue, 'issue'), need(args.dependsOn, 'dependsOn'), args.note);
                        break;
                    case 'undepend':
                        runtime.removeDependency(s, need(args.issue, 'issue'), need(args.dependsOn, 'dependsOn'));
                        break;
                    case 'start':
                        if (!args.issues?.length)
                            throw new Error('action=start には issues が必要です。');
                        runtime.setInProgress(s, args.issues, branch);
                        break;
                    case 'finish':
                        finished = runtime.finish(s, args.issues, branch);
                        if (!finished.length)
                            throw new Error('action=finish: 作業中の Issue がありません。issues で番号を指定してください。');
                        break;
                    case 'stop':
                        runtime.setInProgress(s, null);
                        break;
                    case 'reopen':
                        runtime.reopen(s, need(args.issue, 'issue'));
                        break;
                }
                if (args.action !== 'start' && args.action !== 'finish')
                    runtime.noteBranch(s, branch);
            }, exec.signal, runtime.cwdFor(exec.agent));
            const head = args.action === 'finish'
                ? `${finished.map((n) => `#${n}`).join(' ')} を実装完了（クローズ待ち）にしました。GitHub で閉じられるまで推奨から外します。`
                : `更新しました (${args.action})。`;
            return json({ ok: true, repo, action: args.action, plan, text: `${head}\n\n${renderPlan(state, plan, { limit: 5 })}` });
        },
    });
}
//# sourceMappingURL=tools.js.map