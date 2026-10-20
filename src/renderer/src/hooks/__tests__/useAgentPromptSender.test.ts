import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AGENT_CLEAR_INPUT_CHUNK } from '@shared/agentPasteText'
import { AGENT_BEFORE_SEND_TIMEOUT_MS, useAgentPromptSender } from '../useAgentPromptSender'
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentPromptSendResult, AgentSendClock } from '../../lib/agentPromptSend'
import {
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE,
  agentPromptSendUnsupportedReason
} from '../../lib/agentSendMessages'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import { makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { toAnnouncementText } from '../../lib/announcementText'

afterEach(() => {
  vi.useRealTimers()
})

// 仮想の時計(sleep で時間を進めるだけ)
// 送り先の claude のセッションを控えない(送信の手順だけを確かめるテスト用)
const noSession = (): AgentHistoryInfo | null => null

const clock: AgentSendClock = (() => {
  let now = 0
  return { now: () => now, sleep: async (ms: number) => void (now += ms) }
})()

// 空の入力欄の画面。貼り付けを書き込むと本文が入った画面に変える
function controllerWithEmptyInput(): ReturnType<typeof makeFakeController> {
  const controller = makeFakeController()
  const border = makeLine('─'.repeat(40))
  controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
  const original = controller.writeToSession
  controller.writeToSession = (data) => {
    original(data)
    if (data.startsWith('\x1b[200~'))
      controller.viewport = [border, makeLine(`❯\xa0${data.slice(6, -6)}`), border]
  }
  return controller
}

describe('useAgentPromptSender', () => {
  it('送信の間は利用者の入力を溜め、成功を通知し、パネルを開く', async () => {
    const controller = controllerWithEmptyInput()
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled, clock }))
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(controller.beginSending).toHaveBeenCalledOnce()
    expect(controller.endSending).toHaveBeenCalledOnce()
    // 空と判定されても消去を最低 1 回送ってから貼り付ける(Task 14 の手順)
    expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
    expect(toAnnouncementText(result.current.notice)).toBe(AGENT_SENT_NOTICE)
    expect(result.current.error).toBeNull()
    expect(onSettled).toHaveBeenCalledOnce()
    expect(result.current.isSending).toBe(false)
  })

  it('pty への書き込みはすべて利用者の入力を溜めている間に行う', async () => {
    const controller = controllerWithEmptyInput()
    let holding = false
    controller.beginSending.mockImplementation(() => void (holding = true))
    controller.endSending.mockImplementation(() => void (holding = false))
    const heldAtWrite: boolean[] = []
    const write = controller.writeToSession
    controller.writeToSession = (data) => {
      heldAtWrite.push(holding)
      write(data)
    }
    const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(heldAtWrite).toEqual([true, true, true])
    expect(holding).toBe(false)
  })

  it('失敗の理由の文言を出し、パネルを開く。送らなかったときも入力の保留を解く', async () => {
    const controller = makeFakeController()
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled, clock }))
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(result.current.error).toBe(
      'エージェントの入力欄が見つかりません。ターミナルの画面（確認や選択の画面が出ていないか）を確かめてください'
    )
    expect(controller.endSending).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('clearResult は前の送信の失敗の文言と成功の通知を消す', async () => {
    const failing = makeFakeController()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller: failing,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(result.current.error).not.toBeNull()
    act(() => result.current.clearResult())
    expect(result.current.error).toBeNull()
    await act(async () => {
      await result.current.send('hello', {
        slotId: 'a',
        controller: controllerWithEmptyInput(),
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(result.current.notice).not.toBeNull()
    act(() => result.current.clearResult())
    expect(result.current.notice).toBeNull()
  })

  it('書きかけを消して送ったときは、その旨を(参考として)通知する', async () => {
    const controller = controllerWithEmptyInput()
    const border = makeLine('─'.repeat(40))
    controller.viewport = [border, makeLine('❯\xa0abc ', [], [[5, 6]]), border]
    const write = controller.writeToSession
    controller.writeToSession = (data) => {
      if (data.startsWith('\x0b'))
        controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
      write(data)
    }
    const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
    await act(async () => {
      await result.current.send('p', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(toAnnouncementText(result.current.notice)).toBe(AGENT_SENT_AFTER_CLEAR_NOTICE)
  })

  it('送信の途中で例外が起きても、送信中の状態と入力の保留を解き、理由を出してパネルを開く', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = controllerWithEmptyInput()
    controller.writeToSession = () => {
      throw new Error('IPC closed')
    }
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled, clock }))
    await act(async () => {
      await expect(
        result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      ).resolves.toBeUndefined()
    })
    expect(controller.endSending).toHaveBeenCalledOnce()
    expect(result.current.isSending).toBe(false)
    expect(result.current.error).toBe('エージェントへ送信できませんでした: IPC closed')
    expect(onSettled).toHaveBeenCalledOnce()
    // 保留が解けていれば、次の送信を受け付ける
    await act(async () => {
      await result.current.send('again', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(controller.beginSending).toHaveBeenCalledTimes(2)
    consoleSpy.mockRestore()
  })

  it('送信中の 2 回目の send は何もしない', async () => {
    const controller = controllerWithEmptyInput()
    let release: () => void = () => undefined
    const slowClock: AgentSendClock = {
      now: () => 0,
      sleep: () => new Promise<void>((resolve) => (release = resolve))
    }
    const { result } = renderHook(() =>
      useAgentPromptSender({ onSettled: vi.fn(), clock: slowClock })
    )
    let first: Promise<unknown> = Promise.resolve()
    act(() => {
      first = result.current.send('a', {
        slotId: 'a',
        controller,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(result.current.isSending).toBe(true)
    await act(async () => {
      await expect(
        result.current.send('b', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      ).resolves.toBeUndefined()
    })
    expect(controller.beginSending).toHaveBeenCalledOnce()
    // 1 回目を終わらせる(待ちを解き続ける)
    for (let i = 0; i < 10; i++) {
      await act(async () => release())
    }
    await act(async () => {
      await first
    })
    expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~a\x1b[201~', '\r'])
  })

  it('送り先のタブの controller だけに書き、送信中はそのタブの slotId を返し、終わると null に戻す', async () => {
    const controllerA = controllerWithEmptyInput()
    const controllerB = controllerWithEmptyInput()
    let release: () => void = () => undefined
    const slowClock: AgentSendClock = {
      now: () => 0,
      sleep: () => new Promise<void>((resolve) => (release = resolve))
    }
    const { result } = renderHook(() =>
      useAgentPromptSender({ onSettled: vi.fn(), clock: slowClock })
    )
    expect(result.current.sendingSlotId).toBeNull()
    let first: Promise<unknown> = Promise.resolve()
    act(() => {
      first = result.current.send('a', {
        slotId: 'a',
        controller: controllerA,
        describeSession: noSession,
        cliKind: 'claude'
      })
    })
    expect(result.current.sendingSlotId).toBe('a')
    // 送信中に別のタブへ送っても何もしない
    await act(async () => {
      await expect(
        result.current.send('b', {
          slotId: 'b',
          controller: controllerB,
          describeSession: noSession,
          cliKind: 'claude'
        })
      ).resolves.toBeUndefined()
    })
    expect(result.current.sendingSlotId).toBe('a')
    for (let i = 0; i < 10; i++) {
      await act(async () => release())
    }
    await act(async () => {
      await first
    })
    expect(controllerA.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~a\x1b[201~', '\r'])
    expect(controllerB.writes).toEqual([])
    expect(controllerB.beginSending).not.toHaveBeenCalled()
    expect(result.current.sendingSlotId).toBeNull()
  })

  describe('送信の前の準備(エージェントの変更の記録)', () => {
    // 上限の待ち(10 秒)だけは release まで解かず、送信の手順の待ちはすぐ解く時計
    const timeoutClock = (): AgentSendClock & { releaseTimeout: () => void; slept: number[] } => {
      let releaseTimeout: () => void = () => undefined
      const slept: number[] = []
      return {
        now: () => 0,
        sleep: (ms: number) => {
          slept.push(ms)
          return ms === AGENT_BEFORE_SEND_TIMEOUT_MS
            ? new Promise<void>((resolve) => (releaseTimeout = resolve))
            : Promise.resolve()
        },
        releaseTimeout: () => releaseTimeout(),
        slept
      }
    }

    it('準備を待ってから、消去・貼り付け・Enter を送る', async () => {
      const controller = controllerWithEmptyInput()
      const testClock = timeoutClock()
      let finishPreparation: () => void = () => undefined
      const beforeSend = vi.fn(() => new Promise<void>((resolve) => (finishPreparation = resolve)))
      const { result } = renderHook(() =>
        useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock: testClock })
      )
      let sending: Promise<unknown> = Promise.resolve()
      act(() => {
        sending = result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      })
      await act(async () => undefined)
      expect(beforeSend).toHaveBeenCalledOnce()
      expect(controller.writes).toEqual([])
      expect(controller.beginSending).not.toHaveBeenCalled()
      await act(async () => {
        finishPreparation()
        await sending
      })
      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
    })

    it('準備が失敗しても送る', async () => {
      const controller = controllerWithEmptyInput()
      const beforeSend = vi.fn(async () => {
        throw new Error('begin failed')
      })
      const { result } = renderHook(() =>
        useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock: timeoutClock() })
      )
      await act(async () => {
        await result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      })
      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
      expect(result.current.error).toBeNull()
    })

    it('準備が同期で例外を投げても送り、送信中のまま固まらない', async () => {
      const controller = controllerWithEmptyInput()
      const beforeSend = vi.fn((): Promise<void> => {
        throw new Error('sync failure')
      })
      const { result } = renderHook(() =>
        useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock: timeoutClock() })
      )
      await act(async () => {
        await result.current.send('a', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      })
      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~a\x1b[201~', '\r'])
      expect(result.current.isSending).toBe(false)
      // 送信中のまま固まらない(固まると sendingRef も true のままで、次の送信は無視される)
    })

    it('準備が上限(10 秒)を超えたら待たずに送る', async () => {
      const controller = controllerWithEmptyInput()
      const testClock = timeoutClock()
      const beforeSend = vi.fn(() => new Promise<void>(() => undefined))
      const { result } = renderHook(() =>
        useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock: testClock })
      )
      let sending: Promise<unknown> = Promise.resolve()
      act(() => {
        sending = result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: noSession,
          cliKind: 'claude'
        })
      })
      await act(async () => undefined)
      expect(controller.writes).toEqual([])
      await act(async () => {
        testClock.releaseTimeout()
        await sending
      })
      expect(testClock.slept[0]).toBe(AGENT_BEFORE_SEND_TIMEOUT_MS)
      expect(controller.writes).toEqual([AGENT_CLEAR_INPUT_CHUNK, '\x1b[200~hello\x1b[201~', '\r'])
    })
  })
})

describe('useAgentPromptSender: 送り先の控え(sentTo)', () => {
  const SENT_TO: AgentHistoryInfo = {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 1',
    folderPath: '/work'
  }

  it('送信の手順を始める時点(準備の後・beginSending の直前)に describeSession で控え、sent の結果に載せる(L-037)', async () => {
    const controller = controllerWithEmptyInput()
    const order: string[] = []
    controller.beginSending.mockImplementation(() => void order.push('begin'))
    const describeSession = vi.fn(() => {
      order.push('describe')
      return SENT_TO
    })
    const beforeSend = vi.fn(async () => {
      order.push('before')
    })
    const { result } = renderHook(() =>
      useAgentPromptSender({ onSettled: vi.fn(), beforeSend, clock })
    )
    let outcome: AgentPromptSendResult | undefined = undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession,
        cliKind: 'claude'
      })
    })
    expect(order).toEqual(['before', 'describe', 'begin'])
    expect(describeSession).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: SENT_TO })
  })

  it('送れなかったときは結果に sentTo を載せない', async () => {
    const controller = makeFakeController()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
    let outcome: AgentPromptSendResult | undefined = undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession: () => SENT_TO,
        cliKind: 'claude'
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'input-not-found' })
  })

  it('describeSession が投げても送り、sentTo は null にしてログに残す', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const controller = controllerWithEmptyInput()
      const { result } = renderHook(() => useAgentPromptSender({ onSettled: vi.fn(), clock }))
      let outcome: AgentPromptSendResult | undefined = undefined
      await act(async () => {
        outcome = await result.current.send('hello', {
          slotId: 'a',
          controller,
          describeSession: () => {
            throw new Error('broken')
          },
          cliKind: 'claude'
        })
      })
      expect(outcome).toEqual({ kind: 'sent', clearedDraft: false, sentTo: null })
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('useAgentPromptSender: 送信に対応しない CLI(copilot)の送り先', () => {
  it('準備・送り先の控え・入力の保留・書き込みをどれもせず unsupported-cli で失敗し、実行ボタンの理由と同じ文言を出す(L-058)', async () => {
    const controller = controllerWithEmptyInput()
    const beforeSend = vi.fn(async () => undefined)
    const describeSession = vi.fn(noSession)
    const onSettled = vi.fn()
    const { result } = renderHook(() => useAgentPromptSender({ onSettled, beforeSend, clock }))
    let outcome: AgentPromptSendResult | undefined
    await act(async () => {
      outcome = await result.current.send('hello', {
        slotId: 'a',
        controller,
        describeSession,
        cliKind: 'copilot'
      })
    })
    expect(outcome).toEqual({ kind: 'failed', reason: 'unsupported-cli' })
    expect(beforeSend).not.toHaveBeenCalled()
    expect(describeSession).not.toHaveBeenCalled()
    expect(controller.beginSending).not.toHaveBeenCalled()
    expect(controller.writes).toEqual([])
    expect(result.current.error).toBe(agentPromptSendUnsupportedReason('copilot'))
    expect(result.current.isSending).toBe(false)
    expect(result.current.sendingSlotId).toBeNull()
    expect(onSettled).toHaveBeenCalledOnce()
  })
})
