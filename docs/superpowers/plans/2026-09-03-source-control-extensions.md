# ソース管理機能拡張 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** diff 表示・ハンク単位のステージ/アンステージ・コミット履歴/ブランチ/タグの一覧表示・コミットの amend・`.gitignore` への追加補助を、ソース管理パネルに追加する。

**Architecture:** 既存の 5 層構成（`gitService.ts` → `gitHandlers.ts`(IPC) → `preload` → `renderer/lib/gitApi.ts` → hooks → UI）をそのまま踏襲する。diff タブは既存の実ファイルタブ管理（`useFileSystem.ts`）とは独立した新規フック `useDiffTabs` で管理し、タブバー（`EditorPanel.tsx`/`EditorTabs.tsx`）でのみ両者を合成する。ハンク単位ステージは unified diff のハンクをそのままパッチとして `git apply --cached` に渡す方式（VSCode 等と同様の標準的な方式）。

**Tech Stack:** Electron, React, TypeScript, simple-git（既存依存）, Node.js `child_process`（`git apply` の stdin 渡しに使用、追加インストール不要）, Vitest, Testing Library

## Global Constraints

- すべてのコミットメッセージは日本語・Conventional Commit 形式（CLAUDE.md）
- 型としてのみ使う import は `import type` を使う（CLAUDE.md）
- テストは `__tests__/` 同階層配置、Vitest + Testing Library、`describe`/`it` は日本語（既存パターン踏襲）
- `git commit` は各タスクの最後に行うが、ユーザーへの `git push` は行わない
- 各タスク完了時に `npm run typecheck` と対象テストファイルの `npm test` を実行し、パスすることを確認してからコミットする
- ブランチの切り替え・作成・削除・マージ、push/pull/fetch、リモート管理・clone、blame、stash、discard、マージコンフリクト解決 UI は今回のスコープ外（別途）
- コミット履歴の各コミットをクリックしたときの diff 表示は今回のスコープ外（一覧表示のみ）
- ファイルパスを扱う IPC ハンドラは既存の `resolve(allowedFolder, filePath)` → `assertFileWithinFolder`（ENOENT フォールバック込み）のパターンを踏襲する

---

### Task 1: `gitService.ts` に `getDiff` を追加する

**Files:**
- Modify: `src/main/gitService.ts`
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function getDiff(folderPath: string, filePath: string, staged: boolean): Promise<string>
  ```
  未追跡ファイル（`git status` で `index === '?'`）の場合は `git diff` が空文字列を返すため、
  ファイル内容を読んで「全行追加」の疑似 unified diff テキストを組み立てて返す。

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitService.test.ts` の `mockSimpleGit` に `diff` と `status` のモックを追加する
（`status` は既存の `getGitStatus` テストで使われているものを流用できる想定だが、`getDiff` 用に
未追跡ファイル判定で使うため、モック関数として明示的に用意する）。ファイル冒頭のモック定義を以下に
拡張する:

```ts
const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockStatus = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockDiff = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({
    checkIsRepo: mockCheckIsRepo,
    status: mockStatus,
    add: mockAdd,
    reset: mockReset,
    commit: mockCommit,
    diff: mockDiff,
  }))
)

vi.mock('simple-git', () => ({ default: mockSimpleGit }))
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }))

const mockReadFile = vi.hoisted(() => vi.fn())

import { getGitStatus, stageFile, unstageFile, commit, getDiff } from '../gitService'
```

（`vi.mock('node:fs/promises', ...)` は `mockReadFile` の宣言より前に書くと `vi.hoisted` を使わない
限り参照エラーになるため、上記の順序（`mockReadFile` の `vi.hoisted` 定義 → `vi.mock` 呼び出し）を
守ること。`vi.mock` はファイル内で自動的にトップへ巻き上げられるが、`vi.hoisted` で作った変数への
参照は巻き上げ後も解決できるため、変数定義の記述位置は `vi.mock` の前後どちらでも動作する。ただし
可読性のため、上記の並び順（モック関数定義 → `vi.mock`）を維持すること。）

ファイル末尾に以下を追加する:

```ts
describe('getDiff', () => {
  it('未ステージの変更を simpleGit を folderPath で呼び、diff を [\'-U3\', \'--\', filePath] で呼ぶ', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: 'M' }] })
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', false)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockDiff).toHaveBeenCalledWith(['-U3', '--', 'src/index.ts'])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it('ステージ済みの変更を diff を [\'--cached\', \'-U3\', \'--\', filePath] で呼ぶ', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: ' ' }] })
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', true)
    expect(mockDiff).toHaveBeenCalledWith(['--cached', '-U3', '--', 'src/index.ts'])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it('未追跡ファイル(index === "?")の場合、diff を呼ばずファイル内容から疑似diffを組み立てる', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'new.txt', index: '?', working_dir: '?' }] })
    mockReadFile.mockResolvedValue('line1\nline2\n')
    const result = await getDiff('/project', 'new.txt', false)
    expect(mockDiff).not.toHaveBeenCalled()
    expect(mockReadFile).toHaveBeenCalledWith('/project/new.txt', 'utf-8')
    expect(result).toContain('--- /dev/null')
    expect(result).toContain('+++ b/new.txt')
    expect(result).toContain('+line1')
    expect(result).toContain('+line2')
  })

  it('diff が throw した場合エラーが伝播する', async () => {
    mockStatus.mockResolvedValue({ files: [{ path: 'src/index.ts', index: 'M', working_dir: 'M' }] })
    mockDiff.mockRejectedValue(new Error('diff failed'))
    await expect(getDiff('/project', 'src/index.ts', false)).rejects.toThrow('diff failed')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: FAIL（`getDiff` が存在しない）

- [ ] **Step 3: `gitService.ts` に実装を追加する**

`src/main/gitService.ts` の冒頭 import を以下に変更する:

```ts
import { join } from 'path'
import { readFile } from 'node:fs/promises'
import simpleGit from 'simple-git'
import type { GitStatusResult } from '@shared/types'
```

ファイル末尾（既存の `commit` 関数の後）に以下を追加する:

```ts
function buildUntrackedDiff(filePath: string, content: string): string {
  const lines = content.split('\n')
  // 末尾の空行は split の仕様上、実ファイルに無い余分な要素になるため取り除く
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const addedLines = lines.map((line) => `+${line}`).join('\n')
  return (
    `diff --git a/${filePath} b/${filePath}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${filePath}\n` +
    `@@ -0,0 +1,${lines.length} @@\n` +
    `${addedLines}\n`
  )
}

export async function getDiff(
  folderPath: string,
  filePath: string,
  staged: boolean
): Promise<string> {
  const git = simpleGit(folderPath)
  if (!staged) {
    const status = await git.status()
    const file = status.files.find((f) => f.path === filePath)
    if (file !== undefined && file.index === '?') {
      const content = await readFile(join(folderPath, filePath), 'utf-8')
      return buildUntrackedDiff(filePath, content)
    }
  }
  const args = staged ? ['--cached', '-U3', '--', filePath] : ['-U3', '--', filePath]
  return git.diff(args)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/gitService.ts && npx vitest run src/main/__tests__/gitService.test.ts; git stash pop`
Expected: 新規追加した4件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "$(cat <<'EOF'
feat: gitServiceにgetDiffを追加する

未ステージ・ステージ済みの差分取得に加え、未追跡ファイルは
ファイル内容から全行追加の疑似diffを組み立てて返す。
EOF
)"
```

---

### Task 2: `gitService.ts` に `stageHunk`/`unstageHunk` を追加する

**Files:**
- Modify: `src/main/gitService.ts`
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function stageHunk(folderPath: string, filePath: string, patch: string): Promise<void>
  export async function unstageHunk(folderPath: string, filePath: string, patch: string): Promise<void>
  ```
  `patch` は 1 ハンク分の完全な unified diff テキスト（`diff --git ...` ヘッダーから
  `@@ ... @@` とその本文までを含む）。`simple-git` は標準入力を伴うコマンド実行を
  サポートしないため、Node の `child_process.spawn` で `git apply` を直接実行する。

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/gitService.test.ts` の冒頭に `node:child_process` のモックを追加する
（既存の `vi.mock('simple-git', ...)` の下に追記）:

```ts
const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: mockSpawn }))
```

import 文に `stageHunk`/`unstageHunk` を追加する:

```ts
import { getGitStatus, stageFile, unstageFile, commit, getDiff, stageHunk, unstageHunk } from '../gitService'
```

ファイル末尾に以下を追加する（`EventEmitter` ベースの疑似 child process を作るヘルパーも併記）:

```ts
import { EventEmitter } from 'node:events'

function createMockProcess(): {
  proc: EventEmitter & { stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }; stderr: EventEmitter }
  emitClose: (code: number) => void
  emitStderr: (data: string) => void
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    stderr: EventEmitter
  }
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  proc.stderr = new EventEmitter()
  return {
    proc,
    emitClose: (code: number) => proc.emit('close', code),
    emitStderr: (data: string) => proc.stderr.emit('data', Buffer.from(data)),
  }
}

describe('stageHunk', () => {
  it('git apply --cached を実行し、patch を stdin に書き込む', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith('git', ['apply', '--cached', '--whitespace=nowarn', '-'], {
      cwd: '/project',
    })
    expect(proc.stdin.write).toHaveBeenCalledWith('PATCH_TEXT')
    expect(proc.stdin.end).toHaveBeenCalled()
  })

  it('プロセスが非ゼロ終了コードの場合、stderr を含むエラーで reject する', async () => {
    const { proc, emitClose, emitStderr } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = stageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitStderr('patch does not apply')
    emitClose(1)
    await expect(promise).rejects.toThrow(/patch does not apply/)
  })
})

describe('unstageHunk', () => {
  it('git apply --cached --reverse を実行する', async () => {
    const { proc, emitClose } = createMockProcess()
    mockSpawn.mockReturnValue(proc)
    const promise = unstageHunk('/project', 'src/index.ts', 'PATCH_TEXT')
    emitClose(0)
    await promise
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
      { cwd: '/project' }
    )
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: FAIL（`stageHunk`/`unstageHunk` が存在しない）

- [ ] **Step 3: `gitService.ts` に実装を追加する**

冒頭 import に `spawn` を追加する:

```ts
import { spawn } from 'node:child_process'
import { join } from 'path'
import { readFile } from 'node:fs/promises'
import simpleGit from 'simple-git'
import type { GitStatusResult } from '@shared/types'
```

ファイル末尾に以下を追加する:

```ts
function runGitApply(cwd: string, filePath: string, args: string[], input: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', args, { cwd })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code: number) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`git apply failed for ${filePath}: ${stderr.trim()}`))
      }
    })
    proc.stdin.write(input)
    proc.stdin.end()
  })
}

export async function stageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  await runGitApply(folderPath, filePath, ['apply', '--cached', '--whitespace=nowarn', '-'], patch)
}

export async function unstageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  await runGitApply(
    folderPath,
    filePath,
    ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
    patch
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/gitService.ts && npx vitest run src/main/__tests__/gitService.test.ts; git stash pop`
Expected: 新規追加した3件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "$(cat <<'EOF'
feat: gitServiceにstageHunk/unstageHunkを追加する

simple-gitは標準入力を伴うコマンドをサポートしないため、
child_process.spawnでgit applyを直接実行しハンク単位のパッチを適用する。
EOF
)"
```

---

### Task 3: `gitService.ts` に `getLog`/`getBranches`/`getTags`/`amendCommit` を追加する

**Files:**
- Modify: `src/main/gitService.ts`
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**
- Consumes: `src/shared/types/git.ts` に Task 3 で追加する `GitLogEntry`/`GitBranch`
- Produces:
  ```ts
  export async function getLog(folderPath: string, limit: number, skip: number): Promise<GitLogEntry[]>
  export async function getBranches(folderPath: string): Promise<GitBranch[]>
  export async function getTags(folderPath: string): Promise<string[]>
  export async function amendCommit(folderPath: string, message: string): Promise<void>
  ```

- [ ] **Step 1: 型定義を追加する**

`src/shared/types/git.ts` の末尾に以下を追加する:

```ts
export type GitLogEntry = {
  hash: string
  message: string
  date: string
  authorName: string
}

export type GitBranch = {
  name: string
  current: boolean
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/main/__tests__/gitService.test.ts` の `mockSimpleGit` に `raw`/`branchLocal`/`tags` を追加する:

```ts
const mockRaw = vi.hoisted(() => vi.fn())
const mockBranchLocal = vi.hoisted(() => vi.fn())
const mockTags = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({
    checkIsRepo: mockCheckIsRepo,
    status: mockStatus,
    add: mockAdd,
    reset: mockReset,
    commit: mockCommit,
    diff: mockDiff,
    raw: mockRaw,
    branchLocal: mockBranchLocal,
    tags: mockTags,
  }))
)
```

import 文に追加関数を足す:

```ts
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getBranches,
  getTags,
  amendCommit,
} from '../gitService'
```

ファイル末尾に以下を追加する:

```ts
describe('getLog', () => {
  it('git log を --max-count/--skip/--pretty オプションで呼び、レコードをパースして返す', async () => {
    const record =
      'abc123\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e' +
      'def456\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e'
    mockRaw.mockResolvedValue(record)
    const result = await getLog('/project', 20, 0)
    expect(mockRaw).toHaveBeenCalledWith([
      'log',
      '--max-count=20',
      '--skip=0',
      '--pretty=format:%H%x1f%s%x1f%aI%x1f%an%x1e',
    ])
    expect(result).toEqual([
      { hash: 'abc123', message: 'feat: 新機能', date: '2026-09-03T10:00:00+09:00', authorName: 'Alice' },
      { hash: 'def456', message: 'fix: バグ修正', date: '2026-09-02T10:00:00+09:00', authorName: 'Bob' },
    ])
  })

  it('コミットが無いリポジトリで raw が throw した場合、空配列を返す', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: your current branch does not have any commits yet'))
    const result = await getLog('/project', 20, 0)
    expect(result).toEqual([])
  })
})

describe('getBranches', () => {
  it('branchLocal の結果を GitBranch[] に変換する', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    const result = await getBranches('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(result).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
    ])
  })
})

describe('getTags', () => {
  it('tags の結果を string[] で返す', async () => {
    mockTags.mockResolvedValue({ all: ['v1.0.0', 'v1.1.0'] })
    const result = await getTags('/project')
    expect(result).toEqual(['v1.0.0', 'v1.1.0'])
  })
})

describe('amendCommit', () => {
  it('simpleGit を folderPath で呼び、commit を [\'--amend\'] オプション付きで呼ぶ', async () => {
    mockCommit.mockResolvedValue(undefined)
    await amendCommit('/project', 'feat: 修正後のメッセージ')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 修正後のメッセージ', ['--amend'])
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('amend failed'))
    await expect(amendCommit('/project', 'msg')).rejects.toThrow('amend failed')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: FAIL（`getLog`/`getBranches`/`getTags`/`amendCommit` が存在しない）

- [ ] **Step 4: `gitService.ts` に実装を追加する**

ファイル末尾に以下を追加する:

```ts
export async function getLog(folderPath: string, limit: number, skip: number): Promise<GitLogEntry[]> {
  const git = simpleGit(folderPath)
  const format = '%H%x1f%s%x1f%aI%x1f%an%x1e'
  let output: string
  try {
    output = await git.raw(['log', `--max-count=${limit}`, `--skip=${skip}`, `--pretty=format:${format}`])
  } catch {
    return []
  }
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, message, date, authorName] = record.split('\x1f')
      return { hash, message, date, authorName }
    })
}

