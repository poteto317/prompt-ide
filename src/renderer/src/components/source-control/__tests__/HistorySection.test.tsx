import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import HistorySection from '../HistorySection'

describe('HistorySection', () => {
  it('ブランチ名・タグ名をバッジとして表示する', () => {
    render(
      <HistorySection
        log={[]}
        branches={[{ name: 'main', current: true }, { name: 'dev', current: false }]}
        tags={['v1.0.0']}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('dev')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
  })

  it('コミット一覧をハッシュ短縮形・メッセージで表示する', () => {
    render(
      <HistorySection
        log={[{ hash: 'abcdef1234567', message: 'feat: 新機能', date: '2026-09-03T10:00:00+09:00', authorName: 'Alice' }]}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
  })

  it('hasMore が true のとき「もっと見る」ボタンを表示する', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={false} onLoadMore={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeInTheDocument()
  })

  it('hasMore が false のとき「もっと見る」ボタンを表示しない', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={false} isLoading={false} onLoadMore={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument()
  })

  it('「もっと見る」クリックで onLoadMore が呼ばれる', async () => {
    const onLoadMore = vi.fn()
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={false} onLoadMore={onLoadMore} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('isLoading が true のとき「もっと見る」ボタンは無効化される', () => {
    render(
      <HistorySection log={[]} branches={[]} tags={[]} hasMore={true} isLoading={true} onLoadMore={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeDisabled()
  })
})
