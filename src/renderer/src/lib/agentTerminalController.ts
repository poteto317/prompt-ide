import type { AgentSessionData, AgentSessionExit } from '@shared/types'
import {
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS
} from '@shared/types'
import type { ViewportBufferLike, ViewportLine } from './agentViewport'
import { readViewportLines } from './agentViewport'
import { classifyAgentTerminalKey } from './agentTerminalKeys'
import { createPendingOutputBuffer } from './agentPendingOutput'

// xterm の Terminal とアドオン・IPC の購読を持つ、React の外の部品(文書ごとに 1 つ)。StrictMode の二重マウントやパネルの開閉で
// xterm を作り直さない(確認の結果 10)。表示の要素への取り付け・取り外し、fit、出力の書き込み、終了の購読、表示中の画面の読み取り、
// 送信中の利用者のキー入力の保留と再送を受け持つ。xterm を直接触るのはこのモジュールと xtermFactory だけ

/** xterm の Terminal のうち、この部品が使うもの(テストでは偽物を渡す。パターン 128) */
export interface TerminalLike {
  readonly cols: number
  readonly rows: number
  readonly modes: { readonly bracketedPasteMode: boolean }
  readonly buffer: { readonly active: ViewportBufferLike }
  open(parent: HTMLElement): void
  write(data: string): void
  reset(): void
  focus(): void
  onData(listener: (data: string) => void): { dispose(): void }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
  hasSelection(): boolean
  getSelection(): string
  paste(data: string): void
}

export interface FitAddonLike {
  fit(): void
}

export interface AgentTerminalApiLike {
  writeAgentSession(sessionId: string, data: string): void
  resizeAgentSession(sessionId: string, cols: number, rows: number): void
  onAgentData(listener: (payload: AgentSessionData) => void): () => void
  onAgentExit(listener: (payload: AgentSessionExit) => void): () => void
}

export interface ClipboardLike {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
}

export interface AgentTerminalControllerDeps {
  terminal: TerminalLike
  fitAddon: FitAddonLike
  api: AgentTerminalApiLike
  clipboard: ClipboardLike
  isMac: boolean
  createHost: () => HTMLElement
}

export interface AgentTerminalSize {
  cols: number
  rows: number
}

export interface AgentTerminalController {
  /** 表示の要素に xterm を取り付ける(初回だけ open する) */
  attach(container: HTMLElement): void
  /** container から取り外す(xterm は破棄しない) */
  detach(container: HTMLElement): void
  /** 表示の大きさに合わせ、セッションがあれば変わった桁数・行数を main へ送る */
  fit(): AgentTerminalSize
  getSize(): AgentTerminalSize
  /** 起動の直前に呼ぶ。前のセッションの出力を消し、sessionId が決まるまでに届いた出力を溜める */
  prepareForStart(): void
  /** 出力と入力の対象のセッション。null で切り離す(終了・起動の失敗) */
  setSession(sessionId: string | null): void
  getSessionId(): string | null
  readViewport(): ViewportLine[]
  isBracketedPasteEnabled(): boolean
  /** 送信の手順の書き込み(利用者のキー入力の保留とは別に、直接 pty へ送る) */
  writeToSession(data: string): void
  /** 送信の手順の間、利用者のキー入力を溜める。endSending で順に送る */
  beginSending(): void
  endSending(): void
  onExit(listener: (exit: AgentSessionExit) => void): () => void
  /** F6 でターミナルから抜けるときの移動先 */
  setFocusOutHandler(handler: (() => void) | null): void
  focus(): void
}

