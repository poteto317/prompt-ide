# Git ステージ→コミット基本フロー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース管理パネルから、ファイル単位でのステージ/アンステージとコミット（メッセージ入力）ができるようにする。

**Architecture:** 既存の `gitService.ts`（simple-git）・IPC配線パターン（`gitHandlers.ts` → `preload/api.ts` → `renderer/lib/gitApi.ts`）・フォルダ境界チェック（`FolderAccessManager.assertWithinFolder`）をそのまま踏襲する。renderer側は新規フック `useGitOperations` が `useFileEditing.ts` の `savingPaths`（実行中パスの Ref+State 二重管理）と同じパターンで多重実行を防止する。

**Tech Stack:** Electron, React, TypeScript, simple-git（既存依存、追加インストール不要）, Vitest, Testing Library

## Global Constraints

- すべてのコミットメッセージは日本語・Conventional Commit 形式（CLAUDE.md）
- 型としてのみ使う import は `import type` を使う（CLAUDE.md）
- テストは `__tests__/` 同階層配置、Vitest + Testing Library、`describe`/`it` は日本語（既存パターン踏襲）
- `git commit` は各タスクの最後に行うが、ユーザーへの `git push` は行わない
- 各タスク完了時に `npm run typecheck` と対象テストファイルの `npm test` を実行し、パスすることを確認してからコミットする
- ハンク単位のステージ、コミットの amend、変更の破棄（discard）、push/pull/fetch、ブランチ操作、diff 表示、コミット履歴、stash、コンフリクト解決 UI は今回のスコープ外（別途）

---

### Task 1: `gitService.ts` に `stageFile`/`unstageFile`/`commit` を追加する

**Files:**
- Modify: `src/main/gitService.ts`
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function stageFile(folderPath: string, filePath: string): Promise<void>
  export function unstageFile(folderPath: string, filePath: string): Promise<void>
  export function commit(folderPath: string, message: string): Promise<void>
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitService.test.ts` の `mockSimpleGit` を拡張し、`add`/`reset`/`commit` もモックする:

```ts
const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockStatus = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({
    checkIsRepo: mockCheckIsRepo,
    status: mockStatus,
    add: mockAdd,
    reset: mockReset,
    commit: mockCommit,
  }))
)

vi.mock('simple-git', () => ({ default: mockSimpleGit }))

import { getGitStatus, stageFile, unstageFile, commit } from '../gitService'
```

（既存の `import { getGitStatus } from '../gitService'` をこの行に置き換える。）

ファイル末尾に以下を追加する:

```ts
describe('stageFile', () => {
  it('simpleGit を folderPath で呼び、add を filePath で呼ぶ', async () => {
    mockAdd.mockResolvedValue(undefined)
    await stageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockAdd).toHaveBeenCalledWith('src/index.ts')
  })

  it('add が throw した場合エラーが伝播する', async () => {
    mockAdd.mockRejectedValue(new Error('add failed'))
    await expect(stageFile('/project', 'src/index.ts')).rejects.toThrow('add failed')
  })
})

describe('unstageFile', () => {
  it('simpleGit を folderPath で呼び、reset を ["--", filePath] で呼ぶ', async () => {
    mockReset.mockResolvedValue(undefined)
    await unstageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockReset).toHaveBeenCalledWith(['--', 'src/index.ts'])
  })

  it('reset が throw した場合エラーが伝播する', async () => {
    mockReset.mockRejectedValue(new Error('reset failed'))
    await expect(unstageFile('/project', 'src/index.ts')).rejects.toThrow('reset failed')
  })
})

