import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as agentTerminalApi from './agentTerminalApi'
import { openExternalLink } from './shellApi'
import { isExternalHttpUrl } from '@shared/externalUrl'
import { createAgentTerminalController } from './agentTerminalController'
import type { AgentTerminalController } from './agentTerminalController'
import { isMacPlatform } from './platform'
import { createAgentSessionTabs } from './agentSessionTabs'
import type { AgentSessionTabs } from './agentSessionTabs'
import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'

// 実物の xterm で controller を作る(タブごとに 1 つ。呼ぶたびに新しい xterm を作る)。jsdom では xterm を開けない(matchMedia・canvas が無い)ため、
// テストはこのモジュールを読まずに createAgentTerminalController へ偽物を渡す

// タブの置き場(getAgentSessionTabs)だけが呼ぶ。controller の持ち主は置き場で、タブを消すときに dispose する
function createXtermAgentTerminalController(): AgentTerminalController {
  const terminal = new Terminal({
    cursorBlink: false,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: { background: '#1e1e1e' },
    // OSC 8 のリンクは、http・https だけを既定のブラウザで開く(main でもスキームを確かめる)
    linkHandler: {
      activate: (_event, uri) => {
        if (isExternalHttpUrl(uri)) void openExternalLink(uri)
      }
    }
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  return createAgentTerminalController({
    terminal,
    fitAddon,
    api: agentTerminalApi,
    clipboard: navigator.clipboard,
    isMac: isMacPlatform(),
    createHost: () => {
      const host = document.createElement('div')
      host.className = 'agent-terminal-view__host'
      return host
    }
  })
}

let tabs: AgentSessionTabs | null = null

/** エージェントのセッションのタブの置き場(文書ごとに 1 つ) */
export function getAgentSessionTabs(): AgentSessionTabs {
  if (tabs !== null) return tabs
  tabs = createAgentSessionTabs({
    createController: createXtermAgentTerminalController,
    createSlotId: () => crypto.randomUUID(),
    max: AGENT_MAX_SESSIONS_PER_WINDOW
  })
  return tabs
}
