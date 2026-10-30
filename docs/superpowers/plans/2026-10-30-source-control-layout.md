# ソース管理のパネルの配置 実装プラン

> サブエージェント駆動開発で進める。タスクごとに新しいサブエージェントで実装し、タスクごとにレビューを挟み、最後に全体をレビューする。コミットはしない。

**目的:** ソース管理のパネルの配置を VS Code に合わせる。

**設計書:** `docs/superpowers/specs/2026-10-30-source-control-layout-design.md`。要件の番号はこの設計書のもの。

**気をつける知見:** L-001(同期の途中の失敗)、L-408(キーリピートとダブルクリックの続き。メニューの Enter、Delete の続き)、L-473(Enter・Escape と blur の二重確定)、L-522(グローバルなキーの誤判定)。

**検証コマンド:** 必ず `NODE_ENV=test` を付ける。

```sh
NODE_ENV=test npx vitest run <対象>
NODE_ENV=test npm test
npm run typecheck
npx eslint <変更したファイル>
```

## タスク 1: 変更の同期

**ファイル:** `src/main/gitService.ts`、`src/main/handlers/gitHandlers.ts`、`src/preload/api.ts`、`src/preload/index.d.ts`、`src/renderer/src/lib/gitApi.ts`、`src/renderer/src/hooks/useGitRemoteOperations.ts`、`useRunExclusiveGitOperation.ts`、`useAppState.ts`、それぞれのテスト

要件 12〜14。`pull` と `push` の実体を内部関数に分ける。プルの内部関数は `success`・`failed`・`conflicted` の 3 状態を返す。公開の `pull`・`push` は今のまま `Promise<void>` にする。`syncChanges(): Promise<void>` と `isSyncing` を足す。開始時の `gitStatus.ahead`・`behind` を使う。多重実行は `isSyncingRef` で防ぐ。`pull` の結果 `{ conflicted, errorMessage? }`(要件 13)、`isSyncBlocked`、`clearRemoteOperationError`、プルの後のフォルダの確認(要件 12。`useGitRemoteOperations` に第 5 引数 `folderPath?: string | null` を足し、プルの後の確認は `useLatestRef` で行う。`mergeInProgress` は `gitStatus?.mergeInProgress` を使う)もこのタスクで行う。`useAppState` でフォルダの切り替えのときに `clearRemoteOperationError` を呼ぶ。実 git のテストでコンフリクトの結果を固定する。

## タスク 2: セクションとファイルの行

**ファイル:** `CollapsibleSection.tsx`(新規)、`GitFileRow.tsx`(新規)、`src/renderer/src/lib/filePathParts.ts`(新規)、`ChangesSection.tsx`、`ChangesFileItem.tsx`、`StagedSection.tsx`、`StashSection.tsx`、`HistorySection.tsx`、`GitRepoView.tsx`(`変更はありません` の削除)、`main.css`、テスト

要件 21〜28。`CollapsibleSection` の props は `title`、`count?`、`actions?`、`alwaysVisible?`、`children`。開閉の見出しの `aria-label` は `<title> を折りたたむ` / `<title> を展開する` にせず、`title` の文字をアクセシブルネームにする(`aria-expanded` で状態を伝える)。

## タスク 3: ActionMenu とツールバー

**ファイル:** `ActionMenu.tsx`(新規)、`SourceControlToolbar.tsx`、`SourceControlPanel.tsx`、`main.css`、テスト

要件 1〜6。`ActionMenu` の props は次のとおり。

```ts
export interface ActionMenuItem {
  id: string
  label: string
  disabled?: boolean
  /** menuitemcheckbox にする */
  checked?: boolean
  onSelect: () => void
}
interface Props {
  buttonLabel: string
  buttonContent: React.ReactNode
  buttonClassName?: string
  /** data-remote-setup-focus の値 */
  focusTarget?: RemoteSetupFocusTarget
  items: ActionMenuItem[]
}
```

`ActionMenuItem` に `ariaLabel?: string` を足す(`プル中...` と `プル中` のように違うため)。Enter の実行は `click` に任せ、キーリピートの Enter は項目でもボタンでも `preventDefault` する。外側のクリックは `pointerdown` を document で受け、判定はボタンを含むルート要素で行う。`RemoteSetupFlow.test.tsx` と `useRemoteSetupFocus.ts` のコメントを更新し、`更新` のクラスに依存する `useAgentChangesClearFocus` の結合テストを足す。`Sidebar` の `sidebar__header` の変更もこのタスク。

