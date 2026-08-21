import { useEffect, useLayoutEffect, useRef } from 'react'
import type { QuickOpenController } from '../../hooks/useQuickOpen'
import QuickOpenItem from './QuickOpenItem'

interface Props {
  controller: QuickOpenController
}

const LISTBOX_ID = 'quick-open-listbox'
const optionId = (index: number): string => `quick-open-option-${index}`

export default function QuickOpenDialog({ controller }: Props): React.JSX.Element | null {
  const {
    isOpen,
    query,
    results,
    activeIndex,
    hasFolder,
    loadError,
    hasHandedOverFocus,
    close,
    setQuery,
    moveSelection,
    setActiveIndex,
    confirm
  } = controller

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // オーバーレイ上で押し始めたクリックかどうか。入力欄からドラッグして
  // オーバーレイで離した場合、click は共通祖先のオーバーレイへ配送されるため、
  // mouseup の位置だけでは「外側のクリック」と区別できない
  const pressedOnOverlayRef = useRef(false)

  // autoFocus 属性ではなくここで明示的にフォーカスする。autoFocus は
  // コミット時に適用されるため、effect の時点では document.activeElement が
  // 既に入力欄になっており、開く前の要素を控えられない
  useLayoutEffect(() => {
    if (!isOpen) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    // 閉じたら元の要素へフォーカスを戻す。戻さないと body に取り残され、
    // Escape のあとエディタへ直接タイプできなくなる。
    // ファイルを開いた場合は EditorPanel の key 変更で Monaco が再マウントされ、
    // 控えていた要素は DOM から切り離されている。その場合の復帰は
    // エディタ側(onMount での focus)が担うため、ここでは何もしない
    return () => {
      // ファイルを開いて閉じた場合はエディタへフォーカスを渡す。ここで戻すと
      // エディタ側が「他が保持している」と判断して受け取れない
      if (hasHandedOverFocus()) return
      if (previouslyFocused?.isConnected === true) previouslyFocused.focus()
    }
  }, [isOpen, hasHandedOverFocus])

  // キーボードで選択を動かしたとき、選択中の項目が一覧の外に出たままにならないようにする
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const active = list.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  // Tab は document の capture で受ける。入力欄の onKeyDown だけに任せると、
  // フォーカスがダイアログの外へ移った時点で aria-modal のフォーカストラップが
  // 破れ、背後の画面へ移動できてしまう(Escape を document で受けるのと同じ理由)
  useEffect(() => {
    if (!isOpen) return
    const handleTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    }
    document.addEventListener('keydown', handleTab, true)
    return () => document.removeEventListener('keydown', handleTab, true)
  }, [isOpen])

  if (!isOpen) return null

  // Escape は useQuickOpen が document で購読するためここでは扱わない
  // (フォーカスがダイアログ外にあっても閉じられるようにするため)
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // IME の変換中はキーを横取りしない。変換確定の Enter を候補決定として扱うと
    // 意図しないファイルが開き、↑↓ を奪うと変換候補を選べなくなる
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection(-1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      confirm()
      return
    }
  }

  // スクロールバー上の mousedown か。既定動作を止めるとドラッグできなくなる。
  // jsdom などレイアウトを持たない環境では両方 0 になり false を返す
  const isScrollbarMouseDown = (e: React.MouseEvent): boolean => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return false
    if (target.scrollHeight <= target.clientHeight) return false
    // clientWidth はスクロールバーを含まないため、その右側なら操作対象とみなす
    return e.clientX - target.getBoundingClientRect().left > target.clientWidth
  }

  // 入力欄以外を押したときにフォーカスが body へ移るのを防ぐ。移ってしまうと
  // 以降 ↑↓ / Enter / Escape が届かず、マウスでしか操作できなくなる。
  // ただしスクロールバーの操作は妨げず、離した時点でフォーカスを戻す
  const handleDialogMouseDown = (e: React.MouseEvent): void => {
    if (e.target === inputRef.current) return
    if (isScrollbarMouseDown(e)) return
    e.preventDefault()
  }

  const handleDialogMouseUp = (): void => {
    if (document.activeElement !== inputRef.current) inputRef.current?.focus()
  }

  // 読み込みに失敗している場合、ツリーが空なのは検索結果 0 件だからではない
  const emptyMessage =
    loadError !== null
      ? `フォルダを読み込めませんでした: ${loadError}`
      : hasFolder
        ? '一致するファイルがありません'
        : 'フォルダが開かれていません。エクスプローラーからフォルダを開いてください'

  return (
    <div
      className="quick-open__overlay"
      role="presentation"
      data-testid="quick-open-overlay"
      onMouseDown={(e) => {
        pressedOnOverlayRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (pressedOnOverlayRef.current && e.target === e.currentTarget) close()
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="ファイルを開く"
        aria-modal="true"
        onMouseDown={handleDialogMouseDown}
        onMouseUp={handleDialogMouseUp}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-open__input"
          role="combobox"
          aria-label="ファイル名で検索"
          // popup(listbox)はダイアログ表示中つねに DOM にあるため、
          // 候補 0 件でも aria-expanded は true。件数ではなく開閉状態を表す属性
          aria-expanded
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          {...(results.length > 0 ? { 'aria-activedescendant': optionId(activeIndex) } : {})}
          placeholder="ファイル名を入力"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div
          id={LISTBOX_ID}
          role="listbox"
          aria-label="検索結果"
          className="quick-open__list"
          ref={listRef}
        >
          {results.map((result, index) => (
            <QuickOpenItem
              key={result.node.path}
              id={optionId(index)}
              result={result}
              isActive={index === activeIndex}
              onSelect={() => confirm(index)}
              onHover={() => setActiveIndex(index)}
            />
          ))}
        </div>
        {results.length === 0 && (
          <p className="quick-open__empty" role="status">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
