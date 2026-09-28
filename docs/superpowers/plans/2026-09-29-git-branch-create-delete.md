# Git ブランチの作成・削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース管理パネルのブランチスイッチャーから、現在の HEAD を起点にしたブランチの作成（即時切り替え）と、ローカルブランチの削除（安全削除 → 未マージ時のみ強制削除の確認）をできるようにする。

**Architecture:** main プロセスの `gitService.ts` に `createBranch` / `deleteBranch` を追加し、IPC → preload → `gitApi` → `useGitBranchOperations` の既存の checkout と同じ経路で配線する。フックの実行中状態は `isCheckingOut: boolean` から `pendingBranchOperation` に一般化し、ブランチ操作どうしを1つの busy ref で排他にする。UI は `BranchSwitcherMenu` に作成ボタンと各行の削除ボタンを追加し、名前入力は既存の `NameInputDialog` に `validate` プロパティを足して流用する。

**Tech Stack:** Electron / React / TypeScript / simple-git 3.36.0 / Vitest / Testing Library

**Spec:** [docs/superpowers/specs/2026-09-29-git-branch-create-delete-design.md](../specs/2026-09-29-git-branch-create-delete-design.md)

## Global Constraints

- すべてのコメント・コミットメッセージ・UI 文言は日本語。コミットメッセージは Conventional Commit 形式
- **`git commit` / `git push` はユーザーが明示的に指示した場合のみ実行する**（CLAUDE.md）。各タスクの「コミット」ステップは、指示が無ければ変更をステージせずに次へ進む
- `git add -A` は使わない。対象ファイルを明示して `git add` する
- 型としてのみ使う import は `import type`
- `env()` を simple-git に使わない（`gitService.ts` の `getLog` のコメント参照。`blockUnsafeOperationsPlugin` の地雷）
- git のエラーメッセージ文字列で分岐しない（ロケール依存。`docs/review-findings-patterns.md` パターン18）
- テストは TDD。実装後、`git stash push <実装ファイル>` → テスト失敗を確認 → `git stash pop` で検知力を確認する
- `act(...).then(...)` 形式でテストを書かない（`await act(async () => { ... })` を使う）
- 検証コマンド: `npm test` / `npm run typecheck` / 変更したファイルへの `npx eslint <files>`
- UI 文言（spec から転記、完全一致で使う）:
  - 作成ボタン: `＋ 新しいブランチを作成…`
  - 入力ダイアログのタイトル: `新しいブランチ名`
  - 削除ボタンの `aria-label`: `ブランチ <name> を削除`
  - 1回目の削除確認: `ブランチ <name> を削除しますか？`
  - 2回目の削除確認: `ブランチ <name> にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？`
  - トリガー表示: 作成中 `作成中...` / 削除中 `削除中...`（`aria-label` はそれぞれ `ブランチ作成中` / `ブランチ削除中`）
  - main 側エラー: `` `-` で始まるブランチ名は使用できません: <name> `` / `ブランチ名として使用できない名前です: <name>` / `同じ名前のブランチが既に存在します: <name>` / `存在しないブランチです: <name>` / `現在のブランチは削除できません: <name>` / `他のワークツリーで使用中のブランチは削除できません: <name>`
  - ダイアログ内の検証: `名前を入力してください` / `` `-` で始まる名前は使用できません `` / `同じ名前のブランチが既に存在します` / `この名前は使用できません`（`@` のみの名前）

## File Structure

| ファイル                                                                 | 責務                                                        | 変更   |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- | ------ |
| `src/shared/types/git.ts`                                                | `DeleteBranchResult` 型                                     | Modify |
| `src/main/gitService.ts`                                                 | `createBranch` / `deleteBranch` / マージ判定ヘルパー        | Modify |
| `src/main/handlers/gitHandlers.ts`                                       | IPC `git:createBranch` / `git:deleteBranch`（引数の型検証） | Modify |
| `src/preload/api.ts` / `src/preload/index.d.ts`                          | preload API                                                 | Modify |
| `src/renderer/src/lib/gitApi.ts`                                         | renderer 側ラッパー                                         | Modify |
| `src/renderer/src/hooks/useGitBranchOperations.ts`                       | `pendingBranchOperation`、`createBranch`、`deleteBranch`    | Modify |
| `src/renderer/src/components/explorer/NameInputDialog.tsx`               | `validate` プロパティ                                       | Modify |
| `src/renderer/src/lib/branchNameValidation.ts`                           | ダイアログ用のブランチ名検証（純粋関数）                    | Create |
| `src/renderer/src/components/source-control/BranchSwitcherMenu.tsx`      | 作成ボタン・削除ボタン・`Delete` キー                       | Modify |
| `src/renderer/src/components/source-control/BranchSwitcher.tsx`          | 入力ダイアログの開閉、表示ラベル、フォーカス復帰            | Modify |
| `GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` / `App.tsx` | Props の配線                                                | Modify |
| `src/renderer/src/assets/main.css`                                       | 作成ボタン・削除ボタン・行レイアウト                        | Modify |
| `ROADMAP.md`                                                             | 実装済みへの移動                                            | Modify |

各テストは既存の `__tests__` ディレクトリに置く（`src/main/__tests__/gitService.test.ts` など）。

---

### Task 1: `DeleteBranchResult` 型と `gitService.createBranch`

**Files:**

- Modify: `src/shared/types/git.ts`（`GitBranch` の直後）
- Modify: `src/main/gitService.ts`（`checkoutBranch` の直後）
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**

- Produces: `createBranch(folderPath: string, branchName: string): Promise<void>`、`export type DeleteBranchResult = { deleted: true } | { deleted: false; reason: 'not-fully-merged' }`（`src/shared/types.ts` が `export type * from './types/git'` で再エクスポートしているため、`@shared/types` から import できる）

- [ ] **Step 1: 型を追加する**

`src/shared/types/git.ts` の `GitBranch` の直後に追加:

```ts
// 安全削除(git branch -d)の結果。未マージで削除しなかった場合を例外ではなく
// 戻り値で返す(renderer 側が git のエラーメッセージ文字列で分岐しないため)
export type DeleteBranchResult = { deleted: true } | { deleted: false; reason: 'not-fully-merged' }
```

- [ ] **Step 2: テストのモックに `checkoutLocalBranch` と `deleteLocalBranch` を足す**

`gitService.test.ts` の先頭のモック定義に追加し、`mockSimpleGit` が返す `git` オブジェクトにも登録する:

```ts
const mockCheckoutLocalBranch = vi.hoisted(() => vi.fn())
const mockDeleteLocalBranch = vi.hoisted(() => vi.fn())
```

```ts
      checkout: mockCheckout,
      checkoutLocalBranch: mockCheckoutLocalBranch,
      deleteLocalBranch: mockDeleteLocalBranch
```

import 文に `createBranch` を追加する。

- [ ] **Step 3: 失敗するテストを書く**

`describe('checkoutBranch')` の後に追加:

```ts
describe('createBranch', () => {
  // check-ref-format --branch は成功時に正規化後の名前を出力する(実機 git 2.50.1 で確認)
  const mockCheckRefFormatOk = (name: string): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'check-ref-format') return `${name}\n`
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  it('検証を通過したら checkoutLocalBranch を branchName で呼ぶ', async () => {
    mockCheckRefFormatOk('feature/new')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    mockCheckoutLocalBranch.mockResolvedValue(undefined)
    await createBranch('/project', 'feature/new')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(['check-ref-format', '--branch', 'feature/new'])
    expect(mockCheckoutLocalBranch).toHaveBeenCalledWith('feature/new')
  })

  // '-' 始まりは check-ref-format 自体にオプションとして解釈されるため、
  // git に渡す前に弾く(docs/review-findings-patterns.md パターン21)
  it("'-' で始まる名前は git を一切呼ばずに拒否する", async () => {
    await expect(createBranch('/project', '--orphan')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: --orphan'
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  it('check-ref-format が失敗したら日本語エラーにして checkoutLocalBranch を呼ばない', async () => {
    mockRaw.mockRejectedValue(new MockGitError("fatal: 'a..b' is not a valid branch name"))
    await expect(createBranch('/project', 'a..b')).rejects.toThrow(
      'ブランチ名として使用できない名前です: a..b'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // check-ref-format --branch は '@{-1}' を直前のブランチ名へ展開して成功扱いにする
  // (実機で '@{-1}' → 'topic' を確認)。出力が入力と一致しない名前は拒否する
  it('check-ref-format の出力が入力と一致しない(@{-1} 等の展開)場合は拒否する', async () => {
    mockRaw.mockResolvedValue('topic\n')
    await expect(createBranch('/project', '@{-1}')).rejects.toThrow(
      'ブランチ名として使用できない名前です: @{-1}'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  it('同名のローカルブランチが既にあれば拒否する', async () => {
    mockCheckRefFormatOk('main')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    await expect(createBranch('/project', 'main')).rejects.toThrow(
      '同じ名前のブランチが既に存在します: main'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  it('checkoutLocalBranch が throw した場合エラーがそのまま伝播する', async () => {
    mockCheckRefFormatOk('feature/new')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    mockCheckoutLocalBranch.mockRejectedValue(new Error('checkout -b failed'))
    await expect(createBranch('/project', 'feature/new')).rejects.toThrow('checkout -b failed')
  })
})
```

