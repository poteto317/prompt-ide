import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import ChangesSection from '../ChangesSection'

let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

describe('ChangesSection のスタイル(main.css)', () => {
  // 取り消しボタンはステージボタンと同じ見た目・大きさにする
  it('取り消しボタンはステージボタンと同じ大きさ', () => {
    render(
      <ChangesSection
        files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onOpenDiff={vi.fn()}
      />
    )
    // ステージ/取り消しボタンは行の hover 時のみ display:flex になる(main.css)。
    // jsdom は :hover 擬似クラスを解決しないため、既定状態では display:none のまま。
    // getByRole(name:...) はアクセス不能(非表示)な要素を除外してしまう(hidden:true を
    // 付けても name によるアクセシブルネーム照合はヒットしない)ため、既存の
    // ChangesSection.test.tsx ステージボタンテストと同じく getByLabelText を使う
    const discard = getComputedStyle(screen.getByLabelText('src/a.ts の変更を取り消し'))
    const stage = getComputedStyle(screen.getByLabelText('src/a.ts をステージ'))
    expect(discard.width).toBe(stage.width)
    expect(discard.height).toBe(stage.height)
  })
})
