import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const styleOf = (className: string): CSSStyleDeclaration => {
  const { container } = render(<div className={className} />)
  return getComputedStyle(container.firstElementChild as Element)
}

describe('PanelResizer のスタイル(main.css)', () => {
  it('縦の境界は col-resize', () => {
    expect(styleOf('panel-resizer panel-resizer--vertical').cursor).toBe('col-resize')
    // レイアウトの幅を取らない
    expect(styleOf('panel-resizer panel-resizer--vertical').marginLeft).toBe('-3px')
    expect(styleOf('panel-resizer panel-resizer--vertical').marginRight).toBe('-3px')
    expect(styleOf('panel-resizer panel-resizer--dragging').backgroundColor).toBe(
      'rgb(0, 122, 204)'
    )
  })

  it('横の境界は row-resize で、上へ 6px 寄せて重ねる', () => {
    const style = styleOf('panel-resizer panel-resizer--horizontal')
    expect(style.cursor).toBe('row-resize')
    expect(style.marginTop).toBe('-6px')
  })

  it('境界はタッチで動かず、選択されず、Monaco のスクロールバーより手前', () => {
    const style = styleOf('panel-resizer')
    expect(style.getPropertyValue('touch-action')).toBe('none')
    expect(style.getPropertyValue('user-select')).toBe('none')
    expect(style.zIndex).toBe('12')
  })

  it('サイドバーは最小幅と最大幅を持つ', () => {
    const style = styleOf('sidebar')
    expect(style.minWidth).toBe('220px')
    expect(style.maxWidth).toBe('calc(100vw - 400px)')
  })

  it('ターミナルのパネルは境界の高さの変数を使い、既定は 45%・最小は 160px', () => {
    const section = document.createElement('section')
    section.className = 'agent-terminal-panel agent-terminal-panel--open'
    document.body.append(section)
    try {
      const style = getComputedStyle(section)
      expect(style.getPropertyValue('flex')).toContain('var(--agent-terminal-height, 45%)')
      expect(style.minHeight).toBe('160px')
    } finally {
      section.remove()
    }
  })

  it('進捗の記録の行は狭いサイドバーでボタンを次の行へ折り返す', () => {
    const row = document.createElement('div')
    row.className = 'stage-history__record'
    const input = document.createElement('input')
    input.className = 'stage-history__record-input'
    row.append(input)
    document.body.append(row)
    try {
      expect(getComputedStyle(row).flexWrap).toBe('wrap')
      expect(getComputedStyle(input).minWidth).toBe('0px')
      expect(getComputedStyle(input).flexBasis).toBe('100px')
    } finally {
      row.remove()
    }
  })
})
