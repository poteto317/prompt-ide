# 複数ファイルの同時タブ管理 設計

対応する ROADMAP 項目: 「複数ファイルの同時タブ管理（追加 / 切り替え / クローズ / 並び替え）」

## 背景・現状

現在の `EditorTabs`/`EditorTab` は見た目だけの単一タブで、複数タブの入れ物自体が無い。`useFileSystem` は `openFile: OpenFile | null` として同時に1ファイルしか開けず、`useFileEditing` の dirty/保存/FS操作ロック管理も単一ファイル前提（`generationRef` などが単一値）になっている。

なお `origin/feat/editor-tab-close` というリモートブランチが存在するが、内容はすでに `main` に含まれている残骸ブランチであり、本設計とは無関係。

## スコープ

含む: タブの追加・切り替え・クローズ・並び替え、各タブの編集内容（未保存変更を含む）の保持、非アクティブタブを含む全タブへの FS 操作競合保護（削除・リネームなどとの競合防止）。

含まない（別 ROADMAP 項目）: タブのピン留め・全タブを閉じる・他のタブを閉じる、ワークスペースセッションの保存・復元（アプリ再起動時のタブ復元）。

## 仕様

- ファイルを開く: エクスプローラーで新規ファイルをクリックすると新しいタブを追加してアクティブ化する。**既に開いているファイルを再度クリックした場合は新規タブを作らず、既存タブをアクティブ化する。**
- タブ切り替え: タブクリックでアクティブファイルを切り替える。切り替えても各タブの編集内容（dirty状態含む）は保持される。
- タブクローズ: ×ボタンでクローズ。対象タブが dirty なら確認ダイアログ（既存の `confirmDiscardIfDirty` と同じ文言・挙動）を出す。アクティブタブを閉じた場合、右隣のタブ、無ければ左隣のタブ、どちらも無ければ `activeFilePath = null`（Welcome画面）に遷移する。
- 並び替え: `@dnd-kit` によるドラッグ&ドロップでタブ順を入れ替える（`feat/prompt-dnd-reorder` と同じパターン）。
- FS操作との競合保護: 非アクティブタブが指すファイルが外部で削除・リネームされた場合も、アクティブタブと同じ保護レベル（保存ロック・無効化・中止通知）を適用する。

## アーキテクチャ

### 状態管理の変更

- `useFileSystem`: `openFile: OpenFile | null` → `openFiles: OpenFile[]` + `activeFilePath: string | null`
  - `selectFile(path)`: 既に `openFiles` にあれば `activeFilePath` を切り替えるのみ。無ければ読み込んで配列に追加しアクティブ化。
  - `closeTab(path)`: 配列から除去。アクティブタブを閉じた場合は隣接タブ（右優先→左→null）に遷移。
  - `reorderTabs(fromIndex, toIndex)`: `arrayMove`（`@dnd-kit/sortable`）で配列を並べ替える。

- `useFileEditing`: 単一値だった内部状態を path キーの `Map` に置き換える。
  - `generationRef: number` → `Map<string, number>`（ファイルごとの編集セッション世代）
  - `saveAbortNoticeRef` / `saveError` → `Map<string, ...>`
  - `savingPaths`（既に `Set<string>`）はそのまま
  - 公開インターフェースを path 引数ベースに変更: `isDirty(path)` / `isSaving(path)` / `saveError(path)` / `updateFileContent(path, content)` / `saveFile(path)` / `resetForFileChange(path, options)` / `confirmDiscardIfDirty(path)`
  - `lockPathForFileOperation` / `pendingSaveFor` / `saveCompletionsFor` は元々 path 引数ベースのため変更は最小限

### UI コンポーネント

- `EditorTabs`: `tabs: {path, name, isDirty}[]` と `activePath` を受け取り、`DndContext` + `SortableContext`（`closestCenter`）でタブ列を描画。`role="tablist"`。
- `EditorTab`: `useSortable` でドラッグ対応。クリックでアクティブ化、×ボタンでクローズ。`role="tab"` + `aria-selected={path === activePath}`。
- `EditorPanel`: `activeFilePath` に対応する1ファイルのみ Monaco をマウント（`key={activeFilePath}` で切替時に再マウント、既存方式を維持）。非アクティブタブの Monaco インスタンスは保持しない。

### データフロー

エクスプローラークリック → `selectFile(path)` → 新規なら読み込み+`openFiles`へ追加、既存なら`activeFilePath`切替 → `EditorPanel`が`activeFilePath`のファイルのみMonacoでレンダー → `EditorTabs`が`openFiles`全件をタブとして表示。

## エラーハンドリング

既存の `SAVE_ABORTED_BY_*` 文言・FS操作ロック機構（`lockPathForFileOperation` 等）はそのまま全タブに適用される（path ベースの設計のため）。タブクローズ時の破棄確認は既存の `confirmDiscardIfDirty` と同じダイアログ文言を使う。

## テスト方針

既存パターン（Vitest + Testing Library、`__tests__/` 同階層配置）を踏襲し、TDD で実装する。

- `useFileEditing.test.ts`: 複数path同時編集・保存・FS操作競合（file A保存中でもfile Bの保存はブロックされない等）
- `useFileSystem.test.ts`: 複数タブオープン・重複オープン時の既存タブアクティブ化・クローズ時の隣接タブ遷移・並び替え
- `EditorTabs.test.tsx` / `EditorTab.test.tsx`: 複数タブ描画・クリック切替・×クローズ・dnd-kit並び替え
- `EditorPanel.test.tsx`: アクティブタブのみMonacoマウント、切替時の再マウント確認

## 実装順序

1. `useFileEditing` を path ベースの Map 管理に書き換え（既存テスト全通過を維持しつつ拡張）
2. `useFileSystem` の `openFile` → `openFiles`/`activeFilePath` 化、`selectFile`/`closeTab`/`reorderTabs` 追加
3. 上位（`useAppState`, `App.tsx`）の配線更新
4. `EditorTabs`/`EditorTab` をタブ配列対応・dnd-kit並び替え対応に書き換え
5. `EditorPanel` をアクティブタブ1つのみMonacoレンダーに更新
6. 実機（Electron）で複数タブの追加/切替/クローズ/並び替え・保存・外部削除時の挙動を確認
