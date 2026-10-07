import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import AgentChangesFileItem from '../AgentChangesFileItem'
import { makeAgentChangeEntry } from '../../../__tests__/makeAgentChangesState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(ChangesSection.styles.test.tsx と同じ流儀)。
// jsdom はレイアウトを計算しないため、押せる高さそのものは測れない(実機の手動テスト AGC-025 で確かめる)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('AgentChangesFileItem のスタイル(main.css)', () => {
  // 設計書「A の詳細」のタップ領域 32px 以上。パスのボタンは文字の高さだけでなく行の高さいっぱいに伸ばす
  it('行のパスのボタンは行の高さに伸び、32px 以上の押せる高さを持つ', () => {
    render(
      <ul>
        <AgentChangesFileItem
          entry={makeAgentChangeEntry('a.txt')}
          savedInApp={false}
          disabledReason={null}
          disabledReasonId="reason"
          onOpenDiff={vi.fn()}
          onRevert={vi.fn()}
        />
      </ul>
    )
    const path = getComputedStyle(
      screen.getByRole('button', { name: 'a.txt のエージェントの変更を表示' })
    )
    expect(path.minHeight).toBe('32px')
    expect(path.alignSelf).toBe('stretch')
    const revert = getComputedStyle(
      screen.getByRole('button', { name: /a\.txt を実行前の状態に戻す/ })
    )
    expect(revert.height).toBe('32px')
  })
})
