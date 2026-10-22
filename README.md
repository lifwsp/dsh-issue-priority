# dsh-issue-priority

Issue が溜まってくると、どれから手を付けるかを決めるだけで一仕事になります。

このプラグインは、その仕分けを裏で済ませておくための DeepSeek Harness（DSH）用プラグインです。GitHub の Issue を定期的に読み、一度の作業でまとめて片付けられるものを束ね、着手する順番まで決めておきます。DSH を開いたら、サイドバーの「次はこれ」を見て着手ボタンを押すだけです。

裏で動く処理には、チャット用の大きな言語モデルを使いません。並べ替えは決まったルールで行い、ルールだけでは決めきれないところ（規模、重要度、まとめるかどうか）だけを判定専用の小さなモデル [LiquidAI d1](https://www.liquid.ai/blog/d1-decision-model) に聞きます。料金は入力 100 万トークンあたり \$0.02 で、聞くのは前回から変わった Issue についてだけです。何も変わっていなければ、一問も聞きません。

GitHub には何も書き込みません。計画は手元のファイルに保存します。

## 全体の流れ

```
Issue を起票する（エージェントが本文の末尾に <!-- dsh-plan --> を付ける）
        ↓
1 時間ごとに同期する（プラグイン内のタイマー）
  変わった Issue だけ取得 → 依存関係を組む → まとめる → 順番を決める
        ↓
サイドバーで「次はこれ」を確認 → 着手ボタン → エージェントがブランチを切って実装し、PR（Closes #N）を出す
```

## 入れ方

npm にはまだ公開していないので、リポジトリを取ってきてビルドし、DSH のプロファイルにつなぎます。

```bash
git clone https://github.com/lifwsp/dsh-issue-priority.git
cd dsh-issue-priority
pnpm install
pnpm build
dsh plugin add link:$(pwd)
```

`dsh plugin` は DSH が使っているプロファイルに対して pnpm を実行します。プロファイルを指定するときは `--profile 名前` を付けてください。

次に、プロファイルの `cordis.patch.yml` に設定を足します。判定モデルを使うには `allowExternalJudgment: true` が必要です。これを入れると、Issue のタイトルと本文が OpenRouter に送られます。

```yaml
- id: dsh-issue-priority
  name: dsh-issue-priority
  config:
    decisionProvider: openrouter
    allowExternalJudgment: true
```

OpenRouter のキーは、DSH の認証情報ファイル `~/.dsh/.credentials.yaml` の `refs:` に書きます。`.env` のような `名前=値` の形ではなく、YAML の形で書いてください。ファイルの権限は 600 にしておきます。

```yaml
version: 1
refs:
  OPENROUTER_API_KEY: sk-or-v1-...
records:
  ...
```

キーを画面に出さずに書き込みたいときは、`python3 scripts/set-credential.py` を実行してキーを貼り付けてください。

最後に DSH アプリを再起動します。サーバー側の変更は、再起動するまで読み込まれません。

## 使い方

### サイドバーの「Issue 計画」タブ

[dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) を入れていれば、右サイドバーの「+」から「Issue 計画」タブを開けます。コマンドを覚えていなくても、ボタンだけで操作できます。

画面に出るのは、次にやることだけです。いちばん上に「次はこれ」のパッケージを大きく出し、残りは「そのあと」に 1 行ずつ並べます。行の ▸ を押すと中身が開きます。

最終同期の時刻や使った判定モデル、そのパッケージを選んだ理由は、丸いアイコンにマウスを置くと見えます。ふだんは薄い「i」ですが、判定モデルが止まっている、同期に失敗した、といった見ておくべきことがあるときだけ、オレンジの「!」に変わります。

| ボタン | すること |
| --- | --- |
| 同期 | GitHub と今すぐ同期する |
| これに着手 / 続ける | そのパッケージを、開いているセッションのエージェントに渡す |
| 優先 / 後回し | Issue ごとに切り替える。もう一度押すと元に戻る |
| 作業中を解除 | 作業中の印を外す |

どのリポジトリの計画を出すかは、開いているセッションの作業ディレクトリで決まります。タブを開いている間は 1 分ごとに表示を更新し、計画が 5 分以上古くなっていれば GitHub と同期します。

### コマンド

サイドバーがなくても、チャット欄のコマンドで同じことができます。

| コマンド | すること |
| --- | --- |
| `/issues` | 計画を表示する |
| `/issues next [ID]` | 次のパッケージをエージェントに渡す。エージェントは方針を示して、承認を待ってから作業を始める |
| `/issues defer N` / `pin N` / `clear N` | Issue N を後回し / 優先 / 元に戻す |
| `/issues done` | 作業中の印を外す |
| `/issues sync [full]` | 今すぐ同期する |

### Issue の起票

エージェントに「Issue 起票して」と頼むだけで構いません。エージェントは `issue-authoring` スキルに従って、本文の末尾に計画用のブロックを付けます。ブロックの中身は会話とコードから推定し、起票したあとに「規模 M、領域 ui、依存 #5 として登録しました」のように一言で知らせます。違っていたら、そのとき直してもらえば十分です。

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

ブロックの書き方を覚えておく必要はありません。ブロックのない Issue（GitHub の画面から直接起票したものや、ほかの人が書いたもの）も計画に入ります。その場合は、規模や重要度を判定モデルが推定します。ブロックがあれば、その分だけ根拠が確かになります。

## 並べ方

まず依存関係を守ります。依存は、GitHub の Issue 依存（blocked by）、ブロックの `dependsOn`、本文の `blocked by #N` の順に信用します。

そのうえで、いますぐ着手できるパッケージどうしは、次の順に並べます。

1. 作業中、優先、通常、後回しの順
2. 重要度の高いもの。`priority:high` のようなラベルがあればそれを使い、なければ判定モデルが高・中・低を推定する
3. 片付けると、着手できるようになるパッケージが多いもの
4. 規模の小さいもの
5. Issue 番号の小さいもの

同じファイルや同じ領域を触る Issue は、ひとつのパッケージにまとめる候補になります。ブロックのない Issue どうしでも、タイトルや本文が似ていれば候補に入れます。実際にまとめるかどうかは、判定モデルに「一緒に片付けたほうがよいか」を聞いて決めます。

## 設定

| キー | 既定値 | 内容 |
| --- | --- | --- |
| `decisionProvider` | `openrouter` | 判定モデルの呼び先。`openrouter`（liquid/d1）、`liquid`（api.liquid.ai）、`typesafe`（Jev）、`custom`、`none` |
| `decisionModel` | `''` | モデル ID。空なら呼び先ごとの既定値。`liquid/d1-ultra` などに変えられる。`custom` では必須 |
| `decisionApiUrl` | `''` | 呼び先の URL。`custom` では必須（System One 互換の POST） |
| `decisionApiKeyRef` | `''` | キーの名前。空なら呼び先に合わせて `OPENROUTER_API_KEY`、`LIQUID_API_KEY`、`TYPESAFE_API_KEY`、`DECISION_API_KEY` |
| `allowExternalJudgment` | `false` | `true` にしたときだけ判定モデルを使う。Issue の本文が外部に送られるため |
| `syncIntervalMinutes` | `60` | 同期の間隔（分）。0 にするとタイマーを止める |
| `maxIssues` | `300` | 1 回の同期で読む Issue の上限。更新の新しいものから読む（最大 5000） |
| `maxQuestionsPerSync` | `200` | 1 回の同期で判定モデルに聞く上限 |
| `mergeThreshold` / `actionableThreshold` / `directionThreshold` | `0.6` / `0.35` / `0.6` | 判定のしきい値 |
| `similarityThreshold` | `0.1` | ブロックのない Issue どうしをまとめる候補にする、文章の近さ（0〜1） |
| `maxPackageSize` | `4` | 1 パッケージの規模の上限（S=1、M=2、L=4 で数える） |
| `githubTokenRef` | `GITHUB_TOKEN` | GitHub のトークン。なければ `GH_TOKEN`、`gh auth token` の順に探す |
| `dataDir` | `''` | 計画の保存先。空なら `$DSH_HOME/data/dsh-issue-priority` |

## 開発

```bash
pnpm install
pnpm check   # 型チェック、テスト、ビルド
```

設計の経緯は [docs/design.md](docs/design.md) にまとめています。
