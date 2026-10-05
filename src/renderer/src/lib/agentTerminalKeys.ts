// ターミナル(xterm)のキー入力の振り分け(設計書「キーバインドとフォーカス」)。attachCustomKeyEventHandler に渡す判定の純粋関数と、
// document のハンドラがターミナルの中のイベントかを見分ける関数

/** ターミナルの領域の要素に付ける属性(AgentTerminalView) */
export const AGENT_TERMINAL_ATTRIBUTE = 'data-agent-terminal'

/** イベントの対象がターミナルの領域の中か。document のキーのハンドラは、これで除外するキーを決める */
export function isInsideAgentTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${AGENT_TERMINAL_ATTRIBUTE}]`) !== null
}

/**
 * terminal: xterm に任せる(端末へ送る)。copy・paste: アプリが処理して端末へ送らない(Windows・Linux の Ctrl+Shift+C・V)。
 * focus-out: F6 でターミナルから抜ける。ignore: 端末へ送らず何もしない(選択範囲の無い Ctrl+Shift+C)
 */
export type AgentTerminalKeyAction = 'terminal' | 'copy' | 'paste' | 'focus-out' | 'ignore'

export type AgentTerminalKeyEvent = Pick<
  KeyboardEvent,
  'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'
>

export function classifyAgentTerminalKey(
  event: AgentTerminalKeyEvent,
  isMac: boolean,
  hasSelection: boolean
): AgentTerminalKeyAction {
  if (event.type !== 'keydown') return 'terminal'
  const noModifiers = !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
  if (event.key === 'F6' && noModifiers) return 'focus-out'
  // macOS は Cmd+C・Cmd+V(Edit メニュー)で、xterm の copy・paste のイベントが扱う。Ctrl+C は常に端末へ(claude の中断)
  if (isMac) return 'terminal'
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'c') return hasSelection ? 'copy' : 'ignore'
    if (key === 'v') return 'paste'
  }
  return 'terminal'
}
