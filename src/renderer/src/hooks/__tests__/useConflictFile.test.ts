import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConflictFile, GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useConflictFile } from '../useConflictFile'
import type { ConflictFileOptions, ConflictFileState } from '../useConflictFile'
import type { FileOperationLock } from '../useFileOperationLock'

const mockGetConflictFile = vi.mocked(gitApi.getConflictFile)
const mockResolveBlocks = vi.mocked(gitApi.resolveConflictBlocks)
const mockResolveWhole = vi.mocked(gitApi.resolveConflictWholeFile)
const mockKeep = vi.mocked(gitApi.keepConflictFile)
const mockRemove = vi.mocked(gitApi.removeConflictFile)
const mockMarkResolved = vi.mocked(gitApi.markConflictResolved)

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const makeParsed = (digests: string[]): ConflictFile => ({
  status: 'parsed',
  segments: [],
  digests,
  eol: '\n',
  stages: { ours: true, theirs: true }
})

const status: GitStatusResult = {
  isRepo: true,
  mergeInProgress: true,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [{ path: 'a.txt', index: 'U', workingDir: 'U' }]
}

type Props = { activePath: string | null; folderPath: string | null }

type SetupResult = RenderHookResult<ConflictFileState, Props> & {
  options: Omit<ConflictFileOptions, 'activePath' | 'folderPath'>
}

