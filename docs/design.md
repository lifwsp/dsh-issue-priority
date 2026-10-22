# dsh-work-planner 設計メモ

2026-10-22 時点の合意内容。叩き台（`prioritize_issues`）からの方針転換を記録する。

## 1. 目的

Issue がたまっていく中で、DSH を開いて `/issues next`（または「Issue 対応しよう」）と言った時点で、

- 次に着手する作業単位（＝セッションの分け方）
- その中の Issue の順番と、作業単位どうしの順番（「#C の後に #A、その次に #B」）

がすでに決まっている状態にする。

## 2. 要件と制約

| 項目 | 決定 |
| --- | --- |
| 費用 | バックグラウンド処理で LLM を使わない。判断は Decision Model（LiquidAI d1）と決定論コードのみ |
| 判定タイミング | 差分があったときだけ d1 を呼ぶ（Issue の `updated_at` / 本文ハッシュが変わったもの） |
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
                                   候補ペアのみ d1 判定                 Issue 本文と acceptance を読む
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
- **skill `issue-authoring`**：`ctx.skills.register()` で登録。本文を書く前に Issue の単位を設計させる（論点の棚卸し → 既存 Issue の確認 → 分割・統合・追記先の判断 → Issue ごとに主成果と完了条件 → 計画項目の見積もり → `issue_draft` → 起票 → 分け方の報告）。「1 Issue = 1 つの主成果で、独立して優先順位付け・採否判断・着手・検証・完了判断できる単位」を原則とし、同じセッションで片付けたい Issue は統合せず作業パッケージに任せる。形式の準拠（`issue_draft` が検証）と単位の妥当性は別の確認事項として扱う。計画器にはまとめ Issue（Epic）の概念がないため、まとめ Issue は原則作らず、共有の背景は各 Issue から参照させる。
- AGENTS.md には何も追記しない（ユーザー所有ファイルであり、毎ターンのトークン消費にもなるため）。

## 5. 計画の組み立て

### 5.0 GitHub の標準機能との分担（v0.6）

GitHub に同じ情報があれば、そちらを正とする。読むのは Issue 一覧（`GET /repos/{o}/{r}/issues`）の応答に含まれる項目だけで、追加のリクエストはしない。GitHub への書き込みもしない。

| 情報 | GitHub 側 | フォールバック | 独自に持つ理由 |
| --- | --- | --- | --- |
| 重要度 | Issue Fields `Priority`（`issue_field_values`） | ラベル → d1 | Issue Fields は Organization のみ・プレビュー |
| 規模 | Issue Fields `Effort` / `Size` / `Estimate`（数値なら ≤2 S、≤5 M、それ以上 L） | `dsh-plan` の `size` → d1 | 同上 |
| 依存 | Issue Dependencies（`issue_dependencies_summary.blocked_by` > 0 のときだけ `/dependencies/blocked_by` を読む） | `dependsOn` → 本文・コメント | 起票時に GitHub へ書かずに済む |
| 親子 | Sub-issues（`parent_issue_url`, `sub_issues_summary`） | — | — |
| 期限・まとまり | Milestone（`title`, `due_on`） | — | — |
| 機能領域・ファイル・完了条件 | なし | `dsh-plan` の `areas` / `files` / `acceptance` | GitHub に相当機能がない |
| 手動の並べ替え・作業中・クローズ待ち・判定キャッシュ | Projects で代替しない | ローカル | 書き込みを増やさない。セッション単位で組み直す |

GitHub Projects は読まない。並び順はプロジェクトごとに違い、計画は「次のセッションで何をするか」の提案なので、ローカルで組み直して試行錯誤できるほうが向いている。

### 5.1 依存（強い順）

