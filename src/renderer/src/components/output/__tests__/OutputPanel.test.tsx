import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import OutputPanel from '../OutputPanel'

const defaultProps = {
  isExecuting: false,
  result: null,
  executionError: null,
  onClear: vi.fn(),
}

describe('OutputPanel', () => {
  it('全て falsy のとき何も描画しない', () => {
    const { container } = render(<OutputPanel {...defaultProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('isExecuting=true のとき「実行中...」を表示する', () => {
    render(<OutputPanel {...defaultProps} isExecuting={true} />)
    expect(screen.getByText('実行中...')).toBeInTheDocument()
  })

  it('isExecuting=true のときクリアボタンを表示しない', () => {
    render(<OutputPanel {...defaultProps} isExecuting={true} />)
    expect(screen.queryByRole('button', { name: '出力をクリア' })).not.toBeInTheDocument()
  })

  it('result があるときテキストを表示する', () => {
    render(<OutputPanel {...defaultProps} result="回答テキスト" />)
    expect(screen.getByText('回答テキスト')).toBeInTheDocument()
  })

  it('result があるときクリアボタンを表示する', () => {
    render(<OutputPanel {...defaultProps} result="回答テキスト" />)
    expect(screen.getByRole('button', { name: '出力をクリア' })).toBeInTheDocument()
  })

  it('クリアボタンをクリックすると onClear が呼ばれる', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<OutputPanel {...defaultProps} result="テキスト" onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: '出力をクリア' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('executionError があるときエラーメッセージを表示する', () => {
    render(<OutputPanel {...defaultProps} executionError={new Error('api error')} />)
    expect(screen.getByText('api error')).toBeInTheDocument()
  })

  it('executionError があるときクリアボタンを表示する', () => {
    render(<OutputPanel {...defaultProps} executionError={new Error('error')} />)
    expect(screen.getByRole('button', { name: '出力をクリア' })).toBeInTheDocument()
  })

  it('「出力」ヘッダーが表示される', () => {
    render(<OutputPanel {...defaultProps} result="テキスト" />)
    expect(screen.getByText('出力')).toBeInTheDocument()
  })
})
