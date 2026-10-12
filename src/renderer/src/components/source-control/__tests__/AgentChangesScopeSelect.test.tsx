import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import AgentChangesScopeSelect from '../AgentChangesScopeSelect'
import { makeAgentChangesRun } from '../../../__tests__/makeAgentChangesState'

// 範囲の選択の部品そのものの契約(項目の並び・選べない項目・値の符号化・押せない理由の結び)。
// セクションからの配線(出す条件・selectScope へ渡す・戻す操作の実行中の守り)は AgentChangesSection.test で試す
type Props = ComponentProps<typeof AgentChangesScopeSelect>

const at = (hours: number, minutes: number): number =>
  new Date(2026, 9, 7, hours, minutes).getTime()
// 実行 1(選べる途中の実行)・実行 2(終わりを記録できなかった)・実行 3(開始を記録できなかった。最後)
const runs = [
  makeAgentChangesRun({ runId: 1, number: 1, startedAt: at(10, 42), endedAt: at(10, 50) }),
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

function renderSelect(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    startedAt: at(10, 42),
    runs,
    scope: { kind: 'all' },
    disabled: false,
    disabledReasonId: null,
    onSelect: vi.fn<Props['onSelect']>(),
    ...overrides
  }
  render(
    <>
      <p id="reason">戻す操作の実行中です</p>
      <AgentChangesScopeSelect {...props} />
    </>
  )
  return props
}

const select = (): HTMLSelectElement =>
  screen.getByRole('combobox', { name: '表示' }) as HTMLSelectElement

describe('AgentChangesScopeSelect', () => {
  it('項目は すべて → 新しい順の実行。選べない実行は disabled で理由を含む(L-057)', () => {
    renderSelect()
    const options = within(select()).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((option) => option.textContent)).toEqual([
      'すべて（累積・10:42 から）',
      '実行 3（11:05・開始の状態を記録できませんでした: 未追跡のファイルが多すぎます）',
      '実行 2（10:50〜・次の実行の開始を記録できなかったため比べられません）',
      '実行 1（10:42〜10:50）'
    ])
    expect(options.map((option) => option.disabled)).toEqual([false, true, true, false])
  })

  it('並べ替えは props の実行の一覧を書き換えない', () => {
    const given = [...runs]
    renderSelect({ runs: given })
    expect(given.map((run) => run.runId)).toEqual([1, 2, 3])
  })

  it('選んでいる範囲を値に映す(累積は all、実行は run:<runId>)', () => {
    renderSelect({ scope: { kind: 'run', runId: 1 } })
    expect(select().value).toBe('run:1')
  })

  it('項目を選ぶと、その範囲を onSelect に渡す', async () => {
    const props = renderSelect({ scope: { kind: 'run', runId: 1 } })
    await userEvent.selectOptions(select(), 'すべて（累積・10:42 から）')
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'all' })
  })

  it('形の違う値に変わっても onSelect を呼ばない(範囲を変えない)', () => {
    const props = renderSelect()
    fireEvent.change(select(), { target: { value: 'unknown' } })
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('選べない間だけ、押せない理由を aria-describedby で結ぶ', () => {
    renderSelect({ disabled: true, disabledReasonId: 'reason' })
    expect(select()).toBeDisabled()
    expect(select()).toHaveAccessibleDescription('戻す操作の実行中です')
  })

  it('選べるときは理由の id があっても結ばない', () => {
    renderSelect({ disabled: false, disabledReasonId: 'reason' })
    expect(select()).toBeEnabled()
    expect(select()).not.toHaveAttribute('aria-describedby')
  })
})
