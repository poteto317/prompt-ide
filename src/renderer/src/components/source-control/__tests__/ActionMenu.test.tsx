import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import ActionMenu from '../ActionMenu'
import type { ActionMenuItem } from '../ActionMenu'
import ExplorerContextMenu from '../../explorer/ExplorerContextMenu'

const makeItems = (
  overrides: Partial<Record<string, Partial<ActionMenuItem>>> = {}
): ActionMenuItem[] =>
  ['a', 'b', 'c'].map((id) => ({
    id,
    label: `項目${id}`,
    onSelect: vi.fn(),
    ...overrides[id]
  }))

function Menu({ items = makeItems() }: { items?: ActionMenuItem[] }): React.JSX.Element {
  return (
    <>
      <button type="button">前</button>
      <ActionMenu buttonLabel="操作" buttonContent="…" items={items} />
      <button type="button">次</button>
    </>
  )
}

// 項目の実行で押せなくなり、「解除」で押せるようになる
function RunningHarness(): React.JSX.Element {
  const [isRunning, setIsRunning] = useState(false)
  return (
    <>
      <ActionMenu
        buttonLabel="操作"
        buttonContent="…"
        items={[
          { id: 'a', label: '項目a', disabled: isRunning, onSelect: () => setIsRunning(true) }
        ]}
      />
      <button type="button" onClick={() => setIsRunning(false)}>
        解除
      </button>
    </>
  )
}

const openButton = (): HTMLElement => screen.getByRole('button', { name: '操作' })
const item = (name: string): HTMLElement => screen.getByRole('menuitem', { name })