export async function getBranches(folderPath: string): Promise<GitBranch[]> {
  const git = simpleGit(folderPath)
  const summary = await git.branchLocal()
  return summary.all.map((name) => ({ name, current: name === summary.current }))
}

export async function getTags(folderPath: string): Promise<string[]> {
  const git = simpleGit(folderPath)
  const result = await git.tags()
  return result.all
}

export async function amendCommit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.commit(message, ['--amend'])
}
```

`GitLogEntry`/`GitBranch` を import するため、冒頭の import 文を以下に変更する:

```ts
import type { GitStatusResult, GitLogEntry, GitBranch } from '@shared/types'
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/gitService.ts && npx vitest run src/main/__tests__/gitService.test.ts; git stash pop`
Expected: 新規追加した6件のテストが FAIL する

- [ ] **Step 7: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add -u src/shared/types/git.ts src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "$(cat <<'EOF'
feat: gitServiceにgetLog/getBranches/getTags/amendCommitを追加する

コミット履歴・ブランチ一覧・タグ一覧の取得と、コミットのamendを
追加する。git logは制御文字区切りのフォーマットで自前パースする。
EOF
)"
```

---

### Task 4: `gitHandlers.ts` に `git:getDiff`/`git:stageHunk`/`git:unstageHunk` を追加する

**Files:**
- Modify: `src/main/handlers/gitHandlers.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`

**Interfaces:**
- Consumes: Task 1/2 の `getDiff(folderPath, filePath, staged)`/`stageHunk(folderPath, filePath, patch)`/`unstageHunk(folderPath, filePath, patch)`
- Produces: IPC チャンネル `git:getDiff`（引数 `filePath: string, staged: boolean`）、
  `git:stageHunk`（引数 `filePath: string, patch: string`）、`git:unstageHunk`（同）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts` の冒頭 mock を拡張する:

```ts
const mockGetDiff = vi.hoisted(() => vi.fn())
const mockStageHunk = vi.hoisted(() => vi.fn())
const mockUnstageHunk = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
  getDiff: mockGetDiff,
  stageHunk: mockStageHunk,
  unstageHunk: mockUnstageHunk,
}))
```

`describe('registerGitHandlers', ...)` の閉じ括弧の直前に追加する:

```ts
  describe('git:getDiff', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', false)
      ).rejects.toThrow('No folder open')
    })

    it('境界チェック後、getDiff を解決済みパスと staged 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      const result = await getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', true)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', '/project/src/index.ts', true)
      expect(result).toBe('DIFF_TEXT')
    })
  })

  describe('git:stageHunk', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      ).rejects.toThrow('No folder open')
    })

    it('境界チェック後、stageHunk を解決済みパスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', '/project/src/index.ts', 'PATCH')
    })
  })

  describe('git:unstageHunk', () => {
    it('境界チェック後、unstageHunk を解決済みパスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', '/project/src/index.ts', 'PATCH')
    })
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: FAIL（`git:getDiff`/`git:stageHunk`/`git:unstageHunk` チャンネルが登録されていない）

- [ ] **Step 3: `gitHandlers.ts` に実装を追加する**

`import { getGitStatus, stageFile, unstageFile, commit } from '../gitService'` の行を以下に変更する:

```ts
import { getGitStatus, stageFile, unstageFile, commit, getDiff, stageHunk, unstageHunk } from '../gitService'
```

`ipcMain.handle('git:commit', ...)` ブロックの直前（`git:unstage` の直後）に以下を追加する:

```ts
  ipcMain.handle(
    'git:getDiff',
    async (event: IpcMainInvokeEvent, filePath: string, staged: boolean) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      return getDiff(allowedFolder, resolvedPath, staged)
    }
  )

  ipcMain.handle(
    'git:stageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      await stageHunk(allowedFolder, resolvedPath, patch)
    }
  )

  ipcMain.handle(
    'git:unstageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      await unstageHunk(allowedFolder, resolvedPath, patch)
    }
  )
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/handlers/gitHandlers.ts && npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts; git stash pop`
Expected: 新規追加した5件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts
git commit -m "$(cat <<'EOF'
feat: git:getDiff/git:stageHunk/git:unstageHunkのIPCハンドラを追加する

いずれもファイルパスの境界チェックを既存のassertFileWithinFolder
パターンで行ってから対応するgitService関数を呼ぶ。
EOF
)"
```

---

### Task 5: `gitHandlers.ts` に `git:getLog`/`git:getBranches`/`git:getTags`/`git:amendCommit` を追加する

**Files:**
- Modify: `src/main/handlers/gitHandlers.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`

**Interfaces:**
- Consumes: Task 3 の `getLog(folderPath, limit, skip)`/`getBranches(folderPath)`/`getTags(folderPath)`/`amendCommit(folderPath, message)`
- Produces: IPC チャンネル `git:getLog`（引数 `limit: number, skip: number`）、`git:getBranches`、
  `git:getTags`、`git:amendCommit`（引数 `message: string`）。いずれもファイルパスを扱わないため
  境界チェック不要（既存の `git:getStatus`/`git:commit` と同様）。

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts` の冒頭 mock に追加する:

```ts
const mockGetLog = vi.hoisted(() => vi.fn())
const mockGetBranches = vi.hoisted(() => vi.fn())
const mockGetTags = vi.hoisted(() => vi.fn())
const mockAmendCommit = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
  getDiff: mockGetDiff,
  stageHunk: mockStageHunk,
  unstageHunk: mockUnstageHunk,
  getLog: mockGetLog,
  getBranches: mockGetBranches,
  getTags: mockGetTags,
  amendCommit: mockAmendCommit,
}))
```

`describe('registerGitHandlers', ...)` の閉じ括弧の直前に追加する:

```ts
  describe('git:getLog', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と limit/skip を引数に getLog を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetLog.mockResolvedValue([])
      await getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)
      expect(mockGetLog).toHaveBeenCalledWith('/project', 20, 0)
    })
  })

  describe('git:getBranches', () => {
    it('folderAccess の allowedFolder を引数に getBranches を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetBranches.mockResolvedValue([])
      await getRegisteredHandler('git:getBranches')(makeEvent(1))
      expect(mockGetBranches).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:getTags', () => {
    it('folderAccess の allowedFolder を引数に getTags を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetTags.mockResolvedValue([])
      await getRegisteredHandler('git:getTags')(makeEvent(1))
      expect(mockGetTags).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:amendCommit', () => {
    it('folderAccess の allowedFolder と message を引数に amendCommit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockAmendCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:amendCommit')(makeEvent(1), 'feat: 修正後')
      expect(mockAmendCommit).toHaveBeenCalledWith('/project', 'feat: 修正後')
    })
  })
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: FAIL（4 チャンネルが登録されていない）

- [ ] **Step 3: `gitHandlers.ts` に実装を追加する**

import 文を以下に変更する:

```ts
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getBranches,
  getTags,
  amendCommit,
} from '../gitService'
```

`registerGitHandlers` 関数の閉じ括弧の直前に以下を追加する:

```ts
  ipcMain.handle('git:getLog', async (event: IpcMainInvokeEvent, limit: number, skip: number) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getLog(allowedFolder, limit, skip)
  })

  ipcMain.handle('git:getBranches', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getBranches(allowedFolder)
  })

  ipcMain.handle('git:getTags', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getTags(allowedFolder)
  })

  ipcMain.handle('git:amendCommit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await amendCommit(allowedFolder, message)
  })
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/handlers/gitHandlers.ts && npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts; git stash pop`
Expected: 新規追加した4件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts
git commit -m "$(cat <<'EOF'
feat: git:getLog/git:getBranches/git:getTags/git:amendCommitのIPCハンドラを追加する
EOF
)"
```

---

### Task 6: `.gitignore` 追加機能を main プロセスに追加する

**Files:**
- Modify: `src/main/fileSystem.ts`
- Modify: `src/main/handlers/fileSystemHandlers.ts`
- Test: `src/main/__tests__/fileSystem.test.ts`（無ければ新規作成、既存パターンがあれば倣う）
- Test: `src/main/__tests__/handlers/fileSystemHandlers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // fileSystem.ts
  export async function addToGitignore(folderPath: string, relativePath: string): Promise<void>
  ```
  IPC チャンネル `fs:addToGitignore`（引数 `targetPath: string`、フォルダルートからの相対パスへの
  変換は main 側で行う）。

- [ ] **Step 1: 既存テストパターンを確認する**

Run: `ls src/main/__tests__/fileSystem.test.ts`

存在すれば読んで既存のモックパターン（`node:fs/promises` のモック方法）に倣う。存在しなければ
Step 2 でファイルごと新規作成する。

- [ ] **Step 2: 失敗するテストを書く**

`src/main/__tests__/fileSystem.test.ts`（既存があれば追記、無ければ新規作成。新規作成の場合は
以下のモックパターンを使う）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}))