describe('commit', () => {
  it('simpleGit を folderPath で呼び、commit を message で呼ぶ', async () => {
    mockCommit.mockResolvedValue(undefined)
    await commit('/project', 'feat: 新機能を追加する')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 新機能を追加する')
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('commit failed'))
    await expect(commit('/project', 'msg')).rejects.toThrow('commit failed')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: FAIL（`stageFile`/`unstageFile`/`commit` が存在しない）

- [ ] **Step 3: `gitService.ts` に実装を追加する**

```ts
export async function stageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.add(filePath)
}

export async function unstageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.reset(['--', filePath])
}

export async function commit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.commit(message)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/gitService.ts && npx vitest run src/main/__tests__/gitService.test.ts; git stash pop`
Expected: 新規追加した6件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "$(cat <<'EOF'
feat: gitServiceにstageFile/unstageFile/commitを追加する

ソース管理パネルからのステージ・アンステージ・コミット操作に向けて、
simple-gitのadd/reset/commitを薄くラップする関数を追加する。
EOF
)"
```

---

### Task 2: `gitHandlers.ts` に `git:stage`/`git:unstage`/`git:commit` を追加する

**Files:**
- Modify: `src/main/handlers/gitHandlers.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`

**Interfaces:**
- Consumes: Task 1 の `stageFile(folderPath, filePath)` / `unstageFile(folderPath, filePath)` / `commit(folderPath, message)`
- Produces: IPC チャンネル `git:stage`（引数 `filePath: string`）、`git:unstage`（引数 `filePath: string`）、`git:commit`（引数 `message: string`）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts` の冒頭 mock を拡張する:

```ts
const mockHandle = vi.hoisted(() => vi.fn())
const mockGetGitStatus = vi.hoisted(() => vi.fn())
const mockStageFile = vi.hoisted(() => vi.fn())
const mockUnstageFile = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
}))
```

`makeFolderAccess` のデフォルトオブジェクトに `assertWithinFolder: vi.fn()` は既に含まれているので変更不要。ファイル末尾（`describe('registerGitHandlers', ...)` の閉じ括弧の直前）に追加する:

```ts
  describe('git:stage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、stageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が throw した場合、stageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockStageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:unstage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、unstageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が throw した場合、unstageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:commit', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と message を引数に commit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:commit')(makeEvent(1), 'feat: 新機能')
      expect(mockCommit).toHaveBeenCalledWith('/project', 'feat: 新機能')
    })

    it('commit が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockRejectedValue(new Error('commit failed'))
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'commit failed'
      )
    })
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: FAIL（`git:stage`/`git:unstage`/`git:commit` チャンネルが登録されていない）

- [ ] **Step 3: `gitHandlers.ts` に実装を追加する**

`git:commit` は他のファイル操作系ハンドラと違い対象パスを持たないため境界チェック不要（`getAllowedFolder` 相当のシンプルなチェックのみ）。`git:stage`/`git:unstage` はファイルパスを引数に取るため `assertWithinFolder` で境界チェックする。

```ts
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getGitStatus, stageFile, unstageFile, commit } from '../gitService'
import type { FolderAccessManager } from '../folderAccessManager'

export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getGitStatus(allowedFolder)
  })

  ipcMain.handle('git:stage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await folderAccess.assertWithinFolder(allowedFolder, filePath)
    await stageFile(allowedFolder, filePath)
  })

  ipcMain.handle('git:unstage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await folderAccess.assertWithinFolder(allowedFolder, filePath)
    await unstageFile(allowedFolder, filePath)
  })

  ipcMain.handle('git:commit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await commit(allowedFolder, message)
  })
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/handlers/gitHandlers.ts && npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts; git stash pop`
Expected: 新規追加した9件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts
git commit -m "$(cat <<'EOF'
feat: git:stage/git:unstage/git:commitのIPCハンドラを追加する

ファイルパスを扱うstage/unstageはassertWithinFolderで許可フォルダ
配下かを検証してから実行する。
EOF
)"
```

---

### Task 3: preload と `renderer/lib/gitApi.ts` を更新する

**Files:**
- Modify: `src/preload/api.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/gitApi.ts`
- Test: `src/renderer/src/lib/__tests__/gitApi.test.ts`（無ければ新規作成）

**Interfaces:**
- Consumes: Task 2 の IPC チャンネル `git:stage`/`git:unstage`/`git:commit`
- Produces:
  ```ts
  // renderer/lib/gitApi.ts
  export function stageFile(filePath: string): Promise<void>
  export function unstageFile(filePath: string): Promise<void>
  export function commitChanges(message: string): Promise<void>
  ```

- [ ] **Step 1: 既存テストの有無を確認する**

Run: `ls src/renderer/src/lib/__tests__/gitApi.test.ts`

存在すれば読んで既存パターンに倣う。存在しなければ Step 1b でファイルごと新規作成する。

- [ ] **Step 1b: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/gitApi.test.ts`（既存があれば追記、無ければ新規作成）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getGitStatus, stageFile, unstageFile, commitChanges } from '../gitApi'

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      getGitStatus: vi.fn(),
      stageFile: vi.fn(),
      unstageFile: vi.fn(),
      commitChanges: vi.fn(),
    },
  })
})

describe('getGitStatus', () => {
  it('window.api.getGitStatus を呼ぶ', async () => {
    const mockResult = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] }
    ;(window.api.getGitStatus as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult)
    const result = await getGitStatus()
    expect(window.api.getGitStatus).toHaveBeenCalled()
    expect(result).toEqual(mockResult)
  })
})

describe('stageFile', () => {
  it('window.api.stageFile を filePath で呼ぶ', async () => {
    await stageFile('src/index.ts')
    expect(window.api.stageFile).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('unstageFile', () => {
  it('window.api.unstageFile を filePath で呼ぶ', async () => {
    await unstageFile('src/index.ts')
    expect(window.api.unstageFile).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('commitChanges', () => {
  it('window.api.commitChanges を message で呼ぶ', async () => {
    await commitChanges('feat: 新機能')
    expect(window.api.commitChanges).toHaveBeenCalledWith('feat: 新機能')
  })
})
```

もし既存の `gitApi.test.ts` が無く、他の `lib/__tests__/*.test.ts` が `window` のモック方法として別の慣例（例えば `global.window` への直接代入、または既存のテストセットアップファイルでの共通モック）を使っている場合はそちらに合わせる。`src/renderer/src/lib/__tests__/fileSystemApi.test.ts` があれば読んで確認し、モックパターンを揃えること。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts`
Expected: FAIL（`stageFile`/`unstageFile`/`commitChanges` が存在しない）

- [ ] **Step 3: preload と gitApi.ts を実装する**

`src/preload/api.ts` の `getGitStatus` の行の直後に追加:

```ts
  stageFile: (filePath: string): Promise<void> => ipcRenderer.invoke('git:stage', filePath),
  unstageFile: (filePath: string): Promise<void> => ipcRenderer.invoke('git:unstage', filePath),
  commitChanges: (message: string): Promise<void> =>
    ipcRenderer.invoke('git:commit', message),