1. GitHub 標準の Issue 依存関係（blocked by）
2. Sub-issues：親はサブ Issue が閉じるまで待つ（サブ Issue → 親の辺）
3. `dsh-plan` の `dependsOn`
4. 本文と人のコメント中の `blocked by #N` 等（既存 `parseDependencies` を流用）。判定モデルがあるときは、スレッド全体を見せて「最新の書き込みの時点で、まだ #N が先に必要か」を noul で聞き、p < 0.5 なら依存から外して警告（dependency-dropped）に出す。ないときは書いてあるとおりに扱う
5. d1 の推定 —— **推奨順としてのみ扱い、着手を止める理由にはしない**

1〜4 はハード制約（未クローズの依存先がある間は `blocked`）。循環は検出して `needsHuman` に回す。

### 5.2 同一セッションにまとめる条件

狙いは「1 回のレビューとテストで確かめられる単位」。候補ペアの強さは次の合計。

- `files` の完全一致 3 / ディレクトリ一致（近い）2 / `areas` 一致 1
- 同じ親のサブ Issue +1.5
- 同じマイルストーン +0.5（ほかの根拠があるときだけ）
- 違うマイルストーンに入っている Issue どうしは候補にしない（リリースの単位をまたがない）

採否：

1. d1 があるときは、候補ペアごとに「同じ変更で片付けるべきか」を聞き、`mergeThreshold` 以上ならまとめる
   - ブロックのない Issue どうしは、タイトルと本文冒頭の文字 2-gram の Jaccard 類似度が `similarityThreshold`（既定 0.1）以上なら候補にする。`[検討案]` のような角括弧の接頭辞は除く。質問数を抑えるため、1 件あたり類似度の高い相手 3 件まで。
2. d1 がないときは強さ 3 以上だけ（ファイル完全一致、または兄弟で近いファイル、など）
3. パッケージの `size` 合計が `maxPackageSize`（既定 4。S=1, M=2, L=4 換算）以下

### 5.3 d1 で判定すること（これ以外には使わない）

| 判定 | 対象 | 型 |
| --- | --- | --- |
| `size` / 着手可否 | ブロックのない Issue のみ（Effort があれば規模は使わない） | score / noul |
| まとめるべきか | 5.2 の候補ペアのみ | noul |
| 重要度 | Priority フィールドもラベルもない Issue | score（low / medium / high） |
| 依存の向き | 本文で互いに言及しているペアのみ | choice（A→B / B→A / なし） |

- 全ペア判定はしない（件数の 2 乗になるため）。候補はコードで絞る。
- 判定結果は入力ハッシュをキーにローカル保存し、入力が変わらない限り再判定しない。

### 5.4 順序

パッケージの依存グラフをトポロジカルソート。依存のない（同時に着手できる）パッケージどうしは、次の順で並べる。

1. 作業中 > `pin` > 通常 > すべて `defer`
2. 重要度 + 緊急度が高い順（パッケージ内でいちばん高い Issue）
   - 重要度：Priority フィールド > ラベル > d1 > 既定の中（low 0 / medium 1 / high 2）
   - 緊急度：起票からの経過日数で最大 +0.5（`agingDays` 日で頭打ち、既定 60）、マイルストーン期限 14 日以内 +0.5、期限切れ +1
3. 終わると着手できるようになるパッケージが多い順（推移的に数える）
4. 規模が小さい順（すぐ終わるもの）
5. Issue 番号の小さい順

重要度のラベルは `priority:high` / `prio/low` / `P0`〜`P4` / `critical` / `urgent` / `blocker` などを読む。

v0.3 までは 2〜4 がなく、依存のない Issue は番号順に並ぶだけだった。v0.5 では 4 の「小さい順」が効きすぎ、重要度が同じなら大きな Issue がいつまでも後ろに残った。緊急度（aging）はその対策で、同じ重要度の中では古い Issue が小さな新しい Issue より前に出る。重要度 1 段階（1.0）を超えない範囲（最大 +0.5）にしてあるので、重要度の差はひっくり返さない（期限切れのマイルストーンだけは例外）。計画ロジックを変えたときは `PLANNER_VERSION` を上げ、保存済みの計画を次の同期で作り直す。

