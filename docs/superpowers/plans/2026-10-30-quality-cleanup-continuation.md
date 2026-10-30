# 品質改善の続き 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development を使い、タスクごとに新しいサブエージェントで実装する。手順は `- [ ]` で管理する。

**Goal:** 振る舞いを変えずに、重複の整理・長い関数の分割・テストの追加・ドキュメントの整備を行う。

**Architecture:** 先に今の振る舞いをテストで固定してから構造を変える。設計書は `docs/superpowers/specs/2026-10-30-quality-cleanup-continuation-design.md`。

**Tech Stack:** Electron、React、TypeScript、Vitest、Testing Library

## Global Constraints

- 作業場所は `<repo-root>/.worktrees/api-improve`(ブランチ `claude/api-improve-2026-10-30`)。新しい worktree・ブランチは作らない。
- **コミットしない。** コミットは後の `/commit-ja` で行う。
- `git checkout`・`git restore`・`git stash`・`git reset` を使わない(同じ作業ツリーに未コミットの作業がある。L-200)。
- `node_modules` はメインのチェックアウトへのシンボリックリンク。何も置かない・書き換えない。
- 報告や中間ファイルはリポジトリの外(統括側が示す scratchpad)に置く。
- `prettier --write` は変更したファイルだけに行う。`npm run format` は使わない。
- 既存のテストの期待値を変えない。テストのために実装を変えない。`/* v8 ignore */` を足さない。
- 型だけの import は `import type`。関数には戻り値の型を書く。コメントは周りの密度・文体に合わせて日本語で書く。
- テストの一時ディレクトリの再帰削除は `removeTempPath`・`removeTempPathSync`(`src/shared/__tests__/helpers/tempDirGuard.ts`)を通す(L-618)。
- `setTimeout`・`setInterval` を使うモックは ID を控えて `afterEach` で止める。`act(...).then(...)` の形で書かない。
- テスト名は日本語で「条件 → 結果」が分かるように書く。
- 統括側は各タスクの後に `git diff --stat` と該当のテストの再実行で報告を確かめ(L-065)、`git diff` を scratchpad に控える(L-200)。
- 検証は担当分のテストと、変更したファイルへの `npx eslint <パス> --max-warnings 0`、`npm run typecheck`。全体のテストは統括側がタスク 8 で走らせる。

---

### タスク 1: 設定フックの共通化(R1)

**Files:**
- Create: `src/renderer/src/hooks/useSavedSetting.ts`
- Create: `src/renderer/src/hooks/__tests__/useSavedSetting.test.ts`
- Modify: `src/renderer/src/hooks/useExecutionMode.ts`
- Modify: `src/renderer/src/hooks/useAgentCliKind.ts`
- Test: `src/renderer/src/hooks/__tests__/useExecutionMode.test.ts`、`useAgentCliKind.test.ts`

**Interfaces:**
- Produces: `useSavedSetting<TValue, TLoaded>(options: UseSavedSettingOptions<TValue, TLoaded>): SavedSettingState<TValue>`

- [ ] **手順 1: 今の振る舞いを固定するテストを既存の 2 つのテストファイルに足す**

`useExecutionMode.test.ts` に次を足す。`useAgentCliKind.test.ts` にも同じ観点を足す(`getAgentCliKind` は `{ kind, fallback }` を返す。`kind` の値はファイルの既存のテストと型に合わせる。3 回続けて変更する観点は、読み込みの初期値を `'copilot'` にして `'claude'`・`'copilot'`・`'claude'` の順に変更して書く。加えて、読み込みが失敗して `fallback` が `'read-failed'` のとき、保存に失敗しても `fallback` が残ることを固定する)。

