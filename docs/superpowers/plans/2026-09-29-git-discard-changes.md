# Git 変更の取り消し（discard）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース管理パネルの「変更」セクションから、ファイル単位で未ステージの変更を取り消せるようにする（追跡済みは index の内容へ戻し、未追跡は OS のゴミ箱へ移動する）。

**Architecture:** main の `gitService.discardFileChanges` が `ls-files -u`（コンフリクト判定）→ `ls-files`（追跡済み判定）→ `restore --worktree` またはゴミ箱への移動を行う。ゴミ箱への移動は `src/main/trash.ts` に切り出して注入し、gitService を Electron から切り離す。renderer は `useGitOperations.discardFile` で既存のステージ操作の直列化に乗せ、確認とエディタのバッファ同期は新設の `useDiscardFileChanges` フックが担う。

**Tech Stack:** Electron（`shell.trashItem`）/ React / TypeScript / simple-git / Vitest / Testing Library

**Spec:** [docs/superpowers/specs/2026-09-29-git-discard-changes-design.md](../specs/2026-09-29-git-discard-changes-design.md)

## Global Constraints

- コメント・コミットメッセージ・UI 文言は日本語。コミットは Conventional Commit 形式で、末尾に空行と `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付ける（実行するエージェント自身のモデル名ではなく、必ずこの文字列）
- **`git commit` / `git push` はユーザーが明示的に指示した場合のみ実行する**（CLAUDE.md）
- `git add -A` は使わない。対象ファイルを明示して `git add` する
- 型としてのみ使う import は `import type`
- 関数のデフォルト引数はラッパーではなく関数を直接渡す（例: `onConfirm = confirm`）
- `act(...).then(...)` 形式でテストを書かない
- TDD: 失敗するテスト → 実装 → 通過。実装を一時的に戻すとテストが落ちることも確認する
- 検証コマンド: `npm test` / `npm run typecheck` / 変更したファイルへの `npx eslint` と `npx prettier --check`
- pathspec は既存の `toLiteralPathspec`（`:(literal)<path>`）で必ずリテラル化する
- UI 文言（完全一致で使う）:
  - 取り消しボタンの `aria-label`: `<path> の変更を取り消し`、表示: `↶`
  - 確認（追跡済み）: `<path> の変更を取り消しますか？この操作は元に戻せません。`
  - 確認（未追跡）: `<path> をゴミ箱へ移動しますか？`
  - 未保存の編集がある場合の追記（上の文言の後ろに改行 2 つを挟んで）: `エディタの未保存の編集も破棄されます。`
  - main 側エラー: `コンフリクト中のファイルは取り消せません: <path>` / `ゴミ箱へ移動できませんでした: <path>`

## File Structure

| ファイル                                                                           | 責務                                                               | 変更   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `src/main/trash.ts`                                                                | `shell.trashItem` の薄いラッパー（Electron 依存をここに閉じる）    | Create |
| `src/main/gitService.ts`                                                           | `discardFileChanges`                                               | Modify |
| `src/main/handlers/gitHandlers.ts`                                                 | IPC `git:discardChanges`                                           | Modify |
| `src/preload/api.ts` / `src/preload/index.d.ts` / `src/renderer/src/lib/gitApi.ts` | `discardChanges`                                                   | Modify |
| `src/renderer/src/lib/gitUtils.ts`                                                 | `isConflictedFile` を export                                       | Modify |
| `src/renderer/src/hooks/useGitOperations.ts`                                       | `discardFile`（直列化に乗せる）                                    | Modify |
| `src/renderer/src/hooks/useFileSystem.ts`                                          | `reloadOpenFile` / `closeTabsAtOrInside` / `hasDirtyTabAtOrInside` | Modify |
| `src/renderer/src/lib/discardConfirmMessage.ts`                                    | 確認文言の組み立て（純粋関数）                                     | Create |
| `src/renderer/src/hooks/useDiscardFileChanges.ts`                                  | 確認 → 取り消し → 成功時のタブ同期                                 | Create |
| `src/renderer/src/hooks/useAppState.ts`                                            | `useDiscardFileChanges` の組み立てと公開                           | Modify |
| `src/renderer/src/components/source-control/ChangesSection.tsx`                    | 取り消しボタン                                                     | Modify |
| `GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` / `App.tsx`           | 配線                                                               | Modify |
| `src/renderer/src/assets/main.css`                                                 | ボタンの配置                                                       | Modify |
| `ROADMAP.md`                                                                       | 実装済みへ移動                                                     | Modify |

---

### Task 1: main の `discardFileChanges` と `trash.ts`

**Files:**

- Create: `src/main/trash.ts`、`src/main/__tests__/trash.test.ts`
- Modify: `src/main/gitService.ts`（`unstageFile` の直後）
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**

- Produces: `moveToTrash(absolutePath: string): Promise<void>`（`src/main/trash.ts`）、`discardFileChanges(folderPath: string, filePath: string, trash: (absolutePath: string) => Promise<void>): Promise<void>`（`filePath` はリポジトリ相対パス）

**前提（2026-09-29 に git 2.50.1 の実機で確認済み）:**

- `git restore --worktree -- :(literal)<path>` はステージ済みの内容を残し、working tree で削除したファイルも復元する
- 未追跡ファイルは `git ls-files -- :(literal)<path>` の出力が空。未追跡ディレクトリ（status では `newdir/`）も空
- コンフリクト中のファイルは `git ls-files -u -- :(literal)<path>` が空でない（`git restore` は `path '...' is unmerged` で失敗する）

**最終レビューでの追加:** intent-to-add（`git add -N`、status は ` A`）は `ls-files` に出るが、`restore --worktree` はファイルを空にするだけで内容が失われる。`restore` の前に `git diff --name-only --diff-filter=A -- :(literal)<path>` で判定し、空でなければ `git rm --cached -q` → ゴミ箱への移動の順で行う。renderer 側は `lib/gitUtils.ts` の `isIntentToAddFile` で未追跡と同じ扱いにする。以下のコード例はこの追加前の内容で、現行コードは `src/main/gitService.ts` を参照すること。

- [ ] **Step 1: `trash.ts` のテストを書く**

`src/main/__tests__/trash.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const mockTrashItem = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ shell: { trashItem: mockTrashItem } }))

import { moveToTrash } from '../trash'

