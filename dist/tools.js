/**
 * Agent tools (design §7):
 * - issue_draft:       validate + render a dsh-plan block (never writes to GitHub)
 * - issue_plan_read:   read the stored plan (syncs if stale)
 * - issue_plan_update: record local overrides / dependencies / in-progress
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
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
            'Does NOT create the Issue; post the returned body yourself (e.g. `gh issue create --body-file`).',
        parameters: {
            title: { type: 'string', required: true, description: 'Issue title.' },
            body: { type: 'string', required: true, description: 'Human-readable Issue body (markdown). Any existing dsh-plan block is replaced.' },
            areas: { type: 'array', items: { type: 'string' }, required: true, description: 'Kebab-case area names, e.g. ["auth","ui"]. Prefer existing names.' },
            size: { type: 'string', enum: ['S', 'M', 'L'], required: true, description: 'S ≈ under an hour, M ≈ half a day, L ≈ a day or more.' },
            files: { type: 'array', items: { type: 'string' }, description: 'Repo-relative paths or globs likely to change (e.g. src/auth/**).' },
            dependsOn: { type: 'array', items: { type: 'integer' }, description: 'Issue numbers that must be done first.' },
            acceptance: { type: 'string', description: 'One-line acceptance criterion.' },
            repo: { type: 'string', description: 'owner/name. Default: detected from the session working directory.' },
        },
        isConcurrencySafe: () => true,
        output: textOutput,
        async execute(args, exec) {
            let repo = null;
            let known = [];
            try {
                repo = await runtime.resolveRepoFor(exec.agent, args.repo);
                known = (await runtime.deps.store.load(repo)).areas;
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
                text: [
                    `タイトル: ${args.title}`,
                    unknownAreas.length && known.length ? `新しい area を登録: ${unknownAreas.join(', ')}（既存: ${known.join(', ')}）` : '',
                    '--- body ---',
                    body,
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
            const { state, plan } = await runtime.ensurePlan(repo, { force: args.refresh, signal: exec.signal });
            const details = (args.issues ?? []).map((n) => state.issues[String(n)]).filter(Boolean);
            const next = nextPackage(plan);
            const text = [
                renderPlan(state, plan),
                ...details.map((i) => `\n--- #${i.number} ${i.title} (${i.htmlUrl}) ---\n${i.body}`),
            ].join('\n');
            return json({ repo, plan, next: next?.id ?? null, inProgress: state.inProgress, text });
        },
    });
}
export function createPlanUpdateTool(runtime) {
    return defineTool({
        name: 'issue_plan_update',
        description: 'Record local planning facts (stored only on this machine, never on GitHub): defer/pin/clear an issue, ' +
            'add or remove a dependency you discovered ("#A must wait for #B"), or mark which issues are in progress / done with. ' +
            'The plan is rebuilt immediately.',
        parameters: {
            action: {
                type: 'string',
                enum: ['defer', 'pin', 'clear', 'depend', 'undepend', 'start', 'finish'],
                required: true,
                description: 'defer/pin/clear: override for `issue`. depend/undepend: `issue` waits for `dependsOn`. start: mark `issues` in progress. finish: clear in-progress.',
            },
            issue: { type: 'integer', description: 'Target issue (defer/pin/clear/depend/undepend).' },
            dependsOn: { type: 'integer', description: 'Prerequisite issue (depend/undepend).' },
            issues: { type: 'array', items: { type: 'integer' }, description: 'Issues being worked on together (start).' },
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
            const branch = args.action === 'start' ? await runtime.branchFor(exec.agent) : null;
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
                        runtime.setInProgress(s, null);
                        break;
                }
            }, exec.signal);
            return json({ ok: true, repo, action: args.action, plan, text: `更新しました (${args.action})。\n\n${renderPlan(state, plan, { limit: 5 })}` });
        },
    });
}
//# sourceMappingURL=tools.js.map