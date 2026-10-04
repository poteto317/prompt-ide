import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import OutputPanel from '../OutputPanel'
import { makeApplyOutputState } from '../../../__tests__/makeApplyOutputState'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する。
// 「挿入」「置換」は共通の枠付きボタンのグループセレクタで宣言を共有する(パターン 30・77)。jsdom は :hover を計算しない
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

const baseProps = {
  isExecuting: false,
  result: '```ts\nx\n```',
  streamingText: '',
  executionError: null,
  onClear: vi.fn(),
  onCancel: vi.fn()
}

describe('出力パネルの挿入・置換のスタイル(main.css)', () => {
  it('ヘッダーとコードブロックの「挿入」「置換」は 32px 四方以上の枠付きボタン', () => {
    render(<OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />)

    const buttons = screen.getAllByRole('button', { name: /^(挿入|置換)/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      const style = getComputedStyle(button)
      expect(style.minWidth).toBe('32px')
      expect(style.minHeight).toBe('32px')
      expect(style.borderTopStyle).toBe('solid')
      expect(style.cursor).toBe('pointer')
    }
  })

  it('無効なときは半透明で、カーソルが既定に戻る', () => {
    const reason = '反映先のファイルが表示されていません'
    render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({
          insertDisabledReason: reason,
          replaceDisabledReason: reason
        })}
      />
    )

    for (const button of screen.getAllByRole('button', { name: /^(挿入|置換)/ })) {
      const style = getComputedStyle(button)
      expect(style.opacity).toBe('0.5')
      expect(style.cursor).toBe('default')
    }
  })

  it('ヘッダーは 32px のボタンが入る高さで固定し、実行中・エラーだけのときも高さが変わらない', () => {
    // パネルは高さ固定のため、ヘッダーの高さが揺れると本文の領域が伸び縮みする。
    // 41px = 上下の余白 4px ×2 + ボタン 32px + 下の境界線 1px(box-sizing は base.css で全要素 border-box)
    const states = [
      { isExecuting: false, result: baseProps.result, executionError: null },
      { isExecuting: true, result: null, executionError: null },
      { isExecuting: false, result: null, executionError: new Error('失敗') }
    ]
    for (const state of states) {
      const { container, unmount } = render(
        <OutputPanel {...baseProps} {...state} applyOutput={makeApplyOutputState()} />
      )
      const style = getComputedStyle(
        container.querySelector('.output-panel__header') as HTMLElement
      )
      expect(style.minHeight).toBe('41px')
      expect(style.boxSizing).toBe('border-box')
      expect(style.paddingTop).toBe('4px')
      expect(style.paddingBottom).toBe('4px')
      expect(style.borderBottomWidth).toBe('1px')
      unmount()
    }
  })

  it('ヘッダーの通知と無効の理由は 1 行に収め、はみ出しは省略する(狭い幅でヘッダーの高さが伸びない)', () => {
    // 反映の直後は「挿入しました」と「選択範囲がありません」が必ず並ぶ。折り返すとヘッダーが 41px から伸び、本文が動く。
    // jsdom はレイアウトを計算しないため高さそのものは測れない(高さは実機 APL-027 で確かめる)
    const { container } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({
          notice: { text: '挿入しました', id: 1 },
          replaceDisabledReason: '選択範囲がありません'
        })}
      />
    )

    for (const selector of ['.output-panel__notice', '.output-panel__apply-reason']) {
      const style = getComputedStyle(container.querySelector(selector) as HTMLElement)
      expect(style.whiteSpace).toBe('nowrap')
      expect(style.overflow).toBe('hidden')
      expect(style.textOverflow).toBe('ellipsis')
    }
  })

  it('ヘッダーのタイトルとクリア・キャンセルは縮まず、折り返さない', () => {
    const { container, unmount } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )
    const targets = [
      container.querySelector('.output-panel__title') as HTMLElement,
      screen.getByRole('button', { name: '出力をクリア' })
    ]
    for (const element of targets) {
      const style = getComputedStyle(element)
      expect(style.flexShrink).toBe('0')
      expect(style.whiteSpace).toBe('nowrap')
    }
    unmount()

    render(
      <OutputPanel {...baseProps} isExecuting result={null} applyOutput={makeApplyOutputState()} />
    )
    const cancelStyle = getComputedStyle(screen.getByRole('button', { name: '実行をキャンセル' }))
    expect(cancelStyle.flexShrink).toBe('0')
    expect(cancelStyle.whiteSpace).toBe('nowrap')
  })

  it('コードブロックの見出しは折り返しを通常に戻し、pre は見出しとつながる(余白なし)', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )

    const toolbar = container.querySelector('.code-block__toolbar') as HTMLElement
    expect(getComputedStyle(toolbar).whiteSpace).toBe('normal')
    expect(getComputedStyle(toolbar).display).toBe('flex')
    const pre = container.querySelector('.code-block pre') as HTMLElement
    expect(getComputedStyle(pre).marginTop).toBe('0px')
  })
  it('コードブロックの見出し(言語名・挿入・置換)は選択できない(出力を範囲選択してコピーしたとき、見出しの文字が混ざらない)', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )

    const toolbar = container.querySelector('.code-block__toolbar') as HTMLElement
    expect(getComputedStyle(toolbar).getPropertyValue('user-select')).toBe('none')
    // 本文のコードは選択できるまま
    const pre = container.querySelector('.code-block pre') as HTMLElement
    expect(getComputedStyle(pre).getPropertyValue('user-select')).not.toBe('none')
  })
})
