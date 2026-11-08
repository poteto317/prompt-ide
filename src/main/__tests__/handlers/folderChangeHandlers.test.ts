import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFromId = vi.hoisted(() => vi.fn())
// 通知の送り先(所有者の webContents)を探す Electron の API だけを差し替える
vi.mock('electron', () => ({ webContents: { fromId: mockFromId } }))

import { registerFolderChangeHandlers, sendFolderChange } from '../../handlers/folderChangeHandlers'
import type { FolderChangeEvent } from '@shared/types'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = { handle: (channel: string, listener: Listener) => handles.set(channel, listener) }
const watcher = { enable: vi.fn(), disable: vi.fn() }

const setFolderWatch = (enabled: unknown): unknown =>
  handles.get('fs:setFolderWatch')?.({ sender: { id: 7 } }, enabled)

beforeEach(() => {
  handles.clear()
  vi.clearAllMocks()
  registerFolderChangeHandlers(ipcMain as never, watcher)
})

describe('fs:setFolderWatch', () => {
  it('true → 送信元の id で enable を同期で呼ぶ', () => {
    expect(setFolderWatch(true)).toBeUndefined()
    expect(watcher.enable).toHaveBeenCalledExactlyOnceWith(7)
    expect(watcher.disable).not.toHaveBeenCalled()
  })

  it('false → 送信元の id で disable を呼ぶ', () => {
    setFolderWatch(false)
    expect(watcher.disable).toHaveBeenCalledExactlyOnceWith(7)
    expect(watcher.enable).not.toHaveBeenCalled()
  })

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['文字列', 'true'],
    ['数', 1],
    ['null', null]
  ])('%s → 例外にし、どちらも呼ばない', (_label, value) => {
    expect(() => setFolderWatch(value)).toThrow('enabled は真偽値である必要があります')
    expect(watcher.enable).not.toHaveBeenCalled()
    expect(watcher.disable).not.toHaveBeenCalled()
  })
})

describe('sendFolderChange', () => {
  it('所有者の webContents へ fs:folderChange を送る', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
    sendFolderChange(3, { treeChanged: false })
    expect(mockFromId).toHaveBeenCalledWith(3)
    expect(send).toHaveBeenCalledWith('fs:folderChange', { treeChanged: false })
  })

  it('余分な欄(パスなど)が紛れた event → 送ってよい欄だけを送る', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
    const event = { treeChanged: true, path: '/secret/a.txt' } as FolderChangeEvent
    sendFolderChange(3, event)
    expect(send).toHaveBeenCalledWith('fs:folderChange', { treeChanged: true })
  })

  it('破棄済み・見つからない・送信で投げる → 呼び出し元へ投げない', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => true, send })
    sendFolderChange(3, { treeChanged: true })
    mockFromId.mockReturnValueOnce(undefined)
    expect(() => sendFolderChange(4, { treeChanged: true })).not.toThrow()
    mockFromId.mockReturnValueOnce({
      isDestroyed: () => false,
      send: () => {
        throw new Error('Object has been destroyed')
      }
    })
    expect(() => sendFolderChange(5, { treeChanged: true })).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
