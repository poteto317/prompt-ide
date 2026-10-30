import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import SourceControlToolbar from '../SourceControlToolbar'
import {
  openSourceControlMenu,
  selectSourceControlMenuItem,
  sourceControlMenuButton
} from '../../../__tests__/sourceControlMenu'

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
  it('見出し「ソース管理」、更新、… の順に並ぶ', () => {
    const { container } = render(<SourceControlToolbar {...baseProps} />)
    const heading = screen.getByRole('heading', { name: 'ソース管理' })
    const refresh = screen.getByRole('button', { name: '更新' })
    const more = sourceControlMenuButton()
    const toolbar = container.querySelector('.source-control-panel__toolbar')
    expect(toolbar).toContainElement(heading)
    expect(heading.compareDocumentPosition(refresh)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(refresh.compareDocumentPosition(more)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  // useAgentChangesClearFocus がこのクラスで探す
  it('更新はアイコンのボタンで、クラスを保つ', () => {
    render(<SourceControlToolbar {...baseProps} />)
    const refresh = screen.getByRole('button', { name: '更新' })
    expect(refresh).toHaveClass('source-control-panel__refresh-btn')
    expect(refresh).not.toHaveTextContent('更新')
  })

  it('… のメニューにプル・プッシュ・フェッチの順で並ぶ', async () => {
    render(<SourceControlToolbar {...baseProps} />)
    await openSourceControlMenu()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'プル',
      'プッシュ',
      'フェッチ'
    ])
  })

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

  it('メニューのフェッチを押すと onFetch が呼ばれる', async () => {
    const onFetch = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onFetch={onFetch} />)
    await selectSourceControlMenuItem('フェッチ')
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('メニューのプルを押すと onPull が呼ばれる', async () => {
    const onPull = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onPull={onPull} />)
    await selectSourceControlMenuItem('プル')
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('メニューのプッシュを押すと onPush が呼ばれる', async () => {
    const onPush = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlToolbar {...baseProps} onPush={onPush} />)
    await selectSourceControlMenuItem('プッシュ')
    expect(onPush).toHaveBeenCalledOnce()
  })

  // 「リポジトリが無ければ実行不可」という業務ルールの判定自体は
  // useGitRemoteOperations 側の責務(isRemoteOperationDisabled として計算済み)。
  // Toolbar は gitStatus 自体を知らず、受け取った値をそのまま disabled に
  // 反映するだけであることを検証する
  it('isRemoteOperationDisabled が true のとき … は押せない(更新ボタンは対象外)', () => {
    render(<SourceControlToolbar {...baseProps} isRemoteOperationDisabled={true} />)
    expect(screen.getByRole('button', { name: '更新' })).not.toBeDisabled()
    expect(sourceControlMenuButton()).toBeDisabled()
  })

  // aria-label は表示テキストと同期させる。固定のまま("フェッチ"等)にすると、
  // 視覚的には「フェッチ中...」に変わっているのにスクリーンリーダーには
  // 変化が伝わらず、状態表現が支援技術で追えなくなる(CLAUDE.md の
  // 「選択状態のARIA」原則と同じ理由)
  it('isFetching が true のときフェッチの項目は「フェッチ中...」表示・aria-label になり disabled になる', async () => {
    render(<SourceControlToolbar {...baseProps} isFetching={true} />)
    await openSourceControlMenu()
    expect(screen.getByRole('menuitem', { name: 'フェッチ中' })).toBeDisabled()
    expect(screen.getByText('フェッチ中...')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'フェッチ' })).not.toBeInTheDocument()
  })

  it('isPulling が true のときプルの項目は「プル中...」表示・aria-label になる', async () => {
    render(<SourceControlToolbar {...baseProps} isPulling={true} />)
    await openSourceControlMenu()
    expect(screen.getByRole('menuitem', { name: 'プル中' })).toBeDisabled()
    expect(screen.getByText('プル中...')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'プル' })).not.toBeInTheDocument()
  })

  it('isPushing が true のときプッシュの項目は「プッシュ中...」表示・aria-label になる', async () => {
    render(<SourceControlToolbar {...baseProps} isPushing={true} />)
    await openSourceControlMenu()
    expect(screen.getByRole('menuitem', { name: 'プッシュ中' })).toBeDisabled()
    expect(screen.getByText('プッシュ中...')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'プッシュ' })).not.toBeInTheDocument()
  })

  // push/pull が同時実行不可という業務ルールの判定自体は useGitRemoteOperations
  // 側の責務(isPushBlocked/isPullBlocked として計算済み)。Toolbar はその結果を
  // 受け取って disabled に反映するだけであることを検証する
  it('isPushBlocked が true のときプッシュの項目だけが disabled になる', async () => {
    render(<SourceControlToolbar {...baseProps} isPushBlocked={true} />)
    await openSourceControlMenu()
    expect(screen.getByRole('menuitem', { name: 'プッシュ' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'プル' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'フェッチ' })).toBeEnabled()
  })

  it('isPullBlocked が true のときプルの項目だけが disabled になる', async () => {
    render(<SourceControlToolbar {...baseProps} isPullBlocked={true} />)
    await openSourceControlMenu()
    expect(screen.getByRole('menuitem', { name: 'プル' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'プッシュ' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'フェッチ' })).toBeEnabled()
  })

  // 初回 push の成功の後に、フォーカスを移す先(useRemoteSetupFocus が探す)
  it('… のボタンはフォーカスの移し先の印を持つ', () => {
    render(<SourceControlToolbar {...baseProps} />)
    expect(sourceControlMenuButton()).toHaveAttribute('data-remote-setup-focus', 'push')
  })
})
