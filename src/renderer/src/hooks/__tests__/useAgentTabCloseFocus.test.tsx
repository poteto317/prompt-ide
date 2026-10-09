import { render, screen, act } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { useEffect, useRef } from 'react'
import { useAgentTabCloseFocus } from '../useAgentTabCloseFocus'

interface Tab {
  slotId: string
  selected: boolean
  closeDisabled?: boolean
}

// 描画の外の変数へ代入しない(react-hooks/globals)ため、結果は保持用のオブジェクトの中に入れる
const result: { current: ((slotId: string) => Promise<void>) | undefined } = {
  current: undefined
}

function Harness({
  tabs,
  closeTab,
  beforeClose
}: {
  tabs: Tab[]
  closeTab: (slotId: string) => Promise<boolean>
  beforeClose: () => void
}): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null)
  const handleCloseTab = useAgentTabCloseFocus(sectionRef, closeTab, beforeClose)
  useEffect(() => {
    result.current = handleCloseTab
  })
  return (
    <section ref={sectionRef}>
      <div role="tablist">
        {tabs.map((tab) => (
          <span key={tab.slotId}>
            <button role="tab" aria-selected={tab.selected}>
              {tab.slotId}
            </button>
            <button
              tabIndex={-1}
              aria-hidden="true"
              disabled={tab.closeDisabled === true}
              aria-label={`${tab.slotId} を閉じる`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button>最大化</button>
      <div data-agent-terminal="">
        <textarea aria-label="ターミナル" />
      </div>
    </section>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgentTabCloseFocus', () => {
  it('閉じる前に beforeClose を呼ぶ', async () => {
    const order: string[] = []
    const beforeClose = vi.fn(() => order.push('before'))
    const closeTab = vi.fn(async () => {
      order.push('close')
      return false
    })
    render(
      <Harness
        tabs={[{ slotId: 'a', selected: true }]}
        closeTab={closeTab}
        beforeClose={beforeClose}
      />
    )
    await act(async () => {
      await result.current!('a')
    })
    expect(order).toEqual(['before', 'close'])
    expect(closeTab).toHaveBeenCalledWith('a')
  })

  it('閉じたら、再描画の後の選択中のタブへフォーカスを移す', async () => {
    let resolveClose: (closed: boolean) => void = () => undefined
    const closeTab = vi.fn(() => new Promise<boolean>((resolve) => (resolveClose = resolve)))
    const { rerender } = render(
      <Harness
        tabs={[
          { slotId: 'a', selected: false },
          { slotId: 'b', selected: true }
        ]}
        closeTab={closeTab}
        beforeClose={() => undefined}
      />
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current!('b')
    })
    // 閉じ終える前に一覧が変わる(b が消え a が選択中になる)
    rerender(
      <Harness
        tabs={[{ slotId: 'a', selected: true }]}
        closeTab={closeTab}
        beforeClose={() => undefined}
      />
    )
    await act(async () => {
      resolveClose(true)
      await pending
    })
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus()
  })

  it('閉じなかったら、選択中のタブへフォーカスを戻す(閉じようとしたタブが選択中でなくても。× は Tab の順・支援技術から外しているため、× には戻さない)', async () => {
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: true },
          { slotId: 'b', selected: false }
        ]}
        closeTab={async () => false}
        beforeClose={() => undefined}
      />
    )
    await act(async () => {
      await result.current!('b')
    })
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus()
  })

  it('閉じようとしたタブが選択中なら、閉じなかったときもそのタブへフォーカスを戻す', async () => {
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: false },
          { slotId: 'b', selected: true }
        ]}
        closeTab={async () => false}
        beforeClose={() => undefined}
      />
    )
    await act(async () => {
      await result.current!('b')
    })
    expect(screen.getByRole('tab', { name: 'b' })).toHaveFocus()
  })

  it('closeTab が reject しても握り、選択中のタブへフォーカスを戻す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: true },
          { slotId: 'b', selected: false }
        ]}
        closeTab={async () => {
          throw new Error('boom')
        }}
        beforeClose={() => undefined}
      />
    )
    await act(async () => {
      await result.current!('b')
    })
    expect(consoleError).toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus()
  })

  it('閉じるのを待つ間にほかの要素へフォーカスを移したら、閉じ終えても奪わない', async () => {
    let resolveClose: (closed: boolean) => void = () => undefined
    const closeTab = vi.fn(() => new Promise<boolean>((resolve) => (resolveClose = resolve)))
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    try {
      render(
        <Harness
          tabs={[
            { slotId: 'a', selected: true },
            { slotId: 'b', selected: false }
          ]}
          closeTab={closeTab}
          beforeClose={() => undefined}
        />
      )
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current!('b')
      })
      // 停止を待つ間に、利用者がエディタなど(タブ列の外)へフォーカスを移す
      outside.focus()
      await act(async () => {
        resolveClose(true)
        await pending
      })
      expect(outside).toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  it('閉じるのを待つ間にパネルの中のターミナル(別のタブのターミナル)へフォーカスを移したら、閉じ終えても奪わない', async () => {
    let resolveClose: (closed: boolean) => void = () => undefined
    const closeTab = vi.fn(() => new Promise<boolean>((resolve) => (resolveClose = resolve)))
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: true },
          { slotId: 'b', selected: false }
        ]}
        closeTab={closeTab}
        beforeClose={() => undefined}
      />
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current!('b')
    })
    // 停止を待つ間に、利用者が a を選んでそのターミナルをクリックし入力する
    const terminal = screen.getByRole('textbox', { name: 'ターミナル' })
    terminal.focus()
    await act(async () => {
      resolveClose(true)
      await pending
    })
    expect(terminal).toHaveFocus()
  })

  it('閉じるのを待つ間に帯のほかのボタン(タブ列の外)へフォーカスを移したら、閉じ終えても奪わない', async () => {
    let resolveClose: (closed: boolean) => void = () => undefined
    const closeTab = vi.fn(() => new Promise<boolean>((resolve) => (resolveClose = resolve)))
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: true },
          { slotId: 'b', selected: false }
        ]}
        closeTab={closeTab}
        beforeClose={() => undefined}
      />
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current!('b')
    })
    const maximize = screen.getByRole('button', { name: '最大化' })
    maximize.focus()
    await act(async () => {
      resolveClose(true)
      await pending
    })
    expect(maximize).toHaveFocus()
  })

  it('閉じるのを待つ間にタブ列の中へフォーカスがあれば、閉じ終えた後に選択中のタブへ移す', async () => {
    let resolveClose: (closed: boolean) => void = () => undefined
    const closeTab = vi.fn(() => new Promise<boolean>((resolve) => (resolveClose = resolve)))
    render(
      <Harness
        tabs={[
          { slotId: 'a', selected: true },
          { slotId: 'b', selected: false }
        ]}
        closeTab={closeTab}
        beforeClose={() => undefined}
      />
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current!('b')
    })
    // 押した × (タブ列の中)にフォーカスが残っている
    screen.getByLabelText('b を閉じる').focus()
    await act(async () => {
      resolveClose(true)
      await pending
    })
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus()
  })

  it('beforeClose で逃がした先にフォーカスが残っていれば、閉じ終えた後に選択中のタブへ移す', async () => {
    const escape = document.createElement('div')
    escape.tabIndex = -1
    document.body.appendChild(escape)
    try {
      render(
        <Harness
          tabs={[
            { slotId: 'a', selected: true },
            { slotId: 'b', selected: false }
          ]}
          closeTab={async () => true}
          beforeClose={() => escape.focus()}
        />
      )
      await act(async () => {
        await result.current!('b')
      })
      expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus()
    } finally {
      escape.remove()
    }
  })
})
