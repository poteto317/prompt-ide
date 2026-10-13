import { describe, it, expect, vi } from 'vitest'
import { refreshAfterAgentChangesWrite, undoSummaryWriteHooks } from '../agentChangesWriteSync'
import { makeAgentChangesUndoSummary } from '../../__tests__/makeAgentChangesState'

describe('refreshAfterAgentChangesWrite', () => {
  it('ツリー → git status → 一覧 → diff タブの順に取り直す', async () => {
    const calls: string[] = []
    await refreshAfterAgentChangesWrite({
      refreshTree: async () => calls.push('tree'),
      refreshGitStatus: async () => {
        calls.push('status')
      },
      refreshChanges: async () => {
        calls.push('changes')
      },
      refreshDiff: () => {
        calls.push('diff')
      }
    })
    expect(calls).toEqual(['tree', 'status', 'changes', 'diff'])
  })

  it('ツリー・git status の失敗は握り、一覧と diff タブを取り直す', async () => {
    const refreshChanges = vi.fn(async () => undefined)
    const refreshDiff = vi.fn()
    await refreshAfterAgentChangesWrite({
      refreshTree: () => Promise.reject(new Error('tree')),
      refreshGitStatus: () => Promise.reject(new Error('status')),
      refreshChanges,
      refreshDiff
    })
    expect(refreshChanges).toHaveBeenCalledOnce()
    expect(refreshDiff).toHaveBeenCalledOnce()
  })

  it('一覧の取り直しの失敗は投げる(diff タブは取り直さない)', async () => {
    const refreshDiff = vi.fn()
    await expect(
      refreshAfterAgentChangesWrite({
        refreshTree: async () => undefined,
        refreshGitStatus: async () => undefined,
        refreshChanges: () => Promise.reject(new Error('changes')),
        refreshDiff
      })
    ).rejects.toThrow('changes')
    expect(refreshDiff).not.toHaveBeenCalled()
  })
})

describe('undoSummaryWriteHooks', () => {
  it('結果の控えの要約を、依頼の時点の記録の開始の時刻と一緒に写しへ反映する', () => {
    const applyUndoSummary = vi.fn()
    const summary = makeAgentChangesUndoSummary({ undoId: 3 })
    undoSummaryWriteHooks(applyUndoSummary, 10).onResult({ undoSummary: summary })
    expect(applyUndoSummary).toHaveBeenCalledWith(summary, 10)
  })

  it('例外では帯を隠す(null を反映する)', () => {
    const applyUndoSummary = vi.fn()
    undoSummaryWriteHooks(applyUndoSummary, 10).onError(new Error('失敗'))
    expect(applyUndoSummary).toHaveBeenCalledWith(null, 10)
  })
})