```

`src/preload/index.d.ts` の `getGitStatus(): Promise<GitStatusResult>` の行の直後に追加:

```ts
      stageFile(filePath: string): Promise<void>
      unstageFile(filePath: string): Promise<void>
      commitChanges(message: string): Promise<void>
```

`src/renderer/src/lib/gitApi.ts` を全体書き換え:

```ts
import type { GitStatusResult } from '@shared/types'

export function getGitStatus(): Promise<GitStatusResult> {
  return window.api.getGitStatus()
}

export function stageFile(filePath: string): Promise<void> {
  return window.api.stageFile(filePath)
}

export function unstageFile(filePath: string): Promise<void> {
  return window.api.unstageFile(filePath)
}

export function commitChanges(message: string): Promise<void> {
  return window.api.commitChanges(message)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/lib/gitApi.ts && npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts; git stash pop`
Expected: 新規追加した3件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts src/renderer/src/lib/__tests__/gitApi.test.ts
git commit -m "$(cat <<'EOF'
feat: preloadとgitApiにstageFile/unstageFile/commitChangesを追加する
EOF
)"
```

---

### Task 4: `useGitOperations` フックを新規作成する

**Files:**
- Create: `src/renderer/src/hooks/useGitOperations.ts`
- Test: `src/renderer/src/hooks/__tests__/useGitOperations.test.ts`

**Interfaces:**
- Consumes: Task 3 の `stageFile(filePath)` / `unstageFile(filePath)` / `commitChanges(message)`（`../lib/gitApi` から import）
- Produces:
  ```ts
  export interface GitOperationsState {
    stagingPaths: ReadonlySet<string>
    stageFile: (path: string) => Promise<void>
    unstageFile: (path: string) => Promise<void>
    isCommitting: boolean
    commit: (message: string) => Promise<boolean>
    operationError: Error | null
  }

  export function useGitOperations(refreshGitStatus: () => Promise<void>): GitOperationsState
  ```
  `commit` は成功時 `true`、失敗時（例外を握りつぶして）`false` を返す。呼び出し元（`CommitSection`、Task 7）はこの戻り値を見てメッセージ入力欄をクリアするかどうかを判断する。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useGitOperations.test.ts` を新規作成:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitOperations } from '../useGitOperations'

const mockStageFile = vi.mocked(gitApi.stageFile)
const mockUnstageFile = vi.mocked(gitApi.unstageFile)
const mockCommitChanges = vi.mocked(gitApi.commitChanges)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stageFile', () => {
  it('gitApi.stageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(mockStageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('実行中は stagingPaths にそのパスを含む', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageFile('src/index.ts')
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(true)

    await act(async () => {
      resolveStage()
      await stagePromise
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(false)
  })

  it('同じパスへの多重呼び出しは stageFile を1回しか呼ばない', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageFile('src/index.ts')
      secondCall = result.current.stageFile('src/index.ts')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([firstCall, secondCall])
    })
    expect(mockStageFile).toHaveBeenCalledTimes(1)
  })

  it('失敗した場合 operationError がセットされ、refreshGitStatus も呼ばれる', async () => {
    mockStageFile.mockRejectedValue(new Error('add failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(result.current.operationError?.message).toBe('add failed')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })
})

describe('unstageFile', () => {
  it('gitApi.unstageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockUnstageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.unstageFile('src/index.ts')
    })

    expect(mockUnstageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })
})

describe('commit', () => {
  it('gitApi.commitChanges を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = false
    await act(async () => {
      commitResult = await result.current.commit('feat: 新機能')
    })

    expect(mockCommitChanges).toHaveBeenCalledWith('feat: 新機能')
    expect(commitResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockCommitChanges.mockRejectedValue(new Error('commit failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = true
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(commitResult).toBe(false)
    expect(result.current.operationError?.message).toBe('commit failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveCommit()
      await commitPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('コミット中の多重呼び出しは commitChanges を1回しか呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = result.current.commit('msg1')
      second = result.current.commit('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([first, second])
    })
    expect(mockCommitChanges).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts`
Expected: FAIL（`useGitOperations` モジュールが存在しない）

- [ ] **Step 3: `useGitOperations.ts` を実装する**

```ts
import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'

export interface GitOperationsState {
  stagingPaths: ReadonlySet<string>
  stageFile: (path: string) => Promise<void>
  unstageFile: (path: string) => Promise<void>
  isCommitting: boolean
  commit: (message: string) => Promise<boolean>
  operationError: Error | null
}

export function useGitOperations(refreshGitStatus: () => Promise<void>): GitOperationsState {
  // useFileEditing.ts の savingPaths と同じパターン。即座に判定できる ref と、
  // 再レンダーを起こすための state を両方持つ
  const [stagingPaths, setStagingPaths] = useState<ReadonlySet<string>>(() => new Set())
  const stagingPathsRef = useRef<Set<string>>(new Set())
  const [isCommitting, setIsCommitting] = useState(false)
  const isCommittingRef = useRef(false)
  const [operationError, setOperationError] = useState<Error | null>(null)

  const runStageOperation = async (
    path: string,
    operation: (path: string) => Promise<void>
  ): Promise<void> => {
    if (stagingPathsRef.current.has(path)) return
    stagingPathsRef.current.add(path)
    setStagingPaths(new Set(stagingPathsRef.current))
    try {
      await operation(path)
      setOperationError(null)
    } catch (err) {
      setOperationError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      stagingPathsRef.current.delete(path)
      setStagingPaths(new Set(stagingPathsRef.current))
      await refreshGitStatus()
    }
  }

  const stageFile = (path: string): Promise<void> => runStageOperation(path, gitApi.stageFile)
  const unstageFile = (path: string): Promise<void> =>
    runStageOperation(path, gitApi.unstageFile)

  const commit = async (message: string): Promise<boolean> => {
    if (isCommittingRef.current) return false
    isCommittingRef.current = true
    setIsCommitting(true)
    try {
      await gitApi.commitChanges(message)
      setOperationError(null)
      return true
    } catch (err) {
      setOperationError(err instanceof Error ? err : new Error(String(err)))
      return false
    } finally {
      isCommittingRef.current = false
      setIsCommitting(false)
      await refreshGitStatus()
    }
  }

  return { stagingPaths, stageFile, unstageFile, isCommitting, commit, operationError }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useGitOperations.ts && npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useGitOperations.ts src/renderer/src/hooks/__tests__/useGitOperations.test.ts
git commit -m "$(cat <<'EOF'
feat: ステージ・アンステージ・コミットを行うuseGitOperationsを追加する

useFileEditingのsavingPathsと同じRef+State二重管理パターンで、
同一パスへの多重ステージ操作・多重コミットを防止する。
EOF
)"
```

---

### Task 5: `ChangesSection.tsx` にステージボタンを追加する

**Files:**
- Modify: `src/renderer/src/components/source-control/ChangesSection.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface Props {
    files: GitFileStatus[]
    stagingPaths: ReadonlySet<string>
    onStage: (path: string) => void
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx` に以下を追加する（既存のテストの `render(<ChangesSection files={files} />)` 呼び出しはすべて `stagingPaths={new Set()}` と `onStage={vi.fn()}` を渡す形に更新する。既存ファイルを読んで、既存の `it` それぞれの呼び出し箇所を機械的に更新すること）:

```tsx
import userEvent from '@testing-library/user-event'
// 既存の import に追加

describe('ステージボタン', () => {
  it('各ファイルにステージボタンを表示する', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} />)
    expect(screen.getByLabelText('src/index.ts をステージ')).toBeInTheDocument()
  })

  it('ステージボタンをクリックすると onStage がそのパスで呼ばれる', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
    const onStage = vi.fn()
    render(<ChangesSection files={files} stagingPaths={new Set()} onStage={onStage} />)
    await userEvent.click(screen.getByLabelText('src/index.ts をステージ'))
    expect(onStage).toHaveBeenCalledWith('src/index.ts')
  })

  it('stagingPaths に含まれるファイルのステージボタンは無効化される', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
    render(
      <ChangesSection
        files={files}
        stagingPaths={new Set(['src/index.ts'])}
        onStage={vi.fn()}
      />
    )
    expect(screen.getByLabelText('src/index.ts をステージ')).toBeDisabled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx`
Expected: FAIL（`stagingPaths`/`onStage` props が無い、`aria-label` が存在しない）

- [ ] **Step 3: `ChangesSection.tsx` を実装する**

```tsx
import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
}

export default function ChangesSection({ files, stagingPaths, onStage }: Props) {
  const changed = files.filter((f) => f.workingDir !== ' ' || f.index === '?')
  if (changed.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">変更 ({changed.length})</h3>
      <ul className="source-control-panel__file-list">
        {changed.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--changed">
              {f.index === '?' ? statusChar(f.index) : statusChar(f.workingDir)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
            <button
              type="button"
              className="source-control-panel__stage-btn"
              onClick={() => onStage(f.path)}
              disabled={stagingPaths.has(f.path)}
              aria-label={`${f.path} をステージ`}
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/ChangesSection.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx; git stash pop`
Expected: 新規追加した3件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `GitRepoView.tsx`（Task 8 で更新）からの呼び出しがまだ古い Props のためエラーが出る想定。Task 8 完了後に解消すればよい

- [ ] **Step 7: コミットは Task 8 とまとめて行う**

`ChangesSection` 単体では `GitRepoView.tsx` から古い props で呼ばれ型エラーが残る。中間状態でのコミットは避け、Task 8 完了後にまとめてコミットする。

---

### Task 6: `StagedSection.tsx` にアンステージボタンを追加する

**Files:**
- Modify: `src/renderer/src/components/source-control/StagedSection.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface Props {
    files: GitFileStatus[]
    stagingPaths: ReadonlySet<string>
    onUnstage: (path: string) => void
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx` の既存 `render(<StagedSection files={files} />)` 呼び出しをすべて `stagingPaths={new Set()}` と `onUnstage={vi.fn()}` を渡す形に更新する（既存ファイルを読んで機械的に更新）。追加で:

```tsx
import userEvent from '@testing-library/user-event'
// 既存の import に追加

describe('アンステージボタン', () => {
  it('各ファイルにアンステージボタンを表示する', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} />)
    expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeInTheDocument()
  })

  it('アンステージボタンをクリックすると onUnstage がそのパスで呼ばれる', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    const onUnstage = vi.fn()
    render(<StagedSection files={files} stagingPaths={new Set()} onUnstage={onUnstage} />)
    await userEvent.click(screen.getByLabelText('src/index.ts をアンステージ'))
    expect(onUnstage).toHaveBeenCalledWith('src/index.ts')
  })

  it('stagingPaths に含まれるファイルのアンステージボタンは無効化される', () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    render(
      <StagedSection
        files={files}
        stagingPaths={new Set(['src/index.ts'])}
        onUnstage={vi.fn()}
      />
    )
    expect(screen.getByLabelText('src/index.ts をアンステージ')).toBeDisabled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`
Expected: FAIL

- [ ] **Step 3: `StagedSection.tsx` を実装する**

```tsx
import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onUnstage: (path: string) => void
}

export default function StagedSection({ files, stagingPaths, onUnstage }: Props) {
  const staged = files.filter((f) => f.index !== ' ' && f.index !== '?')
  if (staged.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">ステージ済み ({staged.length})</h3>
      <ul className="source-control-panel__file-list">
        {staged.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--staged">
              {statusChar(f.index)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
            <button
              type="button"
              className="source-control-panel__unstage-btn"
              onClick={() => onUnstage(f.path)}
              disabled={stagingPaths.has(f.path)}
              aria-label={`${f.path} をアンステージ`}
            >
              −
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/StagedSection.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx; git stash pop`
Expected: 新規追加した3件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `GitRepoView.tsx` からの呼び出しがまだ古い Props のためエラーが出る想定（Task 5 と同様、Task 8 で解消）

- [ ] **Step 7: コミットは Task 8 とまとめて行う**

---

### Task 7: `CommitSection.tsx` を新規作成する

**Files:**
- Create: `src/renderer/src/components/source-control/CommitSection.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`

**Interfaces:**
- Consumes: なし（親から props で受け取るのみ）
- Produces:
  ```ts
  interface Props {
    stagedCount: number
    isCommitting: boolean
    onCommit: (message: string) => Promise<boolean>
  }
  ```
  内部でメッセージ入力の state を持つ（コミット成功時に自前でクリアする）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx` を新規作成:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommitSection from '../CommitSection'

describe('CommitSection', () => {
  it('メッセージ入力欄とコミットボタンを表示する', () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
  })

  it('メッセージが空のときコミットボタンは無効', () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージが空白のみのときコミットボタンは無効', async () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), '   ')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('stagedCount が 0 のときコミットボタンは無効', async () => {
    render(<CommitSection stagedCount={0} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージ入力済み・ステージあり・実行中でないときコミットボタンは有効', async () => {
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
  })

  it('コミットボタンをクリックすると onCommit がメッセージで呼ばれる', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(onCommit).toHaveBeenCalledWith('feat: 新機能')
  })

  it('コミット成功時にメッセージ入力欄をクリアする', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('')
  })

  it('コミット失敗時はメッセージ入力欄を保持する', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    render(<CommitSection stagedCount={1} isCommitting={false} onCommit={onCommit} />)
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('feat: 新機能')
  })

  it('isCommitting が true のときコミットボタンは無効かつ実行中表示', async () => {
    render(<CommitSection stagedCount={1} isCommitting={true} onCommit={vi.fn()} />)
    expect(screen.getByRole('button', { name: /コミット/ })).toBeDisabled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`
Expected: FAIL（`CommitSection` モジュールが存在しない）

- [ ] **Step 3: `CommitSection.tsx` を実装する**

```tsx
import { useState } from 'react'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
}

export default function CommitSection({ stagedCount, isCommitting, onCommit }: Props) {
  const [message, setMessage] = useState('')
  const isDisabled = message.trim() === '' || stagedCount === 0 || isCommitting

  const handleCommit = async (): Promise<void> => {
    const succeeded = await onCommit(message)
    if (succeeded) setMessage('')
  }

  return (
    <div className="source-control-panel__commit">
      <textarea
        className="source-control-panel__commit-input"
        placeholder="コミットメッセージ"
        aria-label="コミットメッセージ"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
      />
      <button
        type="button"
        className="source-control-panel__commit-btn"
        onClick={handleCommit}
        disabled={isDisabled}
      >
        {isCommitting ? 'コミット中...' : 'コミット'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/CommitSection.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし（`CommitSection` はまだどこからも呼ばれていないため、単体では型エラーは出ない想定）

- [ ] **Step 7: コミットは Task 8 とまとめて行う**

`GitRepoView.tsx` に組み込むまでは実際に使われないコンポーネントのため、Task 8 完了後にまとめてコミットする。

---

### Task 8: `GitRepoView`/`useAppState`/`App.tsx`/`Sidebar.tsx` の配線を統合し、CSS を追加する

**Files:**
- Modify: `src/renderer/src/components/source-control/GitRepoView.tsx`
- Modify: `src/renderer/src/components/source-control/SourceControlPanel.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: Task 4 の `useGitOperations`、Task 5/6/7 の更新済み `ChangesSection`/`StagedSection`/`CommitSection`
- Produces: `GitRepoView` の新しい Props:
  ```ts
  interface Props {
    branch: string | null
    ahead: number
    behind: number
    files: GitFileStatus[]
    stagingPaths: ReadonlySet<string>
    onStage: (path: string) => void
    onUnstage: (path: string) => void
    isCommitting: boolean
    onCommit: (message: string) => Promise<boolean>
  }
  ```
  `SourceControlPanel` はこれに `operationError: Error | null` を加えた Props を受け取り `GitRepoView` へ橋渡しする。

- [ ] **Step 1: `GitRepoView.test.tsx`/`SourceControlPanel.test.tsx` を新しい Props に合わせて更新する**

両ファイルを読み、`render(<GitRepoView ... />)`/`render(<SourceControlPanel ... />)` の呼び出し箇所に不足している新規 props（`stagingPaths={new Set()}`、`onStage={vi.fn()}`、`onUnstage={vi.fn()}`、`isCommitting={false}`、`onCommit={vi.fn().mockResolvedValue(true)}`、`SourceControlPanel` には追加で `operationError={null}`）を機械的に追加する。

`GitRepoView.test.tsx` に以下のテストを追加する:

```tsx
it('onStage/onUnstage/onCommit が ChangesSection/StagedSection/CommitSection に配線される', async () => {
  const files: GitFileStatus[] = [
    { path: 'staged.ts', index: 'M', workingDir: ' ' },
    { path: 'changed.ts', index: ' ', workingDir: 'M' },
  ]
  const onStage = vi.fn()
  const onUnstage = vi.fn()
  const onCommit = vi.fn().mockResolvedValue(true)
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={files}
      stagingPaths={new Set()}
      onStage={onStage}
      onUnstage={onUnstage}
      isCommitting={false}
      onCommit={onCommit}
    />
  )
  await userEvent.click(screen.getByLabelText('changed.ts をステージ'))
  expect(onStage).toHaveBeenCalledWith('changed.ts')
  await userEvent.click(screen.getByLabelText('staged.ts をアンステージ'))
  expect(onUnstage).toHaveBeenCalledWith('staged.ts')
  expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
})
```

`SourceControlPanel.test.tsx` には `operationError` の表示テストを追加する:

```tsx
it('operationError があれば表示する', () => {
  const gitStatus: GitStatusResult = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] }
  render(
    <SourceControlPanel
      gitStatus={gitStatus}
      gitLoading={false}
      gitError={null}
      onRefresh={vi.fn()}
      stagingPaths={new Set()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      isCommitting={false}
      onCommit={vi.fn()}
      operationError={new Error('ステージに失敗しました')}
    />
  )
  expect(screen.getByText('ステージに失敗しました')).toBeInTheDocument()
})
```

（`GitStatusResult` の import が無ければ `@shared/types` から追加する。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`
Expected: FAIL（新規 props が無い）

- [ ] **Step 3: `GitRepoView.tsx` を実装する**

```tsx
import type { GitFileStatus } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
}

