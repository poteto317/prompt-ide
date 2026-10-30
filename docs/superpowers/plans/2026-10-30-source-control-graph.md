# ソース管理の履歴のグラフ 実装プラン

> サブエージェント駆動開発で進める。タスクごとに新しいサブエージェントで実装し、タスクごとにレビューを挟み、最後に全体をレビューする。コミットはしない。

**目的:** 履歴を VS Code の Source Control Graph と同じ形にする。

**設計書:** `docs/superpowers/specs/2026-10-30-source-control-graph-design.md`。要件の番号はこの設計書のもの。

**気をつける知見:** L-001、L-002(`''` と null の区別)、L-037 / L-040(古い応答)、L-043(git の設定で出力が変わる)。

**検証コマンド:** シェルの `NODE_ENV=production` で全体が落ちるため、必ず `NODE_ENV=test` を付ける。

```sh
NODE_ENV=test npx vitest run <対象>
NODE_ENV=test npm test
npm run typecheck
npx eslint <変更したファイル>
```

## タスク 1: 取得(main と IPC)

**ファイル:** `src/shared/types/git.ts`、`src/main/gitLogFormatter.ts`、`src/main/gitService.ts`、`src/main/handlers/gitHandlers.ts`、`src/preload/api.ts`、`src/preload/index.d.ts`、`src/renderer/src/lib/gitApi.ts`、対応するテスト(`src/main/__tests__/gitLogFormatter.test.ts`、`gitService.test.ts`、`gitService.status.integration.test.ts`、`handlers/gitHandlers.test.ts`、`src/renderer/src/lib/__tests__/gitApi.test.ts`)

1. `gitLogFormatter.test.ts` を新しい format(`hash`、親、`%D`、本文、日時、作成者の順)に書き換え、親、ref の種類、`origin/HEAD` の除外、detached、本文に区切り文字が混ざる場合、`hash` の検査のテストを足す。`parseGitLogRefs` のテストも足す。落ちることを確認する。
2. 型と `parseGitLogOutput`・`parseGitLogRefs(decoration): { refs: GitLogRef[]; isHead: boolean }` を実装する。`%D` の要素は `', '` で分ける(ref 名に空白は入らない)。`refs/heads/`・`refs/remotes/`・`refs/tags/` を除いた短い名前にする。
3. `gitService.test.ts` の `mockRaw` は引数で分ける実装に替え(`mockResolvedValue` のままだと `rev-parse` にも効く)、fixture のハッシュは 40 桁にする。実 git のテストを `gitService.status.integration.test.ts` に足す(設計書「テスト」の `gitService` の項目すべて)。一時ディレクトリの削除は既存の `removeTempPathSync` を使う。署名付きコミットは、ssh の署名の鍵を作れない環境で落ちないよう、`log.showSignature=true` だけを設定し、`--no-show-signature` が引数にあることはモックのテストで固定する。
4. `getLog` を設計書の「取得」のとおりに変える。上流の取得は関数 `getUpstreamRef(git)` に分ける。`getHeadCommitMessage(folderPath): Promise<string | null>` を足す。
   - `checkIsRepo()` が false なら null。
   - `git log -1 --no-show-signature --pretty=format:%B HEAD --` の失敗は、`rev-parse --verify HEAD` で分ける。`getLog` と同じく、コミットが無ければ null、それ以外は投げ直す。
   - 成功は `trim()` して返す(`''` も返す)。
5. IPC `git:getHeadCommitMessage` を `git:getLog` と同じ形で足す(`getAllowedFolder`)。`src/preload/api.ts`、`index.d.ts`、`gitApi.getHeadCommitMessage()` を足す。`src/preload/__tests__/api.test.ts` も更新する。
6. 対象のテストと `npm run typecheck` を通す。ここでは `GitLogEntry` の必須の欄が増えるため、テストの fixture が型で落ちる。`parents: []`、`refs: []`、`isHead: false` を足す。

## タスク 2: グラフの組み立て

