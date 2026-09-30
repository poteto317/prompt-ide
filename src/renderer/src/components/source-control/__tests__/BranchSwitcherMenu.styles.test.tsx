import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { GitBranch } from '@shared/types'
import BranchSwitcherMenu from '../BranchSwitcherMenu'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// jsdom はレイアウト(折り返しや幅)を計算しないため、見た目そのものではなく「必要な宣言が
// 作成・削除・マージの各ボタンに当たっていること」を固定する(実際の描画は Electron で確認する)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderMenu = (branches: GitBranch[] = [{ name: 'main', current: true }]): void => {
  render(
    <BranchSwitcherMenu
      branches={branches}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCreateRequest={vi.fn()}
      onDelete={vi.fn()}
      onMerge={vi.fn()}
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

// 削除・マージボタンは 1 つのグループセレクタで基本宣言(32px 四方・色・フォント・カーソル等)を
// 共有する。jsdom は :hover を計算しないため、ホバー色は検証しない
describe('削除・マージボタンの共通の基本宣言', () => {
  const renderWithOtherBranch = (): void =>
    renderMenu([
      { name: 'main', current: true },
      { name: 'feature/x', current: false }
    ])

  it.each([
    ['削除', 'ブランチ feature/x を削除'],
    ['マージ', 'ブランチ feature/x を現在のブランチにマージ']
  ])('%sボタンは 32px 四方のタップ領域を持つ', (_label, name) => {
    renderWithOtherBranch()
    const style = getComputedStyle(screen.getByRole('button', { name }))
    expect(style.width).toBe('32px')
    expect(style.height).toBe('32px')
  })

  it('削除・マージボタンは基本宣言(文字色・フォントサイズ・カーソル・枠線・伸縮)が一致する', () => {
    renderWithOtherBranch()
    const del = getComputedStyle(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    const merge = getComputedStyle(
      screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
    )
    for (const prop of ['color', 'fontSize', 'cursor', 'borderTopStyle', 'flexGrow'] as const) {
      expect(del[prop]).toBe(merge[prop])
    }
    expect(del.color).not.toBe('')
    expect(del.cursor).toBe('pointer')
  })
})
