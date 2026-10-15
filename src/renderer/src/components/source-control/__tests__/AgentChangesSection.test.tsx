import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type {
  AgentChangeEntry,
  AgentChangesAttributionSummary,
  AgentChangesRun,
  AgentChangesScope
} from '@shared/types'
import AgentChangesSection from '../AgentChangesSection'
import type { AgentChangesView } from '../../../types'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_CLEARED_NOTICE,
  AGENT_CHANGES_EMPTY,
  AGENT_CHANGES_HEAD_CHANGED,
  AGENT_CHANGES_NONE_HINT,
  AGENT_CHANGES_ONLY_USER_REASON,
  AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
  AGENT_CHANGES_RUN_EMPTY,
  AGENT_CHANGES_RUN_HEAD_CHANGED,
  AGENT_CHANGES_TRUNCATED_REASON,
  formatAgentChangesExcludedNote
} from '../../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesLostSummary,
  makeAgentChangesPanelChanges,
  makeAgentChangesPanelState,
  makeAgentChangesRecordingView,
  makeAgentChangesRevertState,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableView,
  makeAgentChangesTrackingSummary,
  makeAgentChangesUndoState,
  makeAgentChangesUndoSummary
} from '../../../__tests__/makeAgentChangesState'

type Props = ComponentProps<typeof AgentChangesSection>

const startedAt = new Date(2026, 9, 7, 10, 42).getTime()
// 見出しの時刻(10:42)を固定するため、記録を始めた時刻だけをこのファイルで決める
const recordingView = (
  entries: AgentChangeEntry[],
  extra: {
    truncated?: boolean
    totalCount?: number
    headChanged?: boolean
    attribution?: AgentChangesAttributionSummary
  } = {}
): AgentChangesView => makeAgentChangesRecordingView(entries, { startedAt, ...extra })

