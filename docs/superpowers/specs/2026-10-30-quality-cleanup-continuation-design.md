# 品質改善の続き(重複の整理・長い関数の分割・テスト・ドキュメント)設計書

## 目的

ブランチ `claude/api-improve-2026-10-30` の品質改善を続ける。**アプリの振る舞いは変えない。** 実機の確認項目は増えない。

## 現状の調査結果

- テスト: 603 ファイル、13,255 件成功・1 件スキップ。カバレッジは statements 98.73%・branches 96.73%。
- 重複: 7 行以上一致する箇所を機械的に数えると、ロジックの重複は少ない。多いのは props の型の重複(`Sidebar`・`SourceControlPanel`・`GitRepoView`・`ExplorerPanel`)と、下の R1〜R5 の箇所。
- 長い関数: `registerGitHandlers`(325 行)は受け口を並べただけで、機械的に分けられる。`useFileSystem`・`useAgentSessions`・`useAppState` は状態を共有するフックで、分割は競合の順序を変える危険が大きい。
- テストの薄い箇所(branches): `MarkdownRenderer.tsx` 78.57%、`gitCloneProcess.ts` 83.33%、`ModelSettingsSection.tsx` 83.33%、`agentChangesProtectionRef.ts` 83.78%、`agentChangesQuery.ts` 85.05%(未通過の分岐が最も多い)。直接のテストが無いフック: `useRunExclusiveGitOperation.ts`、`useAgentDiffFocusRestore.ts`(branches 88.23%)。

## 範囲

### リファクタリング

**R1. 設定フックの共通化(`useExecutionMode`・`useAgentCliKind`)**

新しい `hooks/useSavedSetting.ts` に、読み込み・楽観的な変更・失敗時の戻しをまとめる。

```ts
export interface UseSavedSettingOptions<TValue, TLoaded> {
  load: () => Promise<TLoaded>
  readValue: (loaded: TLoaded) => TValue
  save: (next: TValue) => Promise<void>
  defaultValue: TValue
  saveErrorPrefix: string
  /** console.error の第 1 引数の完全な文字列(`console.error(loadLogLabel, err)` の形で出す)。今の文字列をそのまま渡す */
  loadLogLabel: string
  saveLogLabel: string
  onLoaded: (loaded: TLoaded) => void
  onLoadFailed: () => void
  onSaved: () => void
}

export interface SavedSettingState<TValue> {
  value: TValue | null
  saveError: string | null
  change: (next: TValue) => Promise<boolean>
}
```

- 保つ振る舞い: 読み込み前は `null`。読み込み失敗は既定値で続ける。変更はすぐ表示に反映し、失敗したら**変更前の値**へ戻して固定の理由の文言を出す。例外の文言は画面に出さない(L-017)。`console.error` の文字列も変えない。
- `onLoaded`・`onLoadFailed`・`onSaved` は必須にする(配線の漏れを型で検出する。L-060)。`useExecutionMode` はモジュールの直下で定義した何もしない関数を渡す。
- `onLoaded`・`onLoadFailed` は、内部の値の state を更新するのと同じ同期の処理の中で呼ぶ(`useAgentCliKind` の `kind` と `fallback` が同じ描画で変わることを保つ)。`onSaved` は保存の `await` の後に呼ぶ(今の `setFallback(null)` と同じ)。
- `console.error` の文字列はテストで完全一致で固定する。
- 読み込みの完了の前に変更したときは、後から届いた読み込みの結果が今と同じく無条件に上書きする(ガードを足さない)。設定の画面の選択肢は読み込みの完了まで無効(`ExecutionModeSection.tsx:52`・`AgentCliKindSection.tsx:48`)なので、画面からは届かない。この経路もテストで固定する。
- 読み込みが取り消された(`cancelled`)ときも今と同じにする。成功: state もコールバックも触らない。失敗: `console.error` は `cancelled` に関係なく出し、既定値の反映と `onLoadFailed` は `cancelled` なら行わない。それぞれの呼び出し回数をテストで固定する。
- 読み込みの effect の依存配列には `load`・`readValue`・`defaultValue`・`loadLogLabel`・`onLoaded`・`onLoadFailed` を入れる(`useBooleanSetting` と同じ形)。したがって、これらは参照が安定していることを必須とする。呼び出し側は `load`・`save` に `settingsApi` の関数を、`readValue` にモジュールの直下で定義した関数を、コールバックに `useCallback` で固定した関数を渡す。再描画しても `load` が 1 回しか呼ばれないことをテストで固定する。既存の 2 つのフックの戻り値の形(`mode`/`changeMode`、`kind`/`fallback`/`changeKind`)は変えない。
- `useBooleanSetting` は**共通化しない**。こちらは「最後に保存できた値へ戻す」「後の変更が始まっていたら戻さない(L-406)」で、続けて変更したときの結果が上の 2 つと異なる。2 つの方式を 1 つのフックに持たせても分岐が増えるだけなので、違いを `useSavedSetting.ts` のコメントに書く。
- 差し替えの前に、続けて変更して先の保存が失敗したときの今の結果を、`useExecutionMode`・`useAgentCliKind` のテストに書いて固定する。

