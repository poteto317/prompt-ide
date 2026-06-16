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

  it('複数インスタンスでも input の id が衝突しない（useId による一意化）', () => {
    const { container: c1 } = render(<PromptVariablesForm {...defaultProps} />)
    const { container: c2 } = render(<PromptVariablesForm {...defaultProps} />)
    const id1 = c1.querySelector('input')?.getAttribute('id')
    const id2 = c2.querySelector('input')?.getAttribute('id')
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
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
})
