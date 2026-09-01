# 複数ファイルの同時タブ管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エディタで複数ファイルを同時にタブとして開き、追加・切り替え・クローズ・並び替えができるようにする。

**Architecture:** `useFileSystem` の状態を単一の `openFile` から `openFiles: OpenFile[]` + `activeFilePath: string | null` に拡張する。`useFileEditing` は「アクティブファイルの中身を管理する」という既存の役割のまま変更しない（渡す引数がアクティブファイルの参照に変わるだけ）。`useFileTreeOperations` の削除・リネーム追随ロジックを単一ファイルから配列全体への適用に拡張する。UI 側は `@dnd-kit`（既存の `feat/prompt-dnd-reorder` と同じパターン）でタブの並び替えに対応する。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, `@dnd-kit/core` / `@dnd-kit/sortable`（既存依存、追加インストール不要）

## Global Constraints

- すべてのコミットメッセージは日本語・Conventional Commit 形式（CLAUDE.md）
- 型としてのみ使う import は `import type` を使う（CLAUDE.md）
- テストは `__tests__/` 同階層配置、Vitest + Testing Library、`describe`/`it` は日本語（既存パターン踏襲）
- `git commit` は各タスクの最後に行うが、ユーザーへの `git push` は行わない
- 各タスク完了時に `npm run typecheck` と対象テストファイルの `npm test` を実行し、パスすることを確認してからコミットする
- 既存の `SAVE_ABORTED_BY_*` 文言・FS操作ロック機構（`useFileEditing.ts` の `lockPathForFileOperation` 等）は変更しない

---

## 設計上の重要な決定（実装者向け背景）

- `useFileEditing(openFile, setOpenFile, options)` のシグネチャは変更しない。`openFile` は「現在アクティブなタブの中身」を表し続ける。タブを切り替えるたびに `useFileSystem` がこの引数を差し替えるので、`useFileEditing` 内部の保存ロック・世代管理ロジックは無改修で複数タブに対応できる。
- 複数タブ化により「別ファイルを開く操作」はもう既存タブの内容を破棄しないため、`selectFile()` 冒頭の `confirmDiscardIfDirty()` 呼び出しは撤去する（新規タブを追加するだけなら破棄されるものが無い）。この変更に伴い、`useFileSystem.test.ts` 内の「別ファイルを開こうとして読み込み中に元ファイルへの編集が入ったら確認する」系のテスト（例: `読み込み中に入った未保存の編集を確認なしで破棄しない` テスト、399-450行付近）は、複数タブ化によって成立しなくなるシナリオなので削除する。
- `openFolder()` の `confirmDiscardIfDirty()` は「フォルダを切り替えると開いている全タブを閉じる」ことになるため、「`openFiles` の中にひとつでも dirty なファイルがあれば確認する」に拡張する。
- `closeTab(path)` / `closeFile()` は対象タブが dirty なら確認する（既存の破棄確認ダイアログ文言を流用）。
- 削除・リネームで複数の開いているファイルが影響を受け得る（祖先ディレクトリの削除/リネーム）ため、`useFileTreeOperations` の `affected` 判定はファイル単体ではなく配列全体に対して行う。
- `useFileEditing` の `generationRef`（世代カウンタ）は「今アクティブなファイルの編集セッション」だけを追えばよい。非アクティブタブの削除・リネームでは、そのタブがアクティブでない限り `resetForFileChange()` を呼んではいけない（呼ぶと、たまたま進行中のアクティブファイルの保存が誤って無効化される）。このため `useFileTreeOperations` には新たに `getActiveFilePath: () => string | null` を渡し、影響範囲にアクティブファイルが含まれる場合のみ `resetForFileChange()` を呼ぶ。

---

### Task 1: `useFileTreeOperations` を複数 `openFiles` 配列対応にする

**Files:**
- Modify: `src/renderer/src/hooks/useFileTreeOperations.ts`
- Test: `src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`

**Interfaces:**
- Consumes: `pathUtils.ts` の `isPathAtOrInside`, `isSamePath`, `replacePathPrefix`, `joinPath`, `isSafeEntryName`（変更なし）
- Produces: `useFileTreeOperations(options: FileTreeOperationsOptions)` の `options` 型が変わる。新シグネチャ:
  ```ts
  interface FileTreeOperationsOptions {
    getFolderPath: () => string | null
    getOpenFiles: () => OpenFile[]
    setOpenFiles: (updater: (prev: OpenFile[]) => OpenFile[]) => void
    getActiveFilePath: () => string | null
    resetForFileChange: (options?: ResetForFileChangeOptions) => void
    onConfirm: (message: string) => boolean
    invalidatePendingReads: (affectedPath: string) => void
    beginTreeWrite: () => (() => boolean) | null
    lockPathForFileOperation: (
      targetPath: string,
      options?: FileOperationLockOptions
    ) => Promise<(result?: FileOperationResult) => void>
    reportTreeLoad: (error: Error | null) => void
  }
  ```
  戻り値の型 `FileTreeOperationsState` は変更なし。

- [ ] **Step 1: 失敗するテストを書く（複数ファイルが削除で影響を受けるケース）**

`src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts` の `renderOperations` ヘルパー（27-62行）を配列対応に書き換える:

```ts
function renderOperations(config?: {
  folderPath?: string | null
  initialOpenFiles?: OpenFile[]
  initialActiveFilePath?: string | null
  onConfirm?: (message: string) => boolean
  resetForFileChange?: (options?: ResetForFileChangeOptions) => void
  lockPathForFileOperation?: (
    targetPath: string,
    options?: FileOperationLockOptions
  ) => Promise<() => void>
  invalidatePendingReads?: (affectedPath: string) => void
  beginTreeWrite?: () => (() => boolean) | null
}) {
  const resetForFileChange = config?.resetForFileChange ?? vi.fn()
  const lockPathForFileOperation = config?.lockPathForFileOperation ?? (async () => () => {})
  const invalidatePendingReads = config?.invalidatePendingReads ?? vi.fn()
  const onConfirm = config?.onConfirm ?? vi.fn<(message: string) => boolean>().mockReturnValue(true)
  const folderPath = config && 'folderPath' in config ? (config.folderPath ?? null) : '/project'
  const treeWriteGuard = makeTreeWriteGuard()
  const { result } = renderHook(() => {
    const [openFiles, setOpenFiles] = useState<OpenFile[]>(config?.initialOpenFiles ?? [])
    const activeFilePath = config?.initialActiveFilePath ?? (openFiles[0]?.path ?? null)
    const ops = useFileTreeOperations({
      getFolderPath: () => folderPath,
      getOpenFiles: () => openFiles,
      setOpenFiles,
      getActiveFilePath: () => activeFilePath,
      resetForFileChange,
      onConfirm,
      invalidatePendingReads,
      beginTreeWrite: config?.beginTreeWrite ?? treeWriteGuard,
      lockPathForFileOperation,
      reportTreeLoad: vi.fn()
    })
    return { ...ops, openFiles }
  })
  return { result, resetForFileChange, onConfirm, invalidatePendingReads, lockPathForFileOperation }
}
```

同様に `renderOperationsWithFolder`（64-80行）内の `getOpenFile`/`setOpenFile` を `getOpenFiles: () => []` / `setOpenFiles: () => {}` / `getActiveFilePath: () => null` に置き換える。

既存の `initialOpenFile` を使っていた呼び出し箇所（`renderOperations({ initialOpenFile: makeOpenFile(...) })` の形）を全て `initialOpenFiles: [makeOpenFile(...)]` に置き換える（このテストファイル内で `initialOpenFile:` を grep して機械的に置換する）。同様に、テスト内で `result.current.openFile` を読んでいる箇所は `result.current.openFiles[0]` 等、配列アクセスに置き換える。

