/**
 * "Done but not closed" detection.
 *
 * An issue leaves the recommendations once its work exists somewhere but the
 * issue itself is still open: marked finished (issue_plan_update finish,
 * /issues done), commits on a local branch, or a pull request that points at
 * it. Everything here is deterministic; nothing is written to GitHub.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repoFromRemoteUrl } from './github/rest-adapter.js';
const execFileAsync = promisify(execFile);
// ── parsing ──────────────────────────────────────────────────────────────
const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi;
const MENTION_RE = /(?:^|[^\w/&])#(\d+)\b/g;
/** Issues a PR closes via GitHub closing keywords (`Closes #12`, `fixes owner/repo#3`). */
export function parseClosingRefs(text, repo) {
    const out = new Set();
    for (const m of text.matchAll(CLOSING_RE)) {
        const ref = m[1];
        const hash = ref.indexOf('#');
        const prefix = ref.slice(0, hash);
        if (prefix && prefix.toLowerCase() !== repo.toLowerCase())
            continue;
        out.add(Number(ref.slice(hash + 1)));
    }
    return [...out].sort((a, b) => a - b);
}
/**
 * Issue numbers a branch name points at: `issues/wp-12-13` (kickoff default),
 * `issue-12`, `fix/12-title`, `gh-12`, `12-title`. Callers keep only open issues.
 */
