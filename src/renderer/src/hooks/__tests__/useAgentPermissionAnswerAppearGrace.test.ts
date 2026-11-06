// src/renderer/src/hooks/__tests__/useAgentPermissionAnswerAppearGrace.test.ts
import { useLayoutEffect } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentPermissionAnswerAppearGrace } from '../useAgentPermissionAnswerAppearGrace'
import type {
  AgentPermissionAnswerAppearGrace,
  UseAgentPermissionAnswerAppearGraceOptions
} from '../useAgentPermissionAnswerAppearGrace'
import { AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS } from '../../lib/agentPermissionAnswer'
import type { AgentPermissionPrompt } from '../../lib/agentPermissionPrompt'
import { readAgentPermissionPromptOrThrow } from '../../__tests__/readAgentPermissionPromptOrThrow'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'

const PROMPT = readAgentPermissionPromptOrThrow('claude', agentScreen('permission').lines)
// 問いだけが違う別の確認
const OTHER_PROMPT: AgentPermissionPrompt = { ...PROMPT, question: ['Do you want to delete?'] }

const hidden: UseAgentPermissionAnswerAppearGraceOptions = {
  slotId: 'slot-1',
  visible: false,
  prompt: null
}
const shown = (
  overrides: Partial<UseAgentPermissionAnswerAppearGraceOptions> = {}
): UseAgentPermissionAnswerAppearGraceOptions => ({
  slotId: 'slot-1',
  visible: true,
  prompt: PROMPT,
  ...overrides
})

const render = (
  initial: UseAgentPermissionAnswerAppearGraceOptions
): RenderHookResult<AgentPermissionAnswerAppearGrace, UseAgentPermissionAnswerAppearGraceOptions> =>
  renderHook(
    (p: UseAgentPermissionAnswerAppearGraceOptions) => useAgentPermissionAnswerAppearGrace(p),
    {
      initialProps: initial
    }
  )

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionAnswerAppearGrace', () => {
  it('出ていない間は猶予にならない', () => {
    const { result } = render(hidden)
    expect(result.current.isJustAppeared).toBe(false)
    expect(result.current.isJustAppearedNow()).toBe(false)
  })

  it('visible が偽から真になった描画から 1,000ms は猶予(描画用と押した時点用の両方)、その後は外れる', () => {
    const { result, rerender } = render(hidden)
    rerender(shown())
    expect(result.current.isJustAppeared).toBe(true)
    expect(result.current.isJustAppearedNow()).toBe(true)
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS - 1)
    expect(result.current.isJustAppeared).toBe(true)
    expect(result.current.isJustAppearedNow()).toBe(true)
    advance(1)
    expect(result.current.isJustAppeared).toBe(false)
    expect(result.current.isJustAppearedNow()).toBe(false)
  })

  it('最初の描画から出ていても猶予になる', () => {
    const { result } = render(shown())
    expect(result.current.isJustAppeared).toBe(true)
  })

  it('描画の控えの prompt が別の確認に替わった描画から、猶予を数え直す', () => {
    const { result, rerender } = render(shown())
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    expect(result.current.isJustAppeared).toBe(false)
    rerender(shown({ prompt: OTHER_PROMPT }))
    expect(result.current.isJustAppeared).toBe(true)
    expect(result.current.isJustAppearedNow()).toBe(true)
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    expect(result.current.isJustAppeared).toBe(false)
  })

  it('読み取れない(null)から読み取れた描画も猶予(問いが出て帯の並びが変わる)', () => {
    const { result, rerender } = render(shown({ prompt: null }))
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    rerender(shown())
    expect(result.current.isJustAppeared).toBe(true)
  })

  it('同じ確認でカーソルだけが動いた描画では猶予にならない', () => {
    const { result, rerender } = render(shown())
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    rerender(shown({ prompt: { ...PROMPT, cursorNumber: 2 } }))
    expect(result.current.isJustAppeared).toBe(false)
  })

  it('別のタブを選んだ描画で出ていれば猶予を数え直し、出なくなったら外れる', () => {
    const { result, rerender } = render(shown())
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    rerender(shown({ slotId: 'slot-2' }))
    expect(result.current.isJustAppeared).toBe(true)
    rerender(hidden)
    expect(result.current.isJustAppeared).toBe(false)
    expect(result.current.isJustAppearedNow()).toBe(false)
  })

  it('出た描画の layout effect の時点(最初に見えたフレームの前)で、押した時点用の猶予が立っている', () => {
    // useEffect(passive)だと描画の後に立つため、同じ描画の layout effect からは false に見える。renderHook・act は passive まで流すので、
    // hook の後ろに置いた layout effect の中で記録して確かめる
    const seen: boolean[] = []
    const { rerender } = renderHook(
      (p: UseAgentPermissionAnswerAppearGraceOptions) => {
        const grace = useAgentPermissionAnswerAppearGrace(p)
        useLayoutEffect(() => {
          if (p.visible) seen.push(grace.isJustAppearedNow())
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [p.visible])
        return grace
      },
      { initialProps: hidden }
    )
    rerender(shown())
    expect(seen).toEqual([true])
  })

  it('猶予のタイマーはアンマウントで残らない', () => {
    const { unmount } = render(shown())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('StrictMode の付け直しでも、付け直した描画で数え直し、1,000ms 後は描画用と押した時点用の両方が外れる', () => {
    const { result } = renderHook(
      (p: UseAgentPermissionAnswerAppearGraceOptions) => useAgentPermissionAnswerAppearGrace(p),
      { initialProps: shown(), reactStrictMode: true }
    )
    expect(result.current.isJustAppeared).toBe(true)
    expect(result.current.isJustAppearedNow()).toBe(true)
    advance(AGENT_PERMISSION_ANSWER_APPEAR_GRACE_MS)
    expect(result.current.isJustAppeared).toBe(false)
    expect(result.current.isJustAppearedNow()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