function makeProps(
  view: AgentChangesView,
  overrides: Partial<Props> = {},
  changes: Partial<Props['changes']> = {}
): Props {
  return {
    ...makeAgentChangesPanelState({ changes: makeAgentChangesPanelChanges({ view, ...changes }) }),
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

describe('AgentChangesSection の範囲の選択と実行の範囲の表示', () => {
  const at = (hours: number, minutes: number): number =>
    new Date(2026, 9, 7, hours, minutes).getTime()
  // 実行 1(選べる途中の実行)・実行 2(終わりを記録できなかった)・実行 3(開始を記録できなかった。最後)
  const runs: AgentChangesRun[] = [
    makeAgentChangesRun({ runId: 1, number: 1, startedAt: startedAt, endedAt: at(10, 50) }),
    makeAgentChangesRun({
      runId: 2,
      number: 2,
      startedAt: at(10, 50),
      endedAt: at(11, 5),
      availability: { kind: 'end-not-recorded' }
    }),
    makeAgentChangesRun({
      runId: 3,
      number: 3,
      startedAt: at(11, 5),
      availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
    })
  ]
  const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }
  const runView = (
    entries: AgentChangeEntry[] | null,
    extra: { headChanged?: boolean; scope?: AgentChangesScope } = {}
  ): AgentChangesView =>
    makeAgentChangesRecordingView(entries, { startedAt, runs, scope: RUN_1, ...extra })

  it('実行が無い間は範囲の選択を出さない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]))
    expect(within(section()).queryByRole('combobox', { name: '表示' })).toBeNull()
  })

  // 項目の並び・選べない項目の印は AgentChangesScopeSelect.test で試す。ここは写しの実行の一覧と今の範囲を渡す配線
  it('実行があれば、ラベル「表示」の選択を出し、写しの実行の一覧と今の範囲を渡す', () => {
    renderSection(makeAgentChangesRecordingView([], { startedAt, runs }), {}, { scope: RUN_1 })
    const select = within(section()).getByRole('combobox', { name: '表示' })
    expect(within(select).getAllByRole('option')).toHaveLength(runs.length + 1)
    expect((select as HTMLSelectElement).value).toBe('run:1')
  })

  it('項目を選ぶと selectScope にその範囲を渡す', async () => {
    const props = renderSection(makeAgentChangesRecordingView([], { startedAt, runs }))
    await userEvent.selectOptions(
      within(section()).getByRole('combobox', { name: '表示' }),
      '実行 1（10:42〜10:50）'
    )
    expect(props.changes.selectScope).toHaveBeenCalledExactlyOnceWith(RUN_1)
  })

  it('戻す操作の実行中は選択を押せず、理由を aria-describedby で結び、選んでも selectScope を呼ばない(L-039・L-058)', () => {
    const props = renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt, runs }),
      {
        revert: makeAgentChangesRevertState({
          runningOperation: 'revert',
          revertDisabledReason: '戻す操作の実行中です',
          revertAllDisabledReason: '戻す操作の実行中です'
        })
      }
    )
    const select = within(section()).getByRole('combobox', { name: '表示' })
    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleDescription('戻す操作の実行中です')
    fireEvent.change(select, { target: { value: 'run:1' } })
    expect(props.changes.selectScope).not.toHaveBeenCalled()
  })

  it('実行の範囲では、見出しに実行の番号と期間、空の文言・HEAD の帯は実行の文言', () => {
    renderSection(runView([], { headChanged: true }), {}, { scope: RUN_1 })
    expect(
      within(section()).getByRole('button', { name: /実行 1・10:42〜10:50/ })
    ).toBeInTheDocument()
    expect(within(section()).getByText(AGENT_CHANGES_RUN_EMPTY)).toBeInTheDocument()
    expect(within(section()).getByText(AGENT_CHANGES_RUN_HEAD_CHANGED)).toBeInTheDocument()
    expect(within(section()).queryByText(AGENT_CHANGES_EMPTY)).toBeNull()
    expect(within(section()).queryByText(AGENT_CHANGES_HEAD_CHANGED)).toBeNull()
  })

  it('実行の範囲では、行の ↶ とすべて戻すを押せず、理由を一覧の上に出して結ぶ。確認を終える・更新は押せる', () => {
    renderSection(
      runView([makeAgentChangeEntry('a.txt'), makeAgentChangeEntry('b.txt')]),
      {
        revert: makeAgentChangesRevertState({
          revertDisabledReason: AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
          revertAllDisabledReason: AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE
        })
      },
      { scope: RUN_1 }
    )
    const revert = within(section()).getByRole('button', { name: 'a.txt を実行前の状態に戻す' })
    expect(revert).toBeDisabled()
    expect(revert).toHaveAccessibleDescription(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeDisabled()
    expect(revertAll).toHaveAccessibleDescription(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    expect(within(section()).getByRole('button', { name: '確認を終える' })).toBeEnabled()
    expect(within(section()).getByRole('button', { name: '更新' })).toBeEnabled()
  })

  it('「あなたの保存を含む」は累積の一覧でだけ出す(保存は記録ごとに持つため)', () => {
    const savedPaths = new Set(['/repo/a.txt'])
    renderSection(runView([makeAgentChangeEntry('a.txt')]), {}, { scope: RUN_1, savedPaths })
    expect(within(section()).queryByText('あなたの保存を含む')).toBeNull()
  })

  it.each<[string, 'start-not-recorded' | 'end-not-recorded', AgentChangesScope, string]>([
    [
      '開始を記録できなかった',
      'start-not-recorded',
      { kind: 'run', runId: 3 },
      '開始の状態を記録できませんでした: 未追跡のファイルが多すぎます'
    ],
    [
      '終わりを記録できなかった',
      'end-not-recorded',
      { kind: 'run', runId: 2 },
      '次の実行の開始を記録できなかったため比べられません'
    ]
  ])('範囲の一覧が取れない(%s)ときは、一覧の代わりに理由を出す', (_label, reason, scope, text) => {
    renderSection(
      makeAgentChangesScopeUnavailableView(scope, reason, { startedAt, runs }),
      {},
      { scope }
    )
    expect(within(section()).getByText(text)).toBeInTheDocument()
    expect(within(section()).queryByRole('list')).toBeNull()
  })
})

