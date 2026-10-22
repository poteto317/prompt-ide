import { vi } from 'vitest'
import type {
  AgentTerminalApiLike,
  AgentTerminalController,
  ClipboardLike,
  FitAddonLike,
  TerminalLike
} from '../lib/agentTerminalController'
import type { ViewportBufferLike, ViewportLine } from '../lib/agentViewport'
import type { AgentSessionData } from '@shared/types'

// xterm の偽物。open・write・reset などを記録し、onData・キーのハンドラをテストから起こせる
export interface FakeTerminal extends TerminalLike {
  cols: number
  rows: number
  modes: { bracketedPasteMode: boolean }
  buffer: { active: ViewportBufferLike }
  written: string[]
  /** 溜めておいた write のコールバック(xterm が出力をバッファに反映し終えた合図。画面の再描画とは別)を呼ぶ */
  flushWrites(): void
  open: ReturnType<typeof vi.fn<TerminalLike['open']>>
  reset: ReturnType<typeof vi.fn<TerminalLike['reset']>>
  paste: ReturnType<typeof vi.fn<TerminalLike['paste']>>
  focus: ReturnType<typeof vi.fn<TerminalLike['focus']>>
  dispose: ReturnType<typeof vi.fn<TerminalLike['dispose']>>
  selection: string
  typeKey(data: string): void
  pressKey(init: KeyboardEventInit & { type?: string }): boolean
}

export function makeFakeTerminal(): FakeTerminal {
  let dataListener: (data: string) => void = () => undefined
  let keyHandler: (event: KeyboardEvent) => boolean = () => true
  const pendingWriteCallbacks: Array<() => void> = []
  const fake: FakeTerminal = {
    cols: 80,
    rows: 24,
    modes: { bracketedPasteMode: true },
    buffer: { active: { viewportY: 0, baseY: 0, getLine: () => undefined } },
    written: [],
    flushWrites: () => {
      const callbacks = pendingWriteCallbacks.splice(0)
      for (const callback of callbacks) callback()
    },
    selection: '',
    open: vi.fn<TerminalLike['open']>(),
    write: (data, callback) => {
      fake.written.push(data)
      if (callback !== undefined) pendingWriteCallbacks.push(callback)
    },
    reset: vi.fn<TerminalLike['reset']>(),
    focus: vi.fn<TerminalLike['focus']>(),
    dispose: vi.fn<TerminalLike['dispose']>(),
    onData: (listener) => {
      dataListener = listener
      return { dispose: () => undefined }
    },
    attachCustomKeyEventHandler: (handler) => {
      keyHandler = handler
    },
    hasSelection: () => fake.selection !== '',
    getSelection: () => fake.selection,
    paste: vi.fn<TerminalLike['paste']>(),
    typeKey: (data) => dataListener(data),
    pressKey: ({ type = 'keydown', ...init }) => keyHandler(new KeyboardEvent(type, init))
  }
  return fake
}

// IPC の偽物。出力をテストから起こせる
export interface FakeAgentApi extends AgentTerminalApiLike {
  writeAgentSession: ReturnType<typeof vi.fn<AgentTerminalApiLike['writeAgentSession']>>
  resizeAgentSession: ReturnType<typeof vi.fn<AgentTerminalApiLike['resizeAgentSession']>>
  emitData(payload: AgentSessionData): void
}

export function makeFakeAgentApi(): FakeAgentApi {
  const dataListeners = new Set<(payload: AgentSessionData) => void>()
  return {
    writeAgentSession: vi.fn<AgentTerminalApiLike['writeAgentSession']>(),
    resizeAgentSession: vi.fn<AgentTerminalApiLike['resizeAgentSession']>(),
    onAgentData: (listener) => {
      dataListeners.add(listener)
      return () => dataListeners.delete(listener)
    },
    emitData: (payload) => dataListeners.forEach((listener) => listener(payload))
  }
}

export function makeFakeClipboard(text = ''): ClipboardLike & {
  writeText: ReturnType<typeof vi.fn<ClipboardLike['writeText']>>
} {
  return {
    readText: vi.fn<ClipboardLike['readText']>(async () => text),
    writeText: vi.fn<ClipboardLike['writeText']>(async () => undefined)
  }
}

export const makeFakeFitAddon = (): FitAddonLike & {
  fit: ReturnType<typeof vi.fn<FitAddonLike['fit']>>
} => ({
  fit: vi.fn<FitAddonLike['fit']>()
})

/** hook・部品のテスト用の、controller そのものの偽物(画面の行は viewport で差し替える) */
export interface FakeController extends AgentTerminalController {
  viewport: ViewportLine[]
  /** readScreen が返す画面の末尾の行 */
  screen: ViewportLine[]
  /** 張られている書き込みの通知の購読(解除の確認に使う) */
  outputWrittenListeners: Set<() => void>
  /** 書き込みの通知(onOutputWritten)をテストから起こす */
  emitOutputWritten(): void
  bracketed: boolean
  sessionId: string | null
  writes: string[]
  attach: ReturnType<typeof vi.fn<AgentTerminalController['attach']>>
  detach: ReturnType<typeof vi.fn<AgentTerminalController['detach']>>
  fit: ReturnType<typeof vi.fn<AgentTerminalController['fit']>>
  prepareForStart: ReturnType<typeof vi.fn<AgentTerminalController['prepareForStart']>>
  beginSending: ReturnType<typeof vi.fn<AgentTerminalController['beginSending']>>
  endSending: ReturnType<typeof vi.fn<AgentTerminalController['endSending']>>
  setFocusOutHandler: ReturnType<typeof vi.fn<AgentTerminalController['setFocusOutHandler']>>
  focus: ReturnType<typeof vi.fn<AgentTerminalController['focus']>>
  dispose: ReturnType<typeof vi.fn<AgentTerminalController['dispose']>>
}

export function makeFakeController(): FakeController {
  const fake: FakeController = {
    viewport: [],
    screen: [],
    outputWrittenListeners: new Set(),
    bracketed: true,
    sessionId: null,
    writes: [],
    attach: vi.fn<AgentTerminalController['attach']>(),
    detach: vi.fn<AgentTerminalController['detach']>(),
    fit: vi.fn<AgentTerminalController['fit']>(() => ({ cols: 80, rows: 24 })),
    getSize: () => ({ cols: 80, rows: 24 }),
    prepareForStart: vi.fn<AgentTerminalController['prepareForStart']>(),
    setSession: (sessionId) => {
      fake.sessionId = sessionId
    },
    getSessionId: () => fake.sessionId,
    readViewport: () => fake.viewport,
    readScreen: () => fake.screen,
    onOutputWritten: (listener) => {
      fake.outputWrittenListeners.add(listener)
      return () => {
        fake.outputWrittenListeners.delete(listener)
      }
    },
    emitOutputWritten: () => fake.outputWrittenListeners.forEach((listener) => listener()),
    isBracketedPasteEnabled: () => fake.bracketed,
    writeToSession: (data) => {
      fake.writes.push(data)
    },
    beginSending: vi.fn<AgentTerminalController['beginSending']>(),
    endSending: vi.fn<AgentTerminalController['endSending']>(() => 0),
    setFocusOutHandler: vi.fn<AgentTerminalController['setFocusOutHandler']>(),
    focus: vi.fn<AgentTerminalController['focus']>(),
    dispose: vi.fn<AgentTerminalController['dispose']>()
  }
  return fake
}