```ts
function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
} {
  let resolve = (): void => undefined
  let reject = (_err: Error): void => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

it('読み込みの失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const err = new Error('broken')
  mockGet.mockRejectedValueOnce(err)
  const { result } = renderHook(() => useExecutionMode())
  await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
  expect(consoleSpy).toHaveBeenCalledTimes(1)
  expect(consoleSpy).toHaveBeenCalledWith('[useExecutionMode] getPromptExecutionMode failed:', err)
})

it('保存の失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const err = new Error('broken')
  mockGet.mockResolvedValueOnce('agent-cli')
  mockSet.mockRejectedValueOnce(err)
  const { result } = renderHook(() => useExecutionMode())
  await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
  await act(async () => {
    await result.current.changeMode('legacy')
  })
  expect(consoleSpy).toHaveBeenCalledWith('[useExecutionMode] setPromptExecutionMode failed:', err)
})

it('アンマウントの後に読み込みが終わる → 失敗でも記録は 1 回で、state は変えない', async () => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  let rejectLoad = (_err: Error): void => undefined
  mockGet.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectLoad = reject
    })
  )
  const { result, unmount } = renderHook(() => useExecutionMode())
  unmount()
  await act(async () => {
    rejectLoad(new Error('broken'))
    await Promise.resolve()
  })
  expect(consoleSpy).toHaveBeenCalledTimes(1)
  expect(result.current.mode).toBeNull()
})

it('読み込みの完了の前に変更する → 後から届いた読み込みの結果が上書きする(今の振る舞い)', async () => {
  let resolveLoad = (_mode: PromptExecutionMode): void => undefined
  mockGet.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveLoad = resolve
    })
  )
  mockSet.mockResolvedValueOnce(undefined)
  const { result } = renderHook(() => useExecutionMode())
  await act(async () => {
    await result.current.changeMode('legacy')
  })
  expect(result.current.mode).toBe('legacy')
  await act(async () => {
    resolveLoad('agent-cli')
    await Promise.resolve()
  })
  expect(result.current.mode).toBe('agent-cli')
})

it('3 回続けて変更し、最後の保存の成功の後で最初の保存が失敗する → 変更前の値へ戻す(今の振る舞い)', async () => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mockGet.mockResolvedValueOnce('agent-cli')
  const first = deferred()
  const second = deferred()
  const third = deferred()
  mockSet
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise)
  const { result } = renderHook(() => useExecutionMode())
  await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
  let firstResult: Promise<boolean> = Promise.resolve(true)
  let secondResult: Promise<boolean> = Promise.resolve(true)
  let thirdResult: Promise<boolean> = Promise.resolve(true)
  act(() => {
    firstResult = result.current.changeMode('legacy')
    secondResult = result.current.changeMode('agent-cli')
    thirdResult = result.current.changeMode('legacy')
  })
  second.resolve()
  third.resolve()
  await act(async () => {
    await Promise.all([secondResult, thirdResult])
  })
  expect(result.current.mode).toBe('legacy')
  first.reject(new Error('broken'))
  await act(async () => {
    await expect(firstResult).resolves.toBe(false)
  })
  // 最後に保存できたのは legacy だが、画面は最初の変更の前の値に戻る
  expect(result.current.mode).toBe('agent-cli')
  expect(result.current.saveError).not.toBeNull()
})
```

- [ ] **手順 2: 今の実装で通ることを確かめる**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts`
Expected: すべて PASS。通らなければ、テストの期待を今の実装に合わせて直す(実装は変えない)。

- [ ] **手順 3: `useSavedSetting.ts` を作る**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { SETTINGS_FILE_ERROR_REASON } from '../lib/settingsMessages'

// 選択式の設定(実行方式・エージェント CLI)の読み込みと保存。変更は楽観的に反映して保存し、失敗したら変更の前の値へ戻す。
// useBooleanSetting とは別にしている: あちらは最後に保存できた値へ戻し、後の変更が始まっていれば戻さない(L-406)ので、
// 続けて変更したときの結果が異なる

export interface UseSavedSettingOptions<TValue, TLoaded> {
  /** 保存された値を読む(描画をまたいで同じ参照を渡す) */
  load: () => Promise<TLoaded>
  /** 読み込みの結果から設定の値を取り出す(描画をまたいで同じ参照を渡す) */
  readValue: (loaded: TLoaded) => TValue
  /** 保存する(描画をまたいで同じ参照を渡す) */
  save: (next: TValue) => Promise<void>
  /** 読み込みに失敗したときの値 */
  defaultValue: TValue
  /** 保存の失敗の文言の接頭辞。後ろに固定の理由(SETTINGS_FILE_ERROR_REASON)を付ける */
  saveErrorPrefix: string
  /** 読み込みの失敗の記録の見出し(console.error の第 1 引数の完全な文字列) */
  loadLogLabel: string
  /** 保存の失敗の記録の見出し(console.error の第 1 引数の完全な文字列) */
  saveLogLabel: string
  /** 読み込みが終わったとき。値の反映と同じ描画に載る(描画をまたいで同じ参照を渡す) */
  onLoaded: (loaded: TLoaded) => void
  /** 読み込みに失敗したとき。既定値の反映と同じ描画に載る(描画をまたいで同じ参照を渡す) */
  onLoadFailed: () => void
  /** 保存に成功したとき(描画をまたいで同じ参照を渡す) */
  onSaved: () => void
}

export interface SavedSettingState<TValue> {
  /** 読み込みが終わるまでは null */
  value: TValue | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** 選んですぐ保存する。失敗したら変更の前の値に戻し、false を返す */
  change: (next: TValue) => Promise<boolean>
}

export function useSavedSetting<TValue, TLoaded>({
  load,
  readValue,
  save,
  defaultValue,
  saveErrorPrefix,
  loadLogLabel,
  saveLogLabel,
  onLoaded,
  onLoadFailed,
  onSaved
}: UseSavedSettingOptions<TValue, TLoaded>): SavedSettingState<TValue> {
  const [value, setValue] = useState<TValue | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const valueRef = useRef<TValue | null>(null)

  useEffect(() => {
    let cancelled = false
    load()
      .then((loaded) => {
        if (cancelled) return
        const loadedValue = readValue(loaded)
        valueRef.current = loadedValue
        setValue(loadedValue)
        onLoaded(loaded)
      })
      .catch((err) => {
        console.error(loadLogLabel, err)
        if (cancelled) return
        valueRef.current = defaultValue
        setValue(defaultValue)
        onLoadFailed()
      })
    return () => {
      cancelled = true
    }
  }, [load, readValue, defaultValue, loadLogLabel, onLoaded, onLoadFailed])

  const change = useCallback(
    async (next: TValue): Promise<boolean> => {
      const previous = valueRef.current
      valueRef.current = next
      setValue(next)
      setSaveError(null)
      try {
        await save(next)
        onSaved()
        return true
      } catch (err) {
        // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、理由は固定の文言にする
        console.error(saveLogLabel, err)
        valueRef.current = previous
        setValue(previous)
        setSaveError(`${saveErrorPrefix}${SETTINGS_FILE_ERROR_REASON}`)
        return false
      }
    },
    [save, saveErrorPrefix, saveLogLabel, onSaved]
  )

  return { value, saveError, change }
}
```

