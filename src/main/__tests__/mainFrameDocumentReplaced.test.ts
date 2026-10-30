import { describe, it, expect, vi } from 'vitest'
import type { WebContents } from 'electron'
import { onMainFrameDocumentReplaced } from '../mainFrameDocumentReplaced'

type Handler = (...args: unknown[]) => void

// on で登録されたハンドラを、イベント名ごとに呼び出せる偽の WebContents
function fakeWebContents(): {
  webContents: WebContents
  emit: (event: string, ...args: unknown[]) => void
} {
  const handlers = new Map<string, Handler[]>()
  const on = vi.fn((event: string, handler: Handler) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler])
  })
  const emit = (event: string, ...args: unknown[]): void => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }
  return { webContents: { on } as unknown as WebContents, emit }
}

const ERR_ABORTED = -3
const ERR_CONNECTION_REFUSED = -102

describe('onMainFrameDocumentReplaced', () => {
  it('did-navigate(リロード・遷移の確定)で listener を呼ぶ', () => {
    const { webContents, emit } = fakeWebContents()
    const listener = vi.fn()
    onMainFrameDocumentReplaced(webContents, listener)
    emit('did-navigate', {}, 'file:///index.html')
    expect(listener).toHaveBeenCalledOnce()
  })

  it('メインフレームの読み込みの失敗(ERR_ABORTED 以外)はエラーの画面への入れ替わりとして listener を呼ぶ', () => {
    const { webContents, emit } = fakeWebContents()
    const listener = vi.fn()
    onMainFrameDocumentReplaced(webContents, listener)
    emit('did-fail-load', {}, ERR_CONNECTION_REFUSED, 'ERR_CONNECTION_REFUSED', 'http://x', true)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('ERR_ABORTED(遷移の取り消し。今の文書が残る)では呼ばない', () => {
    const { webContents, emit } = fakeWebContents()
    const listener = vi.fn()
    onMainFrameDocumentReplaced(webContents, listener)
    emit('did-fail-load', {}, ERR_ABORTED, 'ERR_ABORTED', 'http://x', true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('サブフレームの読み込みの失敗では呼ばない(メインフレームの文書は残る)', () => {
    const { webContents, emit } = fakeWebContents()
    const listener = vi.fn()
    onMainFrameDocumentReplaced(webContents, listener)
    emit('did-fail-load', {}, ERR_CONNECTION_REFUSED, 'ERR_CONNECTION_REFUSED', 'http://x', false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('did-start-navigation(止めた遷移でも届く)には反応しない', () => {
    const { webContents, emit } = fakeWebContents()
    const listener = vi.fn()
    onMainFrameDocumentReplaced(webContents, listener)
    emit('did-start-navigation', {}, 'file:///dropped.txt', false, true)
    expect(listener).not.toHaveBeenCalled()
    expect(vi.mocked(webContents.on).mock.calls.map(([event]) => event)).toEqual([
      'did-navigate',
      'did-fail-load'
    ])
  })
})