export default function GitRepoView({
  branch,
  ahead,
  behind,
  files,
  stagingPaths,
  onStage,
  onUnstage,
  isCommitting,
  onCommit
}: Props) {
  const stagedCount = files.filter((f) => f.index !== ' ' && f.index !== '?').length
  return (
    <>
      <div className="source-control-panel__branch">
        <span>{branch ?? '(no branch)'}</span>
        {ahead > 0 && <span className="source-control-panel__ahead">↑{ahead}</span>}
        {behind > 0 && <span className="source-control-panel__behind">↓{behind}</span>}
      </div>
      <CommitSection stagedCount={stagedCount} isCommitting={isCommitting} onCommit={onCommit} />
      <StagedSection files={files} stagingPaths={stagingPaths} onUnstage={onUnstage} />
      <ChangesSection files={files} stagingPaths={stagingPaths} onStage={onStage} />
      {files.length === 0 && (
        <p className="source-control-panel__empty">変更はありません</p>
      )}
    </>
  )
}
```

（`CommitSection` を `StagedSection` の上に置く。設計書は「`StagedSection` の下」としていたが、常に見える位置にコミット欄を置く方がUXとして自然なため、ここではブランチ表示の直下に配置する。この配置変更は実装者の判断で行ってよい。）

- [ ] **Step 4: `SourceControlPanel.tsx` を実装する**

```tsx
import type { GitStatusResult } from '@shared/types'
import GitRepoView from './GitRepoView'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  operationError: Error | null
}

