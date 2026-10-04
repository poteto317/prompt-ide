import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import ApplyButtons from '../ApplyButtons'
import { TEST_REASON_ID, makeApplyActions } from '../../../__tests__/makeApplyOutputState'
import type { ApplyActions } from '../ApplyButtons'

const INSERT_NAME = '挿入（ここへ入れる）'
const REPLACE_NAME = '置換（ここを置き換える）'

// 理由の要素も一緒に描画し、aria-describedby の参照先が実在する状態で確かめる
function renderButtons(
  overrides: Partial<ApplyActions> = {},
  reason = '選択範囲がありません'
): ApplyActions {
  const actions = makeApplyActions(overrides)
  render(
    <>
      <p id={TEST_REASON_ID}>{reason}</p>
      <ApplyButtons
        {...actions}
        text="本文"
        insertHint="ここへ入れる"
        replaceHint="ここを置き換える"
        className="some-button"
      />
    </>
  )
  return actions
}

describe('ApplyButtons', () => {
  it('アクセシブルネームは表示文言で始まり、補足を全角の括弧で続ける(パターン 76)', () => {
    renderButtons()

    expect(screen.getByRole('button', { name: INSERT_NAME })).toHaveTextContent(/^挿入$/)
    expect(screen.getByRole('button', { name: REPLACE_NAME })).toHaveTextContent(/^置換$/)
  })

  it('2 つのボタンに className を付け、type="button" にする', () => {
    renderButtons()

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('some-button')
      expect(button).toHaveAttribute('type', 'button')
    }
  })

  it('押すと、それぞれの mode と text で apply を呼ぶ', async () => {
    const user = userEvent.setup()
    const actions = renderButtons()

    await user.click(screen.getByRole('button', { name: INSERT_NAME }))
    await user.click(screen.getByRole('button', { name: REPLACE_NAME }))

    expect(actions.apply).toHaveBeenNthCalledWith(1, 'insert', '本文')
    expect(actions.apply).toHaveBeenNthCalledWith(2, 'replace', '本文')
  })

  it('すべて有効なら、title も aria-describedby も付けない', () => {
    renderButtons()

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute('title')
      expect(button).not.toHaveAttribute('aria-describedby')
    }
  })

  it('置換だけが無効なら、置換のボタンだけを disabled にし、理由を title と aria-describedby で示す', () => {
    renderButtons({ replaceDisabledReason: '選択範囲がありません' })

    const insert = screen.getByRole('button', { name: INSERT_NAME })
    const replace = screen.getByRole('button', { name: REPLACE_NAME })
    expect(insert).toBeEnabled()
    expect(insert).not.toHaveAttribute('title')
    expect(insert).not.toHaveAttribute('aria-describedby')
    expect(replace).toBeDisabled()
    expect(replace).toHaveAttribute('title', '選択範囲がありません')
    // title だけでも説明になるため、参照そのものを確かめる
    expect(replace).toHaveAttribute('aria-describedby', TEST_REASON_ID)
    expect(replace).toHaveAccessibleDescription('選択範囲がありません')
  })

  it('挿入だけが無効なら、挿入のボタンだけを disabled にし、理由を示す(逆の向き)', () => {
    renderButtons({ insertDisabledReason: '実行中は反映できません' }, '実行中は反映できません')

    const insert = screen.getByRole('button', { name: INSERT_NAME })
    const replace = screen.getByRole('button', { name: REPLACE_NAME })
    expect(insert).toBeDisabled()
    expect(insert).toHaveAttribute('title', '実行中は反映できません')
    expect(insert).toHaveAttribute('aria-describedby', TEST_REASON_ID)
    expect(replace).toBeEnabled()
    expect(replace).not.toHaveAttribute('title')
    expect(replace).not.toHaveAttribute('aria-describedby')
  })

  it('無効なボタンを押しても apply を呼ばない', async () => {
    const user = userEvent.setup()
    const reason = '反映先のファイルが表示されていません'
    const actions = renderButtons(
      { insertDisabledReason: reason, replaceDisabledReason: reason },
      reason
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(reason)
      await user.click(button)
    }

    expect(actions.apply).not.toHaveBeenCalled()
  })
})