### 5.4a 引き継ぎと採用状況の記録

- `renderKickoff` は、各 Issue の完了条件（`acceptance`）・触る見込みのファイル・親 Issue・マイルストーン、パッケージの機能領域と先行パッケージを渡す。完了条件が未記入の Issue は列挙し、着手前に確かめさせる。
- `src/outcomes.ts` が、着手・完了・override・依存追加をローカルに記録する（最新 200 件、`RepoState.outcomes`）。着手は、その時点の計画と比べて `adopted`（推奨どおり）/ `other-package`（別の計画済みパッケージ）/ `regrouped`（どのパッケージとも一致しない）に分ける。完了時に作業中の Issue が残れば `partial`（実装中に分割）。
- 集計（`summarizeOutcomes`）は計画テキストとタブのツールチップに出す。閾値や重みを見直すときの材料にする。自動調整はまだしない。

### 5.5 クローズ待ち（実装済み・未クローズ）

`src/progress.ts` が、開いている Issue のうち「作業はどこかに存在するが、まだ閉じていない」ものを決定的に判定する。d1 は使わない。

- 根拠（`CloseEvidence`）は 3 種類。`marked`（finish / done の印）、`branch`（ローカルブランチ）、`pr`（PR）。
- ローカルブランチは `git` の読み取りコマンドだけで調べる（fetch しない）。GitHub のリポジトリを指すリモートの既定ブランチ（`<remote>/HEAD`、なければ main / master / trunk / develop）との差分コミットを持ち、直近 30 日にコミットのあるブランチ、最大 40 本。対象 Issue はブランチ名（`wp-12-13` / `issue-12` / `12-xxx`）、コミットの closing keyword、記録されたブランチ名で決める。コミットで `#N` に触れているだけのものは表示用（`mentionOnly`）。push 状態は upstream（なければ `<remote>/<branch>`）との差分で `none` / `partial` / `all` / `gone`。
- PR は同期のたびに REST で取得する（open 全件 + 直近 30 日に更新された closed、最大 200 件、未マージの closed は捨てる）。closing keyword（`close[sd]` / `fix(e[sd])` / `resolve[sd]`、他リポジトリ参照は除く）、ブランチ名、記録されたブランチ名で Issue と結ぶ。取得に失敗したら前回の一覧を使う。
- 判定：印があればクローズ待ち。作業中の Issue は、マージ済み PR か、closing keyword 付きのドラフトでない PR があるときだけクローズ待ち（その場合は作業中からも外す）。それ以外は PR か対象ブランチがあればクローズ待ち。
- `reopen` は印を消し、その時点の根拠のキー（`b:<branch>` / `pr:<n>:<state>`）を `dismissed` に覚える。新しいキーが出るまで計画に残す。
- 次の一手（`CloseStep`）：マージ済み PR だけ → `close-issue`、open PR → `merge-pr`（未 push があれば `push`）、ブランチだけ → `push` か `open-pr`、根拠が印だけ → `check`。
- 計画では、クローズ待ちの Issue をパッケージから外す。それに依存するパッケージは `waiting` にし、`waitingOnClose` に番号を入れる（closed 扱いにして着手可にはしない）。
- `start` を既定ブランチの上で呼んだときはブランチ名を記録せず、あとでセッションの cwd がほかのブランチに移ったときに記録する。

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
                    { "kind": "decision-merge", "p": 0.82 }],
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
- `since=syncedUntil` で差分のみ取得。変化した Issue と、その Issue が関わる候補ペアだけ d1 に送る。差分がなければ d1 は呼ばない。
- DSH の `schedule` は使わない（エージェント経由で LLM 費用が発生するため）。

### 7.2 コマンド（`ctx.commands`）

| コマンド | 動作 |
| --- | --- |
| `/issues` | 計画と前回からの差分を表示（同期してから） |
| `/issues next` | 次の ready パッケージを提示 → 承認後、エージェントがブランチ作成・goal 設定・Issue 読み込み・PR に `Closes #N` |
| `/issues defer N` | 後回しにする（以後の計画で末尾） |
| `/issues pin N` | 最優先にする |