その上で、このファイルの末尾に新しいテストを追加する:

```ts
describe('複数ファイルへの追随', () => {
  it('祖先ディレクトリの削除で、配下にある開いている複数ファイルがすべて閉じる', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/b.ts', 'b.ts')
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path
    })

    await act(async () => {
      await result.current.deleteEntry(dirNode)
    })

    expect(result.current.openFiles).toEqual([])
  })

  it('祖先ディレクトリの削除で、配下の非アクティブファイルが dirty なら確認する', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const dirtyFileB = { ...makeOpenFile('/project/src/b.ts', 'b.ts'), content: '編集済み' }
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderOperations({
      initialOpenFiles: [fileA, dirtyFileB],
      initialActiveFilePath: fileA.path,
      onConfirm
    })

    await act(async () => {
      await result.current.deleteEntry(dirNode)
    })

    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFiles).toEqual([])
  })

  it('祖先ディレクトリのリネームで、配下にある複数の開いているファイルの path がすべて付け替わる', async () => {
    mockRenameEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/nested/b.ts', 'b.ts')
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path
    })

    await act(async () => {
      await result.current.renameEntry(dirNode, 'renamed')
    })

    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/renamed/a.ts',
      '/project/renamed/nested/b.ts'
    ])
  })

  it('非アクティブファイルの削除では resetForFileChange を呼ばない', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/b.ts', 'b.ts')
    const resetForFileChange = vi.fn()
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path,
      resetForFileChange
    })

    await act(async () => {
      await result.current.deleteEntry({ name: 'b.ts', path: '/project/src/b.ts', type: 'file' })
    })

    expect(resetForFileChange).not.toHaveBeenCalled()
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`
Expected: FAIL（`getOpenFiles is not a function` 等の型/実行時エラー、または新規テストが期待通りに動かない）

- [ ] **Step 3: `useFileTreeOperations.ts` を実装する**

`src/renderer/src/hooks/useFileTreeOperations.ts` を以下のように書き換える。冒頭の `FileTreeOperationsOptions` インターフェース（27-49行）を上記の新シグネチャに変更する。

`confirmDiscardOfNewEdits`（114-134行）を配列対応にする:

```ts
const snapshotAffected = (node: FileTreeNode): OpenFile[] =>
  getOpenFiles().filter((f) => isPathAtOrInside(f.path, node.path))

// 削除の待機中に入った未保存の編集を、確認なしで捨てない。影響を受ける
// ファイルが複数ある場合、その集合の中に dirty なものが一つでもあれば
// まとめて 1 回だけ確認する(ファイルごとに確認ダイアログを出すと煩雑なため)
const confirmDiscardOfNewEdits = (
  node: FileTreeNode,
  affectedAtConfirm: OpenFile[],
  message: string = DISCARD_ON_DELETE_MESSAGE
): boolean => {
  const affectedNow = snapshotAffected(node)
  const hasDirty = affectedNow.some((f) => f.content !== f.savedContent)
  if (!hasDirty) return true
  // 待機中に確認済みの状態から変わっていなければ再確認しない(同じダイアログが2回出るのを防ぐ)
  const unchanged =
    affectedNow.length === affectedAtConfirm.length &&
    affectedNow.every((f) => {
      const before = affectedAtConfirm.find((b) => isSamePath(b.path, f.path))
      return (
        before !== undefined &&
        before.content === f.content &&
        before.savedContent === f.savedContent
      )
    })
  if (unchanged) return true
  return onConfirm(message)
}
```

`deleteEntry`（290-336行）を書き換える:

```ts
const deleteEntry = async (node: FileTreeNode): Promise<void> => {
  const message =
    node.type === 'directory'
      ? `「${node.name}」を削除しますか？中身もすべて削除されます。`
      : `「${node.name}」を削除しますか？`
  if (!onConfirm(message)) return
  const affectedAtConfirm = snapshotAffected(node)
  await runFileOperation(async () => {
    const release = await lockPathForFileOperation(node.path, {
      abortMessage:
        node.type === 'directory' ? SAVE_ABORTED_BY_DELETE_DIRECTORY : SAVE_ABORTED_BY_DELETE_FILE
    })
    let affectedBeforeDelete: OpenFile[] = []
    let deleted = false
    try {
      if (!confirmDiscardOfNewEdits(node, affectedAtConfirm)) return false
      affectedBeforeDelete = snapshotAffected(node)
      await fileSystemApi.deleteEntry(node.path)
      deleted = true
    } finally {
      release({ succeeded: deleted })
    }
    invalidatePendingReads(node.path)
    const affectedNow = snapshotAffected(node)
    if (affectedNow.length === 0) return true
    if (confirmDiscardOfNewEdits(node, affectedBeforeDelete, DISCARD_AFTER_DELETE_MESSAGE)) {
      const activePath = getActiveFilePath()
      const activeAffected = activePath !== null && isPathAtOrInside(activePath, node.path)
      setOpenFiles((prev) => prev.filter((f) => !isPathAtOrInside(f.path, node.path)))
      if (activeAffected) resetForFileChange()
    }
    return true
  })
}
```

`renameEntry`（218-288行）を書き換える:

```ts
const renameEntry = (node: FileTreeNode, newName: string): Promise<void> =>
  runFileOperation(async () => {
    const parentPrefix = node.path.slice(0, node.path.length - node.name.length)
    const newPath = joinPath(parentPrefix, newName)
    await runLocked(parentPrefix, () => fileSystemApi.renameEntry(node.path, newName), {
      invalidatesPaths: [
        { path: node.path },
        ...(isSafeEntryName(newName)
          ? [
              {
                path: newPath,
                abortMessage:
                  node.type === 'directory'
                    ? SAVE_ABORTED_BY_RENAME_DESTINATION_DIRECTORY
                    : SAVE_ABORTED_BY_RENAME_DESTINATION_FILE
              }
            ]
          : [])
      ]
    })
    invalidatePendingReads(node.path)
    const activePath = getActiveFilePath()
    const activeAffected = activePath !== null && isPathAtOrInside(activePath, node.path)
    let renamedOccurred = false
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (!isPathAtOrInside(f.path, node.path)) return f
        renamedOccurred = true
        return isSamePath(f.path, node.path)
          ? { ...f, path: newPath, name: newName, language: detectLanguage(newName) }
          : { ...f, path: replacePathPrefix(f.path, node.path, newPath) }
      })
    )
    if (renamedOccurred && activeAffected) {
      resetForFileChange({ renamed: { from: node.path, to: newPath } })
    }
    return true
  })
```

分割代入部分（67-77行の関数引数）に `getOpenFiles`, `setOpenFiles`, `getActiveFilePath` を追加し、`getOpenFile`, `setOpenFile` を削除する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useFileTreeOperations.ts && npx vitest run src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts; git stash pop`
Expected: 新規追加した「複数ファイルへの追随」テストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: このファイル群に起因するエラーなし（`useFileSystem.ts` はまだ Task 1 のシグネチャ変更に追従していないため、その呼び出し箇所でエラーが出るのは想定内。Task 2 で解消する）

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useFileTreeOperations.ts src/renderer/src/hooks/__tests__/useFileTreeOperations.test.ts
git commit -m "$(cat <<'EOF'
refactor: useFileTreeOperationsを複数openFiles配列に対応させる

複数ファイルの同時タブ管理に向けて、削除・リネームの追随ロジックを
単一のopenFileではなく開いている全ファイルの配列に対して適用できる
よう拡張する。
EOF
)"
```