describe('moveToTrash', () => {
  it('shell.trashItem に絶対パスをそのまま渡す', async () => {
    mockTrashItem.mockResolvedValue(undefined)
    await moveToTrash('/project/new.txt')
    expect(mockTrashItem).toHaveBeenCalledWith('/project/new.txt')
  })

  it('shell.trashItem の失敗を伝播する', async () => {
    mockTrashItem.mockRejectedValue(new Error('trash unavailable'))
    await expect(moveToTrash('/project/new.txt')).rejects.toThrow('trash unavailable')
  })
})
```

- [ ] **Step 2: `discardFileChanges` のテストを書く**

`gitService.test.ts` の import に `discardFileChanges` を追加し、`describe('unstageFile')` の後に追加する（既存の `mockRaw` を使う。`beforeEach` の `vi.clearAllMocks()` は実装を消さないため、各テストで `mockRaw` を設定する）:

```ts
describe('discardFileChanges', () => {
  // raw() の呼び出しを先頭の引数で振り分ける。出力形式は Task 1 冒頭の前提を参照
  const setupRaw = (outputs: { unmerged?: string; tracked?: string }): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files' && args[1] === '-u') return outputs.unmerged ?? ''
      if (args[0] === 'ls-files') return outputs.tracked ?? ''
      if (args[0] === 'restore') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  it('追跡済みなら restore --worktree をリテラル pathspec で呼び、ゴミ箱へは移動しない', async () => {
    setupRaw({ tracked: 'src/a.ts\n' })
    const trash = vi.fn()
    await discardFileChanges('/project', 'src/a.ts', trash)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(['restore', '--worktree', '--', ':(literal)src/a.ts'])
    expect(trash).not.toHaveBeenCalled()
  })

  // git は `--` の後ろでも [ ] * ? をグロブとして解釈するため、リテラル化しないと
  // 'a[1].txt' の取り消しで無関係な 'a1.txt' の変更まで消えてしまう
  it('グロブ文字を含むパスもリテラル化して渡す', async () => {
    setupRaw({ tracked: 'a[1].txt\n' })
    await discardFileChanges('/project', 'a[1].txt', vi.fn())
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-u', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith(['restore', '--worktree', '--', ':(literal)a[1].txt'])
  })

  it('未追跡(ls-files が空)なら絶対パスでゴミ箱へ移動し、restore は呼ばない', async () => {
    setupRaw({ tracked: '' })
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges('/project', 'new/file.txt', trash)
    expect(trash).toHaveBeenCalledWith('/project/new/file.txt')
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['restore']))
  })

  it('ゴミ箱への移動に失敗したら日本語エラーにする', async () => {
    setupRaw({ tracked: '' })
    const trash = vi.fn().mockRejectedValue(new Error('trash unavailable'))
    await expect(discardFileChanges('/project', 'new.txt', trash)).rejects.toThrow(
      'ゴミ箱へ移動できませんでした: new.txt'
    )
  })

  // git restore は 'is unmerged' で失敗するが、その英語エラーを見せる前に日本語で拒否する
  it('コンフリクト中(ls-files -u が空でない)なら日本語エラーで拒否し、何も実行しない', async () => {
    setupRaw({ unmerged: '100644 abc 1\tc.txt\n100644 def 2\tc.txt\n', tracked: 'c.txt\nc.txt\n' })
    const trash = vi.fn()
    await expect(discardFileChanges('/project', 'c.txt', trash)).rejects.toThrow(
      'コンフリクト中のファイルは取り消せません: c.txt'
    )
    expect(trash).not.toHaveBeenCalled()
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['restore']))
  })

  it('restore が失敗したら git のエラーをそのまま伝播する', async () => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files' && args[1] === '-u') return ''
      if (args[0] === 'ls-files') return 'a.ts\n'
      throw new Error('restore failed')
    })
    await expect(discardFileChanges('/project', 'a.ts', vi.fn())).rejects.toThrow('restore failed')
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/trash.test.ts src/main/__tests__/gitService.test.ts -t "moveToTrash|discardFileChanges"`
Expected: FAIL（モジュール・関数が無い）

- [ ] **Step 4: 実装する**

`src/main/trash.ts`:

```ts
import { shell } from 'electron'

// OS のゴミ箱への移動。Electron への依存をここに閉じ、gitService には関数として
// 注入する(gitService の単体テストで Electron をモックせずに済むようにする)
export function moveToTrash(absolutePath: string): Promise<void> {
  return shell.trashItem(absolutePath)
}
```

`gitService.ts` の `unstageFile` の直後に追加（`join` は既に import 済み）:

```ts
// 「変更」セクションのファイル単位の取り消し。filePath はリポジトリ相対パス。
// - コンフリクト中は git restore が 'is unmerged' の英語エラーで失敗するため、
//   ls-files -u で先に判定して日本語で拒否する(解決 UI とセットで別対応)
// - 未追跡(ls-files が空。未追跡ディレクトリも同じ)は git の履歴に内容が無く、
//   完全に削除すると復元できないため、OS のゴミ箱へ移動する
// - 追跡済みは restore --worktree で index の内容へ戻す(ステージ済みの内容は残る)
// いずれの問い合わせも出力の有無だけで判定でき、ロケールに依存しない
export async function discardFileChanges(
  folderPath: string,
  filePath: string,
  trash: (absolutePath: string) => Promise<void>
): Promise<void> {
  const git = simpleGit(folderPath)
  const pathspec = toLiteralPathspec(filePath)
  const unmerged = await git.raw(['ls-files', '-u', '--', pathspec])
  if (unmerged.trim() !== '') {
    throw new Error(`コンフリクト中のファイルは取り消せません: ${filePath}`)
  }
  const tracked = await git.raw(['ls-files', '--', pathspec])
  if (tracked.trim() === '') {
    try {
      await trash(join(folderPath, filePath))
    } catch {
      throw new Error(`ゴミ箱へ移動できませんでした: ${filePath}`)
    }
    return
  }
  await git.raw(['restore', '--worktree', '--', pathspec])
}
```

- [ ] **Step 5: 通過とミューテーションを確認する**

Run: `npx vitest run src/main/__tests__/trash.test.ts src/main/__tests__/gitService.test.ts`
Expected: PASS

`if (unmerged.trim() !== '')` のブロックを消すとコンフリクトのテストが、`toLiteralPathspec(filePath)` を `filePath` にするとグロブのテストが落ちることを確認してから戻す。

- [ ] **Step 6: 実機で前提を再確認する**

一時ディレクトリ（`mktemp -d`）で次を実行し、Task 1 冒頭の前提が成り立つことを確認する（プロジェクトのリポジトリでは実行しない）:

```bash
cd "$(mktemp -d)" && git init -q && echo a > a.txt && git add a.txt && git -c user.name=t -c user.email=t@t commit -qm init && echo s >> a.txt && git add a.txt && echo u >> a.txt && echo n > new.txt
git restore --worktree -- ':(literal)a.txt' && git status --porcelain
echo "[untracked]$(git ls-files -- ':(literal)new.txt')"
```

Expected: `M  a.txt` と `?? new.txt`、`[untracked]` の後ろは空

- [ ] **Step 7: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/main/trash.ts src/main/__tests__/trash.test.ts src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "feat: ファイル単位の変更の取り消しをmainプロセスに追加する"
```

