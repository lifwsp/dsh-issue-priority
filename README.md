# dsh-issue-priority

GitHub の Issue を定期的に読み、一緒に片付けられるものをまとめて、着手する順番を決めておく DeepSeek Harness（DSH）用プラグインです。次にやることはサイドバーに表示され、ボタンひとつでエージェントに渡せます。

- 判定には判定専用モデル [LiquidAI d1](https://www.liquid.ai/blog/d1-decision-model) を使います。チャット用の LLM は使いません。
- GitHub には書き込みません。

## インストール

```bash
git clone https://github.com/lifwsp/dsh-issue-priority.git
cd dsh-issue-priority
pnpm install && pnpm build
dsh plugin add link:$(pwd)
```

## 設定

1. OpenRouter の API キーを `OPENROUTER_API_KEY` として、DSH の認証情報（`~/.dsh/.credentials.yaml` の `refs:`）か環境変数に設定します。
2. プロファイルの `cordis.patch.yml` に次を追加します。

   ```yaml
   - id: dsh-issue-priority
     name: dsh-issue-priority
     config:
       allowExternalJudgment: true
   ```

   `allowExternalJudgment: true` にすると、Issue のタイトルと本文が判定モデルに送られます。`false`（既定）のままでも動きますが、並び順は依存関係と Issue 番号だけで決まります。

3. DSH を再起動します。

## 使い方

### サイドバー

[dsh-better-sidebar](https://www.npmjs.com/package/dsh-better-sidebar) を入れていると、右サイドバーの「+」から「Issue 計画」タブを開けます。

- **次はこれ**: いま着手すべきパッケージ。「これに着手」でエージェントに渡します。
- **そのあと**: 残りのパッケージ。
- **優先 / 後回し**: Issue ごとに順番を調整します。
- **同期**: GitHub から今すぐ読み直します。
- 丸いアイコンにマウスを置くと、選んだ理由や同期の状態が見えます。確認が必要なことがあるときは「!」になります。

表示するのは、開いているセッションの作業ディレクトリのリポジトリです。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `/issues` | 計画を表示 |
| `/issues next [ID]` | 次のパッケージをエージェントに渡す |
| `/issues pin N` / `defer N` / `clear N` | Issue N を優先 / 後回し / 元に戻す |
| `/issues done` | 作業中の印を外す |
| `/issues sync` | 今すぐ同期 |

### Issue の起票

エージェントに「Issue 起票して」と頼めば、計画に使う情報（規模・領域・関係するファイル・依存）が本文の末尾に自動で付きます。付いていない Issue も計画に入ります。

## 並び順

依存関係を守ったうえで、次の順に並べます。

1. 作業中 → 優先 → 通常 → 後回し
2. 重要度（`priority:high` などのラベル。なければ判定モデルが推定）
3. 終わらせると着手できるようになるパッケージが多いもの
4. 規模が小さいもの

## 設定項目

| キー | 既定値 | 内容 |
| --- | --- | --- |
| `allowExternalJudgment` | `false` | 判定モデルを使うかどうか |
| `decisionProvider` | `openrouter` | `openrouter` / `liquid` / `typesafe` / `custom` / `none` |
| `decisionModel` | `''` | モデル ID（空なら `liquid/d1`） |
| `decisionApiUrl` | `''` | `custom` のときの URL |
| `decisionApiKeyRef` | `''` | API キーの名前（空なら呼び先に応じた既定名） |
| `syncIntervalMinutes` | `60` | 同期の間隔（分）。0 で停止 |
| `maxIssues` | `300` | 1 回の同期で読む Issue の上限 |
| `maxQuestionsPerSync` | `200` | 1 回の同期で判定モデルに聞く上限 |
| `maxPackageSize` | `4` | 1 パッケージの規模の上限（S=1, M=2, L=4） |
| `githubTokenRef` | `GITHUB_TOKEN` | GitHub トークンの名前。なければ `GH_TOKEN`、`gh auth token` を使う |
| `dataDir` | `''` | 計画の保存先（空なら `$DSH_HOME/data/dsh-issue-priority`） |

## 開発

```bash
pnpm install
pnpm check
```

設計は [docs/design.md](docs/design.md) にあります。
