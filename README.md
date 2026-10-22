# dsh-issue-priority

**リポジトリの GitHub Issue を、着手する順番に並べておく DSH プラグインです。** 一緒に片付けられる Issue は、ひとつの作業単位（パッケージ）にまとめます。次にやるパッケージがサイドバーに出るので、ボタンを押せばエージェントがその作業を始めます。

並べ替えは 1 時間ごとに裏で行います。規模や重要度の見積もりには Decision Model を使い、チャット用の LLM は使いません。GitHub には書き込みません。

## インストール

```bash
dsh plugin --profile web add github:lifwsp/dsh-issue-priority
```

`web` は使っているプロファイル名に置き換えてください。外すときは `dsh plugin --profile web remove dsh-issue-priority` です。

サイドバーのタブを使うには [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) が必要です。

## 設定

Decision Model を使うには、次の 2 つが必要です。

1. OpenRouter の API キーを `OPENROUTER_API_KEY` という名前で登録する（DSH の認証情報か環境変数）。
2. プラグインの設定で `allowExternalJudgment` を `true` にする。

```yaml
# cordis.patch.yml
- id: dsh-issue-priority
  name: dsh-issue-priority
  config:
    allowExternalJudgment: true
```

`allowExternalJudgment` を `true` にすると、Issue のタイトルと本文が OpenRouter に送られます。`false`（既定）のままでも動きますが、規模や重要度は見積もらず、Issue 番号の順に並びます。

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
| `/issues done` | 作業中の印を外す |
| `/issues sync` | 今すぐ GitHub と同期する |

## Issue の起票への影響

このプラグインを入れると、エージェントが Issue を作成・編集するとき、本文の末尾に次のような HTML コメントを追加するようになります。GitHub の画面には表示されません。

```markdown
<!-- dsh-plan
v: 1
areas: auth, ui
size: M
files: src/auth/**
dependsOn: 12
-->
```

中身はエージェントが会話とコードから推定して書きます。このプラグインは、ここに書かれた規模・関係するファイル・依存関係を、まとめ方と順番の根拠に使います。コメントのない Issue も計画に入ります。

## 順番の決め方

- 「#12 の後」のように依存関係が書かれている Issue は、相手が閉じるまで **先行待ち** になります。依存は GitHub の Issue 依存（blocked by）、上の `dependsOn`、本文の `blocked by #12` から読み取ります。
- すぐ着手できるパッケージどうしは、**優先** を付けたもの、重要度が高いもの、規模が小さいものの順に並べます。重要度は `priority:high` などのラベルがあればそれを使い、なければ Decision Model が見積もります。
- **後回し** を付けたものは最後に回します。

## 主な設定項目

| キー | 既定値 | 内容 |
| --- | --- | --- |
| `allowExternalJudgment` | `false` | Decision Model に Issue を送ってよいか |
| `decisionProvider` | `openrouter` | `openrouter` / `liquid` / `typesafe` / `custom` / `none` |
| `decisionModel` | （呼び先ごとの既定） | 使うモデルの ID |
| `syncIntervalMinutes` | `60` | 同期の間隔（分）。`0` で止める |
| `maxIssues` | `300` | 1 回の同期で読む Issue の上限 |
| `githubTokenRef` | `GITHUB_TOKEN` | GitHub トークンの名前。見つからなければ `GH_TOKEN`、`gh auth token` を使う |

ほかの項目は [src/config.ts](src/config.ts) にあります。

## 開発

```bash
pnpm install
pnpm check   # 型チェック・テスト・ビルド
```

設計メモは [docs/design.md](docs/design.md) にあります。

## ライセンス

[MIT](LICENSE)
