import { describe, expect, it } from 'vitest'
import type { AgentChangesView } from '../../types'
import type { DiffTabKey } from '../../hooks/useDiffTabs'
import {
  agentDiffContentRunNumber,
  canRevertAgentHunk,
  findActiveAgentEntry,
  findAgentDiffTabsToClose,
  isAgentChangesScopeUnavailable,
  isCumulativeAgentDiffScope
} from '../agentChangesWiring'
import {
  makeAgentChangeEntry,
  makeAgentChangesRecordingView,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableView
} from '../../__tests__/makeAgentChangesState'

const agentTab = (path: string): DiffTabKey => ({ path, kind: 'agent' })

describe('findAgentDiffTabsToClose', () => {
  it('記録が無ければ、agent のタブをすべて閉じる(unstaged・staged は対象外)', () => {
    const tabs: DiffTabKey[] = [
      agentTab('a.txt'),
      { path: 'a.txt', kind: 'unstaged' },
      { path: 'b.txt', kind: 'staged' },
      agentTab('b.txt')
    ]
    expect(findAgentDiffTabsToClose(tabs, { kind: 'none' })).toEqual([
      agentTab('a.txt'),
      agentTab('b.txt')
    ])
  })

  it('記録できない状態でも、agent のタブをすべて閉じる', () => {
    const view: AgentChangesView = {
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    }
    expect(findAgentDiffTabsToClose([agentTab('a.txt')], view)).toEqual([agentTab('a.txt')])
  })

  it('記録中で一覧をまだ取っていなければ null(何もしない)', () => {
    expect(
      findAgentDiffTabsToClose([agentTab('a.txt')], makeAgentChangesRecordingView(null))
    ).toBeNull()
  })

  it('範囲の一覧が取れない(scope-unavailable)間は、消えたかが分からないため null', () => {
    expect(
      findAgentDiffTabsToClose(
        [{ path: 'a.txt', kind: 'agent' }],
        makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 1 }, 'start-not-recorded')
      )
    ).toBeNull()
  })

  it('一覧に残るパスのタブは閉じず、消えたパスのタブだけを返す', () => {
    const tabs = [agentTab('a.txt'), agentTab('gone.txt'), { path: 'gone.txt', kind: 'unstaged' }]
    expect(
      findAgentDiffTabsToClose(
        tabs as DiffTabKey[],
        makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
      )
    ).toEqual([agentTab('gone.txt')])
  })

  it('一覧のフォルダの行(dir/)とタブのパス(dir)を同じものとして扱う', () => {
    const tabs = [agentTab('dir'), agentTab('other')]
    expect(
      findAgentDiffTabsToClose(
        tabs,
        makeAgentChangesRecordingView([
          makeAgentChangeEntry('dir/', { status: 'A', isDirectory: true })
        ])
      )
    ).toEqual([agentTab('other')])
  })

  it('一覧が空なら、agent のタブをすべて返す', () => {
    expect(
      findAgentDiffTabsToClose([agentTab('a.txt')], makeAgentChangesRecordingView([]))
    ).toEqual([agentTab('a.txt')])
  })

  it('閉じるものが無ければ空の配列', () => {
    expect(
      findAgentDiffTabsToClose(
        [agentTab('a.txt')],
        makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
      )
    ).toEqual([])
  })
})

describe('canRevertAgentHunk', () => {
  it('行が無ければ戻せない', () => {
    expect(canRevertAgentHunk(undefined)).toBe(false)
  })

  // 種類の変更(T)は main も拒否する(設計書「戻す」・agentChangesRevert.ts)。押せるのに必ず失敗するボタンを出さない
  it.each([
    ['M', true],
    ['T', false],
    ['A', false],
    ['D', false]
  ] as const)('記録したファイルの %s は %s', (status, expected) => {
    expect(canRevertAgentHunk(makeAgentChangeEntry('a.txt', { status }))).toBe(expected)
  })

  it.each(['M', 'T'] as const)('%s でも記録していないファイルを含むなら戻せない', (status) => {
    expect(canRevertAgentHunk(makeAgentChangeEntry('a.txt', { status, notRecorded: true }))).toBe(
      false
    )
  })

  it.each(['M', 'T'] as const)('%s でもフォルダの行なら戻せない', (status) => {
    expect(canRevertAgentHunk(makeAgentChangeEntry('a/', { status, isDirectory: true }))).toBe(
      false
    )
  })
})

