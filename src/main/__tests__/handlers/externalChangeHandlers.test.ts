import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'node:path'

const mockRealpath = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockWriteFileContent = vi.hoisted(() => vi.fn())
const mockCreateFileContent = vi.hoisted(() => vi.fn())
const mockFromId = vi.hoisted(() => vi.fn())
// 外部変更の通知の送り先(所有者の webContents)を探す Electron の API だけを差し替える
vi.mock('electron', () => ({ webContents: { fromId: mockFromId } }))
vi.mock('node:fs/promises', () => ({ default: { realpath: mockRealpath }, realpath: mockRealpath }))
vi.mock('../../fileSystem', () => ({
  readFileContent: mockReadFileContent,
  writeFileContent: mockWriteFileContent,
  createFileContent: mockCreateFileContent
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { OpenFileWatcher } from '../../openFileWatcher'
import {
  registerExternalChangeHandlers,
  sendExternalChange
} from '../../handlers/externalChangeHandlers'
import { NO_GLOBAL_INSTRUCTIONS } from '../helpers/globalAgentInstructionContext'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const event = { sender: { id: 1 } }
const enoent = (): NodeJS.ErrnoException => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
const eexist = (): NodeJS.ErrnoException => Object.assign(new Error('EEXIST'), { code: 'EEXIST' })

let folderAccess: FolderAccessManager
let watcher: OpenFileWatcher
let setWatchedFiles: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  handles.clear()
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  mockWriteFileContent.mockResolvedValue(undefined)
  mockCreateFileContent.mockResolvedValue(undefined)
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, '/work')
  watcher = new OpenFileWatcher({ watch: vi.fn(), notify: vi.fn() })
  setWatchedFiles = vi.spyOn(watcher, 'setWatchedFiles').mockImplementation(() => undefined)
  vi.spyOn(watcher, 'clear')
  registerExternalChangeHandlers(ipcMain as never, folderAccess, watcher, NO_GLOBAL_INSTRUCTIONS)
})

const writeChecked = (path: unknown, content: unknown, base: unknown): Promise<unknown> =>
  handles.get('fs:writeFileChecked')?.(event, path, content, base) as Promise<unknown>

