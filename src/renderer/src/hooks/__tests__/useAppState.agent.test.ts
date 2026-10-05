// useAppState の実行方式とエージェントの組み立てのテスト(useAppState.test.ts から分けた。モックの準備は同じ)。
// 実行方式とエージェントは useAgentWorkspace を型付きの偽物(makeAgentWorkspaceState)で差し替え、useAppState が渡す値と
// 公開する値だけを確かめる。実行方式の切り替えの安全・確認・実行ボタンの状態の組み立ては useAgentWorkspace.test.ts と
// promptRunState.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { GitStatusResult } from '@shared/types'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import type { DiffTabKey } from '../useDiffTabs'
import type { ApplyOpenedFolderOptions } from '../useFileSystem'
import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'
import { makeCloneRepositoryPanelState } from '../../__tests__/makeCloneRepositoryPanelState'

const mockUsePanelState = vi.hoisted(() =>
  vi.fn(() => ({
    activePanel: 'explorer' as const,
    sidebarOpen: true,
    handlePanelChange: vi.fn()
  }))
)

const mockUseFileSystem = vi.hoisted(() =>
  vi.fn(
    (): {
      folderPath: string | null
      fileTree: unknown[]
      openFile: null
      openedFileSignal: { events: unknown[] }
      error: null
      openFolder: () => void
      selectFile: () => void
      activateTab: (path: string) => void
      saveFile: () => Promise<void>
      createFile: (parentPath: string, name: string) => Promise<void>
      createDirectory: (parentPath: string, name: string) => Promise<void>
      renameEntry: (node: unknown, newName: string) => Promise<void>
      deleteEntry: (node: unknown) => Promise<void>
      confirmDiscardAnyDirty?: () => boolean
      reloadOpenFiles?: () => Promise<void>
      hasDirtyTabAtOrInside?: (absolutePath: string) => boolean
      reloadOpenFile?: (absolutePath: string) => Promise<void>
      closeTabsAtOrInside?: (absolutePath: string) => void
      refreshTree?: () => Promise<boolean>
      captureDirtySnapshot?: () => string
      applyOpenedFolder?: (path: string, options: ApplyOpenedFolderOptions) => Promise<void>
      getOpenFileSnapshot?: (path: string) => unknown
      waitForPendingSave?: (path: string) => Promise<void>
      replaceCleanTabWithDisk?: (path: string, expected: unknown, disk: string | null) => boolean
    } => ({
      folderPath: null,
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: vi.fn(),
      activateTab: vi.fn(),
      saveFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
  )
)

const mockUsePrompts = vi.hoisted(() =>
  vi.fn(() => ({
    prompts: [],
    addPrompt: vi.fn(),
    deletePrompt: vi.fn()
  }))
)

const mockUseGitStatus = vi.hoisted(() =>
  vi.fn(
    (): {
      gitStatus: GitStatusResult | null
      gitLoading: boolean
      gitError: Error | null
      refreshGitStatus: () => Promise<void>
    } => ({
      gitStatus: null,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
  )
)

const mockUseSettings = vi.hoisted(() =>
  vi.fn(() => ({
    hasKey: false,
    apiKeyLoaded: false,
    keyStoreError: null as string | null,
    saveApiKey: vi.fn()
  }))
)

const mockUsePromptExecution = vi.hoisted(() =>
  vi.fn(() => ({
    isExecuting: false,
    result: null,
    executionError: null,
    executePrompt: vi.fn(),
    clearResult: vi.fn()
  }))
)

const mockUseHistory = vi.hoisted(() =>
  vi.fn(() => ({
    history: [],
    historyLoaded: false,
    addHistoryEntry: vi.fn(),
    deleteHistoryEntry: vi.fn(),
    clearHistory: vi.fn()
  }))
)

const mockUsePromptRunner = vi.hoisted(() =>
  // mock.calls[0][0] で呼び出し引数を検証するため、引数を受け取る型として宣言する
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((_deps?: unknown) => ({
    runPrompt: vi.fn(),
    rerunHistoryEntry: vi.fn()
  }))
)

const mockUseQuickOpen = vi.hoisted(() =>
  // 同上
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((_deps?: unknown) => ({
    isOpen: false,
    query: '',
    results: [],
    activeIndex: 0,
    hasFolder: false,
    open: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    moveSelection: vi.fn(),
    setActiveIndex: vi.fn(),
    confirm: vi.fn()
  }))
)

// useGitHistory はマウント時の useEffect で setState するため、実物のまま呼ぶと
// レンダーが2回走り、他のモックフックの呼び出し回数アサーションが崩れる。
// そのため useDiffTabs とあわせて静的な戻り値のモックに差し替える
const mockUseDiffTabs = vi.hoisted(() =>
  vi.fn(
    (): {
      diffTabs: DiffTabKey[]
      activeDiffTab: DiffTabKey | null
      openDiffTab: (key: DiffTabKey) => void
      closeDiffTab: (key: DiffTabKey) => void
      activateDiffTab: (key: DiffTabKey) => void
      deactivateDiffTab: () => void
    } => ({
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
  )
)

const mockUseGitHistory = vi.hoisted(() =>
  vi.fn(() => ({
    log: [],
    branches: [],
    tags: [],
    hasMore: false,
    isLoading: false,
    loadMore: vi.fn(),
    refresh: vi.fn()
  }))
)

// 退避パネルの組み立て(確認・再読込のラップ)は useStashPanel.test.ts で検証するため、
// ここでは useAppState の配線(依存の受け渡しと戻り値の公開)だけを見る静的モックにする
const mockStashPanel = vi.hoisted(() => ({
  entries: [] as unknown[],
  pendingOperation: null,
  error: null,
  onPush: vi.fn(),
  onPop: vi.fn(),
  onDrop: vi.fn()
}))
const mockUseStashPanel = vi.hoisted(() => vi.fn())

// ハンク・一括の取り消しの組み立ても各フックのテストで検証する。ここでは配線だけを見る静的モックにする
// (既定の実装を持たせるのは、他のテストでも useAppState が呼ぶため)
const mockDiscardHunkFn = vi.hoisted(() => vi.fn())
// mock.calls[0][0] で呼び出し引数を検証するため、引数を受け取る型として宣言する
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockUseDiscardHunk = vi.hoisted(() => vi.fn((_options?: unknown) => mockDiscardHunkFn))
const mockDiscardAllState = vi.hoisted(() => ({
  isDiscarding: false,
  error: null,
  onDiscardAll: vi.fn()
}))
const mockUseDiscardAllChanges = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((_options?: unknown) => mockDiscardAllState)
)

// マージ状態・解決ビューの組み立ても各フックのテストで検証する。ここでは配線だけを見る静的モックにする
const mockMergeStatePanel = vi.hoisted(() => ({
  inProgress: false,
  unresolvedCount: 0,
  pendingOperation: null,
  error: null,
  canComplete: false,
  onComplete: vi.fn(),
  onAbort: vi.fn()
}))
const mockUseMergeState = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((_options?: unknown) => mockMergeStatePanel)
)
const mockConflictFileState = vi.hoisted(() => ({
  file: null,
  isLoading: false,
  error: null,
  pendingOperation: null,
  chooseBlock: vi.fn(),
  resolveWholeFile: vi.fn(),
  keepFile: vi.fn(),
  removeFile: vi.fn(),
  markResolved: vi.fn()
}))
const mockUseConflictFile = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn((_options?: unknown) => mockConflictFileState)
)
// タグの作成の組み立ては useGitTagOperations.test.ts で検証する。ここでは配線だけを見る。
// 戻り値は makeGitTagPanelState から作って渡す(既定値の重複と型なしのモックを避ける。パターン 78)。
// clone の「Git 操作の実行中」の合成が isCreating を読むため、既定の戻り値は beforeEach で毎回設定し、
// 個別のテストは mockReturnValue で上書きする
const mockUseGitTagOperations = vi.hoisted(() =>
  vi.fn<typeof import('../useGitTagOperations').useGitTagOperations>()
)
// 初期化・追加の組み立ては useGitRemoteSetup.test.ts で検証する。ここでは配線(依存の受け渡しと、初回 push の
// 状態との合成)だけを見る。戻り値は makeRemoteSetupPanelState から作って渡す(パターン 78)。
// clone の「Git 操作の実行中」の合成が isInitializing・isAddingOrigin を読むため、既定の戻り値は beforeEach で
// 毎回設定し、個別のテストは mockReturnValue で上書きする
const mockUseGitRemoteSetup = vi.hoisted(() =>
  vi.fn<typeof import('../useGitRemoteSetup').useGitRemoteSetup>()
)
// clone の組み立ては useCloneRepository.test.ts で検証する。ここでは配線(依存の受け渡し・Git 操作の実行中の合成)だけを見る
const mockUseCloneRepository = vi.hoisted(() =>
  vi.fn<typeof import('../useCloneRepository').useCloneRepository>()
)

vi.mock('../useQuickOpen', () => ({ useQuickOpen: mockUseQuickOpen }))
vi.mock('../usePanelState', () => ({ usePanelState: mockUsePanelState }))
vi.mock('../useFileSystem', () => ({ useFileSystem: mockUseFileSystem }))
vi.mock('../usePrompts', () => ({ usePrompts: mockUsePrompts }))
vi.mock('../useGitStatus', () => ({ useGitStatus: mockUseGitStatus }))
vi.mock('../useSettings', () => ({ useSettings: mockUseSettings }))
vi.mock('../usePromptExecution', () => ({ usePromptExecution: mockUsePromptExecution }))
vi.mock('../useHistory', () => ({ useHistory: mockUseHistory }))
vi.mock('../usePromptRunner', () => ({ usePromptRunner: mockUsePromptRunner }))
vi.mock('../useDiffTabs', () => ({ useDiffTabs: mockUseDiffTabs }))
vi.mock('../useGitHistory', () => ({ useGitHistory: mockUseGitHistory }))
vi.mock('../useStashPanel', () => ({ useStashPanel: mockUseStashPanel }))
vi.mock('../useDiscardHunk', () => ({ useDiscardHunk: mockUseDiscardHunk }))
vi.mock('../useDiscardAllChanges', () => ({ useDiscardAllChanges: mockUseDiscardAllChanges }))
vi.mock('../useMergeState', () => ({ useMergeState: mockUseMergeState }))
vi.mock('../useConflictFile', () => ({ useConflictFile: mockUseConflictFile }))
vi.mock('../useGitTagOperations', () => ({ useGitTagOperations: mockUseGitTagOperations }))
vi.mock('../useGitRemoteSetup', () => ({ useGitRemoteSetup: mockUseGitRemoteSetup }))
vi.mock('../useCloneRepository', () => ({ useCloneRepository: mockUseCloneRepository }))
// 外部変更の検知・エージェントの部品は、それぞれのテストで確かめる。ここでは組み立て(渡す値)だけを見る
// mock.calls[0][0] で呼び出し引数を検証するため、引数を受け取る型として宣言する
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockUseExternalFileChanges = vi.hoisted(() => vi.fn((_options?: unknown) => null))
const mockUseAgentWorkspace = vi.hoisted(() =>
  vi.fn<typeof import('../useAgentWorkspace').useAgentWorkspace>()
)
vi.mock('../useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))
vi.mock('../useExternalFileChanges', () => ({ useExternalFileChanges: mockUseExternalFileChanges }))

import { useAppState } from '../useAppState'
import type { ExternalChangeMarks } from '../useExternalChangeMarks'

// useFileSystem・usePromptExecution の既定の実装(個別のテストが mockReturnValue で上書きしても、beforeEach で戻す。パターン 103)
const defaultUseFileSystem = mockUseFileSystem.getMockImplementation()!
const defaultUsePromptExecution = mockUsePromptExecution.getMockImplementation()!
const defaultUseDiffTabs = mockUseDiffTabs.getMockImplementation()!

const FOLDER_CHANGE_CONFIRM =
  'フォルダを切り替えると、実行中のエージェントを終了します。続けますか？'

beforeEach(() => {
  vi.clearAllMocks()
  // clone の「Git 操作の実行中」の合成がタグ・初期化の実行中フラグを読むため、既定の戻り値を毎回設定し直す
  // (前のテストの mockReturnValue を持ち込まない。パターン 103)。個別のテストは mockReturnValue で上書きする
  mockUseGitTagOperations.mockReturnValue(makeGitTagPanelState())
  mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState())
  mockUseCloneRepository.mockReturnValue(makeCloneRepositoryPanelState())
  // 退避の実行中フラグ(stash.pendingOperation)も合成に入るため、退避の既定の戻り値も毎回設定し直す
  mockUseStashPanel.mockReturnValue(mockStashPanel)
  mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  mockUseFileSystem.mockImplementation(defaultUseFileSystem)
  mockUsePromptExecution.mockImplementation(defaultUsePromptExecution)
  mockUseDiffTabs.mockImplementation(defaultUseDiffTabs)
})

describe('useAppState', () => {
  describe('実行方式とエージェント', () => {
    it('useAgentWorkspace に開いているフォルダと従来の方式の実行中を渡す(確認は既定の window.confirm)', () => {
      mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo' })
      mockUsePromptExecution.mockReturnValue({ ...defaultUsePromptExecution(), isExecuting: true })
      renderHook(() => useAppState())
      expect(mockUseAgentWorkspace).toHaveBeenLastCalledWith({
        folderPath: '/repo',
        isExecuting: true
      })
    })

    it('フォルダが無く実行していなければ、そのとおりに渡す', () => {
      renderHook(() => useAppState())
      expect(mockUseAgentWorkspace).toHaveBeenLastCalledWith({
        folderPath: null,
        isExecuting: false
      })
    })

    it('実行方式の項目・実行ボタンの状態・下部のパネル・ターミナルを、useAgentWorkspace の戻り値のまま公開する', () => {
      const workspace = makeAgentWorkspaceState({
        executionModePanel: {
          mode: 'agent-cli',
          saveError: '保存できませんでした',
          isLocked: true,
          lockedReason: '理由',
          onSelect: vi.fn()
        },
        promptRun: { ...makeAgentWorkspaceState().promptRun, isRunDisabled: true },
        bottomPanel: 'agent-terminal'
      })
      mockUseAgentWorkspace.mockReturnValue(workspace)
      const { result } = renderHook(() => useAppState())
      expect(result.current.executionModePanel).toBe(workspace.executionModePanel)
      expect(result.current.promptRun).toBe(workspace.promptRun)
      expect(result.current.bottomPanel).toBe('agent-terminal')
      expect(result.current.agentTerminal).toBe(workspace.agentTerminal)
    })

    it('下部のパネルが none なら none を公開する', () => {
      mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState({ bottomPanel: 'none' }))
      const { result } = renderHook(() => useAppState())
      expect(result.current.bottomPanel).toBe('none')
    })

    it('停止の確認・送信の関数は公開しない(useAppState の中だけで使う)', () => {
      const { result } = renderHook(() => useAppState())
      expect(result.current).not.toHaveProperty('confirmStopAgent')
      expect(result.current).not.toHaveProperty('sendToAgent')
    })

    it.each(['agent-cli', 'legacy', null] as const)(
      'usePromptRunner に実行方式(%s)と useAgentWorkspace の送信の関数を渡す',
      (mode) => {
        const workspace = makeAgentWorkspaceState({
          executionModePanel: { ...makeAgentWorkspaceState().executionModePanel, mode }
        })
        mockUseAgentWorkspace.mockReturnValue(workspace)
        renderHook(() => useAppState())
        const args = mockUsePromptRunner.mock.calls[0][0] as {
          executionMode: unknown
          sendToAgent: unknown
        }
        expect(args.executionMode).toBe(mode)
        expect(args.sendToAgent).toBe(workspace.sendToAgent)
      }
    )

    it('useFileSystem に保存の照合の取り消し・保存の成功の通知を渡し、useExternalFileChanges に開いているタブの操作を渡す', () => {
      // 外部変更の確認が使うタブの操作は、useFileSystem の戻り値そのもの(自分の保存を外部変更と誤認しないための
      // 保存の待ち・読む前の控え・未編集のタブの置き換え・再読込)
      const fileSystem = {
        ...defaultUseFileSystem(),
        getOpenFileSnapshot: vi.fn(() => null),
        waitForPendingSave: vi.fn(async () => undefined),
        replaceCleanTabWithDisk: vi.fn(() => false),
        reloadOpenFile: vi.fn(async () => undefined)
      }
      mockUseFileSystem.mockReturnValue(fileSystem)
      renderHook(() => useAppState())
      expect(mockUseFileSystem.mock.calls[0]).toEqual([
        { onSaveConflict: expect.any(Function), onSaveSucceeded: expect.any(Function) }
      ])
      const options = mockUseExternalFileChanges.mock.calls[0][0] as {
        isFileTabActive: boolean
        getOpenFileSnapshot: unknown
        waitForPendingSave: unknown
        replaceCleanTabWithDisk: unknown
        reloadOpenFile: unknown
      }
      expect(options.isFileTabActive).toBe(true)
      expect(options.getOpenFileSnapshot).toBe(fileSystem.getOpenFileSnapshot)
      expect(options.waitForPendingSave).toBe(fileSystem.waitForPendingSave)
      expect(options.replaceCleanTabWithDisk).toBe(fileSystem.replaceCleanTabWithDisk)
      expect(options.reloadOpenFile).toBe(fileSystem.reloadOpenFile)
    })

    it('diff タブの表示中は useExternalFileChanges に isFileTabActive: false を渡す(通知を出さない)', () => {
      const diffTab = { path: 'a.ts', staged: false }
      mockUseDiffTabs.mockReturnValue({
        ...defaultUseDiffTabs(),
        diffTabs: [diffTab],
        activeDiffTab: diffTab
      })
      renderHook(() => useAppState())
      const options = mockUseExternalFileChanges.mock.calls[0][0] as { isFileTabActive: boolean }
      expect(options.isFileTabActive).toBe(false)
    })

    // 保存の照合で上書きをキャンセルしたときは、印を直接付けず外部変更の確認を通す(確認が「知らせたディスクの内容」を
    // 控えるので、「このまま編集する」で消した後にフォーカスの復帰で出し直さない)。保存できたら印を消す
    it('保存の照合の取り消しは外部変更の確認へ回し、保存の成功ではそのタブの印を消す', () => {
      const { rerender } = renderHook(() => useAppState())
      const fileSystemOptions = (mockUseFileSystem.mock.calls[0] as unknown[])[0] as {
        onSaveConflict: (path: string, reason: 'modified' | 'deleted') => void
        onSaveSucceeded: (path: string) => void
      }
      const marksOf = (): ExternalChangeMarks =>
        (mockUseExternalFileChanges.mock.calls.at(-1)?.[0] as { marks: ExternalChangeMarks }).marks
      const check = vi.fn()
      let unregister: () => void = () => undefined
      act(() => {
        unregister = marksOf().setCheckHandler(check)
      })
      act(() => fileSystemOptions.onSaveConflict('/p/a.ts', 'modified'))
      rerender()
      expect(check).toHaveBeenCalledExactlyOnceWith('/p/a.ts')
      expect(marksOf().get('/p/a.ts')).toBeNull()
      act(() => marksOf().mark('/p/a.ts', 'modified'))
      rerender()
      act(() => fileSystemOptions.onSaveSucceeded('/p/a.ts'))
      rerender()
      expect(marksOf().get('/p/a.ts')).toBeNull()
      unregister()
    })

    // 実行中(起動中を含む)のエージェントが無ければ確認せずに true を返すのは useAgentWorkspace の confirmStopAgent
    // (useAgentWorkspace.test.ts)。ここでは、フォルダを切り替える前にそれを呼び、答えに従うことを確かめる
    describe('フォルダの切り替えの前の確認', () => {
      it.each([
        ['OK なら開く', true, 1],
        ['キャンセルなら開かない', false, 0]
      ] as const)(
        'openFolder: エージェントの停止の確認で %s',
        async (_label, answer, openCalls) => {
          const confirmStopAgent = vi.fn(() => answer)
          mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState({ confirmStopAgent }))
          const openFolder = vi.fn(async () => undefined)
          mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), openFolder })
          const { result } = renderHook(() => useAppState())
          await act(async () => {
            await result.current.openFolder()
          })
          expect(confirmStopAgent).toHaveBeenCalledExactlyOnceWith(FOLDER_CHANGE_CONFIRM)
          expect(openFolder).toHaveBeenCalledTimes(openCalls)
        }
      )

      it('clone: エージェントの停止の確認でキャンセルしたら、未保存の確認に進まない', () => {
        const confirmStopAgent = vi.fn(() => false)
        mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState({ confirmStopAgent }))
        const confirmDiscardAnyDirty = vi.fn(() => true)
        mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), confirmDiscardAnyDirty })
        renderHook(() => useAppState())
        const options = mockUseCloneRepository.mock.calls[0][0] as {
          confirmDiscardAnyDirty: () => boolean
        }
        expect(options.confirmDiscardAnyDirty()).toBe(false)
        expect(confirmStopAgent).toHaveBeenCalledExactlyOnceWith(FOLDER_CHANGE_CONFIRM)
        expect(confirmDiscardAnyDirty).not.toHaveBeenCalled()
      })

      it.each([true, false])(
        'clone: エージェントの停止の確認で OK なら、未保存の確認の答え(%s)を返す',
        (dirtyAnswer) => {
          const confirmStopAgent = vi.fn(() => true)
          mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState({ confirmStopAgent }))
          const confirmDiscardAnyDirty = vi.fn(() => dirtyAnswer)
          mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), confirmDiscardAnyDirty })
          renderHook(() => useAppState())
          const options = mockUseCloneRepository.mock.calls[0][0] as {
            confirmDiscardAnyDirty: () => boolean
          }
          expect(options.confirmDiscardAnyDirty()).toBe(dirtyAnswer)
          expect(confirmStopAgent).toHaveBeenCalledExactlyOnceWith(FOLDER_CHANGE_CONFIRM)
          expect(confirmDiscardAnyDirty).toHaveBeenCalledOnce()
        }
      )
    })

    it('useExternalFileChanges に開いているフォルダを渡す(フォルダの切り替えで監視の対象を送り直すため)', () => {
      mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo' })
      renderHook(() => useAppState())
      const options = mockUseExternalFileChanges.mock.calls[0][0] as { folderPath: unknown }
      expect(options.folderPath).toBe('/repo')
    })
  })
})
