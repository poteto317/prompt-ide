import { describe, it, expect } from 'vitest'
import { isAgentRevertAllTarget } from '@shared/types'
import { agentRevertAllTargets } from '../agentChangesRevertTargets'
import type { ListedAgentChanges } from '../agentChangesScope'
import { makeAgentChangeEntry, makeAgentChangesList } from '../../__tests__/makeAgentChangesState'

describe('agentRevertAllTargets(すべて戻すの対象と除く件数)', () => {
  const agent = makeAgentChangeEntry('a.txt', { author: 'agent' })
  const plain = makeAgentChangeEntry('b.txt', { author: null })
  const user = makeAgentChangeEntry('c.txt', { author: 'user' })
  const mixed = makeAgentChangeEntry('d.txt', { author: 'mixed' })
  const listed = (
    entries: ListedAgentChanges['entries'],
    overrides: { scope?: ListedAgentChanges['scope']; truncated?: boolean } = {}
  ): ListedAgentChanges => ({
    kind: 'listed',
    scope: overrides.scope ?? { kind: 'all' },
    ...makeAgentChangesList(entries, { truncated: overrides.truncated ?? false })
  })

  it('一覧が無ければ対象なし・除く件数 0・対象が無い理由にはしない', () => {
    expect(agentRevertAllTargets(null)).toEqual({
      targets: [],
      excludedCount: 0,
      shownExcludedCount: 0,
      hasOnlyUserChanges: false
    })
  })

  it('user・mixed の行を除き、agent と区別なし(null)の行を対象にする', () => {
    expect(agentRevertAllTargets(listed([agent, user, plain, mixed]))).toEqual({
      targets: [agent, plain],
      excludedCount: 2,
      shownExcludedCount: 2,
      hasOnlyUserChanges: false
    })
  })

  it('対象は main の照合と同じ shared の isAgentRevertAllTarget で決まる(author の 4 値で食い違わない。L-036)', () => {
    const entries = [agent, plain, user, mixed]
    const { targets, excludedCount } = agentRevertAllTargets(listed(entries))
    expect(targets).toEqual(entries.filter(isAgentRevertAllTarget))
    expect(excludedCount).toBe(entries.filter((entry) => !isAgentRevertAllTarget(entry)).length)
  })

  it('行がすべて除く行なら hasOnlyUserChanges', () => {
    const result = agentRevertAllTargets(listed([user, mixed]))
    expect(result.targets).toEqual([])
    expect(result.hasOnlyUserChanges).toBe(true)
  })

  it('行が 0 件なら hasOnlyUserChanges にしない', () => {
    expect(agentRevertAllTargets(listed([])).hasOnlyUserChanges).toBe(false)
  })

  it.each([
    ['打ち切った一覧', { truncated: true }],
    ['実行の範囲の一覧', { scope: { kind: 'run', runId: 1 } as const }]
  ])('%s ではセクションの除く件数を 0 にする(確認の除く件数は数える)', (_, overrides) => {
    const result = agentRevertAllTargets(listed([agent, user], overrides))
    expect(result.excludedCount).toBe(1)
    expect(result.shownExcludedCount).toBe(0)
  })
})