- [ ] **手順 4: `useExecutionMode.ts` を差し替える**

`ExecutionModeState` と `EXECUTION_MODE_SAVE_ERROR_PREFIX` はそのまま残し、本体を次にする。`react` と `SETTINGS_FILE_ERROR_REASON` の import を消し、`import { useSavedSetting } from './useSavedSetting'` を足す。

```ts
const readLoadedMode = (loaded: PromptExecutionMode): PromptExecutionMode => loaded
const noop = (): void => undefined

export function useExecutionMode(): ExecutionModeState {
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getPromptExecutionMode,
    readValue: readLoadedMode,
    save: settingsApi.setPromptExecutionMode,
    defaultValue: DEFAULT_PROMPT_EXECUTION_MODE,
    saveErrorPrefix: EXECUTION_MODE_SAVE_ERROR_PREFIX,
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定の方式で続ける
    loadLogLabel: '[useExecutionMode] getPromptExecutionMode failed:',
    saveLogLabel: '[useExecutionMode] setPromptExecutionMode failed:',
    onLoaded: noop,
    onLoadFailed: noop,
    onSaved: noop
  })
  return { mode: value, saveError, changeMode: change }
}
```

- [ ] **手順 5: `useAgentCliKind.ts` を差し替える**

`AgentCliKindState` と冒頭のコメントはそのまま残し、本体を次にする。import は `import { useCallback, useState } from 'react'` にし、`import { useSavedSetting } from './useSavedSetting'` を足し、`SETTINGS_FILE_ERROR_REASON` の import を消す。

```ts
const readLoadedKind = (loaded: AgentCliKindSetting): AgentCliKind => loaded.kind

export function useAgentCliKind(): AgentCliKindState {
  const [fallback, setFallback] = useState<AgentCliKindSetting['fallback']>(null)
  const onLoaded = useCallback((loaded: AgentCliKindSetting): void => {
    setFallback(loaded.fallback)
  }, [])
  const onLoadFailed = useCallback((): void => setFallback('read-failed'), [])
  // 選び直して保存できたので、既定に戻した旨は消す
  const onSaved = useCallback((): void => setFallback(null), [])
  const { value, saveError, change } = useSavedSetting({
    load: settingsApi.getAgentCliKind,
    readValue: readLoadedKind,
    save: settingsApi.setAgentCliKind,
    defaultValue: DEFAULT_AGENT_CLI_KIND,
    saveErrorPrefix: AGENT_CLI_KIND_SAVE_ERROR_PREFIX,
    // main は投げない(壊れた値は既定に戻して理由を返す)が、IPC が失敗したら既定で続け、読めなかった旨を出す
    loadLogLabel: '[useAgentCliKind] getAgentCliKind failed:',
    saveLogLabel: '[useAgentCliKind] setAgentCliKind failed:',
    onLoaded,
    onLoadFailed,
    onSaved
  })
  return { kind: value, fallback, saveError, changeKind: change }
}
```

