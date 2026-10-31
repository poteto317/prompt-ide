import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { MergeStatePanelState } from '../../../types'
import MergeBanner from '../MergeBanner'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// バナーのボタンは、stash セクション・解決ビューのボタン(.stash-section__push / __action・
// .conflict-resolver__button / .conflict-block__button)と 1 つのグループセレクタで宣言を共有する。
// グループから外れると見た目が崩れるため固定する。
// jsdom は :hover を計算しないため、ホバー色は検証しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const mergeState: MergeStatePanelState = {
  inProgress: true,
  unresolvedCount: 1,
  pendingOperation: null,
  error: null,
  canComplete: false,
  onComplete: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn().mockResolvedValue(undefined)
}

describe('MergeBanner のスタイル(main.css)', () => {
  it('ボタンは 32px 四方以上の枠付きボタンになる(解決ビューのボタンと同じ宣言)', () => {
    render(<MergeBanner isBlocked={false} mergeState={mergeState} />)
    const style = getComputedStyle(screen.getByRole('button', { name: 'マージを中止' }))
    expect(style.minWidth).toBe('32px')
    expect(style.minHeight).toBe('32px')
    expect(style.paddingLeft).toBe('8px')
    expect(style.borderTopStyle).toBe('solid')
    expect(style.borderRadius).toBe('3px')
    expect(style.fontSize).toBe('13px')
    expect(style.cursor).toBe('pointer')
  })

  it('disabled のボタンは半透明で、カーソルが既定に戻る', () => {
    render(<MergeBanner isBlocked={false} mergeState={mergeState} />)
    const style = getComputedStyle(screen.getByRole('button', { name: 'マージを完了' }))
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('default')
  })
})