## タスク 4: コミット欄

**ファイル:** `CommitSection.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`、`Sidebar.tsx`、`App.tsx`、テスト

要件 7〜11。`CommitSection` に `ahead`、`behind`、`isSyncing`、`isSyncBlocked`、`onSync` を足す。amend は `ActionMenu` の `checked` で出す。`isSyncBlocked` と `isSyncing` はタスク 1 の戻り値を使う。`mergeInProgress` も渡す。

## タスク 5: ブランチの操作の移動

**ファイル:** `BranchQuickPick.tsx`、`StatusBarBranch.tsx`、`StatusBarSyncButton.tsx`(新規)、`src/renderer/src/lib/syncChangesLabel.ts`(新規)、`src/renderer/src/lib/branchPicker.ts`、`App.tsx`、`GitRepoView.tsx`、`main.css`、テスト。`BranchSwitcher.tsx`、`BranchSwitcherMenu.tsx`、`BranchMenuItem.tsx`、`src/renderer/src/lib/branchMenuShortcut.ts` とそのテストを消す。

要件 15、15a、16〜20。`App` は `branchOperationError` に加えて `remoteOperationError` も `StatusBarBranchState` へ渡す。`src/renderer/src/components/explorer/NameInputDialog.tsx` に `isBlocked` と `detail` の扱いを足し、`CreateBranchDialog.tsx` から渡す。

1. `BranchQuickPick` に `onCreateRequest`、`onMerge`、`onDelete` を足す。作成の項目は `CREATE_BRANCH_OPTION` という定数の選択として持つ(`\0create` のように Git のブランチ名に使えない文字を含める)。`resolveBranchPickerSelection` と `moveBranchPickerSelection` に渡す候補の先頭に足す。候補が 0 件の文言の判定はブランチの候補だけで行う。
2. `StatusBarBranchState` に `ahead`、`behind`、`isSyncing`、`isSyncBlocked`、`onSync`、`onCreateBranch`、`onDeleteBranch`、`onMergeBranch` を足す。
3. `StatusBarBranch` が `CreateBranchDialog` を開く。作成の成否はフックの結果に任せる。閉じる順序は `useDialogFocusReturn` の `close()` の後に操作を呼ぶ。
4. 消すテストの観点を移す: ダイアログの閉じ方ごとのフォーカスの戻り、実行中の待ち、押せない状態、未保存の確認つきの `mergeBranch` が App から渡ること、作成・削除・マージの失敗の表示。
5. `GitRepoView` のブランチ欄を消す。`pendingBranchOperation`、`onCheckoutBranch`、`onCreateBranch`、`onDeleteBranch`、`onMergeBranch` の props をパネルの経路から消す(使われなくなる分だけ)。`getBranchTriggerLabel` は `StatusBarBranch` が使うので残す。

## タスク 6: ドキュメントとテスト仕様書

1. `ROADMAP.md`: `パネルの配置` を完了にし、機能と既知の制約、入れなかったものを書く。ソース管理の第 1〜3 段階が終わったことを分かるようにする。
2. `docs/manual-test-spec.md`: 要件のとおり既存の項目を ID を変えずに直す。検索語: `ブランチ名ボタン`、`ブランチ名の横`、`🗑`、`🔀`、`Delete`、`M` キー、`amend`、`プル`、`プッシュ`、`フェッチ`、`ステージ済み`(差分のタブ名と `aria-label` の `ステージ済み差分` は変えない)、`変更はありません`。BRN 以外(CNF、DSC、RMT、STH、前提の行)も対象。同期の実機項目の前提は `git config pull.rebase false` にする。ブランチの操作の項目は左下の一覧の手順にする。`ブランチの項目`、`一覧` の語は第 1 段階の節の定義に合わせる。消す機能に当たる項目は消す。新しい項目は `## ソース管理（基本）` に `### パネルの配置` の節で足す。ID は `GIT` の最大値の次から振る。
3. `docs/developer-guide.md` に関連する記述があれば同期する。
4. `node scripts/build-manual-test-spec.mjs` で HTML を再生成し、`NODE_ENV=test npx vitest run scripts` を通す。Artifact の再公開は PR のマージの後にメインのセッションが行う。

## 最終: 全体のレビュー

全タスクの後に `git diff origin/main` 全体をレビューし、`NODE_ENV=test npm test`、`npm run typecheck`、変更したファイルの eslint と prettier を通す。コミットはしない。