- [ ] **手順 6: `useSavedSetting.test.ts` を書く**

次を固定する。オプションのオブジェクトはテストごとに `renderHook` の外で 1 つ作り、`load`・`save`・`onLoaded`・`onLoadFailed`・`onSaved` は `vi.fn()`、`readValue` は定数の関数にする(インラインで作ると毎描画で effect が走る)。失敗の経路のテストは `console.error` を spy で黙らせ、`afterEach` で `mockRestore` する。

- 再描画(`rerender()` を 2 回)しても `load` は 1 回しか呼ばれない。
- 読み込みの成功 → `onLoaded` に読み込みの結果がそのまま渡り、`value` は `readValue` の結果。`onLoadFailed` は呼ばれない。
- 読み込みの失敗 → `onLoadFailed` が 1 回呼ばれ、`value` は `defaultValue`。
- アンマウントの後に読み込みが成功 → `onLoaded` を呼ばない。アンマウントの後に読み込みが失敗 → `console.error` は 1 回、`onLoadFailed` は呼ばない。
- 保存の成功 → `onSaved` が 1 回。保存の失敗 → `onSaved` は呼ばず、`value` は変更の前の値、`saveError` は `saveErrorPrefix + SETTINGS_FILE_ERROR_REASON`(例外の文言を含まない)、戻り値は `false`。
- 次の保存を始めた時点で `saveError` が `null` に戻る。

- [ ] **手順 7: テストと lint と型チェック**

Run: `npx vitest run src/renderer/src/hooks/__tests__/useSavedSetting.test.ts src/renderer/src/hooks/__tests__/useExecutionMode.test.ts src/renderer/src/hooks/__tests__/useAgentCliKind.test.ts`
Run: `npx eslint src/renderer/src/hooks/useSavedSetting.ts src/renderer/src/hooks/useExecutionMode.ts src/renderer/src/hooks/useAgentCliKind.ts src/renderer/src/hooks/__tests__ --max-warnings 0`
Run: `npm run typecheck`
Expected: すべて通る。手順 1 で足したテストの期待値を手順 4・5 の後に変えていない。

---

### タスク 2: `registerGitHandlers` の分割(R2)

**Files:**
- Create: `src/main/handlers/gitPayloadParser.ts`
- Modify: `src/main/handlers/gitHandlers.ts`
- Test: `src/main/__tests__/handlers/gitHandlers.test.ts`

- [ ] **手順 1: チャンネルの一覧を固定するテストを足す**

`gitHandlers.test.ts` の既存の `ipcMain` のモックの使い方に合わせて、`registerGitHandlers` の後に登録されたチャンネルを集め、次の 37 件と一致すること(順序は問わない・重複なし)を確かめるテストを足す。

```ts
const GIT_CHANNELS = [
  'git:abortMerge', 'git:addOrigin', 'git:amendCommit', 'git:checkoutBranch', 'git:commit',
  'git:completeMerge', 'git:createBranch', 'git:createTag', 'git:deleteBranch', 'git:discardAll',
  'git:discardChanges', 'git:discardHunk', 'git:fetch', 'git:getBranches', 'git:getConflictFile',
  'git:getDiff', 'git:getLog', 'git:getStashes', 'git:getStatus', 'git:getTags', 'git:init',
  'git:keepConflictFile', 'git:markConflictResolved', 'git:mergeBranch', 'git:pull', 'git:push',
  'git:pushSetUpstream', 'git:removeConflictFile', 'git:resolveConflictBlocks',
  'git:resolveConflictWholeFile', 'git:stage', 'git:stageHunk', 'git:stashDrop', 'git:stashPop',
  'git:stashPush', 'git:unstage', 'git:unstageHunk'
]
```