describe('AgentChangesSection の直前に戻した操作の帯', () => {
  const summary = makeAgentChangesUndoSummary()
  const BUSY = '取り消しの実行中です'
  const undoView = (
    entries: AgentChangeEntry[],
    extra: { undo?: typeof summary | null; runs?: AgentChangesRun[] } = {}
  ): AgentChangesView =>
    makeAgentChangesRecordingView(entries, { startedAt, undo: summary, ...extra })
  const undoProps = (view: AgentChangesView, overrides: Partial<Props> = {}): Props => ({
    ...makeAgentChangesPanelState({
      changes: makeAgentChangesPanelChanges({ view }),
      undo: makeAgentChangesUndoState()
    }),
    isNotRepository: false,
    ...overrides
  })
  const undoButton = (): HTMLElement =>
    screen.getByRole('button', { name: '戻した操作を取り消す（直前: a.txt）' })
  // 取り消しの実行中(戻す系・範囲の選択・確認を終えるは押せない)
  const busyOverrides = (): Partial<Props> => ({
    revert: makeAgentChangesRevertState({
      runningOperation: 'undo',
      revertAllDisabledReason: BUSY,
      revertDisabledReason: BUSY
    }),
    undo: makeAgentChangesUndoState({ undoDisabledReason: BUSY })
  })
  const describedBy = (element: HTMLElement): HTMLElement | null => {
    const id = element.getAttribute('aria-describedby')
    return id === null ? null : document.getElementById(id)
  }

  it('写しの undo があれば範囲に関わらず帯を出し、範囲の選択の後・失敗の文言の前に置く', () => {
    const props = undoProps(
      undoView([makeAgentChangeEntry('a.txt')], { runs: [makeAgentChangesRun()] }),
      {
        revert: makeAgentChangesRevertState({ error: 'x' })
      }
    )
    render(
      <AgentChangesSection
        {...props}
        changes={{ ...props.changes, scope: { kind: 'run', runId: 1 } }}
      />
    )
    const band = screen.getByText('直前に戻した操作: a.txt')
    expect(
      screen.getByRole('combobox', { name: '表示' }).compareDocumentPosition(band) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      band.compareDocumentPosition(screen.getByText('x')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('写しの undo が null なら帯を出さない。一覧が空でも undo があれば出す', () => {
    const { unmount } = render(
      <AgentChangesSection
        {...undoProps(undoView([makeAgentChangeEntry('a.txt')], { undo: null }))}
      />
    )
    expect(screen.queryByText(/^直前に戻した操作/)).toBeNull()
    unmount()
    render(<AgentChangesSection {...undoProps(undoView([]))} />)
    expect(screen.getByText('直前に戻した操作: a.txt')).toBeInTheDocument()
    expect(undoButton()).toBeEnabled()
  })

  it('押すと undoLastRevert を 1 回呼び、帯が消えるとフォーカスを見出しへ戻す(パターン 152)', async () => {
    const props = undoProps(undoView([]))
    const { rerender } = render(<AgentChangesSection {...props} />)
    await userEvent.click(undoButton())
    expect(props.undo.undoLastRevert).toHaveBeenCalledOnce()
    rerender(
      <AgentChangesSection
        {...props}
        changes={{ ...props.changes, view: undoView([], { undo: null }) }}
      />
    )
    expect(screen.queryByText(/^直前に戻した操作/)).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^エージェントの変更/ })).toHaveFocus()
    )
  })

  it('戻す操作の後に、フォーカスを取り消しのボタンへ移さない(L-408)', async () => {
    const props = undoProps(undoView([makeAgentChangeEntry('a.txt')], { undo: null }))
    const { rerender } = render(<AgentChangesSection {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'a.txt を実行前の状態に戻す' }))
    expect(props.revert.revertFile).toHaveBeenCalledOnce()
    rerender(<AgentChangesSection {...props} changes={{ ...props.changes, view: undoView([]) }} />)
    const button = undoButton()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^エージェントの変更/ })).toHaveFocus()
    )
    expect(document.activeElement).not.toBe(button)
  })

  it('取り消しの実行中に一覧が空なら、確認を終える・範囲の選択は帯の中の理由を指す(パターン 126)', () => {
    render(
      <AgentChangesSection
        {...undoProps(undoView([], { runs: [makeAgentChangesRun()] }), busyOverrides())}
      />
    )
    expect(undoButton()).toBeDisabled()
    const reason = describedBy(undoButton())
    expect(reason).toHaveTextContent(BUSY)
    const finish = screen.getByRole('button', { name: '確認を終える' })
    expect(finish).toBeDisabled()
    expect(describedBy(finish)).toBe(reason)
    const select = screen.getByRole('combobox', { name: '表示' })
    expect(select).toBeDisabled()
    expect(describedBy(select)).toBe(reason)
  })

  it('取り消しの実行中に一覧が空で帯が先に消えても、確認を終えるは同じ理由の要素を指す', () => {
    render(<AgentChangesSection {...undoProps(undoView([], { undo: null }), busyOverrides())} />)
    expect(screen.queryByText(/^直前に戻した操作/)).toBeNull()
    const finish = screen.getByRole('button', { name: '確認を終える' })
    expect(finish).toBeDisabled()
    expect(describedBy(finish)).toHaveTextContent(BUSY)
    expect(finish).toHaveAccessibleDescription(BUSY)
  })

  it('一覧に行があり実行中なら、確認を終えるは一覧の上の理由を指す', () => {
    render(
      <AgentChangesSection
        {...undoProps(undoView([makeAgentChangeEntry('a.txt')]), busyOverrides())}
      />
    )
    const finish = screen.getByRole('button', { name: '確認を終える' })
    const reason = describedBy(finish)
    expect(reason).toHaveTextContent(BUSY)
    // 一覧の上の理由(行の ↶ とすべて戻すが指す要素)で、帯の中の理由ではない
    expect(reason).toBe(describedBy(screen.getByRole('button', { name: 'すべて戻す' })))
    expect(reason).not.toBe(describedBy(undoButton()))
  })
})

