import type { AgentSessionData } from '@shared/types'
import {
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS
} from '@shared/types'
import type { ViewportBufferLike, ViewportLine } from './agentViewport'
import { isViewportAtBottom, readScreenLines, readViewportLines } from './agentViewport'
import { classifyAgentTerminalKey } from './agentTerminalKeys'
import { createPendingOutputBuffer } from './agentPendingOutput'

// xterm の Terminal とアドオン・IPC の出力の購読を持つ、React の外の部品(タブごとに 1 つ)。StrictMode の二重マウントやパネルの開閉で
// xterm を作り直さない(確認の結果 10)。タブを閉じたら dispose で購読と xterm を破棄する。終了の購読は hook が持つ(複数の controller が
// それぞれ購読すると重複して届くため)。表示の要素への取り付け・取り外し、fit、出力の書き込みとその完了の通知、表示中の画面・画面の末尾の読み取り、表示が末尾にあるかとスクロールの通知、大きさの変化の通知、
// 送信中の利用者のキー入力の保留と再送を受け持つ。xterm を直接触るのはこのモジュールと xtermFactory だけ

/** xterm の Terminal のうち、この部品が使うもの(テストでは偽物を渡す。パターン 128) */
export interface TerminalLike {
  readonly cols: number
  readonly rows: number
  readonly modes: { readonly bracketedPasteMode: boolean }
  readonly buffer: { readonly active: ViewportBufferLike }
  open(parent: HTMLElement): void
  write(data: string, callback?: () => void): void
  reset(): void
  focus(): void
  onData(listener: (data: string) => void): { dispose(): void }
  /** 表示の位置が変わった(利用者のスクロール・出力で末尾が進んだ)。値は新しい viewportY */
  onScroll(listener: (viewportY: number) => void): { dispose(): void }
  /** 桁数・行数が変わった(fit)。行を増やすと出力が無くてもスクロールバックの行が画面へ下りる */
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
  hasSelection(): boolean
  getSelection(): string
  paste(data: string): void
  dispose(): void
}

export interface FitAddonLike {
  fit(): void
}

export interface AgentTerminalApiLike {
  writeAgentSession(sessionId: string, data: string): void
  resizeAgentSession(sessionId: string, cols: number, rows: number): void
  onAgentData(listener: (payload: AgentSessionData) => void): () => void
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
  /** 画面の末尾(claude の現在の画面)を読む。利用者のスクロールに左右されない */
  readScreen(): ViewportLine[]
  /** 書いた出力を xterm がバッファに反映し終えたら呼ぶ(活動の判定のきっかけ。xterm の onRender〈画面の再描画〉とは別)。dispose の後は呼ばない。解除の関数を返す */
  onOutputWritten(listener: () => void): () => void
  /** 表示が画面の末尾にあるか(利用者が上へスクロールして前の出力を読み返していないか。isViewportAtBottom) */
  isScrolledToBottom(): boolean
  /** xterm の表示の位置が変わったら呼ぶ(xterm の onScroll)。dispose の後は呼ばない。解除の関数を返す */
  onScroll(listener: () => void): () => void
  /**
   * xterm の桁数・行数が変わったら呼ぶ(xterm の onResize)。行を増やすと xterm は出力が無くてもスクロールバックの行を画面へ下ろす
   * ため、readScreen・isScrolledToBottom の値が変わりうる(claude は行を増やしただけでは描き直さない)。dispose の後は呼ばない。解除の関数を返す
   */
  onResized(listener: () => void): () => void
  isBracketedPasteEnabled(): boolean
  /** 送信の手順の書き込み(利用者のキー入力の保留とは別に、直接 pty へ送る) */
  writeToSession(data: string): void
  /** 送信の手順の間、利用者のキー入力を溜める。endSending で順に送る */
  beginSending(): void
  /**
   * 保留を解き、溜めた入力を順に送る。discard が真なら送らずに捨て、捨てた数を返す(捨てないときは 0)。捨てるときも、xterm が
   * 自動で返すフォーカスの通知(FOCUS_REPORTS と完全一致のチャンク)は利用者の入力ではないので順に送り、数に入れない。マウスの
   * 報告(SGR_MOUSE_REPORT と完全一致のチャンク)も利用者のキー入力ではないので数に入れないが、クリックが選択肢を確定させうるので
   * 送らずに黙って捨てる。捨てる経路は書き込みを減らすだけで、pty へ届くバイトは増やさない(L-019)
   */
  endSending(options?: { discard: boolean }): number
  /** F6 でターミナルから抜けるときの移動先 */
  setFocusOutHandler(handler: (() => void) | null): void
  focus(): void
  /** IPC の購読を外し、xterm を破棄する(閉じたタブ)。以後の取り付け・fit・セッションへの書き込み・2 回目の dispose は何もしない */
  dispose(): void
}