describe('findActiveAgentEntry', () => {
  const view = makeAgentChangesRecordingView([
    makeAgentChangeEntry('a.txt'),
    makeAgentChangeEntry('dir/', { status: 'A', isDirectory: true })
  ])

  it('アクティブな agent のタブのパスの行を返す', () => {
    expect(findActiveAgentEntry(view, agentTab('a.txt'))).toEqual(makeAgentChangeEntry('a.txt'))
  })

  it('フォルダの行もタブのパス(末尾の / なし)で見つける', () => {
    expect(findActiveAgentEntry(view, agentTab('dir'))?.path).toBe('dir/')
  })

  it('アクティブなタブが無い・agent でないなら undefined', () => {
    expect(findActiveAgentEntry(view, null)).toBeUndefined()
    expect(findActiveAgentEntry(view, { path: 'a.txt', kind: 'unstaged' })).toBeUndefined()
    expect(findActiveAgentEntry(view, { path: 'a.txt', kind: 'staged' })).toBeUndefined()
  })

  it('記録が無い・一覧を取っていない・一覧に無いなら undefined', () => {
    expect(findActiveAgentEntry({ kind: 'none' }, agentTab('a.txt'))).toBeUndefined()
    expect(
      findActiveAgentEntry(makeAgentChangesRecordingView(null), agentTab('a.txt'))
    ).toBeUndefined()
    expect(findActiveAgentEntry(view, agentTab('missing.txt'))).toBeUndefined()
  })
})

describe('isAgentChangesScopeUnavailable', () => {
  it('記録中で範囲の一覧が取れないときだけ true', () => {
    expect(
      isAgentChangesScopeUnavailable(
        makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 2 }, 'end-not-recorded')
      )
    ).toBe(true)
    expect(isAgentChangesScopeUnavailable(makeAgentChangesRecordingView([]))).toBe(false)
    expect(isAgentChangesScopeUnavailable(makeAgentChangesRecordingView(null))).toBe(false)
    expect(isAgentChangesScopeUnavailable({ kind: 'none' })).toBe(false)
  })
})

describe('isCumulativeAgentDiffScope', () => {
  it('内容の範囲が累積のときだけ true(実行・内容なしは false)', () => {
    expect(isCumulativeAgentDiffScope({ kind: 'all' })).toBe(true)
    expect(isCumulativeAgentDiffScope({ kind: 'run', runId: 1 })).toBe(false)
    expect(isCumulativeAgentDiffScope(null)).toBe(false)
  })
})

describe('agentDiffContentRunNumber', () => {
  const view = makeAgentChangesRecordingView([], {
    runs: [makeAgentChangesRun({ runId: 5, number: 2 })]
  })

  it('内容の範囲が写しにある実行なら、その実行の番号', () => {
    expect(agentDiffContentRunNumber(view, { kind: 'run', runId: 5 })).toBe(2)
  })

  it('累積・内容なし・写しに無い実行・記録なしは null', () => {
    expect(agentDiffContentRunNumber(view, { kind: 'all' })).toBeNull()
    expect(agentDiffContentRunNumber(view, null)).toBeNull()
    expect(agentDiffContentRunNumber(view, { kind: 'run', runId: 9 })).toBeNull()
    expect(agentDiffContentRunNumber({ kind: 'none' }, { kind: 'run', runId: 5 })).toBeNull()
  })
})
