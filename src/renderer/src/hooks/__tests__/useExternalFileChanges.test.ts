import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExternalFileChangeEvent } from '@shared/types'
import type { OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useExternalChangeMarks } from '../useExternalChangeMarks'
import { EXTERNAL_RELOAD_CONFIRM_MESSAGE, useExternalFileChanges } from '../useExternalFileChanges'
import type {
  ExternalChangeBannerState,
  UseExternalFileChangesOptions
} from '../useExternalFileChanges'

const mockRead = vi.mocked(fileSystemApi.readFileContent)
const mockSetWatched = vi.mocked(fileSystemApi.setWatchedFiles)
const mockOnChange = vi.mocked(fileSystemApi.onExternalFileChange)

const file = (path: string, content: string, savedContent = content): OpenFile => ({
  path,
  name: path.split('/').pop() ?? path,
  content,
  savedContent,
  language: 'plaintext'
})

// 解決を外から決める Promise(読み込み・保存の実行中を再現する)
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let emitChange: (event: ExternalFileChangeEvent) => void
let tabs: Map<string, OpenFile>

type Overrides = Partial<Omit<UseExternalFileChangesOptions, 'marks'>>
type Rendered = RenderHookResult<ExternalChangeBannerState | null, { files: OpenFile[] }> & {
  replaceCleanTabWithDisk: ReturnType<
    typeof vi.fn<UseExternalFileChangesOptions['replaceCleanTabWithDisk']>
  >
  reloadOpenFile: ReturnType<typeof vi.fn<UseExternalFileChangesOptions['reloadOpenFile']>>
}