worktree はオプション（既定オフ）。

### 7.2a サイドバータブ（better-sidebar、任意）

- client 半: `client/client.js`（手書き、ビルドなし。`react` だけをローダーから受け取る）。`ctx.betterSidebar.registerTab({ id: 'dsh-work-planner:plan', single: true })`。サイドバーのサービスは後から来ることがあるので、1 秒間隔で 30 回まで登録をやり直す。apply は例外を外に出さない。
- host 半: `src/rpc.ts`。`ctx.inject(['webServer'], …)` の中で、`connection.rpc.handle('/dsh-work-planner', …)` があればそれを使い、なければ `webServer.register` に prefix ルートを直接張る（DSH デスクトップには host 側の `connection` サービスがない。dsh-run-button も同じく直接ルートで動いている）。直接ルートはブラウザーの `connection.rpc.call` と同じ封筒（`client-request` → `server-response`）を話す。`connection` を inject 条件に入れると、デスクトップでは中身が一度も実行されず、ブラウザーには SPA フォールバックの HTTP 405 が返る。endpoint は `plan` / `sync` / `override` / `done`（実装完了 → クローズ待ち）/ `stop` / `reopen` / `next`。
- リポジトリの判定: `agents.list()` からタブの `scope.sessionId` に一致するエージェントを探し、その作業ディレクトリを使う。見つからなければ、タブが知らせる `scope.cwd` を使う。
- 着手（`next`）: 一致したエージェントの `followup()` に、`/issues next` と同じ指示を渡す。エージェントが見つからないときは、エラーを返してコマンドの使用を案内する。
- 表示中は 60 秒ごとに `plan` を呼ぶ（`ensurePlan` なので、5 分以内は保存済みの計画を返す）。

### 7.3 エージェント向けツール

- `issue_plan_read`：計画を読む（「Issue 対応しよう」と言われたとき用）
- `issue_plan_update`：着手（start）・実装完了（finish → クローズ待ち）・中断（stop）・計画へ戻す（reopen）の記録、作業中に見つけた依存の追記（スキーマ検証・循環検出あり）

## 8. プライバシー

`allowExternalJudgment: false` が既定。false の間は d1 に何も送らず、決定的ルールだけで計画する（計画の注記にそう出る）。true にすると、Issue のタイトル・ラベル・スレッド・areas/files が呼び先に送られる。スレッドは本文を最初の書き込みとし、人のコメント（bot は除く）を古い順に並べ、日付と書いた人を付ける。本文とコメントは同じ重みで扱い、「後の書き込みが範囲・優先度・依存を変えていれば後を優先」と注記する。コードブロックと `<details>` は `[code]` / `[details]` に縮め、コメント 1 件 800 字、最新 20 件まで。合計 4000 字を超えるときは本文の先頭 1500 字と新しいコメントを残し、途中を省く（結論は後ろに書かれやすいため）。実測（2026-10-22, liquid/d1）: 取り消しコメントの有無で依存の判定が 0.00 / 1.00 に分かれ、日英とも正しく、約 4000 字でも読めた。

## 9. 実装（v0.6.0）

