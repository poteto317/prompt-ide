'use client'
import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clampNumber } from '@shared/panelLayout'
import type { PanelSizeLimits } from '../lib/panelLayoutLimits'

interface Props {
  orientation: 'vertical' | 'horizontal'
  label: string
  value: number
  step: number
  /** 今の画面で取れる範囲。ウィンドウの大きさで変わるので、操作のたびに読む */
  limits: () => PanelSizeLimits
  /** ポインタの位置から値を求める */
  valueFromPointer: (clientX: number, clientY: number) => number
  onChange: (value: number) => void
  onCommit: () => void
}

interface Drag {
  pointerId: number
  /** 押した時点の、保存されている値(範囲の外のことがある) */
  savedValue: number
  lastValue: number
  moved: boolean
}

// 隣り合う領域の大きさを変える境界。ドラッグと矢印キーで操作する。今の画面の範囲への丸めはここで行う(絶対の範囲への丸めは
// usePanelLayout)
export default function PanelResizer({
  orientation,
  label,
  value,
  step,
  limits,
  valueFromPointer,
  onChange,
  onCommit
}: Props): React.JSX.Element {
  const dragRef = useRef<Drag | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  // 操作の時点の範囲を読む。保存した値が範囲の外でも、見えている大きさから動かす
  const range = limits()
  const shownValue = clampNumber(value, range.min, range.max)

  const finish = (pointerId: number): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== pointerId) return
    dragRef.current = null
    setIsDragging(false)
    if (drag.moved && drag.lastValue !== drag.savedValue) onCommit()
  }

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || dragRef.current !== null) return
    // 取れないときに投げても、ドラッグ中のまま残らないよう先に呼ぶ
    e.currentTarget.setPointerCapture(e.pointerId)
    // 描画の後にウィンドウが変わっていても、押した時点の範囲から始める
    const { min: low, max: high } = limits()
    const lastValue = clampNumber(value, low, high)
    dragRef.current = { pointerId: e.pointerId, savedValue: value, lastValue, moved: false }
    setIsDragging(true)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const { min: low, max: high } = limits()
    const next = clampNumber(valueFromPointer(e.clientX, e.clientY), low, high)
    // 見た目が変わらない間は保存した値も状態も変えない
    if (next === drag.lastValue) return
    drag.lastValue = next
    drag.moved = true
    onChange(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const [increase, decrease] =
      orientation === 'vertical' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowUp', 'ArrowDown']
    if (e.key !== increase && e.key !== decrease) return
    e.preventDefault()
    const { min: low, max: high } = limits()
    const current = clampNumber(value, low, high)
    const next = clampNumber(current + (e.key === increase ? step : -step), low, high)
    // 範囲の端で押し続けても設定を書き直さない(L-526)
    if (next === current) return
    onChange(next)
    onCommit()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={shownValue}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      tabIndex={0}
      className={[
        'panel-resizer',
        `panel-resizer--${orientation}`,
        isDragging ? 'panel-resizer--dragging' : ''
      ]
        .filter((name) => name !== '')
        .join(' ')}
      // ポインタではフォーカスと文字の選択を動かさない(ターミナルや Monaco の入力先を保つ)
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e.pointerId)}
      onPointerCancel={(e) => finish(e.pointerId)}
      onLostPointerCapture={(e) => finish(e.pointerId)}
      onKeyDown={handleKeyDown}
    />
  )
}
