# dsh-issue-priority 設計メモ（v1）

2026-10-22 時点の合意内容。叩き台（`prioritize_issues`）からの方針転換を記録する。

## 1. 目的

Issue がたまっていく中で、DSH を開いて `/issues next`（または「Issue 対応しよう」）と言った時点で、

- 次に着手する作業単位（＝セッションの分け方）
- その中の Issue の順番と、作業単位どうしの順番（「#C の後に #A、その次に #B」）

がすでに決まっている状態にする。

## 2. 要件と制約

| 項目 | 決定 |
| --- | --- |
| 費用 | バックグラウンド処理で LLM を使わない。判断は Decision Model（Jev）と決定論コードのみ |
| 判定タイミング | 差分があったときだけ Jev を呼ぶ（Issue の `updated_at` / 本文ハッシュが変わったもの） |
| 利用者 | 1 人。並列実行機能は作らないが、データ構造は「同時に着手可能なパッケージ一覧」を出せる形にする |
| 保存 | ローカル完結（リポジトリにはコミットしない） |
| GitHub 書き込み | プラグインは書き込まない。Issue のクローズは PR の `Closes #N` に任せ、プラグインは closed を取得するだけ |
| 対象リポジトリ | DSH の作業ディレクトリの git remote から自動判定。複数リポジトリ登録は v1 では非対応 |

LLM の費用がかかるのは、人が DSH を開いて作業するとき（起票・着手・実装）だけ。

## 3. 全体像

```
[起票時・LLM あり]                [バックグラウンド・LLM なし]           [着手時・LLM あり]
 skill: issue-authoring           タイマー(1h) / /issues 実行時          /issues next
 tool: issue_draft      ──GitHub──▶ 差分取得                         ──▶ 計画を提示 → 承認
  └ dsh-plan ブロック付き本文        ブロック解析 / 依存抽出               ブランチ作成・goal 設定
                                   候補ペアのみ Jev 判定                 Issue 本文と acceptance を読む
                                   パッケージ化・トポロジカル順          PR に Closes #N
                                   ローカル保存（差分記録）
```

## 4. 起票の書式（`dsh-plan` ブロック）

Issue 本文の末尾に HTML コメントとして埋め込む。GitHub 上では表示されない。

```md
<!-- dsh-plan
v: 1
areas: [auth, sync]
size: M
files: [src/auth/token.ts, src/api/*.ts]
dependsOn: [12]
acceptance: トークン期限切れ時に自動更新される
-->
```

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| `v` | 必須 | 書式バージョン。現在 `1` |
| `areas` | 必須 | 機能単位の短い語（ディレクトリ名とは独立）。既存語彙から選ぶ。新語はツールが警告 |
| `size` | 必須 | `S`（〜1h）/ `M`（〜半日）/ `L`（1 日以上。分割を推奨） |
| `files` | 任意 | ファイル単位。glob 可 |
| `dependsOn` | 任意 | 先に終わっている必要がある Issue 番号 |
| `acceptance` | 任意 | 完了条件 1 行 |

- 書式の正本はプラグイン内のスキーマ 1 つ。`issue_draft` の検証と同期時の解析は同じ定義から作る。
- 解析に失敗したブロックは「ブロックなし」として扱い、計画全体は止めない。
- `areas` の語彙はローカルに保存し、`issue_draft` が既存語彙を返して表記揺れを防ぐ。

### 起票側の提供物

- **tool `issue_draft`**：項目を受け取り検証し、ブロック付き本文を返す。GitHub へは書き込まない（作成はエージェントが `gh issue create` で行う）。
- **skill `issue-authoring`**：`ctx.skills.register()` で登録。「Issue を立てるときは `issue_draft` を使う」「`files` はコードを確認してから書く」等の手順。
- AGENTS.md には何も追記しない（ユーザー所有ファイルであり、毎ターンのトークン消費にもなるため）。

## 5. 計画の組み立て

### 5.1 依存（強い順）

1. GitHub 標準の Issue 依存関係（blocked by）
2. `dsh-plan` の `dependsOn`
3. 本文中の `blocked by #N` 等（既存 `parseDependencies` を流用）
4. Jev の推定 —— **推奨順としてのみ扱い、着手を止める理由にはしない**

1〜3 はハード制約（未クローズの依存先がある間は `blocked`）。循環は検出して `needsHuman` に回す。

### 5.2 同一セッションにまとめる条件

次の両方を満たすとき同じパッケージにする。

1. `files` が重なる（ディレクトリ一致は「近い」とみなす）、または `areas` が一致し、**かつ** Jev が「同じ変更で片付けるべき」と判定した
2. パッケージの `size` 合計が M×2 以下（S=1, M=2, L=4 換算で合計 4 以下）