/**
 * xterm がフォーカスの通知のモード(DECSET 1004。copilot が有効にする)の間に、フォーカス・ブラーで onData へ単独で出す固定の列。
 * 送信中に溜めた入力を捨てるときも、この列と完全一致のチャンクだけは送る(混ざったチャンクは利用者の入力として捨てる)
 */
const FOCUS_REPORTS: ReadonlySet<string> = new Set(['\x1b[I', '\x1b[O'])

/**
 * xterm が SGR のマウスの報告のモード(DECSET 1006。copilot が 1003 とあわせて有効にする)の間に、マウスの操作 1 回ごとに onData へ
 * 単独で出す報告(CoreMouseService の SGR の形)。送信中に溜めた入力を捨てるときは、この形と完全一致のチャンクを送らず、捨てた数
 * (利用者のキー入力)にも入れない。X10 の形(DEFAULT)は onBinary へ出て、ここでは購読していないので溜まらない
 */
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_REPORT = /^\x1b\[<\d+;\d+;\d+[Mm]$/

/** sessionId が決まるまでに届いた出力を溜める、セッションごとの上限(UTF-16 の単位) */
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
  let disposed = false
  const outputWrittenListeners = new Set<() => void>()
  const scrollListeners = new Set<() => void>()
  const resizedListeners = new Set<() => void>()

  // xterm が書き込みをバッファに反映し終えた合図(write のコールバック)。dispose で Set を空にするので、その後は何も呼ばない
  const notifyOutputWritten = (): void => {
    for (const listener of [...outputWrittenListeners]) listener()
  }

  const sizeOf = (): AgentTerminalSize => ({
    cols: clamp(terminal.cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS),
    rows: clamp(terminal.rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)
  })

  const unsubscribeData = api.onAgentData(({ sessionId: from, data }) => {
    if (disposed) return
    if (from === sessionId) {
      terminal.write(data, notifyOutputWritten)
      return
    }
    pendingOutput.push(from, data)
  })

  const scrollSubscription = terminal.onScroll(() => {
    for (const listener of [...scrollListeners]) listener()
  })

  const resizeSubscription = terminal.onResize(() => {
    for (const listener of [...resizedListeners]) listener()
  })

  terminal.onData((data) => {
    if (disposed || sessionId === null) return
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
      if (disposed) return
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
      if (disposed) return sizeOf()
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
        for (const data of pending) terminal.write(data, notifyOutputWritten)
        // 起動の依頼に含めた大きさを送った大きさとして控え、待つ間に大きさが変わっていれば今の大きさを送る
        lastSentSize = startSize ?? sizeOf()
        sendResizeIfChanged()
      }
      startSize = null
    },
    getSessionId: () => sessionId,
    readViewport: () => readViewportLines(terminal.buffer.active, terminal.rows),
    readScreen: () => readScreenLines(terminal.buffer.active, terminal.rows),
    onOutputWritten(listener) {
      outputWrittenListeners.add(listener)
      return () => {
        outputWrittenListeners.delete(listener)
      }
    },
    isScrolledToBottom: () => isViewportAtBottom(terminal.buffer.active),
    onScroll(listener) {
      scrollListeners.add(listener)
      return () => {
        scrollListeners.delete(listener)
      }
    },
    onResized(listener) {
      resizedListeners.add(listener)
      return () => {
        resizedListeners.delete(listener)
      }
    },
    isBracketedPasteEnabled: () => terminal.modes.bracketedPasteMode,
    writeToSession(data) {
      if (!disposed && sessionId !== null) api.writeAgentSession(sessionId, data)
    },
    beginSending() {
      sending = true
    },
    endSending(options) {
      sending = false
      const held = heldInput
      heldInput = []
      const discard = options?.discard === true
      if (!discard) {
        if (!disposed && sessionId !== null) {
          for (const data of held) api.writeAgentSession(sessionId, data)
        }
        return 0
      }
      // 捨てるとき: フォーカスの通知は送る、マウスの報告は黙って捨てる、ほか(利用者のキー入力)は捨てて数える
      let discarded = 0
      for (const data of held) {
        if (FOCUS_REPORTS.has(data)) {
          if (!disposed && sessionId !== null) api.writeAgentSession(sessionId, data)
        } else if (!SGR_MOUSE_REPORT.test(data)) {
          discarded += 1
        }
      }
      return discarded
    },
    setFocusOutHandler(handler) {
      focusOutHandler = handler
    },
    focus() {
      terminal.focus()
    },
    dispose() {
      if (disposed) return
      disposed = true
      outputWrittenListeners.clear()
      scrollListeners.clear()
      resizedListeners.clear()
      scrollSubscription.dispose()
      resizeSubscription.dispose()
      unsubscribeData()
      // フォーカスのある要素を取り除くと blur が配送されないことがあるため、外す前に blur して
      // AgentTerminalView の onBlur(メニューのショートカットの無視の解除)を届ける
      const active = document.activeElement
      if (host !== null && active instanceof HTMLElement && host.contains(active)) active.blur()
      host?.remove()
      host = null
      terminal.dispose()
      sessionId = null
    }
  }
}
