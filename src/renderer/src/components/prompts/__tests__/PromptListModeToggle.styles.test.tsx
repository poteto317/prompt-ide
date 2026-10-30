import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { makePromptListModePanelState } from '../../../__tests__/makePromptListModePanelState'
import PromptListModeToggle from '../PromptListModeToggle'
import PromptsToolbar from '../PromptsToolbar'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。トグルは誤タップの防止が目的なので
// 32px 四方以上にし、見た目はインポート / エクスポートのボタン(.prompts-panel__toolbar-button)と同じ値にする(あちらは変えない)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

// jsdom は :hover を計算しないため、:hover を含む規則のセレクタから :hover を外し、要素に当たるかで「ホバーしたら当たるか」を見る
const hoverBackgroundRulesFor = (element: HTMLElement): string[] =>
  Array.from(styleElement.sheet?.cssRules ?? [])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .filter((rule) => rule.style.getPropertyValue('background') !== '')
    .flatMap((rule) => rule.selectorText.split(/,\s*/))
    .filter((selector) => selector.includes(':hover'))
    .filter((selector) => element.matches(selector.replace(/:hover/g, '')))

/** インポート / エクスポートのボタンと揃える見た目のプロパティ(jsdom が値を計算できるもの) */
const SHARED_LOOK_PROPERTIES = [
  'backgroundColor',
  'color',
  'fontSize',
  'cursor',
  'borderTopStyle',
  'borderTopWidth',
  'borderTopColor',
  'borderTopLeftRadius',
  'paddingTop',
  'paddingLeft'
] as const

describe('一覧のモードのトグルのスタイル(main.css)', () => {
  it('トグルのボタンは 32px 四方以上の枠付きボタンになる', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    const style = getComputedStyle(screen.getByRole('button', { name: '編集モード' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.cursor).toBe('pointer')
  })

  it('見た目はインポート / エクスポートのボタンと同じ値', () => {
    render(
      <>
        <PromptListModeToggle state={makePromptListModePanelState()} />
        <PromptsToolbar onImport={vi.fn()} onExport={vi.fn()} isExportDisabled={false} />
      </>
    )
    const toggleStyle = getComputedStyle(screen.getByRole('button', { name: '編集モード' }))
    const toolbarStyle = getComputedStyle(
      screen.getByRole('button', { name: 'プロンプトをインポート' })
    )
    for (const property of SHARED_LOOK_PROPERTIES) {
      // 比べる値が空(計算されていない)だと、どちらも空で一致してしまうので、先に空でないことを確かめる
      expect(toolbarStyle[property], property).not.toBe('')
      expect(toggleStyle[property], property).toBe(toolbarStyle[property])
    }
  })

  it('読み込み中(disabled)は半透明で、押せないカーソルになり、ホバーの色の規則が当たらない', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ mode: null })} />)
    const button = screen.getByRole('button', { name: '編集モード' })
    const style = getComputedStyle(button)
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('not-allowed')
    expect(hoverBackgroundRulesFor(button)).toEqual([])
  })

  it('保存の途中(aria-disabled)は disabled と同じ半透明・カーソルで、ホバーの色の規則が当たらない', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState({ isSaving: true })} />)
    const button = screen.getByRole('button', { name: '編集モード' })
    const style = getComputedStyle(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('not-allowed')
    expect(hoverBackgroundRulesFor(button)).toEqual([])
  })

  it('押せるときは、ホバーの色の規則が当たる(上の判定が空振りしていないことの確認)', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    expect(
      hoverBackgroundRulesFor(screen.getByRole('button', { name: '編集モード' })).length
    ).toBeGreaterThan(0)
  })

  // エラーの段落は空でも常設(L-153)なので、空のときに余白が残ると、エラーが無い通常の状態でもトグルの下に隙間ができる。
  // `:empty` の規則で空のときだけ余白を消し、文言が出たときは上に余白を付ける(対のテストで `:empty` を外すと落ちる)
  it('エラーの段落は、空のときは余白が無く、文言が出ると上に余白が付く', () => {
    const { container, rerender } = render(
      <PromptListModeToggle state={makePromptListModePanelState({ saveError: null })} />
    )
    const message = container.querySelector('.prompts-panel__mode-error') as HTMLElement
    expect(getComputedStyle(message).paddingTop).toBe('0px')
    rerender(
      <PromptListModeToggle
        state={makePromptListModePanelState({
          saveError: 'モードの設定を保存できませんでした: 理由'
        })}
      />
    )
    expect(getComputedStyle(message).paddingTop).toBe('2px')
  })

  it('トグルの行はほかの行と同じく縮まず、下に区切りの線を持つ', () => {
    render(<PromptListModeToggle state={makePromptListModePanelState()} />)
    const row = screen.getByRole('button', { name: '編集モード' }).parentElement as HTMLElement
    const style = getComputedStyle(row)
    expect(style.flexShrink).toBe('0')
    expect(style.borderBottomStyle).toBe('solid')
  })
})
