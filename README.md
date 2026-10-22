# dsh-work-planner

**開発エージェントが次の 1 セッションで取り組む作業を、GitHub Issue から組み立てる DSH プラグインです。** 一緒に片付けると筋のよい Issue を、ひとつの作業単位（Work Package）にまとめ、依存関係を守った実行順に並べます。次にやるパッケージがサイドバーに出るので、ボタンを押せばエージェントが完了条件や触るファイルを受け取って作業を始めます。

並べ替えは 1 時間ごとに裏で行います。規模や重要度の見積もりには Decision Model を使い、チャット用の LLM は使いません。プラグイン自身は GitHub に書き込みません（Issue を起票するのはエージェントです）。

> 0.5 までは `dsh-issue-priority` という名前でした。移行は「[旧名からの移行](#旧名からの移行)」を見てください。

## インストール

```bash
dsh plugin --profile web add github:lifwsp/dsh-work-planner
```

`web` は使っているプロファイル名に置き換えてください。外すときは `dsh plugin --profile web remove dsh-work-planner` です。

サイドバーのタブを使うには [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) が必要です。

## 設定

既定では Decision Model を使いません。この状態でも動きますが、規模や重要度は見積もらず、依存関係と Issue 番号の順に並びます。

Decision Model を使うときは、呼び先と API キーを設定し、`allowExternalJudgment` を `true` にします。`true` にすると、Issue のタイトル・ラベル・本文と、人が書いたコメントが呼び先に送られます。

```yaml
# cordis.patch.yml
- id: dsh-work-planner
  name: dsh-work-planner
  config:
    decisionProvider: liquid        # 下の表から選ぶ
    allowExternalJudgment: true
```

| `decisionProvider` | 呼び先 | API キーの名前 |
| --- | --- | --- |
| `liquid` | Liquid AI の API（d1） | `LIQUID_API_KEY` |
| `openrouter` | OpenRouter（`liquid/d1`） | `OPENROUTER_API_KEY` |
| `typesafe` | TypeSafe の API（Jev） | `TYPESAFE_API_KEY` |
| `custom` | System One 形式の任意の API。`decisionApiUrl` と `decisionModel` も指定する | `DECISION_API_KEY` |

API キーは DSH の認証情報か環境変数に、表の名前で登録します。名前を変えたいときは `decisionApiKeyRef` で指定します。

## 使い方

1. リポジトリを開いたセッションで、右サイドバーの「+」から **Issue 計画** タブを開きます。
2. いちばん上の **次はこれ** が、次に着手するパッケージです。**これに着手** を押すと、エージェントが方針を示します。承認すると、ブランチを切って実装し、`Closes #N` 付きの PR を出します。
3. 順番を変えたいときは、Issue の横の **優先** / **後回し** を押します。

丸いアイコンにマウスを乗せると、そのパッケージを選んだ理由や同期の状態が見えます。アイコンが **!** のときは、確認したほうがよいことがあります。

タブの代わりにコマンドでも操作できます。

| コマンド | 内容 |
| --- | --- |
| `/issues` | 計画を表示する |
| `/issues next [ID]` | 次のパッケージ（または ID のパッケージ）をエージェントに渡す |
| `/issues pin N` / `defer N` / `clear N` | Issue N を優先 / 後回し / 元に戻す |
| `/issues done [N…]` | 実装完了にする（クローズ待ちになり、推奨から外れる）。番号を省くと作業中のもの全部 |
| `/issues stop` | 完了にせず、作業中の印だけ外す |
| `/issues reopen N` | クローズ待ちの Issue N を計画に戻す（まだ終わっていなかったとき） |
| `/issues sync` | 今すぐ GitHub と同期する |

## 実装済みで、まだ閉じていない Issue

ブランチで作業して push していない、PR がまだマージされていない、マージしたのに Issue が開いたまま——こうした Issue は「クローズ待ち」として計画の下にまとまり、おすすめから外れます。GitHub でクローズされると、次の同期で消えます。

クローズ待ちになる条件は次のどれかです。

- **実装完了の印**：エージェントが `issue_plan_update action=finish` を呼んだか、タブの **実装完了** / `/issues done` を使った。
- **ローカルのブランチ**：既定ブランチ（`origin/main` など）にないコミットを持つブランチが、その Issue 向けに見える。ブランチ名（`issues/wp-12-13`、`fix/12-xxx`、`issue-12`）か、コミットの `Closes #12` で判断する。コミットで `#12` に触れているだけなら、表示はするが外さない。直近 30 日にコミットのあるブランチだけを見る。fetch はしない。
- **PR**：開いている PR か、直近 30 日にマージされた PR が、本文の `Closes #N` かブランチ名でその Issue を指している。記録されたブランチから出た PR も数える。

作業中の Issue は、マージ済みの PR か、`Closes #N` 付きのドラフトでない PR が出るまで計画に残ります。

それぞれの Issue に、次にやることが出ます（push 待ち / PR 作成待ち / PR マージ待ち / Issue クローズ待ち）。まだ終わっていなければ **戻す**（`/issues reopen N`）で計画に戻せます。戻したあとに新しい PR やブランチが見つかると、またクローズ待ちになります。

その Issue に依存するパッケージは「先行待ち」になり、「クローズ待ち: #N」と表示されます。

## Issue の起票への影響

このプラグインを入れると、エージェントが Issue を作成・編集するとき、本文の末尾に次のような HTML コメントを追加するようになります。GitHub の画面には表示されません。

```markdown
<!-- dsh-plan
v: 1
areas: auth, ui
size: M
files: src/auth/**
acceptance: 期限切れのトークンで再ログインを促す
-->
```

中身はエージェントが会話とコードから推定して書きます。このプラグインは、ここに書かれた機能領域・規模・関係するファイルを、まとめ方と順番の根拠に使います。コメントのない Issue も計画に入ります。

`areas`・`files`・`acceptance`（完了条件）は GitHub に相当する機能がないので、このブロックが唯一の置き場です。

GitHub に置き場がある情報は、エージェントが起票のついでに GitHub の機能で記録します。`issue_draft` ツールが、本文と一緒に実行する `gh` コマンドを返すためです。

| 情報 | 起票時の記録先 |
| --- | --- |
| 依存 | **blocked by**（`gh issue create --blocked-by 12`） |
| 親子 | **Sub-issues**（`--parent 10`）。大きな成果を分けたときは親 Issue を作る |
| 期限・リリース | **Milestone**（`--milestone v1.0`） |
| 重要度 | Priority フィールドがあればその設定方法を案内。なければ既存の重要度ラベルか `priority:high` などのラベル |
| 規模 | `dsh-plan` の `size`。Effort フィールドを使っているリポジトリでは、Effort も設定するよう案内 |

依存と親子の登録には gh 2.94 以上が必要です。gh が古いときは、依存は今までどおり `dsh-plan` の `dependsOn` に残り、親子は画面で登録するよう案内します。

こうして記録した依存や親子は、GitHub の画面でも見えます。後から直すときは GitHub 側を直せば、計画にも反映されます。

## GitHub の標準機能との関係

GitHub に同じ情報があれば、そちらを正とします。読むのは、Issue 一覧の取得で返ってくる項目だけです。そのため、API の呼び出しは増えません。GitHub への書き込みもしません。

| 情報 | 使う GitHub の機能 | なかったとき |
| --- | --- | --- |
| 重要度 | Issue Fields の **Priority** | `priority:high` などのラベル → Decision Model |
| 規模 | Issue Fields の **Effort**（`Size` / `Estimate` も可） | `dsh-plan` の `size` → Decision Model |
| 依存 | Issue Dependencies の **blocked by** | `dsh-plan` の `dependsOn` → 本文・コメントの `blocked by #12` |
| 親子 | **Sub-issues**。親はサブ Issue が閉じるまで先行待ち。兄弟はまとめやすくする | — |
| 期限 | **Milestone** の期限。14 日以内なら繰り上げる。違うマイルストーンの Issue は同じパッケージにしない | — |

Issue Fields は Organization のリポジトリだけの機能（2026 年 10 月時点でパブリックプレビュー）です。個人のリポジトリでは、ラベルと `dsh-plan` で同じことができます。

GitHub Projects のビューや並び順は読みません。計画はセッションごとに組み直すもので、手動の並べ替え（優先 / 後回し）もローカルに置きます。そのほうが、GitHub の Issue を汚さずに試行錯誤できるからです。

## まとめ方と順番の決め方

- **まとめ方**：同じファイルに触る Issue、同じ機能領域（`areas`）の Issue、同じ親のサブ Issue を、1 回のレビューとテストで確かめられる単位にまとめます。Decision Model が使えるときは「同じ PR にしてよいか」をモデルに確かめます。使えないときは、同じファイルに触るものだけをまとめます（同じ親の兄弟なら、近いファイルに触るものもまとめます）。1 パッケージの大きさは `maxPackageSize`（S=1, M=2, L=4 の合計）までです。
- **依存**：「#12 の後」のように依存関係がある Issue は、相手が閉じるまで **先行待ち** になります。本文やコメントから読み取った依存は、Decision Model がスレッド全体を読み、後のコメントで取り消されていれば外します。
- **順番**：すぐ着手できるパッケージどうしは、**優先** を付けたもの → 重要度と緊急度の合計が高いもの → 後続を多く解放するもの → 規模が小さいもの、の順に並べます。
- **大きな作業の先送り防止**：小さい Issue ばかり先に片付くのを防ぐため、起票から日が経つほど緊急度を上げます（`agingDays` 日で最大 +0.5。重要度 1 段階の半分）。マイルストーンの期限が 14 日以内なら +0.5、期限切れなら +1 です。
- **後回し** を付けたものは最後に回します。

## 引き継ぎと計画の評価

**これに着手**（`/issues next`）でエージェントに渡す指示には、各 Issue の完了条件・触る見込みのファイル・親 Issue・マイルストーンと、パッケージ全体のレビュー・テストの観点が入ります。完了条件が未記入の Issue も示すので、エージェントは着手前に確かめられます。

着手・完了・優先 / 後回し・依存の追加は、ローカルに記録します（最新 200 件）。「推奨どおり着手したか」「別のパッケージを選んだか」「組み替えたか」「実装中に分割したか」を数え、計画とタブのツールチップに「計画の採用状況」として出します。計画の精度を見直すための材料です。

## 主な設定項目

| キー | 既定値 | 内容 |
| --- | --- | --- |
| `allowExternalJudgment` | `false` | Decision Model に Issue を送ってよいか。`decisionProvider` と両方そろったときだけ使う |
| `decisionProvider` | `none` | Decision Model の呼び先（上の表）。`none` は使わない |
| `decisionModel` | （呼び先ごとの既定） | 使うモデルの ID |
| `syncIntervalMinutes` | `60` | 同期の間隔（分）。`0` で止める |
| `maxIssues` | `300` | 1 回の同期で読む Issue の上限 |
| `githubTokenRef` | `GITHUB_TOKEN` | GitHub トークンの名前。見つからなければ `GH_TOKEN`、`gh auth token` を使う |
| `maxPackageSize` | `4` | 1 パッケージの大きさの上限（S=1, M=2, L=4 の合計） |
| `agingDays` | `60` | この日数で、古い Issue の繰り上げが最大になる。`0` で止める |

ほかの項目は [src/config.ts](src/config.ts) にあります。

## 旧名からの移行

0.5 までの `dsh-issue-priority` から移るときは、プロファイルの `package.json` と `cordis.patch.yml` にある `dsh-issue-priority` を `dsh-work-planner` に書き換え、アプリを再起動します。設定の中身（`config:` 以下）はそのまま使えます。

保存済みの計画（優先 / 後回し・追加した依存・作業中の印など）は、初回の起動時に `~/.dsh/data/dsh-issue-priority/` から `~/.dsh/data/dsh-work-planner/` へコピーします。古いディレクトリは消さないので、旧版に戻すこともできます。`dataDir` を指定しているときは、そのディレクトリをそのまま使います。

## 開発

```bash
pnpm install
pnpm check   # 型チェック・テスト・ビルド
```

設計メモは [docs/design.md](docs/design.md) にあります。

## ライセンス

[MIT](LICENSE)
