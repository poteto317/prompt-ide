import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ExecutionModeSection from '../ExecutionModeSection'

describe('ExecutionModeSection', () => {
  it('見出しを名前にした radiogroup に 2 つの radio を出し、選択中を aria-checked で示す', () => {
    render(
      <ExecutionModeSection mode="agent-cli" saveError={null} isLocked={false} onSelect={vi.fn()} />
    )
    const group = screen.getByRole('radiogroup', { name: 'プロンプトの実行方式' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^エージェント CLI/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('選ぶと onSelect を呼ぶ。選択中のものを押しても呼ばない', async () => {
    const onSelect = vi.fn()
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError={null}
        isLocked={false}
        onSelect={onSelect}
      />
    )
    await userEvent.click(screen.getByRole('radio', { name: /^エージェント CLI/ }))
    await userEvent.click(screen.getByRole('radio', { name: /^従来の方式/ }))
    expect(onSelect.mock.calls).toEqual([['legacy']])
  })

  it('読み込み中は選べず、読み込み中と出す', () => {
    render(<ExecutionModeSection mode={null} saveError={null} isLocked onSelect={vi.fn()} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('isLocked が false でも mode が null(読み込み中)なら選べない', () => {
    render(
      <ExecutionModeSection mode={null} saveError={null} isLocked={false} onSelect={vi.fn()} />
    )
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <ExecutionModeSection
        mode="agent-cli"
        saveError="実行方式を保存できませんでした: x"
        isLocked={false}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('実行方式を保存できませんでした: x')
  })

  it('選べない理由があれば出し、選択肢から参照する', () => {
    render(
      <ExecutionModeSection
        mode="legacy"
        saveError={null}
        isLocked
        lockedReason="従来の方式で実行している間は、実行方式を切り替えられません"
        onSelect={vi.fn()}
      />
    )
    const reason = screen.getByText('従来の方式で実行している間は、実行方式を切り替えられません')
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).toHaveAccessibleDescription(
        '従来の方式で実行している間は、実行方式を切り替えられません'
      )
      expect(radio.getAttribute('aria-describedby')).toBe(reason.id)
    }
  })

  it('選べない理由が無ければ、理由も参照も出さない', () => {
    render(
      <ExecutionModeSection mode="legacy" saveError={null} isLocked={false} onSelect={vi.fn()} />
    )
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toHaveAttribute('aria-describedby')
    }
  })
})
