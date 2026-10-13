import { describe, it, expect } from 'vitest'
import { agentUndoDirtyCheckPaths, planAgentUndoTabSync } from '../agentChangesUndoTabs'
import { makeAgentChangesUndoSummary } from '../../__tests__/makeAgentChangesState'

describe('agentUndoDirtyCheckPaths', () => {
  const summary = makeAgentChangesUndoSummary({
    operation: 'all',
    entries: [
      { path: 'a.txt', action: 'rewrite' },
      { path: 'b.txt', action: 'recreate' },
      { path: 'dir/c.txt', action: 'trash' }
    ]
  })

  it('作り直すパス(今は無い)を除き、書き戻す・ゴミ箱へ移すパスの絶対パスを返す', () => {
    expect(agentUndoDirtyCheckPaths('/repo', summary)).toEqual(['/repo/a.txt', '/repo/dir/c.txt'])
  })

  it('フォルダを開いていなければ空', () => {
    expect(agentUndoDirtyCheckPaths(null, summary)).toEqual([])
  })
})

describe('planAgentUndoTabSync', () => {
  it('書き戻した・作り直したパス(restoredPaths)は読み直し、ゴミ箱へ移したパスは閉じる(絶対パス)', () => {
    expect(
      planAgentUndoTabSync('/repo', { restoredPaths: ['a.txt', 'b.txt'], trashedPaths: ['c.txt'] })
    ).toEqual({ reloadPaths: ['/repo/a.txt', '/repo/b.txt'], closePaths: ['/repo/c.txt'] })
  })

  it('フォルダを開いていなければ何もしない', () => {
    expect(
      planAgentUndoTabSync(null, { restoredPaths: ['a.txt'], trashedPaths: ['c.txt'] })
    ).toEqual({ reloadPaths: [], closePaths: [] })
  })
})