/** sessionId が決まるまでに届いた出力を溜める上限(UTF-16 の単位) */
const MAX_PENDING_OUTPUT = 1_000_000

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function createAgentTerminalController({
  terminal,
  fitAddon,
  api,
  clipboard,
  isMac,
  createHost
}: AgentTerminalControllerDeps): AgentTerminalController {
  let host: HTMLElement | null = null
  let sessionId: string | null = null
  // 起動の準備から sessionId が決まるまでに届いた出力(prepareForStart で溜め始め、setSession で書いて終える)
  const pendingOutput = createPendingOutputBuffer(MAX_PENDING_OUTPUT)
  let sending = false
  let heldInput: string[] = []
  let lastSentSize: AgentTerminalSize | null = null
  // 起動の準備の後、最初の fit が返した大きさ(起動の依頼に含めた大きさ)。sessionId が決まるまでに大きさが変われば、決まったときに送り直す
  let startSize: AgentTerminalSize | null = null
  let focusOutHandler: (() => void) | null = null
  const exitListeners = new Set<(exit: AgentSessionExit) => void>()

  const sizeOf = (): AgentTerminalSize => ({
    cols: clamp(terminal.cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS),
    rows: clamp(terminal.rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)
  })

  api.onAgentData(({ sessionId: from, data }) => {
    if (from === sessionId) {
      terminal.write(data)
      return
    }
    pendingOutput.push(from, data)
  })
  api.onAgentExit((exit) => {
    for (const listener of [...exitListeners]) listener(exit)
  })

  terminal.onData((data) => {
    if (sessionId === null) return
    if (sending) heldInput.push(data)
    else api.writeAgentSession(sessionId, data)
  })

  terminal.attachCustomKeyEventHandler((event) => {
    const action = classifyAgentTerminalKey(event, isMac, terminal.hasSelection())
    if (action === 'terminal') return true
    if (action === 'focus-out') {
      event.preventDefault()
      focusOutHandler?.()
    } else if (action === 'copy') {
      event.preventDefault()
      void clipboard.writeText(terminal.getSelection()).catch(() => undefined)
    } else if (action === 'paste') {
      event.preventDefault()
      // 押しっぱなし(キーの自動リピート)で貼り付けが連続しないよう、最初の keydown だけ貼り付ける
      if (event.repeat) return false
      void clipboard
        .readText()
        .then((text) => terminal.paste(text))
        .catch(() => undefined)
    }
    return false
  })

  const sendResizeIfChanged = (): void => {
    if (sessionId === null) return
    const size = sizeOf()
    if (lastSentSize !== null && lastSentSize.cols === size.cols && lastSentSize.rows === size.rows)
      return
    lastSentSize = size
    api.resizeAgentSession(sessionId, size.cols, size.rows)
  }

  return {
    attach(container) {
      if (host === null) {
        host = createHost()
        container.appendChild(host)
        terminal.open(host)
        return
      }
      if (host.parentElement !== container) container.appendChild(host)
    },
    detach(container) {
      if (host !== null && host.parentElement === container) container.removeChild(host)
    },
    fit() {
      // 表示されていない(display: none・取り外した)ときの fit は大きさを測れず、例外や 0 になりうる
      if (host !== null && host.isConnected) {
        try {
          fitAddon.fit()
        } catch {
          // 測れないときは前の大きさのまま
        }
      }
      sendResizeIfChanged()
      const size = sizeOf()
      if (sessionId === null && pendingOutput.isCollecting() && startSize === null) startSize = size
      return size
    },
    getSize: sizeOf,
    prepareForStart() {
      terminal.reset()
      sessionId = null
      pendingOutput.begin()
      lastSentSize = null
      startSize = null
      heldInput = []
    },
    setSession(next) {
      sessionId = next
      const pending = pendingOutput.take(next)
      if (next !== null) {
        for (const data of pending) terminal.write(data)
        // 起動の依頼に含めた大きさを送った大きさとして控え、待つ間に大きさが変わっていれば今の大きさを送る
        lastSentSize = startSize ?? sizeOf()
        sendResizeIfChanged()
      }
      startSize = null
    },
    getSessionId: () => sessionId,
    readViewport: () => readViewportLines(terminal.buffer.active, terminal.rows),
    isBracketedPasteEnabled: () => terminal.modes.bracketedPasteMode,
    writeToSession(data) {
      if (sessionId !== null) api.writeAgentSession(sessionId, data)
    },
    beginSending() {
      sending = true
    },
    endSending() {
      sending = false
      const held = heldInput
      heldInput = []
      if (sessionId === null) return
      for (const data of held) api.writeAgentSession(sessionId, data)
    },
    onExit(listener) {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    setFocusOutHandler(handler) {
      focusOutHandler = handler
    },
    focus() {
      terminal.focus()
    }
  }
}
