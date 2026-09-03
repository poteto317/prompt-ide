# Git ステージ→コミット基本フロー 設計

対応する ROADMAP 項目（一部）: 「ソース管理（Git）」セクションの以下

- 変更のステージ / アンステージ（ファイル単位）
- コミット（メッセージ入力）

## 背景・現状

現在実装済みなのは `git status` 相当の表示のみ（`src/main/gitService.ts` の `getGitStatus`、`src/renderer/src/hooks/useGitStatus.ts` 経由で `SourceControlPanel` → `GitRepoView` → `StagedSection`/`ChangesSection` に表示）。ステージ/アンステージ/コミットの実行手段が無い。

## スコープ

含む:

- ファイル単位のステージ（`git add`）・アンステージ（`git reset`）
- コミットメッセージ入力とコミット実行（`git commit`）
- 上記操作後の状態表示への即時反映

含まない（別スコープ）:

- ハンク単位（部分選択）のステージ
- コミットの amend
- 変更の破棄（discard／`git checkout --`・`git clean`）
- push / pull / fetch、ブランチ操作、diff 表示、コミット履歴、stash、コンフリクト解決 UI

## 仕様

### ステージ / アンステージ

- `ChangesSection`（未ステージ）の各ファイル行にステージボタン、`StagedSection`（ステージ済み）の各ファイル行にアンステージボタンを追加する。
- ボタンはホバー時に表示する（既存のファイルツリーの右クリックメニューではなく、常時見える形にする。CLAUDE.md のドラッグハンドル系ルールは対象外＝通常の `onClick` ボタンでよい）。
- 実行中はそのファイルパスに対して多重クリックしても二重実行しない（`useFileEditing.ts` の `savingPathsRef`/`savingPaths` と同じ「実行中パスの `Set`」パターンを踏襲）。
- 操作完了後（成功・失敗いずれも）、`refreshGitStatus()` を呼んで状態を再取得する。
- ステージ対象パスは既存の `FolderAccessManager.assertWithinFolder` で許可フォルダ配下かを検証してから実行する。

### コミット

- `StagedSection` の下にコミットメッセージ入力欄（複数行、`textarea`）とコミットボタンを配置する。
- コミットボタンは「メッセージが空またはホワイトスペースのみ」または「ステージ済みファイルが 0 件」のとき無効化する。
- コミット成功後はメッセージ入力欄を空にし、`refreshGitStatus()` を呼ぶ。
- コミット中はボタンを無効化し、ローディング表示を出す（多重コミット防止）。

### 非リポジトリ / フォルダ未オープン時

既存の `SourceControlPanel` の `gitStatus.isRepo === false` 分岐をそのまま使う。ステージ/コミット UI は `GitRepoView` 配下（`isRepo === true` の場合のみレンダーされる）に置くため、追加の分岐は不要。

### エラーハンドリング

`simple-git` が投げる例外のメッセージをそのまま表示する（個別のエラー種別ハンドリング・専用コンバータは作らない。既存の `fsErrorConverter.ts` のような変換層は今回のスコープ外）。エラー表示は操作ごとに直近のものを 1 件だけ保持する単純な状態でよい。

## アーキテクチャ

### main プロセス

- `src/main/gitService.ts` に追加:
  - `stageFile(folderPath: string, filePath: string): Promise<void>` — `simpleGit(folderPath).add(filePath)`
  - `unstageFile(folderPath: string, filePath: string): Promise<void>` — `simpleGit(folderPath).reset(['--', filePath])`
  - `commit(folderPath: string, message: string): Promise<void>` — `simpleGit(folderPath).commit(message)`
- `src/main/handlers/gitHandlers.ts` に IPC チャンネルを追加登録:
  - `git:stage`（`filePath: string` を受け取る）
  - `git:unstage`（`filePath: string` を受け取る）
  - `git:commit`（`message: string` を受け取る）
  - いずれも既存の `git:getStatus` と同様に `folderAccess.get(event.sender.id)` で許可フォルダを取得。`git:stage`/`git:unstage` はさらに `folderAccess.assertWithinFolder(allowedFolder, filePath)` でファイルパスの境界チェックを行う（`fileSystemHandlers.ts` の `fs:deleteEntry` と同じパターン）。境界チェック失敗時はそのまま例外を投げる（`convertFsError` 相当の変換は行わない。ステージ操作のエラーメッセージはそのまま返す方針のため）。

### preload

- `src/preload/api.ts` / `src/preload/index.d.ts` に `stageFile(filePath: string): Promise<void>`、`unstageFile(filePath: string): Promise<void>`、`commitChanges(message: string): Promise<void>` を追加する。

### renderer

