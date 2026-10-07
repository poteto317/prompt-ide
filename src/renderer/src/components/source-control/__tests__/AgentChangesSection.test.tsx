import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { AgentChangeEntry } from '@shared/types'
import AgentChangesSection from '../AgentChangesSection'
import type { AgentChangesView } from '../../../hooks/useAgentChanges'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_CLEARED_NOTICE,
  AGENT_CHANGES_EMPTY,
  AGENT_CHANGES_HEAD_CHANGED,
  AGENT_CHANGES_NONE_HINT,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesPanelState,
  makeAgentChangesRecordingView,
  makeAgentChangesRevertState
} from '../../../__tests__/makeAgentChangesState'

type Props = ComponentProps<typeof AgentChangesSection>

const startedAt = new Date(2026, 9, 7, 10, 42).getTime()
// 見出しの時刻(10:42)を固定するため、記録を始めた時刻だけをこのファイルで決める
const recordingView = (
  entries: AgentChangeEntry[],
  extra: { truncated?: boolean; totalCount?: number; headChanged?: boolean } = {}
): AgentChangesView => makeAgentChangesRecordingView(entries, { startedAt, ...extra })

function makeProps(
  view: AgentChangesView,
  overrides: Partial<Props> = {},
  changes: Partial<Props['changes']> = {}
): Props {
  return {
    ...makeAgentChangesPanelState({ changes: makeAgentChangesController({ view, ...changes }) }),
    isNotRepository: false,
    ...overrides
  }
}

function renderSection(
  view: AgentChangesView,
  overrides: Partial<Props> = {},
  changes: Partial<Props['changes']> = {}
): Props {
  const props = makeProps(view, overrides, changes)
  render(<AgentChangesSection {...props} />)
  return props
}

const section = (): HTMLElement => screen.getByRole('region', { name: /^エージェントの変更/ })