export function branchIssueRefs(branch) {
    const out = new Set();
    const wp = branch.match(/(?:^|\/)wp-(\d+(?:-\d+)*)(?:$|\/)/);
    if (wp)
        for (const n of wp[1].split('-'))
            out.add(Number(n));
    else {
        // `issue-12`, `gh12`, `#12` anywhere in a segment; a bare number only as `12-title`
        // (so `release/2` or `v2` do not count).
        for (const seg of branch.split('/')) {
            const m = seg.match(/^(?:issues?|gh|#)[-_]?(\d{1,6})(?:$|[-_])/i) ?? seg.match(/^(\d{1,6})[-_][a-z]/i);
            if (m)
                out.add(Number(m[1]));
        }
    }
    out.delete(0);
    return [...out].sort((a, b) => a - b);
}
export function mentionsIn(text) {
    const out = new Set();
    for (const m of text.matchAll(MENTION_RE))
        out.add(Number(m[1]));
    return [...out];
}
/** A branch name worth recording (not detached, not the usual default branches). */
export function usableBranch(branch) {
    return !!branch && !['main', 'master', 'trunk', 'develop', 'HEAD'].includes(branch);
}
// ── detection ────────────────────────────────────────────────────────────
function evidenceKey(e) {
    switch (e.kind) {
        case 'marked':
            return null;
        case 'branch':
            return `b:${e.branch}`;
        case 'pr':
            return `pr:${e.number}:${e.state}`;
    }
}
/** Stable keys of the detected (not marked) evidence, for dismissals. */
export function evidenceKeys(evidence) {
    return [...new Set(evidence.map(evidenceKey).filter((k) => k !== null))].sort();
}
function nextStep(evidence) {
    const prs = evidence.filter((e) => e.kind === 'pr');
    const branches = evidence.filter((e) => e.kind === 'branch' && !e.mentionOnly);
    if (prs.some((p) => p.state === 'merged') && !prs.some((p) => p.state === 'open'))
        return 'close-issue';
    const open = prs.filter((p) => p.state === 'open');
    if (open.length)
        return branches.some((b) => b.unpushed > 0) ? 'push' : 'merge-pr';
    if (branches.length)
        return branches.some((b) => b.unpushed > 0 || b.pushed === 'none' || b.pushed === 'gone') ? 'push' : 'open-pr';
    return 'check';
}
export function detectProgress(input) {
    const open = new Set(input.open);
    const inProgress = new Set(input.inProgress?.issues ?? []);
    const marks = new Map(input.finished.filter((f) => open.has(f.issue)).map((f) => [f.issue, f]));
    const recordedBranch = (n) => marks.get(n)?.branch ?? (inProgress.has(n) ? input.inProgress?.branch : undefined);
    const evidenceOf = new Map();
    const add = (n, e) => {
        if (!open.has(n))
            return;
        const list = evidenceOf.get(n) ?? [];
        list.push(e);
        evidenceOf.set(n, list);
    };
    for (const [n, f] of marks)
        add(n, { kind: 'marked', at: f.at, ...(f.branch ? { branch: f.branch } : {}) });
    const branchEvidence = (b, mentionOnly) => ({
        kind: 'branch',
        branch: b.branch,
        commits: b.commits,
        unpushed: b.unpushed,
        pushed: b.pushed,
        upstream: b.upstream,
        ...(mentionOnly ? { mentionOnly: true } : {}),
    });
    for (const b of input.local?.branches ?? []) {
        const targets = new Set(b.targets);
        for (const n of open)
            if (recordedBranch(n) === b.branch)
                targets.add(n);
        for (const n of targets)
            add(n, branchEvidence(b, false));
        // A passing `#N` in a commit is shown, but never takes the issue off the plan.
        for (const k of Object.keys(b.issues))
            if (!targets.has(Number(k)))
                add(Number(k), branchEvidence(b, true));
    }
    for (const p of input.pulls) {
        const linked = new Map();
        for (const n of p.branchRefs)
            linked.set(n, 'branch');
        for (const n of open)
            if (recordedBranch(n) === p.head && !linked.has(n))
                linked.set(n, 'branch');
        for (const n of p.closes)
            linked.set(n, 'keyword');
        for (const [n, how] of linked) {
            add(n, { kind: 'pr', number: p.number, state: p.state, draft: p.draft, url: p.htmlUrl, base: p.base, linked: how });
        }
    }
    const awaitingClose = [];
    const activity = {};
    for (const [n, evidence] of [...evidenceOf].sort((a, b) => a[0] - b[0])) {
        let awaiting;
        let source = 'detected';
        if (marks.has(n)) {
            awaiting = true;
            source = 'marked';
        }
        else {
            const keys = evidenceKeys(evidence);
            const dismissal = input.dismissed.find((d) => d.issue === n);
            const dismissed = dismissal !== undefined && keys.every((k) => dismissal.keys.includes(k));
            if (dismissed)
                awaiting = false;
            else if (inProgress.has(n)) {
                // Still being worked on: only a finished-looking PR takes it off the plan.
                awaiting = evidence.some((e) => e.kind === 'pr' && (e.state === 'merged' || (!e.draft && e.linked === 'keyword')));
            }
            else
                awaiting = evidence.some((e) => e.kind === 'pr' || (e.kind === 'branch' && !e.mentionOnly));
        }
        if (awaiting)
            awaitingClose.push({ issue: n, source, step: nextStep(evidence), evidence });
        else
            activity[String(n)] = evidence;
    }
    return { awaitingClose, activity };
}
// ── local git scan ───────────────────────────────────────────────────────
const GIT_TIMEOUT = 5000;
/** Branches whose last commit is older than this are treated as abandoned. */
export const STALE_BRANCH_DAYS = 30;
const MAX_BRANCHES = 40;
const MAX_COMMITS = 200;
async function git(cwd, args) {
    try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT, maxBuffer: 4 << 20 });
        return stdout;
    }
    catch {
        return null;
    }
}
async function refExists(cwd, ref) {
    return (await git(cwd, ['rev-parse', '--verify', '--quiet', ref])) !== null;
}
async function count(cwd, range) {
    const out = await git(cwd, ['rev-list', '--count', '--no-merges', range]);
    const n = Number(out?.trim());
    return Number.isFinite(n) ? n : 0;
}
/** Remote name whose URL is the GitHub repo. */
async function remoteFor(cwd, repo) {
    const out = await git(cwd, ['remote', '-v']);
    if (!out)
        return null;
    for (const line of out.split('\n')) {
        const [name, url] = line.split(/\s+/);
        if (name && url && repoFromRemoteUrl(url)?.toLowerCase() === repo.toLowerCase())
            return name;
    }
    return null;
}
async function defaultBranchRef(cwd, remote) {
    const head = (await git(cwd, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]))?.trim();
    if (head)
        return head;
    for (const name of ['main', 'master', 'trunk', 'develop']) {
        if (await refExists(cwd, `refs/remotes/${remote}/${name}`))
            return `${remote}/${name}`;
    }
    return null;
}
/**
 * Local branches with commits that are not on the remote default branch, and
 * which issues those commits / branch names point at. Read-only (no fetch).
 */
