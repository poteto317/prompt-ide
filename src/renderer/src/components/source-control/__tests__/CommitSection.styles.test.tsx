import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import CommitSection from '../CommitSection'
import { commitMenuButton } from '../../../__tests__/sourceControlMenu'

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

describe('CommitSection のスタイル(main.css)', () => {
  it('主ボタンと矢印のボタンを横に並べ、主ボタンを幅いっぱいに広げる', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    const button = screen.getByRole('button', { name: 'コミット' })
    expect(button.parentElement).toContainElement(commitMenuButton())
    expect(getComputedStyle(button.parentElement!).display).toBe('flex')
    const buttonStyle = getComputedStyle(button)
    expect(buttonStyle.flexGrow).toBe('1')
    // 長い文言(同期の件数)でも矢印のボタンを押し出さない
    expect(buttonStyle.minWidth).toBe('0px')
    // 右端に揃える既定を残すと、幅いっぱいに広がらない
    expect(buttonStyle.alignSelf).not.toBe('flex-end')
  })

  it('矢印のボタンと矢印はブロックにし、行ボックスの分だけ主ボタンより下へずらさない', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn()}
      />
    )
    expect(getComputedStyle(commitMenuButton()).display).toBe('block')
    const arrow = commitMenuButton().querySelector('svg') as SVGElement
    expect(getComputedStyle(arrow).display).toBe('block')
    expect(arrow).toHaveAttribute('data-direction', 'down')
  })
})