**ファイル:** `src/renderer/src/lib/gitGraph.ts`(新規)、`src/renderer/src/lib/__tests__/gitGraph.test.ts`(新規)

設計書の「組み立て」のとおりに `buildGitGraphRows(log: readonly GitLogEntry[], upstream: string | null): GitGraphRow[]` を実装する。型は設計書のもの。色は定数で export する。

テストは設計書の `gitGraph` の項目すべて。全テストで共通の検査 `expectLinesConnected(rows)` を作り、「各行の下端の出力レーンのすべてに線が入る」「各行の上端に、前の行の出力レーンのすべてから線が来る」を確かめる。

## タスク 3: 履歴の状態と取り直し

**ファイル:** `src/renderer/src/hooks/useGitHistory.ts`、`src/renderer/src/hooks/useGitRemoteOperations.ts`、`src/renderer/src/hooks/useAppState.ts`(必要なら)、`src/renderer/src/App.tsx`、`src/renderer/src/components/source-control/CommitSection.tsx`(コメント)、App 系のテスト、`useGitHistory.test.ts`、`useGitRemoteOperations` のテスト

1. `useGitHistory` のテストに、`headCommitMessage` の取得、`getHeadCommitMessage` の失敗で履歴は表示できて null になること、履歴の取得の失敗とフォルダなしで null に戻ること、古い応答が新しい値を上書きしないこと、フォルダの切り替えの後に古い `refresh` を呼んでも新しいフォルダの読み込みと `isLoading` と `headCommitMessage` を壊さないこと(完了が読み込みの前と後の 2 通り)を足す。自動モックの `getHeadCommitMessage` は undefined を返すので、`beforeEach` で既定値を設定する。
2. 実装する。`fetchGitHistoryData` の `Promise.all` に `gitApi.getHeadCommitMessage().catch(() => null)` を足し、`isCancelled()` の後に `setLog` と同じ場所で設定する。`HistorySetters` と `GitHistoryState` に足す。`loadMore` は触らない。`refresh` の先頭、`++latestRequestIdRef.current` より前に `if (folderPathRef.current !== folderPath) return` を足す。
3. `App.tsx` の `lastCommitMessage` を `headCommitMessage` にする。`log[0]` を前提にしたコメントを直す。`gitApi` を個別にモックしている App 系のテスト(`App.amend`、`App.commit`、`App.diffTab`、`App.discard`、`App.gitignore`、`App.statusBarBranch`、`App.agentChanges`)に `getHeadCommitMessage` を足す。`App.amend` に、`getLog` の先頭が別のコミットでも HEAD のメッセージが入るテストを足す。
4. `useGitRemoteOperations`: `useRunExclusiveGitOperation` に渡す refresh を、`refreshGitStatus` と `refreshHistory` の両方を `Promise.allSettled` で待つ関数にする。fetch・pull・push の後の表示が同じ経路で更新される。`refreshAfterSetUpstream` は `refreshAfterRemoteOperation` に統合して `runRemoteOperation` より前へ置き、`runSetUpstreamOperation` は無くす(初回 push も同じランナーを使う)。テストを足す(失敗でもエラーの表示と実行中フラグが保たれること)。
5. `App.tsx` の `onRefreshGitStatus` を、`refreshGitStatus` と `refreshHistory` の両方を呼ぶ関数に変える。`更新` で履歴が取り直されるテストを足す。

## タスク 4: 表示

**ファイル:** `src/renderer/src/components/source-control/GitGraphCell.tsx`(新規)、`GitLogRefLabels.tsx`(新規)、`src/renderer/src/components/icons/CloudIcon.tsx`・`TagIcon.tsx`(新規)、`icons/index.ts`、`HistorySection.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`、`src/renderer/src/assets/main.css`、対応するテスト