---

### Task 2: `useFileSystem` の状態を `openFiles` 配列 + `activeFilePath` に変更する

**Files:**
- Modify: `src/renderer/src/hooks/useFileSystem.ts`
- Test: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`

**Interfaces:**
- Consumes: Task 1 で変更した `useFileTreeOperations` の新シグネチャ
- Produces: `FileSystemState` に以下を追加する（既存フィールドは維持、`openFile` は後方互換の算出値として残す）:
  ```ts
  interface FileSystemState {
    // ...既存フィールド(folderPath, fileTree, openFile, openedFileSignal, folderLoadError,
    //    isDirty, isSaving, error, saveError, openFolder, selectFile, closeFile,
    //    updateFileContent, saveFile, createFile, createDirectory, renameEntry, deleteEntry)
    //    は変更しない
    openFiles: OpenFile[]
    activeFilePath: string | null
    activateTab: (path: string) => void
    closeTab: (path: string) => void
    reorderTabs: (fromIndex: number, toIndex: number) => void
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useFileSystem.test.ts` の末尾（3003行目の直前、最後の `describe` ブロックの閉じ括弧の外）に以下を追加する:

```ts
describe('複数タブ管理', () => {
  it('新しいファイルを開くと openFiles に追加され、既存タブの内容は保持される', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent
      .mockResolvedValueOnce('const a = 1')
      .mockResolvedValueOnce('const b = 2')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }

    await act(async () => {
      await result.current.selectFile(fileA)
    })
    act(() => result.current.updateFileContent('編集済みA'))
    await act(async () => {
      await result.current.selectFile(fileB)
    })

    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/src/a.ts',
      '/project/src/b.ts'
    ])
    expect(result.current.activeFilePath).toBe('/project/src/b.ts')
    const tabA = result.current.openFiles.find((f) => f.path === '/project/src/a.ts')
    expect(tabA?.content).toBe('編集済みA')
  })

  it('既に開いているファイルを再度選択すると、新規タブを作らずそのタブをアクティブ化する', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent
      .mockResolvedValueOnce('const a = 1')
      .mockResolvedValueOnce('const b = 2')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })
    await act(async () => {
      await result.current.selectFile(fileB)
    })

    await act(async () => {
      await result.current.selectFile(fileA)
    })

    expect(result.current.openFiles).toHaveLength(2)
    expect(result.current.activeFilePath).toBe('/project/src/a.ts')
    expect(mockReadFileContent).toHaveBeenCalledTimes(2)
  })

  it('別ファイルを開いても既存タブが dirty でも確認しない(内容は保持されるため)', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent
      .mockResolvedValueOnce('const a = 1')
      .mockResolvedValueOnce('const b = 2')
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    onConfirm.mockClear()
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })
    act(() => result.current.updateFileContent('編集済みA'))

    await act(async () => {
      await result.current.selectFile(fileB)
    })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('openFolder はいずれかのタブが dirty なら破棄確認する', async () => {
    mockOpenFolder.mockResolvedValueOnce('/project').mockResolvedValueOnce('/other')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValueOnce('const a = 1')
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })
    act(() => result.current.updateFileContent('編集済みA'))
    onConfirm.mockClear()

    await act(async () => {
      await result.current.openFolder()
    })

    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFiles).toEqual([])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "複数タブ管理"`
Expected: FAIL（`openFiles`/`activeFilePath` が undefined 等）

- [ ] **Step 3: `useFileSystem.ts` を実装する**

`src/renderer/src/hooks/useFileSystem.ts` の state 定義（69-101行付近）を書き換える:

```ts
export function useFileSystem(options?: Options): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const latestReadRef = useRef(0)
  const latestDirectoryReadRef = useRef(0)
  const dialogAttemptRef = useRef(0)
  const treeWriteSeqRef = useRef(0)
  const pendingFolderOpenRef = useRef(0)
  const refreshSkippedRef = useRef(false)
  const committedOpenRef = useRef(0)
  const pendingReadPathRef = useRef<string | null>(null)
  // openFiles/activeFilePath の同期ミラー。React state はコミット後にしか読めないため、
  // 「操作の途中で確定した値」を同じ tick 内で参照するために持つ(既存の openFileMirrorRef と同じ理由)
  const openFilesMirrorRef = useRef<OpenFile[]>([])
  const activeFilePathMirrorRef = useRef<string | null>(null)
  const folderPathMirrorRef = useRef<string | null>(null)

  const findFile = (files: OpenFile[], path: string | null): OpenFile | null =>
    path === null ? null : (files.find((f) => isSamePath(f.path, path)) ?? null)

  // useFileEditing へ渡す、アクティブファイルの中身だけを同期的に返す関数
  const getOpenFile = (): OpenFile | null =>
    findFile(openFilesMirrorRef.current, activeFilePathMirrorRef.current)

  // useFileEditing へ渡す唯一の更新経路。アクティブファイルの content/savedContent の
  // 更新のみを行う(null 化や新規追加はこの経路を通らない、closeTab/selectFile が別途行う)
  const commitOpenFile: Dispatch<SetStateAction<OpenFile | null>> = (next) => {
    const activePath = activeFilePathMirrorRef.current
    if (activePath === null) return
    setOpenFiles((prev) => {
      const currentActive = findFile(prev, activePath)
      const value = typeof next === 'function' ? next(currentActive) : next
      if (value === null) return prev
      const nextFiles = prev.map((f) => (isSamePath(f.path, activePath) ? value : f))
      openFilesMirrorRef.current = nextFiles
      return nextFiles
    })
  }

  // openFiles 配列全体を更新する経路(useFileTreeOperations が使う)。更新後、
  // activeFilePath が配列から消えていたら隣接タブへ遷移する
  const setOpenFilesAndFixActive = (updater: (prev: OpenFile[]) => OpenFile[]): void => {
    setOpenFiles((prev) => {
      const next = updater(prev)
      openFilesMirrorRef.current = next
      const activePath = activeFilePathMirrorRef.current
      if (activePath !== null && findFile(next, activePath) === null) {
        const prevIndex = prev.findIndex((f) => isSamePath(f.path, activePath))
        const fallback = computeAdjacentPath(prev, next, prevIndex)
        activeFilePathMirrorRef.current = fallback
        setActiveFilePath(fallback)
      }
      return next
    })
  }
```

`useFileSystem.ts` の先頭 import に `isSamePath` を追加する（既に `isPathAtOrInside, toComparablePath` は import 済み、5行目）。

ファイル末尾付近（この関数の外、モジュールスコープ）に隣接タブ計算のヘルパーを追加する:

```ts
// 配列から要素が消えたとき、消えた要素があった位置を基準に次にアクティブにする
// タブの path を返す。右隣を優先し、無ければ左隣、どちらも無ければ null
// (右優先はエディタタブの一般的な挙動に合わせる)
function computeAdjacentPath(
  prev: OpenFile[],
  next: OpenFile[],
  removedIndex: number
): string | null {
  if (removedIndex === -1) return next[0]?.path ?? null
  if (removedIndex < next.length) return next[removedIndex].path
  if (removedIndex - 1 >= 0 && removedIndex - 1 < next.length) return next[removedIndex - 1].path
  return next[next.length - 1]?.path ?? null
}
```

`useFileEditing` への呼び出し（132-145行付近）を次のように変更する:

```ts
  const {
    isDirty,
    isSaving,
    saveError,
    updateFileContent,
    saveFile,
    resetForFileChange,
    confirmDiscardIfDirty,
    lockPathForFileOperation,
    pendingSaveFor,
    saveCompletionsFor
  } = useFileEditing(getOpenFile(), commitOpenFile, { ...options, getOpenFile })
