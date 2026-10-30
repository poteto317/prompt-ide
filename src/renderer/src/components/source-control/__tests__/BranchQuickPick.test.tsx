import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, it, expect, vi } from 'vitest'
import type { GitBranch } from '@shared/types'
import BranchQuickPick from '../BranchQuickPick'

const branches: GitBranch[] = [
  { name: 'main', current: true },
  { name: 'develop', current: false },
  { name: 'Feature/Login', current: false }
]

const DISABLED_NOTICE = '他の操作が完了するまで切り替えられません'

type Props = React.ComponentProps<typeof BranchQuickPick>

const makeProps = (overrides: Partial<Props> = {}): Props => ({
  branches,
  currentBranch: 'main',
  isDisabled: false,
  onSelect: vi.fn(),
  onClose: vi.fn(),
  ...overrides
})

const renderPicker = (
  overrides: Partial<Props> = {}
): Props & { rerenderWith: (next: Partial<Props>) => void } => {
  const props = makeProps(overrides)
  const { rerender } = render(<BranchQuickPick {...props} />)
  return {
    ...props,
    rerenderWith: (next) => rerender(<BranchQuickPick {...props} {...next} />)
  }
}

const getInput = (): HTMLElement => screen.getByRole('combobox', { name: 'ブランチ名で絞り込む' })
const getOverlay = (): HTMLElement => screen.getByTestId('branch-picker-overlay')
const pressEnter = (): void => {
  fireEvent.keyDown(getInput(), { key: 'Enter' })
  fireEvent.keyUp(getInput(), { key: 'Enter' })
}

// aria-activedescendant が指す項目。選択の表現は ARIA だけで確かめる
const getActiveOption = (): HTMLElement => {
  const id = getInput().getAttribute('aria-activedescendant')
  const option = id === null ? null : document.getElementById(id)
  if (option === null) throw new Error('選択中の項目がありません')
  return option
}