export default function SourceControlPanel({
  gitStatus,
  gitLoading,
  gitError,
  onRefresh,
  stagingPaths,
  onStage,
  onUnstage,
  isCommitting,
  onCommit,
  operationError
}: Props) {
  return (
    <div className="source-control-panel">
      <div className="source-control-panel__toolbar">
        <button
          type="button"
          className="source-control-panel__refresh-btn"
          onClick={onRefresh}
          disabled={gitLoading}
          aria-label="更新"
        >
          更新
        </button>
      </div>
      {gitError && <p className="source-control-panel__error">{gitError.message}</p>}
      {operationError && (
        <p className="source-control-panel__error">{operationError.message}</p>
      )}
      {gitLoading && <p className="source-control-panel__loading">読み込み中...</p>}
      {gitStatus !== null && !gitLoading && (
        !gitStatus.isRepo ? (
          <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
        ) : (
          <GitRepoView
            branch={gitStatus.branch}
            ahead={gitStatus.ahead}
            behind={gitStatus.behind}
            files={gitStatus.files}
            stagingPaths={stagingPaths}
            onStage={onStage}
            onUnstage={onUnstage}
            isCommitting={isCommitting}
            onCommit={onCommit}
          />
        )
      )}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: `useAppState.ts` を配線する**

`src/renderer/src/hooks/useAppState.ts` の import に `useGitOperations` を追加し、`git` の直後で呼び出す:

```ts
import { useGitOperations } from './useGitOperations'
// ...
const git = useGitStatus(fileSystem.folderPath)
const gitOperations = useGitOperations(git.refreshGitStatus)
```

`AppState` 型の交差に `ReturnType<typeof useGitOperations>` を追加し、返り値のスプレッドに `...gitOperations` を追加する。

- [ ] **Step 6: `App.tsx` を配線する**

`App.tsx` の `useAppState()` からの分割代入に `stagingPaths, stageFile: onStageFile, unstageFile: onUnstageFile, isCommitting, commit: onCommit, operationError` を追加する（`stageFile`/`unstageFile`/`commit` は `useFileSystem` 由来の同名メンバーと衝突しないか確認する。もし衝突する場合、`useAppState.ts` 側の `useGitOperations` の返り値をリネームしてスプレッドする、または `App.tsx` の分割代入時に別名を付ける。実装者は分割代入前に既存の分割代入一覧を必ず確認し、名前衝突があれば適切にリネームすること）。`Sidebar` への呼び出しに以下の props を追加する:

```tsx
stagingPaths={stagingPaths}
onStageFile={stageFile}
onUnstageFile={unstageFile}
isCommitting={isCommitting}
onCommit={commit}
gitOperationError={operationError}
```

- [ ] **Step 7: `Sidebar.tsx` を配線する**

`Props` インターフェースに追加:

```ts
stagingPaths: ReadonlySet<string>
onStageFile: (path: string) => void
onUnstageFile: (path: string) => void
isCommitting: boolean
onCommit: (message: string) => Promise<boolean>
gitOperationError: Error | null
```

分割代入と `SourceControlPanel` 呼び出しを更新:

```tsx
<SourceControlPanel
  gitStatus={gitStatus}
  gitLoading={gitLoading}
  gitError={gitError}
  onRefresh={onRefreshGitStatus}
  stagingPaths={stagingPaths}
  onStage={onStageFile}
  onUnstage={onUnstageFile}
  isCommitting={isCommitting}
  onCommit={onCommit}
  operationError={gitOperationError}
/>
```

- [ ] **Step 8: CSS を追加する**

`src/renderer/src/assets/main.css` の `.source-control-panel__file-item` 関連スタイルの近く（1069行目付近、`.source-control-panel__file-item:hover` の後）に追加する。既存の `.editor-tab__close-btn` のスタイル（ホバー時に見える小さい丸ボタン）と統一感を持たせる:

```css
.source-control-panel__stage-btn,
.source-control-panel__unstage-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: #cccccc;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.source-control-panel__file-item:hover .source-control-panel__stage-btn,
.source-control-panel__file-item:hover .source-control-panel__unstage-btn {
  display: flex;
}

.source-control-panel__stage-btn:hover,
.source-control-panel__unstage-btn:hover {
  background: #454545;
}

.source-control-panel__stage-btn:disabled,
.source-control-panel__unstage-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.source-control-panel__commit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid #333333;
}

.source-control-panel__commit-input {
  resize: vertical;
  min-height: 48px;
  padding: 6px 8px;
  background: #3c3c3c;
  border: 1px solid #454545;
  border-radius: 3px;
  color: #cccccc;
  font-size: 13px;
  font-family: inherit;
}

.source-control-panel__commit-btn {
  align-self: flex-end;
  padding: 4px 12px;
  background: #0e639c;
  border: none;
  border-radius: 3px;
  color: #ffffff;
  font-size: 12px;
  cursor: pointer;
}

.source-control-panel__commit-btn:hover:not(:disabled) {
  background: #1177bb;
}

.source-control-panel__commit-btn:disabled {
  background: #454545;
  color: #8a8a8a;
  cursor: default;
}
```

Read the file first at the target line range to confirm the exact insertion point matches current content before editing (this plan's earlier confirmed line number was 1069, but earlier tasks in this same plan don't touch this file, so it should still be accurate — verify anyway).

- [ ] **Step 9: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control src/renderer/src/hooks/__tests__/useAppState.test.ts 2>/dev/null; npx vitest run src/renderer/src/components/source-control`
Expected: PASS（全件。`useAppState.test.ts` が存在しない場合は無視してよい）

- [ ] **Step 10: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx; git stash pop`
Expected: 新規追加した2件のテストが FAIL する

- [ ] **Step 11: 全体テスト・型チェック**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS（Task 1〜7 で作った未コミット分もすべて含めて緑になることを確認する）

- [ ] **Step 12: ESLint**

Run: `npx eslint src/main/gitService.ts src/main/handlers/gitHandlers.ts src/preload/api.ts src/renderer/src/lib/gitApi.ts src/renderer/src/hooks/useGitOperations.ts src/renderer/src/components/source-control/ChangesSection.tsx src/renderer/src/components/source-control/StagedSection.tsx src/renderer/src/components/source-control/CommitSection.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/hooks/useAppState.ts src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx`
Expected: エラーなし

- [ ] **Step 13: コミット（Task 5〜8 まとめて）**

```bash
git add -u src/renderer/src/components/source-control/ChangesSection.tsx \
  src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx \
  src/renderer/src/components/source-control/StagedSection.tsx \
  src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx \
  src/renderer/src/components/source-control/CommitSection.tsx \
  src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx \
  src/renderer/src/components/source-control/GitRepoView.tsx \
  src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx \
  src/renderer/src/components/source-control/SourceControlPanel.tsx \
  src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx \
  src/renderer/src/hooks/useAppState.ts \
  src/renderer/src/App.tsx \
  src/renderer/src/components/Sidebar.tsx \
  src/renderer/src/assets/main.css
git commit -m "$(cat <<'EOF'
feat: ソース管理パネルにステージ・アンステージ・コミットUIを統合する

ChangesSection/StagedSectionにステージ・アンステージボタンを追加し、
CommitSectionを新設してGitRepoViewに組み込む。App/Sidebar/useAppState
の配線を更新し、対応するCSSを追加する。
EOF
)"
```

---

### Task 9: 最終確認

**Files:** なし

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 2: 全テストスイート実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 3: ESLint（プロジェクト全体）**

Run: `npx eslint .`
Expected: このプランで変更したファイルに起因するエラーなし（既存の pre-existing なエラーがあれば、この変更が原因でないことを確認した上でスコープ外とする）

- [ ] **Step 4: ROADMAP.md を更新する**

`<repo-root>/ROADMAP.md` の「ソース管理（Git）」セクション（実装済み機能側と、今後実装した方がよい機能側の両方に記載がある）を確認し、以下を `- [x]` にする:
- 実装済み機能セクション: 新規追加`- [x] 変更のステージ / アンステージ（ファイル単位）` を「Git ステータスの表示」の項目の後に追加
- 実装済み機能セクション: 新規追加`- [x] コミット（メッセージ入力）` を追加
- 「今後実装した方がよい機能」セクションの「ソース管理（Git）」内の `- [ ] 変更のステージ / アンステージ（ファイル単位・ハンク単位）` は「ハンク単位」がまだ未実装なので `- [ ]` のまま残し、文言を `- [ ] 変更のステージ / アンステージ（ハンク単位）` に変更する（ファイル単位は完了したため）。同様に `- [ ] コミット（メッセージ入力 / amend）` は amend が未実装なので `- [ ] コミット（amend）` に文言変更する。

- [ ] **Step 5: コミット**

```bash
git add -u ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: Gitステージ・コミット機能の実装完了をROADMAPに反映する
EOF
)"
```

---

### Task 10: Electron 実機での動作確認

**Files:** なし

- [ ] **Step 1: アプリを起動する**

Run: `npm run dev`（または `run` スキルを使って起動）

- [ ] **Step 2: フォルダを開き、ソース管理パネルへ切り替える**

Gitリポジトリ配下のフォルダを開き、アクティビティバーからソース管理パネルに切り替える。

- [ ] **Step 3: ステージ操作を確認する**

未追跡ファイルまたは変更済みファイルを作り、「変更」セクションでステージボタンをクリック。「ステージ済み」セクションに移動することを確認する。

- [ ] **Step 4: アンステージ操作を確認する**

「ステージ済み」セクションでアンステージボタンをクリックし、「変更」セクションに戻ることを確認する。

- [ ] **Step 5: コミット操作を確認する**

ファイルをステージした状態でコミットメッセージを入力し、コミットボタンをクリック。「ステージ済み」セクションが空になり、`git log` で実際にコミットが作られたことを確認する。

- [ ] **Step 6: エラー表示を確認する**

コミットメッセージを空のままコミットボタンが無効化されていることを目視確認する。

- [ ] **Step 7: アプリを停止する**

検証が終わったら、起動した Electron 本体と dev サーバーを停止する。`pgrep -fl` で対象プロセスを確認してから `pkill -f`（リポジトリ名を含むパターンを使う）で停止する。

- [ ] **Step 8: 動作確認結果をユーザーに報告する**

問題があれば修正タスクを追加し、無ければ完了として報告する。
