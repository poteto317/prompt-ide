import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import QuickOpenDialog from '../QuickOpenDialog'
import type { QuickOpenController } from '../../../hooks/useQuickOpen'
import type { QuickOpenResult } from '../../../lib/quickOpenSearch'

const makeResult = (name: string, directory: string): QuickOpenResult => ({
  node: { name, path: `/project/${directory}/${name}`, type: 'file' },
  directory,
  score: 100,
  nameIndices: [],
  directoryIndices: []
})

const makeController = (overrides: Partial<QuickOpenController> = {}): QuickOpenController => ({
  isOpen: true,
  query: '',
  results: [makeResult('App.tsx', 'src'), makeResult('main.tsx', 'src')],
  activeIndex: 0,
  hasFolder: true,
  open: vi.fn(),
  close: vi.fn(),
  setQuery: vi.fn(),
  moveSelection: vi.fn(),
  setActiveIndex: vi.fn(),
  confirm: vi.fn(),
  ...overrides
})

describe('QuickOpenDialog', () => {
  it('検索入力が combobox として表示される', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getByRole('combobox', { name: 'ファイル名で検索' })).toBeInTheDocument()
  })

  it('候補が listbox の option として並ぶ', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('aria-activedescendant が選択中の option を指す', () => {
    render(<QuickOpenDialog controller={makeController({ activeIndex: 1 })} />)
    const activeId = screen.getAllByRole('option')[1].getAttribute('id')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', activeId)
  })

  it('候補が無いとき aria-activedescendant を設定しない', () => {
    render(<QuickOpenDialog controller={makeController({ results: [], query: 'zzz' })} />)
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant')
  })

  it('入力すると setQuery が呼ばれる', async () => {
    const setQuery = vi.fn()
    render(<QuickOpenDialog controller={makeController({ setQuery })} />)
    await userEvent.type(screen.getByRole('combobox'), 'a')
    expect(setQuery).toHaveBeenCalledWith('a')
  })

  it('ArrowDown で次の候補へ移動する', async () => {
    const moveSelection = vi.fn()
    render(<QuickOpenDialog controller={makeController({ moveSelection })} />)
    await userEvent.type(screen.getByRole('combobox'), '{ArrowDown}')
    expect(moveSelection).toHaveBeenCalledWith(1)
  })

  it('ArrowUp で前の候補へ移動する', async () => {
    const moveSelection = vi.fn()
    render(<QuickOpenDialog controller={makeController({ moveSelection })} />)
    await userEvent.type(screen.getByRole('combobox'), '{ArrowUp}')
    expect(moveSelection).toHaveBeenCalledWith(-1)
  })

  it('Enter で confirm が呼ばれる', async () => {
    const confirm = vi.fn()
    render(<QuickOpenDialog controller={makeController({ confirm })} />)
    await userEvent.type(screen.getByRole('combobox'), '{Enter}')
    expect(confirm).toHaveBeenCalled()
  })

  it('オーバーレイのクリックで close が呼ばれる', async () => {
    const close = vi.fn()
    render(<QuickOpenDialog controller={makeController({ close })} />)
    await userEvent.click(screen.getByTestId('quick-open-overlay'))
    expect(close).toHaveBeenCalled()
  })

  it('ダイアログ本体のクリックでは close が呼ばれない', async () => {
    const close = vi.fn()
    render(<QuickOpenDialog controller={makeController({ close })} />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(close).not.toHaveBeenCalled()
  })

  it('候補をクリックするとその位置で confirm が呼ばれる', async () => {
    const confirm = vi.fn()
    render(<QuickOpenDialog controller={makeController({ confirm })} />)
    await userEvent.click(screen.getAllByRole('option')[1])
    expect(confirm).toHaveBeenCalledWith(1)
  })

  it('候補にマウスオーバーすると選択位置が追従する', async () => {
    const setActiveIndex = vi.fn()
    render(<QuickOpenDialog controller={makeController({ setActiveIndex })} />)
    await userEvent.hover(screen.getAllByRole('option')[1])
    expect(setActiveIndex).toHaveBeenCalledWith(1)
  })

  it('一致する候補が無いとき案内を表示する', () => {
    render(<QuickOpenDialog controller={makeController({ results: [], query: 'zzz' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('一致するファイルがありません')
  })

  it('フォルダ未オープンのときフォルダを開くよう案内する', () => {
    render(<QuickOpenDialog controller={makeController({ results: [], hasFolder: false })} />)
    expect(screen.getByRole('status')).toHaveTextContent('フォルダが開かれていません')
  })

  it('候補があるとき aria-expanded が true になる', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('候補が無いとき aria-expanded が false になる', () => {
    render(<QuickOpenDialog controller={makeController({ results: [] })} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it('combobox の aria-controls が listbox の id を指す', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    const listboxId = screen.getByRole('listbox').getAttribute('id')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-controls', listboxId)
  })

  it('入力欄に現在のクエリが表示される', () => {
    render(<QuickOpenDialog controller={makeController({ query: 'app' })} />)
    expect(screen.getByRole('combobox')).toHaveValue('app')
  })

  it('開いた直後は入力欄にフォーカスが当たる', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('候補があるとき案内文を表示しない', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('選択中の候補だけ aria-selected が true になる', () => {
    render(<QuickOpenDialog controller={makeController({ activeIndex: 1 })} />)
    const selected = screen.getAllByRole('option').map((el) => el.getAttribute('aria-selected'))
    expect(selected).toEqual(['false', 'true'])
  })

  it('Tab ではダイアログの操作コールバックを呼ばない', async () => {
    const controller = makeController()
    render(<QuickOpenDialog controller={controller} />)
    await userEvent.type(screen.getByRole('combobox'), '{Tab}')
    expect(controller.close).not.toHaveBeenCalled()
    expect(controller.confirm).not.toHaveBeenCalled()
    expect(controller.moveSelection).not.toHaveBeenCalled()
  })

  it('閉じたとき開く前にフォーカスがあった要素へ戻す', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    const { rerender } = render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getByRole('combobox')).toHaveFocus()

    rerender(<QuickOpenDialog controller={makeController({ isOpen: false })} />)
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('候補一覧の余白を押しても入力欄がフォーカスを失わない', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    const input = screen.getByRole('combobox')
    // mousedown の既定動作を止めないと、フォーカスが body へ移って
    // ↑↓ / Enter / Escape がすべて効かなくなる
    const event = fireEvent.mouseDown(screen.getByRole('listbox'))
    expect(event).toBe(false)
    expect(input).toHaveFocus()
  })

  it('案内文を押しても入力欄がフォーカスを失わない', () => {
    render(<QuickOpenDialog controller={makeController({ results: [] })} />)
    const event = fireEvent.mouseDown(screen.getByRole('status'))
    expect(event).toBe(false)
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('入力欄からドラッグしてオーバーレイで離しても閉じない', () => {
    const close = vi.fn()
    render(<QuickOpenDialog controller={makeController({ close })} />)
    const overlay = screen.getByTestId('quick-open-overlay')
    // テキスト選択のドラッグ: mousedown は入力欄、mouseup はオーバーレイ。
    // click は共通祖先のオーバーレイへ配送される
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.mouseUp(overlay)
    fireEvent.click(overlay)
    expect(close).not.toHaveBeenCalled()
  })

  it('オーバーレイで押して離したときは閉じる', () => {
    const close = vi.fn()
    render(<QuickOpenDialog controller={makeController({ close })} />)
    const overlay = screen.getByTestId('quick-open-overlay')
    fireEvent.mouseDown(overlay)
    fireEvent.click(overlay)
    expect(close).toHaveBeenCalled()
  })

  it('Tab でフォーカスがダイアログの外へ抜けない', async () => {
    render(<QuickOpenDialog controller={makeController()} />)
    const input = screen.getByRole('combobox')
    await userEvent.tab()
    expect(input).toHaveFocus()
  })

  it('isOpen が false のとき何も描画しない', () => {
    const { container } = render(<QuickOpenDialog controller={makeController({ isOpen: false })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
