import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import HistorySection from '../HistorySection'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「タグを作成」と種類の選択肢は、退避・マージのバナーのボタンと 1 つのグループセレクタで宣言を共有する
// (パターン 30・77)。グループから外れると見た目が崩れるため固定する。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const renderSection = (
  isCreating = false,
  tags: string[] = []
): ((isCreating: boolean) => void) => {
  const build = (creating: boolean): React.JSX.Element => (
    <HistorySection
      log={[]}
      branches={[]}
      tags={tags}
      hasMore={false}
      isLoading={false}
      error={null}
      onLoadMore={vi.fn()}
      gitTag={makeGitTagPanelState({ isCreating: creating })}
      isBlocked={false}
    />
  )
  const { rerender } = render(build(isCreating))
  return (creating) => rerender(build(creating))
}

describe('HistorySection のスタイル(main.css)', () => {
  it('見出し行は見出しとボタンを横に並べる', () => {
    renderSection()
    const header = screen.getByRole('heading', { name: '履歴' }).parentElement as HTMLElement
    const style = getComputedStyle(header)
    expect(style.display).toBe('flex')
    expect(style.justifyContent).toBe('space-between')
  })

  it('「タグを作成」は 32px 四方以上の枠付きボタンになる', () => {
    renderSection()
    const style = getComputedStyle(screen.getByRole('button', { name: 'タグを作成' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.borderTopStyle).toBe('solid')
  })

  it('種類の選択肢は 32px 四方以上で、作成ボタンは disabled のとき半透明になる', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const kindStyle = getComputedStyle(screen.getByRole('radio', { name: '軽量' }))
    expect(kindStyle.minWidth).toBe('32px')
    expect(kindStyle.minHeight).toBe('32px')
    expect(getComputedStyle(screen.getByRole('button', { name: '作成' })).opacity).toBe('0.5')
  })

  it('作成中のキャンセルは disabled になり、押せるように見えない(半透明・既定のカーソル)', async () => {
    const setCreating = renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    setCreating(true)
    const style = getComputedStyle(screen.getByRole('button', { name: 'キャンセル' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })

  it('選択中の種類だけ強調色になる(aria-checked の状態を見た目にも出す)', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const checked = getComputedStyle(screen.getByRole('radio', { name: '軽量' }))
    const unchecked = getComputedStyle(screen.getByRole('radio', { name: '注釈付き' }))
    expect(checked.backgroundColor).toBe('rgb(9, 71, 113)')
    expect(checked.borderTopColor).toBe('rgb(0, 122, 204)')
    expect(unchecked.borderTopColor).toBe('rgb(85, 85, 85)')
  })

  it('検証エラーの文は、長い既存のタグ名を含んでも枠内で折り返す(overflow-wrap)', async () => {
    const longTag = 'release/2024.01.15_hotfix_for_customer_contoso_emergency_patch_v2'
    renderSection(false, [longTag])
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    // 既存タグの子になる名前は「既存のタグ <名前> と名前が衝突します」となり、長い名前がエラー文に入る
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), `${longTag}/x`)
    const error = document.querySelector('.name-input-dialog__error') as HTMLElement
    expect(error.textContent).toContain(longTag)
    expect(getComputedStyle(error).overflowWrap).toBe('anywhere')
  })

  it('ダイアログの説明文と各欄のラベルは同じ小さい文字・色になる(1 つのグループセレクタで共有する)', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const note = getComputedStyle(screen.getByText('現在の HEAD にタグを付けます'))
    const label = getComputedStyle(screen.getByText('タグ名'))
    expect(note.fontSize).toBe('11px')
    expect(note.color).toBe('rgb(150, 150, 150)')
    expect(label.fontSize).toBe(note.fontSize)
    expect(label.color).toBe(note.color)
    expect(note.marginBottom).toBe('4px')
    expect(label.marginBottom).not.toBe('4px')
  })
})
