import { describe, it, expect } from 'vitest'
import { makeFakeAgentSessionTabs } from '../makeFakeAgentSessionTabs'
import type { FakeController } from '../makeFakeAgentTerminal'
import { prepareClaudeScreen } from '../prepareClaudeScreen'
import type { AgentSessionTabs } from '../../lib/agentSessionTabs'

const inputLineOf = (controller: FakeController): string =>
  controller.viewport[1].map((cell) => cell.char).join('')

describe('prepareClaudeScreen', () => {
  it('選択中のタブ(先頭でなくても)の controller を、空の入力欄の claude の画面にする', () => {
    const store = makeFakeAgentSessionTabs()
    const second = store.add()
    const { controller } = prepareClaudeScreen(store)
    expect(store.getSnapshot().selectedSlotId).toBe(second?.slotId)
    expect(controller).toBe(second?.controller)
    expect(controller).not.toBe(store.getSnapshot().tabs[0].controller)
    expect(controller.viewport).toHaveLength(3)
    expect(inputLineOf(controller)).toBe('❯\xa0 ')
    expect(controller.writes).toEqual([])
  })

  it('書き込みを writes に積み、貼り付けを書き込むと本文の 1 行目を入力欄に出す', () => {
    const { controller } = prepareClaudeScreen(makeFakeAgentSessionTabs())
    controller.writeToSession('\x1b[200~1 行目\n2 行目\x1b[201~')
    expect(controller.writes).toEqual(['\x1b[200~1 行目\n2 行目\x1b[201~'])
    expect(inputLineOf(controller)).toBe('❯\xa01 行目')
    controller.writeToSession('\r')
    expect(controller.writes).toEqual(['\x1b[200~1 行目\n2 行目\x1b[201~', '\r'])
    expect(inputLineOf(controller)).toBe('❯\xa01 行目')
  })

  it('restore で上書きする前の writeToSession・viewport・sessionId・writes に戻す', () => {
    const store = makeFakeAgentSessionTabs()
    const { tabs } = store.getSnapshot()
    const original = tabs[0].controller as FakeController
    const { writeToSession, viewport, sessionId, writes } = original
    const { controller, restore } = prepareClaudeScreen(store)
    controller.sessionId = 'changed'
    controller.writeToSession('x')
    restore()
    expect(original.writeToSession).toBe(writeToSession)
    expect(original.viewport).toBe(viewport)
    expect(original.sessionId).toBe(sessionId)
    expect(original.writes).toBe(writes)
  })

  it('選択中のタブが無ければ投げる', () => {
    const store = makeFakeAgentSessionTabs()
    const empty = {
      ...store,
      getSnapshot: () => ({ tabs: [], selectedSlotId: 'slot-1' })
    } as AgentSessionTabs
    expect(() => prepareClaudeScreen(empty)).toThrow('selected tab not found')
  })
})
