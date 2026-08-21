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
  matchedName: true,
  nameIndices: [],
  directoryIndices: []
})

// 復帰先の保持はコントローラ側の責務。テストでも本物と同じ振る舞いを再現する
const makeController = (overrides: Partial<QuickOpenController> = {}): QuickOpenController => {
  let focusOrigin: HTMLElement | null = null
  return {
    isOpen: true,
    query: '',
    results: [makeResult('App.tsx', 'src'), makeResult('main.tsx', 'src')],
    activeIndex: 0,
    hasFolder: true,
    loadError: null,
    hasHandedOverFocus: () => false,
    open: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    moveSelection: vi.fn(),
    setActiveIndex: vi.fn(),
    confirm: vi.fn(),
    rememberFocusOrigin: (element: HTMLElement | null) => {
      focusOrigin = element
    },
    restoreFocusOrigin: () => {
      if (focusOrigin?.isConnected === true) focusOrigin.focus()
    },
    ...overrides
  }
}

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

  it('フォルダの読み込みに失敗しているときはその内容を案内する', () => {
    // 走査失敗時もフォルダは確定されツリーは空になるため、「一致なし」と出すと
    // 検索結果 0 件と誤認させる
    render(
      <QuickOpenDialog
        controller={makeController({ results: [], query: 'zzz', loadError: '走査に失敗しました' })}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('走査に失敗しました')
  })

  it('候補があるときは読み込みエラーの案内を出さない', () => {
    render(<QuickOpenDialog controller={makeController({ loadError: '走査に失敗しました' })} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('一覧のスクロールバーを押したときは既定動作を妨げない', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    const list = screen.getByRole('listbox')
    // スクロールバーが出ている状態を再現する(jsdom はレイアウトを持たない)
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(list, 'clientWidth', { value: 200, configurable: true })
    list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 215, bottom: 100 }) as DOMRect
    const notPrevented = fireEvent.mouseDown(list, { clientX: 210 })
    expect(notPrevented).toBe(true)
  })

  it('スクロールバー外の一覧クリックは従来どおり既定動作を抑止する', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    const list = screen.getByRole('listbox')
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(list, 'clientWidth', { value: 200, configurable: true })
    list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 215, bottom: 100 }) as DOMRect
    const prevented = fireEvent.mouseDown(list, { clientX: 50 })
    expect(prevented).toBe(false)
  })

  it('フォルダ未オープンのときフォルダを開くよう案内する', () => {
    render(<QuickOpenDialog controller={makeController({ results: [], hasFolder: false })} />)
    expect(screen.getByRole('status')).toHaveTextContent('フォルダが開かれていません')
  })

  it('候補があるとき aria-expanded が true になる', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('候補が無くても popup を表示している間は aria-expanded が true のまま', () => {
    // aria-expanded は候補件数ではなく popup の開閉を表す。0 件でも listbox は
    // DOM にあるため、false にすると支援技術に検索 UI が閉じたと伝わってしまう
    render(<QuickOpenDialog controller={makeController({ results: [] })} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('候補が無くても aria-controls の参照先が DOM に存在する', () => {
    render(<QuickOpenDialog controller={makeController({ results: [] })} />)
    const controls = screen.getByRole('combobox').getAttribute('aria-controls')
    expect(document.getElementById(controls ?? '')).not.toBeNull()
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

  it('IME 変換中の Enter では confirm を呼ばない', () => {
    const confirm = vi.fn()
    render(<QuickOpenDialog controller={makeController({ confirm })} />)
    // 変換確定の Enter を候補決定として扱うと、意図しないファイルが開いてしまう
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter', isComposing: true })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('IME 変換中の ArrowDown では選択を動かさない', () => {
    const moveSelection = vi.fn()
    render(<QuickOpenDialog controller={makeController({ moveSelection })} />)
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown', isComposing: true })
    expect(moveSelection).not.toHaveBeenCalled()
  })

  it('IME 変換中の ArrowDown の既定動作を妨げない', () => {
    render(<QuickOpenDialog controller={makeController()} />)
    // 変換候補の移動を潰さないよう preventDefault しない
    const notPrevented = fireEvent.keyDown(screen.getByRole('combobox'), {
      key: 'ArrowDown',
      isComposing: true
    })
    expect(notPrevented).toBe(true)
  })

  it('復帰先が DOM から取り除かれているときはフォーカスを移さない', () => {
    // ファイルを開くと EditorPanel の key 変更で Monaco が再マウントされ、
    // 控えていた要素は DOM から切り離される
    const detached = document.createElement('button')
    document.body.appendChild(detached)
    detached.focus()
    const focusSpy = vi.spyOn(detached, 'focus')

    const { rerender } = render(<QuickOpenDialog controller={makeController()} />)
    focusSpy.mockClear()
    detached.remove()

    rerender(<QuickOpenDialog controller={makeController({ isOpen: false })} />)
    expect(focusSpy).not.toHaveBeenCalled()
  })

  it('ファイルを開いて閉じたときは、元の要素へフォーカスを戻さない', () => {
    // 戻してしまうと EditorPanel 側がフォーカスを受け取れず、エディタへ移らない
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    let handedOver = false
    const controller = makeController({ hasHandedOverFocus: () => handedOver })
    const { rerender } = render(<QuickOpenDialog controller={controller} />)
    handedOver = true
    rerender(
      <QuickOpenDialog
        controller={makeController({ isOpen: false, hasHandedOverFocus: () => handedOver })}
      />
    )
    expect(outside).not.toHaveFocus()
    outside.remove()
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

  it('フォーカスがダイアログ外にあっても Tab で背後の画面へ移らない', () => {
    // 入力欄の onKeyDown だけに任せると、何らかの理由でフォーカスが外れた時点で
    // aria-modal のフォーカストラップが破れ、背後の要素へ Tab で移動できてしまう
    const outside = document.createElement('button')
    document.body.prepend(outside)
    try {
      render(<QuickOpenDialog controller={makeController()} />)
      const input = screen.getByRole('combobox')
      outside.focus()
      expect(outside).toHaveFocus()
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
      outside.dispatchEvent(event)
      // 既定動作を止めないと、ブラウザは背後の要素へフォーカスを移してしまう
      expect(event.defaultPrevented).toBe(true)
      expect(input).toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  it('IME 変換中の Tab は横取りしない', () => {
    // IME によっては変換候補の操作に Tab を使う。ここで奪うと日本語入力が壊れる
    render(<QuickOpenDialog controller={makeController()} />)
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    screen.getByRole('combobox').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('isOpen が false のとき何も描画しない', () => {
    const { container } = render(<QuickOpenDialog controller={makeController({ isOpen: false })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