describe('AgentChangesSection の利用者の変更との区別(区別の状態の 1 行・除く旨・行の印)', () => {
  const at = (hours: number, minutes: number): number =>
    new Date(2026, 9, 7, hours, minutes).getTime()
  // 記録の開始(10:42)より後の 10:50 から区別し、印を付けていない間もあった
  const lateAndUnassigned = makeAgentChangesTrackingSummary({
    since: at(10, 50),
    hadUnassignedSince: true
  })
  const lateAndUnassignedText =
    '利用者の変更の区別は 10:50 からです（それより前の変更には印を付けません）。アプリの中で claude が動いていなかった間などの変更には、印を付けていません'
  const excludedNote = formatAgentChangesExcludedNote(1)

  it('累積の一覧の上に区別の状態の 1 行を出す(読み上げの要素にしない)', () => {
    renderSection(
      recordingView([makeAgentChangeEntry('a.txt')], { attribution: lateAndUnassigned })
    )
    const note = within(section()).getByText(lateAndUnassignedText)
    expect(note).toHaveClass('agent-changes__note')
    expect(note).not.toHaveAttribute('aria-live')
  })

  it('区別の状態の 1 行は、範囲の選択の直後・直前に戻した操作の帯の前に置く', () => {
    const runs = [makeAgentChangesRun({ runId: 1, number: 1, startedAt })]
    renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
        startedAt,
        runs,
        undo: makeAgentChangesUndoSummary(),
        attribution: lateAndUnassigned
      })
    )
    const select = within(section()).getByRole('combobox', { name: '表示' })
    const note = within(section()).getByText(lateAndUnassignedText)
    const band = within(section()).getByText(/^直前に戻した操作: /)
    expect(select.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('区別をやめた記録は理由を 1 行で出す', () => {
    renderSection(
      recordingView([makeAgentChangeEntry('a.txt')], {
        attribution: makeAgentChangesLostSummary({ reason: 'hooks-not-confirmed' })
      })
    )
    expect(
      within(section()).getByText(
        '利用者の変更を区別できません（claude の hooks から知らせが届きません）。すべてエージェントの変更として表示します'
      )
    ).toBeInTheDocument()
  })

  it('区別していない記録では、区別の状態の 1 行を出さない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt')]))
    expect(within(section()).queryByText(/利用者の変更/)).toBeNull()
  })

  it('実行の範囲の一覧では、区別の状態の 1 行を出さない(印は main が null にした行のため出ない)', () => {
    const RUN_1: AgentChangesScope = { kind: 'run', runId: 1 }
    renderSection(
      makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
        startedAt,
        runs: [makeAgentChangesRun({ runId: 1, number: 1, startedAt })],
        scope: RUN_1,
        attribution: lateAndUnassigned
      }),
      {},
      { scope: RUN_1 }
    )
    expect(within(section()).queryByText(lateAndUnassignedText)).toBeNull()
  })

  it('除く行があれば、ほか N 件の後・ボタンの並びの前に除く旨を出し、すべて戻すの aria-describedby で結ぶ', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt', { author: 'agent' }),
        makeAgentChangeEntry('u.txt', { author: 'user' })
      ]),
      { revert: makeAgentChangesRevertState({ revertAllExcludedCount: 1 }) }
    )
    const note = within(section()).getByText(excludedNote)
    expect(note).toHaveClass('agent-changes__note')
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeEnabled()
    expect(revertAll).toHaveAccessibleDescription(excludedNote)
    expect(note.compareDocumentPosition(revertAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      within(section()).getByRole('list').compareDocumentPosition(note) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('押せない理由と除く旨が両方あるときは、すべて戻すの aria-describedby に 2 つの id を並べる(対象 0 件)', () => {
    renderSection(recordingView([makeAgentChangeEntry('u.txt', { author: 'user' })]), {
      revert: makeAgentChangesRevertState({
        revertAllDisabledReason: AGENT_CHANGES_ONLY_USER_REASON,
        revertAllExcludedCount: 1
      })
    })
    const revertAll = within(section()).getByRole('button', { name: 'すべて戻す' })
    expect(revertAll).toBeDisabled()
    expect(revertAll.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2)
    expect(revertAll).toHaveAccessibleDescription(
      `${AGENT_CHANGES_ONLY_USER_REASON} ${excludedNote}`
    )
    // 行の ↶ は押せる(押せない理由は すべて戻す だけのもの)
    expect(
      within(section()).getByRole('button', { name: 'u.txt を実行前の状態に戻す' })
    ).toBeEnabled()
  })

  it('除く行が無く押せない理由も無ければ、すべて戻すに aria-describedby を付けない', () => {
    renderSection(recordingView([makeAgentChangeEntry('a.txt', { author: 'agent' })]))
    expect(within(section()).getByRole('button', { name: 'すべて戻す' })).not.toHaveAttribute(
      'aria-describedby'
    )
    expect(within(section()).queryByText(/を除いて戻します$/)).toBeNull()
  })

  it('行の印は一覧の行の author から出す(累積の一覧)', () => {
    renderSection(
      recordingView([
        makeAgentChangeEntry('a.txt', { author: 'agent' }),
        makeAgentChangeEntry('m.txt', { author: 'mixed' }),
        makeAgentChangeEntry('u.txt', { author: 'user' })
      ])
    )
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).queryByText(/利用者の変更/)).toBeNull()
    expect(within(rows[1]).getByText('利用者の変更を含む')).toBeInTheDocument()
    expect(within(rows[2]).getByText('利用者の変更')).toBeInTheDocument()
  })
})