- [ ] **Step 4: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t createBranch`
Expected: FAIL（`createBranch` が export されていない）

- [ ] **Step 5: 実装する**

`gitService.ts` の `checkoutBranch` の直後に追加:

```ts
// 現在の HEAD から新しいブランチを作り、そのブランチへ切り替える(git checkout -b)。
// HEAD の指すコミットは変わらないため working tree/index は変化せず、未コミットの
// 変更はそのまま新しいブランチへ持ち越される(renderer 側で未保存編集の破棄確認や
// エディタの再読込が不要な理由)。
//
// branchName は IPC 境界から届く任意の文字列のため、次の順で検証する:
// 1. '-' 始まりは git に渡す前に拒否する。check-ref-format 自体にもオプションとして
//    解釈されてしまうため(docs/review-findings-patterns.md パターン21)
// 2. git 本体の規則(`..`、空白、`~^:?*[\`、末尾の .lock 等)は check-ref-format --branch
//    に委ねる。--branch は '@{-1}'(直前のブランチ)を実在のブランチ名へ展開して成功扱いに
//    するため、出力(正規化後の名前)が入力と一致することも確認する
// 3. 同名の既存ブランチは checkout -b の失敗(英語のエラー文)を見せる前に日本語で弾く
export async function createBranch(folderPath: string, branchName: string): Promise<void> {
  if (branchName.startsWith('-')) {
    throw new Error(`\`-\` で始まるブランチ名は使用できません: ${branchName}`)
  }
  const git = simpleGit(folderPath)
  let normalized: string
  try {
    normalized = (await git.raw(['check-ref-format', '--branch', branchName])).trim()
  } catch {
    throw new Error(`ブランチ名として使用できない名前です: ${branchName}`)
  }
  if (normalized !== branchName) {
    throw new Error(`ブランチ名として使用できない名前です: ${branchName}`)
  }
  const summary = await git.branchLocal()
  if (summary.all.includes(branchName)) {
    throw new Error(`同じ名前のブランチが既に存在します: ${branchName}`)
  }
  await git.checkoutLocalBranch(branchName)
}
```

- [ ] **Step 6: テストが通ることと、検知力を確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t createBranch`
Expected: PASS（6件）

`normalized !== branchName` の判定を一時的に消して `@{-1}` のテストが落ちること、`startsWith('-')` の判定を消して `'-' で始まる` のテストが落ちることを確認してから戻す。

- [ ] **Step 7: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/shared/types/git.ts src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "feat: Gitブランチ作成APIをmainプロセスに追加する"
```

---

### Task 2: `gitService.deleteBranch`（マージ判定・worktree チェック）

**Files:**

- Modify: `src/main/gitService.ts`（`createBranch` の直後）
- Test: `src/main/__tests__/gitService.test.ts`

**Interfaces:**

- Consumes: `DeleteBranchResult`（Task 1）
- Produces: `deleteBranch(folderPath: string, branchName: string, force: boolean): Promise<DeleteBranchResult>`

**前提（2026-09-29 に実機 git 2.50.1 / simple-git 3.36.0 で確認済み）:**

- `git for-each-ref --format=%(upstream) refs/heads/<name>`: upstream 未設定なら空行、設定済みなら `refs/remotes/origin/x` 等
- `git rev-parse --verify --quiet <ref>`: ref が無いと exit 1・stderr 空。simple-git は「exit code が非0かつ stderr が空でない」ときだけ reject するため（`dist/cjs/index.js` の `result.exitCode && result.stdErr.length`）、`raw()` は空文字で resolve する
- `git for-each-ref --merged=<基準> --format=%(refname) refs/heads/<name>`: マージ済みなら `refs/heads/<name>`、未マージなら空
- `git worktree list --porcelain`: 各 worktree ごとに `branch refs/heads/<name>` 行を含む（detached の worktree は `detached` 行）。先頭の worktree はメインの作業ディレクトリ自身
- `deleteLocalBranch(name, force)` は `git branch -v -d|-D <name>` を実行する

- [ ] **Step 1: 失敗するテストを書く**

import 文に `deleteBranch` を追加し、`describe('createBranch')` の後に追加:

```ts
describe('deleteBranch', () => {
  // raw() の呼び出しを「コマンドの先頭引数 → 戻り値」で振り分ける。
  // 実機の出力形式は Task 2 冒頭の「前提」を参照
  const setupRaw = (outputs: {
    worktree?: string
    upstream?: string
    revParse?: string
    merged?: string
  }): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree')
        return outputs.worktree ?? 'worktree /project\nHEAD abc\nbranch refs/heads/main\n'
      if (args[0] === 'for-each-ref' && args[1] === '--format=%(upstream)')
        return outputs.upstream ?? '\n'
      if (args[0] === 'rev-parse') return outputs.revParse ?? ''
      if (args[0] === 'for-each-ref' && args[1].startsWith('--merged=')) return outputs.merged ?? ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockDeleteLocalBranch.mockResolvedValue({ branch: 'feature/x', hash: 'abc', success: true })
  })

  it('存在しないブランチ名は git の削除を呼ばずに拒否する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', '--force', false)).rejects.toThrow(
      '存在しないブランチです: --force'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('現在のブランチは拒否する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', 'main', true)).rejects.toThrow(
      '現在のブランチは削除できません: main'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  // 別 worktree で使用中のブランチの削除失敗は、未マージの失敗と同じ
  // `error: ... '<name>'` 形式になり区別できない(実機で確認)。事前に弾かないと
  // 「強制削除しますか？」と誤って聞いてしまう
  it('別の worktree でチェックアウトされているブランチは拒否する', async () => {
    setupRaw({
      worktree:
        'worktree /project\nHEAD abc\nbranch refs/heads/main\n\n' +
        'worktree /other\nHEAD def\nbranch refs/heads/feature/x\n'
    })
    await expect(deleteBranch('/project', 'feature/x', true)).rejects.toThrow(
      '他のワークツリーで使用中のブランチは削除できません: feature/x'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('upstream が無くマージ済み(HEAD 基準)なら安全削除して deleted: true を返す', async () => {
    setupRaw({ upstream: '\n', merged: 'refs/heads/feature/x\n' })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({ deleted: true })
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=HEAD',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
    expect(mockDeleteLocalBranch).toHaveBeenCalledWith('feature/x', false)
  })

  it('未マージなら削除を呼ばずに not-fully-merged を返す', async () => {
    setupRaw({ upstream: '\n', merged: '' })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({
      deleted: false,
      reason: 'not-fully-merged'
    })
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('upstream が設定され実在すれば、upstream を基準にマージ判定する', async () => {
    setupRaw({
      upstream: 'refs/remotes/origin/feature/x\n',
      revParse: 'abc123\n',
      merged: 'refs/heads/feature/x\n'
    })
    await deleteBranch('/project', 'feature/x', false)
    expect(mockRaw).toHaveBeenCalledWith([
      'rev-parse',
      '--verify',
      '--quiet',
      'refs/remotes/origin/feature/x'
    ])
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=refs/remotes/origin/feature/x',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
  })

  // git 本体も upstream の ref が解決できなければ HEAD にフォールバックする
  it('upstream が設定されていても ref が消えていれば HEAD を基準にする', async () => {
    setupRaw({
      upstream: 'refs/remotes/origin/gone\n',
      revParse: '',
      merged: 'refs/heads/feature/x\n'
    })
    await deleteBranch('/project', 'feature/x', false)
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=HEAD',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
  })

  it('force が true ならマージ判定をせずに強制削除する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', 'feature/x', true)).resolves.toEqual({ deleted: true })
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['rev-parse']))
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['--format=%(upstream)']))
    expect(mockDeleteLocalBranch).toHaveBeenCalledWith('feature/x', true)
  })

  it('削除コマンドが throw した場合エラーがそのまま伝播する', async () => {
    setupRaw({ upstream: '\n', merged: 'refs/heads/feature/x\n' })
    mockDeleteLocalBranch.mockRejectedValue(new Error('delete failed'))
    await expect(deleteBranch('/project', 'feature/x', false)).rejects.toThrow('delete failed')
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t deleteBranch`
Expected: FAIL（`deleteBranch` が export されていない）

- [ ] **Step 3: 実装する**

`gitService.ts` の import に `DeleteBranchResult` を追加する（`import type { GitStatusResult, GitLogEntry, GitBranch, DeleteBranchResult } from '@shared/types'`）。`createBranch` の直後に追加:

```ts
// git worktree list --porcelain の `branch refs/heads/<name>` 行から、いずれかの
// worktree(メインの作業ディレクトリ自身を含む)でチェックアウト中のブランチ名を集める。
// porcelain 形式はロケールに依存しない
async function getBranchesCheckedOutInWorktrees(git: SimpleGit): Promise<Set<string>> {
  const output = await git.raw(['worktree', 'list', '--porcelain'])
  const prefix = 'branch refs/heads/'
  return new Set(
    output
      .split('\n')
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length))
  )
}

