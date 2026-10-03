import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockFromWebContents = vi.hoisted(() => vi.fn())
const mockChooseCloneParentDialog = vi.hoisted(() => vi.fn<() => Promise<string | null>>())
const mockCloneRepository = vi.hoisted(() =>
  vi.fn<
    (
      url: string,
      folderName: string,
      parentDir: string,
      signal: AbortSignal
    ) => Promise<CloneRepositoryResult>
  >()
)

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: mockFromWebContents } }))
vi.mock('../../dialogService', () => ({ chooseCloneParentDialog: mockChooseCloneParentDialog }))
// URL・フォルダ名の検証(assertValidCloneRequest)は実物を使い、clone の実行だけを差し替える
vi.mock('../../gitCloneService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../gitCloneService')>()),
  cloneRepository: mockCloneRepository
}))

import { CLONE_ALREADY_RUNNING_MESSAGE, CloneRegistry } from '../../cloneRegistry'
import { CLONE_FOLDER_NAME_MESSAGES } from '../../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../../gitRemoteUrlMessages'
import { registerCloneHandlers } from '../../handlers/cloneHandlers'

const mockIpcMain = { handle: mockHandle } as never
const URL = 'https://github.com/a/b.git'

function makeFolderAccess(): FolderAccessManager & { set: ReturnType<typeof vi.fn> } {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn()
  } as unknown as FolderAccessManager & { set: ReturnType<typeof vi.fn> }
}

