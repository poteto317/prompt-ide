import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useEffect, useRef } from 'react'
import type { AgentChangesPanelState } from '../useAgentChangesWiring'
import type { AgentChangesView } from '../useAgentChanges'
import { useAgentChangesClearFocus } from '../useAgentChangesClearFocus'
import {
  makeAgentChangesController,
  makeAgentChangesPanelState,
  makeAgentChangesRecordingView
} from '../../__tests__/makeAgentChangesState'

const recording: AgentChangesView = makeAgentChangesRecordingView(null, { startedAt: 1 })
const none: AgentChangesView = { kind: 'none' }

function makeState(
  view: AgentChangesView,
  isAgentMode: boolean,
  clear: () => Promise<void> = vi.fn(async () => undefined)
): AgentChangesPanelState {
  return makeAgentChangesPanelState({
    changes: makeAgentChangesController({ view, clear }),
    isAgentMode
  })
}

// 描画の外の変数へ代入しない(react-hooks/globals)ため、結果は保持用のオブジェクトの中に入れる
const result: { current: AgentChangesPanelState | undefined } = { current: undefined }

function Harness({
  state,
  refreshDisabled = false
}: {
  state: AgentChangesPanelState | undefined
  refreshDisabled?: boolean
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const value = useAgentChangesClearFocus(rootRef, state)
  useEffect(() => {
    result.current = value
  })
  return (
    <div ref={rootRef}>
      <button className="source-control-panel__refresh-btn" disabled={refreshDisabled}>
        更新
      </button>
      <button>他</button>
    </div>
  )
}

describe('useAgentChangesClearFocus', () => {
  it('agentChanges が undefined なら undefined を返す', () => {
    render(<Harness state={undefined} />)
    expect(result.current).toBeUndefined()
  })

  it('従来の方式で clear → セクションが消えた描画の後に「更新」へフォーカスを移す', async () => {
    const clear = vi.fn(async () => undefined)
    const { rerender } = render(<Harness state={makeState(recording, false, clear)} />)
    await act(async () => {
      await result.current!.changes.clear()
    })
    expect(clear).toHaveBeenCalledOnce()
    // まだ消えていない間は移さない
    expect(screen.getByRole('button', { name: '更新' })).not.toHaveFocus()
    rerender(<Harness state={makeState(none, false, clear)} />)
    expect(screen.getByRole('button', { name: '更新' })).toHaveFocus()
  })

  it('予約は 1 回だけ扱う(後から再び消えても移さない)', async () => {
    const { rerender } = render(<Harness state={makeState(recording, false)} />)
    await act(async () => {
      await result.current!.changes.clear()
    })
    rerender(<Harness state={makeState(none, false)} />)
    const refresh = screen.getByRole('button', { name: '更新' })
    expect(refresh).toHaveFocus()
    refresh.blur()
    rerender(<Harness state={makeState(recording, false)} />)
    rerender(<Harness state={makeState(none, false)} />)
    expect(refresh).not.toHaveFocus()
  })

  it('エージェント CLI 方式では予約しない', async () => {
    const { rerender } = render(<Harness state={makeState(recording, true)} />)
    await act(async () => {
      await result.current!.changes.clear()
    })
    rerender(<Harness state={makeState(none, true)} />)
    expect(screen.getByRole('button', { name: '更新' })).not.toHaveFocus()
  })

  it('clear を呼ばずにセクションが消えても移さない', () => {
    const { rerender } = render(<Harness state={makeState(recording, false)} />)
    rerender(<Harness state={makeState(none, false)} />)
    expect(screen.getByRole('button', { name: '更新' })).not.toHaveFocus()
  })

  it('フォーカスが body 以外にあれば移さない', async () => {
    const { rerender } = render(<Harness state={makeState(recording, false)} />)
    await act(async () => {
      await result.current!.changes.clear()
    })
    screen.getByRole('button', { name: '他' }).focus()
    rerender(<Harness state={makeState(none, false)} />)
    expect(screen.getByRole('button', { name: '他' })).toHaveFocus()
    expect(screen.getByRole('button', { name: '更新' })).not.toHaveFocus()
  })

  it('「更新」が disabled のときは移さない', async () => {
    const { rerender } = render(<Harness state={makeState(recording, false)} refreshDisabled />)
    await act(async () => {
      await result.current!.changes.clear()
    })
    rerender(<Harness state={makeState(none, false)} refreshDisabled />)
    expect(document.body).toHaveFocus()
  })

  it('包んだ clear は元の clear の結果をそのまま返し、ほかの props は変えない', async () => {
    const state = makeState(
      recording,
      false,
      vi.fn(async () => undefined)
    )
    render(<Harness state={state} />)
    expect(result.current!.folderPath).toBe('/repo')
    expect(result.current!.changes.view).toBe(recording)
    expect(result.current!.changes.begin).toBe(state.changes.begin)
    await expect(result.current!.changes.clear()).resolves.toBeUndefined()
  })
})