- [ ] **手順 2: 今の実装で通ることを確かめる**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts`
Expected: PASS

- [ ] **手順 3: `gitPayloadParser.ts` へ検証を移す**

`gitHandlers.ts` の `MAX_CONFLICT_ENTRIES` と `assert*Arg` の関数(コメントごと)を、中身を変えずに移して `export` する。検証だけが使う import(`isOneOf`・`isPlainObject`・`CONFLICT_CHOICES`・`TAG_KINDS`・`ConflictChoice`・`CreateTagRequest`・`DiscardAllEntry` など)も移す。`gitHandlers.ts` は `./gitPayloadParser` から import する。

- [ ] **手順 4: 受け口を 6 つの関数へ分ける**

`ipcMain.handle(...)` の呼び出しの本体は 1 文字も変えず、次の関数へ移す。各関数のシグネチャは `(ipcMain: IpcMain, folderAccess: FolderAccessManager): void`。受け口の間のコメントも一緒に移す。

```ts
export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  registerGitWorkingTreeHandlers(ipcMain, folderAccess)
  registerGitConflictHandlers(ipcMain, folderAccess)
  registerGitHistoryHandlers(ipcMain, folderAccess)
  registerGitBranchHandlers(ipcMain, folderAccess)
  registerGitStashHandlers(ipcMain, folderAccess)
  registerGitRemoteHandlers(ipcMain, folderAccess)
}
```

割り振り:

- `registerGitWorkingTreeHandlers`: getStatus・stage・unstage・discardChanges・discardHunk・discardAll・getDiff・stageHunk・unstageHunk
- `registerGitConflictHandlers`: getConflictFile・resolveConflictBlocks・resolveConflictWholeFile・keepConflictFile・removeConflictFile・markConflictResolved・completeMerge・abortMerge
- `registerGitHistoryHandlers`: commit・amendCommit・getLog・getBranches・getTags・createTag
- `registerGitBranchHandlers`: checkoutBranch・createBranch・deleteBranch・mergeBranch
- `registerGitStashHandlers`: getStashes・stashPush・stashPop・stashDrop
- `registerGitRemoteHandlers`: push・pull・fetch・init・addOrigin・pushSetUpstream

- [ ] **手順 5: 検証**

Run: `npx vitest run src/main/__tests__/handlers/gitHandlers.test.ts src/main/__tests__/ipcHandlers.test.ts`
Run: `npx eslint src/main/handlers src/main/__tests__/handlers/gitHandlers.test.ts --max-warnings 0`
Run: `npm run typecheck`
Expected: すべて通る。既存のテストの期待値は変えていない。`git diff --stat` で `gitHandlers.ts` の変更が移動の分だけであること(`git diff --color-moved=zebra` の確認でよい)。

---

### タスク 3: `runFolderOpen` の分割(R3)

**Files:**
- Modify: `src/renderer/src/hooks/useFileSystem.ts`
- Test: 既存の `src/renderer/src/hooks/__tests__/useFileSystem*.test.ts*`

- [ ] **手順 0: 移動の前の分岐カバレッジを控える**

Run: `npx vitest run useFileSystem --coverage --coverage.reporter=text --coverage.reportsDirectory=$AGENT_TMP--worktrees-api-improve/b9a68b3a-d602-47e8-b21a-46d86eae0c84/scratchpad/cov-fs --coverage.include=src/renderer/src/hooks/useFileSystem.ts`
数値(`% Branch`)と未通過の行を報告に書く。

- [ ] **手順 1: `catch` の内側を関数にする**

`runFolderOpen` の定義の前に次を足し、`catch` の `if (selectedPath !== null) { … }`(`setFolderPath` から `closeAllTabsForFolderChange` まで)を移す。コメントも移す。

```ts
  // 走査に失敗しても、選択済みのフォルダは確定させる
  const commitFolderAfterScanFailure = (
    selectedPath: string,
    committedOpenAtStart: number | null,
    dirtyBaseline: DirtyBaseline | null
  ): void => {
    // ここへ移す: useFileSystem.ts の catch の if (selectedPath !== null) の内側をそのまま
  }
```

`catch` の側は次にする。`if` のあとの `const failure = toError(err)` 以降は変えない。

```ts
      if (selectedPath !== null) {
        commitFolderAfterScanFailure(selectedPath, committedOpenAtStart, dirtyBaseline)
      }
```

- [ ] **手順 2: `finally` の内側を関数にする**

`runFolderOpen` の定義の前に `const retryRefreshSkippedDuringScan = async (): Promise<void> => { … }` を足し、`finally` の `if (pendingFolderOpenRef.current === 0 && refreshSkippedRef.current) { … }` の内側(`refreshSkippedRef.current = false` と `try`〜`catch`)をそのまま移す。`finally` の側は次にする。`if` の判定と、その前のコメントは `finally` に残す。

```ts
      if (pendingFolderOpenRef.current === 0 && refreshSkippedRef.current) {
        await retryRefreshSkippedDuringScan()
      }