**R2. `registerGitHandlers` の分割**

- `assert*Arg` の検証と、それらが共有する定数 `MAX_CONFLICT_ENTRIES` を `handlers/gitPayloadParser.ts` へ移す(既存の `*PayloadParser.ts` の命名に合わせる)。関数の中身は変えず、`assert*Arg` を export する。検証だけが使う import も一緒に移す。`getAllowedFolder`・`resolveAndAssert*RelativePath` は `gitHandlers.ts` に残す。
- `registerGitHandlers` は次の 6 つの関数を呼ぶだけにする。いずれも `(ipcMain, folderAccess)` を受け、`gitHandlers.ts` の中に置く。受け口の中身は変えない。
  - `registerGitWorkingTreeHandlers`: getStatus・stage・unstage・discardChanges・discardHunk・discardAll・getDiff・stageHunk・unstageHunk
  - `registerGitConflictHandlers`: getConflictFile・resolveConflictBlocks・resolveConflictWholeFile・keepConflictFile・removeConflictFile・markConflictResolved・completeMerge・abortMerge
  - `registerGitHistoryHandlers`: commit・amendCommit・getLog・getBranches・getTags・createTag
  - `registerGitBranchHandlers`: checkoutBranch・createBranch・deleteBranch・mergeBranch
  - `registerGitStashHandlers`: getStashes・stashPush・stashPop・stashDrop
  - `registerGitRemoteHandlers`: push・pull・fetch・init・addOrigin・pushSetUpstream
- 分割の前に、登録されるチャンネルの一覧を固定するテストを書く(`src/main/__tests__/` の既存の gitHandlers のテストに追加)。

**R3. `runFolderOpen` の分割(`useFileSystem.ts`)**

次の 2 つを、同じフックの内側の関数にする。処理の順序と `await` の位置は変えない。ref はフックの直下で解決できるので引数にしない。

- `retryRefreshSkippedDuringScan(): Promise<void>`: `finally` の中の `try`〜`catch`(`refreshSkippedRef` を下ろして `refreshTree` を呼び、`setError`・`setFolderLoadError` まで)をそのまま移す。`if (pendingFolderOpenRef.current === 0 && refreshSkippedRef.current)` の判定は `finally` に残し、その中で `await` する(やり直しが無い経路に `await` を増やさない)。
- `commitFolderAfterScanFailure(selectedPath: string, committedOpenAtStart: number | null, dirtyBaseline: DirtyBaseline | null): void`: `catch` の中の `if (selectedPath !== null)` の内側(`committedOpenAtStart`・`dirtyBaseline` の null の判定と `closeAllTabsForFolderChange()` を含む)をそのまま移す。`catch` に残す判定は `if (selectedPath !== null)` だけ。

世代の判定(`superseded`)と、`catch` の中の `setError(failure)`・`setFolderLoadError(failure)` は `runFolderOpen` に残す。

**R4. 型の重複の整理(実行時のコードは変わらない)**

- `GitRepoView` の `Props` を `GitRepoViewProps` として export し、`SourceControlPanel` の `Props` は `Omit<GitRepoViewProps, 'branch' | 'ahead' | 'behind' | 'files' | 'remoteSetupKind' | 'requestRemoteSetupFocus'>` を継承し、固有の props(`gitStatus`・`operationError` など)だけを書く。
- `SourceControlPanel` の `Props` を `SourceControlPanelProps`、`ExplorerPanel` の `Props` を `ExplorerPanelProps` として export し、`Sidebar` の `Props` は `Omit<ExplorerPanelProps, 'onAddReference'>` と `Omit<SourceControlPanelProps, 'branchOperationError' | 'onDiscard' | 'onRefresh' | 'onStage' | 'onUnstage' | 'operationError' | 'remoteOperationError'>` を継承する(この 2 つに同じ名前の props は無い)。`onAddReference` は `Sidebar` が `agentReferences` から導出するので受けない。名前が違う props(`onStageFile` など)はそのまま書く。
- 必須か省略可能かは変えない(L-060)。説明のコメントは、元の宣言のほうに残して失わない。
- `getPromptRunAvailability` と `getHistoryRerunAvailability` の共通の引数を型にまとめる。

