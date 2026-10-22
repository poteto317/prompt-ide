import type { AgentSessionTabs } from '../lib/agentSessionTabs'
import { makeLine } from '../lib/__tests__/fixtures/agentScreens'
import type { FakeController } from './makeFakeAgentTerminal'

// App の配線のテスト(本物の sendClaudePrompt を通す)で、選択中のタブの偽の controller(xterm の境界)を、空の入力欄の claude の
// 画面にする。貼り付けを書き込むと本文の 1 行目が入力欄に出るので、sendClaudePrompt がこの画面を読んで Enter まで送る。
// タブの置き場(makeFakeAgentSessionTabs)はテストファイルで共有しているため、上書きする前の writeToSession・viewport・
// sessionId・writes を控えて戻す restore を返す(afterEach で呼ぶ)

export interface PreparedClaudeScreen {
  controller: FakeController
  /** 上書きした controller を、上書きする前に戻す */
  restore: () => void
}

export function prepareClaudeScreen(store: AgentSessionTabs): PreparedClaudeScreen {
  const { tabs, selectedSlotId } = store.getSnapshot()
  const tab = tabs.find((t) => t.slotId === selectedSlotId)
  if (tab === undefined) throw new Error('selected tab not found')
  const controller = tab.controller as FakeController
  const { writeToSession, viewport, sessionId, writes } = controller
  const restore = (): void => {
    controller.writeToSession = writeToSession
    controller.viewport = viewport
    controller.sessionId = sessionId
    controller.writes = writes
  }
  const border = makeLine('─'.repeat(40))
  controller.viewport = [border, makeLine('❯\xa0 ', [], [[2, 3]]), border]
  controller.writes = []
  controller.writeToSession = (data) => {
    controller.writes.push(data)
    if (data.startsWith('\x1b[200~'))
      controller.viewport = [border, makeLine(`❯\xa0${data.slice(6).split('\n')[0]}`), border]
  }
  return { controller, restore }
}
