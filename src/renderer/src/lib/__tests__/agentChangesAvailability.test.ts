import { describe, it, expect } from 'vitest'
import { AGENT_CHANGES_UNAVAILABLE_REASONS } from '@shared/types'
import type { AgentChangesUnavailableReason } from '@shared/types'
import {
  agentChangesRunningReason,
  agentRevertAllDisabledReason,
  agentRevertDisabledReason,
  agentUndoDisabledReason,
  canRetryAgentChanges,
  isAgentChangesSectionVisible
} from '../agentChangesAvailability'
import type { AgentRevertAvailability } from '../agentChangesAvailability'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_BUSY_UNDOING,
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_NOT_RECORDED_REASON,
  AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../agentChangesMessages'

describe('「もう一度試す」を出す理由', () => {
  it.each([
    ['timeout', true],
    ['git-failed', true],
    ['not-repository', false],
    ['not-toplevel', false],
    ['too-many-untracked', false]
  ] as const)('%s で「もう一度試す」を出すか: %s', (reason, expected) => {
    expect(canRetryAgentChanges(reason)).toBe(expected)
  })

  it('記録できない理由をすべて網羅している(理由が増えたらこのテストの表にも足す)', () => {
    const covered: readonly AgentChangesUnavailableReason[] = [
      'timeout',
      'git-failed',
      'not-repository',
      'not-toplevel',
      'too-many-untracked'
    ]
    expect([...AGENT_CHANGES_UNAVAILABLE_REASONS].sort()).toEqual([...covered].sort())
  })
})

describe('セクション「エージェントの変更」を出すか', () => {
  it.each([
    [true, 'none', true],
    [true, 'unavailable', true],
    [true, 'recording', true],
    [false, 'none', false],
    [false, 'unavailable', false],
    [false, 'recording', true]
  ] as const)('エージェント CLI 方式=%s・%s のとき: %s', (isAgentMode, viewKind, expected) => {
    expect(isAgentChangesSectionVisible(isAgentMode, viewKind)).toBe(expected)
  })
})

