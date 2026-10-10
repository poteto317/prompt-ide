import { describe, it, expect, vi, beforeEach } from 'vitest'

// Electron の Notification の代わり(作った通知を記録し、on の listener を後から呼べるようにする)
const created = vi.hoisted(
  () =>
    [] as {
      options: unknown
      show: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
      listeners: Map<string, () => void>
    }[]
)
vi.mock('electron', () => ({
  Notification: vi.fn(function (this: Record<string, unknown>, options: unknown) {
    const listeners = new Map<string, () => void>()
    const record = { options, show: vi.fn(), close: vi.fn(), listeners }
    created.push(record)
    this.show = record.show
    this.close = record.close
    this.on = (event: string, listener: () => void) => {
      listeners.set(event, listener)
    }
  })
}))

import { createElectronAgentNotification } from '../agentNotificationRuntime'

describe('createElectronAgentNotification', () => {
  beforeEach(() => {
    created.length = 0
  })

  it('題・本文で Notification を作り、show・close をそのまま呼ぶ', () => {
    const handle = createElectronAgentNotification({ title: 'claude 1: 許可待ち', body: '本文' })
    expect(created[0].options).toEqual({ title: 'claude 1: 許可待ち', body: '本文' })
    handle.show()
    handle.close()
    expect(created[0].show).toHaveBeenCalledTimes(1)
    expect(created[0].close).toHaveBeenCalledTimes(1)
  })

  it('click の出来事を引数なしで listener へ渡す', () => {
    const handle = createElectronAgentNotification({ title: 't', body: 'b' })
    const onClick = vi.fn()
    handle.onClick(onClick)
    created[0].listeners.get('click')?.()
    expect(onClick).toHaveBeenCalledWith()
  })
})