```

- [ ] **手順 3: 検証**

Run: `npx vitest run useFileSystem`
Run: `npx eslint src/renderer/src/hooks/useFileSystem.ts --max-warnings 0`
Run: `npm run typecheck`
Expected: すべて通る。テストファイルは変更しない。手順 0 と同じコマンドの `% Branch` が下がっていない(移した 2 つの関数の中の行が未通過に増えていない)。

---

### タスク 4: 型の重複と小さな重複の整理(R4・R5)

**Files:**
- Modify: `src/renderer/src/components/source-control/GitRepoView.tsx`
- Modify: `src/renderer/src/components/source-control/SourceControlPanel.tsx`
- Modify: `src/renderer/src/components/explorer/ExplorerPanel.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/lib/promptRunAvailability.ts`
- Modify: `src/renderer/src/hooks/useGitRemoteOperations.ts`
- Modify: `src/renderer/src/components/source-control/AgentChangesSection.tsx`

- [ ] **手順 1: props の型を継承にする**

```ts
// GitRepoView.tsx
export interface GitRepoViewProps { /* 今の Props の中身そのまま */ }

// SourceControlPanel.tsx(GitRepoViewProps は import type)
export interface SourceControlPanelProps
  extends Omit<
    GitRepoViewProps,
    'branch' | 'ahead' | 'behind' | 'files' | 'remoteSetupKind' | 'requestRemoteSetupFocus'
  > {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
  operationError: Error | null
  isPushing: boolean
  isPulling: boolean
  isFetching: boolean
  isPushBlocked: boolean
  isPullBlocked: boolean
  isRemoteOperationDisabled: boolean
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onFetch: () => Promise<void>
  remoteOperationError: Error | null
  branchOperationError: Error | null
}

// ExplorerPanel.tsx
export interface ExplorerPanelProps { /* 今の Props の中身そのまま */ }

// Sidebar.tsx(2 つの型は import type)
interface Props
  extends Omit<ExplorerPanelProps, 'onAddReference'>,
    Omit<
      SourceControlPanelProps,
      | 'branchOperationError'
      | 'onDiscard'
      | 'onRefresh'
      | 'onStage'
      | 'onUnstage'
      | 'operationError'
      | 'remoteOperationError'
    > {
  /* どちらの親にも無い props だけを残す */
}
```

`GitRepoViewProps` の `remoteSetup`・`agentChanges` の説明は、`GitRepoView` 側と `SourceControlPanel` 側の両方の文を連結して残す(どちらにしか無い情報を落とさない)。`Sidebar` の `remoteSetup`・`agentChanges`・`clone` の説明は、親の宣言と重複するので消してよい。`GitRepoView` に宣言の無い props(上の一覧にあるもの)が `SourceControlPanelProps` の本体に残ることを `npm run typecheck` で確かめる。使わなくなった型の import を消す。

- [ ] **手順 2: 実行条件の引数の型をまとめる**

`promptRunAvailability.ts` に次を足し、`getPromptRunAvailability(params: AgentRunConditions)`、`getHistoryRerunAvailability(params: AgentRunConditions & { recordedFolderPath: string | null; folderPath: string | null })` にする。フィールドの説明のコメントは `AgentRunConditions` へ移す。

```ts
/** 実行ボタンを押せるかの判定に使う状態 */
export interface AgentRunConditions {
  mode: PromptExecutionMode | null
  isExecuting: boolean
  cliKind: AgentCliKind
  isSessionRunning: boolean
  isSessionClosing: boolean
  isSending: boolean
  activity: AgentActivity
  isInterrupting: boolean
}
```

- [ ] **手順 3: `useGitRemoteOperations.ts` の `isBusy` をまとめる**

`push` の定義の前に次を足し、`push`・`pushSetUpstream` の `isBusy` を `isBusy: isPushUnavailable` にする。`push` の前の長いコメントは `isPushUnavailable` の前へ移す。

```ts
  const isPushUnavailable = (): boolean =>
    isPushingRef.current ||
    isPullingRef.current ||
    lock.isAnyLocked() ||
    isRemoteOperationDisabled
