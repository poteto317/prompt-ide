import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { setupAgentSessionLifecycle } from '../agentSessionLifecycle'
import {
  AGENT_KILL_GRACE_MS,
  AGENT_KILL_SETTLE_MS,
  AGENT_PS_TIMEOUT_MS,
  stopProcessTree
} from '../agentProcessTree'
import { agentStartCanceled } from '@shared/types'

afterEach(() => {
  vi.useRealTimers()
})

// 偽の app(EventEmitter に quit を足したもの)と、stop・stopAll・hasAny を記録する registry
function setup(options: { hasAny?: boolean; stopAll?: () => Promise<void> } = {}): {
  app: EventEmitter & { quit: ReturnType<typeof vi.fn> }
  registry: AgentSessionRegistry
  stop: ReturnType<typeof vi.spyOn>
  folderAccess: FolderAccessManager
} {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() })
  const registry = new AgentSessionRegistry()
  const stop = vi.spyOn(registry, 'stop').mockResolvedValue(undefined)
  vi.spyOn(registry, 'hasAny').mockReturnValue(options.hasAny ?? false)
  vi.spyOn(registry, 'stopAll').mockImplementation(options.stopAll ?? (async () => undefined))
  const folderAccess = new FolderAccessManager()
  setupAgentSessionLifecycle(app as unknown as App, registry, folderAccess, { quitTimeoutMs: 4000 })
  return { app, registry, stop, folderAccess }
}

function createWebContents(
  app: EventEmitter,
  id: number
): EventEmitter & { setIgnoreMenuShortcuts: ReturnType<typeof vi.fn> } {
  const webContents = Object.assign(new EventEmitter(), { id, setIgnoreMenuShortcuts: vi.fn() })
  app.emit('web-contents-created', {}, webContents)
  return webContents
}

// Electron 39 で確かめた順: 遷移の開始(did-start-navigation)は will-navigate より先に届き、will-navigate で止めた遷移
// (ファイルのドロップなど)でも届く。文書が実際に入れ替わったときだけ did-navigate(リロード・許可した遷移)か
// did-fail-load(読み込みに失敗してエラーの画面に入れ替わった。ERR_ABORTED(-3) は取り消しで今の文書が残る)が届く
const NAVIGATION_EVENTS: Array<[string, (webContents: EventEmitter) => void, boolean]> = [
  [
    'will-navigate で止めた遷移(did-start-navigation だけが届く)では止めない',
    (webContents) =>
      webContents.emit('did-start-navigation', {
        url: 'file:///Users/me/dropped.txt',
        isMainFrame: true,
        isSameDocument: false,
        frame: null
      }),
    false
  ],
  [
    'リロード・許可した遷移の確定(did-navigate)で止める',
    (webContents) => {
      webContents.emit('did-start-navigation', {
        url: 'app://index.html',
        isMainFrame: true,
        isSameDocument: false,
        frame: null
      })
      webContents.emit('did-navigate', {}, 'app://index.html', 200, 'OK')
    },
    true
  ],
  [
    'メインフレームの読み込みの失敗(エラーの画面に入れ替わる)で止める',
    (webContents) =>
      webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://index.html', true),
    true
  ],
  [
    'メインフレームの遷移の取り消し(ERR_ABORTED。今の文書が残る)では止めない',
    (webContents) =>
      webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'app://index.html', true),
    false
  ],
  [
    'サブフレームの読み込みの失敗では止めない',
    (webContents) =>
      webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://frame.html', false),
    false
  ],
  [
    '同じ文書内の遷移(did-navigate-in-page)では止めない',
    (webContents) => {
      webContents.emit('did-start-navigation', {
        url: 'app://index.html#x',
        isMainFrame: true,
        isSameDocument: true,
        frame: null
      })
      webContents.emit('did-navigate-in-page', {}, 'app://index.html#x', true)
    },
    false
  ]
]