export async function scanLocalRepo(cwd, repo, now = new Date()) {
    const remote = await remoteFor(cwd, repo);
    if (!remote)
        return null;
    const base = await defaultBranchRef(cwd, remote);
    if (!base)
        return null;
    const refs = await git(cwd, [
        'for-each-ref',
        'refs/heads',
        '--sort=-committerdate',
        `--count=${MAX_BRANCHES}`,
        '--format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:unix)',
    ]);
    if (refs === null)
        return null;
    const cutoff = now.getTime() / 1000 - STALE_BRANCH_DAYS * 86400;
    const rows = refs
        .split('\n')
        .filter(Boolean)
        .map((l) => l.split('\0'))
        .filter((r) => Number(r[3]) >= cutoff);
    const branches = [];
    for (const [branch, upstreamRaw, track] of rows) {
        if (!branch)
            continue;
        const log = await git(cwd, ['log', '--no-merges', `--max-count=${MAX_COMMITS}`, '--format=%x1e%s%n%b', `${base}..${branch}`, '--']);
        if (log === null)
            continue;
        const messages = log.split('\x1e').map((m) => m.trim()).filter(Boolean);
        if (!messages.length)
            continue;
        const issues = {};
        const targets = new Set(branchIssueRefs(branch));
        for (const msg of messages) {
            for (const n of mentionsIn(msg))
                issues[String(n)] = (issues[String(n)] ?? 0) + 1;
            for (const n of parseClosingRefs(msg, repo))
                targets.add(n);
        }
        let upstream = upstreamRaw || null;
        if (!upstream && (await refExists(cwd, `refs/remotes/${remote}/${branch}`)))
            upstream = `${remote}/${branch}`;
        let pushed;
        let unpushed;
        if (!upstream) {
            pushed = 'none';
            unpushed = messages.length;
        }
        else if (track?.includes('gone')) {
            pushed = 'gone';
            unpushed = messages.length;
        }
        else {
            unpushed = await count(cwd, `${upstream}..${branch}`);
            pushed = unpushed === 0 ? 'all' : unpushed < messages.length ? 'partial' : 'none';
        }
        branches.push({ branch, upstream, pushed, unpushed, commits: messages.length, issues, targets: [...targets].sort((a, b) => a - b) });
    }
    return { path: cwd, base, scannedAt: now.toISOString(), branches };
}
// ── user-facing text ─────────────────────────────────────────────────────
export const STEP_LABEL = {
    push: 'push 待ち',
    'open-pr': 'PR 作成待ち',
    'merge-pr': 'PR マージ待ち',
    'close-issue': 'Issue クローズ待ち',
    check: '完了確認待ち',
};
export function describeEvidence(e) {
    switch (e.kind) {
        case 'marked':
            return `実装完了の印あり${e.branch ? `（${e.branch}）` : ''}`;
        case 'branch': {
            const push = e.pushed === 'none' ? `未 push ${e.unpushed} 件`
                : e.pushed === 'gone' ? `リモートのブランチは削除済み・未 push ${e.unpushed} 件`
                    : e.pushed === 'partial' ? `未 push ${e.unpushed} 件`
                        : 'push 済み';
            return `ブランチ ${e.branch}${e.mentionOnly ? '（コミットで言及）' : ''}: コミット ${e.commits} 件・${push}`;
        }
        case 'pr': {
            const st = e.state === 'merged' ? `マージ済み（${e.base}）` : e.draft ? 'ドラフト' : 'レビュー待ち';
            return `PR #${e.number} ${st}${e.linked === 'branch' ? '・本文に Closes なし' : ''}`;
        }
    }
}
/** One line on what to do next. */
export function describeStep(a) {
    const pr = a.evidence.find((e) => e.kind === 'pr');
    switch (a.step) {
        case 'push':
            return 'ブランチを push する';
        case 'open-pr':
            return `PR を作り、本文に Closes #${a.issue} を書く`;
        case 'merge-pr':
            return pr?.linked === 'branch' ? `PR #${pr.number} に Closes #${a.issue} を足してマージする` : `PR${pr ? ` #${pr.number}` : ''} をマージする`;
        case 'close-issue':
            return `マージ済みなのに開いたまま。#${a.issue} を閉じる`;
        case 'check':
            return 'PR やコミットが見つからない。完了していれば Issue を閉じる';
    }
}
//# sourceMappingURL=progress.js.map