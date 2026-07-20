import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import OutputPanel from '../OutputPanel'

const defaultProps = {
  isExecuting: false,
  result: null,
  streamingText: '',
  executionError: null,
  onClear: vi.fn(),
  onCancel: vi.fn()
}

describe('OutputPanel', () => {
  it('全て falsy のとき何も描画しない', () => {
    const { container } = render(<OutputPanel {...defaultProps} />)
    expect(container.firstChild).toBeNull()
  })

  it('isExecuting=true かつストリームテキストが空のとき「実行中...」を表示する', () => {
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

  it('isExecuting=true のとき result があっても表示しない', () => {
    render(<OutputPanel {...defaultProps} isExecuting={true} result="回答テキスト" />)
    expect(screen.queryByText('回答テキスト')).not.toBeInTheDocument()
    expect(screen.getByText('実行中...')).toBeInTheDocument()
  })

  it('isExecuting=true のとき executionError があってもエラーを表示しない', () => {
    render(
      <OutputPanel {...defaultProps} isExecuting={true} executionError={new Error('エラー')} />
    )
    expect(screen.queryByText('エラー')).not.toBeInTheDocument()
    expect(screen.getByText('実行中...')).toBeInTheDocument()
  })

  it('result と executionError が両方ある場合は両方表示する', () => {
    render(
      <OutputPanel
        {...defaultProps}
        result="回答テキスト"
        executionError={new Error('エラーメッセージ')}
      />
    )
    expect(screen.getByText('回答テキスト')).toBeInTheDocument()
    expect(screen.getByText('エラーメッセージ')).toBeInTheDocument()
  })

  it('executionError のときクリアボタンをクリックすると onClear が呼ばれる', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<OutputPanel {...defaultProps} executionError={new Error('エラー')} onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: '出力をクリア' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  describe('ストリーミング表示', () => {
    it('isExecuting=true かつ streamingText があるとき逐次テキストを表示する', () => {
      render(<OutputPanel {...defaultProps} isExecuting={true} streamingText="途中までの出力" />)
      expect(screen.getByText('途中までの出力')).toBeInTheDocument()
      expect(screen.queryByText('実行中...')).not.toBeInTheDocument()
    })

    it('streamingText は pre 要素（等幅・Markdown レンダリングなし）で表示される', () => {
      render(
        <OutputPanel
          {...defaultProps}
          isExecuting={true}
          streamingText="# 見出しになるべきでない"
        />
      )
      const pre = screen.getByText('# 見出しになるべきでない')
      expect(pre.tagName).toBe('PRE')
    })

    it('isExecuting=false のとき streamingText は表示しない', () => {
      render(<OutputPanel {...defaultProps} result="最終結果" streamingText="残留テキスト" />)
      expect(screen.queryByText('残留テキスト')).not.toBeInTheDocument()
      expect(screen.getByText('最終結果')).toBeInTheDocument()
    })
  })

  describe('キャンセルボタン', () => {
    it('isExecuting=true のときキャンセルボタンを表示する', () => {
      render(<OutputPanel {...defaultProps} isExecuting={true} />)
      expect(screen.getByRole('button', { name: '実行をキャンセル' })).toBeInTheDocument()
    })

    it('isExecuting=false のときキャンセルボタンを表示しない', () => {
      render(<OutputPanel {...defaultProps} result="結果" />)
      expect(screen.queryByRole('button', { name: '実行をキャンセル' })).not.toBeInTheDocument()
    })

    it('キャンセルボタンをクリックすると onCancel が呼ばれる', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<OutputPanel {...defaultProps} isExecuting={true} onCancel={onCancel} />)
      await user.click(screen.getByRole('button', { name: '実行をキャンセル' }))
      expect(onCancel).toHaveBeenCalledOnce()
    })
  })
})
