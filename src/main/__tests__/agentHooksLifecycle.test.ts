import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { setupAgentHooksLifecycle } from '../agentHooksLifecycle'

let errorSpy: MockInstance<typeof console.error>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  errorSpy.mockRestore()
})

function setup(): {
  app: EventEmitter
  receiver: { close: ReturnType<typeof vi.fn> }
  settingsDir: { removeSync: ReturnType<typeof vi.fn> }
  copilotPlugins: { removeTokenFilesSync: ReturnType<typeof vi.fn> }
  tracker: { close: ReturnType<typeof vi.fn> }
} {
  const app = new EventEmitter()
  const receiver = { close: vi.fn() }
  const settingsDir = { removeSync: vi.fn() }
  const copilotPlugins = { removeTokenFilesSync: vi.fn() }
  const tracker = { close: vi.fn() }
  setupAgentHooksLifecycle(app as unknown as App, {
    receiver,
    settingsDir,
    copilotPlugins,
    tracker
  })
  return { app, receiver, settingsDir, copilotPlugins, tracker }
}

describe('setupAgentHooksLifecycle', () => {
  it('before-quit には登録しない(止める途中の SessionEnd を受けるため)', () => {
    const { app, receiver } = setup()
    expect(app.listenerCount('before-quit')).toBe(0)
    app.emit('before-quit', { preventDefault: vi.fn() })
    expect(receiver.close).not.toHaveBeenCalled()
  })

  it('will-quit で受け口・設定のディレクトリ・copilot の hooks の設定のファイル・追跡を 1 回ずつ片付け、終了を止めない', () => {
    const { app, receiver, settingsDir, copilotPlugins, tracker } = setup()
    const event = { preventDefault: vi.fn() }
    app.emit('will-quit', event)
    expect(receiver.close).toHaveBeenCalledOnce()
    expect(settingsDir.removeSync).toHaveBeenCalledOnce()
    expect(copilotPlugins.removeTokenFilesSync).toHaveBeenCalledOnce()
    expect(tracker.close).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('1 つが投げても残りを呼ぶ(L-010)', () => {
    const { app, receiver, settingsDir, copilotPlugins, tracker } = setup()
    receiver.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    expect(() => app.emit('will-quit', { preventDefault: vi.fn() })).not.toThrow()
    expect(settingsDir.removeSync).toHaveBeenCalledOnce()
    expect(copilotPlugins.removeTokenFilesSync).toHaveBeenCalledOnce()
    expect(tracker.close).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith(
      '[agent-hooks] 終了の後始末に失敗しました:',
      expect.any(Error)
    )
  })
})
