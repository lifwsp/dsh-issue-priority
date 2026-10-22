import { describe, expect, it } from 'vitest'
import { ISSUE_AUTHORING_SKILL } from '../src/skill.js'

// Guards the issue-unit design guidance against accidental removal.
describe('issue-authoring skill', () => {
  const c = ISSUE_AUTHORING_SKILL.content

  it('separates unit validity from format compliance', () => {
    expect(c).toContain('A. 単位の妥当性')
    expect(c).toContain('B. 形式の準拠')
    expect(c).toContain('issue_draft が ok を返しても')
  })

  it('designs units before drafting, in order', () => {
    const steps = ['論点の棚卸し', '既存 Issue の確認', '統合・分割・追記先の判断', '主成果と完了条件', '計画項目を見積もる', 'issue_draft で検証', '分け方を簡潔に報告']
    const idx = steps.map((s) => c.indexOf(s))
    expect(idx.every((i) => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('distinguishes work packages from merging issues', () => {
    expect(c).toContain('同じセッションで作業できること')
    expect(c).toContain('作業パッケージ')
  })

  it('has split criteria, anti-over-split criteria and destinations', () => {
    expect(c).toContain('A は採用し B は見送る')
    expect(c).toContain('過剰分割を避ける')
    expect(c).toContain('十分条件になりません')
    expect(c).toContain('既存 Issue に証拠・再現例を追記する')
    expect(c).toContain('そのままコピーしない')
  })

  it('covers investigation, implementation and umbrella issues and the worked examples', () => {
    for (const s of ['調査 Issue', '実装 Issue', 'まとめ Issue', '**分ける**', '**一つでよい**', '**既存に追記**', '**調査に留める**']) {
      expect(c).toContain(s)
    }
  })

  it('has no stray escaped backticks in the rendered text', () => {
    expect(c).not.toContain('\\`')
  })
})
