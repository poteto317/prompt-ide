import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  FOLDER_CHANGE_MAX_WAIT_MS,
  FOLDER_CHANGE_WAIT_MS,
  FolderChangeWatcher
} from '../folderChangeWatcher'
import type { FolderChangeWatcherDeps, FolderWatch, WatchFolder } from '../folderChangeWatcher'

afterEach(() => {
  vi.useRealTimers()
})

interface FakeWatch extends FolderWatch {
  folder: string
  closed: boolean
  fire(filename: string | Buffer | null): void
  fail(): void
}

function makeWatchFn(): { watch: ReturnType<typeof vi.fn<WatchFolder>>; watches: FakeWatch[] } {
  const watches: FakeWatch[] = []
  const watch = vi.fn<WatchFolder>((folder, listener) => {
    let onError: (err: Error) => void = () => undefined
    const fake: FakeWatch = {
      folder,
      closed: false,
      close: vi.fn(() => {
        fake.closed = true
      }),
      on: (_event, handler) => {
        onError = handler
        return fake
      },
      fire: (filename) => listener('rename', filename),
      fail: () => onError(new Error('EPERM'))
    }
    watches.push(fake)
    return fake
  })
  return { watch, watches }
}

function setup(overrides: Partial<FolderChangeWatcherDeps> = {}): {
  watcher: FolderChangeWatcher
  watch: ReturnType<typeof vi.fn<WatchFolder>>
  watches: FakeWatch[]
  notify: ReturnType<typeof vi.fn<FolderChangeWatcherDeps['notify']>>
  folders: Map<number, string>
} {
  const { watch, watches } = makeWatchFn()
  const notify = vi.fn<FolderChangeWatcherDeps['notify']>()
  const folders = new Map<number, string>()
  const watcher = new FolderChangeWatcher({
    watch,
    getFolder: (ownerId) => folders.get(ownerId),
    notify,
    platform: 'darwin',
    ...overrides
  })
  return { watcher, watch, watches, notify, folders }
}

