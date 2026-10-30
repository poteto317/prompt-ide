import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { GitLogEntry, GitStatusResult } from '@shared/types'
import type { GitTagPanelState } from '../../../types'
import HistorySection from '../HistorySection'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

vi.mock('../../../lib/gitApi')

import * as gitApi from '../../../lib/gitApi'
import { useGitTagOperations } from '../../../hooks/useGitTagOperations'

describe('HistorySection', () => {
  const makeEntry = (overrides: Partial<GitLogEntry> = {}): GitLogEntry => ({
    hash: 'abcdef1234567',
    parents: [],
    refs: [],
    isHead: false,
    message: 'feat: 新機能',
    date: '2026-09-03T10:00:00+09:00',
    authorName: 'Alice',
    ...overrides
  })

  const renderLog = (log: GitLogEntry[], upstream: string | null = null): HTMLElement => {
    const { container } = render(
      <HistorySection
        log={log}
        upstream={upstream}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    return container
  }

  it('上部にタグやブランチのバッジを出さない(タグはコミットの行に出す)', () => {
    const { container } = render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[
          { name: 'main', current: true },
          { name: 'dev', current: false }
        ]}
        tags={['v1.0.0']}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(container.querySelector('.history-section__badges')).toBeNull()
    expect(screen.queryByText('main')).toBeNull()
    expect(screen.queryByText('dev')).toBeNull()
    expect(screen.queryByText('v1.0.0')).toBeNull()
  })

  // title はフォーカスできない li に付くため、スクリーンリーダーとキーボードでは読めない
  it('行に件名と作成者を出し、ハッシュと相対日時は視覚的に隠したテキストにだけ出す', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    renderLog([makeEntry({ date: oneHourAgo })])
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    const hidden = screen.getByText('abcdef1 1時間前')
    expect(hidden).toHaveClass('history-section__visually-hidden')
    expect(screen.getByRole('listitem')).toContainElement(hidden)
  })

  it('行の title は件名、ハッシュの先頭 7 文字、作成者、相対日時を改行で区切る', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    renderLog([makeEntry({ message: 'feat: 新機能\n\n詳細な説明文', date: oneHourAgo })])
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'title',
      'feat: 新機能\nabcdef1\nAlice\n1時間前'
    )
  })

  it('複数行のコミットメッセージは最初の行だけを表示する', () => {
    renderLog([makeEntry({ message: 'feat: 新機能\n\n詳細な説明文' })])
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
    expect(screen.queryByText(/詳細な説明文/)).not.toBeInTheDocument()
  })

  it('行の並びはグラフ、件名、作成者、位置のラベルの順', () => {
    const container = renderLog([makeEntry({ refs: [{ kind: 'current', name: 'main' }] })])
    const item = screen.getByRole('listitem')
    const inRowOrder = Array.from(
      item.querySelectorAll(
        '.history-section__graph, .history-section__log-message, .history-section__log-author, .history-section__ref'
      )
    ).map((el) => el.getAttribute('class')?.split(' ')[0])
    expect(inRowOrder).toEqual([
      'history-section__graph',
      'history-section__log-message',
      'history-section__log-author',
      'history-section__ref'
    ])
    expect(container.querySelector('.history-section__ref--current')).toHaveTextContent('main')
  })

  it('グラフの SVG は aria-hidden で、行ごとに 1 つ出す', () => {
    renderLog([
      makeEntry({ hash: 'a'.repeat(40), parents: ['b'.repeat(40)] }),
      makeEntry({ hash: 'b'.repeat(40) })
    ])
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    items.forEach((item) => {
      expect(item.querySelector('.history-section__graph')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('読み込んだ全件でグラフを組み立てる(マージの親が別のレーンに出る)', () => {
    const [merge, side, base] = ['a', 'b', 'c'].map((c) => c.repeat(40))
    renderLog([
      makeEntry({ hash: merge, parents: [base, side], message: 'マージ' }),
      makeEntry({ hash: side, parents: [base], message: '分岐' }),
      makeEntry({ hash: base, message: '土台' })
    ])
    const widthOf = (message: string): string | null | undefined =>
      screen
        .getByText(message)
        .closest('li')
        ?.querySelector('.history-section__graph')
        ?.getAttribute('width')
    expect(widthOf('マージ')).toBe('22')
    expect(widthOf('分岐')).toBe('22')
    expect(widthOf('土台')).toBe('22')
  })

  it('upstream をグラフの色に使う(上流のコミットは紫)', () => {
    const container = renderLog(
      [
        makeEntry({
          refs: [{ kind: 'remote', name: 'origin/main' }],
          parents: []
        })
      ],
      'origin/main'
    )
    expect(container.querySelector('.history-section__graph circle')).toHaveAttribute(
      'fill',
      '#B180D7'
    )
  })

  it('位置のラベルを行に出す', () => {
    renderLog([
      makeEntry({
        refs: [
          { kind: 'tag', name: 'v1.0.0' },
          { kind: 'remote', name: 'origin/main' }
        ]
      })
    ])
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('origin/main')).toBeInTheDocument()
  })

  it('hasMore が true のとき「もっと見る」ボタンを表示する', () => {
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={true}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeInTheDocument()
  })

  it('hasMore が false のとき「もっと見る」ボタンを表示しない', () => {
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument()
  })

  it('「もっと見る」クリックで onLoadMore が呼ばれる', async () => {
    const onLoadMore = vi.fn()
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={true}
        isLoading={false}
        error={null}
        onLoadMore={onLoadMore}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'もっと見る' }))
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('isLoading が true のとき「もっと見る」ボタンは無効化される', () => {
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={true}
        isLoading={true}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(screen.getByRole('button', { name: 'もっと見る' })).toBeDisabled()
  })

  it('error がある場合、エラーメッセージを表示する', () => {
    // getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合、履歴パネルが
    // 静かに「コミットなし」と表示されるだけでは実際の問題がユーザーに伝わらない
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={new Error('spawn git ENOENT')}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(screen.getByText('spawn git ENOENT')).toBeInTheDocument()
  })

  it('閉じても error は見え、本体の一覧は隠れる', async () => {
    render(
      <HistorySection
        log={[
          {
            hash: 'a'.repeat(40),
            parents: [],
            refs: [],
            isHead: false,
            message: 'feat: 新機能',
            date: '2026-09-03T10:00:00+09:00',
            authorName: 'Alice'
          }
        ]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={new Error('git が見つかりません')}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '履歴' }))
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByText('feat: 新機能')).not.toBeVisible()
  })

  it('error が null の場合、エラーメッセージを表示しない', () => {
    render(
      <HistorySection
        log={[]}
        upstream={null}
        branches={[]}
        tags={[]}
        hasMore={false}
        isLoading={false}
        error={null}
        onLoadMore={vi.fn()}
        gitTag={makeGitTagPanelState()}
        isBlocked={false}
      />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('HistorySection のタグの作成', () => {
  type SectionProps = ComponentProps<typeof HistorySection>
  // props に加え、同じ props を基に一部だけ変えて描き直す rerenderWith と unmount を返す
  const renderSection = (
    overrides: Partial<SectionProps> = {}
  ): SectionProps & {
    rerenderWith: (next: Partial<SectionProps>) => void
    unmount: () => void
  } => {
    const props: SectionProps = {
      log: [],
      upstream: null,
      branches: [{ name: 'main', current: true }],
      tags: ['v1'],
      hasMore: false,
      isLoading: false,
      error: null,
      onLoadMore: vi.fn(),
      gitTag: makeGitTagPanelState(),
      isBlocked: false,
      ...overrides
    }
    const { rerender, unmount } = render(<HistorySection {...props} />)
    const rerenderWith = (next: Partial<SectionProps>): void =>
      rerender(<HistorySection {...props} {...next} />)
    return { ...props, rerenderWith, unmount }
  }
  const openButton = (): HTMLElement => screen.getByRole('button', { name: 'タグを作成' })

  it('見出しの右に「タグを作成」ボタンがあり、他の操作中は disabled', () => {
    const { unmount } = renderSection({ isBlocked: true })
    expect(openButton()).toHaveTextContent('タグを作成')
    expect(openButton()).toBeDisabled()
    unmount()
    renderSection()
    expect(openButton()).toBeEnabled()
  })

  it('見出しは「履歴」のままで、件数を出さない', () => {
    renderSection()
    expect(screen.getByRole('heading', { name: '履歴' })).toBeInTheDocument()
  })

  it('「タグを作成」は見出しの操作の枠に置き、閉じても押せて、ダイアログは見える', async () => {
    renderSection()
    expect(openButton().parentElement).toHaveClass('collapsible-section__actions')
    await userEvent.click(screen.getByRole('button', { name: '履歴' }))
    expect(openButton()).toBeVisible()
    await userEvent.click(openButton())
    const input = screen.getByRole('textbox', { name: 'タグ名' })
    expect(input).toBeVisible()
    expect(screen.getByRole('region', { name: '履歴' })).not.toContainElement(input)
  })

  it('押すと前回のエラーを消してからダイアログを開く', async () => {
    const props = renderSection()
    await userEvent.click(openButton())
    expect(props.gitTag.clearError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
  })

  it('既存のタグ・ブランチをダイアログの検証に使う', async () => {
    renderSection()
    await userEvent.click(openButton())
    const input = screen.getByRole('textbox', { name: 'タグ名' })
    await userEvent.type(input, 'v1')
    expect(input).toHaveAccessibleDescription('同じ名前のタグが既に存在します')
    await userEvent.clear(input)
    await userEvent.type(input, 'main')
    expect(input).toHaveAccessibleDescription(
      '同じ名前のブランチが存在するため、タグを作成できません'
    )
  })

  // 閉じた後にボタンへフォーカスを戻すこと(作成中が解けた後に戻す)は、下の結合テストで実物の作成中フラグと確かめる
  it('作成に成功したらダイアログを閉じる', async () => {
    const props = renderSection()
    await userEvent.click(openButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(props.gitTag.createTag).toHaveBeenCalledWith({
      name: 'v2',
      kind: 'lightweight',
      message: ''
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('作成に失敗したら(false)ダイアログを閉じない', async () => {
    const gitTag = makeGitTagPanelState({
      createTag: vi.fn<GitTagPanelState['createTag']>().mockResolvedValue(false)
    })
    renderSection({ gitTag })
    await userEvent.click(openButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(gitTag.createTag).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
  })

  it('ダイアログを開いたまま他の操作が始まると(isBlocked)、ダイアログの作成も disabled になる', async () => {
    const { rerenderWith } = renderSection()
    await userEvent.click(openButton())
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2')
    expect(screen.getByRole('button', { name: '作成' })).toBeEnabled()
    rerenderWith({ isBlocked: true })
    expect(screen.getByRole('button', { name: '作成' })).toBeDisabled()
  })

  it('作成中(isCreating)は「タグを作成」ボタンも disabled(開き直したダイアログが前の作成の成功で閉じられない)', () => {
    renderSection({ gitTag: makeGitTagPanelState({ isCreating: true }) })
    expect(openButton()).toBeDisabled()
    expect(openButton()).toHaveAccessibleName('タグを作成')
  })
})

// 実物の useGitTagOperations(gitApi だけをモック)と HistorySection を結合し、作成が保留中の間の
// 振る舞いを確かめる。作成中に閉じられると、遅れて届いた失敗を見る手段が無くなる(パターン 73)
describe('HistorySection のタグの作成(useGitTagOperations との結合)', () => {
  const repoStatus: GitStatusResult = {
    isRepo: true,
    mergeInProgress: false,
    hasOrigin: true,
    hasRemote: true,
    upstream: 'origin/main',
    detached: false,
    branch: 'main',
    ahead: 0,
    behind: 0,
    files: []
  }

  function Harness(): React.JSX.Element {
    const gitTag = useGitTagOperations(repoStatus, async () => {})
    return (
      <>
        <HistorySection
          log={[]}
          upstream={null}
          branches={[{ name: 'main', current: true }]}
          tags={[]}
          hasMore={false}
          isLoading={false}
          error={null}
          onLoadMore={vi.fn()}
          gitTag={gitTag}
          isBlocked={false}
        />
        {/* 作成中にユーザーがフォーカスを移す先(履歴の外の入力欄の代わり) */}
        <input aria-label="外の入力欄" />
      </>
    )
  }

  // 作成を保留させ、解決・失敗を後から起こせるようにする
  function holdCreate(): { resolve: () => void; reject: (reason: Error) => void } {
    const handlers: { resolve: () => void; reject: (reason: Error) => void } = {
      resolve: () => {},
      reject: () => {}
    }
    vi.mocked(gitApi.createTag).mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          handlers.resolve = () => resolve()
          handlers.reject = reject
        })
    )
    return {
      resolve: () => handlers.resolve(),
      reject: (reason) => handlers.reject(reason)
    }
  }

  it('作成が保留から成功すると、ダイアログが閉じて「タグを作成」ボタンにフォーカスが戻る(作成中の disabled が解けた後に戻す)', async () => {
    const pending = holdCreate()
    render(<Harness />)
    const openButton = screen.getByRole('button', { name: 'タグを作成' })
    await userEvent.click(openButton)
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(openButton).toBeDisabled()

    // act の中で解決すると、作成中フラグの解除(setBusy(false))が await の続きより先に反映され、
    // 実機の「まだ disabled のボタンへ focus() して無視される」順序が再現しない。act の外で解決し、
    // 実機と同じく React の通常のスケジューラで再描画させる(waitFor の間は act 環境が外れる)
    pending.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(openButton).toBeEnabled()
    // waitFor はダイアログが消えた時点で抜けるが、フォーカスを戻す処理は passive な useEffect で後から走る。
    // 負荷がかかると先に評価されて落ちるため、フォーカスも待つ
    await waitFor(() => expect(openButton).toHaveFocus())
  })

  it('キャンセルで閉じても「タグを作成」ボタンにフォーカスが戻る', async () => {
    render(<Harness />)
    const openButton = screen.getByRole('button', { name: 'タグを作成' })
    await userEvent.click(openButton)
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(openButton).toHaveFocus())
  })

  // 作成中に外の要素へ移したフォーカスを、遅れて届いた成功で奪わないことは useDialogFocusReturn のテストで確かめる

  it('作成中に入力が disabled になってフォーカスが外れても、失敗の後はタグ名の入力欄へ戻り、Escape で閉じられる', async () => {
    const pending = holdCreate()
    render(<Harness />)
    const openButton = screen.getByRole('button', { name: 'タグを作成' })
    await userEvent.click(openButton)
    const input = screen.getByRole('textbox', { name: 'タグ名' })
    await userEvent.type(input, 'v2{Enter}')
    expect(input).toBeDisabled()
    // ブラウザは disabled になった要素からフォーカスを外し body に落とす。jsdom は落とさず、disabled の要素の
    // blur() も無視するため、外の入力欄を経由して body に落とした状態を再現する
    const outside = screen.getByRole('textbox', { name: '外の入力欄' })
    act(() => {
      outside.focus()
      outside.blur()
    })
    expect(document.body).toHaveFocus()

    await act(async () => {
      pending.reject(new Error('タグの作成に失敗しました'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('タグの作成に失敗しました')
    expect(input).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(openButton).toHaveFocus())
  })

  it('作成の保留中はキャンセル・Escape・オーバーレイで閉じられず、失敗はダイアログ内に role="alert" で見える', async () => {
    const pending = holdCreate()
    const { container } = render(<Harness />)
    const openButton = screen.getByRole('button', { name: 'タグを作成' })
    await userEvent.click(openButton)
    await userEvent.type(screen.getByRole('textbox', { name: 'タグ名' }), 'v2{Enter}')
    expect(screen.getByRole('button', { name: '作成中...' })).toBeDisabled()

    // 保留中: どの手段でも閉じず、開き直す入口も塞がっている
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'タグ名' }), { key: 'Escape' })
    fireEvent.click(container.querySelector('.name-input-dialog__overlay')!)
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
    expect(openButton).toBeDisabled()

    await act(async () => {
      pending.reject(new Error('タグの作成に失敗しました'))
    })
    expect(screen.getByRole('dialog', { name: 'タグを作成' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('タグの作成に失敗しました')
    // 終わった後は通常どおり閉じられ、開き直せる
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
    expect(openButton).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // 再試行の作成中に前回の alert が残ると、作成中の案内(status)と同時に出て、同じ文言で再び失敗したときに
  // alert の DOM が変わらず読み上げられない(PR #41 の 3 周目のレビュー)
  it('失敗の後に再試行すると、作成中は alert が消えて status だけになり、同じ文言で再び失敗すると alert が作り直される', async () => {
    const pending = holdCreate()
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    const input = screen.getByRole('textbox', { name: 'タグ名' })
    await userEvent.type(input, 'v2{Enter}')
    await act(async () => {
      pending.reject(new Error('タグを作成できませんでした: x'))
    })
    const firstAlert = screen.getByRole('alert')
    expect(firstAlert).toHaveTextContent('タグを作成できませんでした: x')

    await userEvent.click(screen.getByRole('button', { name: '作成' }))
    expect(screen.getByRole('status')).toHaveTextContent('作成中です')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      pending.reject(new Error('タグを作成できませんでした: x'))
    })
    const secondAlert = screen.getByRole('alert')
    expect(secondAlert).toHaveTextContent('タグを作成できませんでした: x')
    expect(secondAlert).not.toBe(firstAlert)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
