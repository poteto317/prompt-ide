import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { GitStatusResult } from '@shared/types'
import type { DiffTabKey } from '../useDiffTabs'

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

import { useAppState } from '../useAppState'

beforeEach(() => {
  vi.clearAllMocks()
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
      gitStatus: { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] },
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

  describe('checkoutBranch ラッパー', () => {
    // checkout は working tree のファイルを直接書き換えるが、エディタのバッファは
    // 別に保持しているため連動しない。確認なしに切り替えると、切替前の内容を
    // 編集したまま保存した際に切替後のブランチのファイルを無警告で上書きして
    // しまう(コードレビュー指摘)。confirmDiscardAnyDirty で破棄を確認し、
    // 成功後は開いている全タブをディスクの最新内容へ同期する
    function setup(options: {
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
        gitStatus: { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] },
        gitLoading: false,
        gitError: null,
        refreshGitStatus: vi.fn().mockResolvedValue(undefined)
      })
    }

    it('未保存編集が無ければ確認どおり checkout を実行し、成功後に開いているファイルを再読込する', async () => {
      const mockConfirmDiscardAnyDirty = vi.fn(() => true)
      const mockReloadOpenFiles = vi.fn().mockResolvedValue(undefined)
      setup({
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
      setup({
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
      setup({
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
})
