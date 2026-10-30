import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import BranchQuickPick from '../BranchQuickPick'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// jsdom はレイアウトを計算しないため、見た目そのものではなく「必要な宣言が当たっていること」を固定する
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderPicker = (isDisabled = false): void => {
  render(
    <BranchQuickPick
      branches={[
        { name: 'main', current: true },
        { name: 'feature/x', current: false }
      ]}
      currentBranch="main"
      isDisabled={isDisabled}
      onSelect={vi.fn()}
      onCreateRequest={vi.fn()}
      onMerge={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />
  )
}

const getCreateOption = (): HTMLElement =>
  screen.getByRole('option', { name: '＋ 新しいブランチを作成…' })

// jsdom は :hover を再現できないため、規則の選択子から :hover だけを除いて、ボタンに当たるかを確かめる
const findHoverSelector = (className: string): string => {
  const rules = Array.from(styleElement.sheet?.cssRules ?? []) as CSSStyleRule[]
  const rule = rules.find(
    (r) => r.selectorText?.includes(className) && r.selectorText.includes(':hover')
  )
  if (rule === undefined) throw new Error(`${className} の hover の規則が見つかりません`)
  return rule.selectorText.replace(':hover', '')
}

describe('BranchQuickPick のスタイル(main.css)', () => {
  // 日本語の文言は文字間で改行できるため、2 行に折り返さないようにする
  it('作成の項目の文言は折り返さない', () => {
    renderPicker()
    expect(getComputedStyle(getCreateOption()).whiteSpace).toBe('nowrap')
  })

  it('作成の項目の下側に、ブランチの一覧との区切り線がある', () => {
    renderPicker()
    const style = getComputedStyle(getCreateOption().parentElement as HTMLElement)
    expect(style.borderBottomStyle).toBe('solid')
    expect(style.borderTopStyle).toBe('none')
  })

  it('行のボタンは、行の右端に固定する(ブランチ名の長さで位置が変わらない)', () => {
    renderPicker()
    const button = screen.getByRole('button', { name: 'ブランチ feature/x を削除' })
    expect(getComputedStyle(button.parentElement as HTMLElement).position).toBe('absolute')
    expect(getComputedStyle(button.parentElement?.parentElement as HTMLElement).position).toBe(
      'relative'
    )
  })

  // 長いブランチ名がボタンの下に潜らず、省略記号で切り詰められるようにする
  it('ボタンのある行だけ、ボタンの分の右の余白を空ける', () => {
    renderPicker()
    expect(getComputedStyle(screen.getByRole('option', { name: 'feature/x' })).paddingRight).toBe(
      '104px'
    )
    expect(getComputedStyle(screen.getByRole('option', { name: /main/ })).paddingRight).toBe('10px')
  })

  it.each([
    ['削除', 'ブランチ feature/x を削除'],
    ['マージ', 'ブランチ feature/x を現在のブランチにマージ']
  ])('%sのボタンはタッチで押せる 32px の大きさを持つ', (_label, name) => {
    renderPicker()
    const style = getComputedStyle(screen.getByRole('button', { name }))
    expect(style.minWidth).toBe('32px')
    expect(style.height).toBe('32px')
  })

  it('ブランチ名は省略記号で切り詰める', () => {
    renderPicker()
    const style = getComputedStyle(screen.getByTitle('feature/x'))
    expect(style.overflow).toBe('hidden')
    expect(style.textOverflow).toBe('ellipsis')
    expect(style.minWidth).toBe('0px')
  })

  it.each([
    ['削除', 'ブランチ feature/x を削除'],
    ['マージ', 'ブランチ feature/x を現在のブランチにマージ']
  ])('押せない%sのボタンは薄くし、カーソルを既定に戻す', (_label, name) => {
    renderPicker(true)
    const style = getComputedStyle(screen.getByRole('button', { name }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it.each([
    ['削除', '.branch-picker__action--delete', 'ブランチ feature/x を削除'],
    ['マージ', '.branch-picker__action--merge', 'ブランチ feature/x を現在のブランチにマージ']
  ])('%sのボタンの hover は押せるときだけ効く', (_label, className, name) => {
    const selector = findHoverSelector(className)
    renderPicker()
    expect(screen.getByRole('button', { name }).matches(selector)).toBe(true)
    cleanup()
    renderPicker(true)
    expect(screen.getByRole('button', { name }).matches(selector)).toBe(false)
  })

  it('削除とマージのボタンは基本の宣言(文字色・フォントサイズ・カーソル・枠線)が一致する', () => {
    renderPicker()
    const del = getComputedStyle(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    const merge = getComputedStyle(
      screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
    )
    for (const prop of ['color', 'fontSize', 'cursor', 'borderTopStyle'] as const) {
      expect(del[prop]).toBe(merge[prop])
    }
    expect(del.color).not.toBe('')
    expect(del.cursor).toBe('pointer')
  })
})