import { addToGitignore } from '../fileSystem'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('addToGitignore', () => {
  it('.gitignore が存在しない場合、新規作成して相対パスを書き込む', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFile).toHaveBeenCalledWith('/project/.gitignore', 'dist/\n', 'utf-8')
  })

  it('.gitignore が既存で末尾に改行がある場合、そのまま追記する', async () => {
    mockReadFile.mockResolvedValue('node_modules/\n')
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFile).toHaveBeenCalledWith('/project/.gitignore', 'node_modules/\ndist/\n', 'utf-8')
  })

  it('.gitignore が既存で末尾に改行が無い場合、改行を補ってから追記する', async () => {
    mockReadFile.mockResolvedValue('node_modules/')
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFile).toHaveBeenCalledWith('/project/.gitignore', 'node_modules/\ndist/\n', 'utf-8')
  })

  it('同じ行が既に存在する場合、書き込みを行わない', async () => {
    mockReadFile.mockResolvedValue('node_modules/\ndist/\n')
    await addToGitignore('/project', 'dist/')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    mockReadFile.mockRejectedValue(new Error('permission denied'))
    await expect(addToGitignore('/project', 'dist/')).rejects.toThrow('permission denied')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/fileSystem.test.ts`
Expected: FAIL（`addToGitignore` が存在しない）

- [ ] **Step 4: `fileSystem.ts` に実装を追加する**

既存の import 文に `readFile`/`writeFile`/`join` が無ければ追加した上で、ファイル末尾に以下を追加する
（`readFile`/`writeFile`/`join` が既にファイル内で import 済みの場合は重複させないこと。実装前に
ファイルの冒頭 import を確認すること）:

```ts
function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function addToGitignore(folderPath: string, relativePath: string): Promise<void> {
  const gitignorePath = join(folderPath, '.gitignore')
  let existingContent = ''
  try {
    existingContent = await readFile(gitignorePath, 'utf-8')
  } catch (err) {
    if (!isEnoent(err)) throw err
  }
  const existingLines = existingContent.split('\n').map((line) => line.trim())
  if (existingLines.includes(relativePath)) return
  const needsNewline = existingContent.length > 0 && !existingContent.endsWith('\n')
  const newContent = existingContent + (needsNewline ? '\n' : '') + relativePath + '\n'
  await writeFile(gitignorePath, newContent, 'utf-8')
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/fileSystem.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: `fileSystemHandlers.ts` の失敗するテストを書く**

`src/main/__tests__/handlers/fileSystemHandlers.test.ts` を読み、既存の `fs:deleteEntry` 等の
テストパターン（`makeFolderAccess`、`getRegisteredHandler` 等のヘルパー）に倣って、以下を
`describe('registerFileSystemHandlers', ...)` 内に追加する（モックには `addToGitignore` を追加）:

```ts
describe('fs:addToGitignore', () => {
  it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerFileSystemHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
    ).rejects.toThrow('No folder open')
  })

  it('assertWithinFolder で境界チェックし、フォルダルートからの相対パスで addToGitignore を呼ぶ', async () => {
    const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder,
    })
    registerFileSystemHandlers(mockIpcMain, folderAccess)
    mockAddToGitignore.mockResolvedValue(undefined)
    await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
    expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/dist')
    expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'dist')
  })
})
```

`mockAddToGitignore` は冒頭の `vi.mock('../../fileSystem', ...)` に追加する
（既存のモック対象一覧の実際の中身は `fileSystemHandlers.test.ts` を読んで確認し、
`addToGitignore: mockAddToGitignore` を追記すること）。

- [ ] **Step 7: テストが失敗することを確認する**

Run: `npx vitest run src/main/__tests__/handlers/fileSystemHandlers.test.ts`
Expected: FAIL（`fs:addToGitignore` チャンネルが登録されていない）

- [ ] **Step 8: `fileSystemHandlers.ts` に実装を追加する**

`registerFileSystemHandlers` 関数内、`fs:deleteEntry` ハンドラの直後に以下を追加する
（`relative` を `path` モジュールから import すること。ファイル冒頭の import 文を確認し、
既存の import 文に `relative` を追加する）:

```ts
  ipcMain.handle('fs:addToGitignore', async (event: IpcMainInvokeEvent, targetPath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await folderAccess.assertWithinFolder(allowedFolder, targetPath)
    const relativePath = relative(allowedFolder, targetPath)
    await addToGitignore(allowedFolder, relativePath)
  })
```

`import { ... } from '../fileSystem'` の行に `addToGitignore` を追加する。

- [ ] **Step 9: テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/fileSystemHandlers.test.ts`
Expected: PASS（全件）

- [ ] **Step 10: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/main/fileSystem.ts src/main/handlers/fileSystemHandlers.ts && npx vitest run src/main/__tests__/fileSystem.test.ts src/main/__tests__/handlers/fileSystemHandlers.test.ts; git stash pop`
Expected: 新規追加した7件のテストが FAIL する

- [ ] **Step 11: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 12: コミット**

```bash
git add -u src/main/fileSystem.ts src/main/handlers/fileSystemHandlers.ts \
  src/main/__tests__/fileSystem.test.ts src/main/__tests__/handlers/fileSystemHandlers.test.ts
git commit -m "$(cat <<'EOF'
feat: .gitignoreへのパス追加機能を追加する

fs:addToGitignore IPCハンドラを追加し、既存の.gitignoreへの追記
または新規作成を行う。重複するパスは追記しない。
EOF
)"
```

---

### Task 7: preload と `renderer/lib/gitApi.ts`/`fileSystemApi.ts` を更新する

**Files:**
- Modify: `src/preload/api.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/gitApi.ts`
- Modify: `src/renderer/src/lib/fileSystemApi.ts`
- Test: `src/renderer/src/lib/__tests__/gitApi.test.ts`
- Test: `src/renderer/src/lib/__tests__/fileSystemApi.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 の IPC チャンネル一式
- Produces:
  ```ts
  // renderer/lib/gitApi.ts
  export function getDiff(filePath: string, staged: boolean): Promise<string>
  export function stageHunk(filePath: string, patch: string): Promise<void>
  export function unstageHunk(filePath: string, patch: string): Promise<void>
  export function getLog(limit: number, skip: number): Promise<GitLogEntry[]>
  export function getBranches(): Promise<GitBranch[]>
  export function getTags(): Promise<string[]>
  export function amendCommit(message: string): Promise<void>
  // renderer/lib/fileSystemApi.ts (または該当ファイル)
  export function addToGitignore(targetPath: string): Promise<void>
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/gitApi.test.ts` の既存の `window`/`window.api` モックパターンに
倣って（Task 3 で確認したパターンをそのまま使う）、末尾に以下を追加する:

```ts
describe('getDiff', () => {
  it('window.api.getDiff を filePath/staged で呼ぶ', async () => {
    ;(window.api.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue('DIFF')
    const result = await getDiff('src/index.ts', true)
    expect(window.api.getDiff).toHaveBeenCalledWith('src/index.ts', true)
    expect(result).toBe('DIFF')
  })
})

describe('stageHunk', () => {
  it('window.api.stageHunk を filePath/patch で呼ぶ', async () => {
    await stageHunk('src/index.ts', 'PATCH')
    expect(window.api.stageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('unstageHunk', () => {
  it('window.api.unstageHunk を filePath/patch で呼ぶ', async () => {
    await unstageHunk('src/index.ts', 'PATCH')
    expect(window.api.unstageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('getLog', () => {
  it('window.api.getLog を limit/skip で呼ぶ', async () => {
    ;(window.api.getLog as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const result = await getLog(20, 0)
    expect(window.api.getLog).toHaveBeenCalledWith(20, 0)
    expect(result).toEqual([])
  })
})

describe('getBranches', () => {
  it('window.api.getBranches を呼ぶ', async () => {
    ;(window.api.getBranches as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getBranches()
    expect(window.api.getBranches).toHaveBeenCalled()
  })
})

describe('getTags', () => {
  it('window.api.getTags を呼ぶ', async () => {
    ;(window.api.getTags as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getTags()
    expect(window.api.getTags).toHaveBeenCalled()
  })
})

describe('amendCommit', () => {
  it('window.api.amendCommit を message で呼ぶ', async () => {
    await amendCommit('feat: 修正後')
    expect(window.api.amendCommit).toHaveBeenCalledWith('feat: 修正後')
  })
})
```

ファイル冒頭の `import`/`window.api` モックオブジェクトに、新規メソッド
（`getDiff`/`stageHunk`/`unstageHunk`/`getLog`/`getBranches`/`getTags`/`amendCommit` すべて `vi.fn()`）
を追加し、import 文にも新規関数を追加する。

`src/renderer/src/lib/__tests__/fileSystemApi.test.ts` にも同様に、以下を追加する
（既存のモックパターンに倣う）:

```ts
describe('addToGitignore', () => {
  it('window.api.addToGitignore を targetPath で呼ぶ', async () => {
    await addToGitignore('/project/dist')
    expect(window.api.addToGitignore).toHaveBeenCalledWith('/project/dist')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts`
Expected: FAIL（新規関数が存在しない）

- [ ] **Step 3: preload と gitApi.ts/fileSystemApi を実装する**

`src/preload/api.ts` の `commitChanges` の行の直後に追加:

```ts
  getDiff: (filePath: string, staged: boolean): Promise<string> =>
    ipcRenderer.invoke('git:getDiff', filePath, staged),
  stageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:stageHunk', filePath, patch),
  unstageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:unstageHunk', filePath, patch),
  getLog: (limit: number, skip: number): Promise<GitLogEntry[]> =>
    ipcRenderer.invoke('git:getLog', limit, skip),
  getBranches: (): Promise<GitBranch[]> => ipcRenderer.invoke('git:getBranches'),
  getTags: (): Promise<string[]> => ipcRenderer.invoke('git:getTags'),
  amendCommit: (message: string): Promise<void> => ipcRenderer.invoke('git:amendCommit', message),
  addToGitignore: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:addToGitignore', targetPath),
```

冒頭の `import type { ... } from '@shared/types'` に `GitLogEntry`/`GitBranch` を追加する。

`src/preload/index.d.ts` の `commitChanges(message: string): Promise<void>` の行の直後に追加:

```ts
      getDiff(filePath: string, staged: boolean): Promise<string>
      stageHunk(filePath: string, patch: string): Promise<void>
      unstageHunk(filePath: string, patch: string): Promise<void>
      getLog(limit: number, skip: number): Promise<GitLogEntry[]>
      getBranches(): Promise<GitBranch[]>
      getTags(): Promise<string[]>
      amendCommit(message: string): Promise<void>
      addToGitignore(targetPath: string): Promise<void>
```

`src/renderer/src/lib/gitApi.ts` に以下を追加する:

```ts
import type { GitStatusResult, GitLogEntry, GitBranch } from '@shared/types'

export function getDiff(filePath: string, staged: boolean): Promise<string> {
  return window.api.getDiff(filePath, staged)
}

export function stageHunk(filePath: string, patch: string): Promise<void> {
  return window.api.stageHunk(filePath, patch)
}

export function unstageHunk(filePath: string, patch: string): Promise<void> {
  return window.api.unstageHunk(filePath, patch)
}

export function getLog(limit: number, skip: number): Promise<GitLogEntry[]> {
  return window.api.getLog(limit, skip)
}

export function getBranches(): Promise<GitBranch[]> {
  return window.api.getBranches()
}

export function getTags(): Promise<string[]> {
  return window.api.getTags()
}

export function amendCommit(message: string): Promise<void> {
  return window.api.amendCommit(message)
}
```

`src/renderer/src/lib/fileSystemApi.ts` に以下を追加する:

```ts
export function addToGitignore(targetPath: string): Promise<void> {
  return window.api.addToGitignore(targetPath)
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts src/renderer/src/lib/__tests__/fileSystemApi.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/lib/gitApi.ts && npx vitest run src/renderer/src/lib/__tests__/gitApi.test.ts; git stash pop`
Expected: 新規追加した7件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/preload/api.ts src/preload/index.d.ts src/renderer/src/lib/gitApi.ts \
  src/renderer/src/lib/__tests__/gitApi.test.ts src/renderer/src/lib/fileSystemApi.ts \
  src/renderer/src/lib/__tests__/fileSystemApi.test.ts
git commit -m "$(cat <<'EOF'
feat: preload/gitApiにdiff/hunk/log/branches/tags/amend/gitignore関連を追加する
EOF
)"
```

---

### Task 8: `diffParser.ts` を新規作成する

**Files:**
- Create: `src/renderer/src/lib/diffParser.ts`
- Test: `src/renderer/src/lib/__tests__/diffParser.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ParsedHunk {
    header: string
    lines: string[]
  }

  export interface ParsedDiff {
    headerLines: string[]
    hunks: ParsedHunk[]
  }

  export function parseDiff(diffText: string): ParsedDiff
  export function buildHunkPatch(parsed: ParsedDiff, hunkIndex: number): string
  ```
  `parseDiff` は unified diff 文字列を、`@@ ... @@` より前のヘッダー行群と、ハンクごとの配列に
  分割する。`buildHunkPatch` はヘッダー行群 + 指定インデックスのハンクだけを結合して、
  `git apply` に渡せる単一ハンクのパッチ文字列を組み立てる（末尾に改行を付与）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/diffParser.test.ts` を新規作成する:

```ts
import { describe, it, expect } from 'vitest'
import { parseDiff, buildHunkPatch } from '../diffParser'

const SAMPLE_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  'index abc123..def456 100644',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-line2',
  '+line2modified',
  '+line3new',
  ' line4',
  '@@ -10,2 +11,3 @@',
  ' line10',
  '+line11new',
  ' line12',
  '',
].join('\n')

describe('parseDiff', () => {
  it('ヘッダー行群とハンク群を正しく分割する', () => {
    const result = parseDiff(SAMPLE_DIFF)
    expect(result.headerLines).toEqual([
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc123..def456 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
    ])
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(result.hunks[0].lines).toEqual([
      ' line1',
      '-line2',
      '+line2modified',
      '+line3new',
      ' line4',
    ])
    expect(result.hunks[1].header).toBe('@@ -10,2 +11,3 @@')
    expect(result.hunks[1].lines).toEqual([' line10', '+line11new', ' line12'])
  })

  it('空文字列の場合、ヘッダーもハンクも空になる', () => {
    const result = parseDiff('')
    expect(result.headerLines).toEqual([])
    expect(result.hunks).toEqual([])
  })
})

describe('buildHunkPatch', () => {
  it('ヘッダー行群 + 指定ハンクのみを結合したパッチ文字列を返す', () => {
    const parsed = parseDiff(SAMPLE_DIFF)
    const patch = buildHunkPatch(parsed, 0)
    expect(patch).toBe(
      [
        'diff --git a/src/index.ts b/src/index.ts',
        'index abc123..def456 100644',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '-line2',
        '+line2modified',
        '+line3new',
        ' line4',
        '',
      ].join('\n')
    )
  })

  it('2番目のハンクだけを指定した場合、1番目のハンクは含まれない', () => {
    const parsed = parseDiff(SAMPLE_DIFF)
    const patch = buildHunkPatch(parsed, 1)
    expect(patch).not.toContain('line2modified')
    expect(patch).toContain('@@ -10,2 +11,3 @@')
    expect(patch).toContain('+line11new')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/diffParser.test.ts`
Expected: FAIL（`diffParser` モジュールが存在しない）

- [ ] **Step 3: `diffParser.ts` を実装する**

```ts
export interface ParsedHunk {
  header: string
  lines: string[]
}

export interface ParsedDiff {
  headerLines: string[]
  hunks: ParsedHunk[]
}

export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n')
  // 末尾の空行は split の仕様上の余分な要素なので取り除く
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const headerLines: string[] = []
  const hunks: ParsedHunk[] = []
  let currentHunk: ParsedHunk | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (currentHunk !== null) hunks.push(currentHunk)
      currentHunk = { header: line, lines: [] }
    } else if (currentHunk !== null) {
      currentHunk.lines.push(line)
    } else {
      headerLines.push(line)
    }
  }
  if (currentHunk !== null) hunks.push(currentHunk)

  return { headerLines, hunks }
}

export function buildHunkPatch(parsed: ParsedDiff, hunkIndex: number): string {
  const hunk = parsed.hunks[hunkIndex]
  const lines = [...parsed.headerLines, hunk.header, ...hunk.lines]
  return lines.join('\n') + '\n'
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/diffParser.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/lib/diffParser.ts && npx vitest run src/renderer/src/lib/__tests__/diffParser.test.ts; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/lib/diffParser.ts src/renderer/src/lib/__tests__/diffParser.test.ts
git commit -m "$(cat <<'EOF'
feat: unified diffをハンク単位にパースするdiffParserを追加する

ヘッダー行群とハンク配列への分割、および単一ハンクだけの
パッチ文字列再構築を行う純粋関数を実装する。
EOF
)"
```

---

### Task 9: `useDiffTabs` フックを新規作成する

**Files:**
- Create: `src/renderer/src/hooks/useDiffTabs.ts`
- Test: `src/renderer/src/hooks/__tests__/useDiffTabs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DiffTabKey {
    path: string
    staged: boolean
  }

  export interface DiffTabsState {
    diffTabs: DiffTabKey[]
    activeDiffTab: DiffTabKey | null
    openDiffTab: (key: DiffTabKey) => void
    closeDiffTab: (key: DiffTabKey) => void
    activateDiffTab: (key: DiffTabKey) => void
  }

  export function useDiffTabs(): DiffTabsState
  export function encodeDiffTabPath(key: DiffTabKey): string
  export function isDiffTabPath(path: string): boolean
  export function decodeDiffTabPath(encodedPath: string): DiffTabKey
  ```
  `encodeDiffTabPath`/`isDiffTabPath`/`decodeDiffTabPath` は Task 11 でタブバーが実ファイルタブと
  diff タブを 1 本の文字列キー空間で扱うために使う変換関数。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useDiffTabs.test.ts` を新規作成する:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useDiffTabs, encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from '../useDiffTabs'

describe('useDiffTabs', () => {
  it('openDiffTab で開いたタブが diffTabs に追加され、アクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'src/index.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'src/index.ts', staged: false }])
    expect(result.current.activeDiffTab).toEqual({ path: 'src/index.ts', staged: false })
  })

  it('同じ path/staged のタブを再度開いても重複追加せず、アクティブにするだけ', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
      result.current.openDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.diffTabs).toHaveLength(2)
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })

  it('同じ path で staged が異なる場合は別タブとして扱う', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'a.ts', staged: true })
    })
    expect(result.current.diffTabs).toHaveLength(2)
  })

  it('closeDiffTab でタブが削除され、閉じたのがアクティブタブなら直前のタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'b.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'a.ts', staged: false }])
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })

  it('closeDiffTab で全タブを閉じると activeDiffTab は null になる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([])
    expect(result.current.activeDiffTab).toBeNull()
  })

  it('activateDiffTab で指定したタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
      result.current.activateDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })
})

describe('encodeDiffTabPath / isDiffTabPath / decodeDiffTabPath', () => {
  it('staged=false は diff:unstaged: プレフィックスでエンコードされる', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: false })
    expect(encoded).toBe('diff:unstaged:src/index.ts')
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: false })
  })

  it('staged=true は diff:staged: プレフィックスでエンコードされる', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: true })
    expect(encoded).toBe('diff:staged:src/index.ts')
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: true })
  })

  it('実ファイルパスは isDiffTabPath が false を返す', () => {
    expect(isDiffTabPath('src/index.ts')).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDiffTabs.test.ts`
Expected: FAIL（`useDiffTabs` モジュールが存在しない）

- [ ] **Step 3: `useDiffTabs.ts` を実装する**

```ts
import { useState } from 'react'

export interface DiffTabKey {
  path: string
  staged: boolean
}

export interface DiffTabsState {
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  openDiffTab: (key: DiffTabKey) => void
  closeDiffTab: (key: DiffTabKey) => void
  activateDiffTab: (key: DiffTabKey) => void
}

function isSameKey(a: DiffTabKey, b: DiffTabKey): boolean {
  return a.path === b.path && a.staged === b.staged
}

export function useDiffTabs(): DiffTabsState {
  const [diffTabs, setDiffTabs] = useState<DiffTabKey[]>([])
  const [activeDiffTab, setActiveDiffTab] = useState<DiffTabKey | null>(null)

  const openDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => (prev.some((t) => isSameKey(t, key)) ? prev : [...prev, key]))
    setActiveDiffTab(key)
  }

  const closeDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => {
      const index = prev.findIndex((t) => isSameKey(t, key))
      if (index === -1) return prev
      const next = prev.filter((t) => !isSameKey(t, key))
      setActiveDiffTab((current) => {
        if (current === null || !isSameKey(current, key)) return current
        if (next.length === 0) return null
        return next[Math.max(0, index - 1)]
      })
      return next
    })
  }

  const activateDiffTab = (key: DiffTabKey): void => {
    setActiveDiffTab(key)
  }

  return { diffTabs, activeDiffTab, openDiffTab, closeDiffTab, activateDiffTab }
}