function makeEvent(senderId: number, destroyed = false): unknown {
  return { sender: { id: senderId, isDestroyed: () => destroyed } }
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let folderAccess: ReturnType<typeof makeFolderAccess>
let registry: CloneRegistry

beforeEach(() => {
  // 持続する実装は使わず、各テストで Once を設定する(パターン 103)
  mockHandle.mockReset()
  mockFromWebContents.mockReset()
  mockChooseCloneParentDialog.mockReset()
  mockCloneRepository.mockReset()
  mockFromWebContents.mockReturnValue({ id: 'window' })
  folderAccess = makeFolderAccess()
  registry = new CloneRegistry()
  registerCloneHandlers(mockIpcMain, folderAccess, registry)
})

describe('git:cloneRepository', () => {
  it('送信元のウィンドウのダイアログで親フォルダを選び、URL・フォルダ名・親・中止の口だけで clone する', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const event = makeEvent(1) as { sender: unknown }
    const result = await getRegisteredHandler('git:cloneRepository')(event, URL, 'b', 'extra', 1)
    expect(result).toEqual({ status: 'cloned', path: '/parent/b' })
    expect(mockFromWebContents).toHaveBeenCalledWith(event.sender)
    expect(mockChooseCloneParentDialog).toHaveBeenCalledWith({ id: 'window' })
    expect(mockCloneRepository).toHaveBeenCalledOnce()
    const args = mockCloneRepository.mock.calls[0]
    expect(args).toHaveLength(4)
    expect(args.slice(0, 3)).toEqual([URL, 'b', '/parent'])
    expect(args[3]).toBeInstanceOf(AbortSignal)
    expect(registry.isRunning(1)).toBe(false)
  })

  // 失敗・中止・取り消しで切り替えないことは、それぞれのテストが見る
  it('成功したら、送信元のウィンドウの許可を clone 先のフォルダに切り替える', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    expect(folderAccess.set).toHaveBeenCalledOnce()
    expect(folderAccess.set).toHaveBeenCalledWith(1, '/parent/b')
  })

  it.each([
    ['URL が文字列でない', 1, 'b', 'Invalid remote url'],
    ['フォルダ名が文字列でない', URL, null, 'Invalid folder name'],
    ['URL が許可リストに無い', 'ext::sh -c x', 'b', REMOTE_URL_RULE_MESSAGES['invalid-char']],
    ['フォルダ名が空', URL, '', CLONE_FOLDER_NAME_MESSAGES.empty],
    ['フォルダ名にパス区切り', URL, 'a/b', CLONE_FOLDER_NAME_MESSAGES.invalid]
  ])('%s なら、ダイアログを出さずに拒否する', async (_label, url, name, message) => {
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), url, name)
    ).rejects.toThrow(message)
    expect(mockChooseCloneParentDialog).not.toHaveBeenCalled()
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('ダイアログを取り消したら clone せずに canceled', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce(null)
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')).toEqual({
      status: 'canceled'
    })
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(folderAccess.set).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('clone の中止(canceled)では、開くフォルダの許可を変えない', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'canceled' })
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')).toEqual({
      status: 'canceled'
    })
    expect(folderAccess.set).not.toHaveBeenCalled()
  })

  it('clone の失敗はそのまま投げ、開くフォルダの許可を変えず、実行中を解く', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    ).rejects.toThrow('リポジトリを clone できませんでした: x')
    expect(folderAccess.set).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('ダイアログの失敗でも実行中を解く', async () => {
    mockChooseCloneParentDialog.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    ).rejects.toThrow('dialog failed')
    expect(registry.isRunning(1)).toBe(false)
  })

  it('同じウィンドウで実行中なら拒否する(別のウィンドウは実行できる)', async () => {
    const dialog = deferred<string | null>()
    mockChooseCloneParentDialog.mockReturnValueOnce(dialog.promise)
    const first = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'c')
    ).rejects.toThrow(CLONE_ALREADY_RUNNING_MESSAGE)
    mockChooseCloneParentDialog.mockResolvedValueOnce(null)
    await expect(
      getRegisteredHandler('git:cloneRepository')(makeEvent(2), URL, 'c')
    ).resolves.toEqual({ status: 'canceled' })
    dialog.resolve(null)
    await expect(first).resolves.toEqual({ status: 'canceled' })
  })

  it('ダイアログの表示中に中止されたら、選ばれても clone しない', async () => {
    const dialog = deferred<string | null>()
    mockChooseCloneParentDialog.mockReturnValueOnce(dialog.promise)
    const running = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))
    dialog.resolve('/parent')
    await expect(running).resolves.toEqual({ status: 'canceled' })
    expect(mockCloneRepository).not.toHaveBeenCalled()
  })

  it('git が成功しても、その時点で中止されていたら(リロードなど)許可を登録せずに canceled', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    // service が中止を見落として cloned を返した場合の防御(2 層目)。返す直前に中止された状態を作る
    mockCloneRepository.mockImplementationOnce(async () => {
      registry.cancel(1)
      return { status: 'cloned', path: '/parent/b' }
    })
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')).toEqual({
      status: 'canceled'
    })
    expect(folderAccess.set).not.toHaveBeenCalled()
    expect(registry.isRunning(1)).toBe(false)
  })

  it('成功の時点でウィンドウが閉じていたら、許可を登録せずに canceled', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    expect(await getRegisteredHandler('git:cloneRepository')(makeEvent(1, true), URL, 'b')).toEqual(
      { status: 'canceled' }
    )
    expect(folderAccess.set).not.toHaveBeenCalled()
  })
})

describe('git:cancelCloneRepository', () => {
  it('同じウィンドウの実行中の clone の中止の口を中止する', async () => {
    mockChooseCloneParentDialog.mockResolvedValueOnce('/parent')
    const clone = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(clone.promise)
    const running = getRegisteredHandler('git:cloneRepository')(makeEvent(1), URL, 'b')
    await vi.waitFor(() => expect(mockCloneRepository).toHaveBeenCalledOnce())
    const signal = mockCloneRepository.mock.calls[0][3]
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(2))
    expect(signal.aborted).toBe(false)
    await getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))
    expect(signal.aborted).toBe(true)
    clone.resolve({ status: 'canceled' })
    await expect(running).resolves.toEqual({ status: 'canceled' })
  })

  it('実行中でなければ何もしない', async () => {
    expect(() => getRegisteredHandler('git:cancelCloneRepository')(makeEvent(1))).not.toThrow()
  })
})
