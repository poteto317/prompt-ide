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
    const discard = getComputedStyle(screen.getByLabelText('src/a.ts の変更を取り消し'))
    const stage = getComputedStyle(screen.getByLabelText('src/a.ts をステージ'))
    expect(discard.width).toBe(stage.width)
    expect(discard.height).toBe(stage.height)
  })
})
