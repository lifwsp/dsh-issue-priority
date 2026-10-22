/**
 * GitHub-native authoring: turn the planning facts an agent decided while
 * drafting an issue (dependencies, parent, milestone, priority) into the `gh`
 * commands that record them in GitHub's own features. The plugin never runs
 * these; the agent posts the issue with them (design §4a).
 *
 * What goes where:
 * - dependencies → Issue Dependencies (`--blocked-by`), falling back to the
 *   block's `dependsOn` only when the local gh is too old to set them;
 * - parent → Sub-issues (`--parent`);
 * - milestone → Milestone (`--milestone`);
 * - priority → the org "Priority" issue field when the repo uses it, else an
 *   existing priority label, else a `priority:<level>` label;
 * - areas / files / acceptance / size stay in the dsh-plan block.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { labelPriority } from '../plan/signals.js';
const execFileAsync = promisify(execFile);
/** gh 2.94 added --blocked-by / --blocking / --parent to issue create/edit. */
export const GH_RELATIONS_MIN = [2, 94];
export function parseGhVersion(text) {
    const m = /gh version (\d+)\.(\d+)/.exec(text);
    return m ? [Number(m[1]), Number(m[2])] : null;
}
export function supportsRelations(version) {
    if (!version)
        return false;
    return version[0] > GH_RELATIONS_MIN[0] || (version[0] === GH_RELATIONS_MIN[0] && version[1] >= GH_RELATIONS_MIN[1]);
}
let cachedVersion = null;
/** Local gh version (cached for the process); null when gh is missing. */
export function detectGhVersion() {
    cachedVersion ??= execFileAsync('gh', ['--version'], { timeout: 5000 }).then(({ stdout }) => parseGhVersion(stdout), () => null);
    return cachedVersion;
}
export function repoFeatures(issues) {
    const out = { priorityField: false, effortField: false, priorityLabels: {}, milestones: [] };
    const milestones = new Set();
    for (const i of issues) {
        if (i.native?.priority !== undefined)
            out.priorityField = true;
        if (i.native?.effort !== undefined)
            out.effortField = true;
        if (i.native?.milestone?.title)
            milestones.add(i.native.milestone.title);
        for (const l of i.labels) {
            const level = labelPriority([l]);
            if (level && !out.priorityLabels[level])
                out.priorityLabels[level] = l;
        }
    }
    out.milestones = [...milestones].sort();
    return out;
}
/** POSIX single-quote unless the word is plainly safe. */
export function shellQuote(value) {
    return /^[A-Za-z0-9_./:@,+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
const LEVEL_LABEL = { high: 'priority:high', medium: 'priority:medium', low: 'priority:low' };
const FIELD_OPTION = { high: 'High', medium: 'Medium', low: 'Low' };
export function planAuthoring(input) {
    const q = shellQuote;
    const repoFlag = input.repo ? ` -R ${q(input.repo)}` : '';
    const editing = input.issue !== undefined;
    const target = editing ? String(input.issue) : '<新しい Issue 番号>';
    const commands = [];
    const notes = [];
    const flags = [];
    let blockDependsOn = [];
    const ex = input.existing;
    const deps = [...new Set(input.dependsOn)].filter((n) => !ex?.blockedBy.includes(n)).sort((a, b) => a - b);
    if (deps.length) {
        if (input.ghRelations)
            flags.push(`${editing ? '--add-blocked-by' : '--blocked-by'} ${deps.join(',')}`);
        else {
            blockDependsOn = deps;
            notes.push('gh が古い（2.94 未満）ため、依存は dsh-plan の dependsOn に残しました。gh を更新すると GitHub の blocked by に登録できます。');
        }
    }
    if (input.parent !== undefined && input.parent !== ex?.parent) {
        if (input.ghRelations)
            flags.push(`--parent ${input.parent}`);
        else
            notes.push(`親 Issue #${input.parent} は、GitHub の画面で「Add sub-issue」から登録してください（gh 2.94 以上なら --parent で登録できます）。`);
    }
    if (input.milestone && input.milestone !== ex?.milestone) {
        flags.push(`--milestone ${q(input.milestone)}`);
        if (!input.features.milestones.includes(input.milestone)) {
            notes.push(`マイルストーン「${input.milestone}」が既存の Issue に見当たりません。なければ先に作成してください: gh api${input.repo ? ` repos/${input.repo}/milestones` : ' repos/{owner}/{repo}/milestones'} -f title=${q(input.milestone)}`);
        }
    }
    if (input.priority) {
        if (input.features.priorityField) {
            const owner = input.repo?.split('/')[0] ?? '{owner}';
            const path = input.repo ? `repos/${input.repo}` : 'repos/{owner}/{repo}';
            notes.push(`このリポジトリは Priority フィールドを使っています。フィールド ID を gh api orgs/${owner}/issue-fields で確かめてから、` +
                `gh api -X POST ${path}/issues/${target}/issue-field-values --input - で {"issue_field_values":[{"field_id":<ID>,"value":"${FIELD_OPTION[input.priority]}"}]} を送ってください（選択肢の名前はフィールドの定義に合わせる）。`);
        }
        else {
            const label = input.features.priorityLabels[input.priority];
            if (ex && labelPriority(ex.labels) === input.priority) {
                // Already labelled at this level.
            }
            else if (label)
                flags.push(`${editing ? '--add-label' : '--label'} ${q(label)}`);
            else {
                const name = LEVEL_LABEL[input.priority];
                commands.push(`gh label create ${q(name)}${repoFlag} --description ${q('dsh-work-planner priority')} 2>/dev/null || true`);
                flags.push(`${editing ? '--add-label' : '--label'} ${q(name)}`);
            }
        }
    }
    const main = editing
        ? `gh issue edit ${input.issue}${repoFlag} --body-file body.md${flags.length ? ` ${flags.join(' ')}` : ''}`
        : `gh issue create${repoFlag} --title ${q(input.title)} --body-file body.md${flags.length ? ` ${flags.join(' ')}` : ''}`;
    commands.push(main);
    return { commands, blockDependsOn, notes };
}
//# sourceMappingURL=authoring.js.map