---

### Task 2: IPC・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`（import と `git:unstage` の直後）、`src/preload/api.ts`、`src/preload/index.d.ts`、`src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`、`src/preload/__tests__/api.test.ts`

**Interfaces:**

- Consumes: `discardFileChanges`、`moveToTrash`（Task 1）
- Produces: IPC `git:discardChanges(filePath: string)`、`window.api.discardChanges(filePath: string): Promise<void>`、`gitApi.discardChanges(filePath: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`gitHandlers.test.ts`: `const mockDiscardFileChanges = vi.hoisted(() => vi.fn())` と `const mockMoveToTrash = vi.hoisted(() => vi.fn())` を追加し、`vi.mock('../../gitService', ...)` に `discardFileChanges: mockDiscardFileChanges` を足す。さらに次を追加する:

```ts
vi.mock('../../trash', () => ({ moveToTrash: mockMoveToTrash }))
```

`describe('git:stage')` の後に追加:

```ts
describe('git:discardChanges', () => {
  it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('git:discardChanges')(makeEvent(1), 'src/index.ts')
    ).rejects.toThrow('No folder open')
  })

  // stage と同じく、失敗時のエラーに OS 絶対パスが乗らないよう相対パスで渡す。
  // ゴミ箱への移動は Electron に依存するため main/trash.ts の関数を注入する
  it('境界チェック後、リポジトリ相対パスと moveToTrash を渡して discardFileChanges を呼ぶ', async () => {
    const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder
    })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockDiscardFileChanges.mockResolvedValue(undefined)
    await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'src/index.ts')
    expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    expect(mockDiscardFileChanges).toHaveBeenCalledWith('/project', 'src/index.ts', mockMoveToTrash)
  })

  it('フォルダ外のパスは discardFileChanges を呼ばずにエラーを伝播する', async () => {
    const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder
    })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('git:discardChanges')(makeEvent(1), '/outside/file.ts')
    ).rejects.toThrow('Access denied')
    expect(mockDiscardFileChanges).not.toHaveBeenCalled()
  })

  // git status は未追跡ディレクトリを 'newdir/' の形で返す
  it('末尾が / の未追跡ディレクトリも相対パスへ変換して渡す', async () => {
    const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder
    })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockDiscardFileChanges.mockResolvedValue(undefined)
    await getRegisteredHandler('git:discardChanges')(makeEvent(1), 'newdir/')
    expect(mockDiscardFileChanges).toHaveBeenCalledWith('/project', 'newdir', mockMoveToTrash)
  })
})
```

`api.test.ts` の `unstageFile` のケースの近くに追加:

```ts
  [
    'discardChanges は git:discardChanges チャンネルに filePath を渡す',
    () => api.discardChanges('src/a.ts'),
    ['git:discardChanges', 'src/a.ts']
  ],
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

`gitHandlers.ts`: import に `discardFileChanges`（`../gitService`）と `import { moveToTrash } from '../trash'` を追加し、`git:unstage` の直後に追加:

```ts
ipcMain.handle('git:discardChanges', async (event: IpcMainInvokeEvent, filePath: string) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  // git:stage と同じ理由(失敗時のエラーに OS 絶対パスを乗せない)で相対パス化する
  const relativePath = await resolveAndAssertRelativePath(folderAccess, allowedFolder, filePath)
  await discardFileChanges(allowedFolder, relativePath, moveToTrash)
})
```

`src/preload/api.ts`（`unstageFile` の近く）:

```ts
  discardChanges: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('git:discardChanges', filePath),
```

`src/preload/index.d.ts`:

```ts
      discardChanges(filePath: string): Promise<void>
```

`src/renderer/src/lib/gitApi.ts`:

```ts
export function discardChanges(filePath: string): Promise<void> {
  return window.api.discardChanges(filePath)
}
```

- [ ] **Step 4: 通過を確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts && npm run typecheck`
Expected: PASS、型エラーなし。末尾 `/` のテストが既存の相対パス変換の実装で通ることを確認する（通らない場合は変換後の値を実装に合わせて期待値を直すのではなく、原因を調べて報告する）

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/gitApi.ts
git commit -m "feat: 変更の取り消しのIPCとpreload APIを追加する"
```

---

### Task 3: `useGitOperations.discardFile` と `isConflictedFile` の export

**Files:**

- Modify: `src/renderer/src/hooks/useGitOperations.ts`、`src/renderer/src/lib/gitUtils.ts`
- Test: `src/renderer/src/hooks/__tests__/useGitOperations.test.ts`、`src/renderer/src/lib/__tests__/gitUtils.test.ts`

**Interfaces:**

