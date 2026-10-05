import { describe, it, expect, beforeEach } from 'vitest'
import { createAgentTerminalController } from '../agentTerminalController'
import type { AgentTerminalController } from '../agentTerminalController'
import {
  makeFakeAgentApi,
  makeFakeClipboard,
  makeFakeFitAddon,
  makeFakeTerminal
} from '../../__tests__/makeFakeAgentTerminal'
import type { FakeAgentApi, FakeTerminal } from '../../__tests__/makeFakeAgentTerminal'

let terminal: FakeTerminal
let api: FakeAgentApi
let fitAddon: ReturnType<typeof makeFakeFitAddon>
let clipboard: ReturnType<typeof makeFakeClipboard>
let controller: AgentTerminalController

function create(isMac = false): AgentTerminalController {
  return createAgentTerminalController({
    terminal,
    fitAddon,
    api,
    clipboard,
    isMac,
    createHost: () => document.createElement('div')
  })
}

beforeEach(() => {
  terminal = makeFakeTerminal()
  api = makeFakeAgentApi()
  fitAddon = makeFakeFitAddon()
  clipboard = makeFakeClipboard('pasted')
  controller = create()
})

describe('attach・detach', () => {
  it('初回だけ open し、取り付け直しても xterm を作り直さない(StrictMode の二重マウント)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.detach(container)
    controller.attach(container)
    expect(terminal.open).toHaveBeenCalledOnce()
    expect(container.childElementCount).toBe(1)
    container.remove()
  })

  it('別の container へ移せる', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    controller.attach(a)
    controller.attach(b)
    expect(a.childElementCount).toBe(0)
    expect(b.childElementCount).toBe(1)
  })
})

describe('出力', () => {
  it('現在のセッションの出力だけを書き、ほかのセッションの出力は捨てる', () => {
    controller.setSession('s1')
    api.emitData({ sessionId: 's1', data: 'a' })
    api.emitData({ sessionId: 'old', data: 'b' })
    expect(terminal.written).toEqual(['a'])
  })

  it('起動の準備の後、sessionId が決まるまでに届いた出力を溜め、決まったら書く', () => {
    controller.prepareForStart()
    api.emitData({ sessionId: 's2', data: 'early' })
    api.emitData({ sessionId: 'other', data: 'x' })
    controller.setSession('s2')
    api.emitData({ sessionId: 's2', data: 'late' })
    expect(terminal.reset).toHaveBeenCalledOnce()
    expect(terminal.written).toEqual(['early', 'late'])
  })

  it('溜める出力が上限(1,000,000 文字)を超えたら、その後の小さいチャンクも溜めない(途中が欠けた出力にしない)', () => {
    controller.prepareForStart()
    const head = 'a'.repeat(999_999)
    api.emitData({ sessionId: 's2', data: head })
    api.emitData({ sessionId: 's2', data: 'bc' })
    api.emitData({ sessionId: 's2', data: 'd' })
    controller.setSession('s2')
    api.emitData({ sessionId: 's2', data: 'late' })
    expect(terminal.written).toEqual([head, 'late'])
  })

  it('起動の準備をしていないときは、知らないセッションの出力を溜めない', () => {
    api.emitData({ sessionId: 's3', data: 'x' })
    controller.setSession('s3')
    expect(terminal.written).toEqual([])
  })
})

describe('入力', () => {
  it('セッションがあれば利用者の入力を送り、無ければ送らない', () => {
    terminal.typeKey('x')
    controller.setSession('s1')
    terminal.typeKey('y')
    expect(api.writeAgentSession.mock.calls).toEqual([['s1', 'y']])
  })

  it('送信中の入力は溜め、終わったら順に送る。送信の手順の書き込みは溜めない', () => {
    controller.setSession('s1')
    controller.beginSending()
    terminal.typeKey('a')
    controller.writeToSession('PASTE')
    terminal.typeKey('b')
    expect(api.writeAgentSession.mock.calls).toEqual([['s1', 'PASTE']])
    controller.endSending()
    expect(api.writeAgentSession.mock.calls).toEqual([
      ['s1', 'PASTE'],
      ['s1', 'a'],
      ['s1', 'b']
    ])
  })
})