// スクロールバーが出ている状態を再現する(jsdom はレイアウトを持たない)
const mockVerticalScrollbar = (list: HTMLElement): void => {
  Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true })
  Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true })
  Object.defineProperty(list, 'clientWidth', { value: 200, configurable: true })
  list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 215, bottom: 100 }) as DOMRect
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BranchQuickPick', () => {
  describe('ARIA', () => {
    it('ダイアログの役割と名前を持つ', () => {
      renderPicker()
      const dialog = screen.getByRole('dialog', { name: 'ブランチを切り替え' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveClass('quick-open')
    })

    it('入力欄が listbox を指す combobox になる', () => {
      renderPicker()
      const input = getInput()
      expect(input).toHaveAttribute('aria-expanded', 'true')
      expect(input).toHaveAttribute('aria-controls', 'branch-picker-listbox')
      expect(input).toHaveAttribute('aria-autocomplete', 'list')
      expect(input).toHaveAttribute('placeholder', '切り替えるブランチを選択')
      expect(screen.getByRole('listbox', { name: 'ブランチ' })).toHaveAttribute(
        'id',
        'branch-picker-listbox'
      )
    })

    it('項目が option で、選択中の項目だけ aria-selected になり aria-activedescendant が指す', () => {
      renderPicker()
      const options = screen.getAllByRole('option')
      expect(options.map((option) => option.id)).toEqual([
        'branch-picker-option-0',
        'branch-picker-option-1',
        'branch-picker-option-2'
      ])
      expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
        'false',
        'true',
        'false'
      ])
      expect(getInput()).toHaveAttribute('aria-activedescendant', 'branch-picker-option-1')
      expect(options[1]).toHaveClass('quick-open__item--active')
      expect(options[0]).not.toHaveClass('quick-open__item--active')
    })

    it('候補が無いとき aria-activedescendant を付けない', () => {
      renderPicker()
      fireEvent.change(getInput(), { target: { value: 'zzz' } })
      expect(getInput()).not.toHaveAttribute('aria-activedescendant')
    })
  })

  describe('一覧', () => {
    it('現在のブランチを先頭に置き、現在の印を付ける', () => {
      renderPicker({ currentBranch: 'develop' })
      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveTextContent('develop現在')
      expect(options[1]).toHaveTextContent(/^main$/)
      expect(options[2]).toHaveTextContent(/^Feature\/Login$/)
      expect(screen.getAllByText('現在')).toHaveLength(1)
      expect(screen.getByText('現在')).toHaveClass('quick-open__directory')
    })

    it('入力すると大文字小文字を区別せず絞り込む', () => {
      renderPicker()
      fireEvent.change(getInput(), { target: { value: 'feature' } })
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(1)
      expect(options[0]).toHaveTextContent('Feature/Login')
    })

    it('絞り込みの結果が 0 件なら一致なしの案内を出す', () => {
      renderPicker()
      fireEvent.change(getInput(), { target: { value: 'zzz' } })
      expect(screen.getByRole('status')).toHaveTextContent('一致するブランチがありません')
      expect(screen.getByRole('status')).toHaveClass('quick-open__empty')
    })

    it('絞り込まずに候補が 0 件ならブランチなしの案内を出す', () => {
      renderPicker({ branches: [], currentBranch: null })
      expect(screen.getByRole('status')).toHaveTextContent('ブランチがありません')
    })

    it('空白だけの入力は絞り込みの文字として扱わない', () => {
      renderPicker({ branches: [], currentBranch: null })
      fireEvent.change(getInput(), { target: { value: '  ' } })
      expect(screen.getByRole('status')).toHaveTextContent('ブランチがありません')
    })

    it('候補があれば案内を出さない', () => {
      renderPicker()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('フォーカス', () => {
    it('開いたら入力欄にフォーカスする', () => {
      renderPicker()
      expect(getInput()).toHaveFocus()
    })

    it('閉じてもフォーカスを戻さない(戻すのは親の役割)', () => {
      const opener = document.createElement('button')
      document.body.appendChild(opener)
      opener.focus()
      const { unmount } = render(<BranchQuickPick {...makeProps()} />)
      unmount()
      expect(opener).not.toHaveFocus()
      opener.remove()
    })

    it('項目を押しても既定動作を止めて入力欄のフォーカスを保つ', () => {
      renderPicker()
      expect(fireEvent.mouseDown(screen.getAllByRole('option')[0])).toBe(false)
    })

    it('入力欄を押したときは既定動作を止めない', () => {
      renderPicker()
      expect(fireEvent.mouseDown(getInput())).toBe(true)
    })

    it('一覧のスクロールバーを押したときは既定動作を妨げない', () => {
      renderPicker()
      const list = screen.getByRole('listbox')
      mockVerticalScrollbar(list)
      expect(fireEvent.mouseDown(list, { clientX: 210, clientY: 50 })).toBe(true)
    })

    it('スクロールバー外の一覧を押したときは既定動作を止める', () => {
      renderPicker()
      const list = screen.getByRole('listbox')
      mockVerticalScrollbar(list)
      expect(fireEvent.mouseDown(list, { clientX: 50, clientY: 50 })).toBe(false)
    })

    it('ダイアログ内で離したときに入力欄へフォーカスを戻す', () => {
      renderPicker()
      const list = screen.getByRole('listbox')
      getInput().blur()
      fireEvent.mouseUp(list)
      expect(getInput()).toHaveFocus()
    })

    it('スクロールバーのドラッグをオーバーレイ上で離しても入力欄へフォーカスを戻す', () => {
      renderPicker()
      getInput().blur()
      fireEvent.mouseUp(getOverlay())
      expect(getInput()).toHaveFocus()
    })
  })

  describe('選択', () => {
    it('開いたときは現在のブランチの次の候補を選ぶ', () => {
      renderPicker()
      expect(getActiveOption()).toHaveTextContent('develop')
    })

    it('別の候補が無ければ現在のブランチを選ぶ', () => {
      renderPicker({ branches: [{ name: 'main', current: true }] })
      expect(getActiveOption()).toHaveTextContent('main')
    })

    it('detached なら先頭を選ぶ', () => {
      renderPicker({
        currentBranch: null,
        branches: [
          { name: '4fd2759', current: true, isDetachedHead: true },
          { name: 'develop', current: false }
        ]
      })
      expect(getActiveOption()).toHaveTextContent('develop')
    })

    it('初期選択は開いたときの 1 回だけ計算する', () => {
      const { rerenderWith } = renderPicker()
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
      rerenderWith({ currentBranch: 'develop' })
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
    })

    it('↓ で次の候補へ動き、末尾から先頭へ循環する', () => {
      renderPicker()
      const input = getInput()
      expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(getActiveOption()).toHaveTextContent('main')
    })

    it('↑ で前の候補へ動き、先頭から末尾へ循環する', () => {
      renderPicker()
      const input = getInput()
      expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false)
      expect(getActiveOption()).toHaveTextContent('main')
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
    })

    it('絞り込みの文字を変えたら先頭の候補を選ぶ', () => {
      renderPicker()
      fireEvent.change(getInput(), { target: { value: 'e' } })
      expect(getActiveOption()).toHaveTextContent('develop')
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
      fireEvent.change(getInput(), { target: { value: 'ai' } })
      expect(getActiveOption()).toHaveTextContent('main')
    })

    it('候補が 0 件になった後に文字を戻しても先頭の候補を選ぶ', () => {
      renderPicker()
      fireEvent.change(getInput(), { target: { value: 'zzz' } })
      fireEvent.change(getInput(), { target: { value: '' } })
      expect(getActiveOption()).toHaveTextContent('main')
    })

    it('一覧が変わって選択中の名前が消えたら先頭の候補を選択として扱う', () => {
      const { rerenderWith } = renderPicker()
      expect(getActiveOption()).toHaveTextContent('develop')
      rerenderWith({ branches: branches.filter((branch) => branch.name !== 'develop') })
      expect(getActiveOption()).toHaveTextContent('main')
    })

    it('選択中の名前が消えた後の Enter は先頭の候補を確定する', () => {
      const { rerenderWith, onClose, onSelect } = renderPicker({ currentBranch: 'main' })
      rerenderWith({ branches: branches.filter((branch) => branch.name !== 'develop') })
      pressEnter()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('一覧が変わっても選択は添字ではなく名前で保つ', () => {
      const { rerenderWith } = renderPicker()
      rerenderWith({ branches: [{ name: 'added', current: false }, ...branches] })
      expect(getActiveOption()).toHaveTextContent('develop')
      expect(getActiveOption()).toHaveAttribute('id', 'branch-picker-option-2')
    })

    it('マウスを動かすと選択が追従する', () => {
      renderPicker()
      fireEvent.mouseMove(screen.getAllByRole('option')[2])
      expect(getActiveOption()).toHaveTextContent('Feature/Login')
    })

    it('選択中の項目を一覧の見える範囲へスクロールする', () => {
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
      renderPicker()
      scrollIntoView.mockClear()
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(getActiveOption())
    })
  })

  describe('確定', () => {
    it('Enter で別のブランチを確定すると onSelect だけを呼ぶ', () => {
      const { onSelect, onClose } = renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Enter' })).toBe(false)
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledWith('develop')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('クリックで別のブランチを確定すると onSelect だけを呼ぶ', async () => {
      const { onSelect, onClose } = renderPicker()
      await userEvent.click(screen.getByText('Feature/Login'))
      expect(onSelect).toHaveBeenCalledWith('Feature/Login')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('Enter で現在のブランチを確定すると切り替えずに閉じる', () => {
      const { onSelect, onClose } = renderPicker()
      fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
      pressEnter()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('クリックで現在のブランチを確定すると切り替えずに閉じる', async () => {
      const { onSelect, onClose } = renderPicker()
      await userEvent.click(screen.getByText('main'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('候補が 0 件の Enter は何もしない', () => {
      const { onSelect, onClose } = renderPicker()
      fireEvent.change(getInput(), { target: { value: 'zzz' } })
      expect(fireEvent.keyDown(getInput(), { key: 'Enter' })).toBe(false)
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('Enter は離すまで確定しない(押し続けたリピートが未保存の確認の「OK」に届かない)', () => {
      const { onSelect } = renderPicker()
      fireEvent.keyDown(getInput(), { key: 'Enter' })
      fireEvent.keyDown(getInput(), { key: 'Enter', repeat: true })
      expect(onSelect).not.toHaveBeenCalled()
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('一覧を開いた Enter のリピートと離した操作では確定しない', () => {
      const { onSelect, onClose } = renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Enter', repeat: true })).toBe(false)
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('現在のブランチでも Enter のキーリピートでは閉じない', () => {
      const { onClose } = renderPicker({ branches: [{ name: 'main', current: true }] })
      fireEvent.keyDown(getInput(), { key: 'Enter', repeat: true })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('現在のブランチが一覧に無くても現在のブランチとして閉じる', () => {
      const { onSelect, onClose } = renderPicker({
        branches: [],
        currentBranch: 'empty-repo'
      })
      pressEnter()
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    })
  })

  describe('押せない状態', () => {
    it('常に一覧の上に案内を出す', () => {
      renderPicker({ isDisabled: true })
      const notice = screen.getByRole('status')
      expect(notice).toHaveTextContent(DISABLED_NOTICE)
      expect(notice).toHaveClass('quick-open__empty')
      expect(
        notice.compareDocumentPosition(screen.getByRole('listbox')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('解けたら案内を消す', () => {
      const { rerenderWith } = renderPicker({ isDisabled: true })
      rerenderWith({ isDisabled: false })
      expect(screen.queryByText(DISABLED_NOTICE)).not.toBeInTheDocument()
    })

    it('押せなくなったら案内を出す', () => {
      const { rerenderWith } = renderPicker()
      rerenderWith({ isDisabled: true })
      expect(screen.getByText(DISABLED_NOTICE)).toBeInTheDocument()
    })

    it('候補が 0 件なら案内と 0 件の文言を両方出す', () => {
      renderPicker({ isDisabled: true })
      fireEvent.change(getInput(), { target: { value: 'zzz' } })
      expect(screen.getByText(DISABLED_NOTICE)).toBeInTheDocument()
      expect(screen.getByText('一致するブランチがありません')).toBeInTheDocument()
    })

    it('別のブランチの Enter を閉じずに無視する', () => {
      const { onSelect, onClose } = renderPicker({ isDisabled: true })
      pressEnter()
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('別のブランチのクリックを閉じずに無視する', async () => {
      const { onSelect, onClose } = renderPicker({ isDisabled: true })
      await userEvent.click(screen.getByText('develop'))
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('現在のブランチの確定も閉じずに無視する', async () => {
      const { onSelect, onClose } = renderPicker({ isDisabled: true })
      await userEvent.click(screen.getByText('main'))
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('解けた後は確定できる', () => {
      const { rerenderWith, onSelect } = renderPicker({ isDisabled: true })
      rerenderWith({ isDisabled: false })
      pressEnter()
      expect(onSelect).toHaveBeenCalledWith('develop')
    })

    it('Escape では閉じられる', () => {
      const { onClose } = renderPicker({ isDisabled: true })
      fireEvent.keyDown(getInput(), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Escape', () => {
    it('フォーカスがダイアログの外にあっても閉じる', () => {
      const { onClose } = renderPicker()
      getInput().blur()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('最新の onClose を呼ぶ', () => {
      const { rerenderWith, onClose } = renderPicker()
      const nextOnClose = vi.fn()
      rerenderWith({ onClose: nextOnClose })
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(nextOnClose).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('途中で伝播を止める要素の上でも受ける(capture で購読する)', () => {
      const { onClose } = renderPicker()
      const consumer = document.createElement('div')
      document.body.appendChild(consumer)
      consumer.addEventListener('keydown', (event) => event.stopPropagation())
      fireEvent.keyDown(consumer, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      consumer.remove()
    })

    it('Escape を消費し、背後の document のハンドラへ伝えない', () => {
      renderPicker()
      const behind = vi.fn()
      document.addEventListener('keydown', behind)
      const notPrevented = fireEvent.keyDown(getInput(), { key: 'Escape' })
      document.removeEventListener('keydown', behind)
      expect(notPrevented).toBe(false)
      expect(behind).not.toHaveBeenCalled()
    })

    it('アンマウント後は Escape を受けない', () => {
      const props = makeProps()
      const { unmount } = render(<BranchQuickPick {...props} />)
      unmount()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(props.onClose).not.toHaveBeenCalled()
    })
  })

  describe('オーバーレイ', () => {
    it('押して離した click(detail: 0)で閉じる', () => {
      const { onClose } = renderPicker()
      const overlay = getOverlay()
      fireEvent.mouseDown(overlay)
      fireEvent.click(overlay, { detail: 0 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('マウスの 1 回のクリック(detail: 1)で閉じる', () => {
      const { onClose } = renderPicker()
      const overlay = getOverlay()
      fireEvent.mouseDown(overlay)
      fireEvent.click(overlay, { detail: 1 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ダブルクリックの 2 回目(detail: 2)では閉じず、mouseup で入力欄へフォーカスが戻る', () => {
      const { onClose } = renderPicker()
      const overlay = getOverlay()
      getInput().blur()
      fireEvent.mouseDown(overlay, { detail: 2 })
      fireEvent.click(overlay, { detail: 2 })
      expect(onClose).not.toHaveBeenCalled()
      fireEvent.mouseUp(overlay)
      expect(getInput()).toHaveFocus()
    })

    it('ダイアログの中で押し始めたドラッグをオーバーレイで離しても閉じない', () => {
      const { onClose } = renderPicker()
      fireEvent.mouseDown(getInput())
      fireEvent.click(getOverlay(), { detail: 0 })
      expect(onClose).not.toHaveBeenCalled()
    })

    it('ダイアログの中のクリックでは閉じない', () => {
      const { onClose } = renderPicker()
      const dialog = screen.getByRole('dialog')
      fireEvent.mouseDown(dialog)
      fireEvent.click(dialog)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Tab', () => {
    it('入力欄に留める', () => {
      renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Tab' })).toBe(false)
      expect(getInput()).toHaveFocus()
    })

    it('フォーカスがダイアログの外へ移っていたら入力欄へ戻す', () => {
      renderPicker()
      getInput().blur()
      expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false)
      expect(getInput()).toHaveFocus()
    })
  })

  it('長いブランチ名の全文を title に入れる', () => {
    renderPicker()
    expect(screen.getByText('develop')).toHaveAttribute('title', 'develop')
  })

  describe('IME の変換中', () => {
    it('前の Enter の keyup を取り逃しても、変換確定の Enter で確定しない', () => {
      const { onSelect } = renderPicker()
      fireEvent.keyDown(getInput(), { key: 'Enter' })
      fireEvent.keyDown(getInput(), { key: 'Enter', isComposing: true })
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('フォーカスが外れた後の Enter の keyup で確定しない', () => {
      const { onSelect } = renderPicker()
      fireEvent.keyDown(getInput(), { key: 'Enter' })
      fireEvent.blur(getInput())
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('Enter で確定しない', () => {
      const { onSelect, onClose } = renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Enter', isComposing: true })).toBe(true)
      fireEvent.keyUp(getInput(), { key: 'Enter' })
      expect(onSelect).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('↑↓ で選択を動かさない', () => {
      renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'ArrowDown', isComposing: true })).toBe(true)
      expect(fireEvent.keyDown(getInput(), { key: 'ArrowUp', isComposing: true })).toBe(true)
      expect(getActiveOption()).toHaveTextContent('develop')
    })

    it('Escape で閉じない', () => {
      const { onClose } = renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Escape', isComposing: true })).toBe(true)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('Tab を横取りしない', () => {
      renderPicker()
      expect(fireEvent.keyDown(getInput(), { key: 'Tab', isComposing: true })).toBe(true)
    })
  })
})
