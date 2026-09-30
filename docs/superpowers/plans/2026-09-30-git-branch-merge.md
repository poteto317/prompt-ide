# Git ブランチのマージ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブランチスイッチャーのメニューから、選んだローカルブランチを現在のブランチへマージできるようにする。コンフリクトは自動で中止して元に戻す。

**Architecture:** main の `gitService.mergeBranch` が、事前検証（許可リスト・detached・自身・マージ中・未コミットの変更）→ `git merge --no-edit` → 失敗後の `MERGE_HEAD` の有無で自動中止を判定する。renderer は `useGitBranchOperations.mergeBranch`（checkout と同じ排他制御・`lockGlobal`）と `useAppState` のラッパー（未保存編集の確認・成功時のみ `reloadOpenFiles`）で包み、`BranchMenuItem` のマージボタンと `M` キーから呼ぶ。

**Tech Stack:** Electron, React, TypeScript, simple-git, Vitest + Testing Library

設計は [docs/superpowers/specs/2026-09-30-git-branch-merge-design.md](../specs/2026-09-30-git-branch-merge-design.md)。

> **実装後の注記（単一責任へのリファクタリング）:** Task 1 のコード例の `assertMergeableBranch` は、実装後に
> `assertMergeTargetBranch`（対象の特定）と `assertMergeStartable`（リポジトリの状態）に分割し、文言の組み立てを
> `src/main/gitMergeMessages.ts` へ切り出した。Task 4・5 の `useAppState` のラッパー、`BranchMenuItem` のキー判定、
> `BranchSwitcher` のハンドラー、`main.css` の重複も整理した。現在の構成は設計書の「実装後のリファクタリング」の表を参照。
> 以降のコード例は分割前の記録で、現行の実装とは一致しない箇所がある。
> 同名のタグ等の検証（`assertBranchRefUnambiguous`）も、大文字小文字を区別しない FS での問題の修正で、
> ブランチの先端を `rev-parse refs/heads/<name>^{commit}` ではなく `for-each-ref` で取る方式に変わった。
> detached の判定も `summary.detached` から `git symbolic-ref -q HEAD` の結果（空ならブランチ上にいない）に変わった（simple-git の `detached` は rebase・bisect 中を検出しないため）。

## Global Constraints