describe('setupAgentSessionLifecycle', () => {
  it('renderer のプロセスが落ちたら(リロードも閉じもされなくても)そのウィンドウのセッションを止める', () => {
    const { app, stop } = setup()
    const crashed = createWebContents(app, 1)
    createWebContents(app, 2)
    crashed.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(stop).toHaveBeenCalledExactlyOnceWith(1, 'stopped')
  })

  it('ウィンドウの破棄でそのウィンドウのセッションを止める', () => {
    const { app, stop } = setup()
    const closing = createWebContents(app, 1)
    createWebContents(app, 2)
    closing.emit('destroyed')
    expect(stop).toHaveBeenCalledExactlyOnceWith(1, 'stopped')
  })

  it.each(NAVIGATION_EVENTS)('%s', (_label, navigate, stopped) => {
    const { app, stop } = setup()
    const navigating = createWebContents(app, 1)
    createWebContents(app, 2)
    navigate(navigating)
    expect(stop.mock.calls).toEqual(stopped ? [[1, 'stopped']] : [])
  })

  it.each(NAVIGATION_EVENTS)(
    'メニューのショートカットの無視の解除(Windows・Linux): %s',
    (_label, navigate, replaced) => {
      // ターミナルにフォーカスがあるままリロードすると、renderer の blur が届かず無視が残るため、文書の入れ替わりで解除する
      const { app } = setup()
      const navigating = createWebContents(app, 1)
      navigate(navigating)
      expect(navigating.setIgnoreMenuShortcuts.mock.calls).toEqual(replaced ? [[false]] : [])
    }
  )

  it('フォルダが別のパスに変わったら folder-changed で止める。同じパスなら止めない', () => {
    const { stop, folderAccess } = setup()
    folderAccess.set(1, '/a')
    stop.mockClear()
    folderAccess.set(1, '/a')
    expect(stop).not.toHaveBeenCalled()
    folderAccess.set(1, '/b')
    expect(stop).toHaveBeenCalledExactlyOnceWith(1, 'folder-changed')
  })

  it('破棄済みの webContents の id には触れない(destroyed の時点で id を読むと例外になる)', () => {
    const { app, stop } = setup()
    let destroyed = false
    const webContents = Object.assign(new EventEmitter(), {
      get id(): number {
        if (destroyed) throw new Error('Object has been destroyed')
        return 7
      }
    })
    app.emit('web-contents-created', {}, webContents)
    destroyed = true
    expect(() => webContents.emit('destroyed')).not.toThrow()
    expect(stop).toHaveBeenCalledExactlyOnceWith(7, 'stopped')
  })

  it('セッションが無ければ終了を止めない', () => {
    const { app } = setup({ hasAny: false })
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('セッションがあれば終了を止め、止め終わってから quit し直す。2 回目の before-quit は素通しする', async () => {
    let release: () => void = () => undefined
    const { app } = setup({
      hasAny: true,
      stopAll: () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    })
    const first = { preventDefault: vi.fn() }
    app.emit('before-quit', first)
    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    const second = { preventDefault: vi.fn() }
    app.emit('before-quit', second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('終了を始めた後の起動は pty を起動せず取り消す(registry を閉じる。止める手順を通らないセッションを残さない)', async () => {
    // stopAll が解決しないため、終了の上限(実タイマー)が残らないよう偽タイマーで動かす
    vi.useFakeTimers()
    const { app, registry } = setup({
      hasAny: true,
      stopAll: () => new Promise<void>(() => undefined)
    })
    app.emit('before-quit', { preventDefault: vi.fn() })
    const create = vi.fn(async () => ({
      kind: 'failed' as const,
      result: { kind: 'error' as const, error: 'no-folder' as const }
    }))
    await expect(registry.start(1, create)).resolves.toEqual(agentStartCanceled())
    expect(create).not.toHaveBeenCalled()
  })

  it('セッションが無く終了を止めなかったときは registry を閉じない', async () => {
    const { app, registry } = setup({ hasAny: false })
    app.emit('before-quit', { preventDefault: vi.fn() })
    const create = vi.fn(async () => ({
      kind: 'failed' as const,
      result: { kind: 'error' as const, error: 'no-folder' as const }
    }))
    await expect(registry.start(1, create)).resolves.toEqual({ kind: 'error', error: 'no-folder' })
    expect(create).toHaveBeenCalledOnce()
  })

  it('停止が終わらなくても上限の時間で quit し直す', async () => {
    vi.useFakeTimers()
    const { app } = setup({ hasAny: true, stopAll: () => new Promise<void>(() => undefined) })
    app.emit('before-quit', { preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(3999)
    expect(app.quit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(app.quit).toHaveBeenCalledOnce()
  })
  it('既定の上限は ps の打ち切りまで待っても、SIGKILL を送り終えてから quit する(子が SIGTERM を無視するとき)', async () => {
    // 上限を注入せず既定値のまま組む。停止は実物の stopProcessTree(ps は打ち切りの時間いっぱいで返る偽物、子は終わらない)
    vi.useFakeTimers()
    const events: Array<[number, string | number] | 'quit'> = []
    const app = Object.assign(new EventEmitter(), {
      quit: vi.fn(() => {
        events.push('quit')
      })
    })
    const registry = new AgentSessionRegistry()
    vi.spyOn(registry, 'hasAny').mockReturnValue(true)
    vi.spyOn(registry, 'stopAll').mockImplementation(() =>
      stopProcessTree({
        pid: 50000,
        exited: new Promise<void>(() => undefined),
        platform: 'darwin',
        listProcesses: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve([{ pid: 50001, ppid: 50000 }]), AGENT_PS_TIMEOUT_MS)
          }),
        kill: (pid, signal) => {
          // signal 0 は生存の確認(例外を投げない = 生きている)。記録は SIGTERM・SIGKILL だけ
          if (signal !== 0) events.push([pid, signal])
        }
      })
    )
    setupAgentSessionLifecycle(app as unknown as App, registry, new FolderAccessManager())
    app.emit('before-quit', { preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(
      AGENT_PS_TIMEOUT_MS + AGENT_KILL_GRACE_MS + AGENT_KILL_SETTLE_MS + 100
    )
    expect(events).toEqual([[-50000, 'SIGTERM'], [-50000, 'SIGKILL'], [50001, 'SIGKILL'], 'quit'])
  })
})