// git branch -d と同じ基準でマージ済みかを判定する。基準は「upstream が設定され、
// その ref が実在すれば upstream、そうでなければ HEAD」(git 本体の branch_merged と同じ)。
// 削除失敗のエラーから未マージを判定しないのは次の理由(spec 参照):
// - simple-git が GitResponseError に変換するのは git の出力が英語の `error: ... '<name>'`
//   形式のときだけで、日本語化された git では変換されない
// - ロケールを固定する env() は blockUnsafeOperationsPlugin の地雷を踏む(getLog 参照)
// 使うコマンドはいずれも「出力の有無」だけで判定でき、ロケールに依存しない。
// rev-parse --verify --quiet は ref が無いと exit 1・stderr 空で終わるが、simple-git は
// stderr が空なら reject しないため空文字で resolve する
async function isBranchMerged(git: SimpleGit, branchName: string): Promise<boolean> {
  const ref = `refs/heads/${branchName}`
  const upstream = (await git.raw(['for-each-ref', '--format=%(upstream)', ref])).trim()
  let base = 'HEAD'
  if (upstream !== '') {
    const resolved = (await git.raw(['rev-parse', '--verify', '--quiet', upstream])).trim()
    if (resolved !== '') base = upstream
  }
  const merged = await git.raw(['for-each-ref', `--merged=${base}`, '--format=%(refname)', ref])
  return merged.trim() === ref
}

// branchName は IPC 境界から届く任意の文字列のため、checkoutBranch と同じく許可リスト
// (実在するローカルブランチ名)で検証してから git に渡す(パターン21)。
// 事前チェックと削除の間に別プロセスがマージや worktree 追加を行う競合は対象外とする。
// その場合は git 自身が削除を拒否してエラーになるだけで、コミットは失われない
export async function deleteBranch(
  folderPath: string,
  branchName: string,
  force: boolean
): Promise<DeleteBranchResult> {
  const git = simpleGit(folderPath)
  const summary = await git.branchLocal()
  if (!summary.all.includes(branchName)) {
    throw new Error(`存在しないブランチです: ${branchName}`)
  }
  if (branchName === summary.current) {
    throw new Error(`現在のブランチは削除できません: ${branchName}`)
  }
  const checkedOut = await getBranchesCheckedOutInWorktrees(git)
  if (checkedOut.has(branchName)) {
    throw new Error(`他のワークツリーで使用中のブランチは削除できません: ${branchName}`)
  }
  if (!force && !(await isBranchMerged(git, branchName))) {
    return { deleted: false, reason: 'not-fully-merged' }
  }
  await git.deleteLocalBranch(branchName, force)
  return { deleted: true }
}
```

- [ ] **Step 4: テストが通ることと、検知力を確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t deleteBranch`
Expected: PASS（9件）

次のミューテーションでそれぞれ該当テストが落ちることを確認してから戻す:

- `if (resolved !== '') base = upstream` を `base = upstream` にする → 「ref が消えていれば HEAD」が落ちる
- worktree チェックを消す → 「別の worktree」が落ちる
- `!force &&` を消す → 「force が true ならマージ判定をせずに」が落ちる

- [ ] **Step 5: 実機で前提を再確認する**

一時ディレクトリの実リポジトリで、`deleteBranch` を直接呼ぶ小さなスクリプトは書かず、Task 2 冒頭の「前提」の各コマンドを手で実行して出力形式が変わっていないことを確認する:

```bash
cd "$(mktemp -d)" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m a && git branch merged1 && git checkout -q -b topic && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m b && git checkout -q -
git for-each-ref --merged=HEAD --format='%(refname)' refs/heads/merged1 refs/heads/topic
git rev-parse --verify --quiet refs/remotes/origin/gone; echo "rc=$?"
git worktree list --porcelain
```

Expected: 1行目は `refs/heads/merged1` のみ、2行目は出力なしで `rc=1`、3行目は `branch refs/heads/<現在のブランチ>` を含む

- [ ] **Step 6: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/main/gitService.ts src/main/__tests__/gitService.test.ts
git commit -m "feat: Gitブランチ削除APIをmainプロセスに追加する"
```

---

### Task 3: IPC・preload・`gitApi` の配線

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`（import と `git:checkoutBranch` の直後）
- Modify: `src/preload/api.ts`、`src/preload/index.d.ts`
- Modify: `src/renderer/src/lib/gitApi.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`、`src/preload/__tests__/api.test.ts`

**Interfaces:**

- Consumes: `createBranch` / `deleteBranch`（Task 1, 2）
- Produces: `gitApi.createBranch(branchName: string): Promise<void>`、`gitApi.deleteBranch(branchName: string, force: boolean): Promise<DeleteBranchResult>`、`window.api` の同名メソッド

- [ ] **Step 1: 失敗するテストを書く**

`gitHandlers.test.ts` のモック定義に `mockCreateBranch` / `mockDeleteBranch` を追加して `vi.mock('../../gitService', ...)` に登録し、`describe('git:checkoutBranch')` の後に追加:

```ts
describe('git:createBranch', () => {
  it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('git:createBranch')(makeEvent(1), 'feature/new')
    ).rejects.toThrow('No folder open')
  })

  it('allowedFolder と branchName を引数に createBranch を呼ぶ', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockCreateBranch.mockResolvedValue(undefined)
    await getRegisteredHandler('git:createBranch')(makeEvent(1), 'feature/new')
    expect(mockCreateBranch).toHaveBeenCalledWith('/project', 'feature/new')
  })

  // IPC 境界は任意の値を受け付けるため、service の startsWith 等が TypeError で
  // 落ちる前に型を検証する
  it('branchName が文字列でなければ createBranch を呼ばずに拒否する', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:createBranch')(makeEvent(1), 123)).rejects.toThrow(
      'Invalid branch name'
    )
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })
})

describe('git:deleteBranch', () => {
  it('allowedFolder・branchName・force を引数に deleteBranch を呼び、結果を返す', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockDeleteBranch.mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
    await expect(
      getRegisteredHandler('git:deleteBranch')(makeEvent(1), 'feature/x', false)
    ).resolves.toEqual({ deleted: false, reason: 'not-fully-merged' })
    expect(mockDeleteBranch).toHaveBeenCalledWith('/project', 'feature/x', false)
  })

  // force は真偽値だけを受け付ける。'true' 等の truthy な値で意図せず強制削除
  // されるのを防ぐ
  it('force が boolean でなければ deleteBranch を呼ばずに拒否する', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('git:deleteBranch')(makeEvent(1), 'feature/x', 'true')
    ).rejects.toThrow('Invalid force flag')
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it('branchName が文字列でなければ deleteBranch を呼ばずに拒否する', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(
      getRegisteredHandler('git:deleteBranch')(makeEvent(1), null, false)
    ).rejects.toThrow('Invalid branch name')
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })
})
```

`api.test.ts` の `checkoutBranch` のケースの直後に追加:

```ts
  [
    'createBranch は git:createBranch チャンネルに branchName を渡す',
    () => api.createBranch('feature/new'),
    ['git:createBranch', 'feature/new']
  ],
  [
    'deleteBranch は git:deleteBranch チャンネルに branchName と force を渡す',
    () => api.deleteBranch('feature/x', true),
    ['git:deleteBranch', 'feature/x', true]
  ],
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts`
Expected: FAIL（ハンドラー未登録、`api.createBranch` 未定義）

- [ ] **Step 3: 実装する**