- `src/renderer/src/lib/gitApi.ts` に上記 3 関数の薄いラッパーを追加する。
- 新規フック `src/renderer/src/hooks/useGitOperations.ts`:
  - 引数: `refreshGitStatus: () => Promise<void>`
  - 返り値: `stagingPaths: ReadonlySet<string>`（ステージ/アンステージ実行中のパス集合）、`stageFile(path: string): Promise<void>`、`unstageFile(path: string): Promise<void>`、`isCommitting: boolean`、`commit(message: string): Promise<void>`、`operationError: Error | null`
  - `stageFile`/`unstageFile` は `savingPathsRef`（`useFileEditing.ts` と同じ Ref+State 二重管理パターン）で多重実行を防止し、完了時（成功・失敗問わず）に `refreshGitStatus()` を呼ぶ。
  - `commit` は `isCommitting` で多重実行を防止し、成功時のみ呼び出し元にメッセージ入力欄クリアを促す（`commit` 自体は成功可否を `boolean` や例外で返し、呼び出し元（コンポーネント）がメッセージ欄のクリアを判断する）。
- `src/renderer/src/hooks/useAppState.ts` で `useGitOperations(git.refreshGitStatus)` を呼び出し、返り値を展開して `App.tsx` に渡す。
- `App.tsx` → `Sidebar.tsx` → `SourceControlPanel.tsx` → `GitRepoView.tsx` まで props をバケツリレーする（既存の `gitStatus`/`gitLoading`/`gitError`/`onRefresh` と同じ配線パターン）。
- `StagedSection.tsx` に `onUnstage: (path: string) => void`、`stagingPaths: ReadonlySet<string>` を追加し、ファイル行に「アンステージ」ボタンを表示。加えてコミットメッセージ入力欄とコミットボタンをこのコンポーネント内、またはこのコンポーネントの下に新設する `CommitSection.tsx`（新規ファイル）に実装する（ファイル一覧の表示とコミット操作は責務が異なるため、`StagedSection.tsx` にコミット UI を混在させず `CommitSection.tsx` として分離する）。
- `ChangesSection.tsx` に `onStage: (path: string) => void`、`stagingPaths: ReadonlySet<string>` を追加し、ファイル行に「ステージ」ボタンを表示。
- `GitRepoView.tsx` が `useGitOperations` の返り値を受け取り、`StagedSection`/`ChangesSection`/`CommitSection` に配る。

### 型定義

- `src/shared/types/git.ts` に新規の型追加は不要（`GitFileStatus`/`GitStatusResult` は既存のまま使う）。IPC の引数・返り値はプリミティブ型（`string`/`void`）のみで完結する。

## テスト方針

既存パターン（Vitest + Testing Library、`__tests__/` 同階層配置）を踏襲し TDD で実装する。

- `src/main/__tests__/gitService.test.ts`: `stageFile`/`unstageFile`/`commit` が `simple-git` の対応する API を正しい引数で呼ぶことを検証（既存の `getGitStatus` のテストと同じ `simple-git` モックパターン）。
- `src/main/handlers/__tests__/gitHandlers.test.ts`: 新規 3 チャンネルの登録・`assertWithinFolder` 境界チェック（`git:stage`/`git:unstage`）・フォルダ未オープン時のエラーを検証。
- `src/renderer/src/lib/__tests__/gitApi.test.ts`: 3 関数が対応する `window.api.*` を呼ぶことを検証。
- `src/renderer/src/hooks/__tests__/useGitOperations.test.ts`: 多重実行防止・完了後の `refreshGitStatus` 呼び出し・エラー時の `operationError` セット・コミットの空メッセージ/未ステージ時の扱いを検証。
- `src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx`・`StagedSection.test.tsx`: ステージ/アンステージボタンのクリックで対応するコールバックが呼ばれること、実行中は無効化されることを検証。
- `src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`（新規）: メッセージ入力・空/ホワイトスペースのみでのボタン無効化・ステージ 0 件での無効化・コミット成功時のメッセージクリアを検証。

## 実装順序

1. `gitService.ts` に `stageFile`/`unstageFile`/`commit` を追加（TDD）
2. `gitHandlers.ts` に 3 チャンネルを追加（境界チェック込み、TDD）
3. `preload/api.ts`・`preload/index.d.ts` を更新
4. `renderer/lib/gitApi.ts` に 3 関数のラッパーを追加（TDD）
5. `useGitOperations.ts` を新規作成（TDD）
6. `useAppState.ts`／`App.tsx`／`Sidebar.tsx` の配線更新
7. `ChangesSection.tsx`（ステージボタン）・`StagedSection.tsx`（アンステージボタン）の更新（TDD）
8. `CommitSection.tsx` 新規作成（TDD）、`GitRepoView.tsx` に組み込み
9. 型チェック・全テスト実行
10. Electron 実機でステージ→コミットの一連の流れを確認
