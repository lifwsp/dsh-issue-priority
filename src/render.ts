/** Plain-text rendering of plans for commands and tool output (Japanese UI). */
import { randomUUID } from 'node:crypto'
import { describeEvidence, describeStep, STEP_LABEL } from './progress.js'
import type { RepoState } from './store.js'
import { describeOutcomes, summarizeOutcomes } from './outcomes.js'
import type { IssueRecord, Plan, PrioritySource, Rationale, WorkPackage } from './types.js'

const STATUS_LABEL: Record<WorkPackage['status'], string> = {
  ready: '着手可',
  waiting: '先行待ち',
  blocked: 'ブロック中',
  in_progress: '作業中',
}

export const PRIORITY_LABEL = { high: '高', medium: '中', low: '低' } as const

const PRIORITY_SOURCE_LABEL: Record<PrioritySource, string> = {
  github: 'GitHub の Priority フィールド',
  label: 'ラベル',
  decision: '判定モデル',
  default: '既定値',
}

function issueLabel(issues: Record<string, IssueRecord>, n: number): string {
  const i = issues[String(n)]
  return i ? `#${n} ${i.title}` : `#${n}`
}

export function describeRationale(r: Rationale): string {
  switch (r.kind) {
    case 'files-overlap':
      return `#${r.issues[0]} と #${r.issues[1]} が同じファイルに触る (${r.files.slice(0, 3).join(', ')})`
    case 'area-match':
      return `#${r.issues[0]} と #${r.issues[1]} が同じ領域 (${r.areas.join(', ')})`
    case 'decision-merge':
      return `#${r.issues[0]} と #${r.issues[1]} は一緒に片付けるのが自然 (p=${r.p.toFixed(2)})`
    case 'hard-dependency':
      return `#${r.issue} は #${r.dependsOn} の後 (${r.source})`
    case 'advisory-order':
      return `#${r.before} → #${r.after} の順が推奨 (推定 p=${r.p.toFixed(2)})`
    case 'similar-text':
      return `#${r.issues[0]} と #${r.issues[1]} の内容が近い (類似度 ${r.similarity.toFixed(2)})`
    case 'priority':
      return `#${r.issue} の重要度は${PRIORITY_LABEL[r.level]} (${PRIORITY_SOURCE_LABEL[r.source]})`
    case 'same-parent':
      return `#${r.issues[0]} と #${r.issues[1]} は同じ親 Issue #${r.parent} のサブ Issue`
    case 'same-milestone':
      return `#${r.issues[0]} と #${r.issues[1]} は同じマイルストーン「${r.milestone}」`
    case 'aging':
      return `#${r.issue} は起票から ${r.days} 日経過（先送りを防ぐため繰り上げ）`
    case 'due':
      return r.days < 0
        ? `#${r.issue} のマイルストーン「${r.milestone}」は期限切れ（${r.dueOn.slice(0, 10)}）`
        : `#${r.issue} のマイルストーン「${r.milestone}」の期限まで ${r.days} 日`
    case 'unblocks':
      return `終わると ${r.count} 個のパッケージが着手可能になる`
    case 'pinned':
      return `#${r.issue} は pin 指定`
    case 'deferred':
      return `#${r.issue} は後回し指定`
  }
}

/** The next package to work on: in-progress first, else the first ready one. */
export function nextPackage(plan: Plan): WorkPackage | null {
  return (
    plan.workPackages.find((p) => p.status === 'in_progress') ??
    plan.workPackages.find((p) => p.status === 'ready') ??
    null
  )
}