export function encodeDiffTabPath(key: DiffTabKey): string {
  return `diff:${key.staged ? 'staged' : 'unstaged'}:${key.path}`
}

export function isDiffTabPath(path: string): boolean {
  return path.startsWith('diff:staged:') || path.startsWith('diff:unstaged:')
}

export function decodeDiffTabPath(encodedPath: string): DiffTabKey {
  const staged = encodedPath.startsWith('diff:staged:')
  const prefix = staged ? 'diff:staged:' : 'diff:unstaged:'
  return { path: encodedPath.slice(prefix.length), staged }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useDiffTabs.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useDiffTabs.ts && npx vitest run src/renderer/src/hooks/__tests__/useDiffTabs.test.ts; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/__tests__/useDiffTabs.test.ts
git commit -m "$(cat <<'EOF'
feat: diffタブの開閉・アクティブ状態を管理するuseDiffTabsを追加する

実ファイルタブ管理(useFileSystem)とは独立させ、タブバー層でのみ
両者を合成できるようencode/decode用のキー変換関数も併せて提供する。
EOF
)"
```

---

### Task 10: `DiffView.tsx` を新規作成する

**Files:**
- Create: `src/renderer/src/components/source-control/DiffView.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/DiffView.test.tsx`

**Interfaces:**
- Consumes: Task 8 の `parseDiff`/`buildHunkPatch`
- Produces:
  ```ts
  interface Props {
    diffText: string
    staged: boolean
    onStageHunk: (patch: string) => void
    onUnstageHunk: (patch: string) => void
  }
  ```
  `staged === false` のとき各ハンクに「ステージ」ボタン、`staged === true` のとき「アンステージ」
  ボタンを表示する。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/DiffView.test.tsx` を新規作成する:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import DiffView from '../DiffView'

const SAMPLE_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  'index abc123..def456 100644',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,2 +1,2 @@',
  ' line1',
  '-line2',
  '+line2modified',
  '@@ -10,1 +10,2 @@',
  ' line10',
  '+line11new',
  '',
].join('\n')