const setup = (
  overrides: Partial<ConflictFileOptions> = {},
  initial: Props = { activePath: 'a.txt', folderPath: '/project' }
): SetupResult => {
  const options = {
    gitStatus: status,
    refreshGitStatus: vi.fn().mockResolvedValue(undefined),
    fileLock: makeFileLock(),
    hasDirtyTabAtOrInside: vi.fn().mockReturnValue(false),
    reloadOpenFile: vi.fn().mockResolvedValue(undefined),
    refreshTree: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const hook = renderHook(
    (props: Props) =>
      useConflictFile({ ...options, activePath: props.activePath, folderPath: props.folderPath }),
    { initialProps: initial }
  )
  return { ...hook, options }
}

beforeEach(() => {
  vi.clearAllMocks()
  // 前のテストで消費されなかった mockResolvedValueOnce 等を持ち越さない
  mockGetConflictFile.mockReset()
  mockGetConflictFile.mockResolvedValue(makeParsed(['d1', 'd2']))
})

describe('useConflictFile: 読み込み', () => {
  it('activePath が null なら何もしない', () => {
    const { result } = setup({}, { activePath: null, folderPath: '/project' })
    expect(mockGetConflictFile).not.toHaveBeenCalled()
    expect(result.current.file).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('activePath があれば getConflictFile で読み込む', async () => {
    const { result } = setup()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.file).toEqual(makeParsed(['d1', 'd2'])))
    expect(mockGetConflictFile).toHaveBeenCalledWith('a.txt')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('読み込みに失敗すると error をセットし file は null', async () => {
    mockGetConflictFile.mockRejectedValue(new Error('読めない'))
    const { result } = setup()
    await waitFor(() => expect(result.current.error?.message).toBe('読めない'))
    expect(result.current.file).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('activePath を切り替えた後に遅れて解決した古い結果は反映しない', async () => {
    let resolveOld: (f: ConflictFile) => void = () => undefined
    mockGetConflictFile
      .mockReturnValueOnce(new Promise<ConflictFile>((r) => (resolveOld = r)))
      .mockResolvedValueOnce(makeParsed(['new']))
    const { result, rerender } = setup()
    rerender({ activePath: 'b.txt', folderPath: '/project' })
    await waitFor(() => expect(result.current.file).toEqual(makeParsed(['new'])))
    await act(async () => {
      resolveOld(makeParsed(['old']))
    })
    expect(result.current.file).toEqual(makeParsed(['new']))
  })

  it('activePath が null になった後に遅れて解決した結果は反映しない', async () => {
    let resolveOld: (f: ConflictFile) => void = () => undefined
    mockGetConflictFile.mockReturnValueOnce(new Promise<ConflictFile>((r) => (resolveOld = r)))
    const { result, rerender } = setup()
    rerender({ activePath: null, folderPath: '/project' })
    await act(async () => {
      resolveOld(makeParsed(['old']))
    })
    expect(result.current.file).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('フォルダを切り替えた後に遅れて解決した古い結果は反映しない', async () => {
    let resolveOld: (f: ConflictFile) => void = () => undefined
    mockGetConflictFile
      .mockReturnValueOnce(new Promise<ConflictFile>((r) => (resolveOld = r)))
      .mockResolvedValueOnce(makeParsed(['other']))
    const { result, rerender } = setup()
    rerender({ activePath: 'a.txt', folderPath: '/other' })
    await waitFor(() => expect(result.current.file).toEqual(makeParsed(['other'])))
    await act(async () => {
      resolveOld(makeParsed(['old']))
    })
    expect(result.current.file).toEqual(makeParsed(['other']))
  })
})

describe('useConflictFile: chooseBlock', () => {
  it('現在のダイジェストを expectedDigests として resolveConflictBlocks を呼ぶ', async () => {
    mockResolveBlocks.mockResolvedValue(undefined)
    const { result } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(1, 'theirs')
    })
    expect(mockResolveBlocks).toHaveBeenCalledWith('a.txt', ['d1', 'd2'], { 1: 'theirs' })
  })

  it('成功すると lockGlobal → 実行 → unlockGlobal し、タブの再読込・読み直し・ステータス再取得をする', async () => {
    const order: string[] = []
    mockResolveBlocks.mockImplementation(async () => {
      order.push('resolve')
    })
    mockGetConflictFile.mockResolvedValueOnce(makeParsed(['d1', 'd2']))
    const fileLock = makeFileLock({
      lockGlobal: vi.fn(() => order.push('lock')),
      unlockGlobal: vi.fn(() => order.push('unlock'))
    })
    const reloadOpenFile = vi.fn(async () => {
      order.push('reloadTab')
    })
    const { result, options } = setup({ fileLock, reloadOpenFile })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockGetConflictFile.mockResolvedValueOnce(makeParsed(['d2']))
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    // ロックは読み直し(タブの再読込・ビューの読み直し)が終わるまで握る
    expect(order).toEqual(['lock', 'resolve', 'reloadTab', 'unlock'])
    expect(reloadOpenFile).toHaveBeenCalledWith('/project/a.txt')
    expect(options.refreshGitStatus).toHaveBeenCalled()
    expect(result.current.file).toEqual(makeParsed(['d2']))
    expect(result.current.pendingOperation).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('実行中は pendingOperation が入る', async () => {
    let resolveIt: () => void = () => undefined
    mockResolveBlocks.mockReturnValue(new Promise<void>((r) => (resolveIt = r)))
    const { result } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    let promise: Promise<unknown> = Promise.resolve()
    act(() => {
      promise = result.current.chooseBlock(0, 'ours')
    })
    expect(result.current.pendingOperation).not.toBeNull()
    await act(async () => {
      resolveIt()
      await promise
    })
    expect(result.current.pendingOperation).toBeNull()
  })

  it('未保存編集があり破棄を拒否すると、書き込まずロックも取らない', async () => {
    const { result, options } = setup({
      hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true),
      onConfirm: vi.fn().mockReturnValue(false)
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/project/a.txt')
    expect(options.onConfirm).toHaveBeenCalledTimes(1)
    expect(mockResolveBlocks).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
  })

  it('未保存編集があっても破棄を承諾すれば書き込む', async () => {
    mockResolveBlocks.mockResolvedValue(undefined)
    const { result } = setup({
      hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true),
      onConfirm: vi.fn().mockReturnValue(true)
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(0, 'both')
    })
    expect(mockResolveBlocks).toHaveBeenCalledTimes(1)
  })

  it('未保存編集が無ければ確認を出さない', async () => {
    mockResolveBlocks.mockResolvedValue(undefined)
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(0, 'both')
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
  })

  it('失敗すると error をセットし、タブを再読込せずロックを解放する', async () => {
    mockResolveBlocks.mockRejectedValue(
      new Error('ファイルが変更されたため中止しました。開き直してください')
    )
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(result.current.error?.message).toBe(
      'ファイルが変更されたため中止しました。開き直してください'
    )
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
  })

  // 照合に失敗したら(エディタで手で解決した・CLI で書き換えた等)ビューを読み直し、
  // 古いブロックのまま操作できなくなるのを防ぐ。エラーの文言は残す
  it('照合に失敗すると、ビューを読み直して新しいブロックに置き換え、エラーは残す', async () => {
    mockResolveBlocks.mockRejectedValue(
      new Error('ファイルが変更されたため中止しました。開き直してください')
    )
    const { result } = setup()
    await waitFor(() => expect(result.current.file).toEqual(makeParsed(['d1', 'd2'])))
    mockGetConflictFile.mockClear()
    mockGetConflictFile.mockResolvedValueOnce(makeParsed([]))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.chooseBlock(0, 'ours')
    })
    expect(ok).toBe(false)
    expect(mockGetConflictFile).toHaveBeenCalledTimes(1)
    expect(mockGetConflictFile).toHaveBeenCalledWith('a.txt')
    expect(result.current.file).toEqual(makeParsed([]))
    expect(result.current.error?.message).toBe(
      'ファイルが変更されたため中止しました。開き直してください'
    )
    expect(result.current.isLoading).toBe(false)
  })

  it('失敗後の読み直しも失敗したら、操作のエラーを残す', async () => {
    mockResolveBlocks.mockRejectedValue(new Error('操作の失敗'))
    const { result } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockGetConflictFile.mockRejectedValueOnce(new Error('読み直しの失敗'))
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(result.current.error?.message).toBe('操作の失敗')
    expect(result.current.file).toBeNull()
  })

  it('ロック中などで実行しなかったとき(no-op)は読み直さない', async () => {
    const { result } = setup({
      fileLock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockGetConflictFile.mockClear()
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(mockGetConflictFile).not.toHaveBeenCalled()
  })

  // 操作の完了から読み直しの完了までの間に、古いダイジェストのままブロックを押せないようにする
  it('成功後の読み直しの間は pendingOperation とロックを保ち、もう一度押しても main を呼ばない', async () => {
    mockResolveBlocks.mockResolvedValue(undefined)
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    let resolveReload: (f: ConflictFile) => void = () => undefined
    mockGetConflictFile.mockReturnValueOnce(new Promise<ConflictFile>((r) => (resolveReload = r)))
    let first: Promise<boolean> = Promise.resolve(false)
    await act(async () => {
      first = result.current.chooseBlock(0, 'ours')
    })
    await waitFor(() => expect(mockGetConflictFile).toHaveBeenCalledTimes(2))
    expect(result.current.pendingOperation).toBe('block')
    expect(options.fileLock.unlockGlobal).not.toHaveBeenCalled()
    let second: boolean | undefined
    await act(async () => {
      second = await result.current.chooseBlock(1, 'theirs')
    })
    expect(second).toBe(false)
    expect(mockResolveBlocks).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveReload(makeParsed(['d2']))
      await first
    })
    expect(result.current.pendingOperation).toBeNull()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
    expect(result.current.file).toEqual(makeParsed(['d2']))
  })

  it('他の操作がロック中なら何もしない', async () => {
    const { result } = setup({
      fileLock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(mockResolveBlocks).not.toHaveBeenCalled()
  })

  it('解析できないファイル(unparsable)では何もしない', async () => {
    mockGetConflictFile.mockResolvedValue({
      status: 'unparsable',
      reason: 'markers',
      stages: { ours: true, theirs: true }
    })
    const { result } = setup()
    await waitFor(() => expect(result.current.file).toMatchObject({ status: 'unparsable' }))
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(mockResolveBlocks).not.toHaveBeenCalled()
  })

  it('activePath が null なら何もしない', async () => {
    const { result } = setup({}, { activePath: null, folderPath: '/project' })
    await act(async () => {
      await result.current.chooseBlock(0, 'ours')
    })
    expect(mockResolveBlocks).not.toHaveBeenCalled()
  })

  it('実行中に activePath が切り替わったら、古いファイルの読み直しを反映しない', async () => {
    let resolveIt: () => void = () => undefined
    mockResolveBlocks.mockReturnValue(new Promise<void>((r) => (resolveIt = r)))
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    let promise: Promise<unknown> = Promise.resolve()
    act(() => {
      promise = result.current.chooseBlock(0, 'ours')
    })
    mockGetConflictFile.mockResolvedValueOnce(makeParsed(['b-digest']))
    rerender({ activePath: 'b.txt', folderPath: '/project' })
    await waitFor(() => expect(result.current.file).toEqual(makeParsed(['b-digest'])))
    mockGetConflictFile.mockClear()
    await act(async () => {
      resolveIt()
      await promise
    })
    expect(mockGetConflictFile).not.toHaveBeenCalled()
    expect(result.current.file).toEqual(makeParsed(['b-digest']))
  })
})

describe('useConflictFile: ファイル単位の操作', () => {
  it('resolveWholeFile は側を渡し、成功で読み直す', async () => {
    mockResolveWhole.mockResolvedValue(undefined)
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockGetConflictFile.mockClear()
    await act(async () => {
      await result.current.resolveWholeFile('theirs')
    })
    expect(mockResolveWhole).toHaveBeenCalledWith('a.txt', 'theirs')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/project/a.txt')
    expect(mockGetConflictFile).toHaveBeenCalledWith('a.txt')
    expect(options.refreshGitStatus).toHaveBeenCalled()
  })

  it('resolveWholeFile は未保存編集の破棄を拒否されると書き込まない', async () => {
    const { result } = setup({
      hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true),
      onConfirm: vi.fn().mockReturnValue(false)
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.resolveWholeFile('ours')
    })
    expect(mockResolveWhole).not.toHaveBeenCalled()
  })

  it('removeFile は削除し、タブを再読込してステータスを更新する(コンフリクトの読み直しはしない)', async () => {
    mockRemove.mockResolvedValue(undefined)
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockGetConflictFile.mockClear()
    await act(async () => {
      await result.current.removeFile()
    })
    expect(mockRemove).toHaveBeenCalledWith('a.txt')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/project/a.txt')
    expect(mockGetConflictFile).not.toHaveBeenCalled()
    expect(options.refreshGitStatus).toHaveBeenCalled()
  })

  it('removeFile は削除の確認(パス入り)を出し、拒否されるとロックも取らず削除しない', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result, options } = setup({ onConfirm })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.removeFile()
    })
    expect(onConfirm).toHaveBeenCalledWith('a.txt を削除してマージの解決にしますか？')
    expect(mockRemove).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
  })

  it('removeFile は確認を許可すると削除する', async () => {
    mockRemove.mockResolvedValue(undefined)
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = setup({ onConfirm })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.removeFile()
    })
    expect(onConfirm).toHaveBeenCalledWith('a.txt を削除してマージの解決にしますか？')
    expect(mockRemove).toHaveBeenCalledWith('a.txt')
  })

  it('chooseBlock は成功すると true、失敗すると false を返す', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    mockResolveBlocks.mockResolvedValueOnce(undefined)
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.chooseBlock(0, 'ours')
    })
    expect(ok).toBe(true)
    mockResolveBlocks.mockRejectedValueOnce(new Error('失敗'))
    await act(async () => {
      ok = await result.current.chooseBlock(0, 'ours')
    })
    expect(ok).toBe(false)
  })

  it('removeFile は未保存編集の破棄を拒否されると削除しない', async () => {
    const { result } = setup({
      hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true),
      onConfirm: vi.fn().mockReturnValue(false)
    })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.removeFile()
    })
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('keepFile はファイルを残し、ステータスを更新する(ファイルの内容は変わらないためタブは触れない)', async () => {
    mockKeep.mockResolvedValue(undefined)
    const { result, options } = setup({ hasDirtyTabAtOrInside: vi.fn().mockReturnValue(true) })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.keepFile()
    })
    expect(mockKeep).toHaveBeenCalledWith('a.txt')
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.refreshGitStatus).toHaveBeenCalled()
  })

  it('markResolved は解決済みにし、そのあとステータスを再取得する', async () => {
    const order: string[] = []
    mockMarkResolved.mockImplementation(async () => {
      order.push('mark')
    })
    const refreshGitStatus = vi.fn(async () => {
      order.push('refresh')
    })
    const { result, options } = setup({ refreshGitStatus })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.markResolved()
    })
    expect(mockMarkResolved).toHaveBeenCalledWith('a.txt')
    expect(order).toEqual(['mark', 'refresh'])
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it.each([
    ['keepFile', mockKeep],
    ['markResolved', mockMarkResolved],
    ['removeFile', mockRemove]
  ] as const)('%s が失敗すると error をセットし、ロックを解放する', async (name, mock) => {
    mock.mockRejectedValue(new Error('失敗した'))
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current[name]()
    })
    expect(result.current.error?.message).toBe('失敗した')
    expect(options.fileLock.lockGlobal).toHaveBeenCalledTimes(1)
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })
})