```

（第一引数は今までの `openFile` state ではなく `getOpenFile()` の呼び出し結果にする。レンダーのたびに `getOpenFile()` を呼ぶことで、常に最新の `openFilesMirrorRef`/`activeFilePathMirrorRef` を反映したアクティブファイルを渡せる。）

`snapshotBuffer`（157-161行）はアクティブファイル基準のままでよいが、`openFileMirrorRef.current` への参照を `getOpenFile()` に置き換える。

`useFileTreeOperations` への呼び出し（180-227行）を Task 1 の新シグネチャに合わせて変更する:

```ts
  const {
    fileTree,
    setFileTree,
    error,
    setError,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshTree
  } = useFileTreeOperations({
    getFolderPath: () => folderPathMirrorRef.current,
    getOpenFiles: () => openFilesMirrorRef.current,
    setOpenFiles: setOpenFilesAndFixActive,
    getActiveFilePath: () => activeFilePathMirrorRef.current,
    resetForFileChange,
    onConfirm,
    beginTreeWrite: () => { /* 既存のまま */ ... },
    lockPathForFileOperation,
    reportTreeLoad: (loadError) => setFolderLoadError(loadError),
    invalidatePendingReads: (affectedPath: string) => { /* 既存のまま */ ... }
  })
```

（`beginTreeWrite`, `invalidatePendingReads` の中身は既存のまま変更しない。）

`openFolder`（229-348行）内の破棄確認を全タブ対象に変更する。まず先頭付近に「全タブの中に dirty なものがあるか」を判定するヘルパーを追加する:

```ts
  const hasAnyDirtyTab = (): boolean =>
    openFilesMirrorRef.current.some((f) => f.content !== f.savedContent)

  const confirmDiscardAnyDirty = (): boolean => !hasAnyDirtyTab() || onConfirm(DISCARD_CONFIRM_MESSAGE)
```

(`DISCARD_CONFIRM_MESSAGE` は `useFileEditing.ts` にしか export されていないため、`useFileEditing.ts` の該当行 `const DISCARD_CONFIRM_MESSAGE = '保存されていない変更があります。破棄して続行しますか？'`(30行目) を `export const` に変更し、`useFileSystem.ts` から import する。)

`openFolder` 冒頭の `if (!confirmDiscardIfDirty()) return` を `if (!confirmDiscardAnyDirty()) return` に置き換える。同様に、待機後の再確認 `if (!confirmDiscardIfChangedSince(snapshot)) return` 系の呼び出し（290行, 316行）はアクティブファイル1つの変化を見るものなので、`openFolder` の文脈では「フォルダを切り替える＝全タブを閉じる」という操作の待機中に増えた dirty を見るべき。`confirmDiscardIfChangedSince` の定義（167-176行）の比較対象を `snapshotBuffer()` ではなく `hasAnyDirtyTab()` を使うよう調整する:

```ts
  const confirmDiscardChangedSinceOpenFolder = (dirtyAtStart: boolean): boolean => {
    const dirtyNow = hasAnyDirtyTab()
    if (dirtyNow === dirtyAtStart) return true
    return confirmDiscardAnyDirty()
  }
```

`openFolder` 内の `snapshot = snapshotBuffer()`（246行, 264行）を `dirtyAtStart = hasAnyDirtyTab()` に、`confirmDiscardIfChangedSince(snapshot)` の呼び出し（290行, 316行）を `confirmDiscardChangedSinceOpenFolder(dirtyAtStart)` に置き換える。`commitOpenFile(null)` の呼び出し（291行, 318行）は `setOpenFilesAndFixActive(() => [])` と `activeFilePathMirrorRef.current = null; setActiveFilePath(null)` に置き換える。

`selectFile`（352-432行）を書き換える。冒頭の `if (!confirmDiscardIfDirty()) return false` を削除する（複数タブ化により不要）。既存タブの再アクティブ化を追加する:

```ts
  const selectFile = async (node: FileTreeNode, options?: SelectFileOptions): Promise<boolean> => {
    if (node.type !== 'file') return false
    const fileNode = node as FileNode
    const existing = findFile(openFilesMirrorRef.current, fileNode.path)
    if (existing !== null) {
      activeFilePathMirrorRef.current = fileNode.path
      setActiveFilePath(fileNode.path)
      resetForFileChange()
      setOpenedFileSignal((prev) => {
        const nextId = ++openedFileEventSeqRef.current
        const openedKey = toComparablePath(fileNode.path)
        return {
          events: [
            ...prev.events.filter((event) => toComparablePath(event.path) !== openedKey),
            { id: nextId, path: fileNode.path, moveFocusToEditor: options?.moveFocusToEditor === true }
          ].slice(-MAX_OPENED_FILE_EVENTS)
        }
      })
      return true
    }
    setError(null)
    const readId = ++latestReadRef.current
    pendingReadPathRef.current = fileNode.path
    try {
      // (365-397行の読み込み・競合待ちループは変更なし、そのまま残す)
      // ...
      // 401行の confirmDiscardIfChangedSince(snapshot) 呼び出しは削除する
      // (新規タブ追加は既存タブを破棄しないため確認不要)
      setOpenFilesAndFixActive((prev) => [...prev, createOpenFile(fileNode, content)])
      activeFilePathMirrorRef.current = fileNode.path
      setActiveFilePath(fileNode.path)
      resetForFileChange()
      committedOpenRef.current += 1
      // (信号更新は既存のまま)
      return true
    } catch (err) {
      // 既存のまま
    } finally {
      // 既存のまま
    }
  }
```

（読み込み中の競合待ちループ370-397行、およびエラーハンドリング425-431行はそのまま維持する。`snapshot = snapshotBuffer()`（360行）と `confirmDiscardIfChangedSince(snapshot)`（400行）の呼び出しのみ削除する。）

`closeFile`/`closeTab`/`activateTab`/`reorderTabs` を追加する（`closeTab`/`reorderTabs` の本体実装は Task 3/4 で行う。ここでは `closeFile` を `closeTab` ベースに再実装するところまで):

```ts
  const activateTab = (path: string): void => {
    if (findFile(openFilesMirrorRef.current, path) === null) return
    activeFilePathMirrorRef.current = path
    setActiveFilePath(path)
    resetForFileChange()
  }

  const closeTab = (path: string): void => {
    // Task 3 で実装する
  }

  const reorderTabs = (fromIndex: number, toIndex: number): void => {
    // Task 4 で実装する
  }

  const closeFile = (): void => {
    const activePath = activeFilePathMirrorRef.current
    if (activePath === null) return
    closeTab(activePath)
  }
```

最後に return オブジェクトに `openFiles, activeFilePath, activateTab, closeTab, reorderTabs` を追加する。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts`
Expected: 新規追加した「複数タブ管理」テストは PASS。既存テストのうち、以下は仕様変更により FAIL する想定なので、このタイミングで対応する:
  - 「読み込み中に入った未保存の編集を確認なしで破棄しない」テスト（410-450行付近）: 複数タブ化で `selectFile` は既存タブを破棄しなくなったため、このシナリオ自体が発生しない。テストを削除する。
  - 同様に `selectFile` 呼び出し前に `confirmDiscardIfDirty` が呼ばれることを検証している箇所があれば、grep で `selectFile` 呼び出し直前の `onConfirm` 検証を洗い出し、「新規タブとして追加され、確認は呼ばれない」という新仕様のアサーションに書き換える。
  - `result.current.openFile` を直接見ているテスト（多数）は、`openFile` を後方互換の算出値として残しているため無改修で通る想定。実行結果を見て、通らないものだけ個別に修正する。

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useFileSystem.ts && npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "複数タブ管理"; git stash pop`
Expected: FAIL

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: PASS（`closeTab`/`reorderTabs` は空実装だが型は満たしているため通る）

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts src/renderer/src/hooks/useFileEditing.ts
git commit -m "$(cat <<'EOF'
feat: useFileSystemを複数ファイルの同時オープンに対応させる

openFile単一値からopenFiles配列+activeFilePathへ拡張し、既に開いて
いるファイルの再選択では新規タブを作らずアクティブ化するようにする。
フォルダ切り替え時の破棄確認は開いている全タブを対象にする。
EOF
)"
```

