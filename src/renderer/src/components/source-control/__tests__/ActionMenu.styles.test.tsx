import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import ActionMenu from '../ActionMenu'

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

describe('ActionMenu のスタイル(main.css)', () => {
  // 左端を揃えるとパネルの右へはみ出し、パネルに横スクロールが出る
  it('メニューは右端をボタンに揃え、ルートを基準に置く', async () => {
    const { container } = render(
      <ActionMenu
        buttonLabel="操作"
        buttonContent="…"
        items={[{ id: 'a', label: '項目', onSelect: vi.fn() }]}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '操作' }))
    const menu = getComputedStyle(screen.getByRole('menu'))
    expect(menu.position).toBe('absolute')
    expect(menu.right).toBe('0px')
    expect(menu.left).toBe('auto')
    expect(getComputedStyle(container.firstElementChild!).position).toBe('relative')
  })
})
