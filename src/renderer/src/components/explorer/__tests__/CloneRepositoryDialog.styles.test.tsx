import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import CloneRepositoryDialog from '../CloneRepositoryDialog'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)と :focus の規則を検証する(パターン 30・77・97)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('clone のダイアログのスタイル(main.css)', () => {
  // form は tabindex=-1。フォーカスを受けると Chromium 既定のフォーカスリングがダイアログ全体に出るため消す。
  // jsdom の getComputedStyle は :focus を計算しないため、form に一致する :focus の規則を集めて確かめる
  it('ダイアログ内の文字をクリックして form にフォーカスがあっても、form にフォーカスリングを出さない', async () => {
    render(
      <CloneRepositoryDialog
        isCloning={false}
        isBlocked={false}
        error={null}
        onSubmit={vi.fn()}
        onCancelClone={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const dialog = screen.getByRole('dialog', { name: 'リポジトリを clone' })
    await userEvent.click(screen.getByText('URL'))
    await userEvent.click(
      screen.getByText(
        '保存先の親フォルダを選ぶと、その中にフォルダを作って取得し、そのフォルダを開きます'
      )
    )
    expect(dialog).toHaveFocus()
    const focusRules = Array.from(styleElement.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes(':focus') &&
        dialog.matches(rule.selectorText)
    )
    expect(
      focusRules.map(
        (rule) =>
          rule.style.getPropertyValue('outline') || rule.style.getPropertyValue('outline-style')
      )
    ).toContain('none')
  })

  it('説明・ラベルは補足の文字、入力欄は縦に並ぶ', () => {
    render(
      <CloneRepositoryDialog
        isCloning={false}
        isBlocked={false}
        error={null}
        onSubmit={vi.fn()}
        onCancelClone={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const label = getComputedStyle(screen.getByText('フォルダ名'))
    expect(label.fontSize).toBe('11px')
    const field = getComputedStyle(screen.getByText('フォルダ名').parentElement as HTMLElement)
    expect(field.display).toBe('flex')
    expect(field.flexDirection).toBe('column')
  })
})
