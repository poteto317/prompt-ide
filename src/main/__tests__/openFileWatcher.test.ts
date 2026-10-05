import { describe, it, expect, vi, afterEach } from 'vitest'
import { OpenFileWatcher } from '../openFileWatcher'
import type { DirectoryWatch, WatchDirectory } from '../openFileWatcher'

afterEach(() => {
  vi.useRealTimers()
})

interface FakeWatch extends DirectoryWatch {
  dir: string
  closed: boolean
  fire(filename: string | null): void
  fail(): void
}

function makeWatchFn(): { watch: ReturnType<typeof vi.fn<WatchDirectory>>; watches: FakeWatch[] } {
  const watches: FakeWatch[] = []
  const watch = vi.fn<WatchDirectory>((dir, listener) => {
    let onError: (err: Error) => void = () => undefined
    const fake: FakeWatch = {
      dir,
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

describe('OpenFileWatcher', () => {
  it('親ディレクトリごとに 1 つの監視を張る', () => {
    const { watch } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts', '/p/sub/c.ts'])
    expect(watch.mock.calls.map(([dir]) => dir).sort()).toEqual(['/p', '/p/sub'])
  })

  it('開いているファイルの名前のイベントを 300ms 間引いて、renderer のパスで通知する', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts'])
    watches[0].fire('a.ts')
    await vi.advanceTimersByTimeAsync(200)
    watches[0].fire('a.ts')
    watches[0].fire('b.ts')
    await vi.advanceTimersByTimeAsync(299)
    expect(notify).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(notify).toHaveBeenCalledExactlyOnceWith(1, ['/p/a.ts', '/p/b.ts'])
  })

  it('開いていないファイルの名前は通知しない', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fire('other.ts')
    await vi.advanceTimersByTimeAsync(1000)
    expect(notify).not.toHaveBeenCalled()
  })

  it('名前の無いイベントはそのディレクトリの開いているファイルすべてを通知する', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/p/b.ts'])
    watches[0].fire(null)
    await vi.advanceTimersByTimeAsync(300)
    expect(notify).toHaveBeenCalledWith(1, ['/p/a.ts', '/p/b.ts'])
  })

  it('一覧から外れたディレクトリの監視を閉じ、残るものは張り直さない', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts', '/q/b.ts'])
    watcher.setWatchedFiles(1, ['/p/c.ts'])
    expect(watches.find((w) => w.dir === '/q')?.closed).toBe(true)
    expect(watches.find((w) => w.dir === '/p')?.closed).toBe(false)
    expect(watch).toHaveBeenCalledTimes(2)
  })

  it('clear はすべての監視と保留中の通知のタイマーを閉じる', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fire('a.ts')
    watcher.clear(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(watches[0].closed).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('空の一覧は clear と同じ', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watcher.setWatchedFiles(1, [])
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('監視を張れない(例外)ディレクトリは飛ばす', () => {
    const watch = vi.fn<WatchDirectory>(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    expect(() => watcher.setWatchedFiles(1, ['/gone/a.ts'])).not.toThrow()
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('error の出た監視は閉じる', () => {
    const { watch, watches } = makeWatchFn()
    const watcher = new OpenFileWatcher({ watch, notify: vi.fn() })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fail()
    expect(watches[0].closed).toBe(true)
    expect(watcher.watchedDirectoryCount(1)).toBe(0)
  })

  it('通知が投げても main の未捕捉例外にせず、次の通知も届ける', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn(() => {
      throw new Error('Object has been destroyed')
    })
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watches[0].fire('a.ts')
    // タイマーのコールバックが投げると advanceTimersByTimeAsync が拒否される
    await vi.advanceTimersByTimeAsync(300)
    watches[0].fire('a.ts')
    await vi.advanceTimersByTimeAsync(300)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('所有者ごとに独立している', async () => {
    vi.useFakeTimers()
    const { watch, watches } = makeWatchFn()
    const notify = vi.fn()
    const watcher = new OpenFileWatcher({ watch, notify })
    watcher.setWatchedFiles(1, ['/p/a.ts'])
    watcher.setWatchedFiles(2, ['/p/a.ts'])
    watcher.clear(1)
    watches[1].fire('a.ts')
    await vi.advanceTimersByTimeAsync(300)
    expect(notify).toHaveBeenCalledExactlyOnceWith(2, ['/p/a.ts'])
  })
})
