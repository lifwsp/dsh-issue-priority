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

既定では Decision Model を使いません。この状態でも動きますが、規模や重要度は見積もらず、依存関係と Issue 番号の順に並びます。

Decision Model を使うときは、呼び先と API キーを設定し、`allowExternalJudgment` を `true` にします。`true` にすると、Issue のタイトル・ラベル・本文と、人が書いたコメントが呼び先に送られます。

```yaml
# cordis.patch.yml
- id: dsh-issue-priority
  name: dsh-issue-priority
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
dependsOn: 12
-->
```

中身はエージェントが会話とコードから推定して書きます。このプラグインは、ここに書かれた規模・関係するファイル・依存関係を、まとめ方と順番の根拠に使います。コメントのない Issue も計画に入ります。

## 順番の決め方

- 「#12 の後」のように依存関係が書かれている Issue は、相手が閉じるまで **先行待ち** になります。依存は GitHub の Issue 依存（blocked by）、上の `dependsOn`、本文やコメントの `blocked by #12` から読み取ります。本文やコメントから読み取った依存は、Decision Model がスレッド全体を読み、後のコメントで取り消されていれば外します。
- すぐ着手できるパッケージどうしは、**優先** を付けたもの、重要度が高いもの、規模が小さいものの順に並べます。重要度は `priority:high` などのラベルがあればそれを使い、なければ Decision Model が見積もります。
- **後回し** を付けたものは最後に回します。

## 主な設定項目

| キー | 既定値 | 内容 |
| --- | --- | --- |
| `allowExternalJudgment` | `false` | Decision Model に Issue を送ってよいか。`decisionProvider` と両方そろったときだけ使う |
| `decisionProvider` | `none` | Decision Model の呼び先（上の表）。`none` は使わない |
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
