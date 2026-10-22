/** `issue-authoring` skill content (design §4). Single source: schema rules live in plan-block.ts. */
export declare const ISSUE_AUTHORING_SKILL: {
    readonly name: "issue-authoring";
    readonly description: "GitHub Issue を書く・起票する・直すときは必ずこの手順。ユーザーが計画ブロックに触れなくても、計画用の <!-- dsh-plan --> ブロックを issue_draft ツールで付ける。";
    readonly whenToUse: "「Issue 起票して」「Issue にしておいて」「バグとして登録して」など、Issue を新規作成・起票・編集・分割するとき。gh issue create を使う前。";
    readonly content: "# Issue authoring (dsh-issue-priority)\n\nIssue を作る/直すときは、本文の末尾に機械可読の計画ブロックを付けます。\nバックグラウンドの計画器（LLM を使わない）はこのブロックを最優先の根拠として、\nIssue を「同じセッションで片付ける単位（作業パッケージ）」にまとめ、順番を決めます。\n\n## 手順\n\n1. 人間向けの本文を書く（背景 / やりたいこと / 完了条件）。\n2. **issue_draft** ツールを呼ぶ。引数:\n   - `areas`: 影響する領域（kebab-case）。**返ってくる knownAreas に既存名があればそれを使う**。新語は最小限に。\n   - `size`: S（1時間未満）/ M（半日程度）/ L（1日以上）。迷ったら大きめ。L を超えるなら Issue を分割する。\n   - `files`: 変更しそうなパスや glob（例: `src/auth/**`）。わかる範囲で。まとめ判定の一番強い根拠になる。\n   - `dependsOn`: 先に終わっている必要がある Issue 番号。\n   - `acceptance`: 一行の完了条件。\n3. 返ってきた `body` をそのまま使って Issue を作成/更新する（例: `gh issue create --title ... --body-file -`）。\n   ブロックを手で書き換えない。エラーが返ったら直して再度 issue_draft を呼ぶ。\n\n## 注意\n\n- ユーザーはこのブロックの書式を知らなくてよい。areas / size / files は会話とコードから推定して埋め、推定した値を起票後に一行で伝える（例: 「規模 M、領域 ui、依存 #5 として登録しました」）。確認のために作業を止めない。\n\n- ブロックが壊れていると、その Issue は「ブロックなし」として扱われます（警告に出ます）。\n- 依存は GitHub の Issue dependencies（blocked by）でも登録できます。両方あれば GitHub 側が優先されます。\n- このツールは GitHub に書き込みません。投稿は通常の手段で行ってください。\n";
};
/** `issue-work` skill: how the agent should act on a plan. */
export declare const ISSUE_WORK_SKILL: {
    readonly name: "issue-work";
    readonly description: "Issue 対応を始めるときの手順。バックグラウンドで作られた作業パッケージ計画を issue_plan_read で読み、提示→承認→ブランチ→実装→PR(Closes #N) の順に進める。";
    readonly whenToUse: "「Issue 対応しよう」「次なにやる？」「溜まってる Issue を片付けたい」と言われたとき。";
    readonly content: "# Issue work (dsh-issue-priority)\n\n1. **issue_plan_read** を呼ぶ（古ければ自動で同期される）。\n2. 次のおすすめパッケージ（作業中があればそれ）を、含まれる Issue・順番・まとめた理由つきで短く提示し、ユーザーの承認を待つ。\n   別のパッケージを希望されたらそれに従う。「人の判断が必要」項目があれば一言添える。\n3. 承認されたら **issue_plan_update** action=start issues=[...] で作業中にし、作業ブランチを切る。\n4. Issue の順に実装・テスト・コミット。PR 本文に `Closes #N` を全 Issue 分書く。\n5. 依存の見落としに気づいたら issue_plan_update action=depend、後回しにするなら action=defer で記録する。\n6. PR を出したら action=finish。Issue のクローズは GitHub 側で起き、次回同期で計画から消える。\n\nユーザーは /issues（計画表示）、/issues next（次のパッケージを開始）、/issues defer N、/issues pin N、/issues sync でも操作できます。\n";
};
//# sourceMappingURL=skill.d.ts.map