describe('AgentChangesSection', () => {
  it('従来の方式で記録が無ければ出さない', () => {
    renderSection({ kind: 'none' }, { isAgentMode: false })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('従来の方式でも記録があれば出す', () => {
    renderSection(recordingView([]), { isAgentMode: false })
    expect(section()).toBeInTheDocument()
  })

  it('記録なしは案内と「いまから記録する」を出し、押すと記録を始める', async () => {
    const props = renderSection({ kind: 'none' })
    expect(within(section()).getByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'いまから記録する' }))
    expect(props.changes.begin).toHaveBeenCalledOnce()
  })

  it('Git 管理外のフォルダは理由を出し、記録のボタンを出さない', () => {
    renderSection({ kind: 'none' }, { isNotRepository: true })
    expect(
      screen.getByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'いまから記録する' })).toBeNull()
  })

  it('管理外で記録できなかった後にリポジトリを初期化したら、記録なしと同じ表示に戻す', () => {
    renderSection(
      { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } },
      { isNotRepository: false }
    )
    expect(
      screen.queryByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toBeNull()
    expect(within(section()).getByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'いまから記録する' })).toBeInTheDocument()
  })

  it('管理外で記録できなかった間は、管理外の理由を出したままにする', () => {
    renderSection(
      { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } },
      { isNotRepository: true }
    )
    expect(
      screen.getAllByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'いまから記録する' })).toBeNull()
  })

  it.each([
    ['timeout', '記録に時間がかかりすぎたため、中止しました', true],
    [
      'not-toplevel',
      'リポジトリの最上位のフォルダを開いたときだけ、エージェントの変更を記録できます',
      false
    ]
  ] as const)(
    '記録できない(%s)は理由を出し、記録の失敗のときだけ「もう一度試す」を出す',
    (reason, text, retry) => {
      renderSection({ kind: 'unavailable', state: { kind: 'unavailable', reason } })
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'もう一度試す' }) !== null).toBe(retry)
    }
  )

  it('記録中は見出しに件数と開始の時刻を出し、行のパスで diff を開き、↶ で戻す', async () => {
    const props = renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt'),
        makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true })
      ])
    )
    expect(
      screen.getByRole('button', { name: /エージェントの変更 \(2\)（10:42 から）/ })
    ).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(
      screen.getByRole('button', { name: 'newdir/ のエージェントの変更を表示' })
    )
    expect(props.onOpenDiff).toHaveBeenCalledWith('newdir')
    await userEvent.click(screen.getByRole('button', { name: 'a.txt を実行前の状態に戻す' }))
    expect(props.revert.revertFile).toHaveBeenCalledWith(makeAgentChangeEntry('a.txt'))
    expect(screen.getByRole('button', { name: 'newdir/ をゴミ箱へ移動' })).toBeEnabled()
  })

  it('アプリで保存したファイルに印を付け、記録しなかったファイルは戻すボタンの代わりに理由を出す', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt'),
        makeAgentChangeEntry('big.bin', { notRecorded: true })
      ]),
      {},
      { savedPaths: new Set(['/repo/a.txt']) }
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('あなたの保存を含む')).toBeInTheDocument()
    expect(within(rows[1]).getByText('記録していないため戻せません')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button', { name: /戻す/ })).toBeNull()
  })

  it('追加されたフォルダの行は、配下で保存したときだけ印を付ける(末尾の / を落として判定する)', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true }),
        makeAgentChangeEntry('other/', { status: 'A', isDirectory: true })
      ]),
      {},
      { savedPaths: new Set(['/repo/newdir/x.txt', '/repo/other2/y.txt']) }
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('あなたの保存を含む')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('あなたの保存を含む')).toBeNull()
  })

  it('フォルダを開いていないときは印を付けない', () => {
    renderSection(
      recordingView([makeAgentChangeEntry('a.txt')]),
      { folderPath: null },
      { savedPaths: new Set(['/repo/a.txt']) }
    )
    expect(screen.queryByText('あなたの保存を含む')).toBeNull()
  })

  it('押せないときは理由を 1 か所に出し、戻すボタン・すべて戻すから参照する(パターン 126)', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]), {
      revert: makeAgentChangesRevertState({
        revertDisabledReason: AGENT_CHANGES_BUSY_GIT,
        revertAllDisabledReason: AGENT_CHANGES_BUSY_GIT
      })
    })
    expect(screen.getAllByText(AGENT_CHANGES_BUSY_GIT)).toHaveLength(1)
    for (const name of ['a.txt を実行前の状態に戻す', 'すべて戻す']) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription(AGENT_CHANGES_BUSY_GIT)
    }
  })

  // PR #47 の 2 回目のレビュー: ハンクの失敗は diff タブ側の aria-live が読み上げるため、ここで alert にすると二重に読まれる
  it('ハンクの失敗(isErrorAnnouncedInDiff)は文言だけを出し、alert にしない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]), {
      revert: makeAgentChangesRevertState({
        error: '合いません',
        errorPath: 'a.txt',
        isErrorAnnouncedInDiff: true
      })
    })
    expect(screen.getByText('合いません')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ファイル・すべて戻すの失敗は alert で出す', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]), {
      revert: makeAgentChangesRevertState({
        error: '戻せません',
        errorPath: 'a.txt',
        isErrorAnnouncedInDiff: false
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent('戻せません')
  })

  it('打ち切ったら「ほか N 件」を出し、すべて戻すだけを理由つきで押せなくする', () => {
    renderSection(
      recordingView([makeAgentChangeEntry('a.txt')], { truncated: true, totalCount: 501 }),
      {
        revert: makeAgentChangesRevertState({
          revertAllDisabledReason: AGENT_CHANGES_TRUNCATED_REASON
        })
      }
    )
    expect(screen.getByText('ほか 500 件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて戻す' })).toHaveAccessibleDescription(
      AGENT_CHANGES_TRUNCATED_REASON
    )
    expect(screen.getByRole('button', { name: 'a.txt を実行前の状態に戻す' })).toBeEnabled()
  })

  it('変更が無ければその旨を出し、すべて戻すを出さない。HEAD が変わった帯・一覧の失敗を出す', () => {
    renderSection(recordingView([], { headChanged: true }), {}, { listError: 'git failed' })
    expect(screen.getByText(AGENT_CHANGES_EMPTY)).toBeInTheDocument()
    expect(screen.getByText(AGENT_CHANGES_HEAD_CHANGED)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('git failed')
    expect(screen.queryByRole('button', { name: 'すべて戻す' })).toBeNull()
  })

  it('更新は件数を読み上げる取り直し、確認を終えるは記録を捨てる', async () => {
    const props = renderSection(recordingView([makeAgentChangeEntry('a.txt')]))
    await userEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(props.changes.refresh).toHaveBeenCalledWith({ announce: true })
    await userEvent.click(screen.getByRole('button', { name: '確認を終える' }))
    expect(props.changes.clear).toHaveBeenCalledOnce()
  })

  it('取得中は見出しに「更新中…」を出す', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]), {}, { isLoading: true })
    expect(screen.getByText('更新中…')).toBeInTheDocument()
  })

  it('通知は常設の aria-live の要素に入れる(折りたたんでも残る)', async () => {
    renderSection(recordingView([]), {}, { notice: { text: 'エージェントの変更: 0 件', id: 1 } })
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('エージェントの変更: 0 件')
    await userEvent.click(screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ }))
    // 折りたたんだ本文(hidden)の中ではなく、見える場所(セクションの直前)に常設していること(パターン 151)
    expect(document.querySelector('[aria-live="polite"]')).toBe(live)
    expect(live).toBeVisible()
    expect(
      screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(live).toHaveTextContent('エージェントの変更: 0 件')
  })

  it('フォーカスの依頼があれば見出しへフォーカスを移し(折りたたみを開く)、依頼を下ろす(パターン 86・152)', async () => {
    const props = renderSection(recordingView([]), {
      focusRequest: { isRequested: true, consume: vi.fn() }
    })
    const heading = screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(props.focusRequest.consume).toHaveBeenCalledOnce()
  })

  it('折りたたんでいるときにフォーカスの依頼が来たら、開いてから見出しへ移す', async () => {
    const props = makeProps(recordingView([makeAgentChangeEntry('a.txt')]))
    const { rerender } = render(<AgentChangesSection {...props} />)
    const heading = screen.getByRole('button', { name: /エージェントの変更 \(1\)（10:42 から）/ })
    await userEvent.click(heading)
    expect(heading).toHaveAttribute('aria-expanded', 'false')
    const consume = vi.fn()
    rerender(<AgentChangesSection {...props} focusRequest={{ isRequested: true, consume }} />)
    await waitFor(() => expect(heading).toHaveFocus())
    expect(heading).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'すべて戻す' })).toBeVisible()
    expect(consume).toHaveBeenCalledOnce()
  })

  it('フォーカスの依頼があっても、セクションを出さない間は移さず、依頼も下ろさない', () => {
    const props = renderSection(
      { kind: 'none' },
      { isAgentMode: false, focusRequest: { isRequested: true, consume: vi.fn() } }
    )
    expect(props.focusRequest.consume).not.toHaveBeenCalled()
    expect(document.body).toHaveFocus()
  })

  it('フォーカスの依頼が無ければ、見出しへ移さない', () => {
    const props = renderSection(recordingView([]))
    expect(
      screen.getByRole('button', { name: /エージェントの変更（10:42 から）/ })
    ).not.toHaveFocus()
    expect(props.focusRequest.consume).not.toHaveBeenCalled()
  })

  it('従来の方式で確認を終えてセクションが消えても、終了の通知を読み上げる(パターン 151)', () => {
    const props = makeProps(recordingView([makeAgentChangeEntry('a.txt')]), { isAgentMode: false })
    const { rerender } = render(<AgentChangesSection {...props} />)
    const live = document.querySelector('[aria-live="polite"]')
    rerender(
      <AgentChangesSection
        {...props}
        changes={{
          ...props.changes,
          view: { kind: 'none' },
          notice: { text: AGENT_CHANGES_CLEARED_NOTICE, id: 1 }
        }}
      />
    )
    expect(screen.queryByRole('region')).toBeNull()
    // 文言ごと挿入し直したライブリージョンは読み上げられないため、描き直しの前後で同じ要素であること(パターン 151)
    expect(document.querySelector('[aria-live="polite"]')).toBe(live)
    expect(live).toHaveTextContent(AGENT_CHANGES_CLEARED_NOTICE)
  })

  it('隠れている状態から記録中で表示しても、読み上げの要素は同じものを使い続ける(パターン 151)', () => {
    const props = makeProps({ kind: 'none' }, { isAgentMode: false })
    const { rerender } = render(<AgentChangesSection {...props} />)
    const live = document.querySelector('[aria-live="polite"]')
    expect(live).not.toBeNull()
    rerender(
      <AgentChangesSection
        {...props}
        changes={{
          ...props.changes,
          view: recordingView([]),
          notice: { text: 'エージェントの変更: 0 件', id: 1 }
        }}
      />
    )
    expect(section()).toBeInTheDocument()
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    expect(document.querySelector('[aria-live="polite"]')).toBe(live)
    expect(live).toHaveTextContent('エージェントの変更: 0 件')
  })

  it('押したボタンが消えたら、フォーカスを見出しへ戻す(パターン 86・152)', async () => {
    const props = makeProps(recordingView([makeAgentChangeEntry('a.txt')]))
    const { rerender } = render(<AgentChangesSection {...props} />)
    await userEvent.click(screen.getByRole('button', { name: '確認を終える' }))
    rerender(
      <AgentChangesSection {...props} changes={{ ...props.changes, view: { kind: 'none' } }} />
    )
    expect(screen.queryByRole('button', { name: '確認を終える' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^エージェントの変更/ })).toHaveFocus()
    )
  })

  it('押したボタンが押せなくなったら、フォーカスを見出しへ戻す(パターン 152)', async () => {
    const props = makeProps({ kind: 'none' })
    const { rerender } = render(<AgentChangesSection {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'いまから記録する' }))
    rerender(<AgentChangesSection {...props} changes={{ ...props.changes, isBeginning: true }} />)
    expect(screen.getByRole('button', { name: '記録しています…' })).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^エージェントの変更/ })).toHaveFocus()
    )
  })

  it('利用者がセクションの外へ移したフォーカスは奪わない', async () => {
    const props = makeProps(recordingView([makeAgentChangeEntry('a.txt')]))
    const { rerender } = render(
      <>
        <AgentChangesSection {...props} />
        <button type="button">外のボタン</button>
      </>
    )
    await userEvent.click(screen.getByRole('button', { name: '確認を終える' }))
    const outside = screen.getByRole('button', { name: '外のボタン' })
    outside.focus()
    rerender(
      <>
        <AgentChangesSection {...props} changes={{ ...props.changes, view: { kind: 'none' } }} />
        <button type="button">外のボタン</button>
      </>
    )
    expect(screen.queryByRole('button', { name: '確認を終える' })).toBeNull()
    // 予約が残っていれば、次の描画で奪われる
    rerender(
      <>
        <AgentChangesSection {...props} changes={{ ...props.changes, view: { kind: 'none' } }} />
        <button type="button">外のボタン</button>
      </>
    )
    expect(outside).toHaveFocus()
  })
})
