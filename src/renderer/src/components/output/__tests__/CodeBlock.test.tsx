import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer'
import CodeBlock from '../CodeBlock'
import { CodeBlockActionsContext } from '../codeBlockActions'
import { TEST_REASON_ID, makeApplyActions } from '../../../__tests__/makeApplyOutputState'

// CodeBlock は MarkdownRenderer の pre の差し替えとしてだけ使われるため、MarkdownRenderer を通して描画する。
// 無効なボタンの示し方(disabled・title・aria-describedby)の細かい規則は ApplyButtons.test.tsx で確かめる

const TWO_BLOCKS = '前置き\n\n```ts\nconst a = 1\n```\n\n間\n\n```\nplain\n\n```'

describe('CodeBlock', () => {
  it('コードブロックごとに言語名と「挿入」「置換」を、pre の外側に表示する', () => {
    const { container } = render(
      <MarkdownRenderer content={TWO_BLOCKS} codeBlockActions={makeApplyActions()} />
    )
    const blocks = container.querySelectorAll('.code-block')
    expect(blocks).toHaveLength(2)
    expect(within(blocks[0] as HTMLElement).getByText('ts')).toBeInTheDocument()
    // 言語名の無いブロックは「コード」
    expect(within(blocks[1] as HTMLElement).getByText('コード')).toBeInTheDocument()
    for (const block of blocks) {
      const pre = block.querySelector('pre')
      expect(pre).not.toBeNull()
      // ボタンは pre の中に入れない(Markdown の構造を壊さない)
      expect(pre?.querySelector('button')).toBeNull()
      expect(within(block as HTMLElement).getAllByRole('button')).toHaveLength(2)
    }
  })

  it('アクセシブルネームは表示文言で始まる(パターン 76)', () => {
    render(<MarkdownRenderer content={'```ts\nx\n```'} codeBlockActions={makeApplyActions()} />)

    const insert = screen.getByRole('button', {
      name: '挿入（このコードブロックをカーソル位置へ）'
    })
    const replace = screen.getByRole('button', { name: '置換（選択範囲をこのコードブロックで）' })
    expect(insert).toHaveTextContent('挿入')
    expect(replace).toHaveTextContent('置換')
  })

  it('「挿入」「置換」は、そのブロックの原文(末尾の改行を 1 つ除く)で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const actions = makeApplyActions()
    const { container } = render(
      <MarkdownRenderer content={TWO_BLOCKS} codeBlockActions={actions} />
    )
    const second = container.querySelectorAll('.code-block')[1] as HTMLElement

    await user.click(within(second).getByRole('button', { name: /^挿入/ }))
    await user.click(within(second).getByRole('button', { name: /^置換/ }))

    expect(actions.apply).toHaveBeenNthCalledWith(1, 'insert', 'plain\n')
    expect(actions.apply).toHaveBeenNthCalledWith(2, 'replace', 'plain\n')
  })

  it('挿入・置換それぞれの無効の理由と、理由の要素の id(reasonId)をボタンへ渡す', () => {
    // 挿入と置換で別の理由にし、取り違えを検出できるようにする
    render(
      <>
        <p id={TEST_REASON_ID}>理由</p>
        <MarkdownRenderer
          content={'```ts\nx\n```'}
          codeBlockActions={makeApplyActions({
            insertDisabledReason: '挿入できない理由',
            replaceDisabledReason: '置換できない理由'
          })}
        />
      </>
    )

    const insert = screen.getByRole('button', { name: /^挿入/ })
    const replace = screen.getByRole('button', { name: /^置換/ })
    expect(insert).toBeDisabled()
    expect(insert).toHaveAttribute('title', '挿入できない理由')
    expect(insert).toHaveAttribute('aria-describedby', TEST_REASON_ID)
    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute('title', '置換できない理由')
    expect(replace).toHaveAttribute('aria-describedby', TEST_REASON_ID)
    expect(replace).toHaveAccessibleDescription('理由')
  })

  it('置換だけが無効なら、挿入のボタンは有効のまま', () => {
    render(
      <MarkdownRenderer
        content={'```ts\nx\n```'}
        codeBlockActions={makeApplyActions({ replaceDisabledReason: '選択範囲がありません' })}
      />
    )

    expect(screen.getByRole('button', { name: /^挿入/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^置換/ })).toBeDisabled()
  })

  it('空のコードブロックには言語名だけを出し、ボタンを出さない', () => {
    const { container } = render(
      <MarkdownRenderer content={'```js\n```'} codeBlockActions={makeApplyActions()} />
    )

    expect(container.querySelector('.code-block')).not.toBeNull()
    expect(screen.getByText('js')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('インラインコードにはボタンを付けない', () => {
    render(<MarkdownRenderer content="use `foo()` here" codeBlockActions={makeApplyActions()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('反映の状態が変わっても、コードブロックを作り直さない(押したボタンのフォーカスを保つ)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <MarkdownRenderer content={'```ts\nx\n```'} codeBlockActions={makeApplyActions()} />
    )
    const insert = screen.getByRole('button', { name: /^挿入/ })
    await user.click(insert)

    rerender(
      <MarkdownRenderer
        content={'```ts\nx\n```'}
        codeBlockActions={makeApplyActions({ replaceDisabledReason: '選択範囲がありません' })}
      />
    )

    expect(screen.getByRole('button', { name: /^挿入/ })).toBe(insert)
    expect(insert).toHaveFocus()
  })
})

describe('CodeBlock — 原文を取り出せない pre', () => {
  it('反映の状態があっても、code の子を持たない pre(言語なし・code なし)は素の pre のまま表示する', () => {
    // MarkdownRenderer は生の HTML を描画しないため実際には来ないが、来ても見出し・ボタンを付けず落ちない
    const { container } = render(
      <CodeBlockActionsContext.Provider value={makeApplyActions()}>
        <CodeBlock
          className="raw"
          node={{
            type: 'element',
            tagName: 'pre',
            properties: {},
            children: [{ type: 'text', value: 'no code' }]
          }}
        >
          no code
        </CodeBlock>
      </CodeBlockActionsContext.Provider>
    )

    expect(container.querySelector('.code-block')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const pre = screen.getByText('no code')
    expect(pre.tagName).toBe('PRE')
    expect(pre).toHaveClass('raw')
    expect(pre.parentElement).toBe(container)
  })
})
