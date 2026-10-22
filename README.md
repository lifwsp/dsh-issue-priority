# dsh-issue-priority

DeepSeek Harness（DSH）向けプラグイン。GitHub の Open Issue を取得し、**DecisionEvaluator**（既定は [jevcore-dsh](https://www.npmjs.com/package/jevcore-dsh) / Jev）で構造化評価したうえで、決定論的な Ranking Policy により実装優先順位を返します。

```
GitHub API → Issue Priority Plugin → DecisionEvaluator (Jev) → Ranking Policy → DSH Agent
```

- LLM による説明文生成はしません（捏造もしません）
- 読み取り専用（Issue / Label / Milestone を書き換えません）
- Jev 未導入時は明確なエラー
- **モデル切替は jevcore-dsh 側**（`mock` / `live` / `openrouter` + `model`）。本プラグインは評価器インターフェースで差し替え可能

## 既存プラグインとの違い

| プラグイン | 何をするか | 本プラグインとの関係 |
| --- | --- | --- |
| [jevcore-dsh](https://www.npmjs.com/package/jevcore-dsh) | `ctx.jev` + `jev_ask` / `rank` / `check` | **依存サービス**（判断本体） |
| [dsh-ci-co-pilot](https://github.com/temotee2103/dsh-ci-co-pilot) `gh_triage_issues` | 年齢・staleness・ラベル等のヒューリスティック | Jev 優先度ランキングではない |
| [dsh-github-router](https://dshmp.com) | 読み取り GitHub アクセス | 取得層の代替候補（本プラグインは REST Adapter） |
| jev-triage (GitHub Action) | Issue ラベル付け | DSH ツールではない |

同名の「目標に対する実装優先順位」DSH プラグインは調査時点で見つかりませんでした。

## モデルは可換か？

### jevcore-dsh（基板）側

はい。Jev はチャット LLM ではなく System One 判定モデルです。切替対象は次です。

| 設定 | 意味 |
| --- | --- |
| `provider: mock` | オフライン合成値（結果に synthetic 明示） |
| `provider: live` | TypeSafe 直結（`TYPESAFE_API_KEY`） |
| `provider: openrouter` | OpenRouter 経由の System One（`OPENROUTER_API_KEY`） |
| `model` | 例: `jev-latest`, `typesafe/jev-1.13` |

GPT / Claude など**文章生成モデルへの差し替えは意図されていません**（散文を判定値として解釈できないため）。

### 本プラグイン側

- `DecisionEvaluator` インターフェースで評価器を抽象化
- 設定 `evaluator: jev`（現状の実装は Jev のみ）
- ランキングは TypeScript の決定論コードのままなので、将来別の Decision AI アダプタを足してもポリシーは共有できる

## 必要要件

- Node `^22.19.0 || >=24`
- DSH `>=0.1.7`（検証: `0.2.1-rc.2`）
- 依存プラグイン: **jevcore-dsh**（`ctx.get('jev')`）
- GitHub: 公開リポジトリはトークンなしでも可（レート制限あり）。Private は `GITHUB_TOKEN` / `GH_TOKEN`

## インストール

```sh
# 1) Jev（未導入なら）
dsh plugin --profile web add jevcore-dsh

# 2) 本プラグイン（ローカルパス）
dsh plugin --profile web add /absolute/path/to/dsh-issue-priority
```

または `cordis.patch.yml` に:

```yml
- insert:
  - id: jev
    name: jevcore-dsh
    config:
      provider: mock          # 本番は live / openrouter + key
      # model: jev-latest
  - id: dsh-issue-priority
    name: dsh-issue-priority
    config:
      allowExternalJudgment: false   # live 利用時は true に（下記プライバシー）
      defaultLimit: 20
```

起動後、プラグイン一覧で `dsh-issue-priority` が active であること、および jev の startup egress 行を確認してください。

## GitHub 認証

```sh
export GITHUB_TOKEN=ghp_...   # または GH_TOKEN
# プラグイン設定 githubTokenRef の名前と揃える（既定: GITHUB_TOKEN）
```

トークン値はログに出しません。

## プライバシー（必読）

`allowExternalJudgment: true` かつ jevcore が `live` / `openrouter` のとき、**Issue タイトル・本文・ラベル・依存関係などの構造化 state が外部（TypeSafe または OpenRouter）に送信されます。**

Private Repository の本文が外部に出る可能性があります。既定は `allowExternalJudgment: false` で、送信系プロバイダならツールが拒否します。`mock` ならネットワーク送信はありません（合成判定）。

## ツール: `prioritize_issues`

```ts
prioritize_issues({
  repo: 'owner/repo',
  objective: 'MVPを完成させる',
  limit: 20,           // optional
  labels: ['mvp'],     // optional
  forceRefresh: false, // optional — キャッシュ無視
})
```

### 出力（要約）

- 順位、Issue 番号 / タイトル / URL
- Priority Score、Impact / Urgency / Effort / Unblock Value / Confidence
- `ready` | `blocked` | `needs_review`
- evidenceRefs、rankingPolicy（version + weights）、evaluator（provider / model）
- mock 結果は `synthetic: true`（本番判定と混同しない）

### ランキング式（v1.0.0）

```
priority = 0.35·impact + 0.25·urgency + 0.25·unblockValue − 0.15·effort
```

各次元は Jev `score`（0..4）を `[0,1]` に正規化。Confidence が閾値未満、または判定失敗は `needs_review`（スコア捏造なし）。明示依存（`blocked by #N` 等）は制約として `blocked` に分離。

## 使用例

ユーザー:

> このリポジトリで MVP 完成に向けて次に実装すべき Issue を優先順位付きで示して

Agent は `prioritize_issues` を呼び、返却の structured データから説明します（プラグインは説明文を生成しません）。

## 開発

```sh
pnpm install
pnpm check   # typecheck + test + build
```

テストは GitHub / Jev をモックし、外部 API なしで実行します。

## 設定一覧

| Key | Default | 説明 |
| --- | --- | --- |
| `evaluator` | `jev` | 評価器 |
| `defaultLimit` | `20` | 取得上限 |
| `evaluateConcurrency` | `4` | 同時判定数 |
| `allowExternalJudgment` | `false` | 外部送信許可 |
| `githubTokenRef` | `GITHUB_TOKEN` | トークン参照名 |
| `confidenceThreshold` | `0.55` | 未満は needs_review |
| `weights.*` | 上記式 | ランキング重み |
| `logLevel` | `info` | ログ |

## ライセンス

MIT