describe('FolderChangeWatcher の張り方', () => {
  it('enable → 今の許可フォルダを張る', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    expect(watch).toHaveBeenCalledExactlyOnceWith('/repo', expect.any(Function))
    expect(watcher.watchedFolder(1)).toBe('/repo')
  })

  it('フォルダが無い間の enable → 張らず、onFolderChanged で張る', () => {
    const { watcher, watch, folders } = setup()
    watcher.enable(1)
    expect(watch).not.toHaveBeenCalled()
    folders.set(1, '/repo')
    watcher.onFolderChanged(1)
    expect(watch).toHaveBeenCalledExactlyOnceWith('/repo', expect.any(Function))
  })

  it('同じフォルダで enable を 2 回 → 張り直さない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watcher.enable(1)
    expect(watch).toHaveBeenCalledOnce()
  })

  it('onFolderChanged → 前の監視を閉じて新しいフォルダを張る', () => {
    const { watcher, watches, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    expect(watches.map((w) => [w.folder, w.closed])).toEqual([
      ['/a', true],
      ['/b', false]
    ])
    expect(watcher.watchedFolder(1)).toBe('/b')
  })

  it('A → B → A → 3 回張られ、最後の監視が A(renderer の送り直しに頼らない。L-571)', () => {
    const { watcher, watch, watches, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    folders.set(1, '/a')
    watcher.onFolderChanged(1)
    expect(watch.mock.calls.map(([folder]) => folder)).toEqual(['/a', '/b', '/a'])
    expect(watches.map((w) => w.closed)).toEqual([true, true, false])
    expect(watcher.watchedFolder(1)).toBe('/a')
  })

  it('無効な所有者の onFolderChanged → 張らない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/repo')
    watcher.onFolderChanged(1)
    expect(watch).not.toHaveBeenCalled()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('disable の後の onFolderChanged → 張らない', () => {
    const { watcher, watch, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    watcher.disable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    expect(watch).toHaveBeenCalledOnce()
  })

  it('watch が同期で投げる → enable は投げず、監視無しのまま', () => {
    const watch = vi.fn<WatchFolder>(() => {
      throw new Error('EMFILE')
    })
    const { watcher, folders } = setup({ watch })
    folders.set(1, '/repo')
    expect(() => watcher.enable(1)).not.toThrow()
    expect(watch).toHaveBeenCalledOnce()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('watch が null(Linux) → 何も張らない', () => {
    const { watcher, folders } = setup({ watch: null })
    folders.set(1, '/repo')
    expect(() => watcher.enable(1)).not.toThrow()
    expect(watcher.watchedFolder(1)).toBeNull()
  })

  it('error → 閉じて監視無しにし、同じフォルダのまま enable で張り直す', () => {
    const { watcher, watch, watches, folders } = setup()
    folders.set(1, '/repo')
    watcher.enable(1)
    watches[0].fail()
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedFolder(1)).toBeNull()
    watcher.enable(1)
    expect(watch).toHaveBeenCalledTimes(2)
    expect(watcher.watchedFolder(1)).toBe('/repo')
  })
})

// 待ち・上限・tree の論理和・送った後の未送信の消去の規則そのものは folderChangeCoalescer.test.ts で確かめる。
// ここでは、分類の結果と既定の時間を合流へ渡すこと・所有者と監視の寿命で送る/送らないが変わることを確かめる
describe('FolderChangeWatcher の通知', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  // /repo を張った状態から始める
  function setupWatching(
    overrides: Partial<FolderChangeWatcherDeps> = {}
  ): ReturnType<typeof setup> {
    const rendered = setup(overrides)
    rendered.folders.set(1, '/repo')
    rendered.watcher.enable(1)
    return rendered
  }

  it('最後の通知から 300ms 待って 1 回にまとめて送る', async () => {
    const { watches, notify } = setupWatching()
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(200)
    watches[0].fire('b.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS - 1)
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('通知が続いても、最初の通知から 1000ms で送る(上限。L-399)', async () => {
    const { watches, notify } = setupWatching()
    for (let elapsed = 0; elapsed < FOLDER_CHANGE_MAX_WAIT_MS; elapsed += 200) {
      watches[0].fire('a.txt')
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('git だけ → treeChanged: false', async () => {
    const { watches, notify } = setupWatching()
    watches[0].fire('.git/index')
    watches[0].fire(Buffer.from('.git/HEAD'))
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: false })
  })

  it('ignore だけ → 送らない。その後の tree は送る(監視が生きている)', async () => {
    const { watches, notify } = setupWatching()
    watches[0].fire('node_modules/x/y.js')
    watches[0].fire('.git/index.lock')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('disable → 監視を閉じ、予約を取り消す(送らない)', async () => {
    const { watcher, watches, notify } = setupWatching()
    watches[0].fire('a.txt')
    watcher.disable(1)
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(watches[0].closed).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })

  it('張り直した後に閉じた監視の listener が呼ばれても送らない(L-037)', async () => {
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
    watches[1].fire('b.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, { treeChanged: true })
  })

  it('張り直し → 前のフォルダの未送信を捨てる', async () => {
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    watcher.enable(1)
    watches[0].fire('a.txt')
    folders.set(1, '/b')
    watcher.onFolderChanged(1)
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
  })

  it('error の後の通知 → 送らない', async () => {
    const { watches, notify } = setupWatching()
    watches[0].fail()
    watches[0].fire('a.txt')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_MAX_WAIT_MS)
    expect(notify).not.toHaveBeenCalled()
  })

  it('notify が投げても、タイマーのコールバックは投げない', () => {
    const notify = vi.fn<FolderChangeWatcherDeps['notify']>(() => {
      throw new Error('Object has been destroyed')
    })
    const { watches } = setupWatching({ notify })
    watches[0].fire('a.txt')
    expect(() => vi.advanceTimersByTime(FOLDER_CHANGE_WAIT_MS)).not.toThrow()
    expect(notify).toHaveBeenCalledOnce()
  })

  it('所有者ごとに別に送る', async () => {
    const { watcher, watches, notify, folders } = setup()
    folders.set(1, '/a')
    folders.set(2, '/b')
    watcher.enable(1)
    watcher.enable(2)
    watches[1].fire('.git/index')
    await vi.advanceTimersByTimeAsync(FOLDER_CHANGE_WAIT_MS)
    expect(notify).toHaveBeenCalledExactlyOnceWith(2, { treeChanged: false })
  })
})
