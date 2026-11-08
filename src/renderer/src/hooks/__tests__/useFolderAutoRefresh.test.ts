import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { FolderChangeEvent } from '@shared/types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import {
  FOLDER_AUTO_REFRESH_MAX_WAIT_MS,
  FOLDER_AUTO_REFRESH_WAIT_MS,
  useFolderAutoRefresh
} from '../useFolderAutoRefresh'
import type { FolderAutoRefreshOptions } from '../useFolderAutoRefresh'

const mockSetFolderWatch = vi.mocked(fileSystemApi.setFolderWatch)
const mockOnFolderChange = vi.mocked(fileSystemApi.onFolderChange)
let folderListener: ((event: FolderChangeEvent) => void) | null = null
const unsubscribe = vi.fn()

type Mocked<K extends keyof FolderAutoRefreshOptions> = ReturnType<
  typeof vi.fn<Exclude<FolderAutoRefreshOptions[K], string | null>>
>

function setup(
  overrides: Partial<FolderAutoRefreshOptions> = {},
  // 関数の wrapper で StrictMode を包む(({ children }) => createElement(StrictMode, null, children))と、
  // effect の二重実行が起きず空振りになる(React 19.2 + Testing Library 16.3.2 で確かめた)。
  // `wrapper: StrictMode` か reactStrictMode を使う。ここでは reactStrictMode で包む
  reactStrictMode = false
): {
  options: FolderAutoRefreshOptions & {
    refreshTreeQuietly: Mocked<'refreshTreeQuietly'>
    refreshGitStatusQuietly: Mocked<'refreshGitStatusQuietly'>
    refreshDiffQuietly: Mocked<'refreshDiffQuietly'>
  }
  update: (next: Partial<FolderAutoRefreshOptions>) => void
  unmount: () => void
} {
  const options = {
    folderPath: '/repo',
    refreshTreeQuietly: vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(
      async () => undefined
    ),
    refreshGitStatusQuietly: vi.fn<FolderAutoRefreshOptions['refreshGitStatusQuietly']>(
      async () => true
    ),
    refreshDiffQuietly: vi.fn<FolderAutoRefreshOptions['refreshDiffQuietly']>(),
    isFolderScanPending: () => false,
    ...overrides
  }
  let props: FolderAutoRefreshOptions = options
  const { rerender, unmount } = renderHook(
    (p: FolderAutoRefreshOptions) => useFolderAutoRefresh(p),
    { initialProps: props, reactStrictMode }
  )
  return {
    options: options as never,
    update: (next) => {
      props = { ...props, ...next }
      rerender(props)
    },
    unmount
  }
}

const emitFolderChange = (event: FolderChangeEvent): void => {
  act(() => {
    folderListener?.(event)
  })
}

const focusWindow = (): void => {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}

const changeVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  folderListener = null
  mockSetFolderWatch.mockResolvedValue(undefined)
  // 解除したら、そのリスナーへ通知が届かないようにする(古いリスナーが生き残ると、「初回だけ」の購読でも通ってしまう。L-469)
  mockOnFolderChange.mockImplementation((listener) => {
    folderListener = listener
    return () => {
      unsubscribe()
      if (folderListener === listener) folderListener = null
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

// 待ち・上限・実行中のもう 1 回・reset と accepts での捨て方の規則そのものは refreshScheduler.test.ts で確かめる。
// ここでは、hook が渡す待ちの時間・merge(tree の論理和)・フォルダの有無と、契機の購読・監視の依頼・取り直しの中身の順序を確かめる
describe('useFolderAutoRefresh', () => {
  it('マウント → setFolderWatch(true)。アンマウント → setFolderWatch(false) と購読の解除', () => {
    const { unmount } = setup()
    expect(mockSetFolderWatch.mock.calls).toEqual([[true]])
    unmount()
    expect(mockSetFolderWatch.mock.calls).toEqual([[true], [false]])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('treeChanged: true → 待ちの後にツリー・git status・diff を静かに取り直す', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS - 1)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('treeChanged: false → git status と diff だけ', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('ウィンドウの focus・visible → ツリー・git status・diff。hidden → 走らない', async () => {
    const { options } = setup()
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    changeVisibility('hidden')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    changeVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshDiffQuietly).toHaveBeenCalledTimes(2)
  })

  it('待ちの間の契機(focus と visibilitychange、通知)を 1 回にまとめ、tree は論理和', async () => {
    const { options } = setup()
    emitFolderChange({ treeChanged: false })
    focusWindow()
    changeVisibility('visible')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
  })

  it('実行中の契機 → 終わった後の 1 回にまとめる', async () => {
    let finishTree: () => void = () => undefined
    const refreshTreeQuietly = vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(
      () =>
        new Promise<void>((resolve) => {
          finishTree = resolve
        })
    )
    const { options } = setup({ refreshTreeQuietly })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    emitFolderChange({ treeChanged: true })
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    refreshTreeQuietly.mockResolvedValue(undefined)
    await act(async () => {
      finishTree()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledTimes(2)
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledTimes(2)
  })

  it('走査中 → ツリーは頼むが、git status と diff は呼ばない', async () => {
    const { options } = setup({ isFolderScanPending: () => true })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    expect(options.refreshGitStatusQuietly).not.toHaveBeenCalled()
    expect(options.refreshDiffQuietly).not.toHaveBeenCalled()
  })

  it('git status の取得が受け入れられなかった(false。取得の間に走査が始まった等) → diff を呼ばない', async () => {
    const { options } = setup({
      refreshGitStatusQuietly: vi.fn<FolderAutoRefreshOptions['refreshGitStatusQuietly']>(
        async () => false
      )
    })
    emitFolderChange({ treeChanged: false })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).not.toHaveBeenCalled()
  })

  it('ツリーの取り直しが reject しても → git status と diff は走る(並べて allSettled で待つ)', async () => {
    const { options } = setup({
      refreshTreeQuietly: vi.fn<FolderAutoRefreshOptions['refreshTreeQuietly']>(async () => {
        throw new Error('unexpected')
      })
    })
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshGitStatusQuietly).toHaveBeenCalledOnce()
    expect(options.refreshDiffQuietly).toHaveBeenCalledOnce()
  })

  it('フォルダが null → 何もしない', async () => {
    const { options } = setup({ folderPath: null })
    emitFolderChange({ treeChanged: true })
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
    expect(options.refreshGitStatusQuietly).not.toHaveBeenCalled()
  })

  it('フォルダの切り替え → 前のフォルダの予約を捨てる', async () => {
    const { options, update } = setup()
    emitFolderChange({ treeChanged: true })
    update({ folderPath: '/other' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
  })

  it('アンマウントの後 → 予約のタイマーが走らない(L-108)', async () => {
    const { options, unmount } = setup()
    emitFolderChange({ treeChanged: true })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_MAX_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).not.toHaveBeenCalled()
  })

  it('StrictMode の二重実行 → 監視の依頼は true → false → true の順で、購読が残る(L-469)', async () => {
    const { options } = setup({}, true)
    expect(mockSetFolderWatch.mock.calls).toEqual([[true], [false], [true]])
    // 購読は 2 回登録され、1 回目は解除済み(2 回目のリスナーが生きている)
    expect(mockOnFolderChange).toHaveBeenCalledTimes(2)
    expect(unsubscribe).toHaveBeenCalledOnce()
    // 通知と focus は同じ待ちでまとめられるので、別々に進めて数える(どちらの購読が外れていても落ちるように)
    emitFolderChange({ treeChanged: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledOnce()
    focusWindow()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOLDER_AUTO_REFRESH_WAIT_MS)
    })
    expect(options.refreshTreeQuietly).toHaveBeenCalledTimes(2)
  })
})
