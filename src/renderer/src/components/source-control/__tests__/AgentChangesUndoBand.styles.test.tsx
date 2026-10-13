import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import AgentChangesUndoBand from '../AgentChangesUndoBand'
import { makeAgentChangesUndoSummary } from '../../../__tests__/makeAgentChangesState'

// 実際の main.css を読み込み、jsdom のカスケード結果で宣言値を検証する(AgentChangesScopeSelect.styles.test.tsx と同じ流儀)。
// 狭い幅で折り返し・省略が読めるか・押せる高さは、実機の手動テストで確かめる
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('AgentChangesUndoBand のスタイル(main.css)', () => {
  it('帯は折り返し、文言は縮んで末尾を省略し、ボタンは折り返さずに 32px 以上の押せる高さを持つ', () => {
    const { container } = render(
      <AgentChangesUndoBand
        summary={makeAgentChangesUndoSummary()}
        disabledReason={null}
        reasonId="r"
        onUndo={vi.fn()}
      />
    )
    const button = getComputedStyle(screen.getByRole('button'))
    expect(button.minHeight).toBe('32px')
    expect(button.whiteSpace).toBe('nowrap')
    expect(button.flexShrink).toBe('0')
    const band = container.querySelector('.agent-changes__undo')
    expect(band).not.toBeNull()
    expect(getComputedStyle(band!).flexWrap).toBe('wrap')
    const text = container.querySelector('.agent-changes__undo-text')
    expect(text).not.toBeNull()
    const textStyle = getComputedStyle(text!)
    expect(textStyle.minWidth).toBe('0px')
    expect(textStyle.textOverflow).toBe('ellipsis')
    expect(textStyle.whiteSpace).toBe('nowrap')
    expect(textStyle.overflow).toBe('hidden')
  })
})