`gitHandlers.ts` の import に `createBranch, deleteBranch` を追加し、`git:checkoutBranch` の直後に追加:

```ts
ipcMain.handle('git:createBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  if (typeof branchName !== 'string') throw new Error('Invalid branch name')
  await createBranch(allowedFolder, branchName)
})

// force は厳密に boolean だけを受け付ける('true' 等の truthy な値で強制削除されないため)
ipcMain.handle(
  'git:deleteBranch',
  async (event: IpcMainInvokeEvent, branchName: unknown, force: unknown) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    if (typeof branchName !== 'string') throw new Error('Invalid branch name')
    if (typeof force !== 'boolean') throw new Error('Invalid force flag')
    return deleteBranch(allowedFolder, branchName, force)
  }
)
```

`src/preload/api.ts` の `checkoutBranch` の直後に追加（`DeleteBranchResult` を `import type` に追加）:

```ts
  createBranch: (branchName: string): Promise<void> =>
    ipcRenderer.invoke('git:createBranch', branchName),
  deleteBranch: (branchName: string, force: boolean): Promise<DeleteBranchResult> =>
    ipcRenderer.invoke('git:deleteBranch', branchName, force),
```

`src/preload/index.d.ts` の `checkoutBranch` の直後に追加（`DeleteBranchResult` を import に追加）:

```ts
      createBranch(branchName: string): Promise<void>
      deleteBranch(branchName: string, force: boolean): Promise<DeleteBranchResult>
```

`src/renderer/src/lib/gitApi.ts` の末尾に追加（`import type { DeleteBranchResult } from '@shared/types'` を追加）:

```ts
export function createBranch(branchName: string): Promise<void> {
  return window.api.createBranch(branchName)
}

export function deleteBranch(branchName: string, force: boolean): Promise<DeleteBranchResult> {
  return window.api.deleteBranch(branchName, force)
}
```

- [ ] **Step 4: テストと型チェックが通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts && npm run typecheck`
Expected: PASS、型エラーなし

`typeof force !== 'boolean'` を消すと `force が boolean でなければ` のテストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/gitApi.ts
git commit -m "feat: ブランチ作成・削除のIPCとpreload APIを追加する"
```

---

### Task 4: 実行中状態を `pendingBranchOperation` に一般化する（振る舞い変更なしのリファクタ）

**Files:**

- Modify: `src/renderer/src/hooks/useGitBranchOperations.ts`
- Modify: `src/renderer/src/components/source-control/BranchSwitcher.tsx`、`GitRepoView.tsx`、`SourceControlPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`
- Test: `useGitBranchOperations.test.ts`、`BranchSwitcher.test.tsx`、`GitRepoView.test.tsx`、`SourceControlPanel.test.tsx`、`Sidebar.test.tsx`

**Interfaces:**

- Produces: `export type BranchOperationKind = 'checkout' | 'create' | 'delete'`（`useGitBranchOperations.ts` から export）、フックの戻り値 `pendingBranchOperation: BranchOperationKind | null`（`isCheckingOut` は削除）、全コンポーネントの Props `pendingBranchOperation: BranchOperationKind | null`（`isCheckingOut` は削除）

- [ ] **Step 1: フックのテストを新しい名前に書き換える（失敗する状態にする）**

`useGitBranchOperations.test.ts` の `result.current.isCheckingOut` をすべて `result.current.pendingBranchOperation` に置き換え、期待値を `true` → `'checkout'`、`false` → `null` に変える。テスト名の `isCheckingOut` も `pendingBranchOperation` に置き換える。

`BranchSwitcher.test.tsx` の `baseProps` の `isCheckingOut: false` を `pendingBranchOperation: null` に、`isCheckingOut={true}` を `pendingBranchOperation="checkout"` に置き換える（テスト名も同様）。`GitRepoView.test.tsx` / `SourceControlPanel.test.tsx` / `Sidebar.test.tsx` の `isCheckingOut: false` と `isCheckingOut={false}` を `pendingBranchOperation: null` / `pendingBranchOperation={null}` に置き換える。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts src/renderer/src/components`
Expected: FAIL（`pendingBranchOperation` が undefined）

- [ ] **Step 3: フックを実装する**

`useGitBranchOperations.ts` の状態と `checkoutBranch` を次のように変える:

```ts
export type BranchOperationKind = 'checkout' | 'create' | 'delete'

export interface GitBranchOperationsState {
  /** 実行中のブランチ操作。checkout/作成/削除は1つの busy ref で相互に排他にする
   *  (どれも refs/heads や HEAD を変えるため、並行すると一覧の再取得結果や
   *  切替先の存在が食い違う) */
  pendingBranchOperation: BranchOperationKind | null
  // checkoutBranch と branchOperationError は既存のまま
}
```

```ts
const [pendingBranchOperation, setPendingBranchOperation] = useState<BranchOperationKind | null>(
  null
)
const isBranchOperationRunningRef = useRef(false)
// 操作ごとの setBusy を作る。ref(同期判定用)と state(表示用)を同時に更新する
const makeSetBusy =
  (kind: BranchOperationKind) =>
  (busy: boolean): void => {
    isBranchOperationRunningRef.current = busy
    setPendingBranchOperation(busy ? kind : null)
  }
```

`checkoutBranch` の `isBusy` と `setBusy` を置き換える:

```ts
      isBusy: () =>
        isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
      setBusy: makeSetBusy('checkout'),
```

戻り値を `{ pendingBranchOperation, checkoutBranch, branchOperationError }` にする。`isCheckingOut` / `isCheckingOutRef` / `setIsCheckingOut` は削除する。

- [ ] **Step 4: コンポーネントの Props を置き換える**

`BranchSwitcher.tsx`:

```tsx
import type { BranchOperationKind } from '../../hooks/useGitBranchOperations'
```

Props の `isCheckingOut: boolean` を削除し、`pendingBranchOperation: BranchOperationKind | null` を追加する。本体の `isCheckingOut` を使う箇所を次に置き換える:

```tsx
const isDisabled = pendingBranchOperation !== null || isBlocked
```

```tsx
// 実行中の操作に応じて表示とアクセシブルネームを同期させる(パターン17)
const pendingLabel: Record<BranchOperationKind, { text: string; aria: string }> = {
  checkout: { text: '切り替え中...', aria: 'ブランチ切り替え中' },
  create: { text: '作成中...', aria: 'ブランチ作成中' },
  delete: { text: '削除中...', aria: 'ブランチ削除中' }
}
const pending = pendingBranchOperation !== null ? pendingLabel[pendingBranchOperation] : null
const ariaLabel =
  pending?.aria ??
  (isBlocked ? '他の操作が完了するまでブランチを切り替えられません' : 'ブランチを切り替え')
