import { describe, it, expect, afterEach } from 'vitest'
import { findSendConfirmReturnTarget } from '../promptRunButton'

// 送信前の確認を閉じたときのフォーカスの戻り先の選び方を、DOM の要素だけで確かめる。
// ダイアログ・フックを通した流れは AgentSendConfirmDialog.test.tsx・useAgentWorkspace.test.ts

function addButton(attributes: Record<string, string> = {}): HTMLButtonElement {
  const button = document.createElement('button')
  for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value)
  document.body.appendChild(button)
  return button
}

function hide(element: HTMLElement): void {
  Object.defineProperty(element, 'checkVisibility', { value: () => false })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('findSendConfirmReturnTarget', () => {
  it('開いた時点の要素が DOM に残っていて押せて見えていれば、その要素を返す', () => {
    const opener = addButton()
    addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(opener, 'p1')).toBe(opener)
  })

  it('開いた時点の要素が DOM から外れていれば、同じプロンプトの一覧の実行を返す', () => {
    const opener = document.createElement('button')
    const run = addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(opener, 'p1')).toBe(run)
  })

  it('開いた時点の要素が disabled なら、一覧の実行を返す', () => {
    const opener = addButton({ disabled: '' })
    const run = addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(opener, 'p1')).toBe(run)
  })

  it('開いた時点の要素が body なら(フォーカスが落ちていた)、一覧の実行を返す', () => {
    const run = addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(document.body, 'p1')).toBe(run)
  })

  it('開いた時点の要素が HTMLElement でない(SVG の要素)なら、一覧の実行を返す', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    document.body.appendChild(svg)
    const run = addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(svg, 'p1')).toBe(run)
  })

  it('別のプロンプトの実行ボタンは選ばない', () => {
    addButton({ 'data-prompt-run': 'p2' })
    expect(findSendConfirmReturnTarget(null, 'p1')).toBeNull()
  })

  it('一覧の実行が disabled なら null', () => {
    addButton({ 'data-prompt-run': 'p1', disabled: '' })
    expect(findSendConfirmReturnTarget(null, 'p1')).toBeNull()
  })

  it('一覧の実行が見えていなければ(パネルが隠れている)null', () => {
    hide(addButton({ 'data-prompt-run': 'p1' }))
    expect(findSendConfirmReturnTarget(null, 'p1')).toBeNull()
  })

  it('開いた時点の要素が無く、promptId も null なら null(一覧を探さない)', () => {
    addButton({ 'data-prompt-run': 'p1' })
    expect(findSendConfirmReturnTarget(null, null)).toBeNull()
  })
})