describe('fit', () => {
  it('取り付けている間は fit し、大きさが変わったときだけ main へ送る', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.setSession('s1')
    terminal.cols = 120
    terminal.rows = 40
    expect(controller.fit()).toEqual({ cols: 120, rows: 40 })
    controller.fit()
    expect(fitAddon.fit).toHaveBeenCalledTimes(2)
    expect(api.resizeAgentSession.mock.calls).toEqual([['s1', 120, 40]])
    container.remove()
  })

  it('起動の依頼の後、sessionId が決まるまでに大きさが変わったら、決まったときに最新の大きさを 1 回だけ送る', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.prepareForStart()
    // 起動の依頼に使う大きさ(Task 20 の start は prepareForStart → fit → startAgentSession の順)
    expect(controller.fit()).toEqual({ cols: 80, rows: 24 })
    terminal.cols = 120
    terminal.rows = 40
    controller.fit()
    expect(api.resizeAgentSession).not.toHaveBeenCalled()
    controller.setSession('s1')
    // 次の fit を待たず、決まった時点で送る
    expect(api.resizeAgentSession.mock.calls).toEqual([['s1', 120, 40]])
    controller.fit()
    expect(api.resizeAgentSession.mock.calls).toEqual([['s1', 120, 40]])
    container.remove()
  })

  it('起動の依頼から sessionId が決まるまでに大きさが変わらなければ、決まっても送らない', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.prepareForStart()
    controller.fit()
    controller.fit()
    controller.setSession('s1')
    controller.fit()
    expect(api.resizeAgentSession).not.toHaveBeenCalled()
    container.remove()
  })

  it('起動の準備をしていないときの fit は起動時の大きさとして控えない(準備なしに決まったセッションへ古い大きさを送らない)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    controller.fit()
    terminal.cols = 120
    terminal.rows = 40
    controller.setSession('s1')
    expect(api.resizeAgentSession).not.toHaveBeenCalled()
    container.remove()
  })

  it('取り付けていないときは fit しない', () => {
    controller.fit()
    expect(fitAddon.fit).not.toHaveBeenCalled()
  })

  it('fit が投げても前の大きさを返す', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    controller.attach(container)
    fitAddon.fit.mockImplementationOnce(() => {
      throw new Error('no dimensions')
    })
    expect(controller.fit()).toEqual({ cols: 80, rows: 24 })
    container.remove()
  })
})

describe('キー', () => {
  it('F6 は端末へ送らず、抜け先へフォーカスを移す', () => {
    let moved = 0
    controller.setFocusOutHandler(() => {
      moved += 1
    })
    expect(terminal.pressKey({ key: 'F6' })).toBe(false)
    expect(moved).toBe(1)
  })

  it('Windows・Linux の Ctrl+Shift+C は選択範囲をクリップボードへ書き、端末へ送らない', () => {
    terminal.selection = 'sel'
    expect(terminal.pressKey({ key: 'C', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(clipboard.writeText).toHaveBeenCalledWith('sel')
  })

  it('Windows・Linux の Ctrl+Shift+V はクリップボードを xterm の貼り付けで入れる', async () => {
    expect(terminal.pressKey({ key: 'V', ctrlKey: true, shiftKey: true })).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.paste).toHaveBeenCalledWith('pasted')
  })

  it('Ctrl+Shift+V の押しっぱなし(repeat)では貼り付けを繰り返さず、端末へも送らない', async () => {
    expect(terminal.pressKey({ key: 'V', ctrlKey: true, shiftKey: true, repeat: true })).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(clipboard.readText).not.toHaveBeenCalled()
    expect(terminal.paste).not.toHaveBeenCalled()
  })

  it('Ctrl+C は端末へ送る', () => {
    expect(terminal.pressKey({ key: 'c', ctrlKey: true })).toBe(true)
  })
})

describe('読み取り・終了', () => {
  it('bracketed paste の状態と表示中の画面を読む', () => {
    terminal.modes.bracketedPasteMode = false
    expect(controller.isBracketedPasteEnabled()).toBe(false)
    expect(controller.readViewport()).toHaveLength(24)
  })

  it('終了を購読者へ渡し、解除の後は渡さない', () => {
    const received: string[] = []
    const dispose = controller.onExit((exit) => received.push(exit.sessionId))
    api.emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' })
    dispose()
    api.emitExit({ sessionId: 's2', exitCode: 0, signal: null, reason: 'exited' })
    expect(received).toEqual(['s1'])
  })
})
