/**
 * The only four things the decision model is asked (design §5.3):
 * 1. size + actionable — for issues without a valid dsh-plan block
 * 2. priority          — for issues without a priority label
 * 3. merge             — for candidate pairs the code already found
 * 4. direction         — for pairs that mention each other
 *
 * Every answer is cached under a hash of exactly the inputs it saw, so an
 * unchanged issue is never re-asked (judge only on diff).
 */
import { createHash } from 'node:crypto';
/** Bump when question wording changes so cached answers are re-asked. */
export const QUESTION_VERSION = 'q2';
/** Total characters of body + comments sent per issue. */
const THREAD_LIMIT = 4000;
const BODY_HEAD = 1500;
function hash(parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}
/**
 * The issue as one chronological thread: the body is the first post, comments
 * follow oldest first. Body and comments are equal inputs; when the total is
 * too long the body keeps its head and the newest comments are kept, dropping
 * the middle of the discussion (conclusions tend to be at the end).
 */
export function issueThread(issue, limit = THREAD_LIMIT) {
    const day = (iso) => (iso ? iso.slice(0, 10) : '');
    const comments = (issue.thread ?? []).map((c) => ({ by: c.by, at: day(c.at), text: c.text }));
    const bodyText = issue.body.trim();
    const body = { by: `${issue.author ?? 'author'} (issue body)`, at: day(issue.createdAt), text: bodyText };
    const total = bodyText.length + comments.reduce((s, c) => s + c.text.length, 0);
    if (total <= limit)
        return [body, ...comments];
    const head = bodyText.length > BODY_HEAD ? `${bodyText.slice(0, BODY_HEAD)}…` : bodyText;
    let room = limit - head.length;
    const kept = [];
    for (let i = comments.length - 1; i >= 0; i -= 1) {
        const c = comments[i];
        if (c.text.length > room) {
            if (room > 200)
                kept.unshift({ ...c, text: `${c.text.slice(0, room)}…` });
            break;
        }
        kept.unshift(c);
        room -= c.text.length;
    }
    const omitted = comments.length - kept.length;
    return [
        { ...body, text: head },
        ...(omitted > 0 ? [{ by: '', at: '', text: `[${omitted} earlier comment(s) omitted]` }] : []),
        ...kept,
    ];
}
function issueState(issue) {
    return {
        number: issue.number,
        title: issue.title,
        labels: issue.labels,
        note: 'thread is in chronological order; when a later post changes scope, priority or dependencies, the later post wins',
        thread: issueThread(issue),
        ...(issue.block ? { areas: issue.block.areas, files: issue.block.files } : {}),
    };
}
const SIZE_Q = {
    type: 'score',
    instructions: 'How much implementation work does this GitHub issue need for one developer working with an AI coding agent?',
    criteria: [
        'S: small, about an hour or less (typo, config, one small function)',
        'M: medium, about half a day (a feature touching a few files)',
        'L: large, a day or more, or should be split into several issues',
    ],
};
const ACTIONABLE_Q = {
    type: 'noul',
    instructions: 'Could a developer start implementing this issue now without asking the author for clarification?',
    criteria: {
        true: 'The goal and expected behaviour are clear enough to start',
        false: 'Requirements are missing, contradictory, or it is only a discussion / question',
    },
};
const PRIORITY_Q = {
    type: 'score',
    instructions: 'How important is it for the project to resolve this GitHub issue soon, compared with typical issues in the same repository? ' +
        'Consider user impact, broken or risky behaviour, and whether other work waits for it.',
    criteria: [
        'low: nice to have, polish, or speculative idea; nothing is broken without it',
        'medium: a real improvement or a minor bug that users would notice',
        'high: a bug, data loss, security or blocking problem, or a core feature users need now',
    ],
};
const MERGE_Q = {
    type: 'noul',
    instructions: 'Should these two GitHub issues be fixed together in one branch and one pull request by the same developer, ' +
        'because they change the same code or one fix naturally includes the other?',
    criteria: {
        true: 'Doing them in one change is clearly simpler than doing them separately',
        false: 'They are independent changes that merely share a topic',
    },
};
const DIRECTION_Q = {
    type: 'choice',
    instructions: 'These two issues reference each other. Which one should be implemented first?',
    criteria: {
        'a-first': 'Issue A should be done before issue B',
        'b-first': 'Issue B should be done before issue A',
        none: 'Order does not matter',
    },
};
const stillBlockedQ = (dep) => ({
    type: 'noul',
    instructions: `Read the thread in order; later posts override earlier ones. As of the latest post, must issue #${dep} be finished before work on this issue can start?`,
    criteria: {
        true: `Yes, #${dep} is still a prerequisite`,
        false: `No, the dependency on #${dep} was dropped, resolved differently, or never really existed`,
    },
});
function scoreToSize(answer) {
    if (!answer || answer.type !== 'score' || !Number.isFinite(answer.score))
        return null;
    return answer.score < 0.5 ? 'S' : answer.score < 1.5 ? 'M' : 'L';
}
function scoreToPriority(answer) {
    if (!answer || answer.type !== 'score' || !Number.isFinite(answer.score))
        return null;
    const level = answer.score < 0.67 ? 'low' : answer.score < 1.34 ? 'medium' : 'high';
    return { level, score: answer.score };
}
function noulValue(answer) {
    return answer && answer.type === 'noul' && Number.isFinite(answer.noul) ? answer.noul : null;
}
export function createJudge(client, store, providerLabel) {
    const usage = { requests: 0, questions: 0, inputTokens: 0 };
    let lastError;
    let answeredBy;
    async function ask(state, questions, signal) {
        if (!client)
            return null;
        try {
            const res = await client.ask({ state, questions, signal });
            usage.requests += 1;
            usage.questions += Object.keys(questions).length;
            usage.inputTokens += res.usage.input_tokens;
            if (res.model)
                answeredBy = res.model;
            return res.answers;
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            lastError = error instanceof Error ? error.message : String(error);
            return null;
        }
    }
    async function cached(key, compute) {
        const hit = store.get(key);
        if (hit !== undefined)
            return hit;
        const value = await compute();
        if (value !== null)
            store.set(key, value);
        return value;
    }
    const pairState = (a, b) => ({ A: issueState(a), B: issueState(b) });
    // Answers are model-specific: a different provider/model must not reuse them.
    const scope = `${client?.provider ?? 'none'}/${client?.model ?? ''}`;
    return {
        get available() {
            return client !== null;
        },
        provider: providerLabel ?? client?.provider ?? 'none',
        get model() {
            return answeredBy ?? client?.model;
        },
        usage,
        get lastError() {
            return lastError;
        },
        size(issue, signal) {
            const state = issueState(issue);
            return cached(`size:${QUESTION_VERSION}:${scope}:${issue.number}:${hash(state)}`, async () => {
                const answers = await ask(state, { size: SIZE_Q, actionable: ACTIONABLE_Q }, signal);
                if (!answers)
                    return null;
                const size = scoreToSize(answers.size);
                const actionable = noulValue(answers.actionable);
                if (!size || actionable === null)
                    return null;
                return { size, actionable };
            });
        },
        priority(issue, signal) {
            const state = issueState(issue);
            return cached(`priority:${QUESTION_VERSION}:${scope}:${issue.number}:${hash(state)}`, async () => {
                const answers = await ask(state, { priority: PRIORITY_Q }, signal);
                return scoreToPriority(answers?.priority);
            });
        },
        merge(a, b, signal) {
            const [x, y] = a.number < b.number ? [a, b] : [b, a];
            const state = pairState(x, y);
            return cached(`merge:${QUESTION_VERSION}:${scope}:${x.number}-${y.number}:${hash(state)}`, async () => {
                const answers = await ask(state, { merge: MERGE_Q }, signal);
                const p = noulValue(answers?.merge);
                return p === null ? null : { p };
            });
        },
        direction(a, b, signal) {
            const [x, y] = a.number < b.number ? [a, b] : [b, a];
            const state = pairState(x, y);
            return cached(`direction:${QUESTION_VERSION}:${scope}:${x.number}-${y.number}:${hash(state)}`, async () => {
                const answers = await ask(state, { order: DIRECTION_Q }, signal);
                const ans = answers?.order;
                if (!ans || ans.type !== 'choice')
                    return null;
                const choice = ans.choice === 'a-first' || ans.choice === 'b-first' ? ans.choice : 'none';
                const p = ans.probabilities[ans.choice] ?? ans.confidence ?? 0;
                return { choice, p };
            });
        },
        stillBlocked(issue, dep, signal) {
            const state = issueState(issue);
            return cached(`blocked:${QUESTION_VERSION}:${scope}:${issue.number}-${dep}:${hash(state)}`, async () => {
                const answers = await ask(state, { blocked: stillBlockedQ(dep) }, signal);
                const p = noulValue(answers?.blocked);
                return p === null ? null : { p };
            });
        },
    };
}
//# sourceMappingURL=judge.js.map