---

### Task 3: `closeTab` を実装する（隣接タブへの遷移・破棄確認）

**Files:**
- Modify: `src/renderer/src/hooks/useFileSystem.ts`
- Test: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`

**Interfaces:**
- Consumes: Task 2 の `computeAdjacentPath`, `setOpenFilesAndFixActive`, `openFilesMirrorRef`, `activeFilePathMirrorRef`
- Produces: `closeTab(path: string): void`（`FileSystemState` に既に型として追加済み、Task 2 では空実装だった）

- [ ] **Step 1: 失敗するテストを書く**

`useFileSystem.test.ts` の「複数タブ管理」describe 内に追加する:

```ts
  it('closeTab: dirty でないタブは確認せずに閉じ、アクティブなら右隣のタブに切り替わる', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent
      .mockResolvedValueOnce('const a = 1')
      .mockResolvedValueOnce('const b = 2')
      .mockResolvedValueOnce('const c = 3')
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
    const fileC: FileTreeNode = { name: 'c.ts', path: '/project/src/c.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })
    await act(async () => {
      await result.current.selectFile(fileB)
    })
    await act(async () => {
      await result.current.selectFile(fileC)
    })
    act(() => result.current.activateTab('/project/src/b.ts'))
    onConfirm.mockClear()

    act(() => result.current.closeTab('/project/src/b.ts'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/src/a.ts',
      '/project/src/c.ts'
    ])
    expect(result.current.activeFilePath).toBe('/project/src/c.ts')
  })

  it('closeTab: 最後のタブを閉じるとアクティブファイルが null になる(Welcome表示)', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValueOnce('const a = 1')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })

    act(() => result.current.closeTab('/project/src/a.ts'))

    expect(result.current.openFiles).toEqual([])
    expect(result.current.activeFilePath).toBeNull()
  })

  it('closeTab: dirty なタブを閉じようとすると確認し、拒否されたら閉じない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValueOnce('const a = 1')
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileA)
    })
    act(() => result.current.updateFileContent('編集済み'))

    act(() => result.current.closeTab('/project/src/a.ts'))

    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFiles).toHaveLength(1)
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "closeTab"`
Expected: FAIL（`closeTab` が空実装のため何も起きない）

- [ ] **Step 3: `closeTab` を実装する**

`useFileSystem.ts` の `closeTab` を次のように実装する:

```ts
  const closeTab = (path: string): void => {
    const target = findFile(openFilesMirrorRef.current, path)
    if (target === null) return
    if (target.content !== target.savedContent && !onConfirm(DISCARD_CONFIRM_MESSAGE)) return
    // 閉じたあとに保留中の読み込みが解決してファイルが再表示されるのを防ぐ
    if (pendingReadPathRef.current !== null && isSamePath(pendingReadPathRef.current, path)) {
      latestReadRef.current += 1
    }
    setOpenFilesAndFixActive((prev) => prev.filter((f) => !isSamePath(f.path, path)))
    if (isSamePath(activeFilePathMirrorRef.current ?? '', path) === false) return
    resetForFileChange()
  }
```

`DISCARD_CONFIRM_MESSAGE` は Task 2 で `useFileEditing.ts` から export 済みのものを import する。

（`isSamePath(activeFilePathMirrorRef.current ?? '', path) === false` の判定は、`setOpenFilesAndFixActive` 実行後に `activeFilePathMirrorRef.current` が変わっているかどうかを見て、変わっていれば(＝閉じたタブがアクティブだった) `resetForFileChange()` を呼ぶという意図。ただしこれは `setOpenFilesAndFixActive` 呼び出し前に判定すべきなので、次のように直す:)

```ts
  const closeTab = (path: string): void => {
    const target = findFile(openFilesMirrorRef.current, path)
    if (target === null) return
    if (target.content !== target.savedContent && !onConfirm(DISCARD_CONFIRM_MESSAGE)) return
    const wasActive = isSamePath(activeFilePathMirrorRef.current ?? '', path)
    if (wasActive && pendingReadPathRef.current !== null && isSamePath(pendingReadPathRef.current, path)) {
      latestReadRef.current += 1
    }
    setOpenFilesAndFixActive((prev) => prev.filter((f) => !isSamePath(f.path, path)))
    if (wasActive) resetForFileChange()
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useFileSystem.ts && npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "closeTab"; git stash pop`
Expected: FAIL

- [ ] **Step 6: 型チェック・全テスト**

Run: `npm run typecheck && npx vitest run src/renderer/src/hooks`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts
git commit -m "$(cat <<'EOF'
feat: タブを閉じたとき隣接タブへ切り替わるcloseTabを実装する

閉じるタブがdirtyな場合は破棄確認を行い、アクティブタブを閉じた
場合は右隣、無ければ左隣のタブへ遷移する。
EOF
)"
```

---

### Task 4: `reorderTabs` を実装する（dnd-kit 対応）

**Files:**
- Modify: `src/renderer/src/hooks/useFileSystem.ts`
- Test: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`

**Interfaces:**
- Consumes: `@dnd-kit/sortable` の `arrayMove`（既存依存、`usePrompts.ts` と同じ import）
- Produces: `reorderTabs(fromIndex: number, toIndex: number): void`

- [ ] **Step 1: 失敗するテストを書く**

```ts
  it('reorderTabs: タブの並び順を入れ替える', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent
      .mockResolvedValueOnce('const a = 1')
      .mockResolvedValueOnce('const b = 2')
      .mockResolvedValueOnce('const c = 3')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    for (const name of ['a', 'b', 'c']) {
      await act(async () => {
        await result.current.selectFile({
          name: `${name}.ts`,
          path: `/project/src/${name}.ts`,
          type: 'file'
        })
      })
    }

    act(() => result.current.reorderTabs(0, 2))

    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/src/b.ts',
      '/project/src/c.ts',
      '/project/src/a.ts'
    ])
    // アクティブファイルは変わらない
    expect(result.current.activeFilePath).toBe('/project/src/c.ts')
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "reorderTabs"`
Expected: FAIL

- [ ] **Step 3: `reorderTabs` を実装する**

`useFileSystem.ts` の先頭 import に `import { arrayMove } from '@dnd-kit/sortable'` を追加し、`reorderTabs` を実装する:

```ts
  const reorderTabs = (fromIndex: number, toIndex: number): void => {
    setOpenFiles((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) {
        return prev
      }
      const next = arrayMove(prev, fromIndex, toIndex)
      openFilesMirrorRef.current = next
      return next
    })
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useFileSystem.ts && npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "reorderTabs"; git stash pop`
Expected: FAIL

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts
git commit -m "$(cat <<'EOF'
feat: タブの並び替えreorderTabsを実装する
EOF
)"
```

---

### Task 5: `useAppState`/`App.tsx` の配線を更新する