- すべての返答・コメント・エラーメッセージは日本語（コードブロック・技術用語・ライブラリ名は英語のままでよい）
- 型としてのみ使う import は `import type` を使う
- `git commit` / `git push` は、ユーザーの明示的な指示がある場合のみ実行する。各タスクの Commit ステップは「許可がある場合のみ」実行し、許可が無ければ飛ばして次へ進む。`git add -A` は使わず、対象ファイルを指定する
- コミットメッセージは日本語・Conventional Commit 形式。末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` を付ける
- 新しいアクセシブルな UI には `aria-label` を設定する。選択状態を持たないボタンなので `role` は付けない
- テストは TDD（失敗するテスト → 実装 → 通す）。実装を `git stash push <実装ファイル>` で戻すとテストが落ちることを確認してから `git stash pop` する
- 検証コマンド: `npm test` / `npm run typecheck` / 変更したファイルへの `npx eslint` / `npx prettier --check`
- マージの確認文言は正確に次の 2 行（1 行目と 2 行目の間は空行 1 つ）: `<branch> を <current> にマージしますか？` / `コンフリクトした場合は自動で中止して元に戻します。`
- エラーメッセージは正確に次の文言を使う
  - `存在しないブランチです: <name>`
  - `ブランチをチェックアウトしてからマージしてください`
  - `現在のブランチ自身はマージできません: <name>`
  - `同名のタグ等があり、ブランチを特定できないためマージできません: <name>`
  - `マージ中のため実行できません`
  - `未コミットの変更があるためマージできません。先にコミットしてください`
  - `コンフリクトしたため中止しました: a.txt, b.txt`（5 件超は `a, b, c, d, e ほか N 件`）
  - `マージを完了できなかったため中止しました: <git のエラー>`
- 実行中の表示は、トリガーのテキスト `マージ中...`、`aria-label` は `ブランチのマージ中`
- マージボタンの `aria-label` は `ブランチ <name> を現在のブランチにマージ`。radio の `aria-keyshortcuts` は `Delete M`
- 作業ブランチは `feat/git-branch-merge`（現在 `main` 上のため、Task 1 の前に作成する。ブランチの作成はコミットではないので許可は不要）

## File Structure

| ファイル                                                                                   | 責務                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `src/main/gitService.ts`                                                                   | `mergeBranch`（事前検証・マージ・失敗時の中止）。検証は `assertMergeableBranch`、中止は `abortFailedMerge` に分ける |
| `src/main/__tests__/helpers/realGitRepo.ts`（新規）                                        | 実 git を使うテストの共通ヘルパー（グローバル・システム設定の切り離し、リポジトリの初期化、コミット）               |
| `src/main/__tests__/gitService.merge.integration.test.ts`（新規）                          | 実 git で早送り・マージコミット・コンフリクトの中止と復元などを固定する                                             |
| `src/main/handlers/gitHandlers.ts`                                                         | IPC `git:mergeBranch`（引数の型検証）                                                                               |
| `src/preload/api.ts` / `src/preload/index.d.ts` / `src/renderer/src/lib/gitApi.ts`         | `mergeBranch(branchName)` の公開                                                                                    |
| `src/renderer/src/lib/branchMerge.ts`（新規）                                              | 確認文言の組み立て `buildMergeConfirmMessage`                                                                       |
| `src/renderer/src/types.ts`                                                                | `BranchOperationKind` に `'merge'` を追加                                                                           |
| `src/renderer/src/lib/branchTriggerLabel.ts`                                               | マージ実行中の文言                                                                                                  |
| `src/renderer/src/hooks/useGitBranchOperations.ts`                                         | `mergeBranch`（確認 → 排他実行、`lockGlobal`）                                                                      |
| `src/renderer/src/hooks/useAppState.ts`                                                    | `mergeBranch` ラッパー（未保存編集の確認 → マージ → 成功時のみ再読込）                                              |
| `src/renderer/src/components/source-control/BranchMenuItem.tsx`                            | マージボタンと `M` キー                                                                                             |
| `src/renderer/src/components/source-control/BranchSwitcherMenu.tsx` / `BranchSwitcher.tsx` | `onMerge` / `onMergeBranch` の配線                                                                                  |
| `GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx` / `App.tsx`                   | `onMergeBranch` の受け渡し                                                                                          |
| `src/renderer/src/assets/main.css`                                                         | マージボタンのスタイル（32px 四方）                                                                                 |

---

### Task 1: `gitService.mergeBranch`（main）

**Files:**

- Modify: `src/main/gitService.ts`（`deleteBranch` の直後に追加）
- Modify: `src/main/__tests__/gitService.test.ts`（末尾に `describe('mergeBranch')` を追加、import に `mergeBranch` を追加）
- Create: `src/main/__tests__/helpers/realGitRepo.ts`
- Create: `src/main/__tests__/gitService.merge.integration.test.ts`

**Interfaces:**

- Consumes: 既存の `parseNulSeparatedPaths(output: string, withStageInfo?: boolean): string[]`（`gitService.ts` 内）
- Produces: `export async function mergeBranch(folderPath: string, branchName: string): Promise<void>`（Task 2 の IPC が呼ぶ）

- [ ] **Step 0: 作業ブランチを作る**

```bash
git checkout -b feat/git-branch-merge
git status -s   # 仕様書 (docs/superpowers/specs/2026-09-30-git-branch-merge-design.md) と本プランが未追跡で残っていること
```

- [ ] **Step 1: 単体テストを書く（simple-git をモック）**

`src/main/__tests__/gitService.test.ts` の import に `mergeBranch` を追加する:

```ts
import {
  // ...既存
  createBranch,
  deleteBranch,
  mergeBranch
} from '../gitService'
```

ファイル末尾（`deleteBranch` の describe の後）に追加する:

```ts
describe('mergeBranch', () => {
  // raw() の呼び出しを種類で振り分ける。MERGE_HEAD の問い合わせは呼ばれるたびに
  // mergeHead の先頭から順に返す(1 回目: 事前検証、2 回目: マージ後の判定)。
  // simple-git は終了コードが非 0 でも stderr が空なら reject しないため、
  // コンフリクト時の merge は空文字で resolve する(実機で確認)
  const setupRaw = (opts: {
    mergeHead?: string[]
    dirty?: string
    conflicted?: string
    merge?: () => Promise<string>
    abortError?: Error
  }): void => {
    const mergeHead = [...(opts.mergeHead ?? ['', ''])]
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return mergeHead.shift() ?? ''
      if (args[0] === 'status') return opts.dirty ?? ''
      if (args[0] === 'diff') return opts.conflicted ?? ''
      if (args[0] === 'merge' && args[1] === '--abort') {
        if (opts.abortError !== undefined) throw opts.abortError
        return ''
      }
      if (args[0] === 'merge') return opts.merge !== undefined ? opts.merge() : ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }
  const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
  const mergeWasCalled = (): boolean =>
    rawCalls().some((a) => a[0] === 'merge' && a[1] !== '--abort')
  const abortWasCalled = (): boolean =>
    rawCalls().some((a) => a[0] === 'merge' && a[1] === '--abort')

  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({
      all: ['main', 'feature/x'],
      current: 'main',
      detached: false
    })
  })

  // IPC 境界から届く任意の文字列のため、実在するローカルブランチ名だけを許可する
  // ('--abort' 等をオプションとして git に渡さない。パターン21)
  it('存在しないブランチ名は git のマージを呼ばずに拒否する', async () => {
    setupRaw({})
    await expect(mergeBranch('/project', '--abort')).rejects.toThrow(
      '存在しないブランチです: --abort'
    )
    expect(mergeWasCalled()).toBe(false)
    expect(abortWasCalled()).toBe(false)
  })

  it('detached HEAD では拒否する', async () => {
    mockBranchLocal.mockResolvedValue({
      all: ['main', 'feature/x'],
      current: 'abc123',
      detached: true
    })
    setupRaw({})
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('現在のブランチ自身は拒否する', async () => {
    setupRaw({})
    await expect(mergeBranch('/project', 'main')).rejects.toThrow(
      '現在のブランチ自身はマージできません: main'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('マージ中(MERGE_HEAD がある)なら拒否する', async () => {
    setupRaw({ mergeHead: ['0123abcd\n'] })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'マージ中のため実行できません'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('追跡済みファイルに未コミットの変更があれば拒否する(--untracked-files=no で問い合わせる)', async () => {
    setupRaw({ dirty: ' M a.txt\0' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '未コミットの変更があるためマージできません。先にコミットしてください'
    )
    expect(rawCalls()).toContainEqual(['status', '--porcelain', '-z', '--untracked-files=no'])
    expect(mergeWasCalled()).toBe(false)
  })

  it('成功したら merge --no-edit をブランチ名で呼び、中止はしない', async () => {
    setupRaw({})
    await mergeBranch('/project', 'feature/x')
    expect(rawCalls()).toContainEqual(['merge', '--no-edit', 'feature/x'])
    expect(abortWasCalled()).toBe(false)
  })

  // git が何も変えずに失敗した場合(無関係な履歴の拒否、上書きされる未追跡ファイル、
  // コミッター情報なし等)は MERGE_HEAD が残らない。中止はせず、git のエラーをそのまま投げる
  it('merge が失敗し MERGE_HEAD が無ければ、中止せずに git のエラーをそのまま投げる', async () => {
    const gitError = new Error('fatal: refusing to merge unrelated histories')
    setupRaw({
      merge: async () => {
        throw gitError
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toBe(gitError)
    expect(abortWasCalled()).toBe(false)
  })

  // コンフリクトでは git は終了コード 1 で stderr が空のため、simple-git は reject せず
  // resolve する。例外の有無ではなく MERGE_HEAD の有無で判定する(パターン28)
  it('merge が resolve しても MERGE_HEAD が残っていれば、未解決ファイルを取得してから中止する', async () => {
    setupRaw({ mergeHead: ['', 'abc123\n'], conflicted: 'a.txt\0b.txt\0' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'コンフリクトしたため中止しました: a.txt, b.txt'
    )
    const calls = rawCalls()
    const diffIndex = calls.findIndex((a) => a[0] === 'diff')
    const abortIndex = calls.findIndex((a) => a[0] === 'merge' && a[1] === '--abort')
    expect(calls[diffIndex]).toEqual(['diff', '--name-only', '-z', '--diff-filter=U'])
    // 中止すると未解決の状態が消えて取れなくなるため、必ず中止より前に取得する
    expect(diffIndex).toBeGreaterThanOrEqual(0)
    expect(abortIndex).toBeGreaterThan(diffIndex)
  })

  it('merge が reject しても MERGE_HEAD が残っていれば、同じくコンフリクトとして中止する', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: 'a.txt\0',
      merge: async () => {
        throw new Error('CONFLICT')
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'コンフリクトしたため中止しました: a.txt'
    )
    expect(abortWasCalled()).toBe(true)
  })

  it('コンフリクトのファイルは 5 件まで表示し、超えた分は「ほか N 件」にする', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `${n}.txt\0`).join('')
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'コンフリクトしたため中止しました: a.txt, b.txt, c.txt, d.txt, e.txt ほか 2 件'
    )
  })

  it('ちょうど 5 件なら「ほか」を付けない', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: ['a', 'b', 'c', 'd', 'e'].map((n) => `${n}.txt\0`).join('')
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      /^コンフリクトしたため中止しました: a\.txt, b\.txt, c\.txt, d\.txt, e\.txt$/
    )
  })

  // pre-merge-commit フックの失敗等、コンフリクト以外でも MERGE_HEAD が残る(実機で確認)。
  // 未解決のファイルは無いが、途中の状態を残さないよう中止する
  it('未解決ファイルが無いまま MERGE_HEAD が残っていれば、中止して git のエラーを添える', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: '',
      merge: async () => {
        throw new Error('hook failed')
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'マージを完了できなかったため中止しました: hook failed'
    )
    expect(abortWasCalled()).toBe(true)
  })

  it('中止自体が失敗したら、その git のエラーをそのまま投げる', async () => {
    const abortError = new Error('abort failed')
    setupRaw({ mergeHead: ['', 'abc123\n'], conflicted: 'a.txt\0', abortError })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toBe(abortError)
  })
})
```

> 実装後の記録: 上のテスト例のあとに、レビューで次のテストを追加した（正は `src/main/__tests__/gitService.test.ts` の
> `describe('mergeBranch')`。全 18 件）。
>
> - 同名のタグ等の検証: 名前の解決先がブランチの先端と違えば拒否／解決できなければ拒否／同じコミットなら通る／
>   `^{commit}` の解決先と for-each-ref のブランチ先端の両方で問い合わせる（現行は for-each-ref の完全一致の検証を含む）
> - git のエラーが空のまま MERGE_HEAD が残るとき、末尾のコロンを付けずに中止する（1 件）
> - 中止自体の失敗テストの強化: 中止の前に未解決ファイル（`diff`）を取得していること、`merge --abort` を呼んでいることも検証する

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t mergeBranch`
Expected: FAIL（`mergeBranch is not a function` 相当）

- [ ] **Step 3: 実装する**

`src/main/gitService.ts` の `deleteBranch` の直後（`amendCommit` の前）に追加する:

```ts
// マージ失敗時に表示する未解決ファイルの上限。超えた分は「ほか N 件」にまとめる
const MAX_LISTED_CONFLICT_FILES = 5

// マージ中か(MERGE_HEAD があるか)。rev-parse -q --verify は ref が無いと終了コード 1・
// stderr 空で終わり、simple-git は reject せず空文字で resolve する(isBranchMerged と同じ)
async function hasMergeInProgress(git: SimpleGit): Promise<boolean> {
  const head = await git.raw(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  return head.trim() !== ''
}

// マージを始めてよい状態かを検証する。branchName は IPC 境界から届く任意の文字列のため、
// checkoutBranch と同じく許可リスト(実在するローカルブランチ名)で検証してから git に渡す
// (パターン21)。前の検証に失敗したら後の git 呼び出しには進まない。
// 追跡済みファイルに未コミットの変更があるときは開始しない: 重ならない変更なら git は
// そのままマージを始めるが、その後 git merge --abort が未コミットの変更を元に戻せない場合が
// あると git の公式ドキュメントが警告している。未追跡ファイルだけなら開始できる
// (マージで上書きされる未追跡ファイル(ignored を除く)があれば git が拒否する。ignored の
// ファイルは git の既定どおり黙って上書きされ、コンフリクトで自動中止しても復元されない)
async function assertMergeableBranch(git: SimpleGit, branchName: string): Promise<void> {
  const summary = await git.branchLocal()
  if (!summary.all.includes(branchName)) {
    throw new Error(`存在しないブランチです: ${branchName}`)
  }
  if (summary.detached) {
    throw new Error('ブランチをチェックアウトしてからマージしてください')
  }
  if (branchName === summary.current) {
    throw new Error(`現在のブランチ自身はマージできません: ${branchName}`)
  }
  // 同名のタグ等があると git は refs/tags を優先し、警告だけで終了コード 0 のまま別のコミットを
  // マージする(実機で確認)。名前の解決先がブランチの先端と食い違えば、選んでいないコミットを
  // マージしないよう拒否する。同じコミットを指すタグは無害なので拒否しない。
  // 実在確認(許可リスト)の後、マージ中・未コミットの判定の前に置く: ブランチを特定できない
  // 状態では、以降の判定結果をユーザーに見せても意味がないため
  const [resolved, tip] = await Promise.all([
    git.raw(['rev-parse', '--verify', '-q', `${branchName}^{commit}`]),
    git.raw(['rev-parse', '--verify', '-q', `refs/heads/${branchName}^{commit}`])
  ])
  if (resolved.trim() === '' || resolved.trim() !== tip.trim()) {
    throw new Error(`同名のタグ等があり、ブランチを特定できないためマージできません: ${branchName}`)
  }
  if (await hasMergeInProgress(git)) {
    throw new Error('マージ中のため実行できません')
  }
  const dirty = await git.raw(['status', '--porcelain', '-z', '--untracked-files=no'])
  if (dirty !== '') {
    throw new Error('未コミットの変更があるためマージできません。先にコミットしてください')
  }
}

function formatConflictFiles(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED_CONFLICT_FILES).join(', ')
  const rest = files.length - MAX_LISTED_CONFLICT_FILES
  return rest > 0 ? `${shown} ほか ${rest} 件` : shown
}

// 途中で止まったマージを元に戻し、日本語のエラーを投げる。未解決のファイルは中止すると
// 取れなくなるため、必ず中止より前に取得する。未解決のファイルが無いのに MERGE_HEAD が
// 残るのは、pre-merge-commit フックの失敗等(実機で確認)。mergeError はその git のエラー
async function abortFailedMerge(git: SimpleGit, mergeError: unknown): Promise<never> {
  const conflicted = parseNulSeparatedPaths(
    await git.raw(['diff', '--name-only', '-z', '--diff-filter=U'])
  )
  await git.raw(['merge', '--abort'])
  if (conflicted.length > 0) {
    throw new Error(`コンフリクトしたため中止しました: ${formatConflictFiles(conflicted)}`)
  }
  const detail = mergeError instanceof Error ? mergeError.message : String(mergeError ?? '')
  throw new Error(
    detail === ''
      ? 'マージを完了できなかったため中止しました'
      : `マージを完了できなかったため中止しました: ${detail}`
  )
}

// 指定したローカルブランチを現在のブランチへマージする(git merge --no-edit。早送りできれば
// 早送りし、できなければマージコミットを作る。git の既定)。
// コンフリクトはアプリ内に解決手段が無いため、自動で中止して元に戻す。中止するかは
// エラー文ではなく MERGE_HEAD の有無で判定する(パターン28): コンフリクトでは git が
// 終了コード 1・stderr 空で終わり simple-git が resolve するため、例外の有無も当てにならない。
// MERGE_HEAD が無いまま失敗した場合は git が何も変えていない(無関係な履歴の拒否、
// 上書きされる未追跡ファイル、コミッター情報なし等)ので、checkout と同じく git のエラーを
// そのまま投げる。ローカルの操作でネットワーク I/O を伴わないため、リモート用のタイムアウトは使わない
export async function mergeBranch(folderPath: string, branchName: string): Promise<void> {
  const git = simpleGit(folderPath)
  await assertMergeableBranch(git, branchName)
  let mergeError: unknown = null
  try {
    await git.raw(['merge', '--no-edit', branchName])
  } catch (err) {
    mergeError = err
  }
  if (await hasMergeInProgress(git)) await abortFailedMerge(git, mergeError)
  if (mergeError !== null) throw mergeError
}
```

- [ ] **Step 4: 単体テストが通ることを確認する**

Run: `npx vitest run src/main/__tests__/gitService.test.ts -t mergeBranch`
Expected: PASS（18 件）

- [ ] **Step 5: 実 git の統合テストのヘルパーを作る**

Create `src/main/__tests__/helpers/realGitRepo.ts`:

```ts
import { execFileSync } from 'child_process'
import { devNull } from 'os'

// 開発者のグローバル・システムの git 設定(commit.gpgsign、core.hooksPath 等)に左右されない
// よう、テスト側で実行する git と、対象の関数(simple-git が子プロセスとして起動する git)の
// 両方から切り離す。後者は vi.stubEnv(key, value) で process.env に反映して渡す
// (パターン41)
export const isolatedGitEnv = { GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' }

export function runGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...isolatedGitEnv },
    stdio: ['ignore', 'pipe', 'ignore']
  }).toString()
}

// main ブランチで初期化し、マージコミットを作れるようリポジトリ内にコミッター情報を設定する
export function initRepo(cwd: string): void {
  runGit(cwd, 'init', '-q', '-b', 'main')
  runGit(cwd, 'config', 'user.email', 'test@example.com')
  runGit(cwd, 'config', 'user.name', 'test')
  runGit(cwd, 'config', 'commit.gpgsign', 'false')
}

export function commitAll(cwd: string, message: string): void {
  runGit(cwd, 'add', '-A')
  runGit(cwd, 'commit', '-qm', message)
}
```

- [ ] **Step 6: 実 git の統合テストを書く**

Create `src/main/__tests__/gitService.merge.integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { mergeBranch } from '../gitService'
import { commitAll, initRepo, isolatedGitEnv, runGit } from './helpers/realGitRepo'

// gitService.test.ts は simple-git をモックするため、「実際の git がマージ・中止で working tree と
// MERGE_HEAD をどう変えるか」は検証できない。データを失わないことに関わる判定だけ、実 git で固定する
describe('mergeBranch(実 git)', () => {
  let repo: string

  const write = (path: string, content: string): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), content)
  }
  const read = (path: string): string => readFileSync(join(repo, path), 'utf8')
  const head = (): string => runGit(repo, 'rev-parse', 'HEAD').trim()
  const status = (): string => runGit(repo, 'status', '--porcelain')
  const hasMergeHead = (): boolean => {
    try {
      runGit(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')
      return true
    } catch {
      return false
    }
  }
  const commit = (files: Record<string, string>, message: string): void => {
    Object.entries(files).forEach(([path, content]) => write(path, content))
    commitAll(repo, message)
  }
  // main と feature が分岐した状態を作る。conflict なら両方が a.txt を変更する
  const setupDiverged = (conflict: boolean): void => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit(conflict ? { 'a.txt': 'feature' } : { 'f.txt': 'feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit(conflict ? { 'a.txt': 'main' } : { 'm.txt': 'main' }, 'main')
  }

  beforeEach(() => {
    Object.entries(isolatedGitEnv).forEach(([key, value]) => vi.stubEnv(key, value))
    repo = mkdtempSync(join(tmpdir(), 'merge-integration-'))
    initRepo(repo)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(repo, { recursive: true, force: true })
  })

  it('早送りできるときは早送りする(マージコミットを作らない)', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'f.txt': 'feature' }, 'feature')
    const featureHead = head()
    runGit(repo, 'checkout', '-q', 'main')
    await mergeBranch(repo, 'feature')
    expect(head()).toBe(featureHead)
    expect(read('f.txt')).toBe('feature')
  })

  it('分岐していればマージコミットを作り、両方の変更が入る', async () => {
    setupDiverged(false)
    await mergeBranch(repo, 'feature')
    // マージコミットは親が 2 つ(rev-list --parents の行が「自分 + 親 2 つ」の 3 フィールド)
    expect(runGit(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ')).toHaveLength(
      3
    )
    expect(read('f.txt')).toBe('feature')
    expect(read('m.txt')).toBe('main')
    expect(status()).toBe('')
  })

  it('すでに最新なら何も変えずに成功する', async () => {
    setupDiverged(false)
    await mergeBranch(repo, 'feature')
    const merged = head()
    await mergeBranch(repo, 'feature')
    expect(head()).toBe(merged)
  })

  it('コンフリクトしたら中止して、working tree・index・MERGE_HEAD が元に戻る', async () => {
    setupDiverged(true)
    const before = head()
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      'コンフリクトしたため中止しました: a.txt'
    )
    expect(hasMergeHead()).toBe(false)
    expect(head()).toBe(before)
    expect(read('a.txt')).toBe('main')
    expect(status()).toBe('')
  })

  it('追跡済みファイルに未コミットの変更があれば拒否し、変更を残す', async () => {
    setupDiverged(false)
    const before = head()
    write('m.txt', 'local edit')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      '未コミットの変更があるためマージできません。先にコミットしてください'
    )
    expect(head()).toBe(before)
    expect(read('m.txt')).toBe('local edit')
    expect(existsSync(join(repo, 'f.txt'))).toBe(false)
  })

  it('ステージ済みの変更があっても拒否し、変更を残す', async () => {
    setupDiverged(false)
    write('m.txt', 'staged edit')
    runGit(repo, 'add', 'm.txt')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      '未コミットの変更があるためマージできません'
    )
    expect(read('m.txt')).toBe('staged edit')
  })

  it('未追跡ファイルだけがあるならマージを始められ、未追跡ファイルは残る', async () => {
    setupDiverged(false)
    write('untracked.txt', 'keep')
    await mergeBranch(repo, 'feature')
    expect(read('untracked.txt')).toBe('keep')
    expect(read('f.txt')).toBe('feature')
  })

  // 上書きされる未追跡ファイルは git が拒否する(MERGE_HEAD は残らない)。git の英語の
  // エラー文はロケールで変わるため、文言ではなく「中止せずにファイルが残ること」で固定する
  it('マージで上書きされる未追跡ファイルは git が拒否し、ファイルが残る', async () => {
    commit({ 'a.txt': 'base' }, 'base')
    runGit(repo, 'checkout', '-q', '-b', 'feature')
    commit({ 'u.txt': 'from feature' }, 'feature')
    runGit(repo, 'checkout', '-q', 'main')
    commit({ 'm.txt': 'main' }, 'main')
    write('u.txt', 'local untracked')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow()
    expect(hasMergeHead()).toBe(false)
    expect(read('u.txt')).toBe('local untracked')
  })

  it('マージ中は拒否する', async () => {
    setupDiverged(true)
    expect(() => runGit(repo, 'merge', '--no-edit', 'feature')).toThrow()
    expect(hasMergeHead()).toBe(true)
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow('マージ中のため実行できません')
    expect(hasMergeHead()).toBe(true)
  })

  it('detached HEAD では拒否する', async () => {
    setupDiverged(false)
    runGit(repo, 'checkout', '-q', '--detach')
    await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
  })

  it('存在しないブランチと現在のブランチ自身は拒否する', async () => {
    setupDiverged(false)
    await expect(mergeBranch(repo, 'nope')).rejects.toThrow('存在しないブランチです: nope')
    await expect(mergeBranch(repo, 'main')).rejects.toThrow(
      '現在のブランチ自身はマージできません: main'
    )
  })

  // フックの失敗ではコンフリクトが無いのに MERGE_HEAD が残る。中止して元に戻ること
  // (Windows ではシェルスクリプトのフックを作れないため対象外)
  it.skipIf(process.platform === 'win32')(
    'pre-merge-commit フックが失敗したら中止して元に戻る',
    async () => {
      setupDiverged(false)
      const before = head()
      const hookPath = join(repo, '.git', 'hooks', 'pre-merge-commit')
      mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
      writeFileSync(hookPath, '#!/bin/sh\necho hook failed >&2\nexit 1\n')
      chmodSync(hookPath, 0o755)
      await expect(mergeBranch(repo, 'feature')).rejects.toThrow(
        'マージを完了できなかったため中止しました'
      )
      expect(hasMergeHead()).toBe(false)
      expect(head()).toBe(before)
      expect(status()).toBe('')
      expect(existsSync(join(repo, 'f.txt'))).toBe(false)
    }
  )
})
```

- [ ] **Step 7: 統合テストを実行する**

Run: `npx vitest run src/main/__tests__/gitService.merge.integration.test.ts`
Expected: PASS（12 件。Windows ではフックのテストが skip）。`detached` の判定で失敗した場合は `git.branchLocal()` の `detached` の値を実機で確かめ、`assertMergeableBranch` の判定を実際の値に合わせる

- [ ] **Step 8: ミューテーションで検知力を確かめる**

次の変更を 1 つずつ `src/main/gitService.ts` に入れ、`npx vitest run src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.merge.integration.test.ts` が落ちることを確認して戻す（`cp` で退避しておく）:

1. `assertMergeableBranch` の `dirty !== ''` の判定を削除する
2. `if (await hasMergeInProgress(git)) await abortFailedMerge(...)` を、`mergeError !== null` のときだけ中止する形に変える（resolve するコンフリクトを取りこぼす）
3. `abortFailedMerge` の diff と merge --abort の順序を入れ替える
4. `MAX_LISTED_CONFLICT_FILES` を 6 にする

- [ ] **Step 9: 検証する**

```bash
npx prettier --write src/main/gitService.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/helpers/realGitRepo.ts
npm run typecheck
npx eslint src/main/gitService.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/helpers/realGitRepo.ts
```

Expected: エラーなし

- [ ] **Step 10: Commit（ユーザーの許可がある場合のみ）**

```bash
git add src/main/gitService.ts src/main/__tests__/gitService.test.ts src/main/__tests__/gitService.merge.integration.test.ts src/main/__tests__/helpers/realGitRepo.ts docs/superpowers/specs/2026-09-30-git-branch-merge-design.md docs/superpowers/plans/2026-09-30-git-branch-merge.md
git commit -m "feat: ブランチのマージをmainプロセスに追加する"
```

---

### Task 2: IPC・preload・`gitApi`

**Files:**

- Modify: `src/main/handlers/gitHandlers.ts`
- Modify: `src/main/__tests__/handlers/gitHandlers.test.ts`
- Modify: `src/preload/api.ts`, `src/preload/index.d.ts`
- Modify: `src/preload/__tests__/api.test.ts`
- Modify: `src/renderer/src/lib/gitApi.ts`

**Interfaces:**

- Consumes: Task 1 の `mergeBranch(folderPath, branchName): Promise<void>`
- Produces: `window.api.mergeBranch(branchName: string): Promise<void>` / `gitApi.mergeBranch(branchName: string): Promise<void>`（Task 3 が呼ぶ）

- [ ] **Step 1: 失敗するテストを書く**

`src/main/__tests__/handlers/gitHandlers.test.ts`:

- 先頭の `const mockDeleteBranch = vi.hoisted(() => vi.fn())` の次の行に `const mockMergeBranch = vi.hoisted(() => vi.fn())` を追加する
- `vi.mock` の gitService の戻り値（`deleteBranch: mockDeleteBranch,` の次）に `mergeBranch: mockMergeBranch,` を追加する
- `describe('git:deleteBranch', ...)` の後（最後の `})` の前）に追加する:

```ts
describe('git:mergeBranch', () => {
  it('allowedFolder と branchName を引数に mergeBranch を呼ぶ', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    mockMergeBranch.mockResolvedValue(undefined)
    await getRegisteredHandler('git:mergeBranch')(makeEvent(1), 'feature/x')
    expect(mockMergeBranch).toHaveBeenCalledWith('/project', 'feature/x')
  })

  it('branchName が文字列でなければ mergeBranch を呼ばずに拒否する', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:mergeBranch')(makeEvent(1), null)).rejects.toThrow(
      'Invalid branch name'
    )
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })

  // 型検証より先にフォルダの許可を確認する(フォルダ未設定なら型に関わらず同じエラー)
  it('folderAccess が未設定のとき、引数の型に関わらず "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    registerGitHandlers(mockIpcMain, folderAccess)
    await expect(getRegisteredHandler('git:mergeBranch')(makeEvent(1), 123)).rejects.toThrow(
      'No folder open'
    )
  })
})
```

`src/preload/__tests__/api.test.ts` の `deleteBranch` の項目の後に追加する:

```ts
  [
    'mergeBranch は git:mergeBranch チャンネルに branchName を渡す',
    () => api.mergeBranch('feature/x'),
    ['git:mergeBranch', 'feature/x']
  ],
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts`
Expected: FAIL（`git:mergeBranch` ハンドラーが未登録 / `api.mergeBranch is not a function`）

- [ ] **Step 3: 実装する**

`src/main/handlers/gitHandlers.ts`: import の `deleteBranch` の後に `mergeBranch` を追加し（`  deleteBranch,\n  mergeBranch`）、`registerGitHandlers` の `git:deleteBranch` ハンドラーの後に追加する:

```ts
ipcMain.handle('git:mergeBranch', async (event: IpcMainInvokeEvent, branchName: unknown) => {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  assertBranchNameArg(branchName)
  await mergeBranch(allowedFolder, branchName)
})
```

`src/preload/api.ts`（`deleteBranch` の後）:

```ts
  mergeBranch: (branchName: string): Promise<void> =>
    ipcRenderer.invoke('git:mergeBranch', branchName),
```

`src/preload/index.d.ts`（`deleteBranch` の後）:

```ts
      mergeBranch(branchName: string): Promise<void>
```

`src/renderer/src/lib/gitApi.ts`（`deleteBranch` の後）:

```ts
export function mergeBranch(branchName: string): Promise<void> {
  return window.api.mergeBranch(branchName)
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts && npm run typecheck`
Expected: PASS / エラーなし

- [ ] **Step 5: 実装を戻すとテストが落ちることを確認する**

```bash
git stash push src/main/handlers/gitHandlers.ts src/preload/api.ts
npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/preload/__tests__/api.test.ts   # FAIL を確認
git stash pop
```

- [ ] **Step 6: 検証する**

```bash
npx prettier --write src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/gitApi.ts
npx eslint src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/gitApi.ts
```

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ）**

```bash
git add src/main/handlers/gitHandlers.ts src/main/__tests__/handlers/gitHandlers.test.ts src/preload/api.ts src/preload/index.d.ts src/preload/__tests__/api.test.ts src/renderer/src/lib/gitApi.ts
git commit -m "feat: ブランチのマージのIPCとpreload APIを追加する"
```

---

### Task 3: `useGitBranchOperations.mergeBranch`・確認文言・実行中の表示

**Files:**

- Create: `src/renderer/src/lib/branchMerge.ts`, `src/renderer/src/lib/__tests__/branchMerge.test.ts`
- Modify: `src/renderer/src/types.ts`
- Modify: `src/renderer/src/lib/branchTriggerLabel.ts`, `src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts`
- Modify: `src/renderer/src/hooks/useGitBranchOperations.ts`, `src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`

**Interfaces:**

- Consumes: Task 2 の `gitApi.mergeBranch(branchName): Promise<void>`
- Produces:
  - `buildMergeConfirmMessage(branchName: string, currentBranch: string): string`
  - `BranchOperationKind = 'checkout' | 'create' | 'delete' | 'merge'`
  - `GitBranchOperationsState.mergeBranch: (branchName: string) => Promise<boolean>`（Task 4 が呼ぶ）

- [ ] **Step 1: 失敗するテストを書く**

Create `src/renderer/src/lib/__tests__/branchMerge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMergeConfirmMessage } from '../branchMerge'

describe('buildMergeConfirmMessage', () => {
  it('マージ元・マージ先のブランチ名と、コンフリクト時に自動で中止する旨を含める', () => {
    expect(buildMergeConfirmMessage('feature/x', 'main')).toBe(
      'feature/x を main にマージしますか？\n\nコンフリクトした場合は自動で中止して元に戻します。'
    )
  })
})
```

`src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts` の `it.each([...])('%s 実行中は...')` の配列に 1 行追加する（`['delete', '削除中...', 'ブランチ削除中']` の後）:

```ts
;(['delete', '削除中...', 'ブランチ削除中'], ['merge', 'マージ中...', 'ブランチのマージ中'])
```

`src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`:

- 先頭付近の `const mockDeleteBranch = vi.mocked(gitApi.deleteBranch)` の次に追加: `const mockMergeBranch = vi.mocked(gitApi.mergeBranch)`
- `describe('deleteBranch', ...)` の後、`describe('共通の開始条件', ...)` の前に追加する:

```ts
describe('mergeBranch', () => {
  const MESSAGE =
    'feature/x を main にマージしますか？\n\nコンフリクトした場合は自動で中止して元に戻します。'

  const renderWithConfirm = (
    onConfirm: (message: string) => boolean,
    lock = makeFileLock(),
    refreshGitStatus = vi.fn().mockResolvedValue(undefined),
    refreshHistory = vi.fn().mockResolvedValue(undefined)
  ): ReturnType<typeof renderHook<GitBranchOperationsState, never>> =>
    renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock, { onConfirm })
    )

  it('確認でキャンセルしたらマージ API を呼ばずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderWithConfirm(onConfirm)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(onConfirm).toHaveBeenCalledWith(MESSAGE)
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })

  it('確認後にマージ API を呼び、成功したら true を返して一覧を再取得する', async () => {
    mockMergeBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderWithConfirm(
      vi.fn().mockReturnValue(true),
      makeFileLock(),
      refreshGitStatus,
      refreshHistory
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(true)
    expect(mockMergeBranch).toHaveBeenCalledWith('feature/x')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // マージは working tree/index/HEAD を書き換えるため checkout と同じく全体ロックを取る。
  // これにより push 側の既存の判定(lock.isAnyLocked())で「マージ中の push」が自動的に防がれる
  it('実行中は lockGlobal を取り、完了後に unlockGlobal する', async () => {
    mockMergeBranch.mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    await act(async () => {
      await result.current.mergeBranch('feature/x')
    })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('実行中は pendingBranchOperation が merge になり、完了後 null に戻る', async () => {
    let resolveMerge: () => void = () => {}
    mockMergeBranch.mockReturnValue(new Promise<void>((r) => (resolveMerge = r)))
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    act(() => {
      void result.current.mergeBranch('feature/x')
    })
    expect(result.current.pendingBranchOperation).toBe('merge')
    await act(async () => {
      resolveMerge()
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('失敗したら false を返し、branchOperationError に反映してロックを解除する', async () => {
    mockMergeBranch.mockRejectedValue(new Error('コンフリクトしたため中止しました: a.txt'))
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      'コンフリクトしたため中止しました: a.txt'
    )
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('他の操作が file lock を握っている間はマージ API を呼ばない', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })
})
```

`describe('共通の開始条件', ...)` の 2 つの `it.each` を、マージを含む形に直す:

1. 1 つ目の配列に `['mergeBranch', () => vi.mocked(gitApi.mergeBranch)]` を追加する（`['deleteBranch', ...]` の後）
2. 2 つ目の `it.each(['checkoutBranch', 'createBranch', 'deleteBranch'] as const)` を `it.each(['checkoutBranch', 'createBranch', 'deleteBranch', 'mergeBranch'] as const)` にし、テスト内の `expect(gitApi.deleteBranch).not.toHaveBeenCalled()` の後に `expect(gitApi.mergeBranch).not.toHaveBeenCalled()` を追加する
3. 3 つ目として、マージの実行中に他の 3 操作が動かないことを固定する `it.each` を、`describe('共通の開始条件')` の末尾に追加する:

```ts
it.each(['checkoutBranch', 'createBranch', 'deleteBranch'] as const)(
  'マージの実行中は %s を呼んでも git API を呼ばない',
  async (method) => {
    vi.mocked(gitApi.mergeBranch).mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock(),
        { onConfirm: vi.fn().mockReturnValue(true) }
      )
    )
    act(() => {
      void result.current.mergeBranch('feature/busy')
    })
    await act(async () => {
      await result.current[method]('feature/x')
    })
    expect(mockCheckoutBranch).not.toHaveBeenCalled()
    expect(gitApi.createBranch).not.toHaveBeenCalled()
    expect(gitApi.deleteBranch).not.toHaveBeenCalled()
    expect(result.current.pendingBranchOperation).toBe('merge')
  }
)
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/branchMerge.test.ts src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`
Expected: FAIL（モジュール未定義 / `mergeBranch is not a function`）

- [ ] **Step 3: 実装する**

Create `src/renderer/src/lib/branchMerge.ts`:

```ts
// マージの確認文言。コンフリクトはアプリ内に解決手段が無いため自動で中止する旨を伝える
// (lib/branchDeletion.ts と同じ位置づけの純粋関数)
export function buildMergeConfirmMessage(branchName: string, currentBranch: string): string {
  return `${branchName} を ${currentBranch} にマージしますか？\n\nコンフリクトした場合は自動で中止して元に戻します。`
}
```

`src/renderer/src/types.ts`:

```ts
export type BranchOperationKind = 'checkout' | 'create' | 'delete' | 'merge'
```

`src/renderer/src/lib/branchTriggerLabel.ts` の `PENDING_LABELS`:

```ts
  delete: { text: '削除中...', ariaLabel: 'ブランチ削除中' },
  merge: { text: 'マージ中...', ariaLabel: 'ブランチのマージ中' }
```

`src/renderer/src/hooks/useGitBranchOperations.ts`:

- import に追加: `import { buildMergeConfirmMessage } from '../lib/branchMerge'`
- `GitBranchOperationsState` の `deleteBranch` の後に追加:

```ts
/** 確認 → 現在のブランチへマージ。戻り値は実行され成功したか(確認のキャンセル・
 *  isBusy による no-op・git レベルの失敗では false)。呼び出し元(useAppState.ts)が
 *  reloadOpenFiles 等「マージが成功した前提」の後続処理を成功時だけ実行するために使う */
mergeBranch: (branchName: string) => Promise<boolean>
```

- `deleteBranch` の定義の後、`return {` の前に追加:

```ts
// マージは working tree/index/HEAD を書き換えるため、checkout と同じ理由で lockGlobal を
// 取る(マージ中に push が始まると、確定前の HEAD を送ってしまう)。開始条件も checkout と
// 同じく他操作中を待つ。現在のブランチ名が分からない状態(リポジトリが無い)は
// isBranchOperationDisabled で弾かれる操作のため、確認も出さずに終える。
// コンフリクトは main 側が自動で中止し、日本語のエラーを投げる(branchOperationError に出る)
const mergeBranch = async (branchName: string): Promise<boolean> => {
  const currentBranch = gitStatus?.branch
  if (currentBranch === null || currentBranch === undefined) return false
  if (!onConfirm(buildMergeConfirmMessage(branchName, currentBranch))) return false
  return runOperation({
    isBusy: isBranchOperationBusy,
    setBusy: makeSetBusy('merge'),
    onStart: lock.lockGlobal,
    onEnd: lock.unlockGlobal,
    execute: () => gitApi.mergeBranch(branchName)
  })
}
```

- `return { ... }` に `mergeBranch,` を追加する（`deleteBranch,` の後）

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/renderer/src/lib/__tests__/branchMerge.test.ts src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts`
Expected: PASS

- [ ] **Step 5: ミューテーションで確かめる**

`useGitBranchOperations.ts` の `mergeBranch` から (a) `onStart: lock.lockGlobal, onEnd: lock.unlockGlobal,` を消す、(b) `isBusy: isBranchOperationBusy` を `isBusy: () => false` にする、(c) 確認の `if (!onConfirm(...)) return false` を消す。それぞれテストが落ちることを確認して戻す。

- [ ] **Step 6: 検証する**

```bash
npx prettier --write src/renderer/src/lib/branchMerge.ts src/renderer/src/lib/__tests__/branchMerge.test.ts src/renderer/src/types.ts src/renderer/src/lib/branchTriggerLabel.ts src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts
npm run typecheck
npx eslint src/renderer/src/lib/branchMerge.ts src/renderer/src/lib/__tests__/branchMerge.test.ts src/renderer/src/types.ts src/renderer/src/lib/branchTriggerLabel.ts src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts
```

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ）**

```bash
git add src/renderer/src/lib/branchMerge.ts src/renderer/src/lib/__tests__/branchMerge.test.ts src/renderer/src/types.ts src/renderer/src/lib/branchTriggerLabel.ts src/renderer/src/lib/__tests__/branchTriggerLabel.test.ts src/renderer/src/hooks/useGitBranchOperations.ts src/renderer/src/hooks/__tests__/useGitBranchOperations.test.ts
git commit -m "feat: ブランチのマージを排他制御つきで実行するフックを追加する"
```

---

### Task 4: `useAppState` のラッパー

**Files:**

- Modify: `src/renderer/src/hooks/useAppState.ts`
- Modify: `src/renderer/src/hooks/__tests__/useAppState.test.ts`

**Interfaces:**

- Consumes: Task 3 の `gitBranchOperations.mergeBranch(branchName): Promise<boolean>`、既存の `fileSystem.confirmDiscardAnyDirty()` / `fileSystem.reloadOpenFiles()`
- Produces: `useAppState().mergeBranch: (branchName: string) => Promise<void>`（Task 5 の `App.tsx` が渡す）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/src/hooks/__tests__/useAppState.test.ts` の `describe('checkoutBranch ラッパー', ...)` の直後（`describe('discardFile ラッパー'` の前）に追加する。`checkoutBranch ラッパー` の `setup()` は describe 内のローカル関数なので、同じ内容をこの describe に持たせる:

```ts
describe('mergeBranch ラッパー', () => {
  // マージも working tree のファイルを直接書き換えるが、エディタのバッファは別に保持して
  // いるため連動しない。checkout と同じく、未保存編集の破棄を確認し、成功後だけ開いている
  // 全タブをディスクの最新内容へ同期する。失敗時に再読込すると、無関係な未保存編集が
  // 切替前のディスク内容で上書きされて失われる
  function setup(options: {
    confirmDiscardAnyDirty: () => boolean
    reloadOpenFiles: () => Promise<void>
  }): void {
    mockUseFileSystem.mockReturnValue({
      ...mockUseFileSystem(),
      folderPath: '/project',
      confirmDiscardAnyDirty: options.confirmDiscardAnyDirty,
      reloadOpenFiles: options.reloadOpenFiles
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn().mockResolvedValue(undefined)
    })
  }

  const runMerge = async (
    apiMerge: ReturnType<typeof vi.fn>,
    options: { confirmDiscardAnyDirty: () => boolean; reloadOpenFiles: () => Promise<void> },
    mergeConfirm = true
  ): Promise<void> => {
    setup(options)
    const originalMergeBranch = window.api.mergeBranch
    window.api.mergeBranch = apiMerge
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(mergeConfirm)
    try {
      const { result } = renderHook(() => useAppState())
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
    } finally {
      window.api.mergeBranch = originalMergeBranch
      confirmSpy.mockRestore()
    }
  }

  it('確認どおりマージを実行し、成功後に開いているファイルを再読込する', async () => {
    const confirmDiscardAnyDirty = vi.fn(() => true)
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const apiMerge = vi.fn().mockResolvedValue(undefined)
    await runMerge(apiMerge, { confirmDiscardAnyDirty, reloadOpenFiles })
    expect(confirmDiscardAnyDirty).toHaveBeenCalled()
    expect(apiMerge).toHaveBeenCalledWith('feature/x')
    expect(reloadOpenFiles).toHaveBeenCalled()
  })

  it('未保存編集の破棄確認でキャンセルされたら、マージも再読込もしない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const apiMerge = vi.fn().mockResolvedValue(undefined)
    setup({ confirmDiscardAnyDirty: () => false, reloadOpenFiles })
    const original = window.api.mergeBranch
    window.api.mergeBranch = apiMerge
    try {
      const { result } = renderHook(() => useAppState())
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
      expect(apiMerge).not.toHaveBeenCalled()
      expect(reloadOpenFiles).not.toHaveBeenCalled()
    } finally {
      window.api.mergeBranch = original
    }
  })

  it('マージの確認でキャンセルされたら、マージも再読込もしない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const apiMerge = vi.fn().mockResolvedValue(undefined)
    await runMerge(apiMerge, { confirmDiscardAnyDirty: () => true, reloadOpenFiles }, false)
    expect(apiMerge).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  // gitBranchOperations.mergeBranch は git レベルの失敗(コンフリクトで中止した等)でも
  // 例外を投げず false を返すだけ。戻り値を見ずに再読込すると、マージが行われていないのに
  // 無関係な未保存編集がディスク内容で上書きされる
  it('マージが失敗した場合、reloadOpenFiles は呼ばれない(未保存編集を保持する)', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const apiMerge = vi.fn().mockRejectedValue(new Error('コンフリクトしたため中止しました: a.txt'))
    await runMerge(apiMerge, { confirmDiscardAnyDirty: () => true, reloadOpenFiles })
    expect(apiMerge).toHaveBeenCalledWith('feature/x')
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts -t "mergeBranch"`
Expected: FAIL（`result.current.mergeBranch is not a function`）

- [ ] **Step 3: 実装する**

`src/renderer/src/hooks/useAppState.ts`:

- 型: `checkoutBranch: (branchName: string) => Promise<void>` の後に追加

```ts
/** gitBranchOperations.mergeBranch(戻り値 Promise<boolean>)を、未保存編集の破棄確認 +
 *  成功時のみ reloadOpenFiles を行うラッパーに差し替えている(checkoutBranch と同じ)。
 *  公開する型は Promise<void> */
mergeBranch: (branchName: string) => Promise<void>
```

- 型の `Omit<ReturnType<typeof useGitBranchOperations>, 'checkoutBranch'>` を `Omit<ReturnType<typeof useGitBranchOperations>, 'checkoutBranch' | 'mergeBranch'>` にする
- `checkoutBranch` ラッパーの直後に追加

```ts
// マージも checkout と同じく working tree を書き換えるため、未保存編集の破棄を確認し、
// 成功時のみ再読込する。gitBranchOperations.mergeBranch は失敗(コンフリクトの自動中止等)
// でも例外を投げず false を返すため、戻り値を見ずに再読込しない。
// ファイルツリーの再読込は checkout と同じく行わない(ブランチ操作の既存の制約)
const mergeBranch: (branchName: string) => Promise<void> = async (branchName) => {
  if (!fileSystem.confirmDiscardAnyDirty()) return
  const succeeded = await gitBranchOperations.mergeBranch(branchName)
  if (succeeded) await fileSystem.reloadOpenFiles()
}
```

- 戻り値のオブジェクトの `checkoutBranch,` の後に `mergeBranch,` を追加する

- [ ] **Step 4: 通ることを確認する**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts`
Expected: PASS

- [ ] **Step 5: 実装を戻すと落ちることを確認する**

```bash
git stash push src/renderer/src/hooks/useAppState.ts
npx vitest run src/renderer/src/hooks/__tests__/useAppState.test.ts -t "mergeBranch"   # FAIL を確認
git stash pop
```

さらに `if (succeeded)` を外す変異（常に再読込）で「マージが失敗した場合」のテストが落ちることを確認して戻す。

- [ ] **Step 6: 検証する**

```bash
npx prettier --write src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts
npm run typecheck
npx eslint src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts
```

- [ ] **Step 7: Commit（ユーザーの許可がある場合のみ）**

```bash
git add src/renderer/src/hooks/useAppState.ts src/renderer/src/hooks/__tests__/useAppState.test.ts
git commit -m "feat: ブランチのマージ後に開いているタブを再読込するラッパーを追加する"
```

---

### Task 5: UI（マージボタン・`M` キー・配線・スタイル）

**Files:**

- Modify: `src/renderer/src/components/source-control/BranchMenuItem.tsx`, `__tests__/BranchMenuItem.test.tsx`
- Modify: `src/renderer/src/components/source-control/BranchSwitcherMenu.tsx`, `__tests__/BranchSwitcherMenu.test.tsx`, `__tests__/BranchSwitcherMenu.styles.test.tsx`
- Modify: `src/renderer/src/components/source-control/BranchSwitcher.tsx`, `__tests__/BranchSwitcher.test.tsx`
- Modify: `GitRepoView.tsx`, `SourceControlPanel.tsx`（同ディレクトリ）と `__tests__/GitRepoView.test.tsx`, `__tests__/SourceControlPanel.test.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`, `__tests__/Sidebar.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/assets/main.css`

**Interfaces:**

- Consumes: Task 4 の `useAppState().mergeBranch: (branchName: string) => Promise<void>`
- Produces: `onMergeBranch: (branchName: string) => Promise<void>` prop（`BranchSwitcher` / `GitRepoView` / `SourceControlPanel` / `Sidebar`）、`onMerge: (branchName: string) => void` prop（`BranchSwitcherMenu` / `BranchMenuItem`）

- [ ] **Step 1: `BranchMenuItem` の失敗するテストを書く**

`src/renderer/src/components/source-control/__tests__/BranchMenuItem.test.tsx`:

- `baseProps` に `onMerge: vi.fn()` を追加する（`onDelete: vi.fn()` の後）
- 既存の `it('aria-keyshortcuts="Delete" で削除ショートカットを告知する'...)` を次に置き換える:

```tsx
it('aria-keyshortcuts="Delete M" で削除・マージのショートカットを告知する', () => {
  renderItem()
  expect(screen.getByRole('radio')).toHaveAttribute('aria-keyshortcuts', 'Delete M')
})
```

- 現在以外のブランチの describe に追加する:

```tsx
it('マージボタンを tabIndex=-1 で描画し、クリックで onMerge だけを呼ぶ', async () => {
  const onMerge = vi.fn()
  const onSelect = vi.fn()
  renderItem({ onMerge, onSelect })
  const button = screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
  expect(button).toHaveAttribute('tabindex', '-1')
  await userEvent.click(button)
  expect(onMerge).toHaveBeenCalledWith('feature/x')
  expect(onSelect).not.toHaveBeenCalled()
})

it.each(['m', 'M'])('radio 上の %s キーで onMerge を呼び、既定動作を止める', (key) => {
  const onMerge = vi.fn()
  renderItem({ onMerge })
  const notCanceled = fireEvent.keyDown(screen.getByRole('radio'), { key })
  expect(onMerge).toHaveBeenCalledWith('feature/x')
  expect(notCanceled).toBe(false)
})

it.each(['Enter', 'ArrowDown', 'Delete', 'a'])('%s キーでは onMerge を呼ばない', (key) => {
  const onMerge = vi.fn()
  renderItem({ onMerge })
  fireEvent.keyDown(screen.getByRole('radio'), { key })
  expect(onMerge).not.toHaveBeenCalled()
})

// Cmd+M(ウィンドウを最小化)等、ブラウザ・OS のショートカットを奪わない
it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])(
  '修飾キー付きの M では onMerge を呼ばない (%o)',
  (modifier) => {
    const onMerge = vi.fn()
    renderItem({ onMerge })
    fireEvent.keyDown(screen.getByRole('radio'), { key: 'm', ...modifier })
    expect(onMerge).not.toHaveBeenCalled()
  }
)

it('Delete キーは従来どおり onDelete を呼び、onMerge は呼ばない', () => {
  const onDelete = vi.fn()
  const onMerge = vi.fn()
  renderItem({ onDelete, onMerge })
  fireEvent.keyDown(screen.getByRole('radio'), { key: 'Delete' })
  expect(onDelete).toHaveBeenCalledWith('feature/x')
  expect(onMerge).not.toHaveBeenCalled()
})
```

- 現在ブランチの describe（`const current` を使っているもの）に追加する:

```tsx
it('マージボタンを持たず、M キーのイベントが届いても onMerge を呼ばない', () => {
  const onMerge = vi.fn()
  renderItem({ branch: current, onMerge })
  expect(screen.queryByRole('button', { name: /現在のブランチにマージ/ })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('radio'), { key: 'm' })
  expect(onMerge).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: `BranchSwitcherMenu` / `BranchSwitcher` / 上位コンポーネントの失敗するテストを書く**

`BranchSwitcherMenu.test.tsx`: `renderMenu` の `render(<BranchSwitcherMenu ... />)` のデフォルト props（`onDelete={vi.fn()}` がある箇所、31 行目付近）に `onMerge={vi.fn()}` を追加する。`onDelete` の配線テスト（`行の削除ボタンから onDelete がブランチ名で呼ばれる`）の後に追加:

```tsx
it('行のマージボタンから onMerge がブランチ名で呼ばれる(BranchMenuItem への配線)', async () => {
  const onMerge = vi.fn()
  renderMenu({ onMerge })
  await userEvent.click(
    screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
  )
  expect(onMerge).toHaveBeenCalledWith('feature/x')
})
```

`BranchSwitcherMenu.styles.test.tsx`: `renderMenu` は現在ブランチだけを描画する。マージボタンのスタイル用に追加する:

```tsx
// タッチ操作で押しやすいよう、マージボタンは削除ボタンと同じ 32px 四方のタップ領域を持つ
it('マージボタンは 32px 四方のタップ領域を持つ', () => {
  render(
    <BranchSwitcherMenu
      branches={[
        { name: 'main', current: true },
        { name: 'feature/x', current: false }
      ]}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCreateRequest={vi.fn()}
      onDelete={vi.fn()}
      onMerge={vi.fn()}
    />
  )
  const style = getComputedStyle(
    screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
  )
  expect(style.width).toBe('32px')
  expect(style.height).toBe('32px')
})
```

（同ファイルの既存 `renderMenu` の `<BranchSwitcherMenu ... />` にも `onMerge={vi.fn()}` を追加する）

`BranchSwitcher.test.tsx`: `baseProps` に `onMergeBranch: vi.fn().mockResolvedValue(undefined)` を追加し、削除ボタンのテストの後に追加:

```tsx
it('マージボタンでメニューが閉じ、トリガーへフォーカスが戻り、onMergeBranch が呼ばれる', async () => {
  const onMergeBranch = vi.fn().mockResolvedValue(undefined)
  render(<BranchSwitcher {...baseProps} onMergeBranch={onMergeBranch} />)
  const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
  await userEvent.click(trigger)
  await userEvent.click(
    screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
  )
  expect(onMergeBranch).toHaveBeenCalledWith('feature/x')
  expect(screen.queryByRole('radiogroup', { name: 'ブランチ' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('マージ実行中はトリガーが「マージ中...」になり、aria-label が「ブランチのマージ中」になる', () => {
  render(<BranchSwitcher {...baseProps} pendingBranchOperation="merge" />)
  const trigger = screen.getByRole('button', { name: 'ブランチのマージ中' })
  expect(trigger).toHaveTextContent('マージ中...')
  expect(trigger).toBeDisabled()
})
```

`GitRepoView.test.tsx`: `baseProps` の `onDeleteBranch: vi.fn().mockResolvedValue(true)` の後に `onMergeBranch: vi.fn().mockResolvedValue(undefined)` を追加し、`<GitRepoView` に `onDeleteBranch={vi.fn().mockResolvedValue(true)}` を直接渡している 4 箇所（186・253・290・325 行付近）にも `onMergeBranch={vi.fn().mockResolvedValue(undefined)}` を追加する。削除ボタンのテストの後に追加:

```tsx
it('BranchSwitcher のマージボタンから onMergeBranch が呼ばれる', async () => {
  const onMergeBranch = vi.fn().mockResolvedValue(undefined)
  render(
    <GitRepoView
      {...baseProps}
      branch="main"
      ahead={0}
      behind={0}
      files={noFiles}
      branches={[
        { name: 'main', current: true },
        { name: 'feature/x', current: false }
      ]}
      onMergeBranch={onMergeBranch}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
  await userEvent.click(
    screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
  )
  expect(onMergeBranch).toHaveBeenCalledWith('feature/x')
})
```

`SourceControlPanel.test.tsx`（43 行目の `onDeleteBranch` の後、229 行目付近の直接渡しの後）と `Sidebar.test.tsx`（64 行目）にも `onMergeBranch: vi.fn().mockResolvedValue(undefined)`（JSX 直接渡しは `onMergeBranch={vi.fn().mockResolvedValue(undefined)}`）を追加する。

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run src/renderer/src/components`
Expected: FAIL（マージボタンが無い / 型エラー）

- [ ] **Step 4: 実装する**

`BranchMenuItem.tsx` を次の内容に置き換える:

```tsx
import type { GitBranch } from '@shared/types'

interface Props {
  branch: GitBranch
  /** roving tabindex で、このブランチが radiogroup 内の唯一の Tab 停止点か */
  isTabbable: boolean
  /** 親(BranchSwitcherMenu)が矢印キーでフォーカスを移すための要素登録。アンマウント時は null */
  registerRef: (branchName: string, el: HTMLButtonElement | null) => void
  onFocus: (branchName: string) => void
  onSelect: (branchName: string) => void
  onDelete: (branchName: string) => void
  /** マージボタン、または radio 上の M キー。確認ダイアログは呼び出し元(フック)が出す */
  onMerge: (branchName: string) => void
}

// ブランチ一覧の1行(選択用の radio と、マージ・削除ボタン)。メニュー全体の開閉や矢印キーによる
// フォーカス移動は親(BranchSwitcherMenu)の責務で、ここでは1ブランチ分の表示と操作だけを担う。
// 現在ブランチは選択・マージ・削除のいずれもできないため、radio を disabled にしボタンを出さない
export default function BranchMenuItem({
  branch,
  isTabbable,
  registerRef,
  onFocus,
  onSelect,
  onDelete,
  onMerge
}: Props): React.JSX.Element {
  const canOperate = !branch.current
  return (
    <div className="source-control-panel__branch-menu-row">
      <button
        ref={(el) => registerRef(branch.name, el)}
        type="button"
        role="radio"
        aria-checked={branch.current}
        aria-keyshortcuts={canOperate ? 'Delete M' : undefined}
        className="source-control-panel__branch-menu-item"
        disabled={branch.current}
        tabIndex={isTabbable ? 0 : -1}
        onFocus={() => onFocus(branch.name)}
        onClick={() => onSelect(branch.name)}
        onKeyDown={(e) => {
          if (!canOperate) return
          if (e.key === 'Delete') {
            e.preventDefault()
            onDelete(branch.name)
            return
          }
          // Cmd+M(ウィンドウの最小化)等のショートカットを奪わないよう、修飾キー無しのときだけ
          if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            onMerge(branch.name)
          }
        }}
      >
        {branch.current ? '✓ ' : ''}
        {branch.name}
      </button>
      {canOperate && (
        // roving tabindex を崩さないよう Tab 停止点にしない。キーボードでは
        // radio 上の M / Delete キーで同じ操作ができる(aria-keyshortcuts で告知)
        <>
          <button
            type="button"
            tabIndex={-1}
            className="source-control-panel__branch-menu-merge"
            aria-label={`ブランチ ${branch.name} を現在のブランチにマージ`}
            onClick={() => onMerge(branch.name)}
          >
            🔀
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="source-control-panel__branch-menu-delete"
            aria-label={`ブランチ ${branch.name} を削除`}
            onClick={() => onDelete(branch.name)}
          >
            🗑
          </button>
        </>
      )}
    </div>
  )
}
```

`BranchSwitcherMenu.tsx`: `Props` に追加し、`BranchMenuItem` に渡す。

```tsx
  /** マージボタン、または radio 上の M キー。確認ダイアログは呼び出し元(フック)が出す */
  onMerge: (branchName: string) => void
```

関数の引数分割代入に `onMerge` を追加し、`<BranchMenuItem ... onDelete={onDelete} />` に `onMerge={onMerge}` を追加する。

`BranchSwitcher.tsx`:

- `Props` に `onMergeBranch: (branchName: string) => Promise<void>` を追加し、引数に `onMergeBranch` を追加する
- `handleDelete` の後に追加:

```tsx
// 確認ダイアログはフック側(useGitBranchOperations.mergeBranch)が出す。
// メニューは先に閉じてトリガーへフォーカスを戻しておく(削除と同じ)
const handleMerge = (branchName: string): void => {
  setIsOpen(false)
  triggerRef.current?.focus()
  void onMergeBranch(branchName)
}
```

- `<BranchSwitcherMenu ... onDelete={handleDelete} />` に `onMerge={handleMerge}` を追加する

`GitRepoView.tsx` / `SourceControlPanel.tsx` / `Sidebar.tsx`: `onDeleteBranch` と同じ 3 箇所（Props の型、引数の分割代入、子への受け渡し）に `onMergeBranch: (branchName: string) => Promise<void>` を追加する（`GitRepoView.tsx` は 41・71・91 行、`SourceControlPanel.tsx` は 45・87・151 行、`Sidebar.tsx` は 83・167・272 行が `onDeleteBranch` の位置）。

`App.tsx`: `useAppState()` の分割代入（106 行目付近）の `deleteBranch,` の後に `mergeBranch,` を追加し、`<Sidebar ... onDeleteBranch={deleteBranch}` の後に `onMergeBranch={mergeBranch}` を追加する。

`src/renderer/src/assets/main.css`: `.source-control-panel__branch-menu-delete:hover` の後に追加する:

```css
/* 削除ボタンと同じ 32px 四方のタップ領域。ホバーは破壊的でない操作なので赤ではなく青系にする */
.source-control-panel__branch-menu-merge {
  flex: none;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  color: #cccccc;
  font-size: 12px;
  cursor: pointer;
}

.source-control-panel__branch-menu-merge:hover {
  background: #094771;
  color: #ffffff;
}
```

- [ ] **Step 5: 通ることを確認する**

Run: `npx vitest run src/renderer/src/components && npm run typecheck`
Expected: PASS / エラーなし

- [ ] **Step 6: ミューテーションで確かめる**

`BranchMenuItem.tsx` で (a) 修飾キーの条件 `!e.ctrlKey && !e.metaKey && !e.altKey` を消す、(b) `canOperate` の早期 `return` を消す、(c) `aria-keyshortcuts` を `'Delete'` に戻す、をそれぞれ試し、テストが落ちることを確認して戻す。`BranchSwitcher.tsx` の `handleMerge` から `triggerRef.current?.focus()` を消すとフォーカスのテストが落ちることも確認する。

- [ ] **Step 7: 検証する**

```bash
npx prettier --write src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/assets/main.css
npm run typecheck
npx eslint src/renderer/src/components src/renderer/src/App.tsx
npm test
```

Expected: すべて成功

- [ ] **Step 8: Commit（ユーザーの許可がある場合のみ）**

```bash
git add src/renderer/src/components src/renderer/src/App.tsx src/renderer/src/assets/main.css
git commit -m "feat: ブランチ一覧にマージボタンとMキーを追加する"
```

---

### Task 6: ROADMAP・実機確認

**Files:**

- Modify: `ROADMAP.md`

- [ ] **Step 1: ROADMAP を更新する**

- 「実装済み機能 > ソース管理（Git 操作）」の `ブランチの作成…削除` の行の後に追加:

```md
- [x] ブランチのマージ（ブランチ一覧の各行のマージボタン / `M` キー。現在のブランチへ git の既定の方式でマージし、コンフリクトは自動で中止して元に戻す。未コミットの変更がある間は開始しない）
```

- 「今後実装した方がよい機能 > ソース管理（Git）」から `- [ ] ブランチのマージ（表示・切り替え・作成・削除は実装済み）` を削除し、見出し直後の説明文の「マージや stash などは依然として」を「stash やコンフリクトの解決などは依然として」に直す
- 「ブランチのマージ」の実装で見送ったものを、ROADMAP の該当箇所に `[ ]` で追記する:
  - `マージ方式の選択（--no-ff / --squash）`
  - `マージ後のファイルツリーの再読込（checkout と同じく未対応。追加・削除されたファイルがツリーに反映されない）`

```bash
npx prettier --check ROADMAP.md
```

- [ ] **Step 2: 全体を検証する**

```bash
npm test
npm run typecheck
git diff --name-only | grep -E '\.tsx?$' | xargs npx eslint
git diff --name-only | xargs npx prettier --check
```

Expected: すべて成功

- [ ] **Step 3: 実機（Electron）で確認する**

`npm run dev` で起動し、テスト用の Git リポジトリを開いて次を確認する。確認後は **起動した Electron と dev サーバーを自分で停止する**（`pgrep -fl` で対象を確認してから、リポジトリ名を含むパターンで `pkill -f`）:

1. 早送り: 先行するブランチをマージ → 履歴に反映され、開いているタブが最新の内容になる
2. マージコミット: 分岐したブランチをマージ → マージコミットができる
3. コンフリクト: 同じ行を変更した 2 ブランチをマージ → エラーバナーにファイル名が出て、ファイルが元に戻る
4. 未コミットの変更がある状態 → 「先にコミットしてください」が出る
5. 未保存のエディタ編集がある状態 → 破棄の確認が出て、キャンセルするとマージされない
6. `M` キー（radio にフォーカス）と、マージボタンのどちらでも動く。`Cmd+M` では動かない
7. マージ実行中はトリガーが「マージ中...」になる

- [ ] **Step 4: Commit（ユーザーの許可がある場合のみ）**

```bash
git add ROADMAP.md
git commit -m "docs: ROADMAPにブランチのマージの実装完了を反映する"
```

## Self-Review

**Spec coverage:**

- マージの流れ（ボタン / `M` → 未保存編集の確認 → マージ確認 → main → 成功時に再読込）: Task 3（確認）、Task 4（未保存編集・再読込）、Task 5（ボタン・`M`）
- main の判定 1〜4（許可リスト・detached・自身・マージ中・未コミット・merge・失敗時の分岐）: Task 1
- エラー文言 7 種: Task 1（単体テストと統合テストで文言を固定）
- 実行中の表示 `マージ中...` / `ブランチのマージ中`: Task 3（`branchTriggerLabel`）、Task 5（`BranchSwitcher` のテスト）
- キーボード・アクセシビリティ（`tabIndex=-1`・`M` キー・`aria-keyshortcuts="Delete M"`・`aria-label`・32px）: Task 5
- 排他制御（`lockGlobal`・相互排他）: Task 3
- 実機で確認した git の挙動: Task 1 の統合テストで、フック失敗・上書きされる未追跡ファイル・マージ中・未コミットの拒否を固定
- 対象外（方式選択・解決 UI・リモート・ファイルツリー再読込）: Task 6 で ROADMAP に残す

**Placeholder scan:** TBD / TODO なし。すべてのコードステップに実コードを載せた。

**Type consistency:** `mergeBranch(folderPath, branchName): Promise<void>`（main）→ `gitApi.mergeBranch(branchName): Promise<void>` → `useGitBranchOperations.mergeBranch(branchName): Promise<boolean>` → `useAppState.mergeBranch(branchName): Promise<void>` → `onMergeBranch: (branchName) => Promise<void>` → `BranchSwitcherMenu` / `BranchMenuItem` の `onMerge: (branchName) => void`。`BranchOperationKind` の `'merge'` は `branchTriggerLabel` の `Record<BranchOperationKind, …>` が網羅を強制する。