- Consumes: `gitApi.discardChanges`（Task 2）
- Produces: `GitOperationsState.discardFile: (path: string) => Promise<boolean>`（実行され成功したら true。no-op・失敗は false）、`export function isConflictedFile(f: GitFileStatus): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`gitUtils.test.ts` に追加（import に `isConflictedFile` を追加）:

```ts
describe('isConflictedFile', () => {
  it.each([
    ['U', 'U'],
    ['A', 'A'],
    ['D', 'D'],
    ['A', 'U'],
    ['U', 'A'],
    ['D', 'U'],
    ['U', 'D']
  ])('index=%s workingDir=%s はコンフリクト中', (index, workingDir) => {
    expect(isConflictedFile({ path: 'c.txt', index, workingDir })).toBe(true)
  })

  it.each([
    [' ', 'M'],
    ['M', 'M'],
    ['?', '?'],
    ['A', ' ']
  ])('index=%s workingDir=%s はコンフリクトではない', (index, workingDir) => {
    expect(isConflictedFile({ path: 'a.txt', index, workingDir })).toBe(false)
  })
})
```

`useGitOperations.test.ts` に追加（既存の `vi.mock('../../lib/gitApi')` と `renderHook` のパターンを使う。ファイル内の既存のモックロック生成ヘルパーがあればそれを使い、無ければ `useGitBranchOperations.test.ts` の `makeFileLock` と同じ形のヘルパーをこのファイルの先頭に追加する）:

```ts
describe('discardFile', () => {
  it('gitApi.discardChanges を呼び、成功したら true を返して git status を再取得する', async () => {
    vi.mocked(gitApi.discardChanges).mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus, makeFileLock()))
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.discardFile('src/a.ts')
    })
    expect(succeeded).toBe(true)
    expect(gitApi.discardChanges).toHaveBeenCalledWith('src/a.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗したら false を返し、operationError に反映する', async () => {
    vi.mocked(gitApi.discardChanges).mockRejectedValue(
      new Error('コンフリクト中のファイルは取り消せません: c.txt')
    )
    const { result } = renderHook(() =>
      useGitOperations(vi.fn().mockResolvedValue(undefined), makeFileLock())
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.discardFile('c.txt')
    })
    expect(succeeded).toBe(false)
    expect(result.current.operationError?.message).toBe(
      'コンフリクト中のファイルは取り消せません: c.txt'
    )
  })

  // restore は index の stat 情報を更新しうるため、.git/index を書き換える他の操作と
  // 同時に走らせない(stage/unstage と同じ直列化に乗せる)
  it('他の操作がロックを持っている間は呼ばずに false を返す', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useGitOperations(vi.fn().mockResolvedValue(undefined), lock)
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.discardFile('src/a.ts')
    })
    expect(succeeded).toBe(false)
    expect(gitApi.discardChanges).not.toHaveBeenCalled()
  })

  it('実行中は stagingPaths に対象パスが入り、同時の stageFile は呼ばれない', async () => {
    let resolveDiscard: () => void = () => {}
    vi.mocked(gitApi.discardChanges).mockReturnValue(new Promise<void>((r) => (resolveDiscard = r)))
    const { result } = renderHook(() =>
      useGitOperations(vi.fn().mockResolvedValue(undefined), makeFileLock())
    )
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = result.current.discardFile('src/a.ts')
    })
    expect(result.current.stagingPaths.has('src/a.ts')).toBe(true)
    await act(async () => {
      await result.current.stageFile('src/b.ts')
    })
    expect(gitApi.stageFile).not.toHaveBeenCalled()
    await act(async () => {
      resolveDiscard()
      await pending
    })
    expect(result.current.stagingPaths.size).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts src/renderer/src/lib/__tests__/gitUtils.test.ts`
Expected: FAIL（`isConflictedFile` が export されていない、`discardFile` が無い）

- [ ] **Step 3: 実装する**

`gitUtils.ts`: `function isConflictedFile` を `export function isConflictedFile` に変え、直前のコメントの最後に「ChangesSection の取り消しボタンの表示判定でも使う(main 側の ls-files -u による拒否と表示を揃える)」を追記する。

`useGitOperations.ts`:

- `runStageOperation` の戻り値を `Promise<boolean>` にする。ガードで弾いたら `return false`、`operation` が成功したら `succeeded = true`、catch したら false。`finally` の後で `return succeeded`（`useRunExclusiveGitOperation` と同じ形）
- `stageFile` / `unstageFile` の公開型は `Promise<void>` のまま保つ:

```ts
const stageFile = async (path: string): Promise<void> => {
  await runStageOperation(path, gitApi.stageFile)
}
const unstageFile = async (path: string, renamedFrom?: string): Promise<void> => {
  await runStageOperation(path, gitApi.unstageFile, renamedFrom)
}
// 取り消しは working tree を書き換えるが、git restore は index の stat 情報も更新しうる。
// stage/unstage と同じ直列化(runStageOperation)に乗せ、.git/index を書き換える他の操作と
// 同時に走らせない。戻り値(成功したか)は、呼び出し元がエディタのタブを成功時だけ
// 再読込するために使う(docs/review-findings-patterns.md パターン20)
const discardFile = (path: string): Promise<boolean> =>
  runStageOperation(path, gitApi.discardChanges)
```

- `GitOperationsState` に `discardFile: (path: string) => Promise<boolean>` を追加し、戻り値のオブジェクトにも追加する

- [ ] **Step 4: 通過とミューテーションを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts src/renderer/src/lib/__tests__/gitUtils.test.ts && npm run typecheck`
Expected: PASS

