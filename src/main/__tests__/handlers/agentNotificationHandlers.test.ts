import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAgentNotificationHandlers } from '../../handlers/agentNotificationHandlers'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener))
}

const center = { show: vi.fn(), setBadge: vi.fn(), dismiss: vi.fn() }
const window = { marker: 'window' }
const windowOf = vi.fn((): unknown => window)

const makeEvent = (
  main = true
): { sender: { id: number }; senderFrame: { parent: object | null } } => ({
  sender: { id: 1 },
  senderFrame: { parent: main ? null : {} }
})
const invoke = (channel: string, event: unknown, payload: unknown): Promise<unknown> =>
  Promise.resolve(handles.get(channel)?.(event, payload))

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  windowOf.mockImplementation(() => window)
  registerAgentNotificationHandlers(ipcMain as never, { center, windowOf: windowOf as never })
})

describe('agentNotification:show', () => {
  const payload = { slotId: 'slot-1', tabNumber: 1, kind: 'done' }

  it('送信元のウィンドウと検証した依頼を center へ渡す', async () => {
    const event = makeEvent()
    await invoke('agentNotification:show', event, payload)
    expect(windowOf).toHaveBeenCalledWith(event.sender)
    expect(center.show).toHaveBeenCalledWith(window, payload)
  })

  it('メインフレーム以外からの依頼は拒否する', async () => {
    await expect(invoke('agentNotification:show', makeEvent(false), payload)).rejects.toThrow(
      'メインフレーム以外からの依頼は受け付けません'
    )
    expect(center.show).not.toHaveBeenCalled()
  })

  it('入力が不正なら拒否する', async () => {
    await expect(
      invoke('agentNotification:show', makeEvent(), { ...payload, kind: 'working' })
    ).rejects.toThrow('kind は')
    expect(center.show).not.toHaveBeenCalled()
  })

  it('送信元のウィンドウが無ければ何もしない', async () => {
    windowOf.mockImplementation(() => null)
    await expect(invoke('agentNotification:show', makeEvent(), payload)).resolves.toBeUndefined()
    expect(center.show).not.toHaveBeenCalled()
  })
})

describe('agentNotification:setBadge', () => {
  it('検証した数を center へ渡す', async () => {
    await invoke('agentNotification:setBadge', makeEvent(), { count: 2 })
    expect(center.setBadge).toHaveBeenCalledWith(2)
  })

  it('メインフレーム以外・不正な数は拒否する', async () => {
    await expect(
      invoke('agentNotification:setBadge', makeEvent(false), { count: 1 })
    ).rejects.toThrow('メインフレーム以外からの依頼は受け付けません')
    await expect(invoke('agentNotification:setBadge', makeEvent(), { count: -1 })).rejects.toThrow(
      'count は'
    )
    expect(center.setBadge).not.toHaveBeenCalled()
  })
})

describe('agentNotification:dismiss', () => {
  it('送信元のウィンドウと検証した slotId を center へ渡す', async () => {
    const event = makeEvent()
    await invoke('agentNotification:dismiss', event, { slotId: 'slot-1' })
    expect(windowOf).toHaveBeenCalledWith(event.sender)
    expect(center.dismiss).toHaveBeenCalledWith(window, 'slot-1')
  })

  it('メインフレーム以外・不正な slotId は拒否する', async () => {
    await expect(
      invoke('agentNotification:dismiss', makeEvent(false), { slotId: 'slot-1' })
    ).rejects.toThrow('メインフレーム以外からの依頼は受け付けません')
    await expect(
      invoke('agentNotification:dismiss', makeEvent(), { slotId: 'a b' })
    ).rejects.toThrow('slotId は')
    expect(center.dismiss).not.toHaveBeenCalled()
  })

  it('送信元のウィンドウが無ければ何もしない', async () => {
    windowOf.mockImplementation(() => null)
    await expect(
      invoke('agentNotification:dismiss', makeEvent(), { slotId: 'slot-1' })
    ).resolves.toBeUndefined()
    expect(center.dismiss).not.toHaveBeenCalled()
  })
})
