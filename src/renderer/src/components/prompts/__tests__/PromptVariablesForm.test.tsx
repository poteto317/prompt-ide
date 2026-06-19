import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PromptVariablesForm from '../PromptVariablesForm'

const defaultProps = {
  variables: ['name', 'topic'],
  onSubmit: vi.fn(),
  onCancel: vi.fn()
}

describe('PromptVariablesForm', () => {
  it('変数ごとに入力欄が表示される', () => {
    render(<PromptVariablesForm {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: '変数 name の値' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '変数 topic の値' })).toBeInTheDocument()
  })

  it('縦並び・行間スタイル用のクラス prompt-item__variables-form が付与される', () => {
    const { container } = render(<PromptVariablesForm {...defaultProps} />)
    // .prompt-item の flex/gap を引き継ぐためのスタイリングフック（CSS 回帰ガード）
    expect(container.querySelector('form')).toHaveClass('prompt-item__variables-form')
  })

  it('可視ラベルが input と関連付けられ、クリックで該当 input にフォーカスが移る', async () => {
    render(<PromptVariablesForm {...defaultProps} />)
    await userEvent.click(screen.getByText('name'))
    expect(screen.getByRole('textbox', { name: '変数 name の値' })).toHaveFocus()
  })

  it('同一ツリー内に複数インスタンスを描画しても input の id が衝突しない（useId）', () => {
    // 同一 React root に2インスタンスを同時描画し、id がすべて一意であることを検証
    const { container } = render(
      <>
        <PromptVariablesForm {...defaultProps} />
        <PromptVariablesForm {...defaultProps} />
      </>
    )
    const ids = Array.from(container.querySelectorAll('input')).map((el) => el.id)
    // 2インスタンス × 2変数 = 4 input、すべて空でなく一意
    expect(ids).toHaveLength(4)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(4)
  })

  it('未入力のとき実行ボタンが disabled', () => {
    render(<PromptVariablesForm {...defaultProps} />)
    expect(screen.getByRole('button', { name: '変数を差し込んで実行' })).toBeDisabled()
  })

  it('すべて入力すると実行ボタンが有効になる', async () => {
    render(<PromptVariablesForm {...defaultProps} />)
    await userEvent.type(screen.getByRole('textbox', { name: '変数 name の値' }), '田中')
    await userEvent.type(screen.getByRole('textbox', { name: '変数 topic の値' }), 'React')
    expect(screen.getByRole('button', { name: '変数を差し込んで実行' })).toBeEnabled()
  })

  it('isRunDisabled=true のとき入力済みでも実行ボタンが disabled', async () => {
    render(<PromptVariablesForm {...defaultProps} isRunDisabled />)
    await userEvent.type(screen.getByRole('textbox', { name: '変数 name の値' }), '田中')
    await userEvent.type(screen.getByRole('textbox', { name: '変数 topic の値' }), 'React')
    expect(screen.getByRole('button', { name: '変数を差し込んで実行' })).toBeDisabled()
  })

  it('実行で onSubmit が入力値とともに呼ばれる', async () => {
    const onSubmit = vi.fn()
    render(<PromptVariablesForm {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox', { name: '変数 name の値' }), '田中')
    await userEvent.type(screen.getByRole('textbox', { name: '変数 topic の値' }), 'React')
    await userEvent.click(screen.getByRole('button', { name: '変数を差し込んで実行' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: '田中', topic: 'React' })
  })

  it('キャンセルで onCancel が呼ばれる', async () => {
    const onCancel = vi.fn()
    render(<PromptVariablesForm {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '変数入力をキャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('全入力済みなら Enter キーで onSubmit が呼ばれる', async () => {
    const onSubmit = vi.fn()
    render(<PromptVariablesForm {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox', { name: '変数 name の値' }), '田中')
    await userEvent.type(screen.getByRole('textbox', { name: '変数 topic の値' }), 'React{Enter}')
    expect(onSubmit).toHaveBeenCalledWith({ name: '田中', topic: 'React' })
  })

  it('isRunDisabled=true のとき全入力済みでも Enter キーで onSubmit が呼ばれない', async () => {
    const onSubmit = vi.fn()
    render(<PromptVariablesForm {...defaultProps} onSubmit={onSubmit} isRunDisabled />)
    await userEvent.type(screen.getByRole('textbox', { name: '変数 name の値' }), '田中')
    await userEvent.type(screen.getByRole('textbox', { name: '変数 topic の値' }), 'React{Enter}')
    // form の onSubmit ガードにより、実行中は Enter でも submit されない
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
