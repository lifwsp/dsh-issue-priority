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

### サイドバーの「Issue 計画」タブ（おすすめ）

[dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) が入っていれば、右サイドバーの「+」から **Issue 計画** タブを開けます。コマンドを覚えなくても、ボタンで次の操作ができます。

いちばん上に **「次はこれ」** のパッケージを 1 つだけ大きく出します。残りは「そのあと」に 1 行ずつ並び、▸ で開けます。計画の作られ方（最終同期、判定モデル、選んだ理由など）は画面に出さず、丸いアイコンにマウスを置くと見えます。見ておいたほうがよいこと（判定モデルが止まっている、同期エラー、壊れた dsh-plan ブロックなど）があるときだけ、リポジトリ名の横のアイコンが「!」になります。アイコンをクリックすると、同じ内容を画面に開きます。

- **同期**: GitHub と今すぐ同期します。
- **これに着手 / 続ける**: そのパッケージを、このセッションのエージェントに渡します。`/issues next ID` と同じです。
- **優先 / 後回し**: Issue ごとに切り替えます。もう一度押すと解除します。
- **作業中を解除**: `/issues done` と同じです。

タブは、開いているセッションの作業ディレクトリからリポジトリを判定します。表示中は 1 分ごとに計画を読み直します。読み直しでは GitHub に問い合わせず、保存済みの計画を返します。ただし計画が 5 分以上古いときは同期します。better-sidebar がなければ、タブが出ないだけで、コマンドはそのまま使えます。

### コマンド

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

## 並び順

依存関係（GitHub の Issue 依存 > dsh-plan の `dependsOn` > 本文の `blocked by #N`）を守ったうえで、同時に着手できるものは次の順に並べます。

1. 作業中 > 優先 > 通常 > 後回し
2. 重要度（`priority:high` などのラベル。なければ d1 が low / medium / high を推定）
3. 終わると着手できるようになるパッケージが多いもの
4. 規模が小さいもの
5. Issue 番号が小さいもの

ブロックのない Issue どうしでも、タイトルや本文が近ければ、d1 に「一緒に片付けるべきか」を聞いてまとめます。

## 設定

| キー | 既定 | 説明 |
| --- | --- | --- |
| `decisionProvider` | `openrouter` | `openrouter`（liquid/d1、モデル名は decisionModel で変更可。例: liquid/d1-ultra, typesafe/jev-1.14.0）/ `liquid`（api.liquid.ai の d1）/ `typesafe`（Jev）/ `custom` / `none` |
| `decisionModel` | `''` | モデル ID。空なら各プロバイダの既定（`custom` では必須） |
| `decisionApiUrl` | `''` | エンドポイント。`custom` では必須（System One 互換の POST） |
| `decisionApiKeyRef` | `''` | 空ならプロバイダごとに `LIQUID_API_KEY` / `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY` / `DECISION_API_KEY` |
| `allowExternalJudgment` | `false` | **true にしないと d1 に送りません**（Issue 本文が外部 API に送られるため） |
| `syncIntervalMinutes` | `60` | 0 でタイマー無効 |
| `maxIssues` | `300` | 1 回の同期で読む Open Issue の上限（更新が新しい順、最大 5000） |
| `maxQuestionsPerSync` | `200` | 1 回の同期で d1 に聞く上限 |
| `mergeThreshold` / `actionableThreshold` / `directionThreshold` | `0.6` / `0.35` / `0.6` | 判定のしきい値 |
| `similarityThreshold` | `0.1` | ブロックのない Issue どうしを「まとめ候補」にする文章の近さ（0〜1） |
| `maxPackageSize` | `4` | パッケージの規模上限（S=1, M=2, L=4） |
| `githubTokenRef` | `GITHUB_TOKEN` | なければ `GH_TOKEN`、`gh auth token` の順 |
| `dataDir` | `''` | 空なら `$DSH_HOME/data/dsh-issue-priority` |

## 開発

```bash
pnpm install
pnpm check   # typecheck + test + build
```

設計は [docs/design.md](docs/design.md)。
