import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import CollapsibleSection from '../CollapsibleSection'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('CollapsibleSection のスタイル(main.css)', () => {
  const renderSection = (): void => {
    render(
      <CollapsibleSection title="変更" count={2} actions={<button type="button">操作</button>}>
        中身
      </CollapsibleSection>
    )
  }

  // .source-control-panel__section-title の余白が残ると、開閉のボタンの余白と重なって見出しだけ右へずれる
  it('h3 の余白は 0 で、左の余白は開閉のボタンが持つ', () => {
    renderSection()
    const heading = getComputedStyle(screen.getByRole('heading'))
    expect(heading.paddingTop).toBe('0px')
    expect(heading.paddingBottom).toBe('0px')
    expect(heading.paddingLeft).toBe('0px')
    expect(heading.paddingRight).toBe('0px')
    expect(getComputedStyle(screen.getByRole('button', { name: '変更' })).paddingLeft).toBe('12px')
  })

  // 大文字にすると見出しの `stash` が `STASH` になる
  it('見出しの英字を大文字に変えない', () => {
    renderSection()
    expect(getComputedStyle(screen.getByRole('heading')).textTransform).not.toBe('uppercase')
  })

  it('見出し行は横並びで、開閉のボタンが縮み、バッジと操作は縮まない', () => {
    renderSection()
    const heading = screen.getByRole('heading')
    const header = getComputedStyle(heading.parentElement as HTMLElement)
    expect(header.display).toBe('flex')
    expect(header.alignItems).toBe('center')
    const toggle = getComputedStyle(screen.getByRole('button', { name: '変更' }))
    expect(toggle.minWidth).toBe('0px')
    expect(toggle.overflow).toBe('hidden')
    expect(toggle.textOverflow).toBe('ellipsis')
    expect(toggle.minHeight).toBe('32px')
    expect(getComputedStyle(screen.getByText('2')).flexShrink).toBe('0')
    const actions = screen.getByRole('button', { name: '操作' }).parentElement as HTMLElement
    expect(getComputedStyle(actions).flexShrink).toBe('0')
  })
})
