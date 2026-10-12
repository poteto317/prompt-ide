import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import AgentChangesScopeSelect from '../AgentChangesScopeSelect'
import { makeAgentChangesRun } from '../../../__tests__/makeAgentChangesState'

// 実際の main.css を読み込み、jsdom のカスケード結果で宣言値を検証する(AgentChangesFileItem.styles.test.tsx と同じ流儀)。
// 狭い幅で文字が切れずに読めるか・押せる高さは、実機の手動テストで確かめる
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('AgentChangesScopeSelect のスタイル(main.css)', () => {
  it('選択は残りの幅に縮み(min-width: 0)、32px 以上の押せる高さを持つ', () => {
    render(
      <AgentChangesScopeSelect
        startedAt={0}
        runs={[makeAgentChangesRun()]}
        scope={{ kind: 'all' }}
        disabled={false}
        disabledReasonId={null}
        onSelect={vi.fn()}
      />
    )
    const select = getComputedStyle(screen.getByRole('combobox', { name: '表示' }))
    expect(select.minWidth).toBe('0px')
    expect(select.minHeight).toBe('32px')
    expect(select.flexGrow).toBe('1')
  })
})
