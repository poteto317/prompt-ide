import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AgentSendConfirmSection from '../AgentSendConfirmSection'

const OPTION = 'エージェントへ送る前に、送る内容を確認する'
const NOTE = '変数を差し込んだ後の全文と送り先のタブを確かめてから送ります'

describe('AgentSendConfirmSection', () => {
  it('節の名前と、見えているラベルを名前にしたチェックボックスを出し、説明を参照する', () => {
    render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
    expect(screen.getByText('送信前の確認')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAccessibleDescription(NOTE)
  })

  it('節の名前をグループの名前に結び付け、チェックボックスはそのグループの中にある', () => {
    render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: '送信前の確認' })
    expect(within(group).getByRole('checkbox', { name: OPTION })).toBeInTheDocument()
  })

  it('オフなら外れていて、押すと onChange(true)', async () => {
    const onChange = vi.fn()
    render(<AgentSendConfirmSection enabled={false} saveError={null} onChange={onChange} />)
    const checkbox = screen.getByRole('checkbox', { name: OPTION })
    expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('オンで押すと onChange(false)', async () => {
    const onChange = vi.fn()
    render(<AgentSendConfirmSection enabled saveError={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: OPTION }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('読み込み中は押せず、読み込み中と出す', () => {
    render(<AgentSendConfirmSection enabled={null} saveError={null} onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: OPTION })).toBeDisabled()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('保存の失敗を role="alert" で出す', () => {
    render(
      <AgentSendConfirmSection
        enabled
        saveError="送信前の確認の設定を保存できませんでした: x"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '送信前の確認の設定を保存できませんでした: x'
    )
  })

  it('選択肢はタッチで押せる 32px 以上の高さ', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
    document.head.appendChild(style)
    try {
      render(<AgentSendConfirmSection enabled saveError={null} onChange={vi.fn()} />)
      const label = screen.getByRole('checkbox', { name: OPTION }).closest('label')!
      expect(getComputedStyle(label).minHeight).toBe('32px')
    } finally {
      style.remove()
    }
  })
})