describe('ActionMenu', () => {
  describe('開閉', () => {
    it('ボタンは aria-haspopup と aria-expanded を持ち、押すとメニューが開く', async () => {
      render(<Menu />)
      expect(openButton()).toHaveAttribute('aria-haspopup', 'menu')
      expect(openButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      await userEvent.click(openButton())
      expect(openButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    })

    it('開いたら最初の有効な項目へフォーカスする', async () => {
      render(<Menu items={makeItems({ a: { disabled: true } })} />)
      await userEvent.click(openButton())
      expect(item('項目b')).toHaveFocus()
    })

    it('開いたままボタンを押すと閉じて、開き直さず、ボタンへフォーカスを戻す', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      await userEvent.click(openButton())
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
    })

    it('外側のクリックで閉じ、フォーカスは奪わない', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      await userEvent.click(screen.getByRole('button', { name: '次' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '次' })).toHaveFocus()
    })

    it('何も無い場所のクリックで閉じても、ボタンへフォーカスを戻さない', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      await userEvent.click(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(document.body).toHaveFocus()
    })

    // userEvent.click では続く mousedown がフォーカスを動かすため、pointerdown の直後を見る
    it('外側の pointerdown で閉じた直後に、ボタンへフォーカスを戻さない', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).not.toHaveFocus()
      expect(document.body).toHaveFocus()
    })

    it('伝播を止める親の中のクリックでも閉じる', async () => {
      render(
        <>
          <Menu />
          <div onPointerDown={(e) => e.stopPropagation()}>
            <button type="button">伝播を止める</button>
          </div>
        </>
      )
      await userEvent.click(openButton())
      await userEvent.click(screen.getByRole('button', { name: '伝播を止める' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    // 右クリックのメニューは document の click で閉じる。お互いの外側の扱いを止めない
    it('ExplorerContextMenu と同時に動かしても、両方の外側の扱いが効く', async () => {
      const onCloseContextMenu = vi.fn()
      render(
        <>
          <Menu />
          <ExplorerContextMenu x={0} y={0} items={[]} onClose={onCloseContextMenu} />
        </>
      )
      await userEvent.click(openButton())
      expect(onCloseContextMenu).toHaveBeenCalledOnce()
      expect(screen.getByRole('menu', { name: '操作' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('menu', { name: 'ファイル操作' }))
      expect(screen.queryByRole('menu', { name: '操作' })).not.toBeInTheDocument()
    })
  })

  describe('押せない状態', () => {
    it('有効な項目が 0 件ならボタンを押せない', () => {
      render(
        <Menu
          items={makeItems({
            a: { disabled: true },
            b: { disabled: true },
            c: { disabled: true }
          })}
        />
      )
      expect(openButton()).toBeDisabled()
    })

    it('無効の項目は押せない', async () => {
      const items = makeItems({ b: { disabled: true } })
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      expect(item('項目b')).toBeDisabled()
    })

    it('開いている間にフォーカス中の項目が無効になると、有効な項目へ移す', async () => {
      const { rerender } = render(<Menu />)
      await userEvent.click(openButton())
      expect(item('項目a')).toHaveFocus()
      rerender(<Menu items={makeItems({ a: { disabled: true } })} />)
      expect(item('項目b')).toHaveFocus()
    })

    it('開いている間に有効な項目が無くなると閉じる', async () => {
      const allDisabled = makeItems({
        a: { disabled: true },
        b: { disabled: true },
        c: { disabled: true }
      })
      const { rerender } = render(<Menu />)
      await userEvent.click(openButton())
      rerender(<Menu items={allDisabled} />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      rerender(<Menu />)
      expect(openButton()).toHaveFocus()
    })
  })

  describe('フォーカスの回復', () => {
    it('再描画しても、↓ で移した項目からフォーカスを動かさない', async () => {
      const { rerender } = render(<Menu />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{ArrowDown}')
      expect(item('項目b')).toHaveFocus()
      rerender(<Menu />)
      expect(item('項目b')).toHaveFocus()
    })

    it('フォーカスが body に落ちた後の再描画で、最初の有効な項目へ移す', async () => {
      const { rerender } = render(<Menu />)
      await userEvent.click(openButton())
      act(() => item('項目a').blur())
      expect(document.body).toHaveFocus()
      rerender(<Menu />)
      expect(item('項目a')).toHaveFocus()
    })

    // 無効の項目やメニューの余白を押すと、ブラウザがフォーカスを body へ落とす
    it('無効の項目を押して body に落ちても、最初の有効な項目へ戻し、Escape で閉じられる', async () => {
      render(<Menu items={makeItems({ a: { disabled: true } })} />)
      await userEvent.click(openButton())
      act(() => item('項目b').blur())
      fireEvent.pointerUp(item('項目a'))
      expect(item('項目b')).toHaveFocus()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
    })

    it('メニューの余白を押して body に落ちても、最初の有効な項目へ戻し、↓ で移せる', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      act(() => item('項目a').blur())
      fireEvent.pointerUp(screen.getByRole('menu'))
      expect(item('項目a')).toHaveFocus()
      await userEvent.keyboard('{ArrowDown}')
      expect(item('項目b')).toHaveFocus()
    })

    it('pointerup はフォーカスが項目にあれば動かさない', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{ArrowDown}')
      fireEvent.pointerUp(screen.getByRole('menu'))
      expect(item('項目b')).toHaveFocus()
    })

    it('伝播を止める親の中の pointerup でも、最初の有効な項目へ戻す', async () => {
      render(
        <div onPointerUp={(e) => e.stopPropagation()}>
          <Menu />
        </div>
      )
      await userEvent.click(openButton())
      act(() => item('項目a').blur())
      fireEvent.pointerUp(screen.getByRole('menu'))
      expect(item('項目a')).toHaveFocus()
    })

    it('外側を押して閉じた場合は、続く pointerup でフォーカスを動かさない', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      act(() => item('項目a').blur())
      fireEvent.pointerDown(document.body)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      fireEvent.pointerUp(document.body)
      expect(document.body).toHaveFocus()
    })
  })

  describe('キーボード', () => {
    it('↑↓ は有効な項目を循環する', async () => {
      render(<Menu items={makeItems({ b: { disabled: true } })} />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{ArrowDown}')
      expect(item('項目c')).toHaveFocus()
      await userEvent.keyboard('{ArrowDown}')
      expect(item('項目a')).toHaveFocus()
      await userEvent.keyboard('{ArrowUp}')
      expect(item('項目c')).toHaveFocus()
    })

    it('Home・End で先頭と末尾の有効な項目へ移す', async () => {
      const items = [
        ...makeItems({ a: { disabled: true } }),
        { id: 'd', label: '項目d', onSelect: vi.fn() },
        { id: 'e', label: '項目e', disabled: true, onSelect: vi.fn() }
      ]
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{End}')
      expect(item('項目d')).toHaveFocus()
      await userEvent.keyboard('{Home}')
      expect(item('項目b')).toHaveFocus()
    })

    it('Enter で実行する', async () => {
      const items = makeItems()
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{ArrowDown}{Enter}')
      expect(items[1].onSelect).toHaveBeenCalledOnce()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
    })

    it('Space で実行する', async () => {
      const items = makeItems()
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      await userEvent.keyboard(' ')
      expect(items[0].onSelect).toHaveBeenCalledOnce()
      expect(openButton()).toHaveFocus()
    })

    it('Escape で閉じてボタンへ戻し、実行しない', async () => {
      const items = makeItems()
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
      expect(items[0].onSelect).not.toHaveBeenCalled()
    })

    it('Tab は閉じて、既定の動きを止めず、次の要素へ移す', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      // fireEvent は preventDefault されると false を返す
      expect(fireEvent.keyDown(item('項目a'), { key: 'Tab' })).toBe(true)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      // ブラウザの既定の動きは、ボタンを起点に続く
      expect(openButton()).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: '次' })).toHaveFocus()
    })

    it('Shift+Tab は閉じて、前の要素へ移す', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      expect(fireEvent.keyDown(item('項目a'), { key: 'Tab', shiftKey: true })).toBe(true)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
      await userEvent.tab({ shift: true })
      expect(screen.getByRole('button', { name: '前' })).toHaveFocus()
    })

    it('項目の Enter のリピートは preventDefault する(長押しで開いて、そのまま実行しない)', async () => {
      render(<Menu />)
      await userEvent.click(openButton())
      expect(fireEvent.keyDown(item('項目a'), { key: 'Enter', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(item('項目a'), { key: 'Enter' })).toBe(true)
    })

    it('ボタンの Enter のリピートは preventDefault する', () => {
      render(<Menu />)
      expect(fireEvent.keyDown(openButton(), { key: 'Enter', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(openButton(), { key: 'Enter' })).toBe(true)
    })
  })

  describe('項目の実行', () => {
    it('押すと閉じてボタンへフォーカスを戻し、onSelect を 1 回呼ぶ', async () => {
      const items = makeItems()
      render(<Menu items={items} />)
      await userEvent.click(openButton())
      await userEvent.click(item('項目b'))
      expect(items[1].onSelect).toHaveBeenCalledOnce()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(openButton()).toHaveFocus()
    })

    // 実行の開始でボタンが押せなくなる場合。disabled のボタンへの focus() は無視されるため、押せるようになった描画の後で戻す
    it('項目が onSelect の中で押せなくなっても、解けた描画の後でボタンへ戻す', async () => {
      render(<RunningHarness />)
      await userEvent.click(openButton())
      await userEvent.click(item('項目a'))
      expect(openButton()).toBeDisabled()
      expect(document.body).toHaveFocus()
      fireEvent.click(screen.getByRole('button', { name: '解除' }))
      expect(openButton()).toHaveFocus()
    })

    it('実行中に利用者が移したフォーカスは奪わない', async () => {
      render(<RunningHarness />)
      await userEvent.click(openButton())
      await userEvent.click(item('項目a'))
      await userEvent.click(screen.getByRole('button', { name: '解除' }))
      expect(screen.getByRole('button', { name: '解除' })).toHaveFocus()
    })
  })

  describe('項目の形', () => {
    it('checked を持つ項目は menuitemcheckbox で、aria-checked を持つ', async () => {
      render(
        <Menu
          items={[
            { id: 'on', label: 'オン', checked: true, onSelect: vi.fn() },
            { id: 'off', label: 'オフ', checked: false, onSelect: vi.fn() },
            { id: 'plain', label: '普通', onSelect: vi.fn() }
          ]}
        />
      )
      await userEvent.click(openButton())
      expect(screen.getByRole('menuitemcheckbox', { name: 'オン' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
      expect(screen.getByRole('menuitemcheckbox', { name: 'オフ' })).toHaveAttribute(
        'aria-checked',
        'false'
      )
      expect(screen.getByRole('menuitem', { name: '普通' })).not.toHaveAttribute('aria-checked')
    })

    it('ariaLabel があれば項目の名前にし、見える文字は label のまま', async () => {
      render(
        <Menu items={[{ id: 'a', label: '実行中...', ariaLabel: '実行中', onSelect: vi.fn() }]} />
      )
      await userEvent.click(openButton())
      expect(item('実行中')).toHaveTextContent('実行中...')
    })

    it('focusTarget はボタンの data-remote-setup-focus に入る', () => {
      render(
        <ActionMenu buttonLabel="操作" buttonContent="…" focusTarget="push" items={makeItems()} />
      )
      expect(openButton()).toHaveAttribute('data-remote-setup-focus', 'push')
    })

    it('buttonClassName はボタンに付く', () => {
      render(
        <ActionMenu
          buttonLabel="操作"
          buttonContent="…"
          buttonClassName="more"
          items={makeItems()}
        />
      )
      expect(openButton()).toHaveClass('more')
    })
  })
})