**Files:**
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: Task 2-4 で `useFileSystem` に追加された `openFiles`, `activeFilePath`, `activateTab`, `closeTab`, `reorderTabs`
- Produces: `EditorPanel` へ渡す props に `openFiles`, `activeFilePath`, `onActivateTab`, `onCloseTab`, `onReorderTabs` が追加される

このタスクにはユニットテストを追加しない（`App.tsx`/`useAppState.ts` は配線のみで振る舞いテストが無い既存パターンに合わせる）。Task 6-8 の各コンポーネントテストと Task 10 の実機確認でカバーする。

- [ ] **Step 1: `useAppState.ts` の `promptRunner` に渡す `openFile` を確認する**

`src/renderer/src/hooks/useAppState.ts:22` の `promptRunner` は `openFile: fileSystem.openFile` を使っている。`fileSystem.openFile` は Task 2 で「後方互換の算出値（アクティブファイル）」として維持しているため、この行は変更不要。`useAppState` の他の箇所（`quickOpen` への `openFilePath: fileSystem.openFile?.path ?? null`）も同様に変更不要（`fileSystem.openFile` がアクティブファイルを指すため）。

- [ ] **Step 2: `App.tsx` を書き換える**

`App.tsx` の分割代入（9-69行）に `openFiles`, `activeFilePath`, `activateTab`, `closeTab`, `reorderTabs` を追加する（既存の `openFile`, `closeFile` はそのまま残す。`closeFile` は `EditorPanel` の単一ファイル用の閉じるボタンには使わず、Task 8 で `EditorTabs` からの `onCloseTab` に置き換わるため、`App.tsx` から `EditorPanel` への `onCloseFile` prop 自体を削除する）。

`EditorPanel` への呼び出し（128-144行）を次のように変更する:

```tsx
          <EditorPanel
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            isDirty={isDirty}
            isSaving={isSaving}
            saveError={saveError}
            onChangeContent={updateFileContent}
            onSave={saveFile}
            onActivateTab={activateTab}
            onCloseTab={closeTab}
            onReorderTabs={reorderTabs}
            isExecuting={isExecuting}
            result={result}
            streamingText={streamingText}
            executionError={executionError}
            onClearResult={clearResult}
            onCancelExecution={cancelExecution}
            isOverlayOpen={quickOpen.isOpen}
            openedFileSignal={openedFileSignal}
          />
```

`Sidebar` への `openFilePath={openFile?.path ?? null}`（85行）は変更不要（`openFile` は後方互換のアクティブファイル算出値のため引き続き有効）。

- [ ] **Step 3: 型チェック**

Run: `npm run typecheck`
Expected: `EditorPanel` の props 型がまだ Task 6-8 で更新されていないため、このタイミングでは型エラーが出る想定。Task 8 完了後に解消されることを確認すればよい（このタスク単体では `tsc --noEmit` の関連エラーをメモしておき、次のタスクに進む）。

- [ ] **Step 4: コミット**

Task 5 は Task 8（`EditorPanel` 更新）と型的に密結合のため、コミットは Task 8 の完了後にまとめて行う。このタスクの変更はワーキングツリーに残したまま Task 6 に進む。

---

### Task 6: `EditorTab` をタブ配列の1要素用に書き換える

**Files:**
- Modify: `src/renderer/src/components/editor/EditorTab.tsx`
- Test: `src/renderer/src/components/editor/__tests__/EditorTab.test.tsx`

**Interfaces:**
- Consumes: `@dnd-kit/sortable` の `useSortable`, `@dnd-kit/utilities` の `CSS`（`PromptItem.tsx` と同じ使い方）
- Produces:
  ```ts
  interface Props {
    path: string
    fileName: string
    isDirty: boolean
    isActive: boolean
    onActivate: () => void
    onClose: () => void
  }
  ```

- [ ] **Step 1: 既存テストを読み、新 Props に合わせて書き換える**

`src/renderer/src/components/editor/__tests__/EditorTab.test.tsx`（74行）を読み、`fileName`/`isDirty`/`onClose` を渡している箇所に `path`, `isActive`, `onActivate` を追加する。クリックでアクティブ化するテストと、`role="tab"`/`aria-selected` を検証するテストを追加する:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { DndContext } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import EditorTab from '../EditorTab'

// useSortable は DndContext/SortableContext の中でのみ使えるため、テストでもラップする
function renderTab(props: Partial<React.ComponentProps<typeof EditorTab>> = {}) {
  const defaultProps: React.ComponentProps<typeof EditorTab> = {
    path: '/project/index.ts',
    fileName: 'index.ts',
    isDirty: false,
    isActive: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    ...props
  }
  return render(
    <DndContext>
      <SortableContext items={[defaultProps.path]}>
        <EditorTab {...defaultProps} />
      </SortableContext>
    </DndContext>
  )
}