// ファイルの有無が変わり得る操作(削除・残す・すべて採用)の後は、エクスプローラーのツリーを読み直す
// (操作の直後に反映するため。フォルダの監視の通知は合流の待ちの後に届き、Linux では監視を張らない)。ブロックの選択・解決済みにするは内容か index だけを
// 変えるので読み直さない
describe('useConflictFile: エクスプローラーのツリーの読み直し', () => {
  const runners = {
    resolveWholeFile: (s: ConflictFileState) => s.resolveWholeFile('theirs'),
    keepFile: (s: ConflictFileState) => s.keepFile(),
    removeFile: (s: ConflictFileState) => s.removeFile(),
    chooseBlock: (s: ConflictFileState) => s.chooseBlock(0, 'ours'),
    markResolved: (s: ConflictFileState) => s.markResolved()
  }
  const mocks = {
    resolveWholeFile: mockResolveWhole,
    keepFile: mockKeep,
    removeFile: mockRemove,
    chooseBlock: mockResolveBlocks,
    markResolved: mockMarkResolved
  }
  const TREE_CHANGING = ['resolveWholeFile', 'keepFile', 'removeFile'] as const

  it.each(TREE_CHANGING)(
    '%s が成功すると、ロックを握ったまま(タブの再読込の後に)ツリーを読み直す',
    async (name) => {
      const order: string[] = []
      mocks[name].mockResolvedValue(undefined)
      const reloadOpenFile = vi.fn(async () => {
        order.push('reload')
      })
      const refreshTree = vi.fn(async () => {
        order.push('tree')
        return true
      })
      const fileLock = makeFileLock({ unlockGlobal: vi.fn(() => order.push('unlock')) })
      const { result } = setup({ reloadOpenFile, refreshTree, fileLock })
      await waitFor(() => expect(result.current.file).not.toBeNull())
      await act(async () => {
        await runners[name](result.current)
      })
      expect(refreshTree).toHaveBeenCalledTimes(1)
      expect(order.indexOf('tree')).toBeLessThan(order.indexOf('unlock'))
      if (order.includes('reload')) {
        expect(order.indexOf('reload')).toBeLessThan(order.indexOf('tree'))
      }
    }
  )

  it.each(TREE_CHANGING)(
    '%s の後のツリーの読み直しが失敗しても、操作は成功のまま(エラーを出さず、ロックも解放する)',
    async (name) => {
      mocks[name].mockResolvedValue(undefined)
      const refreshTree = vi.fn().mockRejectedValue(new Error('ツリーを読めない'))
      const { result, options } = setup({ refreshTree })
      await waitFor(() => expect(result.current.file).not.toBeNull())
      await act(async () => {
        await runners[name](result.current)
      })
      expect(refreshTree).toHaveBeenCalledTimes(1)
      expect(result.current.error).toBeNull()
      expect(result.current.pendingOperation).toBeNull()
      expect(options.refreshGitStatus).toHaveBeenCalled()
      expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
    }
  )

  it.each(TREE_CHANGING)('%s が失敗したときはツリーを読み直さない', async (name) => {
    mocks[name].mockRejectedValue(new Error('失敗した'))
    const { result, options } = setup()
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await runners[name](result.current)
    })
    expect(result.current.error?.message).toBe('失敗した')
    expect(options.refreshTree).not.toHaveBeenCalled()
  })

  it.each(['chooseBlock', 'markResolved'] as const)(
    '%s はファイルの有無を変えないので、成功してもツリーを読み直さない',
    async (name) => {
      mocks[name].mockResolvedValue(undefined)
      const { result, options } = setup()
      await waitFor(() => expect(result.current.file).not.toBeNull())
      await act(async () => {
        await runners[name](result.current)
      })
      expect(mocks[name]).toHaveBeenCalled()
      expect(options.refreshTree).not.toHaveBeenCalled()
    }
  )

  it('確認を拒否して実行しなかったとき(removeFile)はツリーを読み直さない', async () => {
    const { result, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    await waitFor(() => expect(result.current.file).not.toBeNull())
    await act(async () => {
      await result.current.removeFile()
    })
    expect(options.refreshTree).not.toHaveBeenCalled()
  })
})