```

ボタンの中身を `{pending?.text ?? currentBranch ?? '(no branch)'}` にする。`isBlocked` の JSDoc 中の `isCheckingOut と違い` は `pendingBranchOperation と違い` に直す。

`GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx`: Props の `isCheckingOut: boolean` を `pendingBranchOperation: BranchOperationKind | null` に置き換え（`import type { BranchOperationKind } from` はそれぞれの相対パスで `hooks/useGitBranchOperations`）、分割代入と子への受け渡しも `pendingBranchOperation={pendingBranchOperation}` に置き換える。

`App.tsx`: `useAppState()` の分割代入の `isCheckingOut,` を `pendingBranchOperation,` に、`<Sidebar ... isCheckingOut={isCheckingOut}` を `pendingBranchOperation={pendingBranchOperation}` に置き換える。

- [ ] **Step 5: BranchSwitcher に作成・削除中の表示テストを足す**

`BranchSwitcher.test.tsx` の「`pendingBranchOperation` が checkout のとき aria-label も…」の後に追加:

```tsx
it.each([
  ['create', '作成中...', 'ブランチ作成中'],
  ['delete', '削除中...', 'ブランチ削除中']
] as const)(
  'pendingBranchOperation が %s のとき表示テキストと aria-label が同期し、disabled になる',
  (kind, text, aria) => {
    render(<BranchSwitcher {...baseProps} pendingBranchOperation={kind} />)
    const trigger = screen.getByRole('button', { name: aria })
    expect(trigger).toHaveTextContent(text)
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'ブランチを切り替え' })).not.toBeInTheDocument()
  }
)
```

- [ ] **Step 6: 全テスト・型チェック・lint を通す**

Run: `npm test && npm run typecheck && npx eslint src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/components/source-control/BranchSwitcher.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx`
Expected: すべて PASS。`grep -rn "isCheckingOut" src` の結果が0件

- [ ] **Step 7: コミット（ユーザーの指示がある場合のみ）**

```bash
git add -u src/renderer/src
git commit -m "refactor: ブランチ操作の実行中状態をpendingBranchOperationへ一般化する"
```

---

### Task 5: フックの `createBranch`

**Files:**

- Modify: `src/renderer/src/hooks/useGitBranchOperations.ts`
- Test: `src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`

**Interfaces:**

- Consumes: `gitApi.createBranch`（Task 3）、`makeSetBusy` / `isBranchOperationRunningRef`（Task 4）
- Produces: `createBranch(branchName: string): Promise<boolean>`（戻り値は「実行され成功したか」）

- [ ] **Step 1: 失敗するテストを書く**

`const mockCreateBranch = vi.mocked(gitApi.createBranch)` を追加し、ファイル末尾に追加:

```ts
describe('createBranch', () => {
  it('gitApi.createBranch を呼び、成功したら true を返して一覧を再取得する', async () => {
    mockCreateBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, makeFileLock())
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.createBranch('feature/new')
    })
    expect(succeeded).toBe(true)
    expect(mockCreateBranch).toHaveBeenCalledWith('feature/new')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // HEAD の参照先を変えるため checkout と同じく全体ロックを取る。これにより
  // push 側の既存の判定(lock.isAnyLocked())で「作成中の push」が自動的に防がれる
  it('実行中は lockGlobal を取り、完了後に unlockGlobal する', async () => {
    mockCreateBranch.mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock
      )
    )
    await act(async () => {
      await result.current.createBranch('feature/new')
    })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('実行中は pendingBranchOperation が create になり、完了後 null に戻る', async () => {
    let resolveCreate: () => void = () => {}
    mockCreateBranch.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = result.current.createBranch('feature/new')
    })
    expect(result.current.pendingBranchOperation).toBe('create')
    await act(async () => {
      resolveCreate()
      await pending
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('失敗したら false を返し、branchOperationError に反映する', async () => {
    mockCreateBranch.mockRejectedValue(new Error('同じ名前のブランチが既に存在します: main'))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.createBranch('main')
    })
    expect(succeeded).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      '同じ名前のブランチが既に存在します: main'
    )
  })

  // 他の条件(isAnyLocked)が偶然真にならない固定モックで、ブランチ操作どうしの
  // 排他だけを検証する(パターン16)
  it('checkout の実行中は createBranch を呼ばない', async () => {
    mockCheckoutBranch.mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    act(() => {
      void result.current.checkoutBranch('feature/x')
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.createBranch('feature/new')
    })
    expect(succeeded).toBe(false)
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })

  it('他操作中(lock.isAnyLocked())は createBranch を呼ばない', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock
      )
    )
    await act(async () => {
      await result.current.createBranch('feature/new')
    })
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts -t createBranch`
Expected: FAIL（`result.current.createBranch is not a function`）

- [ ] **Step 3: 実装する**

`GitBranchOperationsState` に追加:

```ts
/** 現在の HEAD から作成して切り替える。戻り値は実行され成功したか */
createBranch: (branchName: string) => Promise<boolean>
```

`checkoutBranch` の直後に追加:

```ts
// checkout -b は HEAD の参照先を変える(working tree/index は変えない)。checkout と
// 同じ理由で、作成中に push が始まると「どのブランチを送るか」が確定する前の HEAD を
// 読んでしまうため lockGlobal を取る(push 側の isAnyLocked() 判定で自動的に待つ)
const createBranch = (branchName: string): Promise<boolean> =>
  runOperation({
    isBusy: () =>
      isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
    setBusy: makeSetBusy('create'),
    onStart: lock.lockGlobal,
    onEnd: lock.unlockGlobal,
    execute: () => gitApi.createBranch(branchName)
  })
```

戻り値に `createBranch` を追加する。

- [ ] **Step 4: テストが通ることと、検知力を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`
Expected: PASS

`onStart: lock.lockGlobal` を消すと lockGlobal のテストが、`isBranchOperationRunningRef.current ||` を消すと「checkout の実行中は」のテストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts
git commit -m "feat: ブランチ作成フックを追加する"
```

---

### Task 6: フックの `deleteBranch`（2段階の確認）

**Files:**

- Modify: `src/renderer/src/hooks/useGitBranchOperations.ts`
- Test: `src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`

**Interfaces:**

- Consumes: `gitApi.deleteBranch(branchName, force): Promise<DeleteBranchResult>`（Task 3）
- Produces: `deleteBranch(branchName: string): Promise<boolean>`（戻り値は「実際に削除されたか」）。フックの第5引数 `options: { onConfirm?: (message: string) => boolean } = {}`（既定値は `confirm`）

- [ ] **Step 1: 失敗するテストを書く**

`const mockDeleteBranch = vi.mocked(gitApi.deleteBranch)` を追加し、ファイル末尾に追加:

```ts
describe('deleteBranch', () => {
  const FIRST = 'ブランチ feature/x を削除しますか？'
  const SECOND =
    'ブランチ feature/x にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？'

  const renderWithConfirm = (onConfirm: (message: string) => boolean, lock = makeFileLock()) =>
    renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock,
        { onConfirm }
      )
    )

  it('1回目の確認でキャンセルしたら削除 API を呼ばずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(onConfirm).toHaveBeenCalledWith(FIRST)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it('マージ済みなら安全削除だけで完了し、2回目の確認は出さない', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: true })
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(true)
    expect(mockDeleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('未マージなら2回目の確認を出し、承諾されたら強制削除する', async () => {
    mockDeleteBranch
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockResolvedValueOnce({ deleted: true })
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(true)
    expect(onConfirm).toHaveBeenNthCalledWith(1, FIRST)
    expect(onConfirm).toHaveBeenNthCalledWith(2, SECOND)
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(1, 'feature/x', false)
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(2, 'feature/x', true)
  })

  it('未マージで2回目の確認をキャンセルしたら強制削除せず、エラーも出さずに false を返す', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
    const onConfirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(mockDeleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
    expect(result.current.branchOperationError).toBeNull()
  })

  // 削除するのは現在ではないブランチの ref だけで、working tree/index/HEAD に
  // 触れないため、push/pull を待たせる必要はない(パターン23)
  it('lockGlobal を取らない', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: true })
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(lock.lockGlobal).not.toHaveBeenCalled()
  })

  // 安全削除と強制削除の間に他のブランチ操作が割り込まないこと
  it('安全削除と強制削除の間も pendingBranchOperation は delete のまま', async () => {
    const pendingDuringSecondConfirm: Array<string | null> = []
    mockDeleteBranch
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockResolvedValueOnce({ deleted: true })
    // onConfirm の中から result を参照するため、renderHook の後で代入する
    let current: () => { pendingBranchOperation: string | null } = () => ({
      pendingBranchOperation: null
    })
    const onConfirm = vi.fn((message: string) => {
      if (message === SECOND) pendingDuringSecondConfirm.push(current().pendingBranchOperation)
      return true
    })
    const { result } = renderWithConfirm(onConfirm)
    current = () => result.current
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(pendingDuringSecondConfirm).toEqual(['delete'])
  })

  it('削除 API が失敗したら false を返し、branchOperationError に反映する', async () => {
    mockDeleteBranch.mockRejectedValue(
      new Error('他のワークツリーで使用中のブランチは削除できません: feature/x')
    )
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      '他のワークツリーで使用中のブランチは削除できません: feature/x'
    )
  })

  it('他のブランチ操作の実行中は削除 API を呼ばない', async () => {
    mockCheckoutBranch.mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    act(() => {
      void result.current.checkoutBranch('feature/y')
    })
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })
})
```

`pendingDuringSecondConfirm` のテストで、`onConfirm` の実行時点の state を読むために `result.current` を参照している。React の state 更新は `act` の外で同期的に反映されないことがあるため、このテストが実装に関係なく失敗・成功する場合は、`pendingBranchOperation` ではなく「2回目の確認中に `result.current.checkoutBranch('feature/y')` を呼んでも `mockCheckoutBranch` が呼ばれない」ことを検証する形に書き換える（busy ref が真であることの検証として等価）。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts -t deleteBranch`
Expected: FAIL（`result.current.deleteBranch is not a function`）

- [ ] **Step 3: 実装する**

フックのシグネチャに第5引数を追加する（CLAUDE.md の「デフォルト引数の参照安定性」に従い `confirm` を直接渡す）:

```ts
export interface GitBranchOperationsOptions {
  /** 削除の確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

export function useGitBranchOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock,
  { onConfirm = confirm }: GitBranchOperationsOptions = {}
): GitBranchOperationsState {
```

