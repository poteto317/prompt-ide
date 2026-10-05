import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as agentTerminalApi from './agentTerminalApi'
import { openExternalLink } from './shellApi'
import { isExternalHttpUrl } from '@shared/externalUrl'
import { createAgentTerminalController } from './agentTerminalController'
import type { AgentTerminalController } from './agentTerminalController'
import { isMacPlatform } from './platform'

// 実物の xterm で controller を作る(文書ごとに 1 つ)。jsdom では xterm を開けない(matchMedia・canvas が無い)ため、
// テストはこのモジュールを読まずに createAgentTerminalController へ偽物を渡す

let instance: AgentTerminalController | null = null

export function getAgentTerminalController(): AgentTerminalController {
  if (instance !== null) return instance
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
  instance = createAgentTerminalController({
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
  return instance
}
