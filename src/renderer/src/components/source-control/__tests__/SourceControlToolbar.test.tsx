import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SourceControlToolbar from '../SourceControlToolbar'

const baseProps = {
  gitLoading: false,
  onRefresh: vi.fn(),
  isPushing: false,
  isPulling: false,
  isFetching: false,
  isPushBlocked: false,
  isPullBlocked: false,
  isRemoteOperationDisabled: false,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPull: vi.fn().mockResolvedValue(undefined),
  onFetch: vi.fn().mockResolvedValue(undefined)
}

describe('SourceControlToolbar', () => {
  it('更新ボタンをクリックすると onRefresh が呼ばれる', async () => {
    const onRefresh = vi.fn()
    render(<SourceControlToolbar {...baseProps} onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('gitLoading が true のとき更新ボタンが disabled になる', () => {
    render(<SourceControlToolbar {...baseProps} gitLoading={true} />)
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled()
  })

  it('フェッチボタンをクリックすると onFetch が呼ばれる', async () => {
    const onFetch = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onFetch={onFetch} />)
    await userEvent.click(screen.getByRole('button', { name: 'フェッチ' }))
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('プルボタンをクリックすると onPull が呼ばれる', async () => {
    const onPull = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onPull={onPull} />)
    await userEvent.click(screen.getByRole('button', { name: 'プル' }))
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('プッシュボタンをクリックすると onPush が呼ばれる', async () => {
    const onPush = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onPush={onPush} />)
    await userEvent.click(screen.getByRole('button', { name: 'プッシュ' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  // 「リポジトリが無ければ実行不可」という業務ルールの判定自体は
  // useGitRemoteOperations 側の責務(isRemoteOperationDisabled として計算済み)。
  // Toolbar は gitStatus 自体を知らず、受け取った値をそのまま disabled に
  // 反映するだけであることを検証する
  it('isRemoteOperationDisabled が true のときフェッチ/プル/プッシュボタンは disabled になる(更新ボタンは対象外)', () => {
    render(<SourceControlToolbar {...baseProps} isRemoteOperationDisabled={true} />)
    expect(screen.getByRole('button', { name: '更新' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'フェッチ' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'プル' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'プッシュ' })).toBeDisabled()
  })

  // aria-label は表示テキストと同期させる。固定のまま("フェッチ"等)にすると、
  // 視覚的には「フェッチ中...」に変わっているのにスクリーンリーダーには
  // 変化が伝わらず、状態表現が支援技術で追えなくなる(CLAUDE.md の
  // 「選択状態のARIA」原則と同じ理由)
  it('isFetching が true のときフェッチボタンは「フェッチ中...」表示・aria-label になり disabled になる', () => {
    render(<SourceControlToolbar {...baseProps} isFetching={true} />)
    expect(screen.getByRole('button', { name: 'フェッチ中' })).toBeDisabled()
    expect(screen.getByText('フェッチ中...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'フェッチ' })).not.toBeInTheDocument()
  })

  it('isPulling が true のときプルボタンは「プル中...」表示・aria-label になる', () => {
    render(<SourceControlToolbar {...baseProps} isPulling={true} />)
    expect(screen.getByRole('button', { name: 'プル中' })).toBeDisabled()
    expect(screen.getByText('プル中...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プル' })).not.toBeInTheDocument()
  })

  it('isPushing が true のときプッシュボタンは「プッシュ中...」表示・aria-label になる', () => {
    render(<SourceControlToolbar {...baseProps} isPushing={true} />)
    expect(screen.getByRole('button', { name: 'プッシュ中' })).toBeDisabled()
    expect(screen.getByText('プッシュ中...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プッシュ' })).not.toBeInTheDocument()
  })

  // push/pull が同時実行不可という業務ルールの判定自体は useGitRemoteOperations
  // 側の責務(isPushBlocked/isPullBlocked として計算済み)。Toolbar はその結果を
  // 受け取って disabled に反映するだけであることを検証する
  it('isPushBlocked が true のときプッシュボタンが disabled になる', () => {
    render(<SourceControlToolbar {...baseProps} isPushBlocked={true} />)
    expect(screen.getByRole('button', { name: 'プッシュ' })).toBeDisabled()
  })

  it('isPullBlocked が true のときプルボタンが disabled になる', () => {
    render(<SourceControlToolbar {...baseProps} isPullBlocked={true} />)
    expect(screen.getByRole('button', { name: 'プル' })).toBeDisabled()
  })

  // 初回 push の成功の後に、フォーカスを移す先(useRemoteSetupFocus が探す)
  it('プッシュボタンはフォーカスの移し先の印を持つ', () => {
    render(<SourceControlToolbar {...baseProps} />)
    expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveAttribute(
      'data-remote-setup-focus',
      'push'
    )
  })
})
