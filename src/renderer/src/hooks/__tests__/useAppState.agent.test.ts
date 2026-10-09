// useAppState の実行方式とエージェントの組み立てのテスト(useAppState.test.ts から分けた。モックの準備は同じ)。
// 実行方式とエージェントは useAgentWorkspace を型付きの偽物(makeAgentWorkspaceState)で差し替え、useAppState が渡す値と
// 公開する値だけを確かめる。実行方式の切り替えの安全・確認・実行ボタンの状態の組み立ては useAgentWorkspace.test.ts と
// promptRunState.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { AgentChangeEntry, GitStatusResult } from '@shared/types'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import { makeAgentSessionsState } from '../../__tests__/makeAgentSessionsState'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult
} from '../../__tests__/makeAgentChangesState'
import type { DiffTabKey } from '../useDiffTabs'
import type { ApplyOpenedFolderOptions } from '../useFileSystem'
import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'
import { makeCloneRepositoryPanelState } from '../../__tests__/makeCloneRepositoryPanelState'

const mockUsePanelState = vi.hoisted(() =>
  vi.fn(() => ({
    activePanel: 'explorer' as const,
    sidebarOpen: true,
    handlePanelChange: vi.fn(),
    showPanel: vi.fn()
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

// すべて戻すの確認の、エージェントが動いている間の追記
const AGENT_RUNNING_APPENDIX =
  'エージェントが動いている間は、戻した後に同じファイルが書き換えられることがあります。'
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
        isExecuting: true,
        beforeAgentSend: expect.any(Function)
      })
    })

    it('フォルダが無く実行していなければ、そのとおりに渡す', () => {
      renderHook(() => useAppState())
      expect(mockUseAgentWorkspace).toHaveBeenLastCalledWith({
        folderPath: null,
        isExecuting: false,
        beforeAgentSend: expect.any(Function)
      })
    })

    // beforeAgentSend・agentChangesPanel などは省略可能な引数・props のため、配線の漏れを型で検知できない(パターン 155)
    describe('エージェントの変更の配線', () => {
      beforeEach(() => {
        window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
        window.api.beginAgentChanges = vi
          .fn()
          .mockResolvedValue({ kind: 'recording', startedAt: 100 })
        window.api.listAgentChanges = vi
          .fn()
          .mockResolvedValue(makeAgentChangesListResult([makeAgentChangeEntry('a.txt')]))
        window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
        mockUseFileSystem.mockReturnValue({ ...defaultUseFileSystem(), folderPath: '/repo' })
        // 前のテストの mockReturnValue を持ち込まない(パターン 103)
        mockUseGitStatus.mockReturnValue({
          gitStatus: null,
          gitLoading: false,
          gitError: null,
          refreshGitStatus: vi.fn().mockResolvedValue(undefined)
        })
        mockUsePanelState.mockReturnValue({
          activePanel: 'explorer',
          sidebarOpen: true,
          handlePanelChange: vi.fn(),
          showPanel: vi.fn()
        })
      })

      it('送信の前の準備(beforeAgentSend)は記録を始めてから一覧を取る', async () => {
        renderHook(() => useAppState())
        const { beforeAgentSend } = mockUseAgentWorkspace.mock.lastCall![0] as {
          beforeAgentSend: () => Promise<void>
        }
        await act(async () => {
          await beforeAgentSend()
        })
        expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalled())
      })

      // 送信の関数(useAgentPromptSender.send)の依存になるため、描画のたびに作り直さない(Task 13 の申し送り)
      it('送信の前の準備(beforeAgentSend)の参照は、描画をまたいで変わらない', async () => {
        const { rerender } = renderHook(() => useAppState())
        const first = mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend
        rerender()
        expect(mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend).toBe(first)
        // 記録を始めて状態が変わった後も同じ
        await act(async () => {
          await first!()
        })
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalled())
        expect(mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend).toBe(first)
      })

      // 送信は 10 秒で待つのを打ち切る(useAgentPromptSender)。打ち切った後に記録が終わっても、記録として扱い一覧を取る
      it('送信の前の準備の記録が遅れて終わっても、記録中になり一覧を取る', async () => {
        let resolveBegin: (state: { kind: 'recording'; startedAt: number }) => void = () =>
          undefined
        window.api.beginAgentChanges = vi.fn().mockReturnValueOnce(
          new Promise((resolve) => {
            resolveBegin = resolve
          })
        )
        const { result } = renderHook(() => useAppState())
        const beforeAgentSend = mockUseAgentWorkspace.mock.lastCall![0].beforeAgentSend!
        // 準備の Promise を控えて最後に解決を検査する(.then の中だけで見ると、reject が握り潰されて通ったように見える)
        const pending = beforeAgentSend()
        let settled = false
        void pending.then(
          () => {
            settled = true
          },
          () => undefined
        )
        expect(settled).toBe(false)
        expect(window.api.listAgentChanges).not.toHaveBeenCalled()
        await act(async () => {
          resolveBegin({ kind: 'recording', startedAt: 100 })
        })
        await waitFor(() =>
          expect(result.current.agentChangesPanel.changes.view).toMatchObject({
            kind: 'recording',
            list: { totalCount: 1 }
          })
        )
        expect(result.current.agentChangesReview.isRecording).toBe(true)
        await expect(pending).resolves.toBeUndefined()
        await waitFor(() => expect(settled).toBe(true))
      })

      it('「変更を確認」はソース管理パネルを切り替えて開き、git status と一覧を取り直し、フォーカスを依頼する', async () => {
        const showPanel = vi.fn()
        mockUsePanelState.mockReturnValue({ ...mockUsePanelState(), showPanel })
        const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
        mockUseGitStatus.mockReturnValue({ ...mockUseGitStatus(), refreshGitStatus })
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        expect(result.current.agentChangesReview.isRecording).toBe(true)
        act(() => result.current.agentChangesReview.onReview())
        expect(showPanel).toHaveBeenCalledWith('source-control')
        expect(refreshGitStatus).toHaveBeenCalled()
        expect(result.current.agentChangesPanel.focusRequest.isRequested).toBe(true)
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalled())
      })

      it('セクションの「更新」は git status と一覧を取り直す(設計書「いつ完了とするか」(2))', async () => {
        const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
        mockUseGitStatus.mockReturnValue({ ...mockUseGitStatus(), refreshGitStatus })
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledOnce())
        refreshGitStatus.mockClear()
        await act(async () => {
          await result.current.agentChangesPanel.changes.refresh({ announce: true })
        })
        expect(refreshGitStatus).toHaveBeenCalledOnce()
        expect(window.api.listAgentChanges).toHaveBeenCalledTimes(2)
      })

      it('git status が新しくなったら、記録の一覧を取り直す', async () => {
        const status = (branch: string): GitStatusResult => ({
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: false,
          hasRemote: false,
          upstream: null,
          detached: false,
          branch,
          ahead: 0,
          behind: 0,
          files: []
        })
        mockUseGitStatus.mockReturnValue({ ...mockUseGitStatus(), gitStatus: status('main') })
        const { result, rerender } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledOnce())
        mockUseGitStatus.mockReturnValue({ ...mockUseGitStatus(), gitStatus: status('main') })
        rerender()
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledTimes(2))
      })

      it('いずれかのタブ(タブ 2)のセッションが終わったら、記録の一覧を取り直す', async () => {
        const { result, rerender } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledOnce())
        const workspace = makeAgentWorkspaceState()
        mockUseAgentWorkspace.mockReturnValue({
          ...workspace,
          agentTerminal: {
            ...workspace.agentTerminal,
            sessions: makeAgentSessionsState({
              lastExit: { sessionId: 's-2', exitCode: 0, reason: 'exited' }
            })
          }
        })
        rerender()
        await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledTimes(2))
      })

      it.each([
        [true, true],
        [false, false]
      ])(
        'どれかのタブが動いているか(起動中を含む。%s)を、すべて戻すの確認の「エージェントが動いている」の追記に渡す',
        async (isAnyActive, appended) => {
          const workspace = makeAgentWorkspaceState()
          mockUseAgentWorkspace.mockReturnValue({
            ...workspace,
            agentTerminal: {
              ...workspace.agentTerminal,
              // 選択中のタブは未起動でも、ほかのタブが動いて(起動中を含む)いれば追記する。running のタブは無くてもよい
              sessions: makeAgentSessionsState({ isAnyActive })
            }
          })
          const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
          try {
            const { result } = renderHook(() => useAppState())
            await act(async () => {
              await result.current.agentChangesPanel.changes.begin()
            })
            await waitFor(() =>
              expect(result.current.agentChangesPanel.revert.revertAllDisabledReason).toBeNull()
            )
            await act(async () => {
              await result.current.agentChangesPanel.revert.revertAll()
            })
            expect(confirmSpy).toHaveBeenCalledOnce()
            expect(String(confirmSpy.mock.calls[0][0]).includes(AGENT_RUNNING_APPENDIX)).toBe(
              appended
            )
          } finally {
            confirmSpy.mockRestore()
          }
        }
      )

      it('アプリで保存できたパスを、記録の「保存した」に渡す', async () => {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        // useFileSystem のモックは引数を宣言していないため、呼び出しの引数を unknown 経由で読む
        const [{ onSaveSucceeded }] = mockUseFileSystem.mock.lastCall as unknown as [
          { onSaveSucceeded: (path: string) => void }
        ]
        act(() => onSaveSucceeded('/repo/a.txt'))
        expect([...result.current.agentChangesPanel.changes.savedPaths]).toEqual(['/repo/a.txt'])
      })

      it('記録を終えたら、エージェントの変更の diff タブを閉じる', async () => {
        const closeDiffTab = vi.fn()
        mockUseDiffTabs.mockReturnValue({
          ...mockUseDiffTabs(),
          diffTabs: [
            { path: 'a.txt', kind: 'agent' },
            { path: 'a.txt', kind: 'unstaged' }
          ],
          closeDiffTab
        })
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() =>
          expect(result.current.agentChangesPanel.changes.view).toMatchObject({
            kind: 'recording',
            list: { totalCount: 1 }
          })
        )
        expect(closeDiffTab).not.toHaveBeenCalled()
        await act(async () => {
          await result.current.agentChangesPanel.changes.clear()
        })
        expect(closeDiffTab).toHaveBeenCalledExactlyOnceWith({ path: 'a.txt', kind: 'agent' })
      })

      it('一覧から消えたパスの agent の diff タブだけを閉じる', async () => {
        const closeDiffTab = vi.fn()
        mockUseDiffTabs.mockReturnValue({
          ...mockUseDiffTabs(),
          diffTabs: [
            { path: 'a.txt', kind: 'agent' },
            { path: 'gone.txt', kind: 'agent' }
          ],
          closeDiffTab
        })
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() =>
          expect(closeDiffTab).toHaveBeenCalledExactlyOnceWith({ path: 'gone.txt', kind: 'agent' })
        )
      })

      it('diff タブのハンクの操作は、開いている agent のタブの行が変更なら戻せる', async () => {
        mockUseDiffTabs.mockReturnValue({
          ...mockUseDiffTabs(),
          activeDiffTab: { path: 'a.txt', kind: 'agent' }
        })
        const { result } = renderHook(() => useAppState())
        expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() => expect(result.current.agentDiffActions.canRevertHunk).toBe(true))
      })

      // 追加・削除はファイル単位で戻す。記録していない・フォルダの行はハンクで戻せない(Task 14 の申し送り: 呼び出し側の責務)
      it.each<[string, Partial<AgentChangeEntry>]>([
        ['追加', { status: 'A' }],
        ['削除', { status: 'D' }],
        ['記録していない', { notRecorded: true }],
        ['フォルダ', { isDirectory: true }]
      ])('diff タブの行が%sならハンクで戻せない', async (_label, overrides) => {
        window.api.listAgentChanges = vi
          .fn()
          .mockResolvedValue(makeAgentChangesListResult([makeAgentChangeEntry('a.txt', overrides)]))
        mockUseDiffTabs.mockReturnValue({
          ...mockUseDiffTabs(),
          activeDiffTab: { path: 'a.txt', kind: 'agent' }
        })
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.agentChangesPanel.changes.begin()
        })
        await waitFor(() =>
          expect(result.current.agentChangesPanel.changes.view).toMatchObject({
            kind: 'recording',
            list: { totalCount: 1 }
          })
        )
        expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
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
      const diffTab: DiffTabKey = { path: 'a.ts', kind: 'unstaged' }
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
