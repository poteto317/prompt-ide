import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import ExecutionModeSection from '../ExecutionModeSection'
import AgentCliKindSection from '../AgentCliKindSection'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(AgentTerminalPanel.styles.test.tsx と同じ流儀)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

function renderSections(isSwitching: boolean): void {
  render(
    <>
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        isSwitching={isSwitching}
        onSelect={vi.fn()}
      />
      <AgentCliKindSection
        kind="claude"
        fallback={null}
        saveError={null}
        isLocked={false}
        isSwitching={isSwitching}
        lockedReason={null}
        onSelect={vi.fn()}
      />
    </>
  )
}

const options = (): HTMLElement[] => screen.getAllByRole('radio')

// jsdom は :hover を計算しないため、:hover を含む規則のセレクタから :hover を外し、要素に当たるかで「ホバーしたら当たるか」を見る
const hoverBackgroundRulesFor = (element: HTMLElement): string[] =>
  Array.from(styleElement.sheet?.cssRules ?? [])
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
    .filter((rule) => rule.style.getPropertyValue('background') !== '')
    .flatMap((rule) => rule.selectorText.split(/,\s*/))
    .filter((selector) => selector.includes(':hover'))
    .filter((selector) => element.matches(selector.replace(/:hover/g, '')))

describe('設定の実行方式・使うエージェント CLI の選択肢のスタイル(main.css)', () => {
  it('切り替えの途中(aria-disabled)の選択肢は :disabled と同じ見た目(不透明度 0.5・矢印のカーソル)', () => {
    renderSections(true)
    expect(options()).toHaveLength(4)
    for (const option of options()) {
      expect(option).toHaveAttribute('aria-disabled', 'true')
      const style = getComputedStyle(option)
      expect(style.opacity, option.textContent ?? '').toBe('0.5')
      expect(style.cursor, option.textContent ?? '').toBe('default')
    }
  })

  it('選べるときは薄くせず、押せるカーソルのまま', () => {
    renderSections(false)
    for (const option of options()) {
      const style = getComputedStyle(option)
      expect(style.opacity, option.textContent ?? '').not.toBe('0.5')
      expect(style.cursor, option.textContent ?? '').toBe('pointer')
    }
  })

  it('切り替えの途中の選択肢には、ホバーの色の規則が当たらない', () => {
    renderSections(true)
    for (const option of options()) {
      expect(hoverBackgroundRulesFor(option), option.textContent ?? '').toEqual([])
    }
  })

  it('選べるときは、ホバーの色の規則が当たる(上の判定が空振りしていないことの確認)', () => {
    renderSections(false)
    for (const option of options()) {
      expect(hoverBackgroundRulesFor(option).length, option.textContent ?? '').toBeGreaterThan(0)
    }
  })
})
