import { render, screen } from '@testing-library/react'
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

  it('Escape で close が呼ばれる', async () => {
    const close = vi.fn()
    render(<QuickOpenDialog controller={makeController({ close })} />)
    await userEvent.type(screen.getByRole('combobox'), '{Escape}')
    expect(close).toHaveBeenCalled()
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

  it('isOpen が false のとき何も描画しない', () => {
    const { container } = render(<QuickOpenDialog controller={makeController({ isOpen: false })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
