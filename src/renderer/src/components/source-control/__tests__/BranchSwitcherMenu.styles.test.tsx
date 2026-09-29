import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import BranchSwitcherMenu from '../BranchSwitcherMenu'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// jsdom はレイアウト(折り返しや幅)を計算しないため、見た目そのものではなく「必要な宣言が
// 作成ボタンに当たっていること」を固定する(実際の描画は Electron で確認する)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderMenu = (): void => {
  render(
    <BranchSwitcherMenu
      branches={[{ name: 'main', current: true }]}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCreateRequest={vi.fn()}
      onDelete={vi.fn()}
    />
  )
}

const getCreateButton = (): HTMLElement =>
  screen.getByRole('button', { name: '＋ 新しいブランチを作成…' })

describe('BranchSwitcherMenu のスタイル(main.css)', () => {
  // PRレビュー指摘: メニューは shrink-to-fit で、短いブランチ名しか無いと min-width(160px)
  // まで縮む。日本語の文言は文字間で改行できるため、作成ボタンが2行に折り返されていた。
  // nowrap にすると文言の幅がメニュー幅の下限になり、1行に収まる
  it('作成ボタンの文言は折り返さない(white-space: nowrap)', () => {
    renderMenu()
    expect(getComputedStyle(getCreateButton()).whiteSpace).toBe('nowrap')
  })

  // 作成ボタンはメニュー項目のスタイル(.source-control-panel__branch-menu-item)を併用し、
  // 区切り線だけを足している。併用が外れたり宣言順が逆転したりすると見た目が崩れる
  it('作成ボタンはメニュー項目と同じ余白を持ち、下側に区切り線がある', () => {
    renderMenu()
    const style = getComputedStyle(getCreateButton())
    expect(style.paddingLeft).toBe('16px')
    expect(style.borderBottomStyle).toBe('solid')
    expect(style.borderTopStyle).toBe('none')
  })
})
