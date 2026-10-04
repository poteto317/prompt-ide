import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import OutputPanel from '../OutputPanel'
import { makeApplyOutputState } from '../../../__tests__/makeApplyOutputState'

const RESULT = '説明\n\n```ts\nconst a = 1\n```'

const baseProps = {
  isExecuting: false,
  result: RESULT as string | null,
  streamingText: '',
  executionError: null as Error | null,
  onClear: vi.fn(),
  onCancel: vi.fn()
}

const headerOf = (container: HTMLElement): HTMLElement =>
  container.querySelector('.output-panel__header') as HTMLElement

describe('OutputPanel — 出力全体の挿入・置換', () => {
  it('ヘッダーに、出力全体の「挿入」「置換」を出す(名前は表示文言で始まる)', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )
    const header = headerOf(container)

    expect(
      within(header).getByRole('button', { name: '挿入（出力全体をカーソル位置へ）' })
    ).toHaveTextContent('挿入')
    expect(
      within(header).getByRole('button', { name: '置換（選択範囲を出力全体で）' })
    ).toHaveTextContent('置換')
  })

  it('押すと Markdown の原文(result)で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const applyOutput = makeApplyOutputState()
    render(<OutputPanel {...baseProps} applyOutput={applyOutput} />)

    await user.click(screen.getByRole('button', { name: '挿入（出力全体をカーソル位置へ）' }))
    await user.click(screen.getByRole('button', { name: '置換（選択範囲を出力全体で）' }))

    expect(applyOutput.apply).toHaveBeenNthCalledWith(1, 'insert', RESULT)
    expect(applyOutput.apply).toHaveBeenNthCalledWith(2, 'replace', RESULT)
  })

  it('コードブロックにも「挿入」「置換」を付け、そのブロックの原文で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const applyOutput = makeApplyOutputState()
    const { container } = render(<OutputPanel {...baseProps} applyOutput={applyOutput} />)
    const block = container.querySelector('.code-block') as HTMLElement

    await user.click(within(block).getByRole('button', { name: /^挿入/ }))

    expect(applyOutput.apply).toHaveBeenCalledWith('insert', 'const a = 1')
  })

  it('置換だけが無効なら、理由をヘッダーに表示し、置換のボタンだけがそれを参照する', () => {
    const { container } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ replaceDisabledReason: '選択範囲がありません' })}
      />
    )
    const header = headerOf(container)

    expect(within(header).getByText('選択範囲がありません')).toBeInTheDocument()
    const insert = within(header).getByRole('button', { name: /^挿入/ })
    const replace = within(header).getByRole('button', { name: /^置換/ })
    expect(insert).toBeEnabled()
    expect(insert).not.toHaveAttribute('aria-describedby')
    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute('title', '選択範囲がありません')
    // title だけでも説明になるため、参照先の要素がヘッダーの理由であることを確かめる
    expect(document.getElementById(replace.getAttribute('aria-describedby') ?? '')).toHaveClass(
      'output-panel__apply-reason'
    )
    expect(replace).toHaveAccessibleDescription('選択範囲がありません')
    // コードブロックの置換も同じ理由の要素を参照する
    const block = container.querySelector('.code-block') as HTMLElement
    expect(within(block).getByRole('button', { name: /^置換/ })).toHaveAccessibleDescription(
      '選択範囲がありません'
    )
  })

  it('挿入も無効なら、すべてのボタンが無効で、理由を示す', () => {
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

    const buttons = screen.getAllByRole('button', { name: /^(挿入|置換)/ })
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(reason)
    }
  })

  it('挿入だけが無効な状態を渡されても、挿入のボタンの aria-describedby は実在する理由の要素を指す', () => {
    // 型は「置換の理由は挿入の理由を含む」ことを保証しないため、挿入だけが無効な状態も表示できること
    const reason = '実行中は反映できません'
    const { container } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ insertDisabledReason: reason })}
      />
    )
    const header = headerOf(container)

    const insert = within(header).getByRole('button', { name: /^挿入/ })
    expect(insert).toBeDisabled()
    expect(document.getElementById(insert.getAttribute('aria-describedby') ?? '')).toHaveClass(
      'output-panel__apply-reason'
    )
    expect(insert).toHaveAccessibleDescription(reason)
    expect(within(header).getByRole('button', { name: /^置換/ })).toBeEnabled()
  })

  it('すべて有効なら理由を表示しない', () => {
    const { container } = render(
      <OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />
    )

    expect(container.querySelector('.output-panel__apply-reason')).toBeNull()
  })

  it('実行中は挿入・置換を出さない(逐次出力は Markdown として表示しない)', () => {
    render(
      <OutputPanel
        {...baseProps}
        isExecuting={true}
        streamingText="```ts\nx"
        applyOutput={makeApplyOutputState()}
      />
    )

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '実行をキャンセル' })).toBeInTheDocument()
  })

  it('エラーだけのとき・結果が空のときは挿入・置換を出さない', () => {
    const { rerender } = render(
      <OutputPanel
        {...baseProps}
        result={null}
        executionError={new Error('失敗')}
        applyOutput={makeApplyOutputState()}
      />
    )
    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()

    rerender(<OutputPanel {...baseProps} result="" applyOutput={makeApplyOutputState()} />)
    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
  })

  it('applyOutput を渡さないときは、挿入・置換も通知の領域も出さない(従来の表示)', () => {
    const { container } = render(<OutputPanel {...baseProps} />)

    expect(screen.queryByRole('button', { name: /^(挿入|置換)/ })).not.toBeInTheDocument()
    expect(container.querySelector('.code-block')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('OutputPanel — 反映の通知', () => {
  it('通知を role="status" で表示する', () => {
    render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 1 } })}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('同じ文言の通知が続いても、文字列を変えて読み上げ直させる', () => {
    const { rerender } = render(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 1 } })}
      />
    )
    const first = screen.getByRole('status').textContent

    rerender(
      <OutputPanel
        {...baseProps}
        applyOutput={makeApplyOutputState({ notice: { text: '挿入しました', id: 2 } })}
      />
    )

    expect(screen.getByRole('status').textContent).not.toBe(first)
    expect(screen.getByRole('status')).toHaveTextContent('挿入しました')
  })

  it('通知が無いときも領域は残す(後から入る文言を読み上げさせるため)', () => {
    render(<OutputPanel {...baseProps} applyOutput={makeApplyOutputState()} />)

    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})
