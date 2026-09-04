import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import CommitSection from '../CommitSection'

describe('CommitSection', () => {
  it('メッセージ入力欄とコミットボタンを表示する', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
  })

  it('メッセージが空のときコミットボタンは無効', () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージが空白のみのときコミットボタンは無効', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), '   ')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('stagedCount が 0 のときコミットボタンは無効', async () => {
    render(
      <CommitSection
        stagedCount={0}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeDisabled()
  })

  it('メッセージ入力済み・ステージあり・実行中でないときコミットボタンは有効', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    expect(screen.getByRole('button', { name: 'コミット' })).toBeEnabled()
  })

  it('コミットボタンをクリックすると onCommit がメッセージで呼ばれる', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    await userEvent.type(screen.getByLabelText('コミットメッセージ'), 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(onCommit).toHaveBeenCalledWith('feat: 新機能')
  })

  it('コミット成功時にメッセージ入力欄をクリアする', async () => {
    const onCommit = vi.fn().mockResolvedValue(true)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('')
  })

  it('コミット失敗時はメッセージ入力欄を保持する', async () => {
    const onCommit = vi.fn().mockResolvedValue(false)
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={false}
        onCommit={onCommit}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    const input = screen.getByLabelText('コミットメッセージ') as HTMLTextAreaElement
    await userEvent.type(input, 'feat: 新機能')
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    expect(input.value).toBe('feat: 新機能')
  })

  it('isCommitting が true のときコミットボタンは無効かつ実行中表示', async () => {
    render(
      <CommitSection
        stagedCount={1}
        isCommitting={true}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(screen.getByRole('button', { name: /コミット/ })).toBeDisabled()
  })

  describe('amend', () => {
    it('amendチェックボックスを表示する', () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage={null}
          onAmend={vi.fn()}
        />
      )
      expect(screen.getByLabelText('amend')).toBeInTheDocument()
    })

    it('amendチェック時、メッセージ欄が空なら lastCommitMessage を自動入力する', async () => {
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      expect(screen.getByLabelText('コミットメッセージ')).toHaveValue('feat: 直前のコミット')
    })

    it('amendチェック時、stagedCount が 0 でもコミットボタンは有効', async () => {
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
    })

    it('amendチェック時にボタンを押すと onCommit ではなく onAmend がメッセージで呼ばれる', async () => {
      const onCommit = vi.fn()
      const onAmend = vi.fn().mockResolvedValue(true)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={onCommit}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(onAmend).toHaveBeenCalledWith('feat: 直前のコミット')
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('amend成功後、amendチェックボックスがオフに戻る', async () => {
      // オンのまま残ると、次に新しいメッセージで押したときにユーザーが新規コミットの
      // つもりで直前のコミットを再度 amend してしまう事故が起きる
      const onAmend = vi.fn().mockResolvedValue(true)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(screen.getByLabelText('amend')).not.toBeChecked()
    })

    it('amend失敗時はamendチェックボックスをオンのまま保持する', async () => {
      const onAmend = vi.fn().mockResolvedValue(false)
      render(
        <CommitSection
          stagedCount={0}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={onAmend}
        />
      )
      await userEvent.click(screen.getByLabelText('amend'))
      await userEvent.click(screen.getByRole('button', { name: /コミット/ }))
      expect(screen.getByLabelText('amend')).toBeChecked()
    })

    it('amendチェックを外すとメッセージ欄はクリアされない（引き続き通常コミット可）', async () => {
      render(
        <CommitSection
          stagedCount={1}
          isCommitting={false}
          onCommit={vi.fn()}
          lastCommitMessage="feat: 直前のコミット"
          onAmend={vi.fn()}
        />
      )
      const checkbox = screen.getByLabelText('amend')
      await userEvent.click(checkbox)
      await userEvent.click(checkbox)
      expect(screen.getByRole('button', { name: /コミット/ })).toBeEnabled()
    })
  })
})
