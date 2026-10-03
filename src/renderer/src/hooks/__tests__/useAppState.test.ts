import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { GitStatusResult } from '@shared/types'
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

import { useAppState } from '../useAppState'

beforeEach(() => {
  vi.clearAllMocks()
  // clone の「Git 操作の実行中」の合成がタグ・初期化の実行中フラグを読むため、既定の戻り値を毎回設定し直す
  // (前のテストの mockReturnValue を持ち込まない。パターン 103)。個別のテストは mockReturnValue で上書きする
  mockUseGitTagOperations.mockReturnValue(makeGitTagPanelState())
  mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState())
  mockUseCloneRepository.mockReturnValue(makeCloneRepositoryPanelState())
  // 退避の実行中フラグ(stash.pendingOperation)も合成に入るため、退避の既定の戻り値も毎回設定し直す
  mockUseStashPanel.mockReturnValue(mockStashPanel)
})

describe('useAppState', () => {
  it('usePanelState を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePanelState).toHaveBeenCalledOnce()
  })

  it('useFileSystem を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseFileSystem).toHaveBeenCalledOnce()
  })

  it('usePrompts を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePrompts).toHaveBeenCalledOnce()
  })

  it('useGitStatus を呼び出す（folderPath を引数に）', () => {
    renderHook(() => useAppState())
    expect(mockUseGitStatus).toHaveBeenCalledOnce()
    expect(mockUseGitStatus).toHaveBeenCalledWith(null)
  })

  it('panelState の値が含まれる（activePanel, sidebarOpen, handlePanelChange）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('activePanel', 'explorer')
    expect(result.current).toHaveProperty('sidebarOpen', true)
    expect(result.current).toHaveProperty('handlePanelChange')
  })

  it('fileSystem の値が含まれる（folderPath, fileTree, openFile, error, openFolder, selectFile）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('folderPath', null)
    expect(result.current).toHaveProperty('fileTree')
    expect(result.current).toHaveProperty('openFile', null)
    expect(result.current).toHaveProperty('error', null)
    expect(result.current).toHaveProperty('openFolder')
    expect(result.current).toHaveProperty('selectFile')
  })

  it('8フックの返り値にキーの重複がない（各フックのキー集合が互いに素）', () => {
    const keysets = [
      Object.keys(mockUsePanelState()),
      Object.keys(mockUseFileSystem()),
      Object.keys(mockUsePrompts()),
      Object.keys(mockUseGitStatus()),
      Object.keys(mockUseSettings()),
      Object.keys(mockUsePromptExecution()),
      Object.keys(mockUseHistory()),
      Object.keys(mockUsePromptRunner())
    ]
    for (let i = 0; i < keysets.length; i++) {
      for (let j = i + 1; j < keysets.length; j++) {
        const intersection = keysets[i].filter((k) => keysets[j].includes(k))
        expect(intersection).toHaveLength(0)
      }
    }
  })

  it('useSettings を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseSettings).toHaveBeenCalledOnce()
  })

  it('usePromptExecution を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePromptExecution).toHaveBeenCalledOnce()
  })

  it('settings の値が含まれる（hasKey, apiKeyLoaded, keyStoreError, saveApiKey）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('hasKey', false)
    expect(result.current).toHaveProperty('apiKeyLoaded', false)
    expect(result.current).toHaveProperty('keyStoreError', null)
    expect(result.current).toHaveProperty('saveApiKey')
  })

  it('execution の値が含まれる（isExecuting, result, executionError, executePrompt, clearResult）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('isExecuting', false)
    expect(result.current).toHaveProperty('result', null)
    expect(result.current).toHaveProperty('executionError', null)
    expect(result.current).toHaveProperty('executePrompt')
    expect(result.current).toHaveProperty('clearResult')
  })

  it('prompts の値が含まれる（prompts, addPrompt, deletePrompt）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('prompts')
    expect(result.current).toHaveProperty('addPrompt')
    expect(result.current).toHaveProperty('deletePrompt')
  })

  it('git の値が含まれる（gitStatus, gitLoading, gitError, refreshGitStatus）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('gitStatus', null)
    expect(result.current).toHaveProperty('gitLoading', false)
    expect(result.current).toHaveProperty('gitError', null)
    expect(result.current).toHaveProperty('refreshGitStatus')
  })

  it('useHistory を呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseHistory).toHaveBeenCalledOnce()
  })

  it('history の値が含まれる（history, historyLoaded, addHistoryEntry, deleteHistoryEntry, clearHistory）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('history', [])
    expect(result.current).toHaveProperty('historyLoaded', false)
    expect(result.current).toHaveProperty('addHistoryEntry')
    expect(result.current).toHaveProperty('deleteHistoryEntry')
    expect(result.current).toHaveProperty('clearHistory')
  })

  it('usePromptRunner を openFile・executePrompt・addHistoryEntry とともに呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUsePromptRunner).toHaveBeenCalledOnce()
    const args = mockUsePromptRunner.mock.calls[0][0]
    expect(args).toHaveProperty('openFile', null)
    expect(args).toHaveProperty('executePrompt')
    expect(args).toHaveProperty('addHistoryEntry')
  })

  it('promptRunner の値が含まれる（runPrompt, rerunHistoryEntry）', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current).toHaveProperty('runPrompt')
    expect(result.current).toHaveProperty('rerunHistoryEntry')
  })

  it('useQuickOpen を fileTree・folderPath・openFilePath・selectFile とともに呼び出す', () => {
    renderHook(() => useAppState())
    expect(mockUseQuickOpen).toHaveBeenCalledOnce()
    const args = mockUseQuickOpen.mock.calls[0][0]
    expect(args).toHaveProperty('fileTree')
    expect(args).toHaveProperty('folderPath', null)
    expect(args).toHaveProperty('openFilePath', null)
    expect(args).toHaveProperty('selectFile')
    // 信号が渡らないと履歴更新とフォーカス制御が同時に壊れる
    expect(args).toHaveProperty('openedFileSignal')
  })

  it('quickOpen コントローラが返り値に含まれる', () => {
    const { result } = renderHook(() => useAppState())
    expect(result.current.quickOpen).toHaveProperty('isOpen', false)
  })

  it('gitStatus.files に存在しなくなった diffTab を自動的に閉じる', () => {
    // isUntracked を renderer 側の gitStatusFiles から渡す設計(useDiffOperations.ts)
    // 上、開いている diff タブの対象ファイルが gitStatus.files から消える(.gitignore
    // 追加・コミット等で追跡対象外になる)と、そのまま診断すると誤った diff
    // (「差分なし」等)が表示され続けてしまう。gitStatus.files から消えたら
    // タブ自体を閉じることで、誤表示ではなく「タブが消える」という分かりやすい
    // 挙動にする
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'gone.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'gone.txt', staged: false })
  })

  it('gitStatus.files にまだ存在する diffTab は閉じない(unstaged タブ、未ステージの変更が残っている)', () => {
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'still-here.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'still-here.txt', index: ' ', workingDir: 'M' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()
  })

  it('gitStatus.files にまだ存在する diffTab は閉じない(staged タブ、ステージ済みの変更が残っている)', () => {
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'still-here.txt', staged: true }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'still-here.txt', index: 'M', workingDir: ' ' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()
  })

  it('staged diffTab を開いた後にそのファイルを unstage すると、staged 側の diff がもう無いのでタブを閉じる', () => {
    // 「gitStatus.files にパスが存在するか」だけを見ると、ファイルXを
    // ステージして staged diff タブを開いた後に X を unstage しても、
    // X は index=' ', workingDir='M'(unstaged 扱い)として gitStatusFiles に
    // 残り続けるため、パスの存在確認だけでは閉じるべき staged タブが
    // 閉じられない。開いても「差分はありません」が表示され続けるゴミタブになる。
    // タブが指す方向(staged/unstaged)に対応する変更が実際にあるかまで見る必要がある
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'unstaged-now.txt', staged: true }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        // unstage 後: ステージ済みの変更は無く、未ステージの変更だけが残っている
        files: [{ path: 'unstaged-now.txt', index: ' ', workingDir: 'M' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'unstaged-now.txt', staged: true })
  })

  it('unstaged diffTab を開いた後にそのファイルを stage すると、unstaged 側の差分がもう無いのでタブを閉じる', () => {
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'staged-now.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        // stage 後: 未ステージの変更は無く、ステージ済みの変更だけが残っている
        files: [{ path: 'staged-now.txt', index: 'M', workingDir: ' ' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'staged-now.txt', staged: false })
  })

  it('unstaged diffTab は、未追跡ファイル(index="?")のままなら閉じない', () => {
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'untracked.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'untracked.txt', index: '?', workingDir: '?' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()
  })

  it('gitStatus.files の path が表記違い(大文字小文字)でも同一ファイルとみなし diffTab を閉じない', () => {
    // filePaths.has(tab.path) という素の Set 比較のままだと、Windows の
    // ドライブレター大文字小文字違い等で一致しなくなり、まだ存在するファイルの
    // diff タブを誤って閉じてしまう(ユーザーが見ている最中のタブが消える)
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'C:\\project\\a.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: [{ path: 'c:/project/a.txt', index: ' ', workingDir: 'M' }]
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()
  })

  it('folderPath が変わると開いている diff タブを全て閉じる(フォルダ切替時、新フォルダの同名ファイルを古いタブが指してしまうのを防ぐ)', () => {
    // gitStatus.files に基づく自動クローズ(直前のテスト群)は「path 文字列が
    // 存在するか」しか見ないため、切替先フォルダに偶然同じ相対パスのファイルが
    // 存在すると、そのタブは閉じられず、無関係な別ファイルの diff を表示し
    // 続けてしまう。フォルダ切替時は無条件に全 diff タブを閉じる
    // vi.clearAllMocks() は呼び出し履歴のみクリアし、前のテストで mockReturnValue
    // した実装は残留する。ここで明示的に再設定しないと、直前のテストの
    // gitStatus.files が残ったままとなり、#1 の「gitStatus.files に存在しない
    // diffTab を閉じる」effect が意図せず発火してしまう
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [
        { path: 'src/index.ts', staged: false },
        { path: 'src/other.ts', staged: true }
      ],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: null,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project-a',
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
    const { rerender } = renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()

    mockUseFileSystem.mockReturnValue({
      folderPath: '/project-b',
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
    rerender()

    expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'src/index.ts', staged: false })
    expect(mockCloseDiffTab).toHaveBeenCalledWith({ path: 'src/other.ts', staged: true })
  })

  it('selectFile(エクスプローラー/クイックオープン経路)でファイルを開けたら diff タブを非アクティブ化する', async () => {
    const mockDeactivate = vi.fn()
    const mockSelectFile = vi.fn().mockResolvedValue(true)
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: mockDeactivate
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: mockSelectFile,
      activateTab: vi.fn(),
      saveFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    const { result } = renderHook(() => useAppState())
    await result.current.selectFile(
      { path: '/project/a.ts', name: 'a.ts', type: 'file' },
      undefined
    )
    expect(mockDeactivate).toHaveBeenCalledOnce()
    expect(mockSelectFile).toHaveBeenCalled()
  })

  it('activateTab(既存タブへの切り替え経路)も diff タブを非アクティブ化する', () => {
    // 非アクティブ化しないと、diff タブを表示したまま実ファイルタブへ切り替えても
    // タブバーのハイライト・本文表示が diff タブに固定されたままになる
    // (「diffタブ復帰不可」として一度修正した不具合と同じもの)。
    // useCombinedEditorTabs 側の handleActivateTab でも同じ非アクティブ化を
    // 行っているが、生の activateTab がそのまま公開されていると、新しい
    // 呼び出し経路が増えたときに素通りしてしまう
    const mockDeactivate = vi.fn()
    const mockActivateTab = vi.fn().mockReturnValue(true)
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: mockDeactivate
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: vi.fn(),
      activateTab: mockActivateTab,
      saveFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    const { result } = renderHook(() => useAppState())
    result.current.activateTab('/project/a.ts')
    expect(mockDeactivate).toHaveBeenCalledOnce()
    expect(mockActivateTab).toHaveBeenCalledWith('/project/a.ts')
  })

  it('selectFile がファイルを開けなかった(破棄確認のキャンセル・読み込み失敗)場合、diff タブを非アクティブ化しない', async () => {
    // 非アクティブ化してしまうと、ファイルは開かれないのに読んでいた diff 表示
    // だけが消える(実ファイルタブが無ければプレースホルダになる)。
    // 直下の activateTab ラッパーは同じ不変条件を守っており、こちらだけ非対称だった
    const mockDeactivate = vi.fn()
    const mockSelectFile = vi.fn().mockResolvedValue(false)
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: mockDeactivate
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: mockSelectFile,
      activateTab: vi.fn().mockReturnValue(true),
      saveFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    const { result } = renderHook(() => useAppState())
    await result.current.selectFile(
      { path: '/project/a.ts', name: 'a.ts', type: 'file' },
      undefined
    )
    expect(mockSelectFile).toHaveBeenCalled()
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('activateTab が切り替えに失敗した(開いていないパス)場合、diff タブを非アクティブ化しない', () => {
    // 非アクティブ化してしまうと、実ファイルタブは切り替わらないのに diff タブ
    // だけが非アクティブになり、EditorPanel がどちらも表示しない状態になる
    const mockDeactivate = vi.fn()
    const mockActivateTab = vi.fn().mockReturnValue(false)
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: mockDeactivate
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: vi.fn(),
      activateTab: mockActivateTab,
      saveFile: vi.fn().mockResolvedValue(undefined),
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    const { result } = renderHook(() => useAppState())
    result.current.activateTab('/project/not-open.ts')
    expect(mockDeactivate).not.toHaveBeenCalled()
  })

  it('saveFile は git status の更新が完了してから diff を再取得する(古い gitStatusFiles で isUntracked を誤判定しないため)', async () => {
    // useDiffOperations の runHunkOperation は「refreshGitStatus 完了後に
    // diffRefreshSignal を発火させる」設計(gitStatusFiles がまだ古いままだと
    // isUntracked を誤判定するレースを防ぐため)。saveFile ラッパーがこの順序を
    // 逆にすると、getDiff が refreshGitStatus 完了前の古い gitStatusFiles を
    // 見て isUntracked を判定してしまう
    const callOrder: string[] = []
    const mockSaveFile = vi.fn().mockResolvedValue(undefined)
    // refreshGitStatus を意図的に未解決のまま止め、その間に getDiff が
    // 呼ばれていないことまで確認する(即座に resolve するモックだと、
    // 呼び出しの「開始順序」しか検証できず、「完了を待ってから」を
    // 検証したことにならない)
    let resolveGitStatus: () => void = () => {}
    const mockRefreshGitStatus = vi.fn().mockImplementation(() => {
      callOrder.push('refreshGitStatus:start')
      return new Promise<void>((resolve) => {
        resolveGitStatus = () => {
          callOrder.push('refreshGitStatus:end')
          resolve()
        }
      })
    })
    const activeTab: DiffTabKey = { path: 'a.ts', staged: false }
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [activeTab],
      activeDiffTab: activeTab,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn(),
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: vi.fn(),
      activateTab: vi.fn(),
      saveFile: mockSaveFile,
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: null,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: mockRefreshGitStatus
    })
    const originalGetDiff = window.api.getDiff
    window.api.getDiff = vi.fn().mockImplementation(async () => {
      callOrder.push('getDiff')
      return 'DIFF'
    })
    try {
      const { result } = renderHook(() => useAppState())
      // マウント時の初回取得を待つ
      await waitFor(() => expect(window.api.getDiff).toHaveBeenCalled())
      callOrder.length = 0

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      await waitFor(() => expect(callOrder).toContain('refreshGitStatus:start'))

      // refreshGitStatus が未解決の間、getDiff が呼ばれていないことを確認する。
      // Reactのレンダー/useEffectがマイクロタスクを挟んで走る余地があるため、
      // 明示的に何度かマイクロタスクを消化してから確認する
      for (let i = 0; i < 5; i++) await Promise.resolve()
      expect(callOrder).not.toContain('getDiff')

      resolveGitStatus()
      await act(async () => {
        await savePromise
      })
      await waitFor(() => expect(callOrder).toContain('getDiff'))

      expect(callOrder.indexOf('refreshGitStatus:end')).toBeLessThan(callOrder.indexOf('getDiff'))
    } finally {
      window.api.getDiff = originalGetDiff
    }
  })

  it('saveFile の完了後、diff の再取得と git status の更新をトリガーする', async () => {
    // エディタでの保存は git status のステータス文字を変えない(既に " M" の
    // ファイルを編集・保存しても " M" のまま)ため、diff タブの自動再取得
    // (activeFileStatusKey 依存)では検知できない。取り直さないと、保存前の
    // 古い diffContent から作った patch を「このハンクをステージ」で送ってしまい、
    // ユーザーが一度も意図していない内容が index に入る
    const mockSaveFile = vi.fn().mockResolvedValue(undefined)
    const mockRefreshGitStatus = vi.fn().mockResolvedValue(undefined)
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
      fileTree: [],
      openFile: null,
      openedFileSignal: { events: [] },
      error: null,
      openFolder: vi.fn(),
      selectFile: vi.fn(),
      activateTab: vi.fn(),
      saveFile: mockSaveFile,
      createFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      renameEntry: vi.fn().mockResolvedValue(undefined),
      deleteEntry: vi.fn().mockResolvedValue(undefined)
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: null,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: mockRefreshGitStatus
    })
    const { result } = renderHook(() => useAppState())
    await result.current.saveFile()
    expect(mockSaveFile).toHaveBeenCalledOnce()
    expect(mockRefreshGitStatus).toHaveBeenCalled()
  })

  describe('Explorer 操作(createFile/createDirectory/renameEntry/deleteEntry)の完了後', () => {
    // リネーム/削除したファイルの gitStatus が古いまま残ると、Source Control
    // パネルの表示が古いままになるだけでなく、useAppState.ts 自身が持つ
    // 「gitStatus.files から消えた diffTab を自動で閉じる」effect も発火せず、
    // 存在しなくなったパスに対して diff タブのステージ/アンステージ操作が
    // 可能なまま残ってしまう。saveFile と同じく git status を再取得する必要がある
    function setup(): { refreshGitStatus: ReturnType<typeof vi.fn> } {
      const mockRefreshGitStatus = vi.fn().mockResolvedValue(undefined)
      mockUseFileSystem.mockReturnValue({
        folderPath: '/project',
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
      mockUseGitStatus.mockReturnValue({
        gitStatus: null,
        gitLoading: false,
        gitError: null,
        refreshGitStatus: mockRefreshGitStatus
      })
      return { refreshGitStatus: mockRefreshGitStatus }
    }

    it('createFile の完了後、git status を再取得する', async () => {
      const { refreshGitStatus } = setup()
      const { result } = renderHook(() => useAppState())
      await result.current.createFile('/project', 'a.ts')
      expect(refreshGitStatus).toHaveBeenCalled()
    })

    it('createDirectory の完了後、git status を再取得する', async () => {
      const { refreshGitStatus } = setup()
      const { result } = renderHook(() => useAppState())
      await result.current.createDirectory('/project', 'sub')
      expect(refreshGitStatus).toHaveBeenCalled()
    })

    it('renameEntry の完了後、git status を再取得する', async () => {
      const { refreshGitStatus } = setup()
      const { result } = renderHook(() => useAppState())
      await result.current.renameEntry(
        {} as unknown as Parameters<typeof result.current.renameEntry>[0],
        'new.ts'
      )
      expect(refreshGitStatus).toHaveBeenCalled()
    })

    it('deleteEntry の完了後、git status を再取得する', async () => {
      const { refreshGitStatus } = setup()
      const { result } = renderHook(() => useAppState())
      await result.current.deleteEntry(
        {} as unknown as Parameters<typeof result.current.deleteEntry>[0]
      )
      expect(refreshGitStatus).toHaveBeenCalled()
    })
  })

  // checkout・マージのラッパーで共通の前提: リポジトリが開かれていて、
  // 未保存編集の破棄確認と全タブの再読込だけを差し替える
  function setupEditorSyncedGitOperation(options: {
    confirmDiscardAnyDirty: () => boolean
    reloadOpenFiles: () => Promise<void>
  }): void {
    mockUseFileSystem.mockReturnValue({
      folderPath: '/project',
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
      deleteEntry: vi.fn().mockResolvedValue(undefined),
      confirmDiscardAnyDirty: options.confirmDiscardAnyDirty,
      reloadOpenFiles: options.reloadOpenFiles
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn().mockResolvedValue(undefined)
    })
  }

  describe('checkoutBranch ラッパー', () => {
    // checkout は working tree のファイルを直接書き換えるが、エディタのバッファは
    // 別に保持しているため連動しない。確認なしに切り替えると、切替前の内容を
    // 編集したまま保存した際に切替後のブランチのファイルを無警告で上書きして
    // しまう(コードレビュー指摘)。confirmDiscardAnyDirty で破棄を確認し、
    // 成功後は開いている全タブをディスクの最新内容へ同期する
    it('未保存編集が無ければ確認どおり checkout を実行し、成功後に開いているファイルを再読込する', async () => {
      const mockConfirmDiscardAnyDirty = vi.fn(() => true)
      const mockReloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      setupEditorSyncedGitOperation({
        confirmDiscardAnyDirty: mockConfirmDiscardAnyDirty,
        reloadOpenFiles: mockReloadOpenFiles
      })
      const originalCheckoutBranch = window.api.checkoutBranch
      window.api.checkoutBranch = vi.fn().mockResolvedValue(undefined)
      try {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.checkoutBranch('feature/x')
        })
        expect(mockConfirmDiscardAnyDirty).toHaveBeenCalled()
        expect(window.api.checkoutBranch).toHaveBeenCalledWith('feature/x')
        expect(mockReloadOpenFiles).toHaveBeenCalled()
      } finally {
        window.api.checkoutBranch = originalCheckoutBranch
      }
    })

    it('破棄確認でキャンセルされたら checkout も reloadOpenFiles も呼ばれない', async () => {
      const mockConfirmDiscardAnyDirty = vi.fn(() => false)
      const mockReloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      setupEditorSyncedGitOperation({
        confirmDiscardAnyDirty: mockConfirmDiscardAnyDirty,
        reloadOpenFiles: mockReloadOpenFiles
      })
      const originalCheckoutBranch = window.api.checkoutBranch
      window.api.checkoutBranch = vi.fn().mockResolvedValue(undefined)
      try {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.checkoutBranch('feature/x')
        })
        expect(window.api.checkoutBranch).not.toHaveBeenCalled()
        expect(mockReloadOpenFiles).not.toHaveBeenCalled()
      } finally {
        window.api.checkoutBranch = originalCheckoutBranch
      }
    })

    // コードレビュー指摘(2周目): gitBranchOperations.checkoutBranch は
    // useRunExclusiveGitOperation の設計上、checkout が git レベルで失敗しても
    // 例外を rethrow せず branchOperationError にエラーを格納するだけで
    // 正常終了する。このラッパーが戻り値を見ずに reloadOpenFiles() を呼んで
    // いると、ブランチ切替に失敗したにもかかわらず、無関係な未保存編集を
    // 含む全タブがディスク内容(切替前のまま)で上書きされ、ユーザーの編集が
    // サイレントに失われる
    it('checkout が失敗した場合、reloadOpenFiles は呼ばれない(無関係な未保存編集を保持する)', async () => {
      const mockConfirmDiscardAnyDirty = vi.fn(() => true)
      const mockReloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      setupEditorSyncedGitOperation({
        confirmDiscardAnyDirty: mockConfirmDiscardAnyDirty,
        reloadOpenFiles: mockReloadOpenFiles
      })
      const originalCheckoutBranch = window.api.checkoutBranch
      window.api.checkoutBranch = vi
        .fn()
        .mockRejectedValue(
          new Error('Your local changes to the following files would be overwritten by checkout')
        )
      try {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.checkoutBranch('feature/x')
        })
        expect(window.api.checkoutBranch).toHaveBeenCalledWith('feature/x')
        expect(mockReloadOpenFiles).not.toHaveBeenCalled()
      } finally {
        window.api.checkoutBranch = originalCheckoutBranch
      }
    })
  })

  describe('mergeBranch ラッパー', () => {
    // マージも working tree のファイルを直接書き換えるが、エディタのバッファは別に保持して
    // いるため連動しない。checkout と同じく、未保存編集の破棄を確認し、成功後だけ開いている
    // 全タブをディスクの最新内容へ同期する。失敗時に再読込すると、無関係な未保存編集が
    // マージが行われていないディスクの現在の内容で上書きされて失われる
    const runMerge = async (
      apiMerge: typeof window.api.mergeBranch,
      options: { confirmDiscardAnyDirty: () => boolean; reloadOpenFiles: () => Promise<void> },
      mergeConfirm = true
    ): Promise<void> => {
      setupEditorSyncedGitOperation(options)
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
      const apiMerge = vi.fn().mockResolvedValue({ status: 'merged' })
      await runMerge(apiMerge, { confirmDiscardAnyDirty, reloadOpenFiles })
      expect(confirmDiscardAnyDirty).toHaveBeenCalled()
      expect(apiMerge).toHaveBeenCalledWith('feature/x')
      expect(reloadOpenFiles).toHaveBeenCalled()
    })

    it('未保存編集の破棄確認でキャンセルされたら、マージも再読込もしない', async () => {
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const apiMerge = vi.fn().mockResolvedValue({ status: 'merged' })
      await runMerge(apiMerge, { confirmDiscardAnyDirty: () => false, reloadOpenFiles })
      expect(apiMerge).not.toHaveBeenCalled()
      expect(reloadOpenFiles).not.toHaveBeenCalled()
    })

    it('マージの確認でキャンセルされたら、マージも再読込もしない', async () => {
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const apiMerge = vi.fn().mockResolvedValue({ status: 'merged' })
      await runMerge(apiMerge, { confirmDiscardAnyDirty: () => true, reloadOpenFiles }, false)
      expect(apiMerge).not.toHaveBeenCalled()
      expect(reloadOpenFiles).not.toHaveBeenCalled()
    })

    // コンフリクトで止まったマージは作業ツリーを変えている(マーカー入りになる)。例外ではなく
    // conflict の結果で返るので、成功と同じく開いているタブを再読込する。再読込しないと、古い
    // 内容のタブを保存したときにマーカーと相手側の変更が消える(パターン52)
    it('コンフリクトで止まった場合も、開いているファイルを再読込する', async () => {
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const apiMerge = vi.fn().mockResolvedValue({
        status: 'conflict',
        message: 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
      })
      await runMerge(apiMerge, { confirmDiscardAnyDirty: () => true, reloadOpenFiles })
      expect(apiMerge).toHaveBeenCalledWith('feature/x')
      expect(reloadOpenFiles).toHaveBeenCalled()
    })

    // 事前検証の失敗等の例外は作業ツリーが変わっていない。戻り値を見ずに再読込すると、
    // マージが行われていないのに無関係な未保存編集がディスク内容で上書きされる
    it('マージが例外で失敗した場合、reloadOpenFiles は呼ばれない(未保存編集を保持する)', async () => {
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const apiMerge = vi
        .fn()
        .mockRejectedValue(
          new Error('未コミットの変更があるためマージできません。先にコミットしてください')
        )
      await runMerge(apiMerge, { confirmDiscardAnyDirty: () => true, reloadOpenFiles })
      expect(apiMerge).toHaveBeenCalledWith('feature/x')
      expect(reloadOpenFiles).not.toHaveBeenCalled()
    })
  })

  // コンフリクトで止まったときの「コンフリクトしました（…）」は branchOperationError に残る。
  // マージを完了・中止しても残り続けると、解決済みなのにエラーが出たままになる。
  // 完了・中止の経路(バナー・コミット欄・CLI)を問わず、マージ中(gitStatus.mergeInProgress)が
  // 解除されたら消えることを確かめる(useMergeState はモックのため、状態の変化だけで消える)
  it('コンフリクト後にマージ中でなくなると、コンフリクトで止まったときのエラー表示が消える', async () => {
    setupEditorSyncedGitOperation({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles: vi.fn().mockResolvedValue(undefined)
    })
    const status = (mergeInProgress: boolean): ReturnType<typeof mockUseGitStatus> => ({
      gitStatus: {
        isRepo: true,
        mergeInProgress,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      },
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn().mockResolvedValue(undefined)
    })
    const originalMerge = window.api.mergeBranch
    window.api.mergeBranch = vi.fn().mockResolvedValue({
      status: 'conflict',
      message: 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      const { result, rerender } = renderHook(() => useAppState())
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
      mockUseGitStatus.mockReturnValue(status(true))
      rerender()
      expect(result.current.branchOperationError?.message).toContain('コンフリクトしました')
      mockUseGitStatus.mockReturnValue(status(false))
      rerender()
      expect(result.current.branchOperationError).toBeNull()
    } finally {
      window.api.mergeBranch = originalMerge
      confirmSpy.mockRestore()
    }
  })

  it('useMergeState に完了・中止の後始末のコールバック(onFinished)を渡さない', () => {
    renderHook(() => useAppState())
    expect(mockUseMergeState.mock.lastCall?.[0]).not.toHaveProperty('onFinished')
  })

  describe('discardFile ラッパー', () => {
    it('確認後に取り消し、成功したら対象タブを絶対パスで再読込する', async () => {
      const reloadOpenFile = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
        reloadOpenFile,
        closeTabsAtOrInside: vi.fn(),
        refreshTree
      })
      mockUseGitStatus.mockReturnValue({
        gitStatus: {
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: true,
          hasRemote: true,
          upstream: 'origin/main',
          detached: false,
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
        // ファイルウォッチャーが無いため、成功後にツリーを読み直す(最終レビューで追加)
        expect(refreshTree).toHaveBeenCalledTimes(1)
      } finally {
        window.api.discardChanges = original
        confirmSpy.mockRestore()
      }
    })

    it('未追跡ファイルの取り消しに成功したら closeTabsAtOrInside を呼び、reloadOpenFile は呼ばない', async () => {
      const reloadOpenFile = vi.fn().mockResolvedValue(undefined)
      const closeTabsAtOrInside = vi.fn()
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
        reloadOpenFile,
        closeTabsAtOrInside,
        refreshTree
      })
      mockUseGitStatus.mockReturnValue({
        gitStatus: {
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: true,
          hasRemote: true,
          upstream: 'origin/main',
          detached: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          files: [{ path: 'new.txt', index: '?', workingDir: '?' }]
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
          await result.current.discardFile('new.txt')
        })
        expect(window.api.discardChanges).toHaveBeenCalledWith('new.txt')
        expect(closeTabsAtOrInside).toHaveBeenCalledWith('/project/new.txt')
        expect(reloadOpenFile).not.toHaveBeenCalled()
      } finally {
        window.api.discardChanges = original
        confirmSpy.mockRestore()
      }
    })

    it('対象タブに未保存の編集があれば、確認文言にエディタの編集も破棄される旨を含める', async () => {
      const hasDirtyTabAtOrInside = vi.fn().mockReturnValue(true)
      const reloadOpenFile = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        hasDirtyTabAtOrInside,
        reloadOpenFile,
        closeTabsAtOrInside: vi.fn(),
        refreshTree
      })
      mockUseGitStatus.mockReturnValue({
        gitStatus: {
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: true,
          hasRemote: true,
          upstream: 'origin/main',
          detached: false,
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
        expect(confirmSpy).toHaveBeenCalledWith(
          expect.stringContaining('エディタの未保存の編集も破棄されます。')
        )
        expect(hasDirtyTabAtOrInside).toHaveBeenCalledWith('/project/src/a.ts')
      } finally {
        window.api.discardChanges = original
        confirmSpy.mockRestore()
      }
    })
  })

  describe('ハンクと一括の取り消し', () => {
    it('useDiscardHunk に依存を渡し、戻り値を discardHunk として公開する(useDiffOperations の boolean 版で上書きしない)', () => {
      const hasDirtyTabAtOrInside = vi.fn(() => false)
      const reloadOpenFile = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        hasDirtyTabAtOrInside,
        reloadOpenFile,
        refreshTree
      })
      mockUseDiffTabs.mockReturnValue({
        diffTabs: [{ path: 'a.ts', staged: false }],
        activeDiffTab: { path: 'a.ts', staged: false },
        openDiffTab: vi.fn(),
        closeDiffTab: vi.fn(),
        activateDiffTab: vi.fn(),
        deactivateDiffTab: vi.fn()
      })
      mockUseGitStatus.mockReturnValue({
        gitStatus: {
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: true,
          hasRemote: true,
          upstream: 'origin/main',
          detached: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          files: [{ path: 'a.ts', index: ' ', workingDir: 'M' }]
        },
        gitLoading: false,
        gitError: null,
        refreshGitStatus: vi.fn()
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseDiscardHunk).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: '/project',
          activeDiffTabPath: 'a.ts',
          discardHunk: expect.any(Function),
          hasDirtyTabAtOrInside,
          reloadOpenFile,
          refreshTree
        })
      )
      expect(result.current.discardHunk).toBe(mockDiscardHunkFn)
      // useDiffOperations の canDiscardHunk を公開する(未ステージの追跡済み変更なので true)
      expect(result.current.canDiscardHunk).toBe(true)
    })

    it('activeDiffTab が無いとき useDiscardHunk の activeDiffTabPath は null', () => {
      mockUseDiffTabs.mockReturnValue({
        diffTabs: [],
        activeDiffTab: null,
        openDiffTab: vi.fn(),
        closeDiffTab: vi.fn(),
        activateDiffTab: vi.fn(),
        deactivateDiffTab: vi.fn()
      })
      renderHook(() => useAppState())
      expect(mockUseDiscardHunk).toHaveBeenLastCalledWith(
        expect.objectContaining({ activeDiffTabPath: null })
      )
    })

    it('useDiscardAllChanges に依存を渡し、戻り値を discardAll として公開する', () => {
      const confirmDiscardAnyDirty = vi.fn(() => true)
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        confirmDiscardAnyDirty,
        reloadOpenFiles,
        refreshTree
      })
      const refreshGitStatus = vi.fn()
      mockUseGitStatus.mockReturnValue({
        gitStatus: null,
        gitLoading: false,
        gitError: null,
        refreshGitStatus
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseDiscardAllChanges).toHaveBeenCalledWith(
        expect.objectContaining({
          gitStatus: null,
          refreshGitStatus,
          fileLock: expect.anything(),
          confirmDiscardAnyDirty,
          reloadOpenFiles,
          refreshTree
        })
      )
      expect(result.current.discardAll).toBe(mockDiscardAllState)
    })
  })

  describe('マージ状態と解決ビュー', () => {
    const conflictedStatus = {
      isRepo: true,
      mergeInProgress: true,
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: 'a.txt', index: 'U', workingDir: 'U' },
        { path: 'm.txt', index: ' ', workingDir: 'M' }
      ]
    }

    it('useMergeState に依存を渡し、戻り値を mergeState として公開する', () => {
      const confirmDiscardAnyDirty = vi.fn(() => true)
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        confirmDiscardAnyDirty,
        reloadOpenFiles,
        refreshTree
      })
      const refreshGitStatus = vi.fn()
      mockUseGitStatus.mockReturnValue({
        gitStatus: conflictedStatus,
        gitLoading: false,
        gitError: null,
        refreshGitStatus
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseMergeState).toHaveBeenCalledWith(
        expect.objectContaining({
          gitStatus: conflictedStatus,
          refreshGitStatus,
          refreshHistory: expect.any(Function),
          fileLock: expect.anything(),
          confirmDiscardAnyDirty,
          reloadOpenFiles,
          refreshTree
        })
      )
      expect(result.current.mergeState).toBe(mockMergeStatePanel)
    })

    it('useConflictFile に依存を渡し、アクティブな diff タブがコンフリクト中ならそのパスを activePath にする', () => {
      const hasDirtyTabAtOrInside = vi.fn()
      const reloadOpenFile = vi.fn()
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        hasDirtyTabAtOrInside,
        reloadOpenFile,
        refreshTree
      })
      const refreshGitStatus = vi.fn()
      mockUseGitStatus.mockReturnValue({
        gitStatus: conflictedStatus,
        gitLoading: false,
        gitError: null,
        refreshGitStatus
      })
      mockUseDiffTabs.mockReturnValue({
        ...mockUseDiffTabs(),
        activeDiffTab: { path: 'a.txt', staged: false }
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseConflictFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          activePath: 'a.txt',
          gitStatus: conflictedStatus,
          refreshGitStatus,
          fileLock: expect.anything(),
          hasDirtyTabAtOrInside,
          reloadOpenFile,
          refreshTree,
          folderPath: '/project'
        })
      )
      expect(result.current.conflictFile).toBe(mockConflictFileState)
      expect(result.current.isActiveFileConflicted).toBe(true)
    })

    it('アクティブな diff タブがコンフリクト中でなければ activePath は null', () => {
      mockUseGitStatus.mockReturnValue({
        gitStatus: conflictedStatus,
        gitLoading: false,
        gitError: null,
        refreshGitStatus: vi.fn()
      })
      mockUseDiffTabs.mockReturnValue({
        ...mockUseDiffTabs(),
        activeDiffTab: { path: 'm.txt', staged: false }
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseConflictFile).toHaveBeenLastCalledWith(
        expect.objectContaining({ activePath: null })
      )
      expect(result.current.isActiveFileConflicted).toBe(false)
    })

    // CLI の rebase / cherry-pick 中(MERGE_HEAD が無い)は ours/theirs の意味が逆になるため、
    // 未解決のファイルでも解決ビューを出さず(getConflictFile も呼ばせず)、通常の diff 表示にする
    it('マージ中でなければ、未解決のファイルの diff タブでも activePath は null', () => {
      mockUseGitStatus.mockReturnValue({
        gitStatus: { ...conflictedStatus, mergeInProgress: false },
        gitLoading: false,
        gitError: null,
        refreshGitStatus: vi.fn()
      })
      mockUseDiffTabs.mockReturnValue({
        ...mockUseDiffTabs(),
        activeDiffTab: { path: 'a.txt', staged: false }
      })
      const { result } = renderHook(() => useAppState())
      expect(mockUseConflictFile).toHaveBeenLastCalledWith(
        expect.objectContaining({ activePath: null })
      )
      expect(result.current.isActiveFileConflicted).toBe(false)
    })
  })

  describe('stash(退避)', () => {
    it('useStashPanel の戻り値を stash として公開し、依存を渡す', () => {
      const confirmDiscardAnyDirty = vi.fn(() => true)
      const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockResolvedValue(true)
      mockUseFileSystem.mockReturnValue({
        ...mockUseFileSystem(),
        folderPath: '/project',
        confirmDiscardAnyDirty,
        reloadOpenFiles,
        refreshTree
      })
      const refreshGitStatus = vi.fn()
      mockUseGitStatus.mockReturnValue({
        gitStatus: null,
        gitLoading: false,
        gitError: null,
        refreshGitStatus
      })
      mockUseStashPanel.mockReturnValue(mockStashPanel)
      const { result } = renderHook(() => useAppState())
      expect(mockUseStashPanel).toHaveBeenCalled()
      expect(mockUseStashPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          folderPath: '/project',
          confirmDiscardAnyDirty,
          reloadOpenFiles,
          refreshTree,
          gitStatus: null,
          refreshGitStatus,
          fileOperationLock: expect.anything()
        })
      )
      expect(result.current.stash).toBe(mockStashPanel)
    })
  })

  describe('gitTag(タグの作成)', () => {
    it('useGitTagOperations に gitStatus・履歴の再取得・共有ロックを渡し、戻り値を gitTag として公開する', () => {
      const refreshHistory = vi.fn()
      mockUseGitHistory.mockReturnValue({
        log: [],
        branches: [],
        tags: [],
        hasMore: false,
        isLoading: false,
        loadMore: vi.fn(),
        refresh: refreshHistory
      })
      const status = {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 0,
        behind: 0,
        files: []
      }
      mockUseGitStatus.mockReturnValue({
        gitStatus: status,
        gitLoading: false,
        gitError: null,
        refreshGitStatus: vi.fn()
      })
      const panel = makeGitTagPanelState()
      mockUseGitTagOperations.mockReturnValue(panel)
      const { result } = renderHook(() => useAppState())
      expect(mockUseGitTagOperations).toHaveBeenCalledWith(
        status,
        refreshHistory,
        expect.anything()
      )
      // 他の Git 操作と同じロックを渡す(別のロックだと、checkout などの途中でも作成できてしまう)
      const sharedLock = mockUseStashPanel.mock.calls[0][0].fileOperationLock
      expect(mockUseGitTagOperations.mock.calls[0][2]).toBe(sharedLock)
      expect(result.current.gitTag).toBe(panel)
    })
  })

  describe('remoteSetup(初期化・origin の追加・初回 push)', () => {
    const repoStatus: GitStatusResult = {
      isRepo: true,
      mergeInProgress: false,
      hasOrigin: true,
      hasRemote: true,
      upstream: null,
      detached: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: []
    }

    const setupStatusAndHistory = (): {
      refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
      refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
    } => {
      const refreshGitStatus = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      const refreshHistory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      mockUseGitStatus.mockReturnValue({
        gitStatus: repoStatus,
        gitLoading: false,
        gitError: null,
        refreshGitStatus
      })
      mockUseGitHistory.mockReturnValue({
        log: [],
        branches: [],
        tags: [],
        hasMore: false,
        isLoading: false,
        loadMore: vi.fn(),
        refresh: refreshHistory
      })
      return { refreshGitStatus, refreshHistory }
    }

    it('useGitRemoteSetup に gitStatus・ステータスと履歴の再取得・共有ロックを渡し、初回 push の状態と合わせて公開する', () => {
      const { refreshGitStatus, refreshHistory } = setupStatusAndHistory()
      const setupState = makeRemoteSetupPanelState()
      mockUseGitRemoteSetup.mockReturnValue(setupState)
      const { result } = renderHook(() => useAppState())
      expect(mockUseGitRemoteSetup).toHaveBeenCalledWith(
        repoStatus,
        refreshGitStatus,
        refreshHistory,
        expect.anything()
      )
      // 他の Git 操作と同じロックを渡す(別のロックだと、commit などの途中でも初期化・追加できてしまう)
      const sharedLock = mockUseStashPanel.mock.calls[0][0].fileOperationLock
      expect(mockUseGitRemoteSetup.mock.calls[0][3]).toBe(sharedLock)
      const { remoteSetup } = result.current
      expect(remoteSetup.initRepository).toBe(setupState.initRepository)
      expect(remoteSetup.addOrigin).toBe(setupState.addOrigin)
      // 初回 push の 5 項目は useGitRemoteOperations のもの
      expect(remoteSetup.pushSetUpstream).toBe(result.current.pushSetUpstream)
      expect(remoteSetup.isSettingUpstream).toBe(false)
      expect(remoteSetup.isPushing).toBe(result.current.isPushing)
      expect(remoteSetup.isPushBlocked).toBe(result.current.isPushBlocked)
      expect(remoteSetup.remoteOperationError).toBe(result.current.remoteOperationError)
    })

    // useGitRemoteOperations の 4 番目の引数(refreshHistory)を渡していることを、実物のフックで確かめる(差分 3)
    it('初回 push の後に、ステータスと履歴を取り直す', async () => {
      const { refreshGitStatus, refreshHistory } = setupStatusAndHistory()
      const originalPushSetUpstream = window.api.pushSetUpstream
      window.api.pushSetUpstream = vi.fn().mockResolvedValue(undefined)
      try {
        const { result } = renderHook(() => useAppState())
        await act(async () => {
          await result.current.remoteSetup.pushSetUpstream()
        })
        expect(window.api.pushSetUpstream).toHaveBeenCalledOnce()
        expect(refreshGitStatus).toHaveBeenCalled()
        expect(refreshHistory).toHaveBeenCalled()
      } finally {
        window.api.pushSetUpstream = originalPushSetUpstream
      }
    })

    // ツールバーの push の実行中は isPushing だけが真で、初回 push の実行中(isSettingUpstream)ではない。
    // 合成で取り違えると、バナーのボタンが「push 中...」になり案内も出てしまう
    it('ツールバーの push の実行中は、remoteSetup の isPushing だけが真になる', async () => {
      setupStatusAndHistory()
      mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState())
      const originalPush = window.api.push
      let resolvePush: () => void = () => {}
      window.api.push = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvePush = resolve
          })
      )
      try {
        const { result } = renderHook(() => useAppState())
        let pushing: Promise<void> = Promise.resolve()
        act(() => {
          pushing = result.current.push()
        })
        expect(result.current.remoteSetup.isPushing).toBe(true)
        expect(result.current.remoteSetup.isSettingUpstream).toBe(false)
        await act(async () => {
          resolvePush()
          await pushing
        })
      } finally {
        window.api.push = originalPush
      }
    })
  })

  it('gitStatus が null(フォルダ未読み込み等)の間は diffTab を閉じない', () => {
    // vi.clearAllMocks() は呼び出し履歴のみクリアし、前のテストで
    // mockReturnValue した実装は残留する。ここで明示的に再設定しないと、
    // 直前のテストの gitStatus(files あり)がそのまま使われてしまう
    const mockCloseDiffTab = vi.fn()
    mockUseDiffTabs.mockReturnValue({
      diffTabs: [{ path: 'a.txt', staged: false }],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: mockCloseDiffTab,
      activateDiffTab: vi.fn(),
      deactivateDiffTab: vi.fn()
    })
    mockUseGitStatus.mockReturnValue({
      gitStatus: null,
      gitLoading: false,
      gitError: null,
      refreshGitStatus: vi.fn()
    })
    renderHook(() => useAppState())
    expect(mockCloseDiffTab).not.toHaveBeenCalled()
  })

  describe('clone(リポジトリの clone)', () => {
    it('useCloneRepository に useFileSystem の確認・未保存の判定・開く処理と共有ロックを渡し、clone として公開する', () => {
      const fileSystemDeps = {
        captureDirtySnapshot: vi.fn(() => '[]'),
        confirmDiscardAnyDirty: vi.fn(() => true),
        applyOpenedFolder: vi.fn(() => Promise.resolve())
      }
      mockUseFileSystem.mockReturnValueOnce({
        ...mockUseFileSystem.getMockImplementation()!(),
        ...fileSystemDeps
      })
      const cloneState = makeCloneRepositoryPanelState()
      mockUseCloneRepository.mockReturnValue(cloneState)
      const { result } = renderHook(() => useAppState())
      const options = mockUseCloneRepository.mock.calls[0][0]
      expect(options.captureDirtySnapshot).toBe(fileSystemDeps.captureDirtySnapshot)
      expect(options.confirmDiscardAnyDirty).toBe(fileSystemDeps.confirmDiscardAnyDirty)
      expect(options.applyOpenedFolder).toBe(fileSystemDeps.applyOpenedFolder)
      // 他の Git 操作と同じロック(別のロックだと、clone の間に commit などを始められる)
      expect(options.lock).toBe(mockUseStashPanel.mock.calls[0][0].fileOperationLock)
      expect(options.isGitOperationRunning).toBe(false)
      expect(result.current.clone).toBe(cloneState)
    })

    it.each([
      [
        'タグの作成中',
        () => mockUseGitTagOperations.mockReturnValue(makeGitTagPanelState({ isCreating: true }))
      ],
      [
        'リポジトリの初期化中',
        () =>
          mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState({ isInitializing: true }))
      ],
      [
        'origin の追加中',
        () =>
          mockUseGitRemoteSetup.mockReturnValue(makeRemoteSetupPanelState({ isAddingOrigin: true }))
      ]
    ])('%s は Git 操作の実行中として渡す', (_label, arrange) => {
      arrange()
      renderHook(() => useAppState())
      expect(mockUseCloneRepository.mock.calls[0][0].isGitOperationRunning).toBe(true)
    })

    // ロックを取る操作(commit・pull など)は実行中フラグを持たないため、ロックの保持も「Git 操作の実行中」に含める。
    // 含めないと、clone のボタンは押せるのに useCloneRepository が lock.isAnyLocked() で何も言わずに断る
    it('共有ロックの保持中は Git 操作の実行中として渡し、解けたら外す', () => {
      renderHook(() => useAppState())
      const sharedLock = mockUseStashPanel.mock.calls[0][0].fileOperationLock
      act(() => sharedLock.lockGlobal())
      expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(true)
      act(() => sharedLock.unlockGlobal())
      expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(false)
    })

    // ロックを取らない操作(fetch・push・初回 push・ブランチの削除)は実行中フラグで見る。useGitRemoteOperations・
    // useGitBranchOperations はこのテストでは実物のため、IPC(window.api)を保留させて実行中を作る
    describe('ロックを取らない Git 操作の実行中', () => {
      const cloneRepoStatus: GitStatusResult = {
        isRepo: true,
        mergeInProgress: false,
        hasOrigin: true,
        hasRemote: true,
        upstream: 'origin/main',
        detached: false,
        branch: 'main',
        ahead: 1,
        behind: 0,
        files: []
      }

      it.each([
        {
          label: 'fetch',
          api: 'fetchRemote' as const,
          settled: undefined,
          start: (state: ReturnType<typeof useAppState>) => state.fetchRemote()
        },
        {
          label: 'push',
          api: 'push' as const,
          settled: undefined,
          start: (state: ReturnType<typeof useAppState>) => state.push()
        },
        {
          label: '初回 push',
          api: 'pushSetUpstream' as const,
          settled: undefined,
          start: (state: ReturnType<typeof useAppState>) => state.remoteSetup.pushSetUpstream()
        },
        {
          label: 'ブランチの削除',
          api: 'deleteBranch' as const,
          settled: { deleted: true },
          start: (state: ReturnType<typeof useAppState>) => state.deleteBranch('feature/x')
        }
      ])(
        '$label の実行中は Git 操作の実行中として渡し、終わったら外す',
        async ({ api, settled, start }) => {
          mockUseGitStatus.mockReturnValue({
            gitStatus: cloneRepoStatus,
            gitLoading: false,
            gitError: null,
            refreshGitStatus: vi.fn().mockResolvedValue(undefined)
          })
          const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
          const original = window.api[api]
          let settle: () => void = () => {}
          window.api[api] = vi.fn(
            () =>
              new Promise((resolve) => {
                settle = () => resolve(settled as never)
              })
          ) as never
          try {
            const { result } = renderHook(() => useAppState())
            expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(false)
            let running: Promise<unknown> = Promise.resolve()
            act(() => {
              running = start(result.current)
            })
            expect(window.api[api]).toHaveBeenCalledOnce()
            expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(true)
            await act(async () => {
              settle()
              await running
            })
            expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(false)
          } finally {
            window.api[api] = original as never
            confirmSpy.mockRestore()
          }
        }
      )
    })

    // 退避の削除(drop)はロックを取らないため、退避の実行中フラグ(stash.pendingOperation)で見る。
    // useStashPanel はこのファイルでは静的モックのため、実行中の戻り値に差し替えて再描画する
    it('退避の削除の実行中は Git 操作の実行中として渡し、終わったら外す', () => {
      mockUseStashPanel.mockReturnValue({
        ...mockStashPanel,
        pendingOperation: { kind: 'drop', sha: 'abc123' }
      })
      const { rerender } = renderHook(() => useAppState())
      expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(true)
      mockUseStashPanel.mockReturnValue(mockStashPanel)
      rerender()
      expect(mockUseCloneRepository.mock.lastCall![0].isGitOperationRunning).toBe(false)
    })
  })
})