`GitBranchOperationsState` に追加:

```ts
/** 確認 → 安全削除 → 未マージなら再確認して強制削除。戻り値は実際に削除されたか */
deleteBranch: (branchName: string) => Promise<boolean>
```

`createBranch` の直後に追加:

```ts
// 削除するのは現在ではないブランチの ref だけで、working tree/index/HEAD には
// 触れない(現在ブランチの削除は main 側で拒否する)。push/pull が読み書きする対象と
// 重ならないため lockGlobal は取らない(取ると削除中に push/pull が無意味に待たされる)。
// 一方、削除中に checkout/作成が始まると、切替先や一覧の再取得結果が食い違うため、
// ブランチ操作どうしは busy ref で排他にし、開始条件は checkout と同じく他操作中も待つ
// (docs/review-findings-patterns.md パターン23)。
// 安全削除と強制削除は1回の排他実行の中で行い、間に他の操作が割り込まないようにする。
// 2回目の確認でキャンセルされた場合は execute を正常終了させる(エラーは出さない)
const deleteBranch = async (branchName: string): Promise<boolean> => {
  if (!onConfirm(`ブランチ ${branchName} を削除しますか？`)) return false
  let deleted = false
  const succeeded = await runOperation({
    isBusy: () =>
      isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
    setBusy: makeSetBusy('delete'),
    execute: async () => {
      const result = await gitApi.deleteBranch(branchName, false)
      if (result.deleted) {
        deleted = true
        return
      }
      const confirmed = onConfirm(
        `ブランチ ${branchName} にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？`
      )
      if (!confirmed) return
      const forced = await gitApi.deleteBranch(branchName, true)
      deleted = forced.deleted
    }
  })
  return succeeded && deleted
}
```

戻り値に `deleteBranch` を追加する。

- [ ] **Step 4: テストが通ることと、検知力を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`
Expected: PASS

次のミューテーションで該当テストが落ちることを確認してから戻す:

- 2回目の `if (!confirmed) return` を消す → 「2回目の確認をキャンセルしたら」が落ちる
- `onStart: lock.lockGlobal` を追加する → 「lockGlobal を取らない」が落ちる

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts
git commit -m "feat: 未マージ時の強制削除確認つきのブランチ削除フックを追加する"
```

---

### Task 7: `NameInputDialog` の `validate` とブランチ名の検証関数

**Files:**

- Modify: `src/renderer/src/components/explorer/NameInputDialog.tsx`
- Create: `src/renderer/src/lib/branchNameValidation.ts`
- Test: `src/renderer/src/components/explorer/__tests__/NameInputDialog.test.tsx`、`src/renderer/src/lib/__tests__/branchNameValidation.test.ts`

**Interfaces:**

- Produces: `NameInputDialog` の Props `validate?: (name: string) => string | null`（渡される `name` は trim 済み）、`validateBranchName(name: string, existingNames: readonly string[]): string | null`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/lib/__tests__/branchNameValidation.test.ts` を作成:

```ts
import { describe, it, expect } from 'vitest'
import { validateBranchName } from '../branchNameValidation'

describe('validateBranchName', () => {
  it('空文字は「名前を入力してください」', () => {
    expect(validateBranchName('', ['main'])).toBe('名前を入力してください')
  })

  it("'-' で始まる名前は拒否する", () => {
    expect(validateBranchName('-x', ['main'])).toBe('`-` で始まる名前は使用できません')
  })

  it('既存のブランチ名と一致したら拒否する', () => {
    expect(validateBranchName('main', ['main'])).toBe('同じ名前のブランチが既に存在します')
  })

  // それ以外の形式(`..` 等)は main 側の git check-ref-format に委ねる
  it('それ以外は null(通過)を返す', () => {
    expect(validateBranchName('feature/new', ['main'])).toBeNull()
    expect(validateBranchName('a..b', ['main'])).toBeNull()
  })
})
```

`NameInputDialog.test.tsx` の末尾（`describe` の中）に追加（既存の import に `userEvent` / `vi` が無ければ追加する）:

```tsx
it('validate を渡すと、その結果でエラーを表示し onSubmit を呼ばない', async () => {
  const onSubmit = vi.fn()
  render(
    <NameInputDialog
      title="新しいブランチ名"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      validate={(name) => (name === 'main' ? '同じ名前のブランチが既に存在します' : null)}
    />
  )
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'main')
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
  expect(onSubmit).not.toHaveBeenCalled()
})

// ブランチ名に '/' は使えるが、ファイル名検証(isSafeEntryName)では拒否される
it('validate を渡すと従来のファイル名検証は使わない', async () => {
  const onSubmit = vi.fn()
  render(
    <NameInputDialog
      title="新しいブランチ名"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      validate={() => null}
    />
  )
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/x')
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(onSubmit).toHaveBeenCalledWith('feature/x')
})