1. `GitGraphCell`: `row: GitGraphRow` を受ける SVG。`aria-hidden="true"`、高さ 22、幅 `laneCount * 11`。レーンの中心の x は `lane * 11 + 5.5`。`through` は `M x1 0 C x1 11, x2 11, x2 22`、`toCircle` は `M x1 0 C x1 5.5, x2 5.5, x2 11`、`fromCircle` は `M x1 11 C x1 16.5, x2 16.5, x2 22`。円は半径 4。HEAD は `stroke-width="2"` の輪、マージは輪と内側の小さい円の 2 つ(輪の内側は線が透けないよう、サイドバーの背景 `#252526` で塗る)、それ以外は塗りつぶし。線の太さは 1.5。
2. `GitLogRefLabels`: `refs: GitLogRef[]` を要件 8 のとおりに出す。アイコンは現在のブランチとローカルブランチが `BranchIcon`、リモートが `CloudIcon`、タグが `TagIcon`。
3. `HistorySection`: `upstream: string | null` の prop を足し、`useMemo(() => buildGitGraphRows(log, upstream), [log, upstream])` の行を描く。上部のタグのバッジを消す。行の `title` は要件 5。`key={row.entry.hash}`。`branches` と `tags` は `CreateTagDialog` のために残す。
4. `GitRepoView` と `SourceControlPanel` で `gitStatus.upstream` を渡す。
5. `main.css`: `.history-section__badges`、`.history-section__badge*`、`.history-section__log-hash`、`.history-section__log-date` を消す。行は `display: flex`、`align-items: center`、高さ 22px、余白は縦 0(線がつながるため)、`border-bottom` なし。グラフは `flex: 0 1 auto; max-width: 50%; overflow: hidden`。件名と作成者は `.history-section__log-text`(`flex: 1 1 0%; min-width: 40%`)にまとめ、件名は省略記号、作成者は薄い色で `flex: 0 0 auto; max-width: 30%`。ラベルの列は `max-width: 45%` で、ラベルが 2 つ以上の列は `--multiple` で縮めない。ラベルの色は青 `#59A4F9`、紫 `#B180D7` の背景に暗い文字(4.5:1 以上を確認する)、灰色は既存の `#3c3c3c` の背景と `#cccccc`。
6. テスト: 設計書の `GitGraphCell`、`HistorySection` の項目、`GitLogRefLabels` の 2 つまでと `+N`、優先の順。CSS は `main.css` を読み込むテスト(`HistorySection.styles.test.tsx`)で固定する。

## タスク 5: ドキュメントとテスト仕様書

1. `ROADMAP.md`: `コミット履歴 / ログのグラフ表示` を `[x]` にし、実装済みの節へ、機能と既知の制約を足す。
2. `docs/manual-test-spec.md`: `## ソース管理（基本）` の `### コミット履歴 / ブランチ / タグの表示` の項目を実態に合わせる(GIT-069、GIT-070 など)。`もっと見る` の項目(GIT-073・074)の手順に、履歴を取り直す手順を入れる。RMT-025、RMT-028、TAG-006、TAG-008、`## タグの作成` の前提を直す。新しい節 `### 履歴のグラフ` を同じ領域に足す。ID は `GIT` の最大値の次から振る。内容: 直線、分岐とマージの線、HEAD の輪、マージの輪、上流が先行しているときの表示(上流の紫のレーン、amend の欄が HEAD のメッセージ)、ahead と behind の両方、ラベルの種類と `+N`、`title`、detached、上流なし、fetch・pull・push の後の更新、`更新` の取り直し、`もっと見る` の後の線、狭いパネル、`HEAD` というファイルがあるリポジトリ、`log.showSignature=true`。
3. `docs/developer-guide.md` に関連する記述があれば同期する。
4. `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、`NODE_ENV=test npx vitest run scripts` を通す。Artifact の再公開は、PR のマージの後にメインのセッションが行う(未マージの内容を公開しないため)。

## 最終: 全体のレビュー

全タスクの後に `git diff origin/main` 全体をレビューし、`NODE_ENV=test npm test`、`npm run typecheck`、変更したファイルの eslint と prettier を通す。コミットはしない。
