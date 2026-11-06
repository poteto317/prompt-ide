import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import AgentSessionTabList from '../AgentSessionTabList'
import { makeAgentSessionTabView } from '../../../__tests__/makeAgentSessionsState'

const tabs = [
  makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', status: 'running' }),
  makeAgentSessionTabView({ slotId: 'b', label: 'claude 2', status: 'none' }),
  makeAgentSessionTabView({ slotId: 'c', label: 'claude 3', status: 'starting' })
]

function renderList(
  overrides: Partial<React.ComponentProps<typeof AgentSessionTabList>> = {}
): ReturnType<typeof makeHandlers> {
  const handlers = makeHandlers()
  render(
    <>
      <div id="panel" />
      <AgentSessionTabList
        tabs={tabs}
        selectedSlotId="a"
        panelId="panel"
        tabIdPrefix="tabs"
        sendingSlotId={null}
        addDisabledReason={null}
        activities={new Map()}
        {...handlers}
        {...overrides}
      />
    </>
  )
  return handlers
}

function makeHandlers(): {
  onSelect: Mock<(slotId: string) => void>
  onClose: Mock<(slotId: string) => void>
  onAdd: Mock<() => void>
} {
  return { onSelect: vi.fn(), onClose: vi.fn(), onAdd: vi.fn() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AgentSessionTabList', () => {
  it('tablist の中にタブが並び、選択中だけ aria-selected と tabIndex=0、すべてが本体を参照する', () => {
    renderList()
    const list = screen.getByRole('tablist', { name: 'エージェントのセッション' })
    const items = Array.from(list.querySelectorAll('[role="tab"]'))
    expect(items).toHaveLength(3)
    expect(items.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false'
    ])
    expect(items.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    for (const tab of items) expect(tab).toHaveAttribute('aria-controls', 'panel')
  })

  it('タブの名前に状態を含め、状態の印は aria-hidden', () => {
    renderList()
    const tab = screen.getByRole('tab', { name: 'claude 1（実行中）' })
    expect(screen.getByRole('tab', { name: 'claude 2（未起動）' })).toBeInTheDocument()
    expect(tab.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('running のタブの名前と印の class は活動に従う(許可待ち・作業中)', () => {
    const running = [
      makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', status: 'running' }),
      makeAgentSessionTabView({ slotId: 'b', label: 'claude 2', status: 'running' })
    ]
    renderList({
      tabs: running,
      activities: new Map([
        ['a', 'permission'],
        ['b', 'working']
      ])
    })
    expect(
      screen
        .getByRole('tab', { name: 'claude 1（許可待ち）' })
        .querySelector('.agent-session-tabs__dot')
    ).toHaveClass('agent-session-tabs__dot--permission')
    expect(
      screen
        .getByRole('tab', { name: 'claude 2（作業中）' })
        .querySelector('.agent-session-tabs__dot')
    ).toHaveClass('agent-session-tabs__dot--working')
  })

  it('running 以外のタブは活動が入っていても無視する(名前も印も従来どおり)', () => {
    renderList({
      activities: new Map([
        ['b', 'working'],
        ['c', 'working']
      ])
    })
    const tabB = screen.getByRole('tab', { name: 'claude 2（未起動）' })
    expect(tabB.querySelector('.agent-session-tabs__dot')).not.toHaveClass(
      'agent-session-tabs__dot--working'
    )
    const tabC = screen.getByRole('tab', { name: 'claude 3（起動中）' })
    expect(tabC.querySelector('.agent-session-tabs__dot')).not.toHaveClass(
      'agent-session-tabs__dot--working'
    )
  })

  // unknown の印は入力待ち(塗りの丸)と形で見分けられるよう、活動の class(中心に点のある輪)を付ける
  it('活動が unknown(または未判定)の running のタブは名前が「実行中」で、印に unknown の class を付ける', () => {
    renderList({ activities: new Map([['a', 'unknown']]) })
    const tab = screen.getByRole('tab', { name: 'claude 1（実行中）' })
    const dot = tab.querySelector('.agent-session-tabs__dot')
    expect(dot).toHaveClass('agent-session-tabs__dot--running')
    expect(dot).toHaveClass('agent-session-tabs__dot--unknown')
    // 未判定(Map に無い)も unknown と同じ印
    const undecided = screen
      .getAllByRole('tab')
      .map((element) => element.querySelector('.agent-session-tabs__dot'))
      .filter((element) => element?.classList.contains('agent-session-tabs__dot--running'))
    for (const element of undecided) expect(element).toHaveClass('agent-session-tabs__dot--unknown')
  })

  it('running でないタブには unknown の class を付けない', () => {
    renderList({ activities: new Map() })
    for (const name of ['claude 2（未起動）', 'claude 3（起動中）']) {
      expect(
        screen.getByRole('tab', { name }).querySelector('.agent-session-tabs__dot')
      ).not.toHaveClass('agent-session-tabs__dot--unknown')
    }
  })

  it('タブのクリックで onSelect(slotId)', async () => {
    const { onSelect } = renderList()
    await userEvent.click(screen.getByRole('tab', { name: 'claude 2（未起動）' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('ArrowRight で次のタブを選んでフォーカスし、末尾では先頭へ回る', async () => {
    const { onSelect } = renderList({ selectedSlotId: 'c' })
    screen.getByRole('tab', { name: 'claude 3（起動中）' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(screen.getByRole('tab', { name: 'claude 1（実行中）' })).toHaveFocus()
  })

  it('ArrowLeft は逆向きで、先頭では末尾へ回る', async () => {
    const { onSelect } = renderList()
    screen.getByRole('tab', { name: 'claude 1（実行中）' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onSelect).toHaveBeenCalledWith('c')
    expect(screen.getByRole('tab', { name: 'claude 3（起動中）' })).toHaveFocus()
  })

  it('Home・End は先頭・末尾へ移る', async () => {
    const { onSelect } = renderList({ selectedSlotId: 'b' })
    screen.getByRole('tab', { name: 'claude 2（未起動）' }).focus()
    await userEvent.keyboard('{End}')
    expect(onSelect).toHaveBeenLastCalledWith('c')
    await userEvent.keyboard('{Home}')
    expect(onSelect).toHaveBeenLastCalledWith('a')
  })

  it('× はタブが 2 つ以上のときだけ出て、クリックで onClose(slotId)', async () => {
    const { onClose } = renderList()
    await userEvent.click(screen.getByLabelText('claude 2 を閉じる'))
    expect(onClose).toHaveBeenCalledWith('b')
  })

  // タブ 1 つで + を押すと、描き直しの後に + のあった位置へ claude 1 の × が出る。ダブルクリックの 2 回目が届くと止まっているタブを確認なしに閉じる
  it('×: クリック(detail: 1)では onClose を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const { onClose } = renderList()
    const close = screen.getByLabelText('claude 2 を閉じる')
    fireEvent.click(close, { detail: 1 })
    fireEvent.click(close, { detail: 2 })
    expect(onClose).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('タブが 1 つなら × を出さない', () => {
    renderList({ tabs: [tabs[0]] })
    expect(screen.queryByLabelText(/を閉じる/)).toBeNull()
  })

  it('送信中のタブの × は disabled', () => {
    renderList({ sendingSlotId: 'b' })
    expect(screen.getByLabelText('claude 2 を閉じる')).toBeDisabled()
    expect(screen.getByLabelText('claude 1 を閉じる')).toBeEnabled()
  })

  it('閉じる途中のタブの × は disabled', () => {
    renderList({
      tabs: [tabs[0], makeAgentSessionTabView({ slotId: 'b', label: 'claude 2', isClosing: true })]
    })
    expect(screen.getByLabelText('claude 2 を閉じる')).toBeDisabled()
    expect(screen.getByLabelText('claude 1 を閉じる')).toBeEnabled()
  })

  it('tablist の子は tab だけ(× は支援技術から外し、Tab の順にも入れない。タブ列で Tab が止まるのは選択中のタブ 1 回)', () => {
    renderList()
    const list = screen.getByRole('tablist')
    expect(within(list).queryAllByRole('button')).toEqual([])
    const closes = within(list).getAllByLabelText(/を閉じる/)
    expect(closes).toHaveLength(3)
    for (const close of closes) {
      expect(close).toHaveAttribute('tabindex', '-1')
      expect(close).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it.each([
    [false, '{Delete}'],
    [true, '{Delete}'],
    [true, '{Backspace}']
  ])('isMac=%s のタブで %s を押すと onClose(slotId)', async (isMac, key) => {
    const { onClose } = renderList({ isMac })
    screen.getByRole('tab', { name: 'claude 1（実行中）' }).focus()
    await userEvent.keyboard(key)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('Mac 以外では Backspace で閉じない', async () => {
    const { onClose } = renderList({ isMac: false })
    screen.getByRole('tab', { name: 'claude 1（実行中）' }).focus()
    await userEvent.keyboard('{Backspace}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    [false, 'Delete'],
    [true, 'Delete Backspace']
  ])('閉じられるタブは isMac=%s のとき aria-keyshortcuts="%s"', (isMac, expected) => {
    renderList({ isMac })
    expect(screen.getByRole('tab', { name: 'claude 1（実行中）' })).toHaveAttribute(
      'aria-keyshortcuts',
      expected
    )
  })

  it.each([
    ['タブが 1 つ', { tabs: [tabs[0]] }],
    ['送信中', { sendingSlotId: 'a' }],
    [
      '閉じる途中',
      {
        tabs: [
          makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', isClosing: true }),
          tabs[1]
        ]
      }
    ]
  ] as const)(
    '%sのタブは Delete で閉じず、aria-keyshortcuts も出さない',
    async (_label, overrides) => {
      const { onClose } = renderList(overrides)
      const tab = screen.getAllByRole('tab')[0]
      tab.focus()
      await userEvent.keyboard('{Delete}')
      expect(onClose).not.toHaveBeenCalled()
      expect(tab).not.toHaveAttribute('aria-keyshortcuts')
    }
  )

  it('修飾キー付きの Delete は奪わない', async () => {
    const { onClose } = renderList({ isMac: true })
    screen.getByRole('tab', { name: 'claude 1（実行中）' }).focus()
    await userEvent.keyboard('{Meta>}{Backspace}{/Meta}')
    await userEvent.keyboard('{Alt>}{Delete}{/Alt}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('+ のクリックで onAdd', async () => {
    const { onAdd } = renderList()
    await userEvent.click(screen.getByRole('button', { name: '新しいセッション' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  // 狭い幅で帯の 許可・拒否 が消えるとタブ列が伸び、ダブルクリックの 2 回目が + に届きうる(新しい CLI が起動して選択が移る)
  it('+: キーボードのクリック(detail: 0)では onAdd を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const { onAdd } = renderList()
    const add = screen.getByRole('button', { name: '新しいセッション' })
    fireEvent.click(add, { detail: 0 })
    fireEvent.click(add, { detail: 2 })
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  // + でタブを作って選択する(4 つで + を押せなくする)親を再現する
  function AddableTabs({ add = true }: { add?: boolean }): React.JSX.Element {
    const [items, setItems] = useState(tabs)
    const [selected, setSelected] = useState('a')
    return (
      <>
        <div id="panel" />
        <AgentSessionTabList
          tabs={items}
          selectedSlotId={selected}
          panelId="panel"
          tabIdPrefix="tabs"
          sendingSlotId={null}
          activities={new Map()}
          addDisabledReason={items.length >= 4 ? 'タブは 4 つまでです' : null}
          onSelect={setSelected}
          onClose={vi.fn()}
          onAdd={() => {
            if (!add) return
            const slotId = `new-${items.length}`
            setItems([
              ...items,
              makeAgentSessionTabView({
                slotId,
                label: `claude ${items.length + 1}`,
                status: 'none'
              })
            ])
            setSelected(slotId)
          }}
        />
      </>
    )
  }

  it('キーボードで 4 つ目を作ると、フォーカスが新しいタブに移る(押せなくなった + から body へ落とさない)', async () => {
    render(<AddableTabs />)
    const add = screen.getByRole('button', { name: '新しいセッション' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    expect(add).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'claude 4（未起動）' })).toHaveFocus()
  })

  it('+ でタブが作られなかった(選択が変わらない)ときは、フォーカスを動かさない', async () => {
    render(<AddableTabs add={false} />)
    const add = screen.getByRole('button', { name: '新しいセッション' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    expect(add).toHaveFocus()
  })

  it('+ を押せない理由は title と aria-describedby で示す', () => {
    renderList({ addDisabledReason: '上限です' })
    const add = screen.getByRole('button', { name: '新しいセッション' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', '上限です')
    expect(add).toHaveAccessibleDescription('上限です')
  })

  it('React の key の警告を出さない', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderList()
    expect(spy).not.toHaveBeenCalled()
  })

  it('タブのボタンは ${tabIdPrefix}-${slotId} の id を持つ', () => {
    renderList()
    expect(screen.getByRole('tab', { name: 'claude 2（未起動）' })).toHaveAttribute('id', 'tabs-b')
  })

  it('修飾キー付きの矢印・Home・End は奪わない', async () => {
    const { onSelect } = renderList()
    screen.getByRole('tab', { name: 'claude 1（実行中）' }).focus()
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
    await userEvent.keyboard('{Control>}{End}{/Control}')
    await userEvent.keyboard('{Meta>}{ArrowLeft}{/Meta}')
    await userEvent.keyboard('{Shift>}{Home}{/Shift}')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