describe('fs:writeFileChecked', () => {
  it('ディスクが基準と同じなら書き込んで written', async () => {
    mockReadFileContent.mockResolvedValueOnce('old')
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({ kind: 'written' })
    expect(mockWriteFileContent).toHaveBeenCalledWith('/work/a.ts', 'new')
  })

  it('ディスクが違えば書き込まずに modified', async () => {
    mockReadFileContent.mockResolvedValueOnce('agent')
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('ファイルが無ければ書き込まずに deleted(許可の確認は親フォルダへ倒す)', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    mockReadFileContent.mockRejectedValueOnce(enoent())
    await expect(writeChecked('/work/a.ts', 'new', 'old')).resolves.toEqual({
      kind: 'conflict',
      reason: 'deleted'
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('基準が null なら照合せずに書く(削除されたファイルを作り直す)', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    await expect(writeChecked('/work/a.ts', 'new', null)).resolves.toEqual({ kind: 'written' })
    expect(mockReadFileContent).not.toHaveBeenCalled()
    // 解決できないパスは排他的作成で書く(ぶら下がったシンボリックリンクを辿らない)
    expect(mockCreateFileContent).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('基準が null で存在するファイルは上書きする(上書きの確認で OK の後)', async () => {
    await expect(writeChecked('/work/a.ts', 'new', null)).resolves.toEqual({ kind: 'written' })
    expect(mockWriteFileContent).toHaveBeenCalledWith('/work/a.ts', 'new')
    expect(mockCreateFileContent).not.toHaveBeenCalled()
  })

  it('解決できなかったパスの排他的作成が EEXIST なら modified(照合と書き込みの間に復活した)', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/a.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    mockCreateFileContent.mockRejectedValueOnce(eexist())
    await expect(writeChecked('/work/a.ts', 'new', null)).resolves.toEqual({
      kind: 'conflict',
      reason: 'modified'
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it('許可の範囲外は書き込まずに投げる', async () => {
    await expect(writeChecked('/etc/passwd', 'x', null)).rejects.toThrow('Access denied')
    expect(mockWriteFileContent).not.toHaveBeenCalled()
  })

  it.each([
    ['path が文字列でない', 1, 'x', 'y'],
    ['content が文字列でない', '/work/a.ts', 1, 'y'],
    ['baseContent が文字列でも null でもない', '/work/a.ts', 'x', 1]
  ])('%s なら投げる', async (_label, path, content, base) => {
    await expect(writeChecked(path, content, base)).rejects.toThrow()
  })
})

describe('fs:setWatchedFiles', () => {
  const setWatched = (paths: unknown): Promise<unknown> =>
    handles.get('fs:setWatchedFiles')?.(event, paths) as Promise<unknown>

  it('許可の範囲内で存在するパスだけを監視する', async () => {
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/gone.ts' ? Promise.reject(enoent()) : Promise.resolve(resolvePath(p))
    )
    await setWatched(['/work/a.ts', '/etc/passwd', '/work/gone.ts', 3])
    expect(setWatchedFiles).toHaveBeenCalledWith(1, ['/work/a.ts'])
  })

  it('フォルダを開いていなければ監視を閉じる', async () => {
    folderAccess.delete(1)
    await setWatched(['/work/a.ts'])
    expect(watcher.clear).toHaveBeenCalledWith(1)
    expect(setWatchedFiles).not.toHaveBeenCalled()
  })

  it('検証の間にフォルダが切り替わったら監視を張らない', async () => {
    mockRealpath.mockImplementationOnce(async (p: string) => {
      folderAccess.set(1, '/other')
      return resolvePath(p)
    })
    await setWatched(['/work/a.ts'])
    expect(setWatchedFiles).not.toHaveBeenCalled()
  })

  it('相対パス・長すぎるパスは監視しない', async () => {
    const long = `/work/${'x'.repeat(5000)}.ts`
    mockRealpath.mockImplementation((p: string) =>
      Promise.resolve(p === 'rel.ts' ? '/work/rel.ts' : resolvePath(p))
    )
    await setWatched(['rel.ts', long, '/work/a.ts'])
    expect(setWatchedFiles).toHaveBeenCalledExactlyOnceWith(1, ['/work/a.ts'])
  })

  it('呼び出しが重なったら最新の呼び出しの一覧だけを反映する(遅い古い呼び出しが後から勝たない)', async () => {
    let releaseSlow: () => void = () => undefined
    mockRealpath.mockImplementation((p: string) =>
      p === '/work/slow.ts'
        ? new Promise((resolve) => {
            releaseSlow = () => resolve(resolvePath(p))
          })
        : Promise.resolve(resolvePath(p))
    )
    const slow = setWatched(['/work/slow.ts', '/work/old.ts'])
    await setWatched(['/work/new.ts'])
    releaseSlow()
    await slow
    expect(setWatchedFiles.mock.calls).toEqual([[1, ['/work/new.ts']]])
  })

  it('検証の間に監視が閉じられたら(リロード)旧ページの一覧で張り直さない', async () => {
    let release: () => void = () => undefined
    mockRealpath.mockImplementationOnce(
      (p: string) =>
        new Promise((resolve) => {
          release = () => resolve(resolvePath(p))
        })
    )
    const pending = setWatched(['/work/a.ts'])
    watcher.clear(1)
    release()
    await pending
    expect(setWatchedFiles).not.toHaveBeenCalled()
  })

  it('配列でない・上限を超える一覧は投げる', async () => {
    await expect(setWatched('x')).rejects.toThrow()
    await expect(setWatched(Array.from({ length: 1001 }, (_, i) => `/work/${i}`))).rejects.toThrow()
  })
})

// ipcHandlers.ts から移した(チャンネル名を handler の側にそろえる)
describe('sendExternalChange', () => {
  it('所有者の webContents へ fs:externalChange を送る', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
    sendExternalChange(3, ['/a'])
    expect(mockFromId).toHaveBeenCalledWith(3)
    expect(send).toHaveBeenCalledWith('fs:externalChange', { paths: ['/a'] })
  })

  it('破棄済み・見つからないときは送らない', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => true, send })
    sendExternalChange(3, ['/a'])
    mockFromId.mockReturnValueOnce(undefined)
    expect(() => sendExternalChange(4, ['/b'])).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })

  it('確認と送信の間に破棄されて send が例外を投げても、呼び出し元へ投げない', () => {
    mockFromId.mockReturnValueOnce({
      isDestroyed: () => false,
      send: () => {
        throw new Error('Object has been destroyed')
      }
    })
    expect(() => sendExternalChange(3, ['/a'])).not.toThrow()
  })
})