| ファイル | 役割 |
| --- | --- |
| `src/plan-block.ts` | dsh-plan ブロックの検証・描画・解析（書式の唯一の定義） |
| `src/github/rest-adapter.ts` | REST で差分取得（`since`）、コメント、Issue dependencies（`/dependencies/blocked_by`）、PR 一覧。`nativeMeta()` が一覧の応答から Issue Fields・親 Issue・マイルストーンを読む |
| `src/decision/client.ts` | System One クライアント（liquid / openrouter / typesafe / custom） |
| `src/decision/judge.ts` | 3 種の質問（size+actionable / merge / direction）。入力ハッシュでキャッシュ |
| `src/plan/planner.ts` | 依存グラフ・循環検出・まとめ・トポロジカル順 |
| `src/store.ts` | `$DSH_HOME/data/dsh-work-planner/owner__repo.json`。旧名 `data/dsh-issue-priority` からの初回コピー（`migrateLegacyDataDir`） |
| `src/progress.ts` | クローズ待ちの判定（§5.5） |
| `src/outcomes.ts` | 計画の採用状況の記録と集計（§5.4a） |
| `src/sync.ts` | 差分同期と再計画（変更なしなら判定 0 件） |
| `src/runtime.ts` / `src/tools.ts` / `src/commands.ts` / `src/skill.ts` | ツール・`/issues` コマンド・スキル |
| `src/rpc.ts` / `client/client.js` | サイドバータブ（host の RPC 窓口と、ブラウザー側の画面） |

## 10. 決定済みになった事項

- **判定モデル**: 既定は `none`（使わない）。公開プラグインなので特定の呼び先を既定にしない。System One 形式（state + questions → answers）の API なら差し替え可能（`decisionProvider`: liquid / openrouter / typesafe / custom）。判定キャッシュはプロバイダ/モデル名を含むので、切り替えると再判定される。d1（入力 \$0.02 / 1M トークン、出力無料）。jevcore-dsh は `jev-*` モデルしか通さないため、プラグイン内に専用クライアントを持つ。
- **依存 API**: REST。理由は §11。
- **名称**: v0.6 で `dsh-issue-priority` → `dsh-work-planner`。主目的が Issue の優先度付けではなく、開発セッション単位の作業計画だから。データは初回起動時に旧ディレクトリからコピーする（移動はしない。旧版に戻せるように）。RPC チャネルとタブ ID も新名になるので、旧名のタブは開き直す。
- **コマンド→エージェント**: `invocation.agent.followup(ユーザーメッセージ)` で着手指示を次ターンとして渡せる（dsh-command-goal と同じ手段）。

## 11. REST と GraphQL の比較（Issue dependencies 取得）

| 観点 | REST | GraphQL |
| --- | --- | --- |
| 依存の取得 | 依存がある Issue ごとに 1 リクエスト（`issue_dependencies_summary` で要否が分かるので無駄打ちはない） | 一覧取得のクエリに `blockedBy` を含めれば 1 往復 |
| 差分取得 | `since` パラメータがそのまま使える | `filterBy: {since}` があるが、ページングとの組み合わせが煩雑 |
| レート制限 | 5000 リクエスト/時。毎時同期の差分なら数件〜数十件 | ポイント制。ノード数で計算され見積もりにくい |
| 認証 | トークンなしでも公開リポジトリは読める | 必ずトークンが要る |
| 実装量 | 既存アダプタを流用 | クエリとページングを書き直し |

差分同期では 1 回あたりの Issue が少なく、GraphQL の「1 往復」の利点がほぼ効かないため REST にした。初回の全件取得だけは依存の多いリポジトリで遅くなりうるが、毎時同期の範囲では問題にならない。

## 12. 未決事項

- d1 の実コスト。d1 は質問ごとに state を含めて課金される。目安は 1 質問 ≈ 400〜800 トークン。初回 100 Issue なら size 100 件 + まとめ候補ペア数十件で約 10 万トークン ≈ \$0.002。以後は差分のみ。実測で確認する。
- バックグラウンド同期はプラグインのプロセスが生きている間だけ動く（DSH を閉じている間は止まり、起動 30 秒後に追いつく）。
- 判定のしきい値（merge 0.6 / actionable 0.35 / direction 0.6）は実データで調整する。§5.4a の採用状況（組み替え・分割の多さ）を見て決める。
- 採用状況から閾値や重みを自動で調整するか（今は記録と集計だけ）。
- Issue Fields が GA になり個人リポジトリでも使えるようになったら、`dsh-plan` の `size` を書かない運用に寄せられるか。