```

- [ ] **手順 4: `AgentChangesSection.tsx` のボタンをまとめる**

同じファイルの中に次を足し、2 か所の `<div className="agent-changes__actions">…</div>` を `<BeginRecordingButton isBeginning={changes.isBeginning} label="いまから記録する" onBegin={beginRecording} />`(もう一方は `label="もう一度試す"`)にする。`beginRecording` は `AgentChangesSection` の中に `const beginRecording = (): void => { reserveFocusRestore(); void changes.begin() }` と定義する。

```tsx
function BeginRecordingButton({
  isBeginning,
  label,
  onBegin
}: {
  isBeginning: boolean
  label: string
  onBegin: () => void
}): React.JSX.Element {
  return (
    <div className="agent-changes__actions">
      <button
        type="button"
        className="agent-changes__button"
        disabled={isBeginning}
        onClick={onBegin}
      >
        {isBeginning ? '記録しています…' : label}
      </button>
    </div>
  )
}
```

戻り値の型の書き方は同じファイルの既存の部品に合わせる。

- [ ] **手順 5: 検証**

Run: `npx vitest run src/renderer/src/components src/renderer/src/lib/__tests__/promptRunAvailability.test.ts src/renderer/src/hooks/__tests__/useGitRemoteOperations`
Run: `npx eslint src/renderer/src/components src/renderer/src/lib/promptRunAvailability.ts src/renderer/src/hooks/useGitRemoteOperations.ts --max-warnings 0`
Run: `npm run typecheck`
Expected: すべて通る。テストファイルは変更しない。

---

### タスク 5: main のテストの追加

**Files:**
- Test: `src/main/__tests__/gitCloneProcess.test.ts`
- Test: `src/main/__tests__/agentChangesProtectionRef.test.ts`
- Create: `src/main/__tests__/agentChangesQuery.test.ts`(単体テスト。既存の `agentChangesQuery.integration.test.ts` は変えない)

未通過の分岐(今の行番号)。それぞれの行を読み、**実際に到達できる分岐**にテストを足す。

- `gitCloneProcess.ts`: 72 行(`win32` の `taskkill`。`process.platform` を差し替え、`spawn` のモックで引数を確かめ、`killer` の `error` で例外にならない。`process.platform` は `afterEach` で戻す)、117 行(同期の throw が `Error` でない値)、142 行(既に閉じているときの `stop`)、154 行(`stopReason` があるときの `resetIdleTimer`)。
- `agentChangesProtectionRef.ts`: 60・66・136・151・214・232 行の `if`。
- `agentChangesQuery.ts`: 29・40・77・93・128・202・248・250・268・270・273・325 行の分岐と、127 行の無名関数。

- [ ] **手順 1: 各ファイルの該当の行を読み、テストを足す。** 既存のテストのモックの作り方を流用する。期待値は今の実装の振る舞いにする。
- [ ] **手順 2: 担当のテストを走らせる。** Run: `npx vitest run src/main/__tests__/gitCloneProcess src/main/__tests__/agentChangesProtectionRef src/main/__tests__/agentChangesQuery`。Expected: PASS
- [ ] **手順 3: 足した分岐が通ったかを確かめる。** Run: `npx vitest run src/main/__tests__/gitCloneProcess src/main/__tests__/agentChangesProtectionRef src/main/__tests__/agentChangesQuery --coverage --coverage.reporter=text --coverage.reportsDirectory=$AGENT_TMP--worktrees-api-improve/b9a68b3a-d602-47e8-b21a-46d86eae0c84/scratchpad/cov-main --coverage.include=src/main/gitCloneProcess.ts --coverage.include=src/main/agentChangesProtectionRef.ts --coverage.include=src/main/agentChangesQuery.ts`
- [ ] **手順 4: 到達できなかった分岐を、行番号と理由(どの前提で到達できないか)つきで報告する。** 不具合らしいものを見つけたら直さず報告する。
- [ ] **手順 5: `npx eslint src/main/__tests__ --max-warnings 0` と `npm run typecheck` を通す。**

---

### タスク 6: renderer のテストの追加

**Files:**
- Test: `src/renderer/src/components/output/__tests__/MarkdownRenderer.test.tsx`
- Test: `src/renderer/src/components/settings/__tests__/ModelSettingsSection.test.tsx`
- Create: `src/renderer/src/hooks/__tests__/useAgentDiffFocusRestore.test.ts`
- Create: `src/renderer/src/hooks/__tests__/useRunExclusiveGitOperation.test.ts`

- [ ] **手順 1: 既存のファイルへ足す。** `MarkdownRenderer.tsx` は 22・33・35 行の `binary-expr`(省略時のフォールバックの側)。`ModelSettingsSection.tsx` は 29 行(保存された `modelId` が `AVAILABLE_MODELS` に無い → 先頭のモデルの上限を使う)と 40 行(一覧に無い値を `fireEvent.change` で送る → 何も変えない。jsdom では `select.value` が `''` になる)。

- [ ] **手順 2: `useAgentDiffFocusRestore.test.ts` を作る。** 次を固定する。

  - 予約の無い描画ではフォーカスを動かさない。
  - 予約の後、`document.activeElement` が `body` → パネルの中の `[role="tab"][aria-selected="true"]` にフォーカスする。
  - 予約の後、パネルの中の無効化されたボタンにフォーカスがある → 選択中のタブへ移す。
  - 予約の後、選択中のタブが無い → 予約を解除する(以後の描画で動かさない)。
  - 予約の後、利用者がパネルの外へフォーカスを移した → 奪わず、予約を解除する。
  - 予約の後の `pointerdown`・`keydown` → 予約を解除する。
  - `reserveFocusRestore` を 2 回呼ぶ → リスナーは 1 組だけ(`document.addEventListener` の spy の呼び出しが 2 回)。
  - アンマウント → リスナーを外す。

  各ケースの流れは「`div` を `document.body` に append(jsdom は文書に無い要素へ `focus()` できない)→ `result.current.panelRef.current = div` → `reserveFocusRestore()` → `rerender()`(effect は描画の後にだけ走り、予約は state を変えない)→ 確かめる」。`afterEach` で `div` を取り除く。実際のファイルのエクスポートと引数を先に読んで合わせる。

- [ ] **手順 3: `useRunExclusiveGitOperation.test.ts` を作る。** 次を固定する。

  - `isBusy` が true → `execute`・`setBusy` を呼ばず `false`。
  - 成功 → 呼び出し順が `setBusy(true)`・`onStart`・`execute`・`setError(null)`・`refresh`・`setBusy(false)`・`onEnd`、戻り値 `true`。
  - `execute` の失敗 → `setError` に `Error`、`refresh` は呼ばれる、戻り値 `false`。`Error` でない値は `toError` の結果。
  - `refresh` の失敗 → 例外を出さず、`setBusy(false)`・`onEnd` は呼ばれ、`execute` の成否は変わらない(`setError` を上書きしない)。
  - `onStart`・`onEnd` は省略できる。

- [ ] **手順 4: 検証。** Run: `npx vitest run src/renderer/src/components/output src/renderer/src/components/settings/__tests__/ModelSettingsSection.test.tsx src/renderer/src/hooks/__tests__/useAgentDiffFocusRestore.test.ts src/renderer/src/hooks/__tests__/useRunExclusiveGitOperation.test.ts`。`npx eslint src/renderer/src --max-warnings 0`。`npm run typecheck`。Expected: すべて通る。

---

### タスク 7: ドキュメントの整備

**Files:**
- Modify: `docs/developer-guide.md`
- Modify: `README.md`

- [ ] **手順 1: `docs/developer-guide.md` の「3. 主要な流れ」に次を足す。**

  - 3.5 として「設定の読み書きのフック」: 選択式は `useSavedSetting`(失敗したら変更の前の値へ戻す)、真偽値は `useBooleanSetting`(最後に保存できた値へ戻し、後の変更が始まっていれば戻さない)。両者が別である理由。オプションの関数は参照を安定させること。
  - 3.1 の受け口の説明に、`handlers/gitHandlers.ts` は領域ごとの `registerGit*Handlers` に分かれ、引数の検証は `handlers/gitPayloadParser.ts` にあることを足す。

- [ ] **手順 2: `README.md` の主要なモジュールの節に、`useSavedSetting`・`gitPayloadParser` を足す**(節の既存の粒度に合わせる。粒度に合わなければ足さない)。

- [ ] **手順 3: パスの実在を確かめる。** `README.md` と `docs/developer-guide.md` にバッククォートで書かれた、`src/`・`docs/`・`scripts/`・`hooks/`・`lib/`・`handlers/` で始まるパスと、`.ts`・`.tsx`・`.md`・`.mjs` で終わる名前を抜き出し、`src`・`docs`・`scripts`・リポジトリ直下に実在するかを確かめる。ずれていれば実在するものへ直す。使ったスクリプトはリポジトリの外に置く。

- [ ] **手順 4: 検証。** Run: `npx prettier --check README.md docs/developer-guide.md`。Expected: 通る。

---

### タスク 8: 全体の検証(統括側が行う)

機能の追加が無いので、`docs/manual-test-spec.md`・`ROADMAP.md`・Artifact は更新しない(設計書の「決めたこと」)。

- [ ] `npm run typecheck`
- [ ] `npx eslint . --max-warnings 0`
- [ ] `npx vitest run --testTimeout=30000`(実 git の統合テストが落ちたら、そのファイルを単独で流して判断する)
- [ ] `npm run build`
- [ ] `git status --short` に `node_modules`・作業ログが出ていないことを確かめる。
- [ ] PR の「要確認事項」に載せる内容を `.claude/dev-flow/review-log.md` の先頭へ控える: `apiKey` が文字列でないと `TypeError`、`environmentMatchGlobs` が効かない、`useExecutionMode`・`useAgentCliKind` の続けて変更したときの巻き戻し、読み込みの完了の前の変更の上書き、タスク 5・6 で見つけたもの。
