import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useTransientNotice } from '../useTransientNotice'
import type { TransientNotice } from '../useTransientNotice'

const DURATION_MS = 1000

const renderNotice = (): RenderHookResult<TransientNotice, unknown> =>
  renderHook(() => useTransientNotice(DURATION_MS))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useTransientNotice', () => {
  it('最初は通知なし', () => {
    const { result } = renderNotice()

    expect(result.current.notice).toBeNull()
  })

  it('announce で文言の通知を出し、id は 1 から始まる', () => {
    const { result } = renderNotice()

    act(() => result.current.announce('挿入しました'))

    expect(result.current.notice).toEqual({ text: '挿入しました', id: 1 })
  })

  it('同じ文言を続けて announce しても、id が進む(同じ文言でも読み上げ直すため)', () => {
    const { result } = renderNotice()

    act(() => result.current.announce('挿入しました'))
    act(() => result.current.announce('挿入しました'))

    expect(result.current.notice).toEqual({ text: '挿入しました', id: 2 })
  })

  it('通知は durationMs で消える', () => {
    vi.useFakeTimers()
    const { result } = renderNotice()

    act(() => result.current.announce('挿入しました'))
    act(() => vi.advanceTimersByTime(DURATION_MS - 1))
    expect(result.current.notice).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.notice).toBeNull()
  })

  it('続けて announce したら、最後の announce から数え直す', () => {
    vi.useFakeTimers()
    const { result } = renderNotice()

    act(() => result.current.announce('X'))
    act(() => vi.advanceTimersByTime(DURATION_MS - 1))
    act(() => result.current.announce('Y'))
    act(() => vi.advanceTimersByTime(DURATION_MS - 1))
    expect(result.current.notice?.text).toBe('Y')

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.notice).toBeNull()
  })

  it('消えた後の announce でも id は進み続ける(前の通知と区別する)', () => {
    vi.useFakeTimers()
    const { result } = renderNotice()

    act(() => result.current.announce('X'))
    act(() => vi.advanceTimersByTime(DURATION_MS))
    act(() => result.current.announce('X'))

    expect(result.current.notice).toEqual({ text: 'X', id: 2 })
  })

  it('通知が無い間はタイマーを張らない(消えた後も)', () => {
    vi.useFakeTimers()
    const { result } = renderNotice()
    expect(vi.getTimerCount()).toBe(0)

    act(() => result.current.announce('X'))
    act(() => vi.advanceTimersByTime(DURATION_MS))

    expect(result.current.notice).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('アンマウントでタイマーを解除する', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderNotice()
    act(() => result.current.announce('X'))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('clear で通知を消し、タイマーも解除する', () => {
    vi.useFakeTimers()
    const { result } = renderNotice()
    act(() => result.current.announce('X'))
    expect(vi.getTimerCount()).toBe(1)

    act(() => result.current.clear())

    expect(result.current.notice).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clear の後の announce でも id は進み続ける(前の通知と区別する)', () => {
    const { result } = renderNotice()

    act(() => result.current.announce('X'))
    act(() => result.current.clear())
    act(() => result.current.announce('X'))

    expect(result.current.notice).toEqual({ text: 'X', id: 2 })
  })

  it('announce は描画をまたいで同じ参照(依存配列に入れても effect を作り直さない)', () => {
    const { result } = renderNotice()
    const first = result.current.announce

    act(() => result.current.announce('X'))

    expect(result.current.announce).toBe(first)
  })

  it('clear は描画をまたいで同じ参照(依存配列に入れても effect を作り直さない)', () => {
    const { result } = renderNotice()
    const first = result.current.clear

    act(() => result.current.announce('X'))

    expect(result.current.clear).toBe(first)
  })
})