describe('DiffView', () => {
  it('各ハンクを表示し、変更行を +/- で表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getByText('-line2')).toBeInTheDocument()
    expect(screen.getByText('+line2modified')).toBeInTheDocument()
    expect(screen.getByText('+line11new')).toBeInTheDocument()
  })

  it('staged=false のとき各ハンクにステージボタンを表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをステージ' })).toHaveLength(2)
  })

  it('staged=true のとき各ハンクにアンステージボタンを表示する', () => {
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={true} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />
    )
    expect(screen.getAllByRole('button', { name: 'このハンクをアンステージ' })).toHaveLength(2)
  })

  it('ステージボタンをクリックすると onStageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onStageHunk = vi.fn()
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={false} onStageHunk={onStageHunk} onUnstageHunk={vi.fn()} />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをステージ' })
    await userEvent.click(buttons[0])
    expect(onStageHunk).toHaveBeenCalledTimes(1)
    const patch = onStageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -1,2 +1,2 @@')
    expect(patch).not.toContain('@@ -10,1 +10,2 @@')
  })

  it('アンステージボタンをクリックすると onUnstageHunk がそのハンクのパッチで呼ばれる', async () => {
    const onUnstageHunk = vi.fn()
    render(
      <DiffView diffText={SAMPLE_DIFF} staged={true} onStageHunk={vi.fn()} onUnstageHunk={onUnstageHunk} />
    )
    const buttons = screen.getAllByRole('button', { name: 'このハンクをアンステージ' })
    await userEvent.click(buttons[1])
    const patch = onUnstageHunk.mock.calls[0][0] as string
    expect(patch).toContain('@@ -10,1 +10,2 @@')
  })

  it('diffText が空文字列の場合、ハンクもボタンも表示しない', () => {
    render(<DiffView diffText="" staged={false} onStageHunk={vi.fn()} onUnstageHunk={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'このハンクをステージ' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/DiffView.test.tsx`
Expected: FAIL（`DiffView` モジュールが存在しない）

- [ ] **Step 3: `DiffView.tsx` を実装する**

```tsx
import { parseDiff, buildHunkPatch } from '../../lib/diffParser'

interface Props {
  diffText: string
  staged: boolean
  onStageHunk: (patch: string) => void
  onUnstageHunk: (patch: string) => void
}

function lineClassName(line: string): string {
  if (line.startsWith('+')) return 'diff-view__line diff-view__line--added'
  if (line.startsWith('-')) return 'diff-view__line diff-view__line--removed'
  return 'diff-view__line diff-view__line--context'
}

export default function DiffView({
  diffText,
  staged,
  onStageHunk,
  onUnstageHunk
}: Props): React.JSX.Element {
  const parsed = parseDiff(diffText)
  const buttonLabel = staged ? 'このハンクをアンステージ' : 'このハンクをステージ'

  return (
    <div className="diff-view">
      {parsed.hunks.map((hunk, index) => (
        <div key={`${hunk.header}-${index}`} className="diff-view__hunk">
          <div className="diff-view__hunk-header">
            <span className="diff-view__hunk-header-text">{hunk.header}</span>
            <button
              type="button"
              className="diff-view__hunk-action-btn"
              onClick={() => {
                const patch = buildHunkPatch(parsed, index)
                if (staged) {
                  onUnstageHunk(patch)
                } else {
                  onStageHunk(patch)
                }
              }}
            >
              {buttonLabel}
            </button>
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div key={lineIndex} className={lineClassName(line)}>
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/DiffView.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/DiffView.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/DiffView.test.tsx; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/components/source-control/DiffView.tsx \
  src/renderer/src/components/source-control/__tests__/DiffView.test.tsx
git commit -m "$(cat <<'EOF'
feat: ハンク単位のdiff表示・ステージ/アンステージを行うDiffViewを追加する
EOF
)"
```

---

### Task 11: `EditorPanel.tsx` に diff タブを統合する

**Files:**
- Modify: `src/renderer/src/components/EditorPanel.tsx`
- Modify: `src/renderer/src/components/editor/EditorTabs.tsx`
- Modify: `src/renderer/src/components/editor/__tests__/EditorTabs.test.tsx`
- Test: `src/renderer/src/components/__tests__/EditorPanel.test.tsx`（既存があれば読んで確認、
  無ければ既存の類似コンポーネントテストパターンに倣って作成範囲を必要最小限に絞る）

**Interfaces:**
- Consumes: Task 9 の `useDiffTabs`/`encodeDiffTabPath`/`isDiffTabPath`/`decodeDiffTabPath`、
  Task 10 の `DiffView`
- Produces: `EditorPanel` の新しい Props:
  ```ts
  interface Props {
    // 既存 Props はすべて維持
    diffTabs: DiffTabKey[]
    activeDiffTab: DiffTabKey | null
    onActivateDiffTab: (key: DiffTabKey) => void
    onCloseDiffTab: (key: DiffTabKey) => void
    diffContent: string | null
    diffStaged: boolean
    onStageHunk: (patch: string) => void
    onUnstageHunk: (patch: string) => void
  }
  ```

- [ ] **Step 1: `EditorTabs.tsx` のタブラベル生成をタブ側で完結させないことを確認する**

`EditorTabs.tsx` の `Tab` インターフェース（`{ path: string; name: string; isDirty: boolean }`）は
そのまま変更しない。diff タブの `name`（表示ラベル）と `path`（一意キー）は `EditorPanel.tsx` 側で
`encodeDiffTabPath` を使って組み立てて `EditorTabs` に渡す。`EditorTabs.tsx` 自体のコード変更は
不要（タブの中身が実ファイルか diff かを区別する必要が無いよう設計しているため）。この Step は
コード変更ではなく前提の確認のみ。

- [ ] **Step 2: 失敗するテストを書く**

`src/renderer/src/components/__tests__/EditorPanel.test.tsx` を読み、既存の `render(<EditorPanel ... />)`
呼び出し箇所すべてに、新規 props のデフォルト値（`diffTabs={[]}`、`activeDiffTab={null}`、
`onActivateDiffTab={vi.fn()}`、`onCloseDiffTab={vi.fn()}`、`diffContent={null}`、`diffStaged={false}`、
`onStageHunk={vi.fn()}`、`onUnstageHunk={vi.fn()}`）を機械的に追加する。

同ファイルに以下のテストを追加する:

```tsx
it('activeDiffTab がある場合、DiffView を表示しMonaco Editorは表示しない', () => {
  render(
    <EditorPanel
      {...baseProps}
      diffTabs={[{ path: 'src/index.ts', staged: false }]}
      activeDiffTab={{ path: 'src/index.ts', staged: false }}
      diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
    />
  )
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.getByText('-a')).toBeInTheDocument()
})

it('diffTabs がある場合、タブバーに diff タブが表示される', () => {
  render(
    <EditorPanel
      {...baseProps}
      diffTabs={[{ path: 'src/index.ts', staged: false }]}
      activeDiffTab={{ path: 'src/index.ts', staged: false }}
      diffContent={'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'}
    />
  )
  expect(screen.getByText('index.ts (差分)')).toBeInTheDocument()
})

it('diff タブをクリックすると onActivateDiffTab が呼ばれる', async () => {
  const onActivateDiffTab = vi.fn()
  render(
    <EditorPanel
      {...baseProps}
      openFiles={[makeOpenFile('src/other.ts')]}
      activeFilePath="src/other.ts"
      diffTabs={[{ path: 'src/index.ts', staged: false }]}
      activeDiffTab={null}
      onActivateDiffTab={onActivateDiffTab}
      diffContent={null}
    />
  )
  await userEvent.click(screen.getByText('index.ts (差分)'))
  expect(onActivateDiffTab).toHaveBeenCalledWith({ path: 'src/index.ts', staged: false })
})
```

（`baseProps`/`makeOpenFile` は既存テストファイル内のヘルパーを流用する。無ければ既存の
`render(<EditorPanel ... />)` 呼び出しの引数一式をそのまま複製して使うこと。`screen.getByText`
の期待文言 `'index.ts (差分)'` は Step 3 のラベル生成ロジックに合わせたもの。ファイル名部分は
`path.split('/').pop()` 相当の末尾セグメントを想定している。）

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: FAIL（新規 props が無い）

- [ ] **Step 4: `EditorPanel.tsx` を実装する**

冒頭 import に追加する:

```ts
import type { DiffTabKey } from '../hooks/useDiffTabs'
import { encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from '../hooks/useDiffTabs'
import DiffView from './source-control/DiffView'
```

`Props` インターフェースに追加する:

```ts
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  onActivateDiffTab: (key: DiffTabKey) => void
  onCloseDiffTab: (key: DiffTabKey) => void
  diffContent: string | null
  diffStaged: boolean
  onStageHunk: (patch: string) => void
  onUnstageHunk: (patch: string) => void
```

分割代入に上記 props を追加する。

タブ配列の合成とアクティブキーの算出を、`return` の直前に追加する:

```ts
  const diffTabItems = diffTabs.map((tab) => ({
    path: encodeDiffTabPath(tab),
    name: `${tab.path.split('/').pop()} (差分)`,
    isDirty: false
  }))
  const combinedTabs = [
    ...openFiles.map((f) => ({
      path: f.path,
      name: f.name,
      isDirty: f.path === activeFilePath ? isDirty : f.content !== f.savedContent
    })),
    ...diffTabItems
  ]
  const activeTabPath =
    activeDiffTab !== null ? encodeDiffTabPath(activeDiffTab) : activeFilePath
  const handleActivateTab = (path: string): void => {
    if (isDiffTabPath(path)) {
      onActivateDiffTab(decodeDiffTabPath(path))
    } else {
      onActivateTab(path)
    }
  }
  const handleCloseTab = (path: string): void => {
    if (isDiffTabPath(path)) {
      onCloseDiffTab(decodeDiffTabPath(path))
    } else {
      onCloseTab(path)
    }
  }
```

`return` 内の JSX を以下のように変更する（`openFile === null` の分岐を
`openFile === null && activeDiffTab === null` に変え、既存の `<EditorTabs tabs={openFiles.map(...)} .../>`
と `<Editor ... />` を含むブロックを、diff タブがアクティブなら `DiffView` を、そうでなければ
既存の `Editor` を表示する形に書き換える）:

```tsx
  return (
    <div className="editor-panel">
      {openFile === null && activeDiffTab === null ? (
        <WelcomeView />
      ) : (
        <>
          <EditorTabs
            tabs={combinedTabs}
            activePath={activeTabPath}
            isSaving={isSaving}
            saveError={saveError}
            onSave={onSave}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onReorderTabs={onReorderTabs}
          />
          <div className="editor-body">
            {activeDiffTab !== null ? (
              diffContent !== null && (
                <DiffView
                  diffText={diffContent}
                  staged={diffStaged}
                  onStageHunk={onStageHunk}
                  onUnstageHunk={onUnstageHunk}
                />
              )
            ) : (
              openFile !== null && (
                <Editor
                  key={openFile.path}
                  height="100%"
                  language={openFile.language}
                  theme="vs-dark"
                  value={openFile.content}
                  options={editorOptions}
                  onChange={(value) => onChangeContent(value ?? '')}
                  onMount={(editorInstance, monaco) => {
                    if (openFilePathRef.current !== openFile.path) return
                    if (editorInstance.getModel() === null) return
                    editorRef.current = editorInstance
                    mountedPathRef.current = openFile.path
                    registerSaveCommand(editorInstance, monaco, () => onSaveRef.current())
                    focusEditorIfPending()
                  }}
                />
              )
            )}
          </div>
        </>
      )}
      <OutputPanel
        isExecuting={isExecuting}
        result={result}
        streamingText={streamingText}
        executionError={executionError}
        onClear={onClearResult}
        onCancel={onCancelExecution}
      />
    </div>
  )
```

（既存の `Editor` 呼び出しの中身はそのまま移すこと。書き換え忘れが無いよう、この Step の前に
現在のファイル内容を再読して確認してから編集すること。）

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx`
Expected: PASS（全件）

- [ ] **Step 6: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/EditorPanel.tsx && npx vitest run src/renderer/src/components/__tests__/EditorPanel.test.tsx; git stash pop`
Expected: 新規追加した3件のテストが FAIL する

- [ ] **Step 7: 型チェック**

Run: `npm run typecheck`
Expected: `App.tsx` からの呼び出しがまだ新規 props を渡していないためエラーが出る想定
（Task 18 で解消する）

- [ ] **Step 8: コミットは Task 18 とまとめて行う**

`App.tsx` に組み込むまでは新規 props が渡されず型エラーが残るため、中間状態でのコミットは避け、
Task 18 完了後にまとめてコミットする。

---

### Task 12: `useGitHistory` フックを新規作成する

**Files:**
- Create: `src/renderer/src/hooks/useGitHistory.ts`
- Test: `src/renderer/src/hooks/__tests__/useGitHistory.test.ts`

**Interfaces:**
- Consumes: Task 7 の `gitApi.getLog(limit, skip)`/`gitApi.getBranches()`/`gitApi.getTags()`
- Produces:
  ```ts
  export interface GitHistoryState {
    log: GitLogEntry[]
    branches: GitBranch[]
    tags: string[]
    hasMore: boolean
    isLoading: boolean
    loadMore: () => Promise<void>
    refresh: () => Promise<void>
  }

  export function useGitHistory(folderPath: string | null): GitHistoryState
  ```
  `PAGE_SIZE = 20`。初回マウント時と `folderPath` 変更時に自動で最初の 20 件・ブランチ・タグを
  取得する。`loadMore` は次の 20 件を追加取得して `log` に連結する。取得件数が `PAGE_SIZE` 未満
  だった場合は `hasMore` を `false` にする。`folderPath` が `null` のときは何も取得せず空状態を返す。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useGitHistory.test.ts` を新規作成する:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitHistory } from '../useGitHistory'

const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitHistory', () => {
  it('folderPath が設定されるとマウント時に log/branches/tags を取得する', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([{ name: 'main', current: true }])
    mockGetTags.mockResolvedValue(['v1.0.0'])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockGetLog).toHaveBeenCalledWith(20, 0)
    expect(result.current.log).toEqual([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    expect(result.current.branches).toEqual([{ name: 'main', current: true }])
    expect(result.current.tags).toEqual(['v1.0.0'])
  })

  it('folderPath が null の場合は何も取得しない', () => {
    const { result } = renderHook(() => useGitHistory(null))
    expect(mockGetLog).not.toHaveBeenCalled()
    expect(result.current.log).toEqual([])
  })

  it('取得件数が20件ちょうどのとき hasMore は true になる', async () => {
    mockGetLog.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ hash: String(i), message: 'm', date: 'd', authorName: 'x' }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it('取得件数が20件未満のとき hasMore は false になる', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore で次の20件を skip=20 で取得し、既存の log に連結する', async () => {
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ hash: `a${i}`, message: 'm', date: 'd', authorName: 'x' }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockGetLog.mockResolvedValueOnce([{ hash: 'b0', message: 'm2', date: 'd2', authorName: 'y' }])
    await result.current.loadMore()
    expect(mockGetLog).toHaveBeenLastCalledWith(20, 20)
    expect(result.current.log).toHaveLength(21)
    expect(result.current.hasMore).toBe(false)
  })

  it('refresh で log/branches/tags を最初から再取得する', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mockGetLog.mockClear()
    await result.current.refresh()
    expect(mockGetLog).toHaveBeenCalledWith(20, 0)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitHistory.test.ts`
Expected: FAIL（`useGitHistory` モジュールが存在しない）

- [ ] **Step 3: `useGitHistory.ts` を実装する**

```ts
import { useCallback, useEffect, useState } from 'react'
import type { GitBranch, GitLogEntry } from '@shared/types'
import * as gitApi from '../lib/gitApi'

const PAGE_SIZE = 20

export interface GitHistoryState {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

export function useGitHistory(folderPath: string | null): GitHistoryState {
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (folderPath === null) return
    setIsLoading(true)
    try {
      const [logResult, branchesResult, tagsResult] = await Promise.all([
        gitApi.getLog(PAGE_SIZE, 0),
        gitApi.getBranches(),
        gitApi.getTags()
      ])
      setLog(logResult)
      setBranches(branchesResult)
      setTags(tagsResult)
      setHasMore(logResult.length === PAGE_SIZE)
    } finally {
      setIsLoading(false)
    }
  }, [folderPath])

  useEffect(() => {
    if (folderPath === null) {
      setLog([])
      setBranches([])
      setTags([])
      setHasMore(false)
      return
    }
    void refresh()
  }, [folderPath, refresh])

  const loadMore = async (): Promise<void> => {
    if (folderPath === null) return
    setIsLoading(true)
    try {
      const nextPage = await gitApi.getLog(PAGE_SIZE, log.length)
      setLog((prev) => [...prev, ...nextPage])
      setHasMore(nextPage.length === PAGE_SIZE)
    } finally {
      setIsLoading(false)
    }
  }

  return { log, branches, tags, hasMore, isLoading, loadMore, refresh }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitHistory.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useGitHistory.ts && npx vitest run src/renderer/src/hooks/__tests__/useGitHistory.test.ts; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useGitHistory.ts src/renderer/src/hooks/__tests__/useGitHistory.test.ts
git commit -m "$(cat <<'EOF'
feat: コミット履歴・ブランチ・タグを取得するuseGitHistoryを追加する

直近20件を初回取得し、loadMoreで追加20件ずつページングする。
EOF
)"
```

---

### Task 13: `HistorySection.tsx` を新規作成する

**Files:**
- Create: `src/renderer/src/components/source-control/HistorySection.tsx`
- Test: `src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface Props {
    log: GitLogEntry[]
    branches: GitBranch[]
    tags: string[]
    hasMore: boolean
    isLoading: boolean
    onLoadMore: () => void
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx` を新規作成する:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistorySection from '../HistorySection'

describe('HistorySection', () => {
  it('ブランチ名・タグ名をバッジとして表示する', () => {
    render(
      <HistorySection
        log={[]}
        branches={[{ name: 'main', current: true }, { name: 'dev', current: false }]}
        tags={['v1.0.0']}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('コミット一覧をハッシュ短縮形・メッセージで表示する', () => {
    render(
      <HistorySection
        log={[{ hash: 'abcdef1234567', message: 'feat: 新機能', date: '2026-09-03T10:00:00+09:00', authorName: 'Alice' }]}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
  })

  it('hasMore が true のとき「もっと見る」ボタンを表示する', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={false} onLoadMore={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeInTheDocument()
  })

  it('hasMore が false のとき「もっと見る」ボタンを表示しない', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={false} isLoading={false} onLoadMore={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument()
  })

  it('「もっと見る」クリックで onLoadMore が呼ばれる', async () => {
    const onLoadMore = vi.fn()
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={false} onLoadMore={onLoadMore} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('isLoading が true のとき「もっと見る」ボタンは無効化される', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={true} onLoadMore={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx`
Expected: FAIL（`HistorySection` モジュールが存在しない）

- [ ] **Step 3: `HistorySection.tsx` を実装する**

```tsx
import type { GitBranch, GitLogEntry } from '@shared/types'

interface Props {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
}

export default function HistorySection({
  log,
  branches,
  tags,
  hasMore,
  isLoading,
  onLoadMore
}: Props): React.JSX.Element {
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">履歴</h3>
      {(branches.length > 0 || tags.length > 0) && (
        <div className="history-section__badges">
          {branches.map((branch) => (
            <span
              key={branch.name}
              className={
                branch.current
                  ? 'history-section__badge history-section__badge--branch-current'
                  : 'history-section__badge history-section__badge--branch'
              }
            >
              {branch.name}
            </span>
          ))}
          {tags.map((tag) => (
            <span key={tag} className="history-section__badge history-section__badge--tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <ul className="history-section__log-list">
        {log.map((entry) => (
          <li key={entry.hash} className="history-section__log-item">
            <span className="history-section__log-hash">{entry.hash.slice(0, 7)}</span>
            <span className="history-section__log-message">{entry.message}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          className="history-section__load-more-btn"
          onClick={onLoadMore}
          disabled={isLoading}
        >
          もっと見る
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/HistorySection.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx; git stash pop`
Expected: FAIL（ファイルが無い状態に戻るため import エラー）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/components/source-control/HistorySection.tsx \
  src/renderer/src/components/source-control/__tests__/HistorySection.test.tsx
git commit -m "$(cat <<'EOF'
feat: コミット履歴・ブランチ・タグを表示するHistorySectionを追加する
EOF
)"
```

---

### Task 14: `CommitSection.tsx` に amend 対応を追加する

**Files:**
- Modify: `src/renderer/src/components/source-control/CommitSection.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`

**Interfaces:**
- Produces: `CommitSection` の新しい Props:
  ```ts
  interface Props {
    stagedCount: number
    isCommitting: boolean
    onCommit: (message: string) => Promise<boolean>
    lastCommitMessage: string | null
    onAmend: (message: string) => Promise<boolean>
  }
  ```
  `lastCommitMessage` は `HistorySection` に渡す `log` の先頭要素の `message`（親コンポーネントが
  `useGitHistory` の `log[0]?.message ?? null` を渡す）。amend チェック時、メッセージ欄が空なら
  `lastCommitMessage` を自動入力する。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx` の既存の
`render(<CommitSection ... />)` 呼び出しすべてに `lastCommitMessage={null}` と
`onAmend={vi.fn().mockResolvedValue(true)}` を追加する（既存ファイルを読んで機械的に更新する）。
末尾に以下を追加する:

```tsx
describe('amend', () => {
  it('amendチェックボックスを表示する', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn()}
      />
    )
    expect(screen.getByLabelText('amend')).toBeInTheDocument()
  })

  it('amendチェック時、メッセージ欄が空なら lastCommitMessage を自動入力する', async () => {
    render(
      <CommitSection
        stagedCount={0}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    await userEvent.click(screen.getByLabelText('amend'))
    expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット')
  })

  it('amendチェック時、stagedCount が 0 でもコミットボタンは有効', async () => {
    render(
      <CommitSection
        stagedCount={0}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    await userEvent.click(screen.getByLabelText('amend'))
    expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
  })

  it('amendチェック時にボタンを押すと onCommit ではなく onAmend がメッセージで呼ばれる', async () => {
    const onCommit = vi.fn()
    const onAmend = vi.fn().mockResolvedValue(true)
    render(
      <CommitSection
        stagedCount={0}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={onAmend}
      />
    )
    await userEvent.click(screen.getByLabelText('amend'))
    await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
    expect(onAmend).toHaveBeenCalledWith('feat: 直前のコミット')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('amendチェックを外すとメッセージ欄はクリアされない（引き続き通常コミット可）', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    const checkbox = screen.getByLabelText('amend')
    await userEvent.click(checkbox)
    await userEvent.click(checkbox)
    expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx`
Expected: FAIL（`amend` チェックボックス・新規 props が無い）

- [ ] **Step 3: `CommitSection.tsx` を実装する**

全体を以下に書き換える:

```tsx
import { useState } from 'react'

interface Props {
  stagedCount: number
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
}

export default function CommitSection({
  stagedCount,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [isAmend, setIsAmend] = useState(false)
  const isDisabled =
    message.trim() === '' || (!isAmend && stagedCount === 0) || isCommitting

  const handleAmendToggle = (checked: boolean): void => {
    setIsAmend(checked)
    if (checked && message.trim() === '' && lastCommitMessage !== null) {
      setMessage(lastCommitMessage)
    }
  }

  const handleCommit = async (): Promise<void> => {
    const succeeded = isAmend ? await onAmend(message) : await onCommit(message)
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
      <label className="source-control-panel__amend-label">
        <input
          type="checkbox"
          aria-label="amend"
          checked={isAmend}
          onChange={(e) => handleAmendToggle(e.target.checked)}
        />
        amend
      </label>
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
Expected: 新規追加した5件のテストが FAIL する（既存テストは新規 props 未使用で FAIL しない想定だが、
`amend` label が無いため amend 関連テストのみ FAIL する）

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: `GitRepoView.tsx`（Task 18 で更新）からの呼び出しがまだ古い Props のためエラーが出る想定。
Task 18 完了後に解消すればよい

- [ ] **Step 7: コミットは Task 18 とまとめて行う**

`CommitSection` 単体では `GitRepoView.tsx` から古い props で呼ばれ型エラーが残る。中間状態での
コミットは避け、Task 18 完了後にまとめてコミットする。

---

### Task 15: ファイルツリー右クリックメニューに `.gitignore` 追加項目を追加する

**Files:**
- Modify: `src/renderer/src/lib/explorerMenuItems.ts`
- Modify: `src/renderer/src/lib/__tests__/explorerMenuItems.test.ts`
- Modify: `src/renderer/src/components/explorer/ExplorerPanel.tsx`
- Modify: `src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `fileSystemApi.addToGitignore(targetPath)`（呼び出しは `App.tsx` 側、
  Task 18 で配線する。このタスクでは `ExplorerPanel` の Props に `onAddToGitignore` を追加し、
  メニューから呼び出せる状態にするところまで）
- Produces: `ExplorerMenuActions` に `onAddToGitignore: (node: FileTreeNode) => void` を追加、
  `ExplorerPanel` の Props に `onAddToGitignore: (node: FileTreeNode) => void` を追加

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/explorerMenuItems.test.ts` を読み、既存の `buildMenuItems` 呼び出しに
`onAddToGitignore: vi.fn()` を追加する（機械的に更新）。ファイル末尾に以下を追加する:

```ts
describe('.gitignoreに追加', () => {
  it('node が非nullのとき「.gitignore に追加」項目を含む', () => {
    const node: FileTreeNode = { name: 'dist', path: '/project/dist', type: 'directory' }
    const items = buildMenuItems('/project', node, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore: vi.fn()
    })
    expect(items.some((item) => item.id === 'addToGitignore')).toBe(true)
  })

  it('「.gitignore に追加」を選択すると onAddToGitignore が node で呼ばれる', () => {
    const node: FileTreeNode = { name: 'dist', path: '/project/dist', type: 'directory' }
    const onAddToGitignore = vi.fn()
    const items = buildMenuItems('/project', node, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore
    })
    items.find((item) => item.id === 'addToGitignore')?.onSelect()
    expect(onAddToGitignore).toHaveBeenCalledWith(node)
  })

  it('node が null のとき「.gitignore に追加」項目を含まない', () => {
    const items = buildMenuItems('/project', null, {
      onCreateFile: vi.fn(),
      onCreateDirectory: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onAddToGitignore: vi.fn()
    })
    expect(items.some((item) => item.id === 'addToGitignore')).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/explorerMenuItems.test.ts`
Expected: FAIL（`onAddToGitignore` が無い、`addToGitignore` 項目が無い）

- [ ] **Step 3: `explorerMenuItems.ts` を実装する**

`ExplorerMenuActions` インターフェースに追加する:

```ts
  onAddToGitignore: (node: FileTreeNode) => void
```

`buildMenuItems` 内、`node !== null` ブロックの `items.push(...)` に `.gitignore に追加` 項目を
追加する:

```ts
  if (node !== null) {
    items.push(
      { id: 'rename', label: 'リネーム', onSelect: () => actions.onRename(node) },
      { id: 'delete', label: '削除', onSelect: () => actions.onDelete(node) },
      {
        id: 'addToGitignore',
        label: '.gitignore に追加',
        onSelect: () => actions.onAddToGitignore(node)
      }
    )
  }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/explorerMenuItems.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: `ExplorerPanel.tsx` の失敗するテストを書く**

`src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx` を読み、既存の
`render(<ExplorerPanel ... />)` 呼び出しすべてに `onAddToGitignore={vi.fn()}` を追加する。

- [ ] **Step 6: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`
Expected: FAIL（`onAddToGitignore` prop が無いため型エラー、または未使用警告。テストランナー上は
既存テストが通る可能性もあるが、型チェックで検出されることを Step 8 で確認する）

- [ ] **Step 7: `ExplorerPanel.tsx` を実装する**

`Props` インターフェースに追加する:

```ts
  onAddToGitignore: (node: FileTreeNode) => void
```

分割代入に `onAddToGitignore` を追加し、`buildMenuItems` 呼び出しの第 3 引数オブジェクトに
`onAddToGitignore` を追加する:

```ts
          items={buildMenuItems(folderPath, menu.node, {
            onCreateFile: (parentPath) => setDialog({ mode: 'createFile', parentPath }),
            onCreateDirectory: (parentPath) => setDialog({ mode: 'createDirectory', parentPath }),
            onRename: (node) => setDialog({ mode: 'rename', node }),
            onDelete: onDeleteEntry,
            onAddToGitignore
          })}
```

- [ ] **Step 8: テストが通ることを確認する、型チェック**

Run: `npx vitest run src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx`
Expected: PASS（全件）

Run: `npm run typecheck`
Expected: `App.tsx`（Task 18 で更新）からの呼び出しがまだ `onAddToGitignore` を渡していないため
エラーが出る想定。Task 18 完了後に解消すればよい

- [ ] **Step 9: コミットは Task 18 とまとめて行う**

`ExplorerPanel` 単体では `App.tsx` から古い props で呼ばれ型エラーが残る。Task 18 完了後に
まとめてコミットする。

---

### Task 16: `ChangesSection.tsx`/`StagedSection.tsx` にファイル行クリックでの diff 表示を追加する

**Files:**
- Modify: `src/renderer/src/components/source-control/ChangesSection.tsx`
- Modify: `src/renderer/src/components/source-control/StagedSection.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`

**Interfaces:**
- Consumes: Task 9 の `DiffTabKey`（`onOpenDiff` の呼び出し元である `App.tsx` が
  `useDiffTabs`/`gitApi.getDiff` と組み合わせて使う。このタスクではコールバックを
  呼ぶところまでを実装する）
- Produces: `ChangesSection`/`StagedSection` の新しい Props:
  ```ts
  interface Props {
    files: GitFileStatus[]
    stagingPaths: ReadonlySet<string>
    onStage: (path: string) => void  // StagedSection では onUnstage
    onOpenDiff: (path: string) => void
  }
  ```
  ファイル行（`<li>`）のクリックで `onOpenDiff(f.path)` を呼ぶ。ステージ/アンステージボタンの
  クリックはファイル行のクリックへバブリングさせない（`event.stopPropagation()`）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx` の既存の
`render(<ChangesSection ... />)` 呼び出しすべてに `onOpenDiff={vi.fn()}` を追加する
（既存ファイルを読んで機械的に更新する）。末尾に以下を追加する:

```tsx
describe('diff表示', () => {
  it('ファイル行をクリックすると onOpenDiff がそのパスで呼ばれる', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
    const onOpenDiff = vi.fn()
    render(
      <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={onOpenDiff} />
    )
    await userEvent.click(screen.getByText('src/index.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('src/index.ts')
  })

  it('ステージボタンをクリックしても onOpenDiff は呼ばれない', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]
    const onOpenDiff = vi.fn()
    render(
      <ChangesSection files={files} stagingPaths={new Set()} onStage={vi.fn()} onOpenDiff={onOpenDiff} />
    )
    await userEvent.click(screen.getByLabelText('src/index.ts をステージ'))
    expect(onOpenDiff).not.toHaveBeenCalled()
  })
})
```

`src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx` にも同様に、既存の
`render(<StagedSection ... />)` 呼び出しすべてに `onOpenDiff={vi.fn()}` を追加し、末尾に以下を
追加する:

```tsx
describe('diff表示', () => {
  it('ファイル行をクリックすると onOpenDiff がそのパスで呼ばれる', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    const onOpenDiff = vi.fn()
    render(
      <StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} onOpenDiff={onOpenDiff} />
    )
    await userEvent.click(screen.getByText('src/index.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('src/index.ts')
  })

  it('アンステージボタンをクリックしても onOpenDiff は呼ばれない', async () => {
    const files: GitFileStatus[] = [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    const onOpenDiff = vi.fn()
    render(
      <StagedSection files={files} stagingPaths={new Set()} onUnstage={vi.fn()} onOpenDiff={onOpenDiff} />
    )
    await userEvent.click(screen.getByLabelText('src/index.ts をアンステージ'))
    expect(onOpenDiff).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`
Expected: FAIL（`onOpenDiff` prop が無い）

- [ ] **Step 3: `ChangesSection.tsx` を実装する**

全体を以下に書き換える:

```tsx
import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onOpenDiff: (path: string) => void
}

export default function ChangesSection({
  files,
  stagingPaths,
  onStage,
  onOpenDiff
}: Props): React.JSX.Element | null {
  const changed = files.filter((f) => f.workingDir !== ' ' || f.index === '?')
  if (changed.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">変更 ({changed.length})</h3>
      <ul className="source-control-panel__file-list">
        {changed.map((f) => (
          <li
            key={f.path}
            className="source-control-panel__file-item"
            onClick={() => onOpenDiff(f.path)}
          >
            <span className="source-control-panel__file-status source-control-panel__file-status--changed">
              {f.index === '?' ? statusChar(f.index) : statusChar(f.workingDir)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
            <button
              type="button"
              className="source-control-panel__stage-btn"
              onClick={(e) => {
                e.stopPropagation()
                onStage(f.path)
              }}
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

- [ ] **Step 4: `StagedSection.tsx` を実装する**

全体を以下に書き換える:

```tsx
import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onUnstage: (path: string) => void
  onOpenDiff: (path: string) => void
}

export default function StagedSection({
  files,
  stagingPaths,
  onUnstage,
  onOpenDiff
}: Props): React.JSX.Element | null {
  const staged = files.filter((f) => f.index !== ' ' && f.index !== '?')
  if (staged.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">ステージ済み ({staged.length})</h3>
      <ul className="source-control-panel__file-list">
        {staged.map((f) => (
          <li
            key={f.path}
            className="source-control-panel__file-item"
            onClick={() => onOpenDiff(f.path)}
          >
            <span className="source-control-panel__file-status source-control-panel__file-status--staged">
              {statusChar(f.index)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
            <button
              type="button"
              className="source-control-panel__unstage-btn"
              onClick={(e) => {
                e.stopPropagation()
                onUnstage(f.path)
              }}
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

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx`
Expected: PASS（全件）

- [ ] **Step 6: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/ChangesSection.tsx src/renderer/src/components/source-control/StagedSection.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/ChangesSection.test.tsx src/renderer/src/components/source-control/__tests__/StagedSection.test.tsx; git stash pop`
Expected: 新規追加した4件のテストが FAIL する

- [ ] **Step 7: 型チェック**

Run: `npm run typecheck`
Expected: `GitRepoView.tsx`（Task 18 で更新）からの呼び出しがまだ古い Props のためエラーが出る想定。
Task 18 完了後に解消すればよい

- [ ] **Step 8: コミットは Task 18 とまとめて行う**

`ChangesSection`/`StagedSection` 単体では `GitRepoView.tsx` から古い props で呼ばれ型エラーが残る。
中間状態でのコミットは避け、Task 18 完了後にまとめてコミットする。

---

### Task 17: `useGitOperations` に amend を追加する

**Files:**
- Modify: `src/renderer/src/hooks/useGitOperations.ts`
- Modify: `src/renderer/src/hooks/__tests__/useGitOperations.test.ts`

**Interfaces:**
- Consumes: Task 7 の `gitApi.amendCommit(message)`
- Produces: `useGitOperations` の新しい返り値:
  ```ts
  export interface GitOperationsState {
    stagingPaths: ReadonlySet<string>
    stageFile: (path: string) => Promise<void>
    unstageFile: (path: string) => Promise<void>
    isCommitting: boolean
    commit: (message: string) => Promise<boolean>
    amend: (message: string) => Promise<boolean>
    operationError: Error | null
  }
  ```
  `amend` は `commit` と同じ `isCommitting`/`operationError` 状態を共有し、同じ多重実行防止
  （`isCommittingRef`）を使う（`commit` と `amend` を同時に実行できないようにする）。

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useGitOperations.test.ts` の冒頭 import に `gitApi.amendCommit`
を追加する:

```ts
const mockAmendCommit = vi.mocked(gitApi.amendCommit)
```

（`gitApi` は既に `vi.mock('../../lib/gitApi')` でモック済みのため、`vi.mocked` で型付けする
既存パターンに倣う。）

ファイル末尾（既存の `describe('commit', ...)` ブロックの後）に以下を追加する:

```ts
describe('amend', () => {
  it('gitApi.amendCommit を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockAmendCommit.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = false
    await act(async () => {
      amendResult = await result.current.amend('feat: 修正後')
    })

    expect(mockAmendCommit).toHaveBeenCalledWith('feat: 修正後')
    expect(amendResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockAmendCommit.mockRejectedValue(new Error('amend failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = true
    await act(async () => {
      amendResult = await result.current.amend('msg')
    })

    expect(amendResult).toBe(false)
    expect(result.current.operationError?.message).toBe('amend failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveAmend: () => void = () => {}
    mockAmendCommit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAmend = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      amendPromise = result.current.amend('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveAmend()
      await amendPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('commit 実行中の amend 呼び出しは amendCommit を呼ばない', async () => {
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
    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg1')
      amendPromise = result.current.amend('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([commitPromise, amendPromise])
    })
    expect(mockAmendCommit).not.toHaveBeenCalled()
  })
})
```

（`mockCommitChanges` は既存の `describe('commit', ...)` ブロックで使われている変数をそのまま
参照する。ファイル冒頭でどう定義されているか確認し、同じ変数名を使うこと。）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts`
Expected: FAIL（`amend` が存在しない）

- [ ] **Step 3: `useGitOperations.ts` に実装を追加する**

`GitOperationsState` インターフェースに `amend: (message: string) => Promise<boolean>` を追加する。

`commit` 関数の定義の直後に以下を追加する:

```ts
  const amend = async (message: string): Promise<boolean> => {
    if (isCommittingRef.current) return false
    isCommittingRef.current = true
    setIsCommitting(true)
    try {
      await gitApi.amendCommit(message)
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
```

`return` 文に `amend` を追加する:

```ts
  return { stagingPaths, stageFile, unstageFile, isCommitting, commit, amend, operationError }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/hooks/useGitOperations.ts && npx vitest run src/renderer/src/hooks/__tests__/useGitOperations.test.ts; git stash pop`
Expected: 新規追加した4件のテストが FAIL する

- [ ] **Step 6: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add -u src/renderer/src/hooks/useGitOperations.ts src/renderer/src/hooks/__tests__/useGitOperations.test.ts
git commit -m "$(cat <<'EOF'
feat: useGitOperationsにamendを追加する

commitと同じisCommitting/operationError状態・多重実行防止を共有する。
EOF
)"
```

---

### Task 18: 全体配線を統合し、CSS を追加する

**Files:**
- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/source-control/SourceControlPanel.tsx`
- Modify: `src/renderer/src/components/source-control/GitRepoView.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`
- Modify: `src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: Task 9 の `useDiffTabs`、Task 11 の `EditorPanel` 新 props、Task 12 の `useGitHistory`、
  Task 13 の `HistorySection`、Task 14 の `CommitSection` 新 props、Task 15 の `ExplorerPanel`
  新 prop、Task 16 の `ChangesSection`/`StagedSection` 新 prop（`onOpenDiff`）、Task 17 の
  `useGitOperations.amend`
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
    onOpenDiff: (path: string, staged: boolean) => void
    isCommitting: boolean
    onCommit: (message: string) => Promise<boolean>
    lastCommitMessage: string | null
    onAmend: (message: string) => Promise<boolean>
    log: GitLogEntry[]
    branches: GitBranch[]
    tags: string[]
    hasMoreLog: boolean
    isLoadingLog: boolean
    onLoadMoreLog: () => void
  }
  ```

**事前確認済みの事実**（本タスクの実装はこれらを前提にする）:
- `App.tsx` の JSX は `<div className="ide-main">` の直下に `Sidebar`（`sidebarOpen` の条件付き）と
  `EditorPanel` が兄弟要素として並ぶ構造。よって diff タブ関連 props（`diffTabs`〜`onUnstageHunk`）は
  `EditorPanel` へ直接渡し、`Sidebar` の Props には含めない。
- `useAppState.ts` の現在の分割代入一覧（`App.tsx` 側）に `isLoading`/`refresh`/`log`/`branches`/
  `tags`/`hasMore`/`loadMore`/`diffTabs` という名前は存在しない（衝突なし）。ただし可読性のため
  `useGitHistory` 由来の `isLoading`/`refresh` は `isLoadingHistory`/`refreshHistory` にリネームして
  受け取る。
- `fileSystemApi` の実体は `src/renderer/src/lib/fileSystemApi.ts`（`import * as fileSystemApi from './lib/fileSystemApi'`）。
- `FileTreeNode` 型は `src/renderer/src/types.ts` からの `import type { FileTreeNode } from './types'`
  で参照できる（`App.tsx` に無ければ追加する）。

- [ ] **Step 1: `GitRepoView.test.tsx`/`SourceControlPanel.test.tsx` を新しい Props に合わせて更新する**

両ファイルを読み、`render(<GitRepoView ... />)`/`render(<SourceControlPanel ... />)` の呼び出し箇所に
不足している新規 props（`onOpenDiff={vi.fn()}`、`lastCommitMessage={null}`、
`onAmend={vi.fn().mockResolvedValue(true)}`、`log={[]}`、`branches={[]}`、`tags={[]}`、
`hasMoreLog={false}`、`isLoadingLog={false}`、`onLoadMoreLog={vi.fn()}`）を機械的に追加する。
`GitRepoView.test.tsx` に以下のテストを追加する:

```tsx
it('CommitSection と HistorySection に必要な props が渡る', () => {
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={[]}
      stagingPaths={new Set()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onOpenDiff={vi.fn()}
      isCommitting={false}
      onCommit={vi.fn().mockResolvedValue(true)}
      lastCommitMessage="feat: 直前のコミット"
      onAmend={vi.fn().mockResolvedValue(true)}
      log={[{ hash: 'abc1234', message: 'feat: 新機能', date: 'd', authorName: 'x' }]}
      branches={[{ name: 'main', current: true }]}
      tags={[]}
      hasMoreLog={false}
      isLoadingLog={false}
      onLoadMoreLog={vi.fn()}
    />
  )
  expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
  expect(screen.getByText('main', { selector: '.history-section__badge--branch-current' })).toBeInTheDocument()
})

it('ChangesSection の onOpenDiff は staged=false で呼ばれる', async () => {
  const onOpenDiff = vi.fn()
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={[{ path: 'a.ts', index: ' ', workingDir: 'M' }]}
      stagingPaths={new Set()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onOpenDiff={onOpenDiff}
      isCommitting={false}
      onCommit={vi.fn().mockResolvedValue(true)}
      lastCommitMessage={null}
      onAmend={vi.fn().mockResolvedValue(true)}
      log={[]}
      branches={[]}
      tags={[]}
      hasMoreLog={false}
      isLoadingLog={false}
      onLoadMoreLog={vi.fn()}
    />
  )
  await userEvent.click(screen.getByText('a.ts'))
  expect(onOpenDiff).toHaveBeenCalledWith('a.ts', false)
})

it('StagedSection の onOpenDiff は staged=true で呼ばれる', async () => {
  const onOpenDiff = vi.fn()
  render(
    <GitRepoView
      branch="main"
      ahead={0}
      behind={0}
      files={[{ path: 'a.ts', index: 'M', workingDir: ' ' }]}
      stagingPaths={new Set()}
      onStage={vi.fn()}
      onUnstage={vi.fn()}
      onOpenDiff={onOpenDiff}
      isCommitting={false}
      onCommit={vi.fn().mockResolvedValue(true)}
      lastCommitMessage={null}
      onAmend={vi.fn().mockResolvedValue(true)}
      log={[]}
      branches={[]}
      tags={[]}
      hasMoreLog={false}
      isLoadingLog={false}
      onLoadMoreLog={vi.fn()}
    />
  )
  await userEvent.click(screen.getByText('a.ts'))
  expect(onOpenDiff).toHaveBeenCalledWith('a.ts', true)
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx`
Expected: FAIL（新規 props が無い）

- [ ] **Step 3: `GitRepoView.tsx` を実装する**

全体を以下に書き換える:

```tsx
import type { GitBranch, GitFileStatus, GitLogEntry } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'
import HistorySection from './HistorySection'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onOpenDiff: (path: string, staged: boolean) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMoreLog: boolean
  isLoadingLog: boolean
  onLoadMoreLog: () => void
}

export default function GitRepoView({
  branch,
  ahead,
  behind,
  files,
  stagingPaths,
  onStage,
  onUnstage,
  onOpenDiff,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend,
  log,
  branches,
  tags,
  hasMoreLog,
  isLoadingLog,
  onLoadMoreLog
}: Props): React.JSX.Element {
  const stagedCount = files.filter((f) => f.index !== ' ' && f.index !== '?').length
  return (
    <>
      <div className="source-control-panel__branch">
        <span>{branch ?? '(no branch)'}</span>
        {ahead > 0 && <span className="source-control-panel__ahead">↑{ahead}</span>}
        {behind > 0 && <span className="source-control-panel__behind">↓{behind}</span>}
      </div>
      <CommitSection
        stagedCount={stagedCount}
        isCommitting={isCommitting}
        onCommit={onCommit}
        lastCommitMessage={lastCommitMessage}
        onAmend={onAmend}
      />
      <StagedSection
        files={files}
        stagingPaths={stagingPaths}
        onUnstage={onUnstage}
        onOpenDiff={(path) => onOpenDiff(path, true)}
      />
      <ChangesSection
        files={files}
        stagingPaths={stagingPaths}
        onStage={onStage}
        onOpenDiff={(path) => onOpenDiff(path, false)}
      />
      {files.length === 0 && <p className="source-control-panel__empty">変更はありません</p>}
      <HistorySection
        log={log}
        branches={branches}
        tags={tags}
        hasMore={hasMoreLog}
        isLoading={isLoadingLog}
        onLoadMore={onLoadMoreLog}
      />
    </>
  )
}
```

- [ ] **Step 4: `SourceControlPanel.tsx` を実装する**

`Props` インターフェースに `GitRepoView` と同じ新規 props（`onOpenDiff`、`lastCommitMessage`〜
`onLoadMoreLog`）を追加し、`GitRepoView` 呼び出しにそれらをそのまま渡す形に変更する
（`operationError` 等の既存 props はそのまま維持）。

- [ ] **Step 5: `useAppState.ts` を配線する**

`import` に `useDiffTabs`/`useGitHistory` を追加し、`git`/`gitOperations` の直後で呼び出す:

```ts
import { useDiffTabs } from './useDiffTabs'
import { useGitHistory } from './useGitHistory'
// ...
const git = useGitStatus(fileSystem.folderPath)
const gitOperations = useGitOperations(git.refreshGitStatus)
const diffTabs = useDiffTabs()
const gitHistory = useGitHistory(fileSystem.folderPath)
```

`AppState` 型の交差に `ReturnType<typeof useDiffTabs>` と `ReturnType<typeof useGitHistory>` を追加し、
返り値のスプレッドに `...diffTabs`、`...gitHistory` を追加する。

- [ ] **Step 6: `App.tsx` を配線する**

`useAppState()` からの分割代入（既存の `stagingPaths, stageFile, unstageFile, isCommitting, commit,
operationError` の並びの直後）に以下を追加する:

```ts
    diffTabs,
    activeDiffTab,
    openDiffTab,
    closeDiffTab,
    activateDiffTab,
    amend,
    log,
    branches,
    tags,
    hasMore,
    isLoading: isLoadingHistory,
    loadMore,
    refresh: refreshHistory,
```

冒頭 import に以下を追加する:

```ts
import * as gitApi from './lib/gitApi'
import * as fileSystemApi from './lib/fileSystemApi'
import type { FileTreeNode } from './types'
```

`export default function App(): React.JSX.Element {` の関数本体、`useAppState()` 呼び出しの直後に
diff 関連の state とハンドラを追加する:

```ts
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffStaged, setDiffStaged] = useState(false)

  const handleOpenDiff = useCallback(
    async (path: string, staged: boolean): Promise<void> => {
      openDiffTab({ path, staged })
      const content = await gitApi.getDiff(path, staged)
      setDiffContent(content)
      setDiffStaged(staged)
    },
    [openDiffTab]
  )

  useEffect(() => {
    if (activeDiffTab === null) return
    void handleOpenDiff(activeDiffTab.path, activeDiffTab.staged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiffTab])

  const handleStageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.stageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
    setDiffContent(content)
  }

  const handleUnstageHunk = async (patch: string): Promise<void> => {
    if (activeDiffTab === null) return
    await gitApi.unstageHunk(activeDiffTab.path, patch)
    await refreshGitStatus()
    const content = await gitApi.getDiff(activeDiffTab.path, activeDiffTab.staged)
    setDiffContent(content)
  }

  const handleCommit = async (message: string): Promise<boolean> => {
    const succeeded = await commit(message)
    if (succeeded) void refreshHistory()
    return succeeded
  }

  const handleAmend = async (message: string): Promise<boolean> => {
    const succeeded = await amend(message)
    if (succeeded) void refreshHistory()
    return succeeded
  }

  const handleAddToGitignore = (node: FileTreeNode): void => {
    void fileSystemApi.addToGitignore(node.path)
  }
```

（`useState`/`useCallback`/`useEffect` は React から import 済みか確認し、無ければ
`import { useState, useCallback, useEffect } from 'react'` を追加する。`handleOpenDiff` を
`useEffect` の依存配列に含めないのは、`openDiffTab` を依存に含めた `useCallback` 自体が
`activeDiffTab` の変更のたびに再生成されるものではなく、副作用の起点は `activeDiffTab` の
変更のみであるため。この 1 箇所に限り `eslint-disable-next-line` を付与する。）

`Sidebar` への呼び出し（既存の `onCommit={commit}` を `onCommit={handleCommit}` に置き換え、
`gitOperationError={operationError}` の直後）に以下を追加する:

```tsx
onOpenDiff={handleOpenDiff}
onAmend={handleAmend}
lastCommitMessage={log[0]?.message ?? null}
log={log}
branches={branches}
tags={tags}
hasMoreLog={hasMore}
isLoadingLog={isLoadingHistory}
onLoadMoreLog={loadMore}
onAddToGitignore={handleAddToGitignore}
```

`EditorPanel` への呼び出し（既存の `openedFileSignal={openedFileSignal}` の直後）に以下を追加する:

```tsx
diffTabs={diffTabs}
activeDiffTab={activeDiffTab}
onActivateDiffTab={activateDiffTab}
onCloseDiffTab={closeDiffTab}
diffContent={diffContent}
diffStaged={diffStaged}
onStageHunk={handleStageHunk}
onUnstageHunk={handleUnstageHunk}
```

- [ ] **Step 7: `Sidebar.tsx` を配線する**

`Props` インターフェースの `onCommit`/`gitOperationError` の並びの直後に以下を追加する:

```ts
onOpenDiff: (path: string, staged: boolean) => void
onAmend: (message: string) => Promise<boolean>
lastCommitMessage: string | null
log: GitLogEntry[]
branches: GitBranch[]
tags: string[]
hasMoreLog: boolean
isLoadingLog: boolean
onLoadMoreLog: () => void
onAddToGitignore: (node: FileTreeNode) => void
```

（`GitLogEntry`/`GitBranch`/`FileTreeNode` の import が無ければ追加する。）

分割代入に上記 props を追加し、`SourceControlPanel` 呼び出しにそのまま渡す。
`ExplorerPanel` 呼び出しに `onAddToGitignore={onAddToGitignore}` を追加する。

- [ ] **Step 8: CSS を追加する**

`src/renderer/src/assets/main.css` の末尾（`.source-control-panel__commit-btn:disabled` の
既存ブロックの後）に追加する:

```css
.source-control-panel__amend-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #cccccc;
}

.diff-view {
  padding: 8px;
  font-family: monospace;
  font-size: 12px;
  overflow: auto;
  height: 100%;
}

.diff-view__hunk {
  margin-bottom: 12px;
  border: 1px solid #333333;
  border-radius: 3px;
}

.diff-view__hunk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: #2d2d2d;
  border-bottom: 1px solid #333333;
}

.diff-view__hunk-header-text {
  color: #8a8a8a;
}

.diff-view__hunk-action-btn {
  padding: 2px 8px;
  background: #0e639c;
  border: none;
  border-radius: 3px;
  color: #ffffff;
  font-size: 11px;
  cursor: pointer;
}

.diff-view__hunk-action-btn:hover {
  background: #1177bb;
}

.diff-view__line {
  white-space: pre;
  padding: 0 8px;
}

.diff-view__line--added {
  background: rgba(46, 160, 67, 0.15);
  color: #3fb950;
}

.diff-view__line--removed {
  background: rgba(248, 81, 73, 0.15);
  color: #f85149;
}

.diff-view__line--context {
  color: #cccccc;
}

.history-section__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
}

.history-section__badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  background: #3c3c3c;
  color: #cccccc;
}

.history-section__badge--branch-current {
  background: #0e639c;
  color: #ffffff;
}

.history-section__log-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.history-section__log-item {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
  border-bottom: 1px solid #2d2d2d;
}

.history-section__log-hash {
  font-family: monospace;
  color: #8a8a8a;
  flex-shrink: 0;
}

.history-section__log-message {
  color: #cccccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-section__load-more-btn {
  width: 100%;
  padding: 4px;
  background: transparent;
  border: none;
  color: #8a8a8a;
  font-size: 12px;
  cursor: pointer;
}

.history-section__load-more-btn:hover:not(:disabled) {
  color: #cccccc;
}

.history-section__load-more-btn:disabled {
  cursor: default;
  opacity: 0.5;
}
```

- [ ] **Step 9: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control src/renderer/src/components/explorer src/renderer/src/components/__tests__/EditorPanel.test.tsx src/renderer/src/hooks/__tests__/useGitOperations.test.ts`
Expected: PASS（全件）

- [ ] **Step 10: 実装を戻してテストが落ちることを確認する**

Run: `git stash push src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx && npx vitest run src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx; git stash pop`
Expected: 新規追加したテストが FAIL する

- [ ] **Step 11: 全体テスト・型チェック**

Run: `npm run typecheck && npm test`
Expected: 型エラーなし、全テスト PASS（Task 11、14、15 で作った未コミット分もすべて含めて
緑になることを確認する）

- [ ] **Step 12: ESLint**

Run: `npx eslint src/main/gitService.ts src/main/handlers/gitHandlers.ts src/main/fileSystem.ts src/main/handlers/fileSystemHandlers.ts src/preload/api.ts src/renderer/src/lib/gitApi.ts src/renderer/src/lib/diffParser.ts src/renderer/src/hooks/useDiffTabs.ts src/renderer/src/hooks/useGitHistory.ts src/renderer/src/hooks/useGitOperations.ts src/renderer/src/hooks/useAppState.ts src/renderer/src/components/EditorPanel.tsx src/renderer/src/components/source-control/DiffView.tsx src/renderer/src/components/source-control/HistorySection.tsx src/renderer/src/components/source-control/CommitSection.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/source-control/ChangesSection.tsx src/renderer/src/components/source-control/StagedSection.tsx src/renderer/src/lib/explorerMenuItems.ts src/renderer/src/components/explorer/ExplorerPanel.tsx src/renderer/src/App.tsx src/renderer/src/components/Sidebar.tsx`
Expected: エラーなし

- [ ] **Step 13: コミット（Task 11, 14, 15, 18 まとめて）**

```bash
git add -u src/renderer/src/components/EditorPanel.tsx \
  src/renderer/src/components/__tests__/EditorPanel.test.tsx \
  src/renderer/src/components/source-control/CommitSection.tsx \
  src/renderer/src/components/source-control/__tests__/CommitSection.test.tsx \
  src/renderer/src/lib/explorerMenuItems.ts \
  src/renderer/src/lib/__tests__/explorerMenuItems.test.ts \
  src/renderer/src/components/explorer/ExplorerPanel.tsx \
  src/renderer/src/components/explorer/__tests__/ExplorerPanel.test.tsx \
  src/renderer/src/components/source-control/GitRepoView.tsx \
  src/renderer/src/components/source-control/__tests__/GitRepoView.test.tsx \
  src/renderer/src/components/source-control/SourceControlPanel.tsx \
  src/renderer/src/components/source-control/__tests__/SourceControlPanel.test.tsx \
  src/renderer/src/hooks/useAppState.ts \
  src/renderer/src/App.tsx \
  src/renderer/src/components/Sidebar.tsx \
  src/renderer/src/assets/main.css
git commit -m "$(cat <<'EOF'
feat: diffタブ・履歴表示・amend・gitignore追加をソース管理パネルに統合する

EditorPanelにdiffタブを統合し、CommitSectionのamend・
ExplorerPanelの.gitignore追加・GitRepoViewのHistorySectionを
useAppState/App.tsx/Sidebar.tsx経由で配線する。
EOF
)"
```

---

### Task 19: 最終確認

**Files:** なし

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 2: 全テストスイート実行**

Run: `npm test`
Expected: 全件 PASS

- [ ] **Step 3: ESLint（プロジェクト全体）**

Run: `npx eslint .`
Expected: このプランで変更したファイルに起因するエラーなし（既存の pre-existing なエラーが
あれば、この変更が原因でないことを確認した上でスコープ外とする）

- [ ] **Step 4: ROADMAP.md を更新する**

`<repo-root>/ROADMAP.md` の「ソース管理（Git）」セクション（実装済み機能側と、
今後実装した方がよい機能側の両方に記載がある）を確認し、以下を対応する:

実装済み機能セクションの「ソース管理（Git）」に以下を追加する:
```
- [x] 変更のステージ / アンステージ（ハンク単位）
- [x] ファイル差分（diff）の表示
- [x] コミット履歴 / ログの表示
- [x] ブランチの表示
- [x] タグの表示
- [x] コミット（amend）
- [x] `.gitignore` の編集補助
```

今後実装した方がよい機能セクションの「ソース管理（Git）」から、以下の行を削除する:
- `- [ ] 変更のステージ / アンステージ（ハンク単位）`
- `- [ ] ファイル差分（diff）の表示`
- `- [ ] コミット履歴 / ログの表示（グラフ表示）` は削除し、代わりに
  `- [ ] コミット履歴 / ログのグラフ表示` を追加する（今回実装したのは一覧表示のみで、
  グラフ表示は引き続き未実装のため）
- `- [ ] コミット（amend）`
- `.gitignore` の編集補助に関する行があれば削除する

以下の行は文言を変更する:
- `- [ ] タグの作成・表示` → `- [ ] タグの作成`（表示は実装済みのため）

残るその他の項目（プッシュ/プル/フェッチ、ブランチの切り替え・作成・削除・マージ、blame、stash、
discard、マージコンフリクト解決 UI、リモートの管理/clone）はそのまま残す。

- [ ] **Step 5: コミット**

```bash
git add -u ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: ソース管理機能拡張の実装完了をROADMAPに反映する
EOF
)"
```

---

### Task 20: Electron 実機での動作確認

**Files:** なし

- [ ] **Step 1: アプリを起動する**

Run: `npm run build` の後、`run` スキルのパターン（Playwright `_electron` + テスト用 Git
リポジトリでのドライバースクリプト、または `npm run dev` での目視確認）で起動する。

- [ ] **Step 2: diff 表示を確認する**

変更済みファイルの行をクリックし、中央エディタ領域に diff タブが開き、ハンクごとに +/- 表示が
出ることを確認する。

- [ ] **Step 3: ハンク単位のステージ/アンステージを確認する**

未ステージの diff で 1 つのハンクだけ「ステージ」をクリックし、`git status`（または
`ChangesSection`/`StagedSection` の表示）でそのファイルが両方のセクションに現れる（部分的に
ステージされた状態）ことを確認する。ステージ済み側の diff タブで「アンステージ」をクリックし、
元に戻ることを確認する。

- [ ] **Step 4: コミット履歴・ブランチ・タグ表示を確認する**

ソース管理パネルの「履歴」セクションに直近のコミットとブランチバッジが表示されることを確認する。
20 件以上コミットがあるリポジトリで「もっと見る」をクリックし、追加のコミットが表示されることを
確認する（無ければテストリポジトリで 21 件以上コミットを作成して確認する）。

- [ ] **Step 5: amend を確認する**

直前のコミット後、amend チェックボックスをオンにしてメッセージが自動入力されることを確認し、
コミットボタンを押して `git log` でメッセージが変わった（コミット数は変わらない）ことを確認する。

- [ ] **Step 6: `.gitignore` 追加を確認する**

ファイルツリーで任意のファイルを右クリックし「.gitignore に追加」を選択、`.gitignore` にパスが
追記されたことを確認する。

- [ ] **Step 7: アプリを停止する**

検証が終わったら、起動した Electron 本体と dev サーバーを停止する。`pgrep -fl` で対象プロセスを
確認してから `pkill -f`（リポジトリ名を含むパターンを使う）で停止する。

- [ ] **Step 8: 動作確認結果をユーザーに報告する**

問題があれば修正タスクを追加し、無ければ完了として報告する。
