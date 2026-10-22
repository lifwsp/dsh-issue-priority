/**
 * Slash commands (design §7). Commands never reach the model except `/issues next`,
 * which hands a kickoff message to the agent as a follow-up turn.
 */
import { nextPackage, renderKickoff, renderPackage, renderPlan, userMessage } from './render.js'
import type { IssuePlanRuntime } from './runtime.js'

type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

interface Invocation {
  agent: { followup?: (message: unknown) => void; session?: unknown }
  rawInput: string
  signal?: AbortSignal
}

const HELP = [
  '/issues            計画を表示（必要なら同期）',
  '/issues next [ID]  次のパッケージ（または指定 ID）をエージェントに着手させる',
  '/issues defer N    #N を後回し',
  '/issues pin N      #N を優先',
  '/issues clear N    defer/pin を解除',
  '/issues done [N…]  実装完了（クローズ待ち）にする。省略時は作業中のもの全部',
  '/issues stop       完了にせず作業中の印だけ外す',
  '/issues reopen N   クローズ待ちの #N を計画に戻す（まだ終わっていない）',
  '/issues sync       GitHub と今すぐ同期（full で全件取り直し）',
].join('\n')

function parseIssue(arg: string | undefined): number | null {
  const n = Number(arg?.replace(/^#/, ''))
  return Number.isInteger(n) && n > 0 ? n : null
}

export async function runIssuesCommand(runtime: IssuePlanRuntime, inv: Invocation): Promise<CommandResult> {
  const [sub = '', ...rest] = inv.rawInput.trim().split(/\s+/).filter(Boolean)
  const signal = inv.signal
  try {
    const repo = await runtime.resolveRepoFor(inv.agent)
    switch (sub.toLowerCase()) {
      case '':
      case 'show':
      case 'list': {
        const { state, plan } = await runtime.ensurePlan(repo, { signal, cwd: runtime.cwdFor(inv.agent) })
        return { kind: 'success', text: renderPlan(state, plan) }
      }
      case 'sync': {
        const res = await runtime.deps.sync.sync(repo, { full: rest[0] === 'full', signal, cwd: runtime.cwdFor(inv.agent) })
        const head = res.unchanged
          ? `同期しました（変更なし、判定 0 件）。`
          : `同期しました: 取得 ${res.fetched} / 変更 ${res.changed.length} / クローズ ${res.closed.length}。`
        return { kind: 'success', text: `${head}\n\n${renderPlan(res.state, res.plan)}` }
      }
      case 'next': {
        const { state, plan } = await runtime.ensurePlan(repo, { signal, cwd: runtime.cwdFor(inv.agent) })
        const pkg = rest[0] ? plan.workPackages.find((p) => p.id === rest[0]) : nextPackage(plan)
        if (!pkg) {
          return { kind: 'error', text: rest[0] ? `パッケージ ${rest[0]} が見つかりません。` : '着手可能なパッケージがありません。/issues で状況を確認してください。' }
        }
        if (typeof inv.agent.followup !== 'function') {
          return { kind: 'success', text: `${renderPackage(pkg, state.issues).join('\n')}\n\n（このセッションではエージェントへの引き渡しができません）` }
        }
        inv.agent.followup(userMessage(renderKickoff(plan, pkg, state.issues)))
        return { kind: 'success', text: `${pkg.id} をエージェントに渡しました:\n${renderPackage(pkg, state.issues).join('\n')}` }
      }
      case 'defer':
      case 'pin':
      case 'clear': {
        const n = parseIssue(rest[0])
        if (!n) return { kind: 'error', text: `使い方: /issues ${sub} <Issue番号>` }
        const { state, plan } = await runtime.mutate(repo, (s) => runtime.setOverride(s, n, sub as 'defer' | 'pin' | 'clear'), signal)
        return { kind: 'success', text: `#${n} を ${sub} にしました。\n\n${renderPlan(state, plan, { limit: 5 })}` }
      }
      case 'done':
      case 'finish': {
        const nums = rest.map(parseIssue)
        if (nums.some((n) => n === null)) return { kind: 'error', text: '使い方: /issues done [Issue番号…]' }
        const branch = await runtime.branchFor(inv.agent)
        let finished: number[] = []
        const { state, plan } = await runtime.mutate(
          repo,
          (s) => {
            finished = runtime.finish(s, nums as number[], branch)
          },
          signal,
          runtime.cwdFor(inv.agent),
        )
        if (!finished.length) return { kind: 'error', text: '作業中の Issue がありません。/issues done <Issue番号> で指定してください。' }
        return {
          kind: 'success',
          text: `${finished.map((n) => `#${n}`).join(' ')} をクローズ待ちにしました（GitHub で閉じられるまで推奨から外します）。\n\n${renderPlan(state, plan, { limit: 5 })}`,
        }
      }
      case 'stop': {
        const { state, plan } = await runtime.mutate(repo, (s) => runtime.setInProgress(s, null), signal)
        return { kind: 'success', text: `作業中の印を外しました。\n\n${renderPlan(state, plan, { limit: 5 })}` }
      }
      case 'reopen': {
        const n = parseIssue(rest[0])
        if (!n) return { kind: 'error', text: '使い方: /issues reopen <Issue番号>' }
        const { state, plan } = await runtime.mutate(repo, (s) => runtime.reopen(s, n), signal, runtime.cwdFor(inv.agent))
        return { kind: 'success', text: `#${n} を計画に戻しました。\n\n${renderPlan(state, plan, { limit: 5 })}` }
      }
      case 'help':
        return { kind: 'success', text: HELP }
      default:
        return { kind: 'error', text: `不明なサブコマンド: ${sub}\n${HELP}` }
    }
  } catch (error) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

export function createIssuesCommand(runtime: IssuePlanRuntime) {
  return {
    name: 'issues',
    description: 'Issue の作業パッケージ計画を表示・操作する（next / defer / pin / sync）',
    input: { hint: '[next|defer N|pin N|clear N|done [N]|stop|reopen N|sync [full]|help]' },
    handler: (inv: Invocation) => runIssuesCommand(runtime, inv),
  }
}
