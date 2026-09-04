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

  it('複数行のコミットメッセージは最初の行だけを表示する', () => {
    render(
      <HistorySection
        log={[
          {
            hash: 'abcdef1234567',
            message: 'feat: 新機能\n\n詳細な説明文',
            date: '2026-09-03T10:00:00+09:00',
            authorName: 'Alice'
          }
        ]}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
    expect(screen.queryByText(/詳細な説明文/)).not.toBeInTheDocument()
  })

  it('各コミットに日時関連のテキストが表示される（相対日時）', () => {
    // 設計仕様は「ハッシュ短縮形・メッセージ1行・相対日時」を要求しているが、
    // 以前は entry.date が描画されておらず、履歴一覧に日時が一切表示されなかった
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    render(
      <HistorySection
        log={[{ hash: 'abcdef1234567', message: 'feat: 新機能', date: oneHourAgo, authorName: 'Alice' }]}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('1時間前')).toBeInTheDocument()
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