### 5.3 Jev で判定すること（これ以外には使わない）

| 判定 | 対象 | 型 |
| --- | --- | --- |
| `size` / 着手可否 | ブロックのない Issue のみ | score / noul |
| まとめるべきか | 5.2 の候補ペアのみ | noul |
| 依存の向き | 本文で互いに言及しているペアのみ | choice（A→B / B→A / なし） |

- 全ペア判定はしない（件数の 2 乗になるため）。候補はコードで絞る。
- 判定結果は入力ハッシュをキーにローカル保存し、入力が変わらない限り再判定しない。
- 叩き台の 5 軸スコア（impact / urgency / effort / unblockValue）と重み式は v1 では使わない。

### 5.4 順序

パッケージの依存グラフをトポロジカルソート。同順位は `pin` > Issue 番号の小さい順。`defer` されたものは末尾。

## 6. 計画データ（ローカル保存）

保存先：プラグインのデータディレクトリ配下、リポジトリごとに 1 ファイル。

```jsonc
{
  "schema": 1,
  "repo": "owner/repo",
  "generatedAt": "2026-10-22T05:00:00Z",
  "syncedUntil": "2026-10-22T04:58:12Z",       // 次回差分取得の起点
  "workPackages": [
    {
      "id": "wp-12-7",
      "issues": [12, 7],                         // この順で 1 セッション
      "dependsOn": [],                           // 他パッケージ id
      "rationale": [{ "kind": "files-overlap", "files": ["src/auth/token.ts"] },
                    { "kind": "jev-merge", "p": 0.82 }],
      "size": 3,
      "status": "ready"                          // ready | blocked | in_progress | done
    }
  ],
  "needsHuman": [{ "issue": 20, "reason": "dependency-cycle" }],
  "overrides": [{ "issue": 9, "action": "defer", "at": "..." }],
  "changesSinceLast": { "new": [21], "closed": [3], "reordered": ["wp-15"] }
}
```

`rationale` は散文ではなく構造化データで持つ（説明文はエージェントが生成する）。

## 7. 運用

### 7.1 同期

- プラグイン内タイマー（`cordis-plugin-timer`）で 1 時間ごと、および `/issues` 実行時。
- `since=syncedUntil` で差分のみ取得。変化した Issue と、その Issue が関わる候補ペアだけ Jev に送る。差分がなければ Jev は呼ばない。
- DSH の `schedule` は使わない（エージェント経由で LLM 費用が発生するため）。

### 7.2 コマンド（`ctx.commands`）

| コマンド | 動作 |
| --- | --- |
| `/issues` | 計画と前回からの差分を表示（同期してから） |
| `/issues next` | 次の ready パッケージを提示 → 承認後、エージェントがブランチ作成・goal 設定・Issue 読み込み・PR に `Closes #N` |
| `/issues defer N` | 後回しにする（以後の計画で末尾） |
| `/issues pin N` | 最優先にする |

worktree はオプション（既定オフ）。

### 7.3 エージェント向けツール

- `issue_plan_read`：計画を読む（「Issue 対応しよう」と言われたとき用）
- `issue_plan_update`：着手・完了の記録、作業中に見つけた依存の追記（スキーマ検証・循環検出あり）

## 8. プライバシー

叩き台の方針を維持する。`allowExternalJudgment: false` が既定で、Jev が外部送信するプロバイダ（live / openrouter）の場合は判定を拒否する。

## 9. 叩き台からの流用と作り直し

| 既存 | 扱い |
| --- | --- |
| `src/github/rest-adapter.ts` | 流用。`since` による差分取得、closed 取得、Issue 依存関係 API を追加 |
| `src/github/dependencies.ts` | 流用（依存情報源 3） |
| `src/decision/jev-evaluator.ts` | 骨格（タイムアウト・egress 拒否・並列プール）を流用。質問を 5.3 の 3 種に差し替え |
| `src/cache/evaluation-cache.ts` | メモリキャッシュ → ローカル永続の判定ストアに作り直し |
| `src/ranking/policy.ts` | 廃止。パッケージ化とトポロジカル順の `src/plan/` に置き換え |
| `src/tools/prioritize-issues.ts` | 廃止。`issue_draft` / `issue_plan_read` / `issue_plan_update` に置き換え |
| `src/config.ts`, `src/log.ts` | 流用（設定項目は整理） |

## 10. 未決事項

- Jev（live / openrouter）の料金体系。差分判定の頻度で十分に抑えられるかは実測で確認する。
- GitHub 標準の Issue 依存関係 API の取得方法（REST か GraphQL か）。
- `ctx.commands` から承認を経てエージェントに着手させる具体的な手段（コマンドがエージェントにプロンプトを送れるか）。