**R5. 小さな重複**

- `useGitRemoteOperations.ts`: `push` と `pushSetUpstream` の `isBusy` を 1 つの内側の関数にする。
- `AgentChangesSection.tsx`: 「いまから記録する」と「もう一度試す」のボタンを、文言だけが違う同じファイル内の部品にする。

### テスト

- 上の「テストの薄い箇所」7 ファイルの未通過の分岐のうち、実際に到達できるものにテストを足す。直接のテストが無い `useRunExclusiveGitOperation.ts`・`useAgentDiffFocusRestore.ts` は、新しいテストファイルを作る。
- **テストのために実装を変えない。** `/* v8 ignore */` も足さない。到達できない防御の分岐は残し、理由をプランの作業の結果に書く。
- 期待値は今の実装の振る舞いで固定する。テストを書いていて不具合らしいものを見つけたら、直さずに PR の「要確認事項」へ書く。

### ドキュメント

- `docs/developer-guide.md`: 設定の読み書きのフックの使い分け(`useSavedSetting` と `useBooleanSetting`)と、`gitHandlers.ts` の分け方を書く。
- `README.md`: 主要なモジュールの節に今回の変更を反映する。
- `README.md` と `docs/developer-guide.md` に書かれたファイルのパスが実在するかを確かめ、ずれていれば直す。

## 範囲外

- `apiKey` が文字列でないときの `TypeError`、vitest の `environmentMatchGlobs` が効かない件(振る舞いが変わる。PR の要確認事項に書く)。
- `useExecutionMode`・`useAgentCliKind` で続けて変更したときに、先の保存の失敗が後の選択を画面上で巻き戻す件(`useBooleanSetting` は L-406 で対処済み。振る舞いが変わるので今回は直さず、テストで今の結果を固定し、PR の要確認事項に書く)。
- `useExecutionMode`・`useAgentCliKind` で読み込みの完了の前に変更すると、読み込みの結果が変更を上書きする件(L-040 の型。画面からは届かない。振る舞いは変えず、PR の要確認事項に書く)。
- `useFileSystem`・`useAgentSessions`・`useAppState`・`useFileEditing`・`App` の大きな分割。
- `runCLIPrompt`(クロージャの状態を共有していて、分けても読みやすくならない)。
- `useAgentSessions` の `interrupt` と `interruptFollowUp` の共通化(`sent` のときの戻り値が違い、数行しか減らない)。

## 決めたこと

ユーザーの確認が要る選択は無かった。次のとおり決めた。

- 設定フックは 3 つをまとめず、方式が同じ 2 つだけをまとめる。
- 機能の追加や挙動の変更が無く、CLAUDE.md の「機能を開発するたびに」に当たらないので、`docs/manual-test-spec.md` には項目を足さず、Artifact も再公開しない。プランの最終タスクには全体の検証だけを置く。
- `ROADMAP.md` に該当する項目は無い(`リファクタリング提案` はアプリの機能の候補で、今回の作業とは別)ので更新しない。
- コミットは `/commit-ja` まで行わない。

## 受け入れ条件

- `npm run typecheck`・`npx eslint . --max-warnings 0`・`npx vitest run --testTimeout=30000`・`npm run build` が通る。
- 既存のテストの期待値を変えていない(内部の構成を見ているテストの import の変更を除く)。
- `registerGitHandlers` で登録されるチャンネルの集合が分割の前後で同じ。
- カバレッジの数値は目標にしない。

## 気をつける知見

- L-017: 例外の文言を画面に出さない(R1)。
- L-037・L-040: 非同期の結果の世代の判定を変えない(R1・R3)。
- L-053: 途中の例外で後続が止まらない形を保つ(R3)。
- L-060: 省略可能な props・オプションを増やさない(R1・R4)。
- L-065: サブエージェントの報告はそのまま信じず、差分とテストの結果を確かめる。
- L-200: サブエージェントは `git checkout`・`git restore`・`git stash`・`git reset` を使わない(未コミットの作業が消える)。整形は変更したファイルだけに行う。報告や中間ファイルはリポジトリの外に置く。各タスクの後に統括側が `git diff --stat` と該当のテストで確かめ、差分を scratchpad に控える。
- L-618: テストの再帰削除は `removeTempPath` を通す。
