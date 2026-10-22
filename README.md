# dsh-issue-priority

DeepSeek Harness（DSH）向けプラグイン。溜まった GitHub Issue を、バックグラウンドで **「1 セッションで片付ける単位（作業パッケージ）」** にまとめ、着手順を決めておきます。DSH を開いて `/issues next` と打つか「Issue 対応しよう」と言えば、エージェントは計画を読んですぐ作業に入れます。

- バックグラウンド処理に **LLM を使いません**。決定的なルールと、判断専用モデル [LiquidAI d1](https://www.liquid.ai/blog/d1-decision-model)（入力 \$0.02 / 1M トークン）だけで計画します。
- d1 に聞くのは「変わった Issue」についてだけです。変更がなければ判定は 0 件です。
- GitHub には書き込みません。計画はローカルに保存します。

## 流れ

```
起票（issue-authoring スキル + issue_draft） → Issue 本文に <!-- dsh-plan --> ブロック
            ↓
毎時の同期（プラグイン内タイマー、LLM なし）
  GitHub 差分取得 → 依存グラフ → まとめ判定（ルール + d1） → 着手順
            ↓
/issues で確認 → /issues next でエージェントに着手指示 → ブランチ・実装・PR（Closes #N）
```

## 使い方

| コマンド | 内容 |
| --- | --- |
| `/issues` | 計画を表示（5 分以上古ければ同期） |
| `/issues next [ID]` | 次のパッケージをエージェントに渡す（方針提示→承認待ちから始まる） |
| `/issues defer N` / `pin N` / `clear N` | 後回し / 優先 / 解除 |
| `/issues done` | 作業中の印を外す |
| `/issues sync [full]` | 今すぐ同期 |

エージェント用ツール: `issue_draft`（dsh-plan ブロックの検証と本文生成）、`issue_plan_read`、`issue_plan_update`。スキル: `issue-authoring`、`issue-work`。

リポジトリはセッションの作業ディレクトリの `git remote` から自動で判定します。

## dsh-plan ブロック

```markdown
<!-- dsh-plan
v: 1
areas: auth, ui
size: M
files: src/auth/**, src/ui/login.tsx
dependsOn: 12
acceptance: ログイン画面でエラーが表示される
-->
```

`issue_draft` が作るので手で書く必要はありません。ブロックのない Issue も計画に入ります（規模は d1 が推定、なければ M とみなす）。

## 設定

| キー | 既定 | 説明 |
| --- | --- | --- |
| `decisionProvider` | `liquid` | `liquid`（d1）/ `openrouter`（liquid/d1）/ `typesafe`（Jev）/ `custom` / `none` |
| `decisionModel` | `''` | モデル ID。空なら各プロバイダの既定（`custom` では必須） |
| `decisionApiUrl` | `''` | エンドポイント。`custom` では必須（System One 互換の POST） |
| `decisionApiKeyRef` | `''` | 空ならプロバイダごとに `LIQUID_API_KEY` / `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY` / `DECISION_API_KEY` |
| `allowExternalJudgment` | `false` | **true にしないと d1 に送りません**（Issue 本文が外部 API に送られるため） |
| `syncIntervalMinutes` | `60` | 0 でタイマー無効 |
| `maxIssues` | `300` | 1 回の同期で読む Open Issue の上限（更新が新しい順、最大 5000） |
| `maxQuestionsPerSync` | `200` | 1 回の同期で d1 に聞く上限 |
| `mergeThreshold` / `actionableThreshold` / `directionThreshold` | `0.6` / `0.35` / `0.6` | 判定のしきい値 |
| `maxPackageSize` | `4` | パッケージの規模上限（S=1, M=2, L=4） |
| `githubTokenRef` | `GITHUB_TOKEN` | なければ `GH_TOKEN`、`gh auth token` の順 |
| `dataDir` | `''` | 空なら `$DSH_HOME/data/dsh-issue-priority` |

## 開発

```bash
pnpm install
pnpm check   # typecheck + test + build
```

設計は [docs/design.md](docs/design.md)。