describe('戻すボタンを押せる条件(押せないなら必ず理由がある。パターン 126)', () => {
  // どの理由も立っていない状態(ファイル単位の判定の入力)。各テストは立てる理由だけを上書きする
  const none: AgentRevertAvailability = {
    isLoading: false,
    isGitBusy: false,
    runningOperation: null,
    hasListError: false,
    isRunScope: false
  }
  const flags = [false, true]
  // 実行中の印は 3 値(実行していない・戻す操作・取り消し)
  const runningOperations = [null, 'revert', 'undo'] as const
  const combinations = flags.flatMap((isLoading) =>
    flags.flatMap((isGitBusy) =>
      runningOperations.flatMap((runningOperation) =>
        flags.flatMap((hasListError) =>
          flags.flatMap((truncated) =>
            flags.flatMap((hasNotRecorded) =>
              flags.map((isRunScope) => ({
                isLoading,
                isGitBusy,
                runningOperation,
                hasListError,
                truncated,
                hasNotRecorded,
                isRunScope
              }))
            )
          )
        )
      )
    )
  )

  it.each(combinations)('%o', (availability) => {
    const blocked =
      availability.isLoading ||
      availability.isGitBusy ||
      availability.runningOperation !== null ||
      availability.hasListError ||
      availability.isRunScope
    expect(agentRevertDisabledReason(availability) !== null).toBe(blocked)
    expect(agentRevertAllDisabledReason(availability) !== null).toBe(
      blocked || availability.truncated || availability.hasNotRecorded
    )
  })

  // 優先順位の規則を、表とは別の書き方(先に立っている条件を順に探す)で書き下し、全組み合わせで文言まで一致させる
  it.each(combinations)('文言は優先順位の規則どおり: %o', (availability) => {
    const fileOrder: ReadonlyArray<readonly [boolean, string]> = [
      [availability.runningOperation === 'revert', AGENT_CHANGES_BUSY_REVERTING],
      [availability.runningOperation === 'undo', AGENT_CHANGES_BUSY_UNDOING],
      [availability.hasListError, AGENT_CHANGES_LIST_FAILED],
      [availability.isLoading, AGENT_CHANGES_BUSY_LOADING],
      [availability.isGitBusy, AGENT_CHANGES_BUSY_GIT],
      [availability.isRunScope, AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE]
    ]
    const allOrder: ReadonlyArray<readonly [boolean, string]> = [
      ...fileOrder,
      [availability.truncated, AGENT_CHANGES_TRUNCATED_REASON],
      [availability.hasNotRecorded, AGENT_CHANGES_NOT_RECORDED_REASON]
    ]
    const fileReason = fileOrder.find(([on]) => on)?.[1] ?? null
    const allReason = allOrder.find(([on]) => on)?.[1] ?? null
    expect(agentRevertDisabledReason(availability)).toBe(fileReason)
    expect(agentRevertAllDisabledReason(availability)).toBe(allReason)
    // ファイル単位の理由があれば、すべて戻すの理由は必ず同じ文言(セクションが 1 か所に出す前提)
    if (fileReason !== null) expect(allReason).toBe(fileReason)
  })

  it('理由は実行中 → 一覧の失敗 → 取得中 → 他の Git 操作の順で 1 つ', () => {
    expect(
      agentRevertDisabledReason({ ...none, runningOperation: 'revert', isLoading: true })
    ).toBe(AGENT_CHANGES_BUSY_REVERTING)
    expect(
      agentRevertDisabledReason({ ...none, runningOperation: 'undo', hasListError: true })
    ).toBe(AGENT_CHANGES_BUSY_UNDOING)
    expect(agentRevertDisabledReason({ ...none, hasListError: true, isGitBusy: true })).toBe(
      AGENT_CHANGES_LIST_FAILED
    )
    expect(agentRevertDisabledReason({ ...none, isLoading: true, isGitBusy: true })).toBe(
      AGENT_CHANGES_BUSY_LOADING
    )
    expect(agentRevertDisabledReason({ ...none, isGitBusy: true })).toBe(AGENT_CHANGES_BUSY_GIT)
    expect(agentRevertAllDisabledReason({ ...none, truncated: true, hasNotRecorded: false })).toBe(
      AGENT_CHANGES_TRUNCATED_REASON
    )
  })

  it('一覧の失敗と取得中が同時なら、一覧の失敗を出す(取り直しの間も、古い一覧で戻さない理由を見せる)', () => {
    expect(agentRevertDisabledReason({ ...none, hasListError: true, isLoading: true })).toBe(
      AGENT_CHANGES_LIST_FAILED
    )
    expect(
      agentRevertAllDisabledReason({
        ...none,
        hasListError: true,
        isLoading: true,
        truncated: false,
        hasNotRecorded: false
      })
    ).toBe(AGENT_CHANGES_LIST_FAILED)
  })

  it('記録していない行を含む一覧では、すべて戻すを押せない(main が必ず全体を中止するため)', () => {
    expect(agentRevertAllDisabledReason({ ...none, truncated: false, hasNotRecorded: true })).toBe(
      AGENT_CHANGES_NOT_RECORDED_REASON
    )
    expect(AGENT_CHANGES_NOT_RECORDED_REASON).toBe(
      '記録していないファイルがあるため、すべて戻すは使えません。ファイルごとに戻すか、ターミナルで操作してください'
    )
    expect(agentRevertDisabledReason({ ...none })).toBeNull()
  })

  it.each<[string, Partial<AgentRevertAvailability>, string]>([
    ['runningOperation: revert', { runningOperation: 'revert' }, AGENT_CHANGES_BUSY_REVERTING],
    ['runningOperation: undo', { runningOperation: 'undo' }, AGENT_CHANGES_BUSY_UNDOING],
    ['hasListError', { hasListError: true }, AGENT_CHANGES_LIST_FAILED],
    ['isLoading', { isLoading: true }, AGENT_CHANGES_BUSY_LOADING],
    ['isGitBusy', { isGitBusy: true }, AGENT_CHANGES_BUSY_GIT]
  ])(
    '記録していない行を含んでも、%s の間はその理由を先に出す(行のボタンと同じ文言)',
    (_label, overrides, expected) => {
      expect(
        agentRevertAllDisabledReason({
          ...none,
          ...overrides,
          truncated: false,
          hasNotRecorded: true
        })
      ).toBe(expected)
    }
  )

  it('打ち切りと記録していない行が同時なら、打ち切りを出す', () => {
    expect(agentRevertAllDisabledReason({ ...none, truncated: true, hasNotRecorded: true })).toBe(
      AGENT_CHANGES_TRUNCATED_REASON
    )
  })

  it('どれも立っていなければ、どちらも押せる', () => {
    expect(agentRevertDisabledReason(none)).toBeNull()
    expect(agentRevertAllDisabledReason({ ...none, truncated: false, hasNotRecorded: false })).toBe(
      null
    )
  })
})

describe('agentUndoDisabledReason', () => {
  it.each([
    [null, false, null],
    [null, true, AGENT_CHANGES_BUSY_GIT],
    ['revert', false, AGENT_CHANGES_BUSY_REVERTING],
    ['revert', true, AGENT_CHANGES_BUSY_REVERTING],
    ['undo', false, AGENT_CHANGES_BUSY_UNDOING],
    ['undo', true, AGENT_CHANGES_BUSY_UNDOING]
  ] as const)(
    '実行中 %s・他の Git 操作 %s → %s(押せないなら必ず理由。パターン 126)',
    (runningOperation, isGitBusy, expected) => {
      expect(agentUndoDisabledReason({ runningOperation, isGitBusy })).toBe(expected)
    }
  )
})

describe('agentChangesRunningReason', () => {
  it.each([
    [null, null],
    ['revert', AGENT_CHANGES_BUSY_REVERTING],
    ['undo', AGENT_CHANGES_BUSY_UNDOING]
  ] as const)('実行中 %s → %s', (runningOperation, expected) => {
    expect(agentChangesRunningReason(runningOperation)).toBe(expected)
  })

  it.each(['revert', 'undo'] as const)(
    '実行中 %s は、戻す・取り消しのどちらのボタンも同じ理由を最初に返す(他の条件より優先する)',
    (runningOperation) => {
      const reason = agentChangesRunningReason(runningOperation)
      expect(agentUndoDisabledReason({ runningOperation, isGitBusy: true })).toBe(reason)
      expect(
        agentRevertDisabledReason({
          isLoading: true,
          isGitBusy: true,
          runningOperation,
          hasListError: true,
          isRunScope: true
        })
      ).toBe(reason)
    }
  )
})