`runStageOperation` の成功時の `succeeded = true` を消すと「成功したら true」のテストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/hooks/useGitOperations.ts src/renderer/src/hooks/__tests__/useGitOperations.test.ts src/renderer/src/lib/gitUtils.ts src/renderer/src/lib/__tests__/gitUtils.test.ts
git commit -m "feat: 変更の取り消しをステージ操作と同じ直列化で実行するフックを追加する"
```

---

### Task 4: `useFileSystem` の対象パス単位のタブ同期

**Files:**

- Modify: `src/renderer/src/hooks/useFileSystem.ts`（`reloadOpenFiles` の直後）
- Test: `src/renderer/src/hooks/__tests__/useFileSystem.test.ts`（`describe('reloadOpenFiles')` の後）

**Interfaces:**

- Produces（いずれも引数は絶対パス。比較は `isSamePath` / `isPathAtOrInside`）:
  - `reloadOpenFile(absolutePath: string): Promise<void>` — そのパスのタブだけをディスクの内容で更新する（dirty も解消）。読み込みに失敗したら閉じる。開いていなければ何もしない
  - `closeTabsAtOrInside(absolutePath: string): void` — そのパス自身と配下のタブを確認なしで閉じる
  - `hasDirtyTabAtOrInside(absolutePath: string): boolean` — そのパス自身か配下に未保存の編集があるタブがあるか

> 実行時の補足: 実装はユーザー承認済みのレビュー指摘を受け、上記に加えて
> `deleteEntry`（`useFileTreeOperations`）と同じタブ保護を行うよう拡張されている。影響を受けた
> 各タブについて、アクティブなタブなら `resetForFileChange`（保存世代を進め、古い `saveError` /
> 保存中止通知もクリア）、そうでなければ `invalidatePath`（保存世代のみ）を呼ぶ。また
> `reloadOpenFile` / `closeTabsAtOrInside` はいずれも `invalidatePendingReads` で保留中の読み込みを
> 無効化するが、呼ぶ位置が異なる（`reloadOpenFile` は対象タブが開いていない場合の早期リターンより
> 後・読み込み完了後、`closeTabsAtOrInside` は影響タブが 0 件の場合の早期リターンより前）。詳細は
> 設計書（`docs/superpowers/specs/2026-09-29-git-discard-changes-design.md`）を参照。以降の Step 3 の
> コード例はこの拡張前のもので、最終的な実装とは一致しない。

- [ ] **Step 1: 失敗するテストを書く**

既存の `describe('reloadOpenFiles')` のテストと同じ手順（`openFolder` → `selectFile` → `updateFileContent`）でタブを用意する。追加するテスト:

```ts
describe('reloadOpenFile / closeTabsAtOrInside / hasDirtyTabAtOrInside', () => {
  // 変更の取り消し(useDiscardFileChanges)が、対象ファイルのタブだけを同期するために使う。
  // 全タブを対象にする reloadOpenFiles と違い、対象外のタブの未保存の編集を保持する
  const openTwoFiles = async (result: {
    current: ReturnType<typeof useFileSystem>
  }): Promise<void> => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('{}')
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })
    act(() => result.current.updateFileContent('index の未保存の編集'))
    await act(async () => {
      await result.current.selectFile({
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      })
    })
    act(() => result.current.updateFileContent('package の未保存の編集'))
  }

  it('reloadOpenFile は対象のタブだけをディスクの内容で更新し、他のタブの編集は残す', async () => {
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await openTwoFiles(result)
    mockReadFileContent.mockResolvedValueOnce('const a = 0 // 取り消し後')
    await act(async () => {
      await result.current.reloadOpenFile('/project/src/index.ts')
    })
    const index = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
    const pkg = result.current.openFiles.find((f) => f.path === '/project/package.json')
    expect(index?.content).toBe('const a = 0 // 取り消し後')
    expect(index?.savedContent).toBe('const a = 0 // 取り消し後')
    expect(pkg?.content).toBe('package の未保存の編集')
    expect(mockReadFileContent).toHaveBeenLastCalledWith('/project/src/index.ts')
  })

  it('reloadOpenFile で読み込みに失敗したら、そのタブを閉じる', async () => {
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await openTwoFiles(result)
    mockReadFileContent.mockRejectedValueOnce(new Error('ENOENT'))
    await act(async () => {
      await result.current.reloadOpenFile('/project/src/index.ts')
    })
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/package.json'])
  })

  it('reloadOpenFile は開いていないパスでは何も読み込まない', async () => {
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await openTwoFiles(result)
    mockReadFileContent.mockClear()
    await act(async () => {
      await result.current.reloadOpenFile('/project/other.ts')
    })
    expect(mockReadFileContent).not.toHaveBeenCalled()
  })

  it('closeTabsAtOrInside はそのパス自身と配下のタブを確認なしで閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openTwoFiles(result)
    onConfirm.mockClear()
    act(() => result.current.closeTabsAtOrInside('/project/src'))
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/package.json'])
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('hasDirtyTabAtOrInside はそのパス自身か配下の未保存の編集を検出する', async () => {
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await openTwoFiles(result)
    expect(result.current.hasDirtyTabAtOrInside('/project/src/index.ts')).toBe(true)
    expect(result.current.hasDirtyTabAtOrInside('/project/src')).toBe(true)
    expect(result.current.hasDirtyTabAtOrInside('/project/other.ts')).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts -t "reloadOpenFile /"`
Expected: FAIL（関数が無い）

- [ ] **Step 3: 実装する**

`useFileSystem.ts` の import に `isPathAtOrInside` を追加する（`../lib/pathUtils`。`isSamePath` は既に import 済みのはず。無ければあわせて追加）。`FileSystemState` に 3 つの型を追加し、`reloadOpenFiles` の直後に実装する:

```ts
// 変更の取り消し(git restore)のように、特定のファイルだけが working tree 上で
// 書き換わった後に、そのタブだけをディスクの内容へ揃える。reloadOpenFiles と
// 違い対象外のタブには触れない(その未保存の編集を保持するため)。
// 呼び出し側が事前に破棄を確認する前提で、dirty も解消する
const reloadOpenFile = async (absolutePath: string): Promise<void> => {
  if (!openFilesMirrorRef.current.some((f) => isSamePath(f.path, absolutePath))) return
  let content: string | null = null
  try {
    content = await fileSystemApi.readFileContent(absolutePath)
  } catch {
    content = null
  }
  setOpenFilesAndFixActive((prev) =>
    prev.flatMap((f) => {
      if (!isSamePath(f.path, absolutePath)) return [f]
      return content === null ? [] : [{ ...f, content, savedContent: content }]
    })
  )
}

// 未追跡ファイル・ディレクトリをゴミ箱へ移した後に、そのパス自身と配下のタブを閉じる。
// 呼び出し側が事前に破棄を確認する前提で、ここでは確認しない
const closeTabsAtOrInside = (absolutePath: string): void => {
  setOpenFilesAndFixActive((prev) => prev.filter((f) => !isPathAtOrInside(f.path, absolutePath)))
}

const hasDirtyTabAtOrInside = (absolutePath: string): boolean =>
  openFilesMirrorRef.current.some(
    (f) => isPathAtOrInside(f.path, absolutePath) && f.content !== f.savedContent
  )
```

戻り値のオブジェクトに `reloadOpenFile`、`closeTabsAtOrInside`、`hasDirtyTabAtOrInside` を追加する。

`setOpenFilesAndFixActive` と `openFilesMirrorRef` の実際の名前がこのファイルの既存コードと一致しているかを確認してから使う（`reloadOpenFiles` の実装が使っているものと同じ）。

- [ ] **Step 4: 通過とミューテーションを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useFileSystem.test.ts && npm run typecheck`
Expected: PASS

`reloadOpenFile` の `if (!isSamePath(f.path, absolutePath)) return [f]` を `return [{ ...f, content, savedContent: content }]` の全タブ更新に変えると「他のタブの編集は残す」テストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/hooks/useFileSystem.ts src/renderer/src/hooks/__tests__/useFileSystem.test.ts
git commit -m "feat: 特定パスのタブだけを再読込・クローズする関数をuseFileSystemに追加する"
```

---

### Task 5: 確認文言と `useDiscardFileChanges`

**Files:**

- Create: `src/renderer/src/lib/discardConfirmMessage.ts`、`src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts`、`src/renderer/src/hooks/useDiscardFileChanges.ts`、`src/renderer/src/hooks/__tests__/useDiscardFileChanges.test.ts`
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Test: `src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: `discardFile`（Task 3）、`reloadOpenFile` / `closeTabsAtOrInside` / `hasDirtyTabAtOrInside`（Task 4）、`isUntrackedFile`（既存 `lib/gitUtils`）、`joinPath`（既存 `lib/pathUtils`）
- Produces: `buildDiscardConfirmMessage({ path, isUntracked, hasUnsavedEdits }): string`、`useDiscardFileChanges(options): (path: string) => Promise<boolean>`、`AppState.discardFile: (path: string) => Promise<boolean>`（`useAppState` で `gitOperations.discardFile` を上書きして公開する）

**最終レビューでの追加:** 取り消しの成功後にファイルツリーを読み直すため、`useDiscardFileChanges` に `refreshTree: () => Promise<unknown>`（`useAppState` から `fileSystem.refreshTree` を渡す。実際の戻り値は `Promise<boolean>`）を注入し、成功時だけ呼ぶ（reject は握り潰す）。以下のコード例はこの追加前の内容で、現行コードは `src/renderer/src/hooks/useDiscardFileChanges.ts` を参照すること。

- [ ] **Step 1: 確認文言のテストを書く**

`src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDiscardConfirmMessage } from '../discardConfirmMessage'

describe('buildDiscardConfirmMessage', () => {
  it('追跡済みは「元に戻せません」と伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'src/a.ts', isUntracked: false, hasUnsavedEdits: false })
    ).toBe('src/a.ts の変更を取り消しますか？この操作は元に戻せません。')
  })

  it('未追跡はゴミ箱へ移動すると伝える', () => {
    expect(
      buildDiscardConfirmMessage({ path: 'new.txt', isUntracked: true, hasUnsavedEdits: false })
    ).toBe('new.txt をゴミ箱へ移動しますか？')
  })

  it.each([false, true])(
    '未保存の編集がある場合はエディタの編集も破棄されることを追記する(未追跡=%s)',
    (isUntracked) => {
      const message = buildDiscardConfirmMessage({
        path: 'a.ts',
        isUntracked,
        hasUnsavedEdits: true
      })
      expect(message.endsWith('\n\nエディタの未保存の編集も破棄されます。')).toBe(true)
    }
  )
})
```

- [ ] **Step 2: `useDiscardFileChanges` のテストを書く**

`src/renderer/src/hooks/__tests__/useDiscardFileChanges.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import { useDiscardFileChanges } from '../useDiscardFileChanges'

const files: GitFileStatus[] = [
  { path: 'src/a.ts', index: ' ', workingDir: 'M' },
  { path: 'new.txt', index: '?', workingDir: '?' },
  { path: 'newdir/', index: '?', workingDir: '?' }
]

const setup = (overrides: Partial<Parameters<typeof useDiscardFileChanges>[0]> = {}) => {
  const options = {
    folderPath: '/project',
    files,
    discardFile: vi.fn().mockResolvedValue(true),
    hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
    reloadOpenFile: vi.fn().mockResolvedValue(undefined),
    closeTabsAtOrInside: vi.fn(),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const { result } = renderHook(() => useDiscardFileChanges(options))
  return { discard: (path: string) => result.current(path), options }
}

describe('useDiscardFileChanges', () => {
  it('確認でキャンセルしたら取り消しもタブの同期もしない', async () => {
    const { discard, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    let result = true
    await act(async () => {
      result = await discard('src/a.ts')
    })
    expect(result).toBe(false)
    expect(options.discardFile).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('追跡済みは成功後に対象タブだけを再読込する(絶対パスで渡す)', async () => {
    const { discard, options } = setup()
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'src/a.ts の変更を取り消しますか？この操作は元に戻せません。'
    )
    expect(options.discardFile).toHaveBeenCalledWith('src/a.ts')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/project/src/a.ts')
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
  })

  it('未追跡は成功後に対象と配下のタブを閉じる', async () => {
    const { discard, options } = setup()
    await act(async () => {
      await discard('newdir/')
    })
    expect(options.onConfirm).toHaveBeenCalledWith('newdir/ をゴミ箱へ移動しますか？')
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/project/newdir/')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('対象のタブに未保存の編集があれば、確認文言に追記する', async () => {
    const { discard, options } = setup({ hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true) })
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/project/src/a.ts')
    expect(options.onConfirm).toHaveBeenCalledWith(
      'src/a.ts の変更を取り消しますか？この操作は元に戻せません。\n\nエディタの未保存の編集も破棄されます。'
    )
  })

  // 失敗・no-op で同期すると、取り消されていないファイルのタブの未保存の編集が
  // ディスクの内容で上書きされて失われる(docs/review-findings-patterns.md パターン20)
  it('取り消しが成功しなかったらタブに触れない', async () => {
    const { discard, options } = setup({ discardFile: vi.fn().mockResolvedValue(false) })
    let result = true
    await act(async () => {
      result = await discard('src/a.ts')
    })
    expect(result).toBe(false)
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
  })

  it('フォルダが開かれていなければ何もしない', async () => {
    const { discard, options } = setup({ folderPath: null })
    await act(async () => {
      await discard('src/a.ts')
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.discardFile).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts src/renderer/src/hooks/__tests__/useDiscardFileChanges.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 4: 実装する**

`src/renderer/src/lib/discardConfirmMessage.ts`:

```ts
interface DiscardConfirmMessageOptions {
  /** リポジトリ相対パス(git status の表記) */
  path: string
  /** 未追跡ならゴミ箱への移動、追跡済みなら index の内容への復元 */
  isUntracked: boolean
  /** 対象(未追跡ディレクトリなら配下)のタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
}

// 変更の取り消しの確認文言。エディタの未保存の編集の破棄も 1 回の確認で承諾させる
// (確認を 2 回に分けると、片方だけ承諾された中途半端な状態の扱いが必要になるため)
export function buildDiscardConfirmMessage({
  path,
  isUntracked,
  hasUnsavedEdits
}: DiscardConfirmMessageOptions): string {
  const base = isUntracked
    ? `${path} をゴミ箱へ移動しますか？`
    : `${path} の変更を取り消しますか？この操作は元に戻せません。`
  return hasUnsavedEdits ? `${base}\n\nエディタの未保存の編集も破棄されます。` : base
}
```

`src/renderer/src/hooks/useDiscardFileChanges.ts`:

```ts
import type { GitFileStatus } from '@shared/types'
import { isUntrackedFile } from '../lib/gitUtils'
import { joinPath } from '../lib/pathUtils'
import { buildDiscardConfirmMessage } from '../lib/discardConfirmMessage'

export interface DiscardFileChangesOptions {
  folderPath: string | null
  /** git status のファイル一覧(未追跡かどうかの判定に使う) */
  files: GitFileStatus[]
  /** useGitOperations.discardFile。実行され成功したら true */
  discardFile: (path: string) => Promise<boolean>
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  onConfirm?: (message: string) => boolean
}

// 変更の取り消しを「確認 → 取り消し → 成功時だけタブを同期」の順で行う。
// 取り消しは working tree のファイルを直接書き換える(未追跡はゴミ箱へ移す)ため、
// エディタで開いているタブの内容が古くなる(docs/review-findings-patterns.md パターン19)。
// 失敗・no-op のときに同期すると、取り消されていないファイルの未保存の編集が
// ディスクの内容で上書きされて失われるため、成功時だけ同期する(パターン20)。
// 取り消し実行中に対象ファイルへ保存が割り込むレースは、ブランチ切り替え
// (useAppState.ts の checkoutBranch)と同じ既知の制約として扱う
export function useDiscardFileChanges({
  folderPath,
  files,
  discardFile,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  onConfirm = confirm
}: DiscardFileChangesOptions): (path: string) => Promise<boolean> {
  return async (path) => {
    if (folderPath === null) return false
    const absolutePath = joinPath(folderPath, path)
    const file = files.find((f) => f.path === path)
    const isUntracked = file !== undefined && isUntrackedFile(file)
    const message = buildDiscardConfirmMessage({
      path,
      isUntracked,
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(message)) return false
    const succeeded = await discardFile(path)
    if (!succeeded) return false
    if (isUntracked) closeTabsAtOrInside(absolutePath)
    else await reloadOpenFile(absolutePath)
    return true
  }
}
```

`useAppState.ts`: import に `useDiscardFileChanges` を追加し、`checkoutBranch` ラッパーの直後に追加する:

```ts
// 変更の取り消しは、確認・取り消し・エディタのタブ同期の組み立てを
// useDiscardFileChanges に任せ、ここでは依存を渡すだけにする
const discardFile = useDiscardFileChanges({
  folderPath: fileSystem.folderPath,
  files: git.gitStatus?.files ?? [],
  discardFile: gitOperations.discardFile,
  hasDirtyTabAtOrInside: fileSystem.hasDirtyTabAtOrInside,
  reloadOpenFile: fileSystem.reloadOpenFile,
  closeTabsAtOrInside: fileSystem.closeTabsAtOrInside
})
```

戻り値の末尾（`checkoutBranch` の後）に `discardFile` を追加し、spread された `gitOperations.discardFile` を上書きする。`AppState` の型は `ReturnType<typeof useGitOperations>` の `discardFile` と同じ型なので変更不要。

- [ ] **Step 5: `useAppState` の配線テストを書く**

`useAppState.test.ts` の `mockUseFileSystem` の戻り値の型に `hasDirtyTabAtOrInside?` / `reloadOpenFile?` / `closeTabsAtOrInside?` を追加し、`describe('checkoutBranch ラッパー')` の後に追加する（`window.api.discardChanges` を差し替え、`window.confirm` は `vi.spyOn(window, 'confirm')` で差し替えて `mockRestore` する。gitStatus は `mockUseGitStatus.mockReturnValue` で `files: [{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]` を与える）:

```ts
describe('discardFile ラッパー', () => {
  it('確認後に取り消し、成功したら対象タブを絶対パスで再読込する', async () => {
    const reloadOpenFile = vi.fn().mockResolvedValue(undefined)
    mockUseFileSystem.mockReturnValue({
      ...mockUseFileSystem(),
      folderPath: '/project',
      hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
      reloadOpenFile,
      closeTabsAtOrInside: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn().mockResolvedValue(undefined)
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const original = window.api.discardChanges
    window.api.discardChanges = vi.fn().mockResolvedValue(undefined)
    try {
      const { result } = renderHook(() => useAppState())
      await act(async () => {
        await result.current.discardFile('src/a.ts')
      })
      expect(confirmSpy).toHaveBeenCalled()
      expect(window.api.discardChanges).toHaveBeenCalledWith('src/a.ts')
      expect(reloadOpenFile).toHaveBeenCalledWith('/project/src/a.ts')
    } finally {
      window.api.discardChanges = original
      confirmSpy.mockRestore()
    }
  })
})
```

- [ ] **Step 6: 通過とミューテーションを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts src/renderer/src/hooks/__tests__/useDiscardFileChanges.test.ts src/renderer/src/hooks/__tests__/useAppState.test.ts && npm run typecheck`
Expected: PASS

`if (!succeeded) return false` を消すと「成功しなかったらタブに触れない」テストが、`useAppState` の戻り値の `discardFile` 上書きを消すと配線テストが落ちることを確認してから戻す。

- [ ] **Step 7: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/lib/discardConfirmMessage.ts src/renderer/src/lib/__tests__/discardConfirmMessage.test.ts src/renderer/src/hooks/useDiscardFileChanges.ts src/renderer/src/hooks/__tests__/useDiscardFileChanges.test.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts
git commit -m "feat: 確認とエディタのタブ同期を伴う変更の取り消しフックを追加する"
```

---

### Task 6: `ChangesSection` の取り消しボタンと配線

**Files:**

- Modify: `src/renderer/src/components/source-control/ChangesSection.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/assets/main.css`
- Test: `__tests__/ChangesSection.test.tsx`、`__tests__/GitRepoView.test.tsx`、`__tests__/SourceControlPanel.test.tsx`、`src/renderer/src/components/__tests__/Sidebar.test.tsx`、新規 `__tests__/ChangesSection.styles.test.tsx`

**Interfaces:**

- Consumes: `AppState.discardFile`（Task 5）、`isConflictedFile`（Task 3）
- Produces: 各コンポーネントの Props `onDiscard: (path: string) => void`（App では `onDiscardFile={discardFile}` → Sidebar の `onDiscardFile` → SourceControlPanel / GitRepoView / ChangesSection の `onDiscard`。既存の `onStageFile` → `onStage` と同じ命名規則）

- [ ] **Step 1: 失敗するテストを書く**

`ChangesSection.test.tsx`: 既存の `render(<ChangesSection ... />)` すべてに `onDiscard={vi.fn()}` を足し、末尾に追加:

```tsx
describe('取り消しボタン', () => {
  it('各行に取り消しボタンがあり、押すと onDiscard がパスで呼ばれる', async () => {
    const onDiscard = vi.fn()
    render(
      <ChangesSection
        files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={onDiscard}
        onOpenDiff={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' }))
    expect(onDiscard).toHaveBeenCalledWith('src/a.ts')
  })

  it('未追跡ファイルにも取り消しボタンがある', () => {
    render(
      <ChangesSection
        files={[{ path: 'new.txt', index: '?', workingDir: '?' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'new.txt の変更を取り消し' })).toBeInTheDocument()
  })

  // main 側も ls-files -u で拒否するが、押せるのに必ず失敗するボタンを出さない
  it('コンフリクト中の行には取り消しボタンを出さない', () => {
    render(
      <ChangesSection
        files={[{ path: 'c.txt', index: 'U', workingDir: 'U' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'c.txt の変更を取り消し' })).not.toBeInTheDocument()
  })

  it.each([
    ['他の stage/unstage/取り消しの実行中', { stagingPaths: new Set(['other.ts']) }],
    ['他の操作がロック中', { isAnyLocked: () => true }],
    ['対象パスがロック中', { isLocked: (p: string) => p === 'src/a.ts' }]
  ] as const)('%s は disabled になる', (_label, props) => {
    render(
      <ChangesSection
        files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
        {...props}
      />
    )
    expect(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' })).toBeDisabled()
  })
})
```

`GitRepoView.test.tsx` / `SourceControlPanel.test.tsx` / `Sidebar.test.tsx` の Props（`baseProps` と JSX に直接並べている箇所）に `onDiscard: vi.fn()`（Sidebar は `onDiscardFile: vi.fn()`）を足し、`GitRepoView.test.tsx` に配線のテストを 1 件追加:

```tsx
it('ChangesSection の取り消しボタンから onDiscard が呼ばれる', async () => {
  const onDiscard = vi.fn()
  render(
    <GitRepoView
      {...baseProps}
      files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
      onDiscard={onDiscard}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' }))
  expect(onDiscard).toHaveBeenCalledWith('src/a.ts')
})
```

`ChangesSection.styles.test.tsx`（`BranchSwitcherMenu.styles.test.tsx` と同じく実際の `main.css` を読み込み、`getComputedStyle` で宣言値を検証する）:

```tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import ChangesSection from '../ChangesSection'

let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('ChangesSection のスタイル(main.css)', () => {
  // 取り消しボタンはステージボタンと同じ見た目・大きさにする
  it('取り消しボタンはステージボタンと同じ大きさ', () => {
    render(
      <ChangesSection
        files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    const discard = getComputedStyle(
      screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' })
    )
    const stage = getComputedStyle(screen.getByRole('button', { name: 'src/a.ts をステージ' }))
    expect(discard.width).toBe(stage.width)
    expect(discard.height).toBe(stage.height)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/components/source-control src/renderer/src/components/__tests__/Sidebar.test.tsx`
Expected: FAIL（取り消しボタンが無い、Props が無い）

- [ ] **Step 3: 実装する**

`ChangesSection.tsx`:

- import に `isConflictedFile` を追加する
- Props に追加: `/** 取り消しボタン。確認・タブの同期は呼び出し元(useDiscardFileChanges)が行う */ onDiscard: (path: string) => void`
- 各行の `+` ボタンを次の操作列で包む（ステージボタンの disabled 条件を変数にまとめ、取り消しボタンと共有する）:

```tsx
{
  changed.map((f) => {
    // 取り消しもステージと同じ直列化(useGitOperations.runStageOperation)で実行される
    // ため、ボタンの disabled 条件も共有する(パターン14)
    const isOperationBlocked = stagingPaths.size > 0 || isLocked(f.path) || isAnyLocked()
    return (
      <li key={f.path} className="source-control-panel__file-item">
        {/* ステータス文字と diff ボタンは既存のまま */}
        <div className="source-control-panel__file-actions">
          {!isConflictedFile(f) && (
            <button
              type="button"
              className="source-control-panel__discard-btn"
              onClick={() => onDiscard(f.path)}
              disabled={isOperationBlocked}
              aria-label={`${f.path} の変更を取り消し`}
            >
              ↶
            </button>
          )}
          <button
            type="button"
            className="source-control-panel__stage-btn"
            onClick={() => onStage(f.path)}
            disabled={isOperationBlocked}
            aria-label={`${f.path} をステージ`}
          >
            +
          </button>
        </div>
      </li>
    )
  })
}
```

`main.css`: `.source-control-panel__stage-btn, .source-control-panel__unstage-btn` の各規則（基本・hover 表示・`:hover`・`:disabled`）のセレクタ一覧に `.source-control-panel__discard-btn` を追加する。さらに次を追加する:

```css
/* 行の右端に操作ボタン(取り消し・ステージ)を並べる。ボタン自身の margin-left: auto は
   ボタンが 1 つだけの前提だったため、並べる場合は外側の列で右寄せする */
.source-control-panel__file-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
}

.source-control-panel__file-actions .source-control-panel__stage-btn,
.source-control-panel__file-actions .source-control-panel__discard-btn {
  margin-left: 0;
}
```

`GitRepoView.tsx` / `SourceControlPanel.tsx`: Props に `onDiscard: (path: string) => void` を追加し、`onStage` の直後で子へ渡す。`Sidebar.tsx`: Props に `onDiscardFile: (path: string) => void` を追加し、`onDiscard={onDiscardFile}` で渡す。`App.tsx`: `useAppState()` の分割代入に `discardFile` を追加し、`<Sidebar ... onStageFile={stageFile}` の直後に `onDiscardFile={(path) => void discardFile(path)}` を追加する（戻り値の Promise を捨てるため）。

- [ ] **Step 4: 通過を確認する**

Run: `npm test && npm run typecheck && npx eslint src/renderer/src/components/source-control/ChangesSection.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx`
Expected: すべて PASS

`!isConflictedFile(f) &&` を消すとコンフリクト行のテストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add -u src/renderer/src
git add src/renderer/src/components/source-control/__tests__/ChangesSection.styles.test.tsx
git commit -m "feat: ソース管理パネルの変更一覧にファイル単位の取り消しボタンを追加する"
```

---

### Task 7: ROADMAP の更新と実機確認

**Files:**

- Modify: `ROADMAP.md`

- [ ] **Step 1: ROADMAP を更新する**

「実装済み機能 > ソース管理（Git 操作）」の `- [x] ブランチの作成…` の直後に追加:

```markdown
- [x] 変更の取り消し（ファイル単位。追跡済みは index の内容へ戻し、未追跡は OS のゴミ箱へ移動）
```

「今後実装した方がよい機能 > ソース管理（Git）」の `- [ ] 変更の取り消し（discard）` を次に置き換える:

```markdown
- [ ] 変更の取り消しの拡張（ハンク単位・一括取り消し。ファイル単位は実装済み）
```

同セクションの説明文の「マージや変更の取り消し、stash などは」を「マージや stash などは」に直す。

- [ ] **Step 2: 最終検証**

Run: `npm test && npm run typecheck && npx prettier --check ROADMAP.md`
Expected: すべて PASS

- [ ] **Step 3: Electron 実機で確認する（可能な場合）**

一時ディレクトリにリポジトリを作り（追跡済みファイルの変更、ステージ済み + 未ステージの混在、削除したファイル、未追跡ファイル、未追跡ディレクトリ）、`npm run dev` で開いて次を確認する:

1. 追跡済みの変更の取り消し（確認文言、取り消し後に一覧から消える）
2. ステージ済み + 未ステージの混在で、ステージ済みの内容が残る
3. 削除したファイルが復元される
4. 未追跡ファイル・ディレクトリがゴミ箱へ移動する
5. 開いているタブ: 未保存の編集がある場合の追記文言、取り消し後の再読込・クローズ、他のタブの編集が残る

GUI を自動操作できない環境では、起動してビルド・起動時のエラーが無いことだけを確認し、未実施の項目を報告に残す。確認後は `pgrep -fl "Desktop/prompt-ide"` で対象を確認してから、起動した dev サーバーと Electron を停止する。

- [ ] **Step 4: コミット（ユーザーの指示がある場合のみ）**

```bash
git add ROADMAP.md
git commit -m "docs: 変更の取り消しの実装完了をROADMAPに反映する"
```