export function renderPackage(pkg: WorkPackage, issues: Record<string, IssueRecord>, index?: number): string[] {
  const prio = pkg.prioritySource === 'default' ? '' : ` 重要度 ${PRIORITY_LABEL[pkg.priority]}`
  const head = `${index != null ? `${index + 1}. ` : ''}[${STATUS_LABEL[pkg.status]}] ${pkg.id} (規模 ${pkg.size}${prio})`
  const lines = [head]
  for (const n of pkg.issues) lines.push(`   - ${issueLabel(issues, n)}`)
  if (pkg.dependsOn.length) lines.push(`   先に: ${pkg.dependsOn.join(', ')}`)
  if (pkg.waitingOnClose?.length) lines.push(`   クローズ待ち: ${pkg.waitingOnClose.map((n) => `#${n}`).join(', ')}（実装済み・未クローズ）`)
  if (pkg.blockedByExternal.length) lines.push(`   外部ブロッカー: ${pkg.blockedByExternal.map((n) => `#${n}`).join(', ')}`)
  for (const r of pkg.rationale.slice(0, 4)) lines.push(`   理由: ${describeRationale(r)}`)
  return lines
}

export function renderPlan(state: RepoState, plan: Plan, options: { limit?: number } = {}): string {
  const limit = options.limit ?? 10
  const lines: string[] = []
  lines.push(`${plan.repo} の作業計画（${plan.generatedAt} 時点、最終同期 ${state.lastSyncAt ?? '未同期'}）`)
  const c = plan.changesSinceLast
  if (c.new.length || c.closed.length || c.reordered.length) {
    const parts: string[] = []
    if (c.new.length) parts.push(`新規 ${c.new.map((n) => `#${n}`).join(' ')}`)
    if (c.closed.length) parts.push(`クローズ ${c.closed.map((n) => `#${n}`).join(' ')}`)
    if (c.reordered.length) parts.push(`並び替え ${c.reordered.length} 件`)
    lines.push(`前回からの変化: ${parts.join(' / ')}`)
  }
  const next = nextPackage(plan)
  lines.push(next ? `次のおすすめ: ${next.id}（${next.issues.map((n) => `#${n}`).join(', ')}）` : '着手可能なパッケージはありません。')
  lines.push('')
  plan.workPackages.slice(0, limit).forEach((p, i) => lines.push(...renderPackage(p, state.issues, i)))
  if (plan.workPackages.length > limit) lines.push(`…ほか ${plan.workPackages.length - limit} パッケージ`)
  const awaiting = plan.awaitingClose ?? []
  if (awaiting.length) {
    lines.push('', '実装済み・クローズ待ち（推奨から除外）:')
    for (const a of awaiting) {
      lines.push(`   - ${issueLabel(state.issues, a.issue)} [${STEP_LABEL[a.step]}] → ${describeStep(a)}`)
      for (const e of a.evidence.slice(0, 3)) lines.push(`       ${describeEvidence(e)}`)
    }
    lines.push('   （まだ終わっていなければ /issues reopen N で計画に戻す）')
  }
  if (plan.needsHuman.length) {
    lines.push('', '人の判断が必要:')
    for (const h of plan.needsHuman) {
      const why = h.reason === 'dependency-cycle' ? '依存が循環' : '内容が不明確'
      lines.push(`   - ${issueLabel(state.issues, h.issue)}: ${why}${h.detail ? `（${h.detail}）` : ''}`)
    }
  }
  if (plan.warnings.length) {
    lines.push('', '警告:')
    for (const w of plan.warnings.slice(0, 10)) lines.push(`   - #${w.issue} ${w.kind}: ${w.detail}`)
  }
  const outcomes = describeOutcomes(summarizeOutcomes(state.outcomes))
  if (outcomes) lines.push('', `計画の採用状況: ${outcomes}`)
  const d = plan.decision
  lines.push(
    '',
    `判定モデル: ${d.available ? (d.model ? `${d.model}（${d.provider} 経由）` : d.provider) : 'なし（決定的ルールのみ）'}・今回の質問 ${d.asked} 件` +
      ` / 累計 ${state.usage.questions} 件・約 ${state.usage.inputTokens} 入力トークン` +
      (d.note ? `\n   注記: ${d.note}` : ''),
  )
  return lines.join('\n')
}

/** Follow-up message handed to the agent by `/issues next`. */
export function renderKickoff(plan: Plan, pkg: WorkPackage, issues: Record<string, IssueRecord>): string {
  const closes = pkg.issues.map((n) => `Closes #${n}`).join(', ')
  const detail: string[] = []
  const files = new Set<string>()
  const areas = new Set<string>()
  for (const n of pkg.issues) {
    const i = issues[String(n)]
    detail.push(`- ${issueLabel(issues, n)}${i?.htmlUrl ? `（${i.htmlUrl}）` : ''}`)
    if (!i) continue
    const meta: string[] = [`規模 ${i.block?.size ?? '?'}`]
    if (i.native?.parent) meta.push(`親 Issue #${i.native.parent}`)
    if (i.native?.milestone) meta.push(`マイルストーン「${i.native.milestone.title}」`)
    detail.push(`  - ${meta.join('・')}`)
    if (i.block?.acceptance) detail.push(`  - 完了条件: ${i.block.acceptance}`)
    if (i.block?.files.length) detail.push(`  - 触る見込みのファイル: ${i.block.files.slice(0, 8).join(', ')}`)
    i.block?.files.forEach((f) => files.add(f))
    i.block?.areas.forEach((a) => areas.add(a))
  }
  const review: string[] = []
  if (areas.size) review.push(`- 領域: ${[...areas].join(', ')}（この範囲でまとめてテスト・レビューする）`)
  if (files.size) review.push(`- 変更の中心: ${[...files].slice(0, 10).join(', ')}`)
  if (pkg.dependsOn.length) review.push(`- 先行パッケージ: ${pkg.dependsOn.join(', ')}（未完了なら先に確認）`)
  const missing = pkg.issues.filter((n) => !issues[String(n)]?.block?.acceptance)
  if (missing.length) review.push(`- 完了条件が未記入: ${missing.map((n) => `#${n}`).join(', ')}（着手前に本文から読み取り、方針と一緒に提示する）`)
  return [
    `dsh-work-planner の計画に沿って、作業パッケージ ${pkg.id} に着手してください（${plan.repo}）。`,
    '',
    '対象 Issue（この順で対応）:',
    ...detail,
    '',
    'まとめた理由:',
    ...(pkg.rationale.length ? pkg.rationale.map((r) => `- ${describeRationale(r)}`) : ['- 単独パッケージ']),
    ...(review.length ? ['', 'レビュー・テストのまとまり:', ...review] : []),
    '',
    '進め方:',
    '1. まず issue_plan_read で計画と各 Issue の本文を確認し、作業方針を短く提示して私の承認を待つ。',
    `2. 承認後、作業用ブランチを切り（例: issues/${pkg.id}）、そのブランチ上で issue_plan_update action=start issues=[${pkg.issues.join(', ')}] を呼ぶ（まとめ方を変えるなら、実際に着手する Issue だけを渡す）。`,
    '3. Issue ごとに実装・テストし、こまめにコミットする（コミットメッセージに #番号 を入れる）。',
    '4. 実装が終わったら、push や PR の前でも issue_plan_update action=finish を呼ぶ（クローズ待ちになり、推奨から外れる）。途中で分けるなら、終わった Issue だけを issues に渡す。',
    `5. PR を作るときは本文に「${closes}」を入れる。`,
    '6. 依存の見落としや分割の誤りに気づいたら issue_plan_update で記録する。',
  ].join('\n')
}

/** Build a frozen user message shaped like dsh-llm createUserMessage (no hard dependency). */
export function userMessage(text: string): unknown {
  return Object.freeze({
    role: 'user',
    id: randomUUID(),
    content: Object.freeze([Object.freeze({ type: 'text', text })]),
    source: Object.freeze({ kind: 'user' }),
  })
}