function renderExternal(initial: OpenFile[], overrides: Overrides = {}): Rendered {
  tabs = new Map(initial.map((f) => [f.path, f]))
  const replaceCleanTabWithDisk = vi.fn<UseExternalFileChangesOptions['replaceCleanTabWithDisk']>(
    (path, expected, disk) => {
      const current = tabs.get(path)
      if (
        current === undefined ||
        current.content !== expected.content ||
        current.content !== current.savedContent
      )
        return false
      if (disk === null) tabs.delete(path)
      else tabs.set(path, { ...current, content: disk, savedContent: disk })
      return true
    }
  )
  const reloadOpenFile = vi.fn<UseExternalFileChangesOptions['reloadOpenFile']>(
    async () => undefined
  )
  const hook = renderHook(
    ({ files }: { files: OpenFile[] }) => {
      const marks = useExternalChangeMarks()
      return useExternalFileChanges({
        openFiles: files,
        activeFilePath: files[0]?.path ?? null,
        isFileTabActive: true,
        getOpenFileSnapshot: (path) => tabs.get(path) ?? null,
        waitForPendingSave: async () => undefined,
        replaceCleanTabWithDisk,
        reloadOpenFile,
        marks,
        onConfirm: () => true,
        ...overrides
      })
    },
    { initialProps: { files: initial } }
  )
  return { ...hook, replaceCleanTabWithDisk, reloadOpenFile }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockSetWatched.mockResolvedValue(undefined)
  mockOnChange.mockImplementation((listener) => {
    emitChange = listener
    return () => undefined
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useExternalFileChanges', () => {
  // 確かめの途中の想定外の例外(読み込みの失敗は disk = null に変換済み)は、記録して握る。次の通知では確かめ直す
  it('確かめの途中で想定外の例外が起きたら記録して握り、次の通知でまた確かめる', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = new Error('boom')
    const waitForPendingSave = vi
      .fn<UseExternalFileChangesOptions['waitForPendingSave']>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValue(undefined)
    mockRead.mockResolvedValue('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')], { waitForPendingSave })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), boom))
    expect(result.current).toBeNull()
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
  })

  // main はフォルダが変わると監視をすべて閉じる。フォルダを切り替えてもタブが残る経路(走査の間にファイルを開いた・
  // 未保存の確認でキャンセルした)では、タブの一覧が変わらないため、フォルダの変化でも送り直す
  it('開いているフォルダが変わったら、タブの一覧が同じでも監視の対象を送り直す', async () => {
    const files = [file('/p/a.ts', 'x')]
    tabs = new Map(files.map((f) => [f.path, f]))
    const { rerender } = renderHook(
      ({ folderPath }: { folderPath: string | null }) => {
        const marks = useExternalChangeMarks()
        return useExternalFileChanges({
          openFiles: files,
          activeFilePath: '/p/a.ts',
          isFileTabActive: true,
          folderPath,
          getOpenFileSnapshot: (path) => tabs.get(path) ?? null,
          waitForPendingSave: async () => undefined,
          replaceCleanTabWithDisk: () => false,
          reloadOpenFile: async () => undefined,
          marks,
          onConfirm: () => true
        })
      },
      { initialProps: { folderPath: '/p' as string | null } }
    )
    await waitFor(() => expect(mockSetWatched).toHaveBeenCalledTimes(1))
    rerender({ folderPath: '/p' })
    expect(mockSetWatched).toHaveBeenCalledTimes(1)
    rerender({ folderPath: '/p/sub' })
    await waitFor(() => expect(mockSetWatched).toHaveBeenCalledTimes(2))
    expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/a.ts'])
  })

  it('開いているタブのパスを監視の対象にし、一覧が変わったら置き換える', async () => {
    const { rerender } = renderExternal([file('/p/a.ts', 'x')])
    await waitFor(() => expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/a.ts']))
    rerender({ files: [file('/p/a.ts', 'x'), file('/p/b.ts', 'y')] })
    await waitFor(() => expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/a.ts', '/p/b.ts']))
  })

  it('未編集のタブはディスクの内容に置き換え、通知を出さない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() =>
      expect(replaceCleanTabWithDisk).toHaveBeenCalledWith(
        '/p/a.ts',
        { content: 'old', savedContent: 'old' },
        'agent'
      )
    )
    expect(result.current).toBeNull()
  })

  it('ディスクが savedContent と同じなら何もしない(自分の保存・同じ内容の書き込み)', async () => {
    mockRead.mockResolvedValueOnce('old')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'edited', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('編集中のタブは内容を変えずに modified の通知を出す', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(tabs.get('/p/a.ts')?.content).toBe('mine')
  })

  it('読む間に打鍵された(置き換えが断られた)ら modified の通知を出す', async () => {
    mockRead.mockImplementationOnce(async () => {
      tabs.set('/p/a.ts', file('/p/a.ts', 'typed', 'old'))
      return 'agent'
    })
    const { result } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    expect(tabs.get('/p/a.ts')?.content).toBe('typed')
  })

  it('置き換えには、読む前に取った未編集の控えを渡す(読む間の打鍵を控えに含めない)', async () => {
    mockRead.mockImplementationOnce(async () => {
      tabs.set('/p/a.ts', file('/p/a.ts', 'typed', 'old'))
      return 'agent'
    })
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    expect(replaceCleanTabWithDisk).toHaveBeenCalledOnce()
    const [, expected] = replaceCleanTabWithDisk.mock.calls[0]
    expect(expected).toEqual({ content: 'old', savedContent: 'old' })
    expect(expected.content).toBe(expected.savedContent)
  })

  it('削除された未編集のタブは閉じ、編集中のタブは deleted の通知を出す(再読込のボタンは無い)', async () => {
    mockRead.mockRejectedValue(new Error('ファイルが見つかりません'))
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old'), file('/p/b.ts', 'clean')])
    await act(async () => emitChange({ paths: ['/p/a.ts', '/p/b.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('deleted'))
    expect(result.current?.reload).toBeNull()
    expect(tabs.has('/p/b.ts')).toBe(false)
  })

  it('保存の実行中なら、終わってから確かめる', async () => {
    let finishSave: () => void = () => undefined
    const waitForPendingSave = vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve)))
    mockRead.mockResolvedValueOnce('saved')
    renderExternal([file('/p/a.ts', 'saved', 'saved')], { waitForPendingSave })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    expect(mockRead).not.toHaveBeenCalled()
    await act(async () => finishSave())
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('/p/a.ts'))
  })

  it('自分の保存の直後に届いた通知は、保存の完了を待ってから savedContent と比べ、外部変更と誤認しない', async () => {
    const save = deferred<void>()
    const waitForPendingSave = vi
      .fn<UseExternalFileChangesOptions['waitForPendingSave']>()
      .mockReturnValueOnce(
        save.promise.then(() => {
          tabs.set('/p/a.ts', file('/p/a.ts', 'mine', 'mine'))
        })
      )
      .mockResolvedValue(undefined)
    mockRead.mockResolvedValueOnce('mine')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'mine', 'old')], {
      waitForPendingSave
    })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await act(async () => save.resolve())
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('/p/a.ts'))
    await act(async () => undefined)
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('読む間に保存された(savedContent が変わった)ら、読み直して確かめ、外部変更と誤認しない', async () => {
    mockRead
      .mockImplementationOnce(async () => {
        tabs.set('/p/a.ts', file('/p/a.ts', 'mine', 'mine'))
        return 'mine'
      })
      .mockResolvedValueOnce('mine')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('読む間に始まった保存は、終わるまで待ってから比べ、外部変更と誤認しない', async () => {
    const save = deferred<void>()
    const waitForPendingSave = vi
      .fn<UseExternalFileChangesOptions['waitForPendingSave']>()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(
        save.promise.then(() => {
          tabs.set('/p/a.ts', file('/p/a.ts', 'mine', 'mine'))
        })
      )
      .mockResolvedValue(undefined)
    mockRead
      .mockImplementationOnce(async () => {
        // 読む間に打鍵して保存を始めた(書き込みは済み、savedContent はまだ古い)
        tabs.set('/p/a.ts', file('/p/a.ts', 'mine', 'old'))
        return 'mine'
      })
      .mockResolvedValueOnce('mine')
    const { result, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')], {
      waitForPendingSave
    })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalledOnce())
    await act(async () => save.resolve())
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })

  it('ウィンドウのフォーカスの復帰で全タブを確かめる', async () => {
    mockRead.mockResolvedValue('same')
    renderExternal([file('/p/a.ts', 'same'), file('/p/b.ts', 'same')])
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
  })

  it('ウィンドウが再び表示された(visibilitychange)ときも全タブを確かめる', async () => {
    mockRead.mockResolvedValue('same')
    renderExternal([file('/p/a.ts', 'same'), file('/p/b.ts', 'same')])
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
  })

  it('再描画では購読を張り直さず、破棄で通知・フォーカス・visibility の購読をすべて外す', async () => {
    const unsubscribe = vi.fn()
    mockOnChange.mockReset()
    mockOnChange.mockImplementationOnce((listener) => {
      emitChange = listener
      return unsubscribe
    })
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const addDocument = vi.spyOn(document, 'addEventListener')
    const removeDocument = vi.spyOn(document, 'removeEventListener')
    const { rerender, unmount } = renderExternal([file('/p/a.ts', 'x')])
    rerender({ files: [file('/p/a.ts', 'y')] })
    rerender({ files: [file('/p/a.ts', 'z'), file('/p/b.ts', 'w')] })
    expect(mockOnChange).toHaveBeenCalledOnce()
    const focusAdds = addWindow.mock.calls.filter(([type]) => type === 'focus')
    const visibilityAdds = addDocument.mock.calls.filter(([type]) => type === 'visibilitychange')
    expect(focusAdds).toHaveLength(1)
    expect(visibilityAdds).toHaveLength(1)
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(removeWindow).toHaveBeenCalledWith('focus', focusAdds[0][1])
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', visibilityAdds[0][1])
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await act(async () => undefined)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('破棄の後に読み終えた確認は、タブを置き換えない', async () => {
    const read = deferred<string>()
    mockRead.mockReturnValueOnce(read.promise)
    const { unmount, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalledOnce())
    unmount()
    await act(async () => read.resolve('agent'))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
  })

  it('読む間にタブが閉じられたら、置き換えも印も付けない(開き直しても通知は出ない)', async () => {
    const read = deferred<string>()
    mockRead.mockReturnValueOnce(read.promise)
    const { result, rerender, replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalledOnce())
    tabs.delete('/p/a.ts')
    rerender({ files: [] })
    await act(async () => read.resolve('agent'))
    expect(replaceCleanTabWithDisk).not.toHaveBeenCalled()
    tabs.set('/p/a.ts', file('/p/a.ts', 'mine', 'old'))
    rerender({ files: [file('/p/a.ts', 'mine', 'old')] })
    expect(result.current).toBeNull()
  })

  it('閉じたタブの印を捨てる(開き直しても前の通知を出さない)', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result, rerender } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    rerender({ files: [] })
    rerender({ files: [file('/p/a.ts', 'mine', 'old')] })
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('複数のタブが同時に変わったら、それぞれを置き換える', async () => {
    mockRead.mockImplementation(async (path: string) => `agent:${path}`)
    const { replaceCleanTabWithDisk } = renderExternal([file('/p/a.ts', 'a'), file('/p/b.ts', 'b')])
    await act(async () => emitChange({ paths: ['/p/a.ts', '/p/b.ts'] }))
    await waitFor(() => expect(replaceCleanTabWithDisk).toHaveBeenCalledTimes(2))
    expect(tabs.get('/p/a.ts')?.content).toBe('agent:/p/a.ts')
    expect(tabs.get('/p/b.ts')?.content).toBe('agent:/p/b.ts')
  })

  it('同じパスの通知の連打は、確かめている間の分を 1 回にまとめる', async () => {
    const first = deferred<string>()
    mockRead.mockReturnValueOnce(first.promise).mockResolvedValue('old')
    renderExternal([file('/p/a.ts', 'old')])
    await act(async () => {
      emitChange({ paths: ['/p/a.ts'] })
      emitChange({ paths: ['/p/a.ts'] })
      emitChange({ paths: ['/p/a.ts'] })
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(mockRead).toHaveBeenCalledOnce())
    await act(async () => first.resolve('old'))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(mockRead).toHaveBeenCalledTimes(2)
  })

  it('ディスクが savedContent に戻ったら通知を消す(出し続けない)', async () => {
    mockRead.mockResolvedValueOnce('agent').mockResolvedValueOnce('old')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('監視の対象は、パスの一覧が変わったときだけ送り、破棄で空にする', async () => {
    const { rerender, unmount } = renderExternal([file('/p/a.ts', 'x')])
    await waitFor(() => expect(mockSetWatched).toHaveBeenCalledTimes(1))
    rerender({ files: [file('/p/a.ts', 'edited')] })
    expect(mockSetWatched).toHaveBeenCalledTimes(1)
    rerender({ files: [file('/p/b.ts', 'y')] })
    expect(mockSetWatched).toHaveBeenLastCalledWith(['/p/b.ts'])
    unmount()
    expect(mockSetWatched).toHaveBeenLastCalledWith([])
  })

  it('「ディスクの内容を読み込む」は確認の後に読み込み直し、印を消す。キャンセルなら何もしない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const onConfirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { result, reloadOpenFile } = renderExternal([file('/p/a.ts', 'mine', 'old')], {
      onConfirm
    })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.reload?.())
    expect(reloadOpenFile).not.toHaveBeenCalled()
    await act(async () => result.current?.reload?.())
    expect(onConfirm).toHaveBeenLastCalledWith(EXTERNAL_RELOAD_CONFIRM_MESSAGE)
    expect(reloadOpenFile).toHaveBeenCalledWith('/p/a.ts')
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('「このまま編集する」で印を消す', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => result.current?.dismiss())
    expect(result.current).toBeNull()
  })

  it('modified を「このまま編集する」で消したら、同じディスクの内容のままフォーカス・再表示が来ても通知し直さない', async () => {
    mockRead.mockResolvedValue('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.dismiss())
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(3))
    await act(async () => undefined)
    expect(result.current).toBeNull()
  })

  it('消した後にディスクの内容がさらに変わったら、また通知する', async () => {
    mockRead.mockResolvedValueOnce('agent').mockResolvedValueOnce('agent2')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.dismiss())
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
  })

  it('deleted を消したら、削除されたままフォーカスが来ても通知し直さない', async () => {
    mockRead.mockRejectedValue(new Error('ファイルが見つかりません'))
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('deleted'))
    act(() => result.current?.dismiss())
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(result.current).toBeNull()
  })

  it('消した後に保存した(savedContent が変わった)ら覚えを捨て、同じディスクの内容でも通知する', async () => {
    mockRead.mockResolvedValue('agent')
    const { result, rerender } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.dismiss())
    // 保存して、さらに編集した。ディスクはまた 'agent' に書き換えられた
    const saved = file('/p/a.ts', 'mine2', 'mine')
    tabs.set('/p/a.ts', saved)
    rerender({ files: [saved] })
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
  })

  it('消した後にディスクが savedContent に戻ったら覚えを捨て、同じ内容に変わればまた通知する', async () => {
    mockRead
      .mockResolvedValueOnce('agent')
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.dismiss())
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
  })

  it('消した後にタブを閉じたら覚えを捨て、開き直して同じ内容でも通知する', async () => {
    mockRead.mockResolvedValue('agent')
    const { result, rerender } = renderExternal([file('/p/a.ts', 'mine', 'old')])
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    act(() => result.current?.dismiss())
    rerender({ files: [] })
    rerender({ files: [file('/p/a.ts', 'mine', 'old')] })
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
  })

  // 保存の照合で上書きをキャンセルしたとき(useAppState の onSaveConflict)は、印を直接付けず確認を通す。確認が「知らせた
  // ディスクの内容」を控えるので、「このまま編集する」で消した後にフォーカスの復帰で出し直さない(設計書「編集中のタブへの
  // 通知」)。監視が拾わない変更(シンボリックリンクのタブ・取りこぼし)で起きる
  it('保存の照合からの確認の依頼で付いた印は、「このまま編集する」で消した後、フォーカスの復帰で出し直さない', async () => {
    mockRead.mockResolvedValue('agent')
    tabs = new Map([['/p/a.ts', file('/p/a.ts', 'mine', 'base')]])
    const { result } = renderHook(() => {
      const marks = useExternalChangeMarks()
      const banner = useExternalFileChanges({
        openFiles: [...tabs.values()],
        activeFilePath: '/p/a.ts',
        isFileTabActive: true,
        getOpenFileSnapshot: (path) => tabs.get(path) ?? null,
        waitForPendingSave: async () => undefined,
        replaceCleanTabWithDisk: () => false,
        reloadOpenFile: async () => undefined,
        marks,
        onConfirm: () => true
      })
      return { marks, banner }
    })
    act(() => result.current.marks.requestCheck('/p/a.ts', 'modified'))
    await waitFor(() => expect(result.current.banner?.kind).toBe('modified'))
    act(() => result.current.banner?.dismiss())
    expect(result.current.banner).toBeNull()
    await act(async () => window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2))
    await act(async () => undefined)
    expect(result.current.banner).toBeNull()
  })

  it('破棄の後は確認の依頼を受けない(依頼は印を直接付ける側に戻る)', async () => {
    tabs = new Map([['/p/a.ts', file('/p/a.ts', 'mine', 'base')]])
    const marksHook = renderHook(() => useExternalChangeMarks())
    const { unmount } = renderHook(() =>
      useExternalFileChanges({
        openFiles: [...tabs.values()],
        activeFilePath: '/p/a.ts',
        isFileTabActive: true,
        getOpenFileSnapshot: (path) => tabs.get(path) ?? null,
        waitForPendingSave: async () => undefined,
        replaceCleanTabWithDisk: () => false,
        reloadOpenFile: async () => undefined,
        marks: marksHook.result.current,
        onConfirm: () => true
      })
    )
    unmount()
    act(() => marksHook.result.current.requestCheck('/p/a.ts', 'deleted'))
    expect(mockRead).not.toHaveBeenCalled()
    expect(marksHook.result.current.get('/p/a.ts')).toBe('deleted')
  })

  it('別のタブの再読込の最中でも、表示中のタブの「ディスクの内容を読み込む」は働く', async () => {
    mockRead.mockResolvedValue('agent')
    const a = file('/p/a.ts', 'mine', 'old')
    const b = file('/p/b.ts', 'mine', 'old')
    const { result, rerender, reloadOpenFile } = renderExternal([a, b])
    await act(async () => emitChange({ paths: ['/p/a.ts', '/p/b.ts'] }))
    await waitFor(() => expect(result.current?.kind).toBe('modified'))
    const reloadA = deferred<void>()
    reloadOpenFile.mockReturnValueOnce(reloadA.promise)
    act(() => result.current?.reload?.())
    expect(reloadOpenFile).toHaveBeenLastCalledWith('/p/a.ts')
    rerender({ files: [b, a] })
    await waitFor(() => expect(result.current?.path).toBe('/p/b.ts'))
    act(() => result.current?.reload?.())
    expect(reloadOpenFile).toHaveBeenLastCalledWith('/p/b.ts')
    await act(async () => reloadA.resolve())
  })

  it('diff タブの表示中は通知を出さない', async () => {
    mockRead.mockResolvedValueOnce('agent')
    const { result } = renderExternal([file('/p/a.ts', 'mine', 'old')], { isFileTabActive: false })
    await act(async () => emitChange({ paths: ['/p/a.ts'] }))
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