it('validate に渡す名前は前後の空白を trim したもの', async () => {
  const validate = vi.fn().mockReturnValue(null)
  render(
    <NameInputDialog
      title="新しいブランチ名"
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      validate={validate}
    />
  )
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), '  feature/x  ')
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(validate).toHaveBeenCalledWith('feature/x')
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/branchNameValidation.test.ts src/renderer/src/components/explorer/__tests__/NameInputDialog.test.tsx`
Expected: FAIL（モジュールが無い、`feature/x` が「使用できない名前です」で拒否される）

- [ ] **Step 3: 実装する**

`src/renderer/src/lib/branchNameValidation.ts` を作成:

```ts
// ブランチ名入力ダイアログの検証(UX 用)。ここで弾くのは入力中にすぐ伝えたい3種類だけで、
// git の規則(`..`、空白、`~^:?*[\`、末尾の .lock 等)は main 側の
// git check-ref-format --branch に委ねる(セキュリティ境界も main 側)。
// 渡される name は NameInputDialog が trim 済み
export function validateBranchName(name: string, existingNames: readonly string[]): string | null {
  if (name.length === 0) return '名前を入力してください'
  if (name.startsWith('-')) return '`-` で始まる名前は使用できません'
  if (existingNames.includes(name)) return '同じ名前のブランチが既に存在します'
  return null
}
```

`NameInputDialog.tsx`: Props に追加し、既存の `validateName` を既定値として使う:

```tsx
interface Props {
  title: string
  initialValue?: string
  /** 入力値(trim 済み)を検証し、エラー文言か null を返す。省略時はファイル名の検証
   *  (isSafeEntryName)。ブランチ名のように '/' を含められる名前に流用するため */
  validate?: (name: string) => string | null
  onSubmit: (name: string) => void
  onCancel: () => void
}
```

```tsx
export default function NameInputDialog({
  title,
  initialValue = '',
  validate = validateName,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
```

`handleSubmit` 内の `validateName(trimmed)` を `validate(trimmed)` に置き換える。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/branchNameValidation.test.ts src/renderer/src/components/explorer`
Expected: PASS（既存の NameInputDialog・ExplorerPanel のテストも通る）

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/components/explorer/NameInputDialog.tsx src/renderer/src/components/explorer/__tests__/NameInputDialog.test.tsx src/renderer/src/lib/branchNameValidation.ts src/renderer/src/lib/__tests__/branchNameValidation.test.ts
git commit -m "feat: 名前入力ダイアログに検証関数を差し込めるようにする"
```

---

### Task 8: `BranchSwitcherMenu` の作成ボタン・削除ボタン・`Delete` キー

**Files:**

- Modify: `src/renderer/src/components/source-control/BranchSwitcherMenu.tsx`
- Modify: `src/renderer/src/assets/main.css`（`.source-control-panel__branch-menu-item` の周辺）
- Test: `src/renderer/src/components/source-control/__tests__/BranchSwitcherMenu.test.tsx`

**Interfaces:**

- Produces: Props に `onCreateRequest: () => void`、`onDelete: (branchName: string) => void` を追加

- [ ] **Step 1: 既存テストの Props を更新し、失敗するテストを書く**

既存テストで `BranchSwitcherMenu` を描画している箇所すべてに `onCreateRequest={vi.fn()}` と `onDelete={vi.fn()}` を足す（`baseProps` があればそこへ）。ファイル末尾に追加:

```tsx
describe('BranchSwitcherMenu の作成・削除', () => {
  const branches = [
    { name: 'main', current: true },
    { name: 'feature/x', current: false },
    { name: 'feature/y', current: false }
  ]

  it('作成ボタンを押すと onCreateRequest が呼ばれる', async () => {
    const onCreateRequest = vi.fn()
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={onCreateRequest}
        onDelete={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
    expect(onCreateRequest).toHaveBeenCalledOnce()
  })

  it('現在ブランチ以外の行にだけ削除ボタンがある', () => {
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'ブランチ feature/x を削除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ブランチ feature/y を削除' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ブランチ main を削除' })).not.toBeInTheDocument()
  })

  it('削除ボタンを押すと onDelete が呼ばれ、onSelect は呼ばれない', async () => {
    const onDelete = vi.fn()
    const onSelect = vi.fn()
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={onSelect}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={onDelete}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    expect(onDelete).toHaveBeenCalledWith('feature/x')
    expect(onSelect).not.toHaveBeenCalled()
  })

  // roving tabindex(radiogroup 内の Tab 停止点は1つ)を崩さない
  it('削除ボタンは tabIndex=-1', () => {
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'ブランチ feature/x を削除' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
  })

  it('ブランチにフォーカスして Delete キーを押すと onDelete が呼ばれる', async () => {
    const onDelete = vi.fn()
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={onDelete}
      />
    )
    // マウント時に先頭の選択可能なブランチ(feature/x)へフォーカスする(既存の挙動)
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveFocus()
    await userEvent.keyboard('{Delete}')
    expect(onDelete).toHaveBeenCalledWith('feature/x')
  })

  it('選択可能な radio に aria-keyshortcuts="Delete" が付く', () => {
    render(
      <BranchSwitcherMenu
        branches={branches}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toHaveAttribute(
      'aria-keyshortcuts',
      'Delete'
    )
    expect(screen.getByRole('radio', { name: /main/ })).not.toHaveAttribute('aria-keyshortcuts')
  })

  it('選択可能なブランチが無いとき、初期フォーカスは作成ボタン', () => {
    render(
      <BranchSwitcherMenu
        branches={[{ name: 'main', current: true }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onCreateRequest={vi.fn()}
        onDelete={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' })).toHaveFocus()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/BranchSwitcherMenu.test.tsx`
Expected: FAIL（作成ボタン・削除ボタンが無い）

- [ ] **Step 3: 実装する**

Props に追加:

```tsx
  /** 「＋ 新しいブランチを作成…」が押された。入力ダイアログの表示は呼び出し元が行う */
  onCreateRequest: () => void
  /** 削除ボタン、または radio 上の Delete キー。確認ダイアログは呼び出し元(フック)が出す */
  onDelete: (branchName: string) => void
```

作成ボタンの ref を追加し、初期フォーカスの effect を変える:

```tsx
const createButtonRef = useRef<HTMLButtonElement>(null)
```

```tsx
useEffect(() => {
  // 選択可能なブランチが無い(現在ブランチだけ)場合は、唯一の操作である作成ボタンへ
  if (tabbableName !== null) itemRefs.current.get(tabbableName)?.focus()
  else createButtonRef.current?.focus()
  // (既存のコメントと eslint-disable をそのまま残す)
}, [])
```

return を次に置き換える。作成ボタンは radiogroup の外に置き、各行は radio と削除ボタンを横に並べる:

```tsx
return (
  <div className="source-control-panel__branch-menu">
    <button
      ref={createButtonRef}
      type="button"
      className="source-control-panel__branch-menu-create"
      onClick={onCreateRequest}
    >
      ＋ 新しいブランチを作成…
    </button>
    <div role="radiogroup" aria-label="ブランチ" onKeyDown={handleListKeyDown}>
      {branches.map((branch) => (
        <div key={branch.name} className="source-control-panel__branch-menu-row">
          <button
            ref={(el) => registerItemRef(branch.name, el)}
            type="button"
            role="radio"
            aria-checked={branch.current}
            aria-keyshortcuts={branch.current ? undefined : 'Delete'}
            className="source-control-panel__branch-menu-item"
            disabled={branch.current}
            tabIndex={branch.name === tabbableName ? 0 : -1}
            onFocus={() => setFocusedName(branch.name)}
            onClick={() => onSelect(branch.name)}
            onKeyDown={(e) => {
              if (e.key === 'Delete' && !branch.current) {
                e.preventDefault()
                onDelete(branch.name)
              }
            }}
          >
            {branch.current ? '✓ ' : ''}
            {branch.name}
          </button>
          {!branch.current && (
            // roving tabindex を崩さないよう Tab 停止点にしない。キーボードでは
            // radio 上の Delete キーで同じ操作ができる(aria-keyshortcuts で告知)
            <button
              type="button"
              tabIndex={-1}
              className="source-control-panel__branch-menu-delete"
              aria-label={`ブランチ ${branch.name} を削除`}
              onClick={() => onDelete(branch.name)}
            >
              🗑
            </button>
          )}
        </div>
      ))}
    </div>
  </div>
)
```

`main.css` の `.source-control-panel__branch-menu-item:disabled { ... }` の直後に追加:

```css
/* 作成ボタンはメニュー項目と同じ見た目で、区切り線でブランチ一覧と分ける */
.source-control-panel__branch-menu-create {
  display: block;
  width: 100%;
  padding: 6px 16px;
  background: none;
  border: none;
  border-bottom: 1px solid #454545;
  color: #cccccc;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.source-control-panel__branch-menu-create:hover {
  background: #094771;
  color: #ffffff;
}

.source-control-panel__branch-menu-row {
  display: flex;
  align-items: center;
}

.source-control-panel__branch-menu-row .source-control-panel__branch-menu-item {
  flex: 1;
  min-width: 0;
}

/* タッチ操作で押しやすいよう 32px 四方のタップ領域を確保する */
.source-control-panel__branch-menu-delete {
  flex: none;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  color: #cccccc;
  font-size: 12px;
  cursor: pointer;
}

.source-control-panel__branch-menu-delete:hover {
  background: #5a1d1d;
  color: #ffffff;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/BranchSwitcherMenu.test.tsx`
Expected: PASS（既存の矢印キー・Escape・外側クリックのテストも通る）

`if (e.key === 'Delete' && !branch.current)` の分岐を消すと Delete キーのテストが落ちることを確認してから戻す。

- [ ] **Step 5: コミット（ユーザーの指示がある場合のみ）**

```bash
git add src/renderer/src/components/source-control/BranchSwitcherMenu.tsx src/renderer/src/components/source-control/__tests__/BranchSwitcherMenu.test.tsx src/renderer/src/assets/main.css
git commit -m "feat: ブランチメニューに作成ボタンと削除ボタンを追加する"
```

---

### Task 9: `BranchSwitcher` の入力ダイアログと、作成・削除の配線

**Files:**

- Modify: `src/renderer/src/components/source-control/BranchSwitcher.tsx`
- Modify: `GitRepoView.tsx`、`SourceControlPanel.tsx`、`src/renderer/src/components/Sidebar.tsx`、`src/renderer/src/App.tsx`
- Test: `BranchSwitcher.test.tsx`、`GitRepoView.test.tsx`、`SourceControlPanel.test.tsx`、`Sidebar.test.tsx`

**Interfaces:**

- Consumes: `createBranch` / `deleteBranch`（Task 5, 6。`useAppState` は `Omit<ReturnType<typeof useGitBranchOperations>, 'checkoutBranch'>` を展開しているため、追加の変更なしで `App.tsx` から取り出せる）、`validateBranchName`（Task 7）、`BranchSwitcherMenu` の新 Props（Task 8）
- Produces: 各コンポーネントの Props `onCreateBranch: (branchName: string) => Promise<boolean>`、`onDeleteBranch: (branchName: string) => Promise<boolean>`

- [ ] **Step 1: 既存テストの Props を更新し、失敗するテストを書く**

`BranchSwitcher.test.tsx` / `GitRepoView.test.tsx` / `SourceControlPanel.test.tsx` / `Sidebar.test.tsx` の `baseProps`（と JSX で直接 Props を並べている箇所）に `onCreateBranch: vi.fn().mockResolvedValue(true)` と `onDeleteBranch: vi.fn().mockResolvedValue(true)` を足す。

`BranchSwitcher.test.tsx` の末尾（`describe` の中）に追加:

```tsx
it('作成ボタンでメニューが閉じ、入力ダイアログが開く', async () => {
  render(<BranchSwitcher {...baseProps} />)
  await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
  await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
  expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '新しいブランチ名' })).toBeInTheDocument()
})

it('入力して OK を押すと onCreateBranch が呼ばれ、ダイアログが閉じてトリガーへフォーカスが戻る', async () => {
  const onCreateBranch = vi.fn().mockResolvedValue(true)
  render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
  const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/new')
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(onCreateBranch).toHaveBeenCalledWith('feature/new')
  expect(screen.queryByRole('dialog', { name: '新しいブランチ名' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('既存のブランチ名はダイアログ内でエラーになり、onCreateBranch は呼ばれない', async () => {
  const onCreateBranch = vi.fn().mockResolvedValue(true)
  render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
  await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
  await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), 'feature/x')
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
  expect(screen.getByRole('alert')).toHaveTextContent('同じ名前のブランチが既に存在します')
  expect(onCreateBranch).not.toHaveBeenCalled()
})

it.each([
  [
    'キャンセルボタン',
    async () => userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
  ],
  ['Escape キー', async () => userEvent.keyboard('{Escape}')]
])('%s でダイアログを閉じるとトリガーへフォーカスが戻る', async (_label, close) => {
  const onCreateBranch = vi.fn().mockResolvedValue(true)
  render(<BranchSwitcher {...baseProps} onCreateBranch={onCreateBranch} />)
  const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole('button', { name: '＋ 新しいブランチを作成…' }))
  await close()
  expect(screen.queryByRole('dialog', { name: '新しいブランチ名' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(onCreateBranch).not.toHaveBeenCalled()
})

it('削除ボタンでメニューが閉じ、トリガーへフォーカスが戻り、onDeleteBranch が呼ばれる', async () => {
  const onDeleteBranch = vi.fn().mockResolvedValue(true)
  render(<BranchSwitcher {...baseProps} onDeleteBranch={onDeleteBranch} />)
  const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
  await userEvent.click(trigger)
  await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
  expect(onDeleteBranch).toHaveBeenCalledWith('feature/x')
  expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})
```

`NameInputDialog` の Escape はオーバーレイのない `input` の `onKeyDown` で処理される。ダイアログが開いている間も `BranchSwitcherMenu` の `document` の keydown リスナーは解除済み（メニューはアンマウント済み）なので、Escape が二重に処理されないことをこのテストで兼ねて確認する。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/components/source-control/__tests__/BranchSwitcher.test.tsx`
Expected: FAIL（作成ボタンを押してもダイアログが出ない）

- [ ] **Step 3: `BranchSwitcher` を実装する**

import を追加:

```tsx
import NameInputDialog from '../explorer/NameInputDialog'
import { validateBranchName } from '../../lib/branchNameValidation'
```

Props に追加:

```tsx
onCreateBranch: (branchName: string) => Promise<boolean>
onDeleteBranch: (branchName: string) => Promise<boolean>
```

state とハンドラーを追加:

```tsx
const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

// メニューを閉じてから入力ダイアログを開く。作成ボタンのクリックは document の
// 外側クリック判定にもバブルして onClose(false) が重ねて呼ばれるが、setIsOpen(false)
// の重複なので害は無い
const handleCreateRequest = (): void => {
  setIsOpen(false)
  setIsCreateDialogOpen(true)
}

// ダイアログを閉じたら(OK・キャンセル・Escape・オーバーレイクリックのいずれも)
// トリガーへフォーカスを戻す(パターン22)。OK の場合は、トリガーが実行中に
// disabled になる前にフォーカスを戻すため、onCreateBranch より先に呼ぶ
const closeCreateDialog = (): void => {
  setIsCreateDialogOpen(false)
  triggerRef.current?.focus()
}

const handleCreateSubmit = (branchName: string): void => {
  closeCreateDialog()
  void onCreateBranch(branchName)
}

// 確認ダイアログはフック側(useGitBranchOperations.deleteBranch)が出す。
// メニューは先に閉じてトリガーへフォーカスを戻しておく
const handleDelete = (branchName: string): void => {
  setIsOpen(false)
  triggerRef.current?.focus()
  void onDeleteBranch(branchName)
}
```

`BranchSwitcherMenu` に `onCreateRequest={handleCreateRequest}` と `onDelete={handleDelete}` を渡し、メニューの後に追加:

```tsx
{
  isCreateDialogOpen && (
    <NameInputDialog
      title="新しいブランチ名"
      validate={(name) =>
        validateBranchName(
          name,
          branches.map((b) => b.name)
        )
      }
      onSubmit={handleCreateSubmit}
      onCancel={closeCreateDialog}
    />
  )
}
```

- [ ] **Step 4: 親コンポーネントへ配線する**

`GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` の Props に次を追加し、分割代入して子へそのまま渡す（`onCheckoutBranch` の直後に並べる）:

```tsx
onCreateBranch: (branchName: string) => Promise<boolean>
onDeleteBranch: (branchName: string) => Promise<boolean>
```

`App.tsx`: `useAppState()` の分割代入の `checkoutBranch,` の直後に `createBranch,` と `deleteBranch,` を追加し、`<Sidebar>` の `onCheckoutBranch={checkoutBranch}` の直後に次を追加:

```tsx
onCreateBranch = { createBranch }
onDeleteBranch = { deleteBranch }
```

`GitRepoView.test.tsx` に、配線を確認するテストを1件追加する（既存の `baseProps` と描画ヘルパーを使う）:

```tsx
it('BranchSwitcher の削除ボタンから onDeleteBranch が呼ばれる', async () => {
  const onDeleteBranch = vi.fn().mockResolvedValue(true)
  render(
    <GitRepoView
      {...baseProps}
      branches={[
        { name: 'main', current: true },
        { name: 'feature/x', current: false }
      ]}
      onDeleteBranch={onDeleteBranch}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
  await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
  expect(onDeleteBranch).toHaveBeenCalledWith('feature/x')
})
```

- [ ] **Step 5: 全テスト・型チェック・lint を通す**

Run: `npm test && npm run typecheck && npx eslint src/renderer/src/components/source-control/BranchSwitcher.tsx src/renderer/src/components/source-control/BranchSwitcherMenu.tsx src/renderer/src/components/source-control/GitRepoView.tsx src/renderer/src/components/source-control/SourceControlPanel.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/App.tsx`
Expected: すべて PASS

`closeCreateDialog` の `triggerRef.current?.focus()` を消すと、フォーカス復帰のテストが落ちることを確認してから戻す。

- [ ] **Step 6: コミット（ユーザーの指示がある場合のみ）**

```bash
git add -u src/renderer/src
git commit -m "feat: ブランチスイッチャーから作成・削除できるようにする"
```

---

### Task 10: 実機確認と ROADMAP の更新

**Files:**

- Modify: `ROADMAP.md`

- [ ] **Step 1: Electron 実機で確認する**

`npm run dev` でアプリを起動し、このリポジトリとは別の一時リポジトリ（Task 2 Step 5 の手順で作る。`topic` が未マージ、`merged1` がマージ済み）を開いて次を確認する:

1. 「＋ 新しいブランチを作成…」→ `feature/new` → OK で、トリガー表示が `feature/new` になる。未コミットの変更が残っている
2. 既存名（`topic`）を入力するとダイアログ内に「同じ名前のブランチが既に存在します」が出る
3. `a..b` を入力すると、ダイアログは閉じ、パネル上部に「ブランチ名として使用できない名前です: a..b」が出る
4. `merged1` の削除ボタン → 1回目の確認を承諾 → 一覧から消える（2回目の確認は出ない）
5. `topic` の削除ボタン → 1回目を承諾 → 2回目の確認が出る → キャンセルで残る → もう一度実行して2回目も承諾すると消える
6. キーボードだけで: トリガーで Enter → 矢印キーでブランチへ移動 → Delete キーで削除の確認が出る

確認後、起動したプロセスを停止する。`pgrep -fl prompt-ide` で対象を確認してから、リポジトリのパスを含むパターンで `pkill -f` する（Electron 本体と dev サーバーの両方）。

- [ ] **Step 2: ROADMAP を更新する**

`ROADMAP.md` の「実装済み機能 > ソース管理（Git 操作）」の `- [x] ブランチの切り替え（…）` の直後に追加:

```markdown
- [x] ブランチの作成（現在の HEAD から作成して切り替え）・削除（未マージ時は強制削除の確認）
```

「今後実装した方がよい機能 > ソース管理（Git）」の `- [ ] ブランチの作成・削除・マージ（表示・切り替えは実装済み）` を次に置き換える:

```markdown
- [ ] ブランチのマージ（表示・切り替え・作成・削除は実装済み）
```

- [ ] **Step 3: 最終検証**

Run: `npm test && npm run typecheck && npx prettier --check ROADMAP.md`
Expected: すべて PASS

- [ ] **Step 4: コミット（ユーザーの指示がある場合のみ）**

```bash
git add ROADMAP.md
git commit -m "docs: ブランチの作成・削除の実装完了をROADMAPに反映する"
```