describe('EditorTab', () => {
  it('role="tab" と aria-selected でアクティブ状態を表す', () => {
    renderTab({ isActive: true })
    expect(screen.getByRole('tab', { name: /index\.ts/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('非アクティブなタブは aria-selected が false', () => {
    renderTab({ isActive: false })
    expect(screen.getByRole('tab', { name: /index\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('タブをクリックすると onActivate が呼ばれる', async () => {
    const onActivate = vi.fn()
    renderTab({ onActivate })
    await userEvent.click(screen.getByRole('tab', { name: /index\.ts/ }))
    expect(onActivate).toHaveBeenCalledOnce()
  })

  it('未保存の変更があるとき、ダーティインジケータを表示する', () => {
    renderTab({ isDirty: true })
    expect(screen.getByLabelText('未保存の変更があります')).toBeInTheDocument()
  })

  it('閉じるボタンをクリックすると onClose が呼ばれ、onActivate は呼ばれない', async () => {
    const onClose = vi.fn()
    const onActivate = vi.fn()
    renderTab({ onClose, onActivate })
    await userEvent.click(screen.getByLabelText('タブを閉じる'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
```

（既存の `EditorTab.test.tsx` の内容をこの内容で置き換える。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/editor/__tests__/EditorTab.test.tsx`
Expected: FAIL（`role="tab"` が存在しない、`isActive`/`onActivate` props が使われていない）

- [ ] **Step 3: `EditorTab.tsx` を実装する**

```tsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  path: string
  fileName: string
  isDirty: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}

export default function EditorTab({ path, fileName, isDirty, isActive, onActivate, onClose }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={`editor-tab${isActive ? ' editor-tab--active' : ''}`}
      onClick={onActivate}
    >
      {fileName}
      {isDirty && (
        <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
          ●
        </span>
      )}
      <button
        type="button"
        className="editor-tab__close-btn"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="タブを閉じる"
      >
        ×
      </button>
    </div>
  )
}
```

（`onClose` はクリックで必ず呼べるよう `?` を外し必須にする。閉じるボタンには `e.stopPropagation()` を入れて `onActivate` が誤発火しないようにする。ドラッグハンドルは要素全体にする — CLAUDE.md の「ドラッグハンドルとスワイプの競合防止」ルールはスワイプジェスチャーとの競合を防ぐためのものでタブUIには該当しないため、`onTouchStartCapture`/`onMouseDownCapture` は不要。）

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/editor/__tests__/EditorTab.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/editor/EditorTab.tsx && npx vitest run src/renderer/src/components/editor/__tests__/EditorTab.test.tsx; git stash pop`
Expected: FAIL

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `EditorTabs.tsx`(Task 7で更新)からの呼び出しがまだ古い Props のためエラーが出る想定。Task 7 完了後に解消することを確認すればよい。

- [ ] **Step 7: コミットは Task 7 とまとめて行う**

`EditorTab` 単体では `EditorTabs` から呼ばれる構造上、中間状態でのコミットは避け、Task 7 完了後にまとめてコミットする。

---

### Task 7: `EditorTabs` をタブ配列 + dnd-kit 並び替え対応にする

**Files:**
- Modify: `src/renderer/src/components/editor/EditorTabs.tsx`
- Test: `src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx`

**Interfaces:**
- Consumes: Task 6 の `EditorTab` の新 Props、`@dnd-kit/core` の `DndContext`/`closestCenter`/`PointerSensor`/`KeyboardSensor`/`useSensor`/`useSensors`、`@dnd-kit/sortable` の `SortableContext`/`horizontalListSortingStrategy`/`sortableKeyboardCoordinates`
- Produces:
  ```ts
  interface Props {
    tabs: { path: string; name: string; isDirty: boolean }[]
    activePath: string | null
    isSaving: boolean
    saveError: Error | null
    onActivateTab: (path: string) => void
    onCloseTab: (path: string) => void
    onReorderTabs: (fromIndex: number, toIndex: number) => void
    onSave: () => void
  }
  ```
  （`EditorSaveControl` へ渡す `isDirty` は「アクティブタブの isDirty」を `tabs`/`activePath` から算出する）

- [ ] **Step 1: 既存テストを新 Props に合わせて書き換える**

`src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx`（66行）を読み、次の内容に置き換える:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import EditorTabs from '../EditorTabs'

function renderTabs(propsOverride: Partial<React.ComponentProps<typeof EditorTabs>> = {}) {
  const props: React.ComponentProps<typeof EditorTabs> = {
    tabs: [
      { path: '/project/a.ts', name: 'a.ts', isDirty: false },
      { path: '/project/b.ts', name: 'b.ts', isDirty: true }
    ],
    activePath: '/project/a.ts',
    isSaving: false,
    saveError: null,
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onReorderTabs: vi.fn(),
    onSave: vi.fn(),
    ...propsOverride
  }
  return render(<EditorTabs {...props} />)
}

describe('EditorTabs', () => {
  it('role="tablist" のもとで、開いている全タブを表示する', () => {
    renderTabs()
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^a\.ts/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^b\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })

  it('タブをクリックすると onActivateTab がそのタブの path で呼ばれる', async () => {
    const onActivateTab = vi.fn()
    renderTabs({ onActivateTab })
    await userEvent.click(screen.getByRole('tab', { name: /^b\.ts/ }))
    expect(onActivateTab).toHaveBeenCalledWith('/project/b.ts')
  })

  it('タブの閉じるボタンをクリックすると onCloseTab がそのタブの path で呼ばれる', async () => {
    const onCloseTab = vi.fn()
    renderTabs({ onCloseTab })
    const tabA = screen.getByRole('tab', { name: /^a\.ts/ })
    await userEvent.click(within(tabA).getByLabelText('タブを閉じる'))
    expect(onCloseTab).toHaveBeenCalledWith('/project/a.ts')
  })

  it('アクティブタブの isDirty に基づいて保存ボタンの活性状態が決まる', () => {
    renderTabs({
      tabs: [{ path: '/project/a.ts', name: 'a.ts', isDirty: true }],
      activePath: '/project/a.ts'
    })
    expect(screen.getByLabelText('保存')).toBeEnabled()
  })

  it('保存エラーがあれば表示する', () => {
    renderTabs({ saveError: new Error('保存に失敗しました') })
    expect(screen.getByRole('alert')).toHaveTextContent('保存に失敗しました')
  })
})
```

（`within` を使うため `import { render, screen, within } from '@testing-library/react'` に修正する。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx`
Expected: FAIL

- [ ] **Step 3: `EditorTabs.tsx` を実装する**

```tsx
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy
} from '@dnd-kit/sortable'
import EditorTab from './EditorTab'
import EditorSaveControl from './EditorSaveControl'

interface Tab {
  path: string
  name: string
  isDirty: boolean
}

interface Props {
  tabs: Tab[]
  activePath: string | null
  isSaving: boolean
  saveError: Error | null
  onActivateTab: (path: string) => void
  onCloseTab: (path: string) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onSave: () => void
}

export default function EditorTabs({
  tabs,
  activePath,
  isSaving,
  saveError,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  onSave
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const activeTab = tabs.find((t) => t.path === activePath) ?? null
  const isDirty = activeTab?.isDirty ?? false

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (!over || active.id === over.id) return
    const fromIndex = tabs.findIndex((t) => t.path === active.id)
    const toIndex = tabs.findIndex((t) => t.path === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    onReorderTabs(fromIndex, toIndex)
  }

  return (
    <div className="editor-tabs">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.path)} strategy={horizontalListSortingStrategy}>
          <div className="editor-tabs__list" role="tablist">
            {tabs.map((tab) => (
              <EditorTab
                key={tab.path}
                path={tab.path}
                fileName={tab.name}
                isDirty={tab.isDirty}
                isActive={tab.path === activePath}
                onActivate={() => onActivateTab(tab.path)}
                onClose={() => onCloseTab(tab.path)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <EditorSaveControl
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        onSave={onSave}
      />
    </div>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx src/renderer/src/components/editor/__tests__/EditorTab.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/editor/EditorTabs.tsx src/renderer/src/components/editor/EditorTab.tsx && npx vitest run src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx; git stash pop`
Expected: FAIL

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `EditorPanel.tsx`（Task 8 で更新）からの呼び出しがまだ古い Props のためエラーが出る想定

---

### Task 8: `EditorPanel` をアクティブタブのみ Monaco レンダーする形に更新する

**Files:**
- Modify: `src/renderer/src/components/EditorPanel.tsx`
- Test: `src/renderer/src/components/__tests__/EditorPanel.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `EditorTabs` の新 Props、Task 2 の `useFileSystem` が返す `openFiles`/`activeFilePath`
- Produces:
  ```ts
  interface Props {
    openFiles: OpenFile[]
    activeFilePath: string | null
    isDirty: boolean
    isSaving: boolean
    saveError: Error | null
    onChangeContent: (content: string) => void
    onSave: () => void
    onActivateTab: (path: string) => void
    onCloseTab: (path: string) => void
    onReorderTabs: (fromIndex: number, toIndex: number) => void
    isExecuting: boolean
    result: string | null
    streamingText: string
    executionError: Error | null
    onClearResult: () => void
    onCancelExecution: () => void
    isOverlayOpen: boolean
    openedFileSignal: OpenedFileSignal
  }
  ```
  （`openFile: OpenFile | null` は `openFiles.find(f => f.path === activeFilePath) ?? null` として内部で算出する。`onCloseFile` は `onCloseTab` に置き換わる。）

- [ ] **Step 1: 既存テストを新 Props に合わせて書き換える**

`src/renderer/src/components/__tests__/EditorPanel.test.tsx`（512行）を読み、`openFile: OpenFile | null` を渡している箇所を `openFiles: OpenFile[]` + `activeFilePath: string | null` に置き換える（例えば `openFile: someFile` となっている箇所は `openFiles: [someFile], activeFilePath: someFile.path` に、`openFile: null` は `openFiles: [], activeFilePath: null` に機械的に置換する）。`onCloseFile: vi.fn()` を渡している箇所は `onCloseTab: vi.fn()`、新規に `onActivateTab: vi.fn()`, `onReorderTabs: vi.fn()` をデフォルト props に追加する。

このファイル末尾に、複数タブが Monaco の再マウントに影響しないことを検証するテストを追加する:

```tsx
  it('非アクティブなタブのファイルは Monaco にレンダーされない', () => {
    const fileA = { path: '/a.ts', name: 'a.ts', content: 'a', savedContent: 'a', language: 'typescript' }
    const fileB = { path: '/b.ts', name: 'b.ts', content: 'b', savedContent: 'b', language: 'typescript' }
    renderPanel({ openFiles: [fileA, fileB], activeFilePath: fileA.path })
    expect(screen.getByRole('tab', { name: /^a\.ts/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^b\.ts/ })).toHaveAttribute('aria-selected', 'false')
  })
```

（`renderPanel` ヘルパーの引数の型は既存テストファイルの定義に合わせて調整する。Monaco 自体はテストでモック化されている前提のため、既存の `vi.mock('@monaco-editor/react', ...)` のモック実装を確認し、`openFile`/`content` prop を見ているモックがあれば `openFiles`/`activeFilePath` から算出したアクティブファイルを見るよう合わせて調整する。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: `EditorPanel.tsx` を実装する**

`EditorPanel.tsx` の `Props` インターフェース（13-31行）を上記の新シグネチャに変更する。関数本体冒頭で:

```tsx
export default function EditorPanel({
  openFiles,
  activeFilePath,
  isDirty,
  isSaving,
  saveError,
  onChangeContent,
  onSave,
  onActivateTab,
  onCloseTab,
  onReorderTabs,
  isExecuting,
  result,
  streamingText,
  executionError,
  onClearResult,
  onCancelExecution,
  isOverlayOpen,
  openedFileSignal
}: Props) {
  const openFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  // 以下、既存の onSaveRef, editorRef, openFilePath, hasOpenFile 等のロジックは
  // openFile 変数がこの算出値に変わるだけで、実質無改修
  ...
```

JSX 部分（149-197行）の `EditorTabs` 呼び出しを次のように変更する:

```tsx
          <EditorTabs
            tabs={openFiles.map((f) => ({ path: f.path, name: f.name, isDirty: f.content !== f.savedContent }))}
            activePath={activeFilePath}
            isSaving={isSaving}
            saveError={saveError}
            onSave={onSave}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
            onReorderTabs={onReorderTabs}
          />
```

`isDirty` prop（EditorPanel自体が受け取るもの、13-31行のProps定義にある既存のisDirty）はそのままアクティブファイルの状態を表す既存の値として残し、Monaco の `<Editor>` 部分は変更しない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: `App.tsx` の型エラーを解消する**

Task 5 で更新した `App.tsx` の `EditorPanel` 呼び出しの props 名を、この Task で確定した Props 名（`onActivateTab`, `onCloseTab`, `onReorderTabs`）に合わせて確認・修正する。

- [ ] **Step 6: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/EditorPanel.tsx && npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx; git stash pop`
Expected: FAIL

- [ ] **Step 7: 型チェック・全テストスイート実行**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テストPASS。Task 2 の Step 4 で洗い出した「仕様変更で削除・書き換えが必要な既存テスト」がまだ残っていればここで最終的に解消する。

- [ ] **Step 8: コミット（Task 5-8 まとめて）**

```bash
git add -u src/renderer/src/App.tsx src/renderer/src/hooks/useAppState.ts \
  src/renderer/src/components/EditorPanel.tsx src/renderer/src/components/__tests__/EditorPanel.test.tsx \
  src/renderer/src/components/editor/EditorTabs.tsx src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx \
  src/renderer/src/components/editor/EditorTab.tsx src/renderer/src/components/editor/__tests__/EditorTab.test.tsx
git commit -m "$(cat <<'EOF'
feat: 複数ファイルタブのUIをタブ配列とドラッグ並び替えに対応させる

EditorTabs/EditorTabをopenFiles配列+activeFilePathベースに書き換え、
dnd-kitでタブの並び替えに対応する。EditorPanelはアクティブタブの
ファイルのみMonacoでレンダーする。
EOF
)"
```

---

### Task 9: 全体テスト・型チェックの最終確認

**Files:** なし（既存ファイルの検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 2: 全テストスイート実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 3: 変更したファイルへの ESLint 実行**

Run: `npx eslint src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/useFileTreeOperations.ts src/renderer/src/hooks/useFileEditing.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/components/EditorPanel.tsx src/renderer/src/components/editor/EditorTabs.tsx src/renderer/src/components/editor/EditorTab.tsx`
Expected: エラーなし

- [ ] **Step 4: 未使用コードの確認**

`useFileEditing.ts` の `confirmDiscardIfDirty`（アクティブファイル単体用）が `useFileSystem.ts` のどこからも呼ばれなくなっていないか確認する（`openFolder` は `confirmDiscardAnyDirty` に置き換わり、`selectFile` からは呼び出しを削除したため、`closeTab`/`closeFile` からのみ使われる想定と異なる実装になっていないかを確認する）。もし `confirmDiscardIfDirty` がどこからも呼ばれていなければ、`useFileEditing.ts` の公開 API から削除する（YAGNI）。ただし Task 3 の `closeTab` は自前で dirty 判定 (`target.content !== target.savedContent`) を行い `onConfirm` を直接呼ぶ実装にしたため、`confirmDiscardIfDirty` 自体が不要になっている可能性が高い。不要なら削除し、関連テスト（`useFileEditing.test.ts` の `confirmDiscardIfDirty` describe ブロック）も削除する。

- [ ] **Step 5: コミット（クリーンアップがあれば）**

```bash
git add -u
git commit -m "$(cat <<'EOF'
refactor: 複数タブ対応で不要になったconfirmDiscardIfDirtyを整理する
EOF
)"
```

（Step 4 で削除対象が無ければ、このコミットはスキップする。）

---

### Task 10: Electron 実機での動作確認

**Files:** なし

- [ ] **Step 1: アプリを起動する**

Run: `npm run dev`（または `run` スキルを使って起動）

- [ ] **Step 2: 複数タブの追加を確認する**

エクスプローラーで2つ以上の異なるファイルをクリックし、タブが追加されていくことを目視確認する。

- [ ] **Step 3: タブ切り替えと編集内容の保持を確認する**

タブAで編集(未保存)→タブBに切り替え→タブAに戻り、編集内容が保持されていることを確認する。

- [ ] **Step 4: タブのクローズを確認する**

dirtyでないタブの×ボタンでの即クローズ、dirtyなタブの×ボタンでの確認ダイアログ表示を確認する。

- [ ] **Step 5: タブの並び替えを確認する**

タブをドラッグして順番を入れ替えられることを確認する。

- [ ] **Step 6: 既存タブの再クリックでの挙動を確認する**

既に開いているファイルをエクスプローラーで再度クリックし、新規タブが増えずそのタブがアクティブになることを確認する。

- [ ] **Step 7: 外部削除への追随を確認する**

非アクティブタブのファイルを、OSのファイラ等アプリ外から削除し、アプリ内のツリーの自動更新（または手動リフレッシュ）後にそのタブがどう扱われるか確認する（設計上は、削除操作がアプリ内の `deleteEntry` を経由した場合のみ確認・追随が働く。アプリ外からの削除はツリー再読み込み時にファイルツリーから消えるだけで、開いているタブ自体は残る可能性がある — これは既存の単一ファイル実装でも同じ挙動であり、本機能追加でのスコープ外。矛盾する挙動が見つかった場合はメモしてユーザーに報告する）。

- [ ] **Step 8: アプリを停止する**

検証が終わったら、起動した Electron 本体と dev サーバーを停止する。`pgrep -fl` で対象プロセスを確認してから `pkill -f`（リポジトリ名を含むパターンを使う）で停止する。

- [ ] **Step 9: 動作確認結果をユーザーに報告する**

問題があれば修正タスクを追加し、無ければ完了として報告